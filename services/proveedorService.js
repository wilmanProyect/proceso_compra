// Reglas del módulo de proveedores (RV.PCOM.02 Evaluación de Proveedores).
// Lo usan la web (controllers/proveedorController.js) y el flujo de compras (cuadro comparativo y recepción).
const db = require('../config/db');
const proveedorModel = require('../models/proveedorModel');
const procesoService = require('./procesoService');
const C = require('../utils/constantes');
const fmt = require('../utils/formato');
const { texto, numero, fecha, bool, opcion } = require('../utils/entrada');
const { ErrorValidacion, ErrorNoEncontrado, ErrorNoDisponible } = require('../utils/errores');

const ESTADOS_ELEGIBLES = Object.keys(C.ESTADOS_PROVEEDOR).filter((k) => C.ESTADOS_PROVEEDOR[k].elegible);
const NOMBRES_CAMPO = {
  razon_social: 'Razón social', nombre_comercial: 'Nombre comercial', nit: 'NIT', direccion: 'Dirección', ciudad: 'Ciudad',
  telefono: 'Teléfono', email: 'Correo', contacto: 'Contacto', cuenta_bancaria: 'Cuenta bancaria', banco: 'Banco',
  tipo_suministro: 'Productos o servicios', clasificacion: 'Clasificación',
};

function puede(usuario, permiso) { return usuario.permisos.includes(permiso); }
function exigirPermiso(usuario, permiso) {
  if (!puede(usuario, permiso)) throw new ErrorNoDisponible('No tiene permiso para realizar esta acción.');
}

// ===================== Ficha del proveedor =====================
function leerDatos(d) {
  return {
    razon_social: texto(d.razon_social, 200),
    nombre_comercial: texto(d.nombre_comercial, 200),
    nit: texto(d.nit, 40),
    direccion: texto(d.direccion, 250),
    ciudad: texto(d.ciudad, 100),
    telefono: texto(d.telefono, 60),
    email: texto(d.email, 150),
    contacto: texto(d.contacto, 150),
    cuenta_bancaria: texto(d.cuenta_bancaria, 60),
    banco: texto(d.banco, 100),
    tipo_suministro: texto(d.tipo_suministro, 2000),
    clasificacion: opcion(d.clasificacion, C.CLASIFICACIONES, null),
  };
}

async function validarDatos(datos, id = null) {
  const errores = [];
  if (!datos.razon_social) errores.push('La razón social o nombre es obligatorio.');
  if (!datos.clasificacion) errores.push('Indique si el proveedor es crítico o no crítico.');
  if (datos.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(datos.email)) errores.push('El correo electrónico no es válido.');
  if (datos.nit) {
    const otro = await proveedorModel.porNit(datos.nit);
    if (otro && String(otro.id) !== String(id)) errores.push(`Ya existe un proveedor con el NIT ${datos.nit}: ${otro.razon_social}.`);
  }
  if (errores.length) throw new ErrorValidacion(errores);
}

async function crear(usuario, d) {
  exigirPermiso(usuario, 'proveedores.gestionar');
  const datos = leerDatos(d);
  await validarDatos(datos);
  return db.transaccion(async (c) => {
    const prov = await proveedorModel.crear(c, datos, usuario.id);
    await proveedorModel.evento(c, prov.id, usuario.id, 'Proveedor registrado', `Clasificación: ${C.CLASIFICACIONES[datos.clasificacion]}`);
    return prov;
  });
}

async function editar(usuario, id, d) {
  exigirPermiso(usuario, 'proveedores.gestionar');
  const antes = await proveedorModel.obtener(id);
  if (!antes) throw new ErrorNoEncontrado('No se encontró el proveedor.');
  const datos = leerDatos(d);
  await validarDatos(datos, id);
  const cambios = Object.keys(datos).filter((k) => String(antes[k] ?? '') !== String(datos[k] ?? ''));
  if (!cambios.length) return antes;
  await db.transaccion(async (c) => {
    await proveedorModel.actualizar(c, id, datos);
    await proveedorModel.evento(c, id, usuario.id, 'Datos actualizados', cambios.map((k) => NOMBRES_CAMPO[k] || k).join(', '));
  });
  return proveedorModel.obtener(id);
}

