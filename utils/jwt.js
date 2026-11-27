// JWT HS256 mínimo (sin dependencias) para los tokens de acceso de la app móvil
const crypto = require('crypto');

const SECRETO = process.env.JWT_SECRET || process.env.SESSION_SECRET || crypto.randomBytes(32).toString('hex');
if (!process.env.JWT_SECRET && !process.env.SESSION_SECRET) {
  console.warn('ADVERTENCIA: JWT_SECRET no está definido; los tokens de la app móvil se invalidarán al reiniciar.');
}

function b64(texto) { return Buffer.from(texto).toString('base64url'); }
function firma(datos) { return crypto.createHmac('sha256', SECRETO).update(datos).digest('base64url'); }

function emitir(payload, segundos) {
  const ahora = Math.floor(Date.now() / 1000);
  const cabecera = b64(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const cuerpo = b64(JSON.stringify({ ...payload, iat: ahora, exp: ahora + segundos }));
  return `${cabecera}.${cuerpo}.${firma(`${cabecera}.${cuerpo}`)}`;
}

// Devuelve { payload } si es válido, { error: 'vencido' | 'invalido' } si no
function verificar(token) {
  const partes = String(token || '').split('.');
  if (partes.length !== 3) return { error: 'invalido' };
  const [cabecera, cuerpo, recibida] = partes;
  const esperada = firma(`${cabecera}.${cuerpo}`);
  if (recibida.length !== esperada.length || !crypto.timingSafeEqual(Buffer.from(recibida), Buffer.from(esperada))) {
    return { error: 'invalido' };
  }
  let header;
  let payload;
  try {
    header = JSON.parse(Buffer.from(cabecera, 'base64url').toString('utf8'));
    payload = JSON.parse(Buffer.from(cuerpo, 'base64url').toString('utf8'));
  } catch (e) {
    return { error: 'invalido' };
  }
  if (header.alg !== 'HS256' || !payload || typeof payload.exp !== 'number') return { error: 'invalido' };
  if (payload.exp <= Math.floor(Date.now() / 1000)) return { error: 'vencido' };
  return { payload };
}

module.exports = { emitir, verificar };
