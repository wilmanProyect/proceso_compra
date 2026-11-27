const db = require('../config/db');
const formularioModel = require('./formularioModel');
const { ESTADOS } = require('../utils/constantes');
const { ErrorFlujo } = require('../utils/errores');

const SELECT_PROCESO = `
  SELECT p.*, u.sigla, u.nombre AS unidad_nombre, u.razon_social, u.nit AS unidad_nit, u.logo, u.color,
         u.codigo_revision, u.notas_oc, u.direccion AS unidad_direccion, u.telefono AS unidad_telefono,
         s.nombre AS solicitante_nombre, s.cargo AS solicitante_cargo, d.nombre AS departamento_nombre,
         ex.nombre AS excepcion_usuario_nombre
  FROM procesos p
  JOIN unidades_negocio u ON u.id = p.unidad_id
  JOIN usuarios s ON s.id = p.solicitante_id
  LEFT JOIN departamentos d ON d.id = p.departamento_id
  LEFT JOIN usuarios ex ON ex.id = p.excepcion_usuario_id`;

// Condición SQL de visibilidad según permisos:
//  - ver_todos: todos los procesos de todas las unidades (Gerencia)
//  - ver_unidades: todos los procesos de las unidades asignadas al usuario
//  - resto: solo los procesos que creó
function visibilidad(usuario, params) {
  if (usuario.permisos.includes('procesos.ver_todos')) return 'TRUE';
  params.push(usuario.id);
  const propio = `p.solicitante_id = $${params.length}`;
  if (usuario.permisos.includes('procesos.ver_unidades')) {
    params.push(usuario.unidades);
    return `(${propio} OR p.unidad_id = ANY($${params.length}))`;
  }
  return propio;
}

function puedeVer(usuario, proceso) {
  if (usuario.permisos.includes('procesos.ver_todos')) return true;
  if (String(proceso.solicitante_id) === String(usuario.id)) return true;
  return usuario.permisos.includes('procesos.ver_unidades') && usuario.unidades.includes(proceso.unidad_id);
}

// Estados en los que el usuario tiene una acción pendiente
function estadosConAccion(usuario) {
  return Object.entries(ESTADOS)
    .filter(([, e]) => e.permiso && [].concat(e.permiso).some((p) => usuario.permisos.includes(p)))
    .map(([codigo]) => codigo);
}

async function listar(usuario, filtros = {}) {
  const params = [];
  const condiciones = [visibilidad(usuario, params)];
  if (filtros.unidad) { params.push(filtros.unidad); condiciones.push(`p.unidad_id = $${params.length}`); }
  if (filtros.estado) { params.push(filtros.estado); condiciones.push(`p.estado = $${params.length}`); }
  if (filtros.gestion) { params.push(filtros.gestion); condiciones.push(`p.gestion = $${params.length}`); }
  if (filtros.pendientes) {
    params.push(estadosConAccion(usuario));
    condiciones.push(`p.estado = ANY($${params.length})`);
  }
  if (filtros.mios) { params.push(usuario.id); condiciones.push(`p.solicitante_id = $${params.length}`); }
  if (filtros.q) {
    params.push(`%${filtros.q}%`);
    const i = params.length;
    condiciones.push(`(s.nombre ILIKE $${i} OR (u.sigla || '-REQ-' || p.nro_requerimiento) ILIKE $${i}
      OR (u.sigla || '-' || p.oc_numero) ILIKE $${i}
      OR EXISTS (SELECT 1 FROM proceso_items it WHERE it.proceso_id = p.id AND it.descripcion ILIKE $${i}))`);
  }
  const { rows } = await db.query(
    `SELECT p.id, p.uuid, p.sync_version, p.estado, p.gestion, p.nro_requerimiento, p.tipo_solicitud, p.prioridad, p.fecha_solicitud,
            p.oc_numero, p.oc_gestion, p.unidad_id, p.solicitante_id, p.actualizado_en,
            p.monto_estimado, p.moneda, p.tipo_cambio, p.requiere_oc, p.ne_numero,
            (SELECT c.proveedor FROM cotizaciones c WHERE c.proceso_id = p.id AND c.seleccionada LIMIT 1) AS proveedor_adjudicado,
            (SELECT SUM(cp.precio_unitario * it.cantidad) FROM cotizaciones c
               JOIN cotizacion_precios cp ON cp.cotizacion_id = c.id
               JOIN proceso_items it ON it.id = cp.item_id
             WHERE c.proceso_id = p.id AND c.seleccionada) AS total_adjudicado,
            u.sigla, u.nombre AS unidad_nombre, u.logo, u.color, s.nombre AS solicitante_nombre,
            d.nombre AS departamento_nombre,
            (SELECT it.descripcion FROM proceso_items it WHERE it.proceso_id = p.id ORDER BY it.nro LIMIT 1) AS primer_item,
            (SELECT COUNT(*)::int FROM proceso_items it WHERE it.proceso_id = p.id) AS total_items
     FROM procesos p
     JOIN unidades_negocio u ON u.id = p.unidad_id
     JOIN usuarios s ON s.id = p.solicitante_id
     LEFT JOIN departamentos d ON d.id = p.departamento_id
     WHERE ${condiciones.join(' AND ')}
     ORDER BY p.actualizado_en DESC
     LIMIT 300`,
    params,
  );
  return rows;
}