// ===================== Estado y reevaluación (Gerencia / Administración) =====================
// nuevo: SUSPENDIDO | RETIRADO | REACTIVAR (vuelve al resultado de la última evaluación aprobada)
async function cambiarEstado(usuario, id, nuevo, motivo) {
  exigirPermiso(usuario, 'proveedores.aprobar');
  const prov = await proveedorModel.obtener(id);
  if (!prov) throw new ErrorNoEncontrado('No se encontró el proveedor.');
  const m = texto(motivo, 2000);
  if (!m) throw new ErrorValidacion(['Indique el motivo del cambio de estado.']);
  let destino;
  if (nuevo === 'REACTIVAR') {
    const { rows } = await db.query(
      `SELECT resultado FROM proveedor_evaluaciones WHERE proveedor_id=$1 AND estado='APROBADA'
       ORDER BY fecha_evaluacion DESC, id DESC LIMIT 1`,
      [id],
    );
    destino = rows[0] ? rows[0].resultado : 'NUEVO';
  } else if (['SUSPENDIDO', 'RETIRADO'].includes(nuevo)) {
    destino = nuevo;
  } else {
    throw new ErrorValidacion(['Cambio de estado no válido.']);
  }
  if (destino === prov.estado) throw new ErrorValidacion(['El proveedor ya está en ese estado.']);
  await db.transaccion(async (c) => {
    await proveedorModel.actualizar(c, id, { estado: destino });
    await proveedorModel.evento(c, id, usuario.id,
      `Estado: ${C.ESTADOS_PROVEEDOR[prov.estado].nombre} → ${C.ESTADOS_PROVEEDOR[destino].nombre}`, m);
  });
  return destino;
}

async function cambiarReevaluacion(usuario, id, nuevaFecha, motivo) {
  exigirPermiso(usuario, 'proveedores.aprobar');
  const prov = await proveedorModel.obtener(id);
  if (!prov) throw new ErrorNoEncontrado('No se encontró el proveedor.');
  const f = fecha(nuevaFecha);
  if (!f) throw new ErrorValidacion(['Indique la fecha de la próxima reevaluación.']);
  await db.transaccion(async (c) => {
    await proveedorModel.actualizar(c, id, { proxima_reevaluacion: f });
    await proveedorModel.evento(c, id, usuario.id, `Próxima reevaluación: ${fmt.fecha(f)}`, texto(motivo, 2000));
  });
}

async function incidenciaManual(usuario, id, descripcion) {
  exigirPermiso(usuario, 'proveedores.gestionar');
  const d = texto(descripcion, 4000);
  if (!d) throw new ErrorValidacion(['Describa la incidencia u observación.']);
  if (!await proveedorModel.obtener(id)) throw new ErrorNoEncontrado('No se encontró el proveedor.');
  await proveedorModel.incidencia(db, id, { tipo: 'MANUAL', descripcion: d, usuarioId: usuario.id });
}

// ===================== Evaluación y re-evaluación (RV.FCOM.02.1) =====================
async function unidadesDelUsuario(usuario) {
  return procesoService.unidadesPermitidas(usuario);
}

// Crea un borrador (o devuelve el que ya está abierto: una evaluación en curso por proveedor)
async function nuevaEvaluacion(usuario, proveedorId, unidadId) {
  exigirPermiso(usuario, 'proveedores.gestionar');
  const prov = await proveedorModel.obtener(proveedorId);
  if (!prov) throw new ErrorNoEncontrado('No se encontró el proveedor.');
  const abierta = await proveedorModel.evaluacionAbierta(proveedorId);
  if (abierta) return abierta.id;
  const unidades = await unidadesDelUsuario(usuario);
  const unidad = unidades.find((u) => u.id === Number(unidadId)) || unidades[0];
  if (!unidad) throw new ErrorValidacion(['No tiene unidades de negocio asignadas.']);
  const tipo = await proveedorModel.tieneEvaluacionAprobada(proveedorId) ? 'REEVALUACION' : 'INICIAL';
  const { rows } = await db.query(
    `INSERT INTO proveedor_evaluaciones (proveedor_id, unidad_id, tipo, fecha_evaluacion, evaluador_id, evaluador_nombre, evaluador_cargo)
     VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id`,
    [proveedorId, unidad.id, tipo, fmt.hoy(), usuario.id, usuario.nombre, usuario.cargo || usuario.rol_nombre],
  );
  await proveedorModel.evento(db, proveedorId, usuario.id, `Inició una evaluación (${C.TIPOS_TIPO_EVALUACION[tipo]})`);
  return rows[0].id;
}

