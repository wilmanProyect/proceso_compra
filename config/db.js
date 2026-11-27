const { Pool, types } = require('pg');

// DATE (1082) como texto 'YYYY-MM-DD' para evitar desfases de zona horaria
types.setTypeParser(1082, (valor) => valor);

const pool = new Pool({
  host: process.env.DB_HOST || 'localhost',
  port: Number(process.env.DB_PORT) || 5432,
  database: process.env.DB_NAME || 'proceso_compra',
  user: process.env.DB_USER || 'proceso_compra',
  password: process.env.DB_PASSWORD || 'cambia_esta_contrasena',
});

pool.on('error', (error) => {
  console.error('Error inesperado en una conexion inactiva de PostgreSQL:', error);
});

// Ejecuta fn(client) dentro de una transacción
pool.transaccion = async function transaccion(fn) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const resultado = await fn(client);
    await client.query('COMMIT');
    return resultado;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
};

module.exports = pool;