async function resumen(usuario) {
  const params = [];
  const cond = visibilidad(usuario, params);
  params.push(estadosConAccion(usuario));
  const { rows } = await db.query(
    `SELECT
       COUNT(*) FILTER (WHERE p.estado = ANY($${params.length}))::int AS pendientes,
       COUNT(*) FILTER (WHERE p.estado NOT IN ('CERRADO','CERRADO_STOCK','RECHAZADO','ANULADO'))::int AS en_curso,
       COUNT(*) FILTER (WHERE p.estado IN ('CERRADO','CERRADO_STOCK'))::int AS cerrados,
       COUNT(*)::int AS total
     FROM procesos p WHERE ${cond}`,
    params,
  );
  return rows[0];
}

// Cantidad de procesos con una acción pendiente del usuario (para el menú lateral)
async function contarPendientes(usuario) {
  const params = [];
  const cond = visibilidad(usuario, params);
  params.push(estadosConAccion(usuario));
  const { rows } = await db.query(
    `SELECT COUNT(*)::int AS n FROM procesos p WHERE ${cond} AND p.estado = ANY($${params.length})`,
    params,
  );
  return rows[0].n;
}

async function obtener(id, client = db) {
  const { rows } = await client.query(`${SELECT_PROCESO} WHERE p.id = $1`, [id]);
  return rows[0] || null;
}

