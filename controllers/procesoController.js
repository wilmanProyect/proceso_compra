const procesoModel = require('../models/procesoModel');
const unidadModel = require('../models/unidadModel');
const procesoService = require('../services/procesoService');
const adjuntoService = require('../services/adjuntoService');
const C = require('../utils/constantes');
const fmt = require('../utils/formato');
const { texto, opcion } = require('../utils/entrada');
const { ErrorValidacion } = require('../utils/errores');
const { calcularAcciones } = require('../services/acciones');
const pasos = require('../utils/pasos');
const proveedorModel = require('../models/proveedorModel');
const proveedorService = require('../services/proveedorService');

const { unidadesPermitidas } = procesoService;

const { borrarArchivos } = adjuntoService;

async function inicio(req, res, next) {
  try {
    const [resumen, pendientes, mios, tareasProveedores] = await Promise.all([
      procesoModel.resumen(req.usuario),
      procesoModel.listar(req.usuario, { pendientes: true }),
      procesoModel.listar(req.usuario, { mios: true }),
      proveedorModel.tareas(req.usuario),
    ]);
    // Solo procesos donde este usuario puede actuar (visibilidad + permiso + estado)
    const tareas = pendientes.filter((p) => {
      const acc = calcularAcciones(req.usuario, { ...p, firmas: {} });
      p.acciones = acc;
      return Object.entries(acc).some(([k, v]) => v && !['anular', 'seguimiento', 'desbloquear', 'confirmarEntrega'].includes(k));
    });
    res.render('inicio', {
      title: 'Inicio',
      resumen,
      tareas,
      enCurso: mios.filter((p) => !C.ESTADOS_FINALES.includes(p.estado)).slice(0, 8),
      tareasProveedores,
    });
  } catch (error) { next(error); }
}

async function listar(req, res, next) {
  try {
    const filtros = {
      unidad: Number(req.query.unidad) || null,
      estado: opcion(req.query.estado, C.ESTADOS),
      gestion: Number(req.query.gestion) || null,
      q: texto(req.query.q, 100),
      pendientes: req.query.vista === 'pendientes',
      mios: req.query.vista === 'mios',
    };
    const [procesos, unidades] = await Promise.all([
      procesoModel.listar(req.usuario, filtros),
      req.usuario.permisos.includes('procesos.ver_todos') ? unidadModel.listar() : unidadModel.listar({ ids: req.usuario.unidades }),
    ]);
    res.render('procesos/lista', {
      title: 'Procesos de compra', procesos, unidades, filtros, vista: req.query.vista || 'todos',
    });
  } catch (error) { next(error); }
}

async function nuevo(req, res, next) {
  try {
    const unidades = await unidadesPermitidas(req.usuario);
    const departamentos = await unidadModel.departamentosActivos();
    res.render('procesos/nuevo', {
      title: 'Nueva solicitud',
      unidades,
      departamentos: departamentos.filter((d) => unidades.some((u) => u.id === d.unidad_id)),
      datos: req.session.borradorSolicitud || {},
    });
    delete req.session.borradorSolicitud;
  } catch (error) { next(error); }
}

async function crear(req, res, next) {
  const archivos = req.files || [];
  try {
    // El formulario web nunca envía uuid: lo generan las tablas (el uuid del cliente es solo para la app)
    const { uuid, ...datos } = req.body;
    let creado;
    try {
      creado = await procesoService.crearSolicitud(req.usuario, datos, { origen: 'WEB' });
    } catch (error) {
      if (!(error instanceof ErrorValidacion)) throw error;
      borrarArchivos(archivos);
      error.errores.forEach((e) => req.flash('error', e));
      req.session.borradorSolicitud = { ...req.body, items: error.items };
      return res.redirect('/procesos/nuevo');
    }
    const { id, existeStock } = creado;

    if (archivos.length) await procesoModel.agregarAdjuntos(id, 'SOLICITUD', archivos, req.usuario.id);
    req.flash('ok', existeStock
      ? 'Solicitud registrada. Como existe en stock, gestione la entrega con el Coordinador Adm. y RRHH.'
      : 'Solicitud registrada y enviada a revisión presupuestaria.');
    return res.redirect(`/procesos/${id}`);
  } catch (error) {
    borrarArchivos(archivos);
    return next(error);
  }
}

async function cargarVisible(req, res) {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) return null;
  const proceso = await procesoModel.obtenerCompleto(id);
  if (!proceso) return null;
  if (!procesoModel.puedeVer(req.usuario, proceso)) {
    res.status(403).render('error', { title: 'Acceso denegado', status: 403, message: 'No tiene acceso a este proceso.' });
    return false;
  }
  return proceso;
}

function montoBs(proceso) {
  const sel = proceso.seleccionada;
  if (!sel) return null;
  return proceso.moneda === 'USD' ? sel.total * Number(proceso.tipo_cambio) : sel.total;
}

