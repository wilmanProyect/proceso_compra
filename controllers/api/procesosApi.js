// /api/v1: catálogos, procesos, acciones en línea, sincronización y adjuntos para la app móvil
const crypto = require('crypto');
const db = require('../../config/db');
const procesoModel = require('../../models/procesoModel');
const unidadModel = require('../../models/unidadModel');
const procesoService = require('../../services/procesoService');
const adjuntoService = require('../../services/adjuntoService');
const C = require('../../utils/constantes');
const fmt = require('../../utils/formato');
const { texto, opcion, fecha } = require('../../utils/entrada');
const { EXT_ADJUNTOS, MAX_ADJUNTO_BYTES } = require('../../middlewares/subidas');
const {
  uuid, error, api, proceso: serializar, adjunto: serializarAdjunto,
} = require('./comun');
const { perfil } = require('./authApi');
const op = require('./operaciones');

const MAX_OPERACIONES = 50;

// ===================== Catálogos =====================
// Todo lo necesario para trabajar sin conexión. ETag: si no cambió responde 304.
// El ETag incluye permisos y unidades del usuario: si cambia, la app debe hacer un pull completo (desde=0).
const catalogos = api(async (req, res) => {
  const unidades = await procesoService.unidadesPermitidas(req.usuario);
  const ids = unidades.map((u) => u.id);
  const [departamentos, formularios] = await Promise.all([
    unidadModel.departamentosActivos(),
    db.query(
      `SELECT unidad_id, clave AS tipo, codigo, version AS revision, version, titulo, to_char(fecha, 'DD/MM/YYYY') AS fecha
       FROM formularios WHERE clave IS NOT NULL AND unidad_id = ANY($1) ORDER BY unidad_id, clave`,
      [ids],
    ),
  ]);
  const cuerpo = {
    usuario: perfil(req.usuario),
    unidades: unidades.map((u) => ({
      id: u.id, sigla: u.sigla, nombre: u.nombre, razon_social: u.razon_social, nit: u.nit, direccion: u.direccion, telefono: u.telefono,
      logo_url: u.logo ? `/img/${u.logo}` : null, codigo_revision: u.codigo_revision, lugar_entrega: u.lugar_entrega,
      lugar_cobranza: u.lugar_cobranza, datos_factura: u.datos_factura, notas_oc: u.notas_oc,
    })),
    departamentos: departamentos.filter((d) => ids.includes(d.unidad_id)),
    formularios: formularios.rows,
    constantes: {
      estados: C.ESTADOS,
      estados_finales: C.ESTADOS_FINALES,
      pasos: C.PASOS,
      tipos_solicitud: C.TIPOS_SOLICITUD,
      prioridades: C.PRIORIDADES,
      monedas: C.MONEDAS,
      tipos_bien: C.TIPOS_BIEN,
      estados_inspeccion: C.ESTADOS_INSPECCION,
      criterios: C.CRITERIOS,
      formularios: C.FORMULARIOS,
      etapas_adjunto: C.ETAPAS_ADJUNTO,
      escala_cotizaciones: [[1000, 0], [3000, 1], [20000, 2], [null, 3]],
      tipo_cambio_defecto: 6.96,
      tipos_operacion: op.TIPOS_VALIDOS,
      operaciones_solo_en_linea: op.TIPOS_SOLO_EN_LINEA,
      adjuntos: { extensiones: EXT_ADJUNTOS, max_bytes: MAX_ADJUNTO_BYTES },
    },
  };
  const etag = `"${crypto.createHash('sha1').update(JSON.stringify(cuerpo)).digest('hex')}"`;
  res.setHeader('ETag', etag);
  res.setHeader('Cache-Control', 'private, no-cache');
  if (req.get('if-none-match') === etag) return res.status(304).end();
  return res.json(cuerpo);
});

// ===================== Procesos (lectura en línea) =====================
async function cargarVisible(usuario, procesoUuid) {
  const id = uuid(procesoUuid) && await procesoModel.idPorUuid(uuid(procesoUuid));
  const p = id ? await procesoModel.obtenerCompleto(id) : null;
  if (!p || !procesoModel.puedeVer(usuario, p)) return null; // no se distingue "no existe" de "no puede verlo"
  return p;
}

