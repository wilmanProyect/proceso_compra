// Registro común de proveedores (todas las unidades de negocio) — RV.PCOM.02
const db = require('../config/db');

const CAMPOS = ['razon_social', 'nombre_comercial', 'nit', 'direccion', 'ciudad', 'telefono', 'email', 'contacto',
  'cuenta_bancaria', 'banco', 'tipo_suministro', 'clasificacion'];

async function listar(filtros = {}) {
  const params = [];
  const cond = ['TRUE'];
  if (filtros.estados && filtros.estados.length) { params.push(filtros.estados); cond.push(`p.estado = ANY($${params.length})`); }
  if (filtros.clasificacion) { params.push(filtros.clasificacion); cond.push(`p.clasificacion = $${params.length}`); }
  if (filtros.vencidos) cond.push("p.proxima_reevaluacion <= (NOW() AT TIME ZONE 'America/La_Paz')::date AND p.estado <> 'RETIRADO'");
  if (filtros.q) {
    params.push(`%${filtros.q}%`);
    const i = params.length;
    cond.push(`(p.razon_social ILIKE $${i} OR p.nombre_comercial ILIKE $${i} OR p.nit ILIKE $${i} OR p.tipo_suministro ILIKE $${i})`);
  }
  const { rows } = await db.query(
    `SELECT p.*,
            (SELECT COUNT(*)::int FROM proveedor_incidencias i WHERE i.proveedor_id = p.id
               AND i.fecha > COALESCE(p.fecha_evaluacion, '-infinity'::date)) AS incidencias_pendientes,
            (SELECT e.estado FROM proveedor_evaluaciones e WHERE e.proveedor_id = p.id AND e.estado <> 'APROBADA'
               ORDER BY e.id DESC LIMIT 1) AS evaluacion_en_curso
     FROM proveedores p
     WHERE ${cond.join(' AND ')}
     ORDER BY lower(p.razon_social)`,
    params,
  );
  return rows;
}

// Proveedores para elegir en el cuadro comparativo (no incluye No aprobados, Suspendidos ni Retirados)
async function elegibles(estados) {
  const { rows } = await db.query(
    `SELECT id, razon_social, nombre_comercial, nit, contacto, telefono, estado, clasificacion, ocasional
     FROM proveedores WHERE estado = ANY($1) ORDER BY lower(razon_social)`,
    [estados],
  );
  return rows;
}

async function obtener(id, client = db) {
  const { rows } = await client.query(
    `SELECT p.*, u.nombre AS creado_por_nombre FROM proveedores p LEFT JOIN usuarios u ON u.id = p.creado_por WHERE p.id=$1`,
    [id],
  );
  return rows[0] || null;
}

async function porNit(nit, client = db) {
  if (!nit) return null;
  const { rows } = await client.query('SELECT * FROM proveedores WHERE lower(nit) = lower($1) AND nit <> \'\'', [nit]);
  return rows[0] || null;
}

async function porNombre(nombre, client = db) {
  const { rows } = await client.query('SELECT * FROM proveedores WHERE lower(razon_social) = lower($1) ORDER BY id LIMIT 1', [nombre]);
  return rows[0] || null;
}

async function crear(client, datos, usuarioId) {
  const valores = CAMPOS.map((c) => datos[c]);
  const { rows } = await client.query(
    `INSERT INTO proveedores (${CAMPOS.join(', ')}, ocasional, creado_por)
     VALUES (${CAMPOS.map((_, i) => `$${i + 1}`).join(', ')}, $${CAMPOS.length + 1}, $${CAMPOS.length + 2}) RETURNING *`,
    [...valores, Boolean(datos.ocasional), usuarioId],
  );
  return rows[0];
}

async function actualizar(client, id, datos) {
  const claves = Object.keys(datos);
  if (!claves.length) return;
  await client.query(
    `UPDATE proveedores SET ${claves.map((c, i) => `${c}=$${i + 1}`).join(', ')}, actualizado_en=NOW() WHERE id=$${claves.length + 1}`,
    [...claves.map((c) => datos[c]), id],
  );
}

async function evento(client, proveedorId, usuarioId, accion, comentario = '') {
  await client.query(
    'INSERT INTO proveedor_eventos (proveedor_id, usuario_id, accion, comentario) VALUES ($1,$2,$3,$4)',
    [proveedorId, usuarioId, accion, comentario || ''],
  );
}

