const db = require('../config/db');

async function listar() {
  const { rows } = await db.query(
    `SELECT r.*, COALESCE((SELECT array_agg(permiso_codigo) FROM rol_permisos WHERE rol_id = r.id), '{}') AS permisos,
            (SELECT COUNT(*)::int FROM usuarios u WHERE u.rol_id = r.id AND u.activo) AS usuarios
     FROM roles r ORDER BY r.id`,
  );
  return rows;
}

async function permisos() {
  const { rows } = await db.query('SELECT * FROM permisos ORDER BY orden');
  return rows;
}

async function guardarPermisos(asignaciones) {
  // asignaciones: { rolId: [permisos] } — el rol ADMIN no se modifica
  await db.transaccion(async (client) => {
    for (const [rolId, lista] of Object.entries(asignaciones)) {
      const { rows } = await client.query('SELECT codigo FROM roles WHERE id=$1', [rolId]);
      if (!rows.length || rows[0].codigo === 'ADMIN') continue;
      await client.query('DELETE FROM rol_permisos WHERE rol_id=$1', [rolId]);
      for (const permiso of lista) {
        await client.query(
          'INSERT INTO rol_permisos (rol_id, permiso_codigo) SELECT $1, codigo FROM permisos WHERE codigo=$2',
          [rolId, permiso],
        );
      }
    }
  });
}

module.exports = { listar, permisos, guardarPermisos };
