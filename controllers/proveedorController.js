// Módulo de proveedores (web): registro común, evaluación (RV.FCOM.02.1) y Listado de Proveedores Aprobados (RV.FCOM.02.2)
const fs = require('fs');
const path = require('path');
const db = require('../config/db');
const proveedorModel = require('../models/proveedorModel');
const formularioModel = require('../models/formularioModel');
const unidadModel = require('../models/unidadModel');
const proveedorService = require('../services/proveedorService');
const C = require('../utils/constantes');
const fmt = require('../utils/formato');
const { texto, opcion } = require('../utils/entrada');
const { ErrorValidacion, ErrorNoEncontrado, ErrorNoDisponible } = require('../utils/errores');
const { DIR_ADJUNTOS } = require('../middlewares/subidas');

// Estados que aparecen en el Listado de Proveedores Aprobados (4.9): evaluados y no retirados
const ESTADOS_LISTADO = ['APROBADO', 'APROBADO_OBS', 'NO_APROBADO', 'SUSPENDIDO'];

function borrarArchivos(archivos = []) { archivos.forEach((a) => a && a.path && fs.unlink(a.path, () => {})); }

// Envuelve un handler: errores de negocio → mensaje y vuelta a la página anterior
function manejar(handler, volver = (req) => req.get('referer') || '/proveedores') {
  return async (req, res, next) => {
    try {
      return await handler(req, res, next);
    } catch (error) {
      if (error instanceof ErrorNoEncontrado) return next();
      if (error instanceof ErrorValidacion) {
        error.errores.forEach((e) => req.flash('error', e));
        return res.redirect(volver(req));
      }
      if (error instanceof ErrorNoDisponible) {
        req.flash('error', error.message);
        return res.redirect(volver(req));
      }
      return next(error);
    }
  };
}

// ===================== Listado =====================
const VISTAS = {
  todos: { nombre: 'Todos', estados: null },
  aprobados: { nombre: 'Aprobados', estados: ['APROBADO', 'APROBADO_OBS'] },
  nuevos: { nombre: 'Sin evaluar', estados: ['NUEVO'] },
  no_aprobados: { nombre: 'No aprobados / suspendidos', estados: ['NO_APROBADO', 'SUSPENDIDO'] },
  retirados: { nombre: 'Retirados', estados: ['RETIRADO'] },
  vencidos: { nombre: 'Reevaluación vencida', estados: null, vencidos: true },
};

const listar = manejar(async (req, res) => {
  const vista = VISTAS[req.query.vista] ? req.query.vista : 'todos';
  const filtros = {
    estados: VISTAS[vista].estados,
    vencidos: VISTAS[vista].vencidos,
    clasificacion: opcion(req.query.clasificacion, C.CLASIFICACIONES),
    q: texto(req.query.q, 100),
  };
  const [proveedores, unidades] = await Promise.all([proveedorModel.listar(filtros), proveedorService.unidadesDelUsuario(req.usuario)]);
  res.render('proveedores/lista', {
    title: 'Proveedores', proveedores, filtros, vista, vistas: VISTAS, unidades, hoy: fmt.hoy(),
  });
});

// ===================== Alta y edición =====================
const formulario = manejar(async (req, res, next) => {
  const proveedor = req.params.id ? await proveedorModel.obtener(req.params.id) : null;
  if (req.params.id && !proveedor) return next();
  const borrador = req.session.borradorProveedor;
  delete req.session.borradorProveedor;
  return res.render('proveedores/form', {
    title: proveedor ? `Editar: ${proveedor.razon_social}` : 'Nuevo proveedor',
    proveedor: borrador || proveedor || { clasificacion: 'NO_CRITICO' },
    id: proveedor ? proveedor.id : null,
  });
});

async function guardar(req, res, next) {
  const id = req.params.id || null;
  try {
    const prov = id ? await proveedorService.editar(req.usuario, id, req.body) : await proveedorService.crear(req.usuario, req.body);
    req.flash('ok', id ? 'Proveedor actualizado.' : 'Proveedor registrado como "Nuevo (sin evaluar)".');
    return res.redirect(`/proveedores/${prov.id}`);
  } catch (error) {
    if (error instanceof ErrorValidacion) {
      error.errores.forEach((e) => req.flash('error', e));
      req.session.borradorProveedor = req.body;
      return res.redirect(id ? `/proveedores/${id}/editar` : '/proveedores/nuevo');
    }
    if (error instanceof ErrorNoEncontrado) return next();
    return next(error);
  }
}

// ===================== Ficha =====================
const ficha = manejar(async (req, res, next) => {
  const proveedor = await proveedorModel.ficha(req.params.id);
  if (!proveedor) return next();
  const unidades = await proveedorService.unidadesDelUsuario(req.usuario);
  return res.render('proveedores/ficha', {
    title: proveedor.razon_social,
    pv: proveedor,
    unidades,
    hoy: fmt.hoy(),
    evaluacionAbierta: proveedor.evaluaciones.find((e) => e.estado !== 'APROBADA') || null,
  });
});

