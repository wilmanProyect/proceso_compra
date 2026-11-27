// /api/v1/auth: inicio de sesión de la app con access token (JWT, 1 h) + refresh token rotativo por dispositivo (60 días)
const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const jwt = require('../../utils/jwt');
const limitador = require('../../utils/limitador');
const usuarioModel = require('../../models/usuarioModel');
const dispositivoModel = require('../../models/dispositivoModel');
const { texto } = require('../../utils/entrada');
const { uuid, error, api } = require('./comun');

const ACCESO_SEG = 60 * 60;
const REFRESH_MS = 60 * 24 * 60 * 60 * 1000;
const GRACIA_MS = 2 * 60 * 1000; // el refresh anterior se acepta 2 min tras rotar (respuesta perdida, reintento)

function hash(token) { return crypto.createHash('sha256').update(token).digest('hex'); }

function perfil(u) {
  return {
    id: Number(u.id), usuario: u.usuario, nombre: u.nombre, cargo: u.cargo, email: u.email,
    rol_codigo: u.rol_codigo, rol_nombre: u.rol_nombre, permisos: u.permisos, unidades: u.unidades.map(Number),
  };
}

function tokens(usuarioId, dispositivoId, refresh) {
  return {
    access_token: jwt.emitir({ sub: Number(usuarioId), did: dispositivoId, tipo: 'acceso' }, ACCESO_SEG),
    expira_en: ACCESO_SEG,
    refresh_token: refresh,
  };
}

const login = api(async (req, res) => {
  const usuario = texto(req.body.usuario, 60);
  const password = texto(req.body.password, 200);
  const dispositivoId = uuid(req.body.dispositivo_id);
  if (!dispositivoId) return error(res, 422, 'VALIDACION', 'Falta dispositivo_id (UUID generado por la app).');
  const k = limitador.clave(req.ip, usuario);
  if (limitador.bloqueado(k)) return error(res, 429, 'DEMASIADOS_INTENTOS', 'Demasiados intentos fallidos. Espere unos minutos.');

  const encontrado = usuario ? await usuarioModel.obtenerPorUsuario(usuario) : null;
  const valido = encontrado && encontrado.activo && await bcrypt.compare(password, encontrado.password_hash);
  if (!valido) {
    limitador.registrarFallo(k);
    return error(res, 401, 'CREDENCIALES', 'Usuario o contraseña incorrectos.');
  }
  limitador.registrarExito(k);

  const refresh = crypto.randomBytes(32).toString('hex');
  await dispositivoModel.registrar({
    id: dispositivoId, usuarioId: encontrado.id, nombre: texto(req.body.dispositivo_nombre, 100),
    refreshHash: hash(refresh), expira: new Date(Date.now() + REFRESH_MS),
  });
  await usuarioModel.registrarAcceso(encontrado.id);
  return res.json({ ...tokens(encontrado.id, dispositivoId, refresh), usuario: perfil(await usuarioModel.obtenerSesion(encontrado.id)) });
});

const refrescar = api(async (req, res) => {
  const dispositivoId = uuid(req.body.dispositivo_id);
  const recibido = texto(req.body.refresh_token, 200);
  const d = dispositivoId && recibido ? await dispositivoModel.obtener(dispositivoId) : null;
  const vencida = () => error(res, 401, 'SESION_VENCIDA', 'La sesión venció o fue cerrada. Ingrese de nuevo.');
  if (!d || d.revocado || new Date(d.expira_en) <= new Date()) return vencida();

  const h = hash(recibido);
  const actual = h === d.refresh_hash;
  const anteriorEnGracia = h === d.refresh_anterior && d.rotado_en && Date.now() - new Date(d.rotado_en).getTime() < GRACIA_MS;
  if (!actual && !anteriorEnGracia) return vencida();

  const usuario = await usuarioModel.obtenerSesion(d.usuario_id);
  if (!usuario || !usuario.activo) {
    await dispositivoModel.revocar(d.id);
    return error(res, 401, 'USUARIO_INACTIVO', 'El usuario está desactivado.');
  }
  const nuevo = crypto.randomBytes(32).toString('hex');
  await dispositivoModel.rotar(d.id, hash(nuevo), new Date(Date.now() + REFRESH_MS));
  return res.json({ ...tokens(usuario.id, d.id, nuevo), usuario: perfil(usuario) });
});

const salir = api(async (req, res) => {
  await dispositivoModel.revocar(req.dispositivoId);
  res.json({ ok: true });
});

const yo = api(async (req, res) => res.json({ usuario: perfil(req.usuario) }));

// Cambia la contraseña y cierra la sesión en los demás teléfonos del usuario
const cambiarPassword = api(async (req, res) => {
  const actual = texto(req.body.actual, 200);
  const nueva = texto(req.body.nueva, 200);
  const registro = await usuarioModel.obtenerPorUsuario(req.usuario.usuario);
  if (!await bcrypt.compare(actual, registro.password_hash)) return error(res, 422, 'VALIDACION', 'La contraseña actual no es correcta.');
  if (nueva.length < 8) return error(res, 422, 'VALIDACION', 'La nueva contraseña debe tener al menos 8 caracteres.');
  await usuarioModel.cambiarPassword(req.usuario.id, await bcrypt.hash(nueva, 10));
  await dispositivoModel.revocarUsuario(req.usuario.id, req.dispositivoId);
  return res.json({ ok: true });
});

module.exports = {
  login, refrescar, salir, yo, cambiarPassword, perfil,
};
