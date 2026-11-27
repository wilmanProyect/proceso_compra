// Creación de solicitudes, independiente de HTTP (la usan la web y la API de la app móvil).
const db = require('../config/db');
const procesoModel = require('../models/procesoModel');
const unidadModel = require('../models/unidadModel');
const correlativo = require('../utils/correlativo');
const C = require('../utils/constantes');
const fmt = require('../utils/formato');
const {
  texto, numero, bool, lista, opcion,
} = require('../utils/entrada');
const { ErrorValidacion } = require('../utils/errores');

const RE_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
function uuid(valor) { return typeof valor === 'string' && RE_UUID.test(valor) ? valor.toLowerCase() : null; }

// Unidades en las que el usuario puede crear solicitudes
async function unidadesPermitidas(usuario) {
  if (usuario.permisos.includes('procesos.ver_todos')) return unidadModel.listar({ soloActivas: true });
  return unidadModel.listar({ soloActivas: true, ids: usuario.unidades });
}

function normalizarItems(valor) {
  return lista(valor).map((it) => ({
    uuid: uuid(it && it.uuid),
    descripcion: texto(it.descripcion, 2000),
    nro_parte: texto(it.nro_parte, 80),
    cantidad: numero(it.cantidad),
    unidad: texto(it.unidad, 30),
    destino: texto(it.destino, 150),
    observaciones: texto(it.observaciones, 1000),
    especificaciones: texto(it.especificaciones, 2000),
    proveedor_sugerido: texto(it.proveedor_sugerido, 150),
    contacto: texto(it.contacto, 150),
  })).filter((it) => it.descripcion || it.cantidad);
}

// datos: unidad_id, departamento_id, tipo_solicitud, prioridad, requiere_oc, existe_stock, monto_estimado, motivo,
//        area_receptora, comentarios, items[] y, opcionalmente, uuid (del proceso y de cada ítem) generado por la app.
// Si los datos no son válidos lanza ErrorValidacion con error.items (ítems normalizados, para rehacer el formulario).
async function crearSolicitud(usuario, d, ctx = {}) {
  const unidades = await unidadesPermitidas(usuario);
  const unidadId = Number(d.unidad_id);
  const unidad = unidades.find((u) => u.id === unidadId);
  const departamentos = unidad ? await unidadModel.departamentos(unidad.id, { soloActivos: true }) : [];
  const departamentoId = Number(d.departamento_id) || null;
  const tipo = opcion(d.tipo_solicitud, C.TIPOS_SOLICITUD);
  const items = normalizarItems(d.items);

  const errores = [];
  if (!unidad) errores.push('Seleccione la unidad de negocio.');
  if (!tipo) errores.push('Seleccione el tipo de solicitud.');
  if (departamentoId && !departamentos.some((x) => x.id === departamentoId)) errores.push('El departamento no pertenece a la unidad seleccionada.');
  if (!departamentoId) errores.push('Seleccione el departamento.');
  if (!items.length) errores.push('Agregue al menos un ítem.');
  items.forEach((it, i) => {
    if (!it.descripcion) errores.push(`Ítem ${i + 1}: la descripción es obligatoria.`);
    if (!(it.cantidad > 0)) errores.push(`Ítem ${i + 1}: la cantidad debe ser mayor a cero.`);
  });
  if (tipo === 'EQUIPO_TECNOLOGICO' && !texto(d.motivo)) errores.push('Indique el motivo de la solicitud de equipo tecnológico.');
  if (errores.length) {
    const error = new ErrorValidacion(errores);
    error.items = items;
    throw error;
  }

  const existeStock = bool(d.existe_stock);
  const gestion = fmt.gestionActual();
  const estado = existeStock ? 'CERRADO_STOCK' : 'PENDIENTE_APROBACION';
  const creado = await db.transaccion(async (client) => {
    const nro = await correlativo.siguiente(client, unidad.id, 'REQUERIMIENTO', gestion);
    const { rows } = await client.query(
      `INSERT INTO procesos (unidad_id, gestion, nro_requerimiento, estado, tipo_solicitud, solicitante_id,
         departamento_id, fecha_solicitud, prioridad, requiere_oc, existe_stock, monto_estimado, motivo,
         area_receptora, comentarios, uuid)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15, COALESCE($16::uuid, gen_random_uuid())) RETURNING id`,
      [unidad.id, gestion, nro, estado, tipo, usuario.id,
        departamentoId, fmt.hoy(), opcion(d.prioridad, C.PRIORIDADES, 'MEDIA'),
        tipo !== 'SERVICIO' && bool(d.requiere_oc), existeStock, numero(d.monto_estimado),
        texto(d.motivo, 4000), texto(d.area_receptora, 150), texto(d.comentarios, 4000), uuid(d.uuid)],
    );
    const procesoId = rows[0].id;
    for (const [i, it] of items.entries()) {
      await client.query(
        `INSERT INTO proceso_items (proceso_id, nro, descripcion, nro_parte, cantidad, unidad, destino, observaciones,
           especificaciones, proveedor_sugerido, contacto, uuid)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11, COALESCE($12::uuid, gen_random_uuid()))`,
        [procesoId, i + 1, it.descripcion, it.nro_parte, it.cantidad, it.unidad, it.destino, it.observaciones,
          it.especificaciones, it.proveedor_sugerido, it.contacto, it.uuid],
      );
    }
    const documento = tipo === 'EQUIPO_TECNOLOGICO' ? 'ACTA_TECNOLOGICO' : 'SOLICITUD';
    await procesoModel.firmar(client, procesoId, documento, 'SOLICITADO', usuario, ctx);
    await procesoModel.evento(client, procesoId, usuario.id, 'Solicitud creada', '', estado, ctx);
    if (existeStock) {
      await procesoModel.evento(client, procesoId, usuario.id, 'Existe en stock',
        'Gestionar la solicitud con el Coordinador Adm. y RRHH.', null, ctx);
    }
    return { procesoId, nro };
  });
  return {
    id: creado.procesoId,
    existeStock,
    codigo: fmt.codigoRequerimiento({ sigla: unidad.sigla, nro_requerimiento: creado.nro }),
  };
}

module.exports = { unidadesPermitidas, crearSolicitud };
