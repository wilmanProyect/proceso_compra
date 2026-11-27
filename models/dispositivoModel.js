// Dispositivos móviles con sesión. El refresh token se guarda hasheado (SHA-256) y rota en cada uso.
const db = require('../config/db');

async function registrar({ id, usuarioId, nombre, refreshHash, expira }) {
  await db.query(
    `INSERT INTO dispositivos (id, usuario_id, nombre, refresh_hash, expira_en, ultimo_uso)
     VALUES ($1,$2,$3,$4,$5,NOW())
     ON CONFLICT (id) DO UPDATE SET usuario_id=EXCLUDED.usuario_id, nombre=EXCLUDED.nombre, refresh_hash=EXCLUDED.refresh_hash,
       refresh_anterior=NULL, rotado_en=NULL, expira_en=EXCLUDED.expira_en, revocado=FALSE, ultimo_uso=NOW()`,
    [id, usuarioId, nombre, refreshHash, expira],
  );
}

async function obtener(id) {
  const { rows } = await db.query('SELECT * FROM dispositivos WHERE id=$1', [id]);
  return rows[0] || null;
}

// Guarda el hash anterior para tolerar un reintento si la respuesta del refresh se perdió
async function rotar(id, nuevoHash, expira) {
  await db.query(
    `UPDATE dispositivos SET refresh_anterior=refresh_hash, refresh_hash=$2, rotado_en=NOW(), expira_en=$3, ultimo_uso=NOW()
     WHERE id=$1`,
    [id, nuevoHash, expira],
  );
}

async function vigente(id, usuarioId) {
  const { rows } = await db.query(
    'SELECT 1 FROM dispositivos WHERE id=$1 AND usuario_id=$2 AND NOT revocado AND expira_en > NOW()',
    [id, usuarioId],
  );
  return rows.length > 0;
}

async function revocar(id) {
  await db.query('UPDATE dispositivos SET revocado=TRUE WHERE id=$1', [id]);
}

// Cierra la sesión de la app en todos los teléfonos del usuario (excepto, opcionalmente, uno)
async function revocarUsuario(usuarioId, excepto = null) {
  await db.query(
    'UPDATE dispositivos SET revocado=TRUE WHERE usuario_id=$1 AND ($2::uuid IS NULL OR id <> $2::uuid)',
    [usuarioId, excepto],
  );
}

module.exports = { registrar, obtener, rotar, vigente, revocar, revocarUsuario };
