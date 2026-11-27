const crypto = require('crypto');
const usuarioModel = require('../models/usuarioModel');
const procesoModel = require('../models/procesoModel');
const proveedorModel = require('../models/proveedorModel');

// Carga el usuario de la sesión en cada solicitud (refleja cambios de rol o desactivación al instante)
async function cargarUsuario(req, res, next) {
  try {
    res.locals.usuario = null;
    res.locals.puede = () => false;
    if (req.session.usuarioId) {
      const usuario = await usuarioModel.obtenerSesion(req.session.usuarioId);
      if (usuario && usuario.activo) {
        req.usuario = usuario;
        res.locals.usuario = usuario;
        res.locals.puede = (permiso) => usuario.permisos.includes(permiso);
        if (req.method === 'GET') {
          const [procesos, proveedores] = await Promise.all([
            procesoModel.contarPendientes(usuario), proveedorModel.contarTareas(usuario),
          ]);
          res.locals.pendientesMenu = procesos + proveedores;
        }
      } else {
        delete req.session.usuarioId;
      }
    }
    next();
  } catch (error) {
    next(error);
  }
}

function requiereLogin(req, res, next) {
  if (req.usuario) return next();
  req.session.volverA = req.originalUrl;
  return res.redirect('/login');
}

function puede(usuario, permiso) {
  return Boolean(usuario) && usuario.permisos.includes(permiso);
}

function requierePermiso(...permisos) {
  return (req, res, next) => {
    if (permisos.some((p) => puede(req.usuario, p))) return next();
    return res.status(403).render('error', {
      title: 'Acceso denegado', status: 403, message: 'No tiene permisos para realizar esta acción.',
    });
  };
}

// ---------- CSRF (token sincronizado en sesión) ----------
function prepararCsrf(req, res, next) {
  if (!req.session.csrf) req.session.csrf = crypto.randomBytes(24).toString('hex');
  res.locals.csrfToken = req.session.csrf;
  next();
}

function validarCsrf(req, res, next) {
  const token = (req.body && req.body._csrf) || req.get('x-csrf-token');
  if (token && req.session.csrf && token.length === req.session.csrf.length
    && crypto.timingSafeEqual(Buffer.from(token), Buffer.from(req.session.csrf))) {
    return next();
  }
  return res.status(403).render('error', {
    title: 'Sesión expirada', status: 403, message: 'El formulario expiró. Vuelva a cargar la página e inténtelo de nuevo.',
  });
}

// Valida CSRF en POST no multipart (los multipart se validan después de multer, en la ruta)
function csrfGlobal(req, res, next) {
  if (req.method !== 'POST' || req.is('multipart/form-data')) return next();
  return validarCsrf(req, res, next);
}

// ---------- Mensajes flash ----------
function flash(req, res, next) {
  res.locals.flash = req.session.flash || [];
  delete req.session.flash;
  req.flash = (tipo, mensaje) => {
    req.session.flash = req.session.flash || [];
    req.session.flash.push({ tipo, mensaje });
  };
  next();
}

module.exports = {
  cargarUsuario, requiereLogin, requierePermiso, puede, prepararCsrf, validarCsrf, csrfGlobal, flash,
};
