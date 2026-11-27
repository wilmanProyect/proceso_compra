// Aplicación de operaciones de la app móvil (docs/APP_MOVIL.md §7.3).
// Una operación = { op_id, tipo, proceso_uuid, estado_esperado, creada_en, datos }.
// La usan /sync/push (cola sin conexión) y las acciones en línea; es idempotente por op_id.
const db = require('../../config/db');
const procesoModel = require('../../models/procesoModel');
const procesoService = require('../../services/procesoService');
const flujoService = require('../../services/flujoService');
const C = require('../../utils/constantes');
const fmt = require('../../utils/formato');
const {
  ErrorValidacion, ErrorFlujo, ErrorNegocio,
} = require('../../utils/errores');
const { uuid } = require('./comun');

// tipo de operación → acción de services/flujoService.js
const TIPOS = {
  ANULAR: 'anular',
  APROBAR_SOLICITUD: 'aprobarSolicitud',
  GUARDAR_CUADRO: 'guardarCuadro',
  EXCEPCION_COTIZACIONES: 'desbloquear',
  APROBAR_CUADRO: 'aprobarCuadro',
  GUARDAR_OC: 'guardarOc',
  AUTORIZAR_OC: 'autorizarOc',
  SEGUIMIENTO: 'seguimiento',
  CERRAR_SERVICIO: 'cerrarServicio',
  GUARDAR_RECEPCION: 'guardarRecepcion', // enviar=true pasa directo a EN_ALMACEN (emitir nota de entrega)
  ENTREGA: 'entrega', // entregar=true emite la nota de entrega y cierra el proceso
  CONFIRMAR_ENTREGA: 'confirmarEntrega',
};
const TIPO_CREAR = 'CREAR_SOLICITUD';
const TIPOS_VALIDOS = [TIPO_CREAR, ...Object.keys(TIPOS)];
const TIPOS_SOLO_EN_LINEA = Object.keys(TIPOS).filter((t) => flujoService.ACCIONES[TIPOS[t]].soloEnLinea);

// { clave: valor } con clave = uuid o id de ítem → { idItem: valor }
function porItem(p, objeto) {
  const mapa = {};
  p.items.forEach((it) => { mapa[String(it.uuid)] = it.id; mapa[String(it.id)] = it.id; });
  const r = {};
  Object.entries(objeto && typeof objeto === 'object' ? objeto : {}).forEach(([k, v]) => {
    const id = mapa[String(k).toLowerCase()];
    if (id) r[id] = v;
  });
  return r;
}

// La app identifica los ítems por uuid; los servicios, por id
const TRADUCIR = {
  guardarCuadro: (p, d) => ({
    ...d,
    cotizaciones: [].concat(d.cotizaciones || []).map((c) => ({ ...c, precios: porItem(p, c && c.precios) })),
  }),
  guardarRecepcion: (p, d) => ({ ...d, items: porItem(p, d.items) }),
  entrega: (p, d) => ({ ...d, items: porItem(p, d.items) }),
};

// Resumen del proceso para la respuesta, solo si el usuario puede verlo
async function resumen(usuario, id) {
  const { rows } = await db.query(
    `SELECT p.id, p.uuid, p.estado, p.sync_version, p.nro_requerimiento, p.oc_numero, p.ne_numero, p.solicitante_id, p.unidad_id, u.sigla
     FROM procesos p JOIN unidades_negocio u ON u.id = p.unidad_id WHERE p.id=$1`,
    [id],
  );
  const p = rows[0];
  if (!p || !procesoModel.puedeVer(usuario, p)) return null;
  return {
    id: Number(p.id), uuid: p.uuid, estado: p.estado, sync_version: Number(p.sync_version),
    codigo: fmt.codigoRequerimiento(p), codigo_oc: fmt.codigoOc(p) || null, codigo_ne: fmt.codigoNotaEntrega(p) || null,
  };
}

function fechaCliente(v) {
  const d = v ? new Date(v) : null;
  return d && !Number.isNaN(d.getTime()) ? d.toISOString() : null;
}

async function guardar(usuario, dispositivoId, op, resultado) {
  await db.query(
    `INSERT INTO sync_operaciones (op_id, usuario_id, dispositivo_id, tipo, proceso_uuid, estado, respuesta, creada_cliente)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8) ON CONFLICT (op_id) DO NOTHING`,
    [resultado.op_id, usuario.id, dispositivoId, op.tipo, uuid(op.proceso_uuid), resultado.estado, resultado, fechaCliente(op.creada_en)],
  );
}