async function incidencia(client, proveedorId, { procesoId = null, tipo, descripcion, usuarioId }) {
  await client.query(
    'INSERT INTO proveedor_incidencias (proveedor_id, proceso_id, tipo, descripcion, usuario_id) VALUES ($1,$2,$3,$4,$5)',
    [proveedorId, procesoId, tipo, descripcion, usuarioId],
  );
}

// Ficha completa: datos, evaluaciones, incidencias, documentos, historial y compras en las que participó
async function ficha(id) {
  const proveedor = await obtener(id);
  if (!proveedor) return null;
  const [evaluaciones, incidencias, adjuntos, eventos, compras] = await Promise.all([
    db.query(
      `SELECT e.*, u.sigla, u.nombre AS unidad_nombre FROM proveedor_evaluaciones e
       JOIN unidades_negocio u ON u.id = e.unidad_id WHERE e.proveedor_id=$1 ORDER BY e.fecha_evaluacion DESC, e.id DESC`,
      [id],
    ),
    db.query(
      `SELECT i.*, us.nombre AS usuario_nombre, pr.nro_requerimiento, un.sigla
       FROM proveedor_incidencias i
       LEFT JOIN usuarios us ON us.id = i.usuario_id
       LEFT JOIN procesos pr ON pr.id = i.proceso_id
       LEFT JOIN unidades_negocio un ON un.id = pr.unidad_id
       WHERE i.proveedor_id=$1 ORDER BY i.fecha DESC`,
      [id],
    ),
    db.query(
      `SELECT a.*, us.nombre AS usuario_nombre FROM proveedor_adjuntos a LEFT JOIN usuarios us ON us.id = a.usuario_id
       WHERE a.proveedor_id=$1 ORDER BY a.fecha DESC`,
      [id],
    ),
    db.query(
      `SELECT e.*, us.nombre AS usuario_nombre FROM proveedor_eventos e LEFT JOIN usuarios us ON us.id = e.usuario_id
       WHERE e.proveedor_id=$1 ORDER BY e.fecha DESC, e.id DESC`,
      [id],
    ),
    db.query(
      `SELECT pr.id, pr.nro_requerimiento, pr.estado, pr.fecha_solicitud, pr.oc_numero, pr.solicitante_id, pr.unidad_id,
              un.sigla, un.nombre AS unidad_nombre, c.seleccionada
       FROM cotizaciones c JOIN procesos pr ON pr.id = c.proceso_id JOIN unidades_negocio un ON un.id = pr.unidad_id
       WHERE c.proveedor_id=$1 ORDER BY pr.fecha_solicitud DESC, pr.id DESC LIMIT 50`,
      [id],
    ),
  ]);
  return {
    ...proveedor,
    evaluaciones: evaluaciones.rows,
    incidencias: incidencias.rows,
    adjuntos: adjuntos.rows,
    eventos: eventos.rows,
    compras: compras.rows,
  };
}

// ---------- Evaluaciones ----------
async function obtenerEvaluacion(id, client = db) {
  const { rows } = await client.query(
    `SELECT e.*, p.razon_social, p.nombre_comercial, p.nit, p.direccion, p.ciudad, p.email, p.telefono, p.tipo_suministro,
            p.clasificacion, p.estado AS proveedor_estado,
            u.sigla, u.nombre AS unidad_nombre, u.logo, u.codigo_revision
     FROM proveedor_evaluaciones e
     JOIN proveedores p ON p.id = e.proveedor_id
     JOIN unidades_negocio u ON u.id = e.unidad_id
     WHERE e.id=$1`,
    [id],
  );
  return rows[0] || null;
}

async function evaluacionAbierta(proveedorId) {
  const { rows } = await db.query(
    "SELECT id FROM proveedor_evaluaciones WHERE proveedor_id=$1 AND estado <> 'APROBADA' ORDER BY id DESC LIMIT 1",
    [proveedorId],
  );
  return rows[0] || null;
}

async function tieneEvaluacionAprobada(proveedorId) {
  const { rows } = await db.query(
    "SELECT 1 FROM proveedor_evaluaciones WHERE proveedor_id=$1 AND estado = 'APROBADA' LIMIT 1",
    [proveedorId],
  );
  return rows.length > 0;
}