// criterios: { "1": { nota: "8" | "NA" | "", comentario } }
function leerCriterios(d) {
  const enviados = d.criterios || {};
  const criterios = {};
  C.CRITERIOS_PROVEEDOR.forEach((_, i) => {
    const n = String(i + 1);
    const x = enviados[n] || enviados[`c${n}`] || {};
    const crudo = texto(x.nota, 5).toUpperCase();
    let nota;
    if (crudo === 'NA' || crudo === 'N/A') nota = null;
    else if (crudo === '') nota = undefined;
    else {
      const v = numero(crudo);
      nota = v !== null && Number.isInteger(v) && v >= 1 && v <= 10 ? v : undefined;
    }
    criterios[n] = { nota, comentario: texto(x.comentario, 1000) };
  });
  return criterios;
}

function calcularPromedio(criterios) {
  const notas = Object.values(criterios).map((c) => c.nota).filter((v) => typeof v === 'number');
  if (!notas.length) return null;
  return Math.round((notas.reduce((s, v) => s + v, 0) / notas.length) * 100) / 100;
}

function validarEnvio(criterios) {
  const errores = [];
  C.CRITERIOS_PROVEEDOR.forEach((nombre, i) => {
    const c = criterios[String(i + 1)];
    if (c.nota === undefined) errores.push(`${nombre}: califique de 1 a 10 o marque N/A.`);
    if (c.nota === null && !c.comentario) errores.push(`${nombre}: justifique en comentarios por qué no aplica.`);
  });
  if (!errores.length && calcularPromedio(criterios) === null) errores.push('Al menos un criterio debe tener calificación.');
  return errores;
}

async function guardarEvaluacion(usuario, evalId, d) {
  exigirPermiso(usuario, 'proveedores.gestionar');
  const ev = await proveedorModel.obtenerEvaluacion(evalId);
  if (!ev) throw new ErrorNoEncontrado('No se encontró la evaluación.');
  if (ev.estado !== 'BORRADOR') throw new ErrorNoDisponible('La evaluación ya fue enviada y no se puede modificar.');
  if (String(ev.evaluador_id) !== String(usuario.id)) throw new ErrorNoDisponible('Solo el evaluador puede modificar esta evaluación.');

  const enviar = bool(d.enviar);
  const unidades = await unidadesDelUsuario(usuario);
  const unidadId = unidades.some((u) => u.id === Number(d.unidad_id)) ? Number(d.unidad_id) : ev.unidad_id;
  const criterios = leerCriterios(d);
  const promedio = calcularPromedio(criterios);
  const acciones = {};
  Object.keys(C.ACCIONES_EVALUACION).forEach((k) => { if (bool((d.acciones || {})[k])) acciones[k] = true; });
  const campos = {
    unidad_id: unidadId,
    fecha_evaluacion: fecha(d.fecha_evaluacion) || ev.fecha_evaluacion,
    criterios: JSON.stringify(criterios),
    promedio,
    resultado: C.resultadoEvaluacion(promedio),
    acciones: JSON.stringify(acciones),
    observaciones: texto(d.observaciones, 4000),
  };
  const errores = enviar ? validarEnvio(criterios) : [];
  await db.transaccion(async (c) => {
    const claves = Object.keys(campos);
    await c.query(
      `UPDATE proveedor_evaluaciones SET ${claves.map((k, i) => `${k}=$${i + 1}`).join(', ')}, actualizado_en=NOW() WHERE id=$${claves.length + 1}`,
      [...claves.map((k) => campos[k]), evalId],
    );
    if (enviar && !errores.length) {
      await c.query("UPDATE proveedor_evaluaciones SET estado='POR_APROBAR', enviado_en=NOW() WHERE id=$1 AND estado='BORRADOR'", [evalId]);
      await proveedorModel.evento(c, ev.proveedor_id, usuario.id, 'Evaluación enviada a aprobación',
        `Promedio ${promedio} · ${C.RESULTADOS_EVALUACION[campos.resultado]}`);
    }
  });
  if (errores.length) throw new ErrorValidacion(errores);
  return enviar ? 'Evaluación enviada a aprobación de Gerencia / Administración.' : 'Evaluación guardada.';
}

