// Siguiente número correlativo por unidad, tipo y gestión (atómico; se reinicia cada año).
async function siguiente(client, unidadId, tipo, gestion) {
  const { rows } = await client.query(
    `INSERT INTO correlativos (unidad_id, tipo, gestion, ultimo) VALUES ($1, $2, $3, 1)
     ON CONFLICT (unidad_id, tipo, gestion) DO UPDATE SET ultimo = correlativos.ultimo + 1
     RETURNING ultimo`,
    [unidadId, tipo, gestion],
  );
  return rows[0].ultimo;
}

module.exports = { siguiente };