const listar = api(async (req, res) => {
  const q = req.query;
  const filas = await procesoModel.listar(req.usuario, {
    unidad: Number(q.unidad) || null,
    estado: opcion(q.estado, C.ESTADOS),
    gestion: Number(q.gestion) || null,
    q: texto(q.q, 100),
    pendientes: q.vista === 'pendientes',
    mios: q.vista === 'mios',
  });
  res.json({
    procesos: filas.map((p) => ({
      id: Number(p.id), uuid: p.uuid, sync_version: Number(p.sync_version), codigo: fmt.codigoRequerimiento(p),
      codigo_oc: fmt.codigoOc(p) || null, estado: p.estado, tipo_solicitud: p.tipo_solicitud, prioridad: p.prioridad,
      fecha_solicitud: p.fecha_solicitud, unidad_id: p.unidad_id, sigla: p.sigla, unidad_nombre: p.unidad_nombre,
      solicitante_id: Number(p.solicitante_id), solicitante_nombre: p.solicitante_nombre, departamento_nombre: p.departamento_nombre,
      primer_item: p.primer_item, total_items: p.total_items, proveedor_adjudicado: p.proveedor_adjudicado,
      total_adjudicado: p.total_adjudicado === null ? null : Number(p.total_adjudicado), moneda: p.moneda, actualizado_en: p.actualizado_en,
    })),
  });
});

const obtener = api(async (req, res) => {
  const p = await cargarVisible(req.usuario, req.params.uuid);
  if (!p) return error(res, 404, 'NO_ENCONTRADO', 'No se encontró el proceso.');
  return res.json({ proceso: serializar(p, req.usuario) });
});

// ===================== Acciones en línea =====================
const ESTADO_HTTP = {
  VALIDACION: 422, NO_ENCONTRADO: 404, SIN_ACCESO: 404, ACCION_NO_DISPONIBLE: 403, TIPO_INVALIDO: 422, OP_AJENA: 409,
};

async function responderOperacion(req, res, resultado, estadoOk) {
  let status = estadoOk;
  if (resultado.estado === 'CONFLICTO') status = 409;
  else if (resultado.estado === 'RECHAZADA') status = ESTADO_HTTP[resultado.error.codigo] || 422;
  const cuerpo = { resultado };
  if (resultado.proceso) {
    const p = await procesoModel.obtenerCompleto(resultado.proceso.id);
    if (p) cuerpo.proceso = serializar(p, req.usuario);
  }
  return res.status(status).json(cuerpo);
}

// POST /procesos  { op_id?, proceso_uuid?, creada_en?, datos }  → crea la solicitud con conexión
const crear = api(async (req, res) => {
  const b = req.body || {};
  const resultado = await op.aplicar(req.usuario, req.dispositivoId, {
    ...b, tipo: op.TIPO_CREAR, proceso_uuid: uuid(b.proceso_uuid) || crypto.randomUUID(),
  }, { enLinea: true });
  return responderOperacion(req, res, resultado, 201);
});

// POST /procesos/:uuid/acciones  { op_id?, tipo, estado_esperado, creada_en?, datos }
// Único camino para las aprobaciones (requieren conexión).
const accion = api(async (req, res) => {
  const b = req.body || {};
  if (b.tipo === op.TIPO_CREAR) return error(res, 422, 'TIPO_INVALIDO', 'Use POST /procesos para crear solicitudes.');
  const resultado = await op.aplicar(req.usuario, req.dispositivoId, { ...b, proceso_uuid: req.params.uuid }, { enLinea: true });
  return responderOperacion(req, res, resultado, 200);
});

// ===================== Sincronización =====================
// POST /sync/push { operaciones: [...] } en orden. Si una operación de un proceso falla, las siguientes del mismo
// proceso se omiten (dependen de ella); las de otros procesos continúan.
const push = api(async (req, res) => {
  const operaciones = req.body && req.body.operaciones;
  if (!Array.isArray(operaciones)) return error(res, 422, 'VALIDACION', 'Envíe "operaciones" como lista.');
  if (operaciones.length > MAX_OPERACIONES) return error(res, 413, 'LOTE_GRANDE', `Máximo ${MAX_OPERACIONES} operaciones por envío.`);
  const bloqueados = new Set();
  const resultados = [];
  for (const o of operaciones) {
    const puuid = uuid(o && o.proceso_uuid);
    let r;
    if (puuid && bloqueados.has(puuid)) {
      r = {
        op_id: (o && o.op_id) || null,
        estado: 'OMITIDA',
        error: { codigo: 'OPERACION_ANTERIOR_FALLIDA', mensaje: 'Una operación anterior de este proceso no se aplicó.' },
      };
    } else {
      try {
        r = await op.aplicar(req.usuario, req.dispositivoId, o, { enLinea: false });
      } catch (e) {
        console.error('Error al aplicar operación de sincronización:', e);
        r = { op_id: (o && o.op_id) || null, estado: 'ERROR', error: { codigo: 'ERROR', mensaje: 'Error interno; se reintentará.' } };
      }
    }
    if (r.estado !== 'APLICADA' && puuid) bloqueados.add(puuid);
    resultados.push(r);
  }
  res.json({ resultados });
});

function cerradosDesde(q) { return fecha(q.cerrados_desde); }

