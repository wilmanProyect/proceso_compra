// Autenticación de la API móvil: token Bearer (JWT) + dispositivo vigente + usuario activo.
// Permisos y unidades se recargan en cada petición, así un cambio de rol aplica de inmediato.
const jwt = require('../utils/jwt');
const usuarioModel = require('../models/usuarioModel');
const dispositivoModel = require('../models/dispositivoModel');
const { error } = require('../controllers/api/comun');

async function requiereToken(req, res, next) {
  try {
    const m = /^Bearer\s+(.+)$/i.exec(req.get('authorization') || '');
    if (!m) return error(res, 401, 'NO_AUTORIZADO', 'Falta el token de acceso.');
    const { payload, error: falla } = jwt.verificar(m[1].trim());
    if (falla === 'vencido') return error(res, 401, 'TOKEN_VENCIDO', 'El token de acceso venció. Renueve la sesión.');
    if (!payload || payload.tipo !== 'acceso') return error(res, 401, 'TOKEN_INVALIDO', 'Token de acceso inválido.');
    if (!await dispositivoModel.vigente(payload.did, payload.sub)) {
      return error(res, 401, 'SESION_REVOCADA', 'La sesión de este dispositivo fue cerrada. Ingrese de nuevo.');
    }
    const usuario = await usuarioModel.obtenerSesion(payload.sub);
    if (!usuario || !usuario.activo) {
      await dispositivoModel.revocar(payload.did);
      return error(res, 401, 'USUARIO_INACTIVO', 'El usuario está desactivado.');
    }
    req.usuario = usuario;
    req.dispositivoId = payload.did;
    return next();
  } catch (e) {
    return next(e);
  }
}

module.exports = { requiereToken };
