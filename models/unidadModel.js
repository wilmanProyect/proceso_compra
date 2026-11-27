const db = require('../config/db');

async function listar({ soloActivas = false, ids = null } = {}) {
  const condiciones = [];
  const params = [];
  if (soloActivas) condiciones.push('activo');
  if (ids) { params.push(ids); condiciones.push(`id = ANY($${params.length})`); }
  const where = condiciones.length ? `WHERE ${condiciones.join(' AND ')}` : '';
  const { rows } = await db.query(`SELECT * FROM unidades_negocio ${where} ORDER BY id`, params);
  return rows;
}

async function obtener(id) {
  const { rows } = await db.query('SELECT * FROM unidades_negocio WHERE id=$1', [id]);
  return rows[0] || null;
}

async function departamentos(unidadId, { soloActivos = false } = {}) {
  const { rows } = await db.query(
    `SELECT * FROM departamentos WHERE unidad_id=$1 ${soloActivos ? 'AND activo' : ''} ORDER BY nombre`,
    [unidadId],
  );
  return rows;
}

async function departamentosActivos() {
  const { rows } = await db.query('SELECT id, unidad_id, nombre FROM departamentos WHERE activo ORDER BY nombre');
  return rows;
}

const CAMPOS = ['nombre', 'razon_social', 'nit', 'direccion', 'telefono', 'codigo_revision', 'lugar_entrega',
  'lugar_cobranza', 'datos_factura', 'notas_oc', 'color', 'activo'];

// Los códigos de formularios se administran en el módulo Formularios (models/formularioModel.js)
async function guardar(id, datos, logo) {
  const sets = CAMPOS.map((c, i) => `${c}=$${i + 1}`);
  const valores = CAMPOS.map((c) => datos[c]);
  if (logo) { sets.push(`logo=$${valores.length + 1}`); valores.push(logo); }
  valores.push(id);
  await db.query(`UPDATE unidades_negocio SET ${sets.join(', ')} WHERE id=$${valores.length}`, valores);
}

async function agregarDepartamento(unidadId, nombre) {
  await db.query(
    `INSERT INTO departamentos (unidad_id, nombre) VALUES ($1,$2)
     ON CONFLICT (unidad_id, nombre) DO UPDATE SET activo = TRUE`,
    [unidadId, nombre],
  );
}

async function cambiarDepartamento(unidadId, depId, activo) {
  await db.query('UPDATE departamentos SET activo=$1 WHERE id=$2 AND unidad_id=$3', [activo, depId, unidadId]);
}

module.exports = {
  listar, obtener, departamentos, departamentosActivos, guardar, agregarDepartamento, cambiarDepartamento,
};