async function obtenerCompleto(id) {
  const proceso = await obtener(id);
  if (!proceso) return null;
  const [items, cotizaciones, precios, firmas, eventos, adjuntos, formularios] = await Promise.all([
    db.query('SELECT * FROM proceso_items WHERE proceso_id=$1 ORDER BY nro', [id]),
    db.query(
      `SELECT c.*, pv.estado AS proveedor_estado, pv.ocasional AS proveedor_ocasional
       FROM cotizaciones c LEFT JOIN proveedores pv ON pv.id = c.proveedor_id WHERE c.proceso_id=$1 ORDER BY c.orden`,
      [id],
    ),
    db.query(
      `SELECT cp.* FROM cotizacion_precios cp JOIN cotizaciones c ON c.id = cp.cotizacion_id WHERE c.proceso_id=$1`,
      [id],
    ),
    db.query('SELECT * FROM firmas WHERE proceso_id=$1 ORDER BY fecha', [id]),
    db.query(
      `SELECT e.*, us.nombre AS usuario_nombre FROM proceso_eventos e LEFT JOIN usuarios us ON us.id = e.usuario_id
       WHERE e.proceso_id=$1 ORDER BY e.fecha, e.id`,
      [id],
    ),
    db.query(
      `SELECT a.*, us.nombre AS usuario_nombre FROM adjuntos a LEFT JOIN usuarios us ON us.id = a.usuario_id
       WHERE a.proceso_id=$1 ORDER BY a.fecha`,
      [id],
    ),
    formularioModel.porUnidad(proceso.unidad_id),
  ]);

  proceso.items = items.rows;
  proceso.cotizaciones = cotizaciones.rows.map((c) => {
    const preciosCot = {};
    precios.rows.filter((pr) => String(pr.cotizacion_id) === String(c.id))
      .forEach((pr) => { preciosCot[pr.item_id] = Number(pr.precio_unitario); });
    const total = proceso.items.reduce((s, it) => s + (preciosCot[it.id] || 0) * Number(it.cantidad), 0);
    const puntaje = Object.values(c.criterios || {}).reduce((s, v) => s + (Number(v) || 0), 0);
    return { ...c, precios: preciosCot, total, puntaje };
  });
  proceso.seleccionada = proceso.cotizaciones.find((c) => c.seleccionada) || null;
  proceso.firmas = {};
  firmas.rows.forEach((f) => { proceso.firmas[`${f.documento}.${f.tipo}`] = f; });
  proceso.eventos = eventos.rows;
  proceso.adjuntos = adjuntos.rows;
  proceso.formularios = formularios;
  return proceso;
}

// ctx (opcional) = { origen: 'WEB' | 'MOVIL', fechaCliente }: de dónde vino la acción y la hora del teléfono
function origen(ctx) { return ctx && ctx.origen === 'MOVIL' ? 'MOVIL' : 'WEB'; }
function fechaCliente(ctx) { return (ctx && ctx.fechaCliente) || null; }

// Cambia de estado solo si el proceso sigue en el estado esperado (evita dobles aprobaciones)
async function transicion(client, id, desde, hacia, usuarioId, accion, comentario = '', ctx = {}) {
  const lista = [].concat(desde);
  const { rowCount } = await client.query(
    'UPDATE procesos SET estado=$1, actualizado_en=NOW() WHERE id=$2 AND estado = ANY($3)',
    [hacia, id, lista],
  );
  if (!rowCount) throw new ErrorFlujo();
  await evento(client, id, usuarioId, accion, comentario, hacia, ctx);
}

async function evento(client, id, usuarioId, accion, comentario = '', estadoNuevo = null, ctx = {}) {
  await client.query(
    `INSERT INTO proceso_eventos (proceso_id, usuario_id, accion, comentario, estado_nuevo, origen, fecha_cliente)
     VALUES ($1,$2,$3,$4,$5,$6,$7)`,
    [id, usuarioId, accion, comentario || '', estadoNuevo, origen(ctx), fechaCliente(ctx)],
  );
  if (!estadoNuevo) await client.query('UPDATE procesos SET actualizado_en=NOW() WHERE id=$1', [id]);
}

async function firmar(client, id, documento, tipo, usuario, ctx = {}) {
  await client.query(
    `INSERT INTO firmas (proceso_id, documento, tipo, usuario_id, nombre, cargo, origen, fecha_cliente)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
     ON CONFLICT (proceso_id, documento, tipo)
     DO UPDATE SET usuario_id=EXCLUDED.usuario_id, nombre=EXCLUDED.nombre, cargo=EXCLUDED.cargo, fecha=NOW(),
                   origen=EXCLUDED.origen, fecha_cliente=EXCLUDED.fecha_cliente`,
    [id, documento, tipo, usuario.id, usuario.nombre, usuario.cargo || usuario.rol_nombre, origen(ctx), fechaCliente(ctx)],
  );
}