// Estado del proveedor que resulta de aprobar la evaluación: las acciones de suspender o retirar mandan sobre el promedio
function estadoResultante(ev) {
  const acciones = ev.acciones || {};
  if (acciones.retirar) return 'RETIRADO';
  if (acciones.suspender) return 'SUSPENDIDO';
  return ev.resultado;
}

// decision: 'aprobar' (fija los meses para la próxima reevaluación) o 'devolver' (vuelve a borrador con observación)
async function aprobarEvaluacion(usuario, evalId, d) {
  exigirPermiso(usuario, 'proveedores.aprobar');
  const ev = await proveedorModel.obtenerEvaluacion(evalId);
  if (!ev) throw new ErrorNoEncontrado('No se encontró la evaluación.');
  if (ev.estado !== 'POR_APROBAR') throw new ErrorNoDisponible('La evaluación no está pendiente de aprobación.');
  if (String(ev.evaluador_id) === String(usuario.id)) throw new ErrorNoDisponible('No puede aprobar una evaluación que usted mismo realizó.');

  if (texto(d.decision, 20) === 'devolver') {
    const obs = texto(d.comentario, 2000);
    if (!obs) throw new ErrorValidacion(['Indique las observaciones para el evaluador.']);
    await db.transaccion(async (c) => {
      await c.query(
        "UPDATE proveedor_evaluaciones SET estado='BORRADOR', observacion_aprobador=$1, actualizado_en=NOW() WHERE id=$2 AND estado='POR_APROBAR'",
        [obs, evalId],
      );
      await proveedorModel.evento(c, ev.proveedor_id, usuario.id, 'Evaluación devuelta con observaciones', obs);
    });
    return 'Evaluación devuelta al evaluador con observaciones.';
  }

  const meses = numero(d.meses_reevaluacion);
  if (!Number.isInteger(meses) || meses < 1 || meses > 60) {
    throw new ErrorValidacion(['Indique en cuántos meses se reevaluará al proveedor (de 1 a 60).']);
  }
  const destino = estadoResultante(ev);
  await db.transaccion(async (c) => {
    const { rows: [{ proxima }] } = await c.query("SELECT ($1::date + make_interval(months => $2))::date::text AS proxima", [ev.fecha_evaluacion, meses]);
    const { rowCount } = await c.query(
      `UPDATE proveedor_evaluaciones SET estado='APROBADA', meses_reevaluacion=$1, proxima_reevaluacion=$2, estado_resultante=$3,
         aprobador_id=$4, aprobador_nombre=$5, aprobador_cargo=$6, aprobado_en=NOW(), observacion_aprobador=$7, actualizado_en=NOW()
       WHERE id=$8 AND estado='POR_APROBAR'`,
      [meses, proxima, destino, usuario.id, usuario.nombre, usuario.cargo || usuario.rol_nombre, texto(d.comentario, 2000), evalId],
    );
    if (!rowCount) throw new ErrorNoDisponible('La evaluación cambió de estado mientras la aprobaba.');
    await proveedorModel.actualizar(c, ev.proveedor_id, {
      estado: destino, fecha_evaluacion: ev.fecha_evaluacion, promedio: ev.promedio, proxima_reevaluacion: proxima,
    });
    await proveedorModel.evento(c, ev.proveedor_id, usuario.id, `Evaluación aprobada: ${C.ESTADOS_PROVEEDOR[destino].nombre}`,
      `Promedio ${ev.promedio} · próxima reevaluación ${fmt.fecha(proxima)} (${meses} meses)`);
  });
  return `Evaluación aprobada. El proveedor queda: ${C.ESTADOS_PROVEEDOR[destino].nombre}.`;
}

