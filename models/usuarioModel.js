const db = require('../config/db');

async function obtenerSesion(id) {
  const { rows } = await db.query(
    `SELECT u.id, u.usuario, u.nombre, u.cargo, u.email, u.activo, r.codigo AS rol_codigo, r.nombre AS rol_nombre,
            COALESCE((SELECT array_agg(rp.permiso_codigo) FROM rol_permisos rp WHERE rp.rol_id = u.rol_id), '{}') AS permisos,
            COALESCE((SELECT array_agg(uu.unidad_id) FROM usuario_unidades uu WHERE uu.usuario_id = u.id), '{}') AS unidades
     FROM usuarios u JOIN roles r ON r.id = u.rol_id
     WHERE u.id = $1`,
    [id],
  );
  return rows[0] || null;
}

async function obtenerPorUsuario(usuario) {
  const { rows } = await db.query('SELECT * FROM usuarios WHERE lower(usuario) = lower($1)', [usuario]);
  return rows[0] || null;
}

async function obtener(id) {
  const { rows } = await db.query(
    `SELECT u.*, COALESCE((SELECT array_agg(uu.unidad_id) FROM usuario_unidades uu WHERE uu.usuario_id = u.id), '{}') AS unidades
     FROM usuarios u WHERE u.id = $1`,
    [id],
  );
  return rows[0] || null;
}

async function listar() {
  const { rows } = await db.query(
    `SELECT u.id, u.usuario, u.nombre, u.cargo, u.email, u.activo, u.ultimo_acceso, r.nombre AS rol_nombre,
            COALESCE((SELECT string_agg(un.sigla, ', ' ORDER BY un.id) FROM usuario_unidades uu
                      JOIN unidades_negocio un ON un.id = uu.unidad_id WHERE uu.usuario_id = u.id), '') AS unidades
     FROM usuarios u JOIN roles r ON r.id = u.rol_id
     ORDER BY u.activo DESC, u.nombre`,
  );
  return rows;
}

async function guardar(datos, id = null) {
  return db.transaccion(async (client) => {
    let usuarioId = id;
    if (id) {
      await client.query(
        `UPDATE usuarios SET usuario=$1, nombre=$2, cargo=$3, email=$4, rol_id=$5, activo=$6 WHERE id=$7`,
        [datos.usuario, datos.nombre, datos.cargo, datos.email, datos.rol_id, datos.activo, id],
      );
      if (datos.password_hash) {
        await client.query('UPDATE usuarios SET password_hash=$1 WHERE id=$2', [datos.password_hash, id]);
      }
    } else {
      const { rows } = await client.query(
        `INSERT INTO usuarios (usuario, nombre, cargo, email, rol_id, activo, password_hash)
         VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id`,
        [datos.usuario, datos.nombre, datos.cargo, datos.email, datos.rol_id, datos.activo, datos.password_hash],
      );
      usuarioId = rows[0].id;
    }
    await client.query('DELETE FROM usuario_unidades WHERE usuario_id=$1', [usuarioId]);
    for (const unidadId of datos.unidades) {
      await client.query('INSERT INTO usuario_unidades (usuario_id, unidad_id) VALUES ($1,$2)', [usuarioId, unidadId]);
    }
    return usuarioId;
  });
}

async function cambiarPassword(id, hash) {
  await db.query('UPDATE usuarios SET password_hash=$1 WHERE id=$2', [hash, id]);
}

async function registrarAcceso(id) {
  await db.query('UPDATE usuarios SET ultimo_acceso = NOW() WHERE id=$1', [id]);
}

module.exports = { obtenerSesion, obtenerPorUsuario, obtener, listar, guardar, cambiarPassword, registrarAcceso };