const cambiarEstado = manejar(async (req, res) => {
  const destino = await proveedorService.cambiarEstado(req.usuario, req.params.id, texto(req.body.estado, 20), req.body.motivo);
  req.flash('ok', `Estado actualizado: ${C.ESTADOS_PROVEEDOR[destino].nombre}.`);
  res.redirect(`/proveedores/${req.params.id}`);
});

const cambiarReevaluacion = manejar(async (req, res) => {
  await proveedorService.cambiarReevaluacion(req.usuario, req.params.id, req.body.proxima_reevaluacion, req.body.motivo);
  req.flash('ok', 'Fecha de la próxima reevaluación actualizada.');
  res.redirect(`/proveedores/${req.params.id}`);
});

const agregarIncidencia = manejar(async (req, res) => {
  await proveedorService.incidenciaManual(req.usuario, req.params.id, req.body.descripcion);
  req.flash('ok', 'Incidencia registrada. Se tendrá en cuenta en la próxima evaluación.');
  res.redirect(`/proveedores/${req.params.id}#incidencias`);
});

// ===================== Documentos de respaldo =====================
async function subirAdjuntos(req, res, next) {
  const archivos = req.files || [];
  try {
    const prov = await proveedorModel.obtener(req.params.id);
    if (!prov) { borrarArchivos(archivos); return next(); }
    if (!archivos.length) {
      req.flash('error', 'Seleccione al menos un archivo.');
    } else {
      const tipoDoc = C.TIPOS_DOC_PROVEEDOR.includes(req.body.tipo_doc) ? req.body.tipo_doc : 'Otro';
      await proveedorModel.agregarAdjuntos(prov.id, tipoDoc, archivos, req.usuario.id);
      await proveedorModel.evento(db, prov.id, req.usuario.id, `Adjuntó: ${tipoDoc}`,
        archivos.map((a) => a.originalname).join(', '));
      req.flash('ok', 'Documento(s) adjuntado(s).');
    }
    return res.redirect(`/proveedores/${prov.id}#documentos`);
  } catch (error) {
    borrarArchivos(archivos);
    return next(error);
  }
}

const descargarAdjunto = manejar(async (req, res, next) => {
  const adj = await proveedorModel.obtenerAdjunto(Number(req.params.id) || 0);
  if (!adj) return next();
  const ruta = path.join(DIR_ADJUNTOS, path.basename(adj.archivo));
  res.setHeader('X-Content-Type-Options', 'nosniff');
  if (req.query.ver && /^(application\/pdf|image\/(png|jpeg|webp))$/.test(adj.mime)) {
    res.type(adj.mime);
    res.setHeader('Content-Disposition', `inline; filename*=UTF-8''${encodeURIComponent(adj.nombre_original)}`);
    return res.sendFile(ruta);
  }
  return res.download(ruta, adj.nombre_original);
});

const eliminarAdjunto = manejar(async (req, res, next) => {
  const adj = await proveedorModel.obtenerAdjunto(Number(req.params.id) || 0);
  if (!adj) return next();
  const esDueno = String(adj.usuario_id) === String(req.usuario.id);
  if (!esDueno && !req.usuario.permisos.includes('proveedores.aprobar')) {
    throw new ErrorNoDisponible('Solo quien subió el documento, Gerencia o Administración pueden eliminarlo.');
  }
  await proveedorModel.eliminarAdjunto(adj.id);
  fs.unlink(path.join(DIR_ADJUNTOS, path.basename(adj.archivo)), () => {});
  await proveedorModel.evento(db, adj.proveedor_id, req.usuario.id, 'Eliminó un documento', adj.nombre_original);
  req.flash('ok', 'Documento eliminado.');
  return res.redirect(`/proveedores/${adj.proveedor_id}#documentos`);
});

// ===================== Evaluaciones =====================
const nuevaEvaluacion = manejar(async (req, res) => {
  const evalId = await proveedorService.nuevaEvaluacion(req.usuario, req.params.id, req.body.unidad_id);
  res.redirect(`/proveedores/evaluaciones/${evalId}`);
});

const verEvaluacion = manejar(async (req, res, next) => {
  const ev = await proveedorModel.obtenerEvaluacion(req.params.id);
  if (!ev) return next();
  const prov = await proveedorModel.obtener(ev.proveedor_id);
  const esEvaluador = String(ev.evaluador_id) === String(req.usuario.id);
  const puede = (p) => req.usuario.permisos.includes(p);
  return res.render('proveedores/evaluacion', {
    title: `Evaluación: ${ev.razon_social}`,
    ev,
    prov,
    editable: ev.estado === 'BORRADOR' && esEvaluador && puede('proveedores.gestionar'),
    puedeAprobar: ev.estado === 'POR_APROBAR' && !esEvaluador && puede('proveedores.aprobar'),
    incidencias: await proveedorModel.incidenciasDesde(ev.proveedor_id, prov.fecha_evaluacion),
    unidades: await proveedorService.unidadesDelUsuario(req.usuario),
    estadoResultante: proveedorService.estadoResultante(ev),
    mesesSugeridos: (ev.acciones || {}).reevaluar ? 6 : C.MESES_REEVALUACION[prov.clasificacion],
  });
});

