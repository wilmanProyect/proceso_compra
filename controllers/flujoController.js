// Adaptador web del flujo: traduce el formulario a datos del servicio, ejecuta y redirige con mensajes.
// La lógica de negocio está en services/flujoService.js (compartida con la API de la app móvil).
const flujoService = require('../services/flujoService');
const {
  ErrorValidacion, ErrorFlujo, ErrorNoEncontrado, ErrorSinAcceso, ErrorNoDisponible,
} = require('../utils/errores');

// A dónde volver después de la acción: Inicio (aprobación rápida) o el proceso, opcionalmente en el mismo paso
function destino(req, conPaso = false) {
  if (req.body && req.body.volver === 'inicio') return '/';
  const paso = Number(req.body && req.body.paso);
  return `/procesos/${Number(req.params.id)}${conPaso && paso >= 1 && paso <= 5 ? `?paso=${paso}` : ''}`;
}

// Campos del formulario con clave "i<itemId>" → { itemId: valor }
function porItem(objeto) {
  const resultado = {};
  Object.entries(objeto || {}).forEach(([clave, valor]) => {
    if (/^i\d+$/.test(clave)) resultado[clave.slice(1)] = valor;
  });
  return resultado;
}

// Formulario del cuadro: cot[p1..p3][proveedor_id|ocasional_nombre|ocasional_nit|contacto|telefono|criterio[cN]|precio[i<itemId>]], seleccionada=pN
function leerCuadro(b) {
  const enviadas = b.cot || {};
  const cotizaciones = ['p1', 'p2', 'p3'].map((clave, i) => {
    const c = enviadas[clave] || {};
    const criterios = {};
    Object.entries(c.criterio || {}).forEach(([k, v]) => {
      if (/^c\d+$/.test(k)) criterios[k.slice(1)] = v;
    });
    // proveedor_id: id del registro, o "ocasional" (emergencia, 4.2.6) con nombre y NIT escritos a mano
    const ocasional = c.proveedor_id === 'ocasional';
    return {
      orden: i + 1,
      proveedor_id: ocasional ? null : c.proveedor_id,
      ocasional_nombre: ocasional ? c.ocasional_nombre : '',
      ocasional_nit: ocasional ? c.ocasional_nit : '',
      contacto: c.contacto,
      telefono: c.telefono,
      criterios,
      precios: porItem(c.precio),
      seleccionada: b.seleccionada === clave,
    };
  });
  return {
    enviar: b.accion === 'enviar', moneda: b.moneda, tipo_cambio: b.tipo_cambio,
    fecha_evaluacion: b.fecha_evaluacion, justificacion: b.justificacion, cotizaciones,
  };
}

// quedarse: al terminar, volver al mismo paso (guardar borrador, notas) en vez de al paso actual del proceso
function accion(nombre, leer = (b) => b, { quedarse = false } = {}) {
  return async (req, res, next) => {
    try {
      const { mensaje } = await flujoService.ejecutar(req.usuario, req.params.id, nombre, leer(req.body || {}), { origen: 'WEB' });
      if (mensaje) req.flash('ok', mensaje);
      return res.redirect(destino(req, quedarse));
    } catch (error) {
      if (error instanceof ErrorNoEncontrado) return next();
      if (error instanceof ErrorSinAcceso) {
        return res.status(403).render('error', { title: 'Acceso denegado', status: 403, message: error.message });
      }
      if (error instanceof ErrorValidacion) {
        error.errores.forEach((e) => req.flash('error', e));
        return res.redirect(destino(req, true));
      }
      if (error instanceof ErrorNoDisponible || error instanceof ErrorFlujo) {
        req.flash('error', error.message);
        return res.redirect(destino(req));
      }
      return next(error);
    }
  };
}

module.exports = {
  // Fase 1
  anular: accion('anular'),
  aprobarSolicitud: accion('aprobarSolicitud'),
  guardarCuadro: accion('guardarCuadro', leerCuadro, { quedarse: true }),
  desbloquear: accion('desbloquear', (b) => ({ motivo: b.comentario }), { quedarse: true }),
  aprobarCuadro: accion('aprobarCuadro'),
  guardarOc: accion('guardarOc', (b) => ({ ...b, emitir: b.accion === 'emitir', proveedor: b.prov }), { quedarse: true }),
  autorizarOc: accion('autorizarOc'),
  seguimiento: accion('seguimiento', undefined, { quedarse: true }),
  cerrarServicio: accion('cerrarServicio'),
  // Fase 2
  guardarRecepcion: accion('guardarRecepcion', (b) => ({ ...b, enviar: b.accion === 'enviar', items: porItem(b.it) }), { quedarse: true }),
  entrega: accion('entrega', (b) => ({ ...b, entregar: b.accion === 'entregar', items: porItem(b.it) }), { quedarse: true }),
  confirmarEntrega: accion('confirmarEntrega'),
};