// Un borrador sin enviar se puede descartar (solo su evaluador)
async function descartarEvaluacion(usuario, evalId) {
  const ev = await proveedorModel.obtenerEvaluacion(evalId);
  if (!ev) throw new ErrorNoEncontrado('No se encontró la evaluación.');
  if (ev.estado !== 'BORRADOR' || String(ev.evaluador_id) !== String(usuario.id)) {
    throw new ErrorNoDisponible('Solo el evaluador puede descartar un borrador.');
  }
  await db.transaccion(async (c) => {
    await c.query("DELETE FROM proveedor_evaluaciones WHERE id=$1 AND estado='BORRADOR'", [evalId]);
    await proveedorModel.evento(c, ev.proveedor_id, usuario.id, 'Borrador de evaluación descartado');
  });
  return ev.proveedor_id;
}

// ===================== Integración con el proceso de compra =====================
// Resuelve el proveedor de una cotización del cuadro comparativo:
//  - proveedor_id: del registro; debe estar en un estado elegible.
//  - ocasional (o sin id, p. ej. desde la API): proveedor de emergencia (4.2.6). Se busca por NIT o nombre;
//    si no existe se registra como "Nuevo (sin evaluar)" y marcado como ocasional.
async function resolverParaCuadro(usuario, cot, procesoId) {
  const id = numero(cot.proveedor_id);
  if (id) {
    const prov = await proveedorModel.obtener(id);
    if (!prov) throw new ErrorValidacion(['El proveedor elegido no existe en el registro.']);
    if (!ESTADOS_ELEGIBLES.includes(prov.estado)) {
      throw new ErrorValidacion([`${prov.razon_social} está "${C.ESTADOS_PROVEEDOR[prov.estado].nombre}" y no se puede elegir.`]);
    }
    return prov;
  }
  const nombre = texto(cot.ocasional_nombre || cot.proveedor, 200);
  if (!nombre) return null;
  const nit = texto(cot.ocasional_nit || cot.nit, 40);
  const existente = (nit && await proveedorModel.porNit(nit)) || await proveedorModel.porNombre(nombre);
  if (existente) {
    if (!ESTADOS_ELEGIBLES.includes(existente.estado)) {
      throw new ErrorValidacion([`${existente.razon_social} está "${C.ESTADOS_PROVEEDOR[existente.estado].nombre}" y no se puede elegir.`]);
    }
    return existente;
  }
  return db.transaccion(async (c) => {
    const prov = await proveedorModel.crear(c, {
      razon_social: nombre, nombre_comercial: '', nit, direccion: '', ciudad: '', telefono: texto(cot.telefono, 60), email: '',
      contacto: texto(cot.contacto, 150), cuenta_bancaria: '', banco: '', tipo_suministro: '', clasificacion: 'NO_CRITICO', ocasional: true,
    }, usuario.id);
    await proveedorModel.evento(c, prov.id, usuario.id, 'Registrado como proveedor ocasional / de emergencia',
      procesoId ? `Desde el cuadro comparativo del proceso #${procesoId}` : '');
    return prov;
  });
}

// Seguimiento del desempeño (4.6): ítems rechazados o aceptados con observaciones en la recepción
async function registrarIncidenciasRecepcion(client, proceso, items, usuario) {
  const sel = proceso.seleccionada;
  if (!sel || !sel.proveedor_id) return;
  const codigo = fmt.codigoRequerimiento(proceso);
  for (const it of items) {
    const original = proceso.items.find((x) => String(x.id) === String(it.id)) || {};
    let tipo = null;
    if (it.rec_estado === 'Rechazado') tipo = 'RECHAZADO';
    else if (it.rec_estado === 'Aceptado con observaciones') tipo = 'OBSERVACIONES';
    if (!tipo) continue;
    const obs = it.rec_observaciones ? `: ${it.rec_observaciones}` : '';
    await proveedorModel.incidencia(client, sel.proveedor_id, {
      procesoId: proceso.id,
      tipo,
      descripcion: `${codigo} · ${original.descripcion || 'Ítem'} — ${it.rec_estado}${obs}`,
      usuarioId: usuario.id,
    });
  }
}

module.exports = {
  ESTADOS_ELEGIBLES, crear, editar, cambiarEstado, cambiarReevaluacion, incidenciaManual,
  nuevaEvaluacion, guardarEvaluacion, aprobarEvaluacion, descartarEvaluacion, estadoResultante, calcularPromedio,
  resolverParaCuadro, registrarIncidenciasRecepcion, unidadesDelUsuario,
};