const guardarEvaluacion = manejar(async (req, res) => {
  const mensaje = await proveedorService.guardarEvaluacion(req.usuario, req.params.id, {
    ...req.body, enviar: req.body.accion === 'enviar',
  });
  req.flash('ok', mensaje);
  res.redirect(`/proveedores/evaluaciones/${req.params.id}`);
}, (req) => `/proveedores/evaluaciones/${req.params.id}`);

const aprobarEvaluacion = manejar(async (req, res) => {
  const mensaje = await proveedorService.aprobarEvaluacion(req.usuario, req.params.id, req.body);
  req.flash('ok', mensaje);
  res.redirect(req.body.volver === 'inicio' ? '/' : `/proveedores/evaluaciones/${req.params.id}`);
}, (req) => (req.body.volver === 'inicio' ? '/' : `/proveedores/evaluaciones/${req.params.id}`));

const descartarEvaluacion = manejar(async (req, res) => {
  const proveedorId = await proveedorService.descartarEvaluacion(req.usuario, req.params.id);
  req.flash('ok', 'Borrador descartado.');
  res.redirect(`/proveedores/${proveedorId}`);
});

// ===================== Impresión y exportación =====================
async function cabecera(unidadId, clave) {
  const unidad = await unidadModel.obtener(unidadId);
  const forms = await formularioModel.porUnidad(unidadId);
  return {
    cabUnidad: { logo: unidad.logo, unidad_nombre: unidad.nombre, codigo_revision: unidad.codigo_revision },
    form: forms[clave] || {},
    tituloDoc: C.FORMULARIOS[clave],
  };
}

const imprimirEvaluacion = manejar(async (req, res, next) => {
  const ev = await proveedorModel.obtenerEvaluacion(req.params.id);
  if (!ev) return next();
  const cab = await cabecera(ev.unidad_id, 'EVAL_PROVEEDOR');
  return res.render('imprimir/evaluacion-proveedor', {
    layout: 'layouts/imprimir',
    title: `Evaluación de proveedor · ${ev.razon_social}`,
    ev,
    ...cab,
    volver: `/proveedores/evaluaciones/${ev.id}`,
    volverTexto: 'Volver a la evaluación',
  });
});

async function unidadListado(req) {
  const unidades = await proveedorService.unidadesDelUsuario(req.usuario);
  return unidades.find((u) => u.id === Number(req.query.unidad)) || unidades[0] || (await unidadModel.listar({ soloActivas: true }))[0];
}

const imprimirListado = manejar(async (req, res) => {
  const unidad = await unidadListado(req);
  const proveedores = await proveedorModel.listar({ estados: ESTADOS_LISTADO });
  const cab = await cabecera(unidad.id, 'LISTADO_PROVEEDORES');
  return res.render('imprimir/listado-proveedores', {
    layout: 'layouts/imprimir',
    title: 'Listado de Proveedores Aprobados',
    proveedores,
    ...cab,
    volver: '/proveedores',
    volverTexto: 'Volver a proveedores',
  });
});

function celdaCsv(v) {
  const s = v === null || v === undefined ? '' : String(v);
  // Evita que Excel interprete fórmulas (=, +, -, @) y escapa comillas
  const seguro = /^[=+\-@]/.test(s) ? `'${s}` : s;
  return `"${seguro.replace(/"/g, '""')}"`;
}

const exportarListado = manejar(async (req, res) => {
  const proveedores = await proveedorModel.listar({ estados: ESTADOS_LISTADO });
  const filas = [['N°', 'Razón social', 'NIT', 'Contacto principal', 'Teléfono', 'Correo', 'Tipo de suministro', 'Clasificación',
    'Fecha de evaluación', 'Resultado (promedio)', 'Estado', 'Próxima reevaluación']];
  proveedores.forEach((p, i) => filas.push([
    i + 1, p.razon_social, p.nit, p.contacto, p.telefono, p.email, p.tipo_suministro, C.CLASIFICACIONES[p.clasificacion],
    fmt.fecha(p.fecha_evaluacion), p.promedio !== null ? String(Number(p.promedio)).replace('.', ',') : '',
    C.ESTADOS_PROVEEDOR[p.estado].nombre, fmt.fecha(p.proxima_reevaluacion),
  ]));
  // Separador ";" y BOM UTF-8: Excel en español lo abre con columnas y tildes correctas
  const csv = `﻿${filas.map((f) => f.map(celdaCsv).join(';')).join('\r\n')}\r\n`;
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="Listado_Proveedores_Aprobados_${fmt.hoy()}.csv"`);
  res.send(csv);
});

module.exports = {
  listar, formulario, guardar, ficha, cambiarEstado, cambiarReevaluacion, agregarIncidencia,
  subirAdjuntos, descargarAdjunto, eliminarAdjunto,
  nuevaEvaluacion, verEvaluacion, guardarEvaluacion, aprobarEvaluacion, descartarEvaluacion,
  imprimirEvaluacion, imprimirListado, exportarListado,
};