function rechazo(opId, codigo, mensaje, detalles) {
  return { op_id: opId, estado: 'RECHAZADA', error: { codigo, mensaje, ...(detalles ? { detalles } : {}) } };
}

// enLinea: la app la envía con conexión, directo (no desde la cola). Las aprobaciones solo se aceptan así.
// Devuelve el resultado; lanza solo errores inesperados (el llamador responde ERROR y la app reintenta).
async function aplicar(usuario, dispositivoId, op, { enLinea = false } = {}) {
  const opId = uuid(op && op.op_id);
  if (!op || typeof op !== 'object') return rechazo(null, 'VALIDACION', 'Operación inválida.');
  if (!opId && !enLinea) return rechazo(op.op_id || null, 'VALIDACION', 'Falta op_id (UUID).');
  if (!TIPOS_VALIDOS.includes(op.tipo)) return rechazo(opId, 'TIPO_INVALIDO', `Tipo de operación desconocido: ${op.tipo}`);

  if (opId) {
    const { rows } = await db.query('SELECT usuario_id, respuesta FROM sync_operaciones WHERE op_id=$1', [opId]);
    if (rows[0]) {
      if (String(rows[0].usuario_id) !== String(usuario.id)) return rechazo(opId, 'OP_AJENA', 'El op_id ya fue usado por otro usuario.');
      return { ...rows[0].respuesta, repetida: true };
    }
  }

  const accion = TIPOS[op.tipo];
  const procesoUuid = uuid(op.proceso_uuid);
  const datos = op.datos && typeof op.datos === 'object' ? op.datos : {};
  const ctx = {
    origen: 'MOVIL',
    fechaCliente: fechaCliente(op.creada_en),
    estadoEsperado: op.estado_esperado && C.ESTADOS[op.estado_esperado] ? op.estado_esperado : null,
  };
  let resultado;
  let procesoId = null;

  if (!enLinea && TIPOS_SOLO_EN_LINEA.includes(op.tipo)) {
    resultado = rechazo(opId, 'SOLO_EN_LINEA', 'Las aprobaciones se hacen con conexión a internet; no se aceptan desde la cola sin conexión.');
  } else if (!procesoUuid) {
    resultado = rechazo(opId, 'VALIDACION', 'Falta proceso_uuid (UUID).');
  } else {
    procesoId = await procesoModel.idPorUuid(procesoUuid);
    try {
      if (op.tipo === TIPO_CREAR) {
        if (procesoId) {
          // Ya existe (p. ej. el servidor lo creó pero la respuesta no llegó y el op_id no quedó registrado)
          const { rows } = await db.query('SELECT solicitante_id FROM procesos WHERE id=$1', [procesoId]);
          resultado = String(rows[0].solicitante_id) === String(usuario.id)
            ? { op_id: opId, estado: 'APLICADA', mensaje: 'La solicitud ya estaba registrada.' }
            : rechazo(opId, 'VALIDACION', 'Ese proceso_uuid ya existe.');
        } else {
          const creado = await procesoService.crearSolicitud(usuario, { ...datos, uuid: procesoUuid }, ctx);
          procesoId = creado.id;
          resultado = {
            op_id: opId,
            estado: 'APLICADA',
            mensaje: creado.existeStock ? 'Solicitud registrada como atendida con stock.' : 'Solicitud registrada y enviada a revisión presupuestaria.',
          };
        }
      } else if (!procesoId) {
        resultado = rechazo(opId, 'NO_ENCONTRADO', 'El proceso no existe en el servidor.');
      } else {
        const traducir = TRADUCIR[accion];
        const r = await flujoService.ejecutar(usuario, procesoId, accion, traducir ? (p) => traducir(p, datos) : datos, ctx);
        resultado = { op_id: opId, estado: 'APLICADA', mensaje: r.mensaje };
      }
    } catch (e) {
      if (e instanceof ErrorFlujo) {
        resultado = { op_id: opId, estado: 'CONFLICTO', error: { codigo: e.codigo, mensaje: e.message } };
      } else if (e instanceof ErrorValidacion) {
        resultado = rechazo(opId, e.codigo, 'Revise los datos.', e.errores);
      } else if (e instanceof ErrorNegocio) {
        resultado = rechazo(opId, e.codigo, e.message);
      } else {
        throw e;
      }
    }
  }

  if (procesoId) {
    const r = await resumen(usuario, procesoId);
    if (r) resultado.proceso = r;
  }
  if (opId) await guardar(usuario, dispositivoId, op, resultado);
  return resultado;
}

module.exports = {
  aplicar, TIPOS, TIPO_CREAR, TIPOS_VALIDOS, TIPOS_SOLO_EN_LINEA,
};
