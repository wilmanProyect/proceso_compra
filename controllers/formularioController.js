// Formularios electrónicos: registro de documentos y datos del encabezado (código, versión, título, fecha)
const formularioModel = require('../models/formularioModel');
const unidadModel = require('../models/unidadModel');
const C = require('../utils/constantes');
const { texto, fecha, bool, opcion } = require('../utils/entrada');

const NOMBRES_CAMPO = {
  tipo_documento_id: 'Tipo de documento', proceso_area: 'Proceso/Área', codigo: 'Código', version: 'Versión',
  titulo: 'Título', fecha: 'Fecha', estado: 'Estado',
};

async function listar(req, res, next) {
  try {
    const filtros = {
      unidad: Number(req.query.unidad) || null,
      tipo: Number(req.query.tipo) || null,
      estado: opcion(req.query.estado, C.ESTADOS_FORMULARIO),
      q: texto(req.query.q, 100),
    };
    const [formularios, unidades, tipos] = await Promise.all([
      formularioModel.listar(filtros), unidadModel.listar(), formularioModel.tiposDocumento(),
    ]);
    res.render('admin/formularios', { title: 'Formularios electrónicos', formularios, unidades, tipos, filtros });
  } catch (error) { next(error); }
}

async function formulario(req, res, next) {
  try {
    const registro = req.params.id ? await formularioModel.obtener(req.params.id) : null;
    if (req.params.id && !registro) return next();
    const [unidades, tipos, historial] = await Promise.all([
      unidadModel.listar(), formularioModel.tiposDocumento(), registro ? formularioModel.historial(registro.id) : [],
    ]);
    const tipoTexto = Object.fromEntries(tipos.map((t) => [String(t.id), t.nombre]));
    return res.render('admin/formulario-form', {
      title: registro ? `Formulario ${registro.codigo}` : 'Nuevo formulario',
      registro: req.session.borradorFormulario || registro || { estado: 'EN_REVISION', unidad_id: Number(req.query.unidad) || null },
      id: registro ? registro.id : null,
      clave: registro ? registro.clave : null,
      unidades,
      tipos,
      historial,
      nombresCampo: NOMBRES_CAMPO,
      tipoTexto,
    });
  } catch (error) { return next(error); } finally { delete req.session.borradorFormulario; }
}

async function guardar(req, res, next) {
  const id = req.params.id || null;
  try {
    const b = req.body;
    const actual = id ? await formularioModel.obtener(id) : null;
    if (id && !actual) return next();
    const datos = {
      unidad_id: actual ? actual.unidad_id : Number(b.unidad_id) || null,
      tipo_documento_id: Number(b.tipo_documento_id) || null,
      proceso_area: texto(b.proceso_area, 120),
      codigo: texto(b.codigo, 40).toUpperCase(),
      version: texto(b.version, 10),
      titulo: texto(b.titulo, 200).toUpperCase(),
      fecha: fecha(b.fecha),
      estado: opcion(b.estado, C.ESTADOS_FORMULARIO, 'EN_REVISION'),
    };
    const errores = [];
    if (!datos.unidad_id) errores.push('Seleccione la unidad de negocio.');
    if (!datos.tipo_documento_id) errores.push('Seleccione el tipo de documento.');
    if (!datos.codigo) errores.push('El código es obligatorio (ej.: RV.FPRO.01.2).');
    if (!datos.version) errores.push('La versión es obligatoria (ej.: 0).');
    if (!datos.titulo) errores.push('El título del documento es obligatorio.');
    if (!datos.fecha) errores.push('La fecha es obligatoria.');
    if (errores.length) {
      errores.forEach((e) => req.flash('error', e));
      req.session.borradorFormulario = { ...datos, id };
      return res.redirect(id ? `/admin/formularios/${id}` : '/admin/formularios/nuevo');
    }
    const nuevoId = await formularioModel.guardar(datos, id, req.usuario);
    req.flash('ok', id ? 'Formulario actualizado. El cambio quedó en el historial.' : 'Formulario registrado.');
    return res.redirect(`/admin/formularios/${nuevoId}`);
  } catch (error) { return next(error); }
}

async function agregarTipo(req, res, next) {
  try {
    const nombre = texto(req.body.nombre, 60);
    if (nombre) await formularioModel.agregarTipo(nombre);
    res.redirect('/admin/formularios#tipos');
  } catch (error) { next(error); }
}

async function cambiarTipo(req, res, next) {
  try {
    await formularioModel.cambiarTipo(req.params.id, bool(req.body.activo));
    res.redirect('/admin/formularios#tipos');
  } catch (error) { next(error); }
}

module.exports = {
  listar, formulario, guardar, agregarTipo, cambiarTipo,
};
