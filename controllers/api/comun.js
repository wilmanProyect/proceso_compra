// Utilidades compartidas por los controladores de la API (/api/v1)
const fmt = require('../../utils/formato');
const { calcularAcciones } = require('../../services/acciones');
const { ErrorNegocio, ErrorValidacion } = require('../../utils/errores');

const RE_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
function uuid(valor) { return typeof valor === 'string' && RE_UUID.test(valor) ? valor.toLowerCase() : null; }

function error(res, status, codigo, mensaje, detalles) {
  return res.status(status).json({ error: { codigo, mensaje, ...(detalles ? { detalles } : {}) } });
}

// Convierte un error de negocio en respuesta JSON; los demás pasan al manejador general
function responderError(res, e) {
  if (e instanceof ErrorValidacion) return error(res, 422, e.codigo, 'Revise los datos.', e.errores);
  if (e instanceof ErrorNegocio) return error(res, e.status, e.codigo, e.message);
  return null;
}

// Envuelve un handler async: errores de negocio → JSON; el resto → manejador de errores de la API
function api(handler) {
  return async (req, res, next) => {
    try {
      await handler(req, res, next);
    } catch (e) {
      if (!responderError(res, e)) next(e);
    }
  };
}

function numeroONull(v) { return v === null || v === undefined ? null : Number(v); }

// Proceso completo (procesoModel.obtenerCompleto) → JSON para la app. Los precios se indexan por uuid de ítem.
function proceso(p, usuario) {
  const {
    items, cotizaciones, seleccionada, firmas, eventos, adjuntos, formularios, ...cabecera
  } = p;
  const uuidItem = Object.fromEntries(items.map((it) => [String(it.id), it.uuid]));
  return {
    ...cabecera,
    id: Number(p.id),
    sync_version: Number(p.sync_version),
    solicitante_id: Number(p.solicitante_id),
    excepcion_usuario_id: numeroONull(p.excepcion_usuario_id),
    codigo: fmt.codigoRequerimiento(p),
    codigo_oc: fmt.codigoOc(p) || null,
    codigo_ne: fmt.codigoNotaEntrega(p) || null,
    items: items.map((it) => ({ ...it, id: Number(it.id), proceso_id: Number(it.proceso_id) })),
    cotizaciones: cotizaciones.map((c) => ({
      ...c,
      id: Number(c.id),
      proceso_id: Number(c.proceso_id),
      precios: Object.fromEntries(Object.entries(c.precios).map(([itemId, v]) => [uuidItem[String(itemId)], v])),
    })),
    firmas: Object.values(firmas).map((f) => ({
      documento: f.documento, tipo: f.tipo, usuario_id: Number(f.usuario_id), nombre: f.nombre, cargo: f.cargo,
      fecha: f.fecha, origen: f.origen, fecha_cliente: f.fecha_cliente,
    })),
    eventos: eventos.map((e) => ({
      id: Number(e.id), usuario_id: numeroONull(e.usuario_id), usuario_nombre: e.usuario_nombre, accion: e.accion,
      comentario: e.comentario, estado_nuevo: e.estado_nuevo, fecha: e.fecha, origen: e.origen, fecha_cliente: e.fecha_cliente,
    })),
    adjuntos: adjuntos.map(adjunto),
    acciones: calcularAcciones(usuario, p),
  };
}

function adjunto(a) {
  return {
    uuid: a.uuid, etapa: a.etapa, nombre_original: a.nombre_original, mime: a.mime, tamano: a.tamano,
    usuario_id: numeroONull(a.usuario_id), usuario_nombre: a.usuario_nombre, fecha: a.fecha,
  };
}

module.exports = {
  uuid, error, responderError, api, proceso, adjunto,
};