async function quitarFirma(client, id, documento, tipo) {
  await client.query('DELETE FROM firmas WHERE proceso_id=$1 AND documento=$2 AND tipo=$3', [id, documento, tipo]);
}

async function actualizar(client, id, campos) {
  const claves = Object.keys(campos);
  if (!claves.length) return;
  const sets = claves.map((c, i) => `${c}=$${i + 1}`);
  await client.query(
    `UPDATE procesos SET ${sets.join(', ')}, actualizado_en=NOW() WHERE id=$${claves.length + 1}`,
    [...claves.map((c) => campos[c]), id],
  );
}

// a.uuid (opcional) lo envía la app móvil para que la subida sea idempotente
async function agregarAdjuntos(id, etapa, archivos, usuarioId) {
  for (const a of archivos) {
    await db.query(
      `INSERT INTO adjuntos (proceso_id, etapa, nombre_original, archivo, mime, tamano, usuario_id, uuid)
       VALUES ($1,$2,$3,$4,$5,$6,$7, COALESCE($8::uuid, gen_random_uuid()))`,
      [id, etapa, a.originalname.slice(0, 250), a.filename, a.mimetype, a.size, usuarioId, a.uuid || null],
    );
  }
}

async function obtenerAdjunto(id) {
  const { rows } = await db.query('SELECT * FROM adjuntos WHERE id=$1', [id]);
  return rows[0] || null;
}

async function obtenerAdjuntoPorUuid(uuid) {
  const { rows } = await db.query('SELECT * FROM adjuntos WHERE uuid=$1', [uuid]);
  return rows[0] || null;
}

// ===================== Sincronización con la app móvil =====================
async function idPorUuid(uuid) {
  const { rows } = await db.query('SELECT id FROM procesos WHERE uuid=$1', [uuid]);
  return rows[0] ? Number(rows[0].id) : null;
}

// Excluye procesos finalizados que no cambian desde "cerradosDesde" (para no llenar el teléfono con historial)
function filtroCerrados(params, cerradosDesde) {
  if (!cerradosDesde) return 'TRUE';
  params.push(cerradosDesde);
  return `(p.estado NOT IN ('CERRADO','CERRADO_STOCK','RECHAZADO','ANULADO') OR p.actualizado_en >= $${params.length}::date)`;
}

// Ids de los procesos visibles con versión mayor a "desde", en orden de versión
async function cambiosDesde(usuario, desde, limite, cerradosDesde = null) {
  const params = [];
  const cond = [visibilidad(usuario, params), filtroCerrados(params, cerradosDesde)];
  params.push(desde);
  cond.push(`p.sync_version > $${params.length}`);
  params.push(limite);
  const { rows } = await db.query(
    `SELECT p.id, p.sync_version FROM procesos p WHERE ${cond.join(' AND ')} ORDER BY p.sync_version LIMIT $${params.length}`,
    params,
  );
  return rows.map((r) => ({ id: Number(r.id), sync_version: Number(r.sync_version) }));
}

async function visibles(usuario, cerradosDesde = null) {
  const params = [];
  const cond = [visibilidad(usuario, params), filtroCerrados(params, cerradosDesde)];
  const { rows } = await db.query(`SELECT p.uuid, p.sync_version FROM procesos p WHERE ${cond.join(' AND ')} ORDER BY p.id`, params);
  return rows.map((r) => ({ uuid: r.uuid, sync_version: Number(r.sync_version) }));
}

async function eliminarAdjunto(id) {
  await db.query('DELETE FROM adjuntos WHERE id=$1', [id]);
}

module.exports = {
  visibilidad, puedeVer, estadosConAccion, listar, resumen, contarPendientes, obtener, obtenerCompleto, transicion, evento,
  firmar, quitarFirma, actualizar, agregarAdjuntos, obtenerAdjunto, obtenerAdjuntoPorUuid, eliminarAdjunto,
  idPorUuid, cambiosDesde, visibles,
};
