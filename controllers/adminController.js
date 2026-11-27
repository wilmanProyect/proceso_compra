const bcrypt = require('bcryptjs');
const usuarioModel = require('../models/usuarioModel');
const dispositivoModel = require('../models/dispositivoModel');
const rolModel = require('../models/rolModel');
const unidadModel = require('../models/unidadModel');
const { texto, bool, lista } = require('../utils/entrada');

// ===================== Usuarios =====================
async function usuarios(req, res, next) {
  try {
    res.render('admin/usuarios', { title: 'Usuarios', lista: await usuarioModel.listar() });
  } catch (error) { next(error); }
}

async function formularioUsuario(req, res, next) {
  try {
    const registro = req.params.id ? await usuarioModel.obtener(req.params.id) : null;
    if (req.params.id && !registro) return next();
    return res.render('admin/usuario-form', {
      title: registro ? 'Editar usuario' : 'Nuevo usuario',
      registro: registro || { activo: true, unidades: [] },
      roles: await rolModel.listar(),
      unidades: await unidadModel.listar(),
    });
  } catch (error) { return next(error); }
}

async function guardarUsuario(req, res, next) {
  const id = req.params.id || null;
  try {
    const datos = {
      usuario: texto(req.body.usuario, 60).toLowerCase(),
      nombre: texto(req.body.nombre, 150),
      cargo: texto(req.body.cargo, 120),
      email: texto(req.body.email, 150),
      rol_id: Number(req.body.rol_id) || null,
      activo: id ? bool(req.body.activo) : true,
      unidades: lista(req.body.unidades).map(Number).filter(Boolean),
    };
    const password = texto(req.body.password, 200);
    const errores = [];
    if (!/^[a-z0-9._-]{3,60}$/.test(datos.usuario)) errores.push('El usuario debe tener 3 o más caracteres (letras, números, punto, guion).');
    if (!datos.nombre) errores.push('El nombre es obligatorio.');
    if (!datos.rol_id) errores.push('Seleccione un rol.');
    if (!id && password.length < 8) errores.push('La contraseña debe tener al menos 8 caracteres.');
    if (id && password && password.length < 8) errores.push('La nueva contraseña debe tener al menos 8 caracteres.');
    if (id && String(id) === String(req.usuario.id) && !datos.activo) errores.push('No puede desactivar su propio usuario.');
    const existente = await usuarioModel.obtenerPorUsuario(datos.usuario);
    if (existente && String(existente.id) !== String(id)) errores.push('Ese nombre de usuario ya existe.');

    if (errores.length) {
      errores.forEach((e) => req.flash('error', e));
      return res.redirect(id ? `/admin/usuarios/${id}` : '/admin/usuarios/nuevo');
    }
    if (password) datos.password_hash = await bcrypt.hash(password, 10);
    await usuarioModel.guardar(datos, id);
    // Desactivar o cambiar la contraseña cierra la sesión de la app móvil en todos sus teléfonos
    if (id && (!datos.activo || password)) await dispositivoModel.revocarUsuario(id);
    req.flash('ok', 'Usuario guardado.');
    return res.redirect('/admin/usuarios');
  } catch (error) { return next(error); }
}

// ===================== Roles y permisos =====================
async function roles(req, res, next) {
  try {
    res.render('admin/roles', { title: 'Roles y permisos', roles: await rolModel.listar(), permisos: await rolModel.permisos() });
  } catch (error) { next(error); }
}

async function guardarRoles(req, res, next) {
  try {
    const todos = await rolModel.listar();
    const asignaciones = {};
    const enviados = req.body.permisos || {};
    todos.forEach((r) => { asignaciones[r.id] = lista(enviados[`r${r.id}`]).map((p) => texto(p, 60)); });
    await rolModel.guardarPermisos(asignaciones);
    req.flash('ok', 'Permisos actualizados.');
    res.redirect('/admin/roles');
  } catch (error) { next(error); }
}

// ===================== Unidades de negocio =====================
async function unidades(req, res, next) {
  try {
    res.render('admin/unidades', { title: 'Unidades de negocio', lista: await unidadModel.listar() });
  } catch (error) { next(error); }
}

async function formularioUnidad(req, res, next) {
  try {
    const unidad = await unidadModel.obtener(req.params.id);
    if (!unidad) return next();
    return res.render('admin/unidad-form', {
      title: `Unidad: ${unidad.nombre}`,
      unidad,
      departamentos: await unidadModel.departamentos(unidad.id),
    });
  } catch (error) { return next(error); }
}

async function guardarUnidad(req, res, next) {
  try {
    const unidad = await unidadModel.obtener(req.params.id);
    if (!unidad) return next();
    const b = req.body;
    const color = texto(b.color, 10);
    const datos = {
      nombre: texto(b.nombre, 120) || unidad.nombre,
      razon_social: texto(b.razon_social, 200),
      nit: texto(b.nit, 40),
      direccion: texto(b.direccion, 250),
      telefono: texto(b.telefono, 60),
      codigo_revision: texto(b.codigo_revision, 40),
      lugar_entrega: texto(b.lugar_entrega, 250),
      lugar_cobranza: texto(b.lugar_cobranza, 250),
      datos_factura: texto(b.datos_factura, 2000),
      notas_oc: texto(b.notas_oc, 4000),
      color: /^#[0-9a-fA-F]{6}$/.test(color) ? color : unidad.color,
      activo: bool(b.activo),
    };
    const logo = req.file ? `logos/${req.file.filename}` : null;
    await unidadModel.guardar(unidad.id, datos, logo);
    req.flash('ok', 'Unidad de negocio actualizada.');
    return res.redirect(`/admin/unidades/${unidad.id}`);
  } catch (error) { return next(error); }
}

async function agregarDepartamento(req, res, next) {
  try {
    const nombre = texto(req.body.nombre, 120);
    if (nombre) await unidadModel.agregarDepartamento(req.params.id, nombre);
    res.redirect(`/admin/unidades/${req.params.id}#departamentos`);
  } catch (error) { next(error); }
}

async function cambiarDepartamento(req, res, next) {
  try {
    await unidadModel.cambiarDepartamento(req.params.id, req.params.depId, bool(req.body.activo));
    res.redirect(`/admin/unidades/${req.params.id}#departamentos`);
  } catch (error) { next(error); }
}

module.exports = {
  usuarios, formularioUsuario, guardarUsuario, roles, guardarRoles,
  unidades, formularioUnidad, guardarUnidad, agregarDepartamento, cambiarDepartamento,
};
