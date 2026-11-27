// Formularios electrónicos: registro de todos los documentos y de los datos de su encabezado
// (código, versión, título y fecha). Cada cambio queda en el historial con usuario y fecha.
const db = require('../config/db');

const CAMPOS = ['tipo_documento_id', 'proceso_area', 'codigo', 'version', 'titulo', 'fecha', 'estado'];

// Formularios que usa el sistema en una unidad: { CLAVE: { codigo, version, fecha, titulo, ... } }
async function porUnidad(unidadId, client = db) {
  const { rows } = await client.query(
    'SELECT id, clave, codigo, version, titulo, fecha, estado FROM formularios WHERE unidad_id=$1 AND clave IS NOT NULL',
    [unidadId],
  );
  return Object.fromEntries(rows.map((f) => [f.clave, { ...f, revision: f.version }]));
}

async function listar(filtros = {}) {
  const params = [];
  const cond = ['TRUE'];
  if (filtros.unidad) { params.push(filtros.unidad); cond.push(`f.unidad_id = $${params.length}`); }
  if (filtros.tipo) { params.push(filtros.tipo); cond.push(`f.tipo_documento_id = $${params.length}`); }
  if (filtros.estado) { params.push(filtros.estado); cond.push(`f.estado = $${params.length}`); }
  if (filtros.q) {
    params.push(`%${filtros.q}%`);
    cond.push(`(f.codigo ILIKE $${params.length} OR f.titulo ILIKE $${params.length} OR f.proceso_area ILIKE $${params.length})`);
  }
  const { rows } = await db.query(
    `SELECT f.*, u.sigla, u.nombre AS unidad_nombre, t.nombre AS tipo_nombre,
            h.usuario_nombre AS ultimo_usuario, h.fecha AS ultimo_cambio,
            (SELECT COUNT(*)::int FROM formularios x WHERE x.unidad_id = f.unidad_id AND lower(x.codigo) = lower(f.codigo)) AS repetidos
     FROM formularios f
     JOIN unidades_negocio u ON u.id = f.unidad_id
     LEFT JOIN tipos_documento t ON t.id = f.tipo_documento_id
     LEFT JOIN LATERAL (SELECT usuario_nombre, fecha FROM formularios_historial WHERE formulario_id = f.id ORDER BY fecha DESC, id DESC LIMIT 1) h ON TRUE
     WHERE ${cond.join(' AND ')}
     ORDER BY u.id, f.codigo, f.id`,
    params,
  );
  return rows;
}

async function obtener(id) {
  const { rows } = await db.query(
    `SELECT f.*, u.sigla, u.nombre AS unidad_nombre FROM formularios f JOIN unidades_negocio u ON u.id = f.unidad_id WHERE f.id=$1`,
    [id],
  );
  return rows[0] || null;
}

async function historial(id) {
  const { rows } = await db.query('SELECT * FROM formularios_historial WHERE formulario_id=$1 ORDER BY fecha DESC, id DESC', [id]);
  return rows;
}

// Guarda y registra en el historial solo los campos que cambiaron
async function guardar(datos, id, usuario) {
  return db.transaccion(async (c) => {
    if (!id) {
      const { rows } = await c.query(
        `INSERT INTO formularios (unidad_id, tipo_documento_id, proceso_area, codigo, version, titulo, fecha, estado, actualizado_por)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING id`,
        [datos.unidad_id, datos.tipo_documento_id, datos.proceso_area, datos.codigo, datos.version, datos.titulo,
          datos.fecha, datos.estado, usuario.id],
      );
      await c.query(
        'INSERT INTO formularios_historial (formulario_id, usuario_id, usuario_nombre, accion) VALUES ($1,$2,$3,$4)',
        [rows[0].id, usuario.id, usuario.nombre, 'CREADO'],
      );
      return rows[0].id;
    }
    const { rows: [antes] } = await c.query('SELECT * FROM formularios WHERE id=$1 FOR UPDATE', [id]);
    const cambios = {};
    CAMPOS.forEach((campo) => {
      const a = antes[campo] === null || antes[campo] === undefined ? '' : String(antes[campo]);
      const d = datos[campo] === null || datos[campo] === undefined ? '' : String(datos[campo]);
      if (a !== d) cambios[campo] = [a, d];
    });
    if (!Object.keys(cambios).length) return id;
    await c.query(
      `UPDATE formularios SET tipo_documento_id=$1, proceso_area=$2, codigo=$3, version=$4, titulo=$5, fecha=$6, estado=$7,
         actualizado_por=$8, actualizado_en=NOW() WHERE id=$9`,
      [datos.tipo_documento_id, datos.proceso_area, datos.codigo, datos.version, datos.titulo, datos.fecha, datos.estado, usuario.id, id],
    );
    await c.query(
      'INSERT INTO formularios_historial (formulario_id, usuario_id, usuario_nombre, accion, cambios) VALUES ($1,$2,$3,$4,$5)',
      [id, usuario.id, usuario.nombre, 'MODIFICADO', JSON.stringify(cambios)],
    );
    return id;
  });
}

async function tiposDocumento({ soloActivos = false } = {}) {
  const { rows } = await db.query(`SELECT * FROM tipos_documento ${soloActivos ? 'WHERE activo' : ''} ORDER BY nombre`);
  return rows;
}

async function agregarTipo(nombre) {
  await db.query('INSERT INTO tipos_documento (nombre) VALUES ($1) ON CONFLICT (nombre) DO UPDATE SET activo = TRUE', [nombre]);
}

async function cambiarTipo(id, activo) {
  await db.query('UPDATE tipos_documento SET activo=$1 WHERE id=$2', [activo, id]);
}

module.exports = {
  porUnidad, listar, obtener, historial, guardar, tiposDocumento, agregarTipo, cambiarTipo,
};
