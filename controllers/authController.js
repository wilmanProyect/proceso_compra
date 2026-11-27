const bcrypt = require('bcryptjs');
const usuarioModel = require('../models/usuarioModel');
const dispositivoModel = require('../models/dispositivoModel');
const limitador = require('../utils/limitador');
const { texto } = require('../utils/entrada');

function formulario(req, res) {
  if (req.usuario) return res.redirect('/');
  return res.render('auth/login', { title: 'Iniciar sesión', layout: 'layouts/auth', usuarioIngresado: '' });
}

async function ingresar(req, res, next) {
  try {
    const usuario = texto(req.body.usuario, 60);
    const password = texto(req.body.password, 200);
    const k = limitador.clave(req.ip, usuario);
    const render = (mensaje) => res.status(401).render('auth/login', {
      title: 'Iniciar sesión', layout: 'layouts/auth', usuarioIngresado: usuario, error: mensaje,
    });

    if (limitador.bloqueado(k)) {
      return render('Demasiados intentos fallidos. Espere unos minutos e inténtelo de nuevo.');
    }

    const encontrado = usuario ? await usuarioModel.obtenerPorUsuario(usuario) : null;
    const valido = encontrado && encontrado.activo && await bcrypt.compare(password, encontrado.password_hash);
    if (!valido) {
      limitador.registrarFallo(k);
      return render('Usuario o contraseña incorrectos.');
    }

    limitador.registrarExito(k);
    const volverA = req.session.volverA;
    return req.session.regenerate(async (error) => {
      if (error) return next(error);
      req.session.usuarioId = encontrado.id;
      await usuarioModel.registrarAcceso(encontrado.id);
      return res.redirect(volverA && volverA.startsWith('/') && !volverA.startsWith('//') ? volverA : '/');
    });
  } catch (error) {
    return next(error);
  }
}

function salir(req, res) {
  req.session.destroy(() => {
    res.clearCookie('pc.sid');
    res.redirect('/login');
  });
}

function formularioPassword(req, res) {
  res.render('auth/password', { title: 'Cambiar contraseña' });
}

async function cambiarPassword(req, res, next) {
  try {
    const actual = texto(req.body.actual, 200);
    const nueva = texto(req.body.nueva, 200);
    const confirmar = texto(req.body.confirmar, 200);
    const registro = await usuarioModel.obtenerPorUsuario(req.usuario.usuario);
    if (!await bcrypt.compare(actual, registro.password_hash)) {
      req.flash('error', 'La contraseña actual no es correcta.');
    } else if (nueva.length < 8) {
      req.flash('error', 'La nueva contraseña debe tener al menos 8 caracteres.');
    } else if (nueva !== confirmar) {
      req.flash('error', 'La confirmación no coincide con la nueva contraseña.');
    } else {
      await usuarioModel.cambiarPassword(req.usuario.id, await bcrypt.hash(nueva, 10));
      await dispositivoModel.revocarUsuario(req.usuario.id); // la app móvil pedirá ingresar de nuevo
      req.flash('ok', 'Contraseña actualizada correctamente.');
      return res.redirect('/');
    }
    return res.redirect('/cuenta/password');
  } catch (error) {
    return next(error);
  }
}

module.exports = { formulario, ingresar, salir, formularioPassword, cambiarPassword };