async function detalle(req, res, next) {
  try {
    const proceso = await cargarVisible(req, res);
    if (proceso === false) return undefined;
    if (!proceso) return next();
    const monto = montoBs(proceso);
    const requeridas = C.cotizacionesRequeridas(monto ?? proceso.monto_estimado);
    const acciones = calcularAcciones(req.usuario, proceso);
    const listaPasos = pasos.calcularPasos(proceso);
    const pedido = Number(req.query.paso);
    const pasoVer = pedido >= 1 && pedido <= 5 ? pedido : pasos.pasoPorDefecto(proceso, listaPasos);
    return res.render('procesos/detalle', {
      title: fmt.codigoRequerimiento(proceso),
      p: proceso,
      acciones,
      montoBs: monto,
      requeridas,
      pasos: listaPasos,
      pasoVer,
      pasoInfo: listaPasos[pasoVer - 1],
      siguiente: pasos.siguiente(proceso, acciones),
      proveedoresElegibles: acciones.editarCuadro ? await proveedorModel.elegibles(proveedorService.ESTADOS_ELEGIBLES) : [],
    });
  } catch (error) { return next(error); }
}

const DOCUMENTOS_IMPRESION = {
  solicitud: { vista: 'solicitud', formulario: (p) => (p.tipo_solicitud === 'EQUIPO_TECNOLOGICO' ? 'ACTA_TECNOLOGICO' : 'SOLICITUD') },
  cuadro: { vista: 'cuadro', formulario: () => 'CUADRO', disponible: (p) => p.cotizaciones.length > 0 },
  'orden-compra': { vista: 'orden-compra', formulario: () => 'ORDEN_COMPRA', disponible: (p) => p.oc_numero },
  recepcion: { vista: 'recepcion', formulario: () => 'RECEPCION', disponible: (p) => p.rec_fecha },
  'nota-entrega': { vista: 'nota-entrega', formulario: () => 'NOTA_ENTREGA', disponible: (p) => p.ne_numero },
};

async function imprimir(req, res, next) {
  try {
    const doc = DOCUMENTOS_IMPRESION[req.params.doc];
    if (!doc) return next();
    const proceso = await cargarVisible(req, res);
    if (proceso === false) return undefined;
    if (!proceso) return next();
    if (doc.disponible && !doc.disponible(proceso)) {
      req.flash('error', 'Este documento todavía no fue generado.');
      return res.redirect(`/procesos/${proceso.id}`);
    }
    const tipoForm = doc.formulario(proceso);
    return res.render(`imprimir/${doc.vista}`, {
      layout: 'layouts/imprimir',
      title: `${C.FORMULARIOS[tipoForm]} ${fmt.codigoRequerimiento(proceso)}`,
      p: proceso,
      form: proceso.formularios[tipoForm] || {},
      tituloDoc: C.FORMULARIOS[tipoForm],
      montoBs: montoBs(proceso),
    });
  } catch (error) { return next(error); }
}

async function subirAdjuntos(req, res, next) {
  const archivos = req.files || [];
  try {
    const proceso = await cargarVisible(req, res);
    if (proceso === false) { borrarArchivos(archivos); return undefined; }
    if (!proceso) { borrarArchivos(archivos); return next(); }
    if (!adjuntoService.puedeAdjuntar(proceso)) {
      borrarArchivos(archivos);
      req.flash('error', 'No se pueden adjuntar archivos a un proceso finalizado.');
    } else if (!archivos.length) {
      req.flash('error', 'Seleccione al menos un archivo.');
    } else {
      await adjuntoService.agregar(proceso, opcion(req.body.etapa, C.ETAPAS_ADJUNTO, 'SOLICITUD'), archivos, req.usuario);
      req.flash('ok', 'Archivo(s) adjuntado(s).');
    }
    return res.redirect(`/procesos/${proceso.id}#adjuntos`);
  } catch (error) {
    borrarArchivos(archivos);
    return next(error);
  }
}

async function descargarAdjunto(req, res, next) {
  try {
    const adjunto = await procesoModel.obtenerAdjunto(Number(req.params.id) || 0);
    if (!adjunto) return next();
    const proceso = await procesoModel.obtener(adjunto.proceso_id);
    if (!procesoModel.puedeVer(req.usuario, proceso)) {
      return res.status(403).render('error', { title: 'Acceso denegado', status: 403, message: 'No tiene acceso a este archivo.' });
    }
    const ruta = adjuntoService.ruta(adjunto);
    const enLinea = /^(application\/pdf|image\/(png|jpeg|webp))$/.test(adjunto.mime) && req.query.ver;
    res.setHeader('X-Content-Type-Options', 'nosniff');
    if (enLinea) {
      res.type(adjunto.mime);
      res.setHeader('Content-Disposition', `inline; filename*=UTF-8''${encodeURIComponent(adjunto.nombre_original)}`);
      return res.sendFile(ruta);
    }
    return res.download(ruta, adjunto.nombre_original);
  } catch (error) { return next(error); }
}

async function eliminarAdjunto(req, res, next) {
  try {
    const adjunto = await procesoModel.obtenerAdjunto(Number(req.params.id) || 0);
    if (!adjunto) return next();
    const proceso = await procesoModel.obtener(adjunto.proceso_id);
    if (!adjuntoService.puedeEliminar(req.usuario, adjunto, proceso)) {
      req.flash('error', 'Solo quien subió el archivo puede eliminarlo, y únicamente mientras el proceso está en curso.');
    } else {
      await adjuntoService.eliminar(adjunto, proceso, req.usuario);
      req.flash('ok', 'Archivo eliminado.');
    }
    return res.redirect(`/procesos/${proceso.id}#adjuntos`);
  } catch (error) { return next(error); }
}

module.exports = {
  inicio, listar, nuevo, crear, detalle, imprimir, subirAdjuntos, descargarAdjunto, eliminarAdjunto,
  cargarVisible, montoBs, borrarArchivos,
};