// GET /sync/pull?desde=<cursor>&limite=50&cerrados_desde=YYYY-MM-DD
// Procesos visibles con sync_version > desde. Al iniciar cada ciclo la app debe pedir desde (cursor - 1000)
// para recuperar cambios que se confirmaron fuera de orden (el upsert por uuid es idempotente).
const pull = api(async (req, res) => {
  const desde = Math.max(0, Math.floor(Number(req.query.desde) || 0));
  const limite = Math.min(100, Math.max(1, Math.floor(Number(req.query.limite) || 50)));
  const filas = await procesoModel.cambiosDesde(req.usuario, desde, limite + 1, cerradosDesde(req.query));
  const pagina = filas.slice(0, limite);
  const procesos = [];
  for (const f of pagina) {
    const p = await procesoModel.obtenerCompleto(f.id);
    if (p) procesos.push(serializar(p, req.usuario));
  }
  res.json({
    procesos,
    cursor: pagina.length ? pagina[pagina.length - 1].sync_version : desde,
    hay_mas: filas.length > limite,
  });
});

// GET /sync/visibles → uuid y versión de todo lo que el usuario puede ver (para borrar del teléfono lo que ya no)
const visibles = api(async (req, res) => {
  res.json({ procesos: await procesoModel.visibles(req.usuario, cerradosDesde(req.query)) });
});

// ===================== Adjuntos =====================
// POST /procesos/:uuid/adjuntos  multipart: archivo, uuid (del adjunto, generado por la app), etapa. Idempotente por uuid.
const subirAdjunto = api(async (req, res) => {
  const archivo = req.file;
  const descartar = () => adjuntoService.borrarArchivos([archivo]);
  try {
    if (!archivo) return error(res, 422, 'VALIDACION', 'Falta el archivo (campo "archivo").');
    const adjUuid = uuid(req.body.uuid);
    if (!adjUuid) { descartar(); return error(res, 422, 'VALIDACION', 'Falta el uuid del adjunto.'); }
    const p = await cargarVisible(req.usuario, req.params.uuid);
    if (!p) { descartar(); return error(res, 404, 'NO_ENCONTRADO', 'No se encontró el proceso.'); }

    const existente = await procesoModel.obtenerAdjuntoPorUuid(adjUuid);
    if (existente) {
      descartar();
      if (String(existente.proceso_id) !== String(p.id)) return error(res, 409, 'UUID_EN_USO', 'Ese uuid de adjunto ya está en uso.');
      return res.status(200).json({ adjunto: serializarAdjunto(existente), repetido: true });
    }
    if (!adjuntoService.puedeAdjuntar(p)) { descartar(); return error(res, 422, 'PROCESO_FINALIZADO', 'No se pueden adjuntar archivos a un proceso finalizado.'); }

    archivo.uuid = adjUuid;
    await adjuntoService.agregar(p, opcion(req.body.etapa, C.ETAPAS_ADJUNTO, 'SOLICITUD'), [archivo], req.usuario, { origen: 'MOVIL' });
    const creado = await procesoModel.obtenerAdjuntoPorUuid(adjUuid);
    return res.status(201).json({ adjunto: serializarAdjunto({ ...creado, usuario_nombre: req.usuario.nombre }) });
  } catch (e) {
    descartar();
    throw e;
  }
});

async function adjuntoVisible(usuario, adjUuid) {
  const a = uuid(adjUuid) && await procesoModel.obtenerAdjuntoPorUuid(uuid(adjUuid));
  if (!a) return {};
  const p = await procesoModel.obtener(a.proceso_id);
  if (!p || !procesoModel.puedeVer(usuario, p)) return {};
  return { a, p };
}

const descargarAdjunto = api(async (req, res) => {
  const { a } = await adjuntoVisible(req.usuario, req.params.uuid);
  if (!a) return error(res, 404, 'NO_ENCONTRADO', 'No se encontró el archivo.');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  return res.download(adjuntoService.ruta(a), a.nombre_original);
});

const eliminarAdjunto = api(async (req, res) => {
  const { a, p } = await adjuntoVisible(req.usuario, req.params.uuid);
  if (!a) return error(res, 404, 'NO_ENCONTRADO', 'No se encontró el archivo.');
  if (!adjuntoService.puedeEliminar(req.usuario, a, p)) {
    return error(res, 403, 'ACCION_NO_DISPONIBLE', 'Solo quien subió el archivo puede eliminarlo, y únicamente mientras el proceso está en curso.');
  }
  await adjuntoService.eliminar(a, p, req.usuario, { origen: 'MOVIL' });
  return res.json({ ok: true });
});

module.exports = {
  catalogos, listar, obtener, crear, accion, push, pull, visibles, subirAdjunto, descargarAdjunto, eliminarAdjunto,
};