// Incidencias desde la última evaluación aprobada (información de entrada para evaluar, 4.6)
async function incidenciasDesde(proveedorId, fecha) {
  const { rows } = await db.query(
    `SELECT i.*, pr.nro_requerimiento, un.sigla FROM proveedor_incidencias i
     LEFT JOIN procesos pr ON pr.id = i.proceso_id LEFT JOIN unidades_negocio un ON un.id = pr.unidad_id
     WHERE i.proveedor_id=$1 AND i.fecha > COALESCE($2::date, '-infinity'::date) ORDER BY i.fecha DESC`,
    [proveedorId, fecha],
  );
  return rows;
}

// ---------- Tareas para "Mis tareas" ----------
async function tareas(usuario) {
  const puede = (p) => usuario.permisos.includes(p);
  const resultado = { porAprobar: [], devueltas: [], vencidos: [] };
  const consultas = [];
  if (puede('proveedores.aprobar')) {
    consultas.push(db.query(
      `SELECT e.id, e.fecha_evaluacion, e.promedio, e.resultado, e.evaluador_nombre, e.tipo, p.id AS proveedor_id, p.razon_social
       FROM proveedor_evaluaciones e JOIN proveedores p ON p.id = e.proveedor_id
       WHERE e.estado = 'POR_APROBAR' AND e.evaluador_id <> $1 ORDER BY e.enviado_en`,
      [usuario.id],
    ).then((r) => { resultado.porAprobar = r.rows; }));
  }
  if (puede('proveedores.gestionar')) {
    consultas.push(db.query(
      `SELECT e.id, e.observacion_aprobador, p.id AS proveedor_id, p.razon_social
       FROM proveedor_evaluaciones e JOIN proveedores p ON p.id = e.proveedor_id
       WHERE e.estado = 'BORRADOR' AND e.evaluador_id = $1 AND e.observacion_aprobador <> '' ORDER BY e.actualizado_en DESC`,
      [usuario.id],
    ).then((r) => { resultado.devueltas = r.rows; }));
    consultas.push(db.query(
      `SELECT p.id, p.razon_social, p.clasificacion, p.proxima_reevaluacion, p.estado
       FROM proveedores p
       WHERE p.proxima_reevaluacion <= (NOW() AT TIME ZONE 'America/La_Paz')::date AND p.estado <> 'RETIRADO'
         AND NOT EXISTS (SELECT 1 FROM proveedor_evaluaciones e WHERE e.proveedor_id = p.id AND e.estado <> 'APROBADA')
       ORDER BY p.proxima_reevaluacion`,
    ).then((r) => { resultado.vencidos = r.rows; }));
  }
  await Promise.all(consultas);
  return resultado;
}

async function contarTareas(usuario) {
  const t = await tareas(usuario);
  return t.porAprobar.length + t.devueltas.length + t.vencidos.length;
}

// ---------- Adjuntos ----------
async function agregarAdjuntos(proveedorId, tipoDoc, archivos, usuarioId) {
  for (const a of archivos) {
    await db.query(
      `INSERT INTO proveedor_adjuntos (proveedor_id, tipo_doc, nombre_original, archivo, mime, tamano, usuario_id)
       VALUES ($1,$2,$3,$4,$5,$6,$7)`,
      [proveedorId, tipoDoc, a.originalname.slice(0, 250), a.filename, a.mimetype, a.size, usuarioId],
    );
  }
}

async function obtenerAdjunto(id) {
  const { rows } = await db.query('SELECT * FROM proveedor_adjuntos WHERE id=$1', [id]);
  return rows[0] || null;
}

async function eliminarAdjunto(id) {
  await db.query('DELETE FROM proveedor_adjuntos WHERE id=$1', [id]);
}

module.exports = {
  CAMPOS, listar, elegibles, obtener, porNit, porNombre, crear, actualizar, evento, incidencia, ficha,
  obtenerEvaluacion, evaluacionAbierta, tieneEvaluacionAprobada, incidenciasDesde, tareas, contarTareas,
  agregarAdjuntos, obtenerAdjunto, eliminarAdjunto,
};
