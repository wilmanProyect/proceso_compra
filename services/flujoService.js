// Acciones del flujo de compras, independientes de HTTP: las usan la web (formularios) y la API (app móvil).
// Cada acción recibe (usuario, proceso, datos, ctx) con datos ya normalizados y valida todo de nuevo.
const db = require('../config/db');
const procesoModel = require('../models/procesoModel');
const unidadModel = require('../models/unidadModel');
const correlativo = require('../utils/correlativo');
const C = require('../utils/constantes');
const fmt = require('../utils/formato');
const { texto, numero, fecha, bool, opcion } = require('../utils/entrada');
const {
  ErrorValidacion, ErrorFlujo, ErrorNoEncontrado, ErrorSinAcceso, ErrorNoDisponible,
} = require('../utils/errores');
const { calcularAcciones } = require('./acciones');
const proveedorService = require('./proveedorService');

function exigir(valor, mensaje, max = 4000) {
  const v = texto(valor, max);
  if (!v) throw new ErrorValidacion([mensaje]);
  return v;
}

function comentario(d) { return texto(d.comentario, 4000); }
function decision(d) { return texto(d.decision, 20); }
function documentoSolicitud(p) { return p.tipo_solicitud === 'EQUIPO_TECNOLOGICO' ? 'ACTA_TECNOLOGICO' : 'SOLICITUD'; }
function montoBs(p, total) { return p.moneda === 'USD' ? total * Number(p.tipo_cambio) : total; }

// ===================== Fase 1 =====================
async function anular(u, p, d, ctx) {
  await db.transaccion((c) => procesoModel.transicion(c, p.id, 'PENDIENTE_APROBACION', 'ANULADO', u.id, 'Solicitud anulada', texto(d.comentario, 2000), ctx));
  return 'Solicitud anulada.';
}

async function aprobarSolicitud(u, p, d, ctx) {
  if (decision(d) === 'rechazar') {
    const motivo = exigir(d.comentario, 'Indique el motivo del rechazo para comunicarlo al Coordinador de Área.');
    await db.transaccion(async (c) => {
      await procesoModel.actualizar(c, p.id, { motivo_rechazo: motivo });
      await procesoModel.transicion(c, p.id, 'PENDIENTE_APROBACION', 'RECHAZADO', u.id, 'Solicitud rechazada en revisión presupuestaria', motivo, ctx);
    });
    return 'Solicitud rechazada. El solicitante verá el motivo en el proceso.';
  }
  await db.transaccion(async (c) => {
    await procesoModel.firmar(c, p.id, documentoSolicitud(p), 'AUTORIZADO', u, ctx);
    await procesoModel.transicion(c, p.id, 'PENDIENTE_APROBACION', 'EN_COTIZACION', u.id, 'Revisión presupuestaria aprobada', comentario(d), ctx);
  });
  return 'Solicitud aprobada. Pasa a gestión de cotizaciones.';
}

// datos.cotizaciones = [{ orden (1-3), proveedor, contacto, telefono, criterios: {1: 8, ...}, precios: {itemId: precio}, seleccionada }]
function normalizarCuadro(p, d) {
  const usadas = new Set();
  let haySeleccionada = false;
  const cotizaciones = [];
  [].concat(d.cotizaciones || []).forEach((cot) => {
    const orden = Number(cot && cot.orden);
    const proveedor = texto(cot && cot.proveedor, 200);
    if (!Number.isInteger(orden) || orden < 1 || orden > 3 || usadas.has(orden) || !proveedor) return;
    usadas.add(orden);
    const criterios = {};
    const crit = cot.criterios || {};
    C.CRITERIOS.forEach((_, n) => {
      const v = numero(crit[n + 1]);
      if (v !== null) criterios[n + 1] = Math.max(0, Math.min(10, v));
    });
    const precios = {};
    const pr = cot.precios || {};
    p.items.forEach((it) => {
      const v = numero(pr[it.id]);
      if (v !== null && v >= 0) precios[it.id] = v;
    });
    const total = p.items.reduce((s, it) => s + (precios[it.id] || 0) * Number(it.cantidad), 0);
    // Solo un proveedor adjudicado
    const seleccionada = bool(cot.seleccionada) && !haySeleccionada;
    if (seleccionada) haySeleccionada = true;
    const reg = cot.registro || {};
    cotizaciones.push({
      orden,
      proveedor,
      proveedor_id: cot.proveedor_id || null,
      registro: reg,
      contacto: texto(cot.contacto, 150) || reg.contacto || '',
      telefono: texto(cot.telefono, 60) || reg.telefono || '',
      criterios,
      precios,
      total,
      seleccionada,
    });
  });
  cotizaciones.sort((a, b) => a.orden - b.orden);
  return {
    moneda: opcion(d.moneda, C.MONEDAS, 'BS'),
    tipo_cambio: numero(d.tipo_cambio) > 0 ? numero(d.tipo_cambio) : 6.96,
    fecha_evaluacion: fecha(d.fecha_evaluacion) || fmt.hoy(),
    justificacion: texto(d.justificacion, 4000),
    cotizaciones,
  };
}

async function persistirCuadro(u, p, datos, enviar, ctx) {
  await db.transaccion(async (c) => {
    await procesoModel.actualizar(c, p.id, {
      moneda: datos.moneda, tipo_cambio: datos.tipo_cambio, fecha_evaluacion: datos.fecha_evaluacion, justificacion: datos.justificacion,
    });
    // Se actualiza cada cotización en su lugar (por orden) para conservar su id y uuid (la app móvil los usa).
    // Los datos bancarios se conservan solo si el proveedor de esa posición no cambió.
    const previas = Object.fromEntries(p.cotizaciones.map((x) => [x.orden, x]));
    await c.query(
      'DELETE FROM cotizaciones WHERE proceso_id=$1 AND NOT (orden = ANY($2::int[]))',
      [p.id, datos.cotizaciones.map((cot) => cot.orden)],
    );
    for (const cot of datos.cotizaciones) {
      const mismo = previas[cot.orden] && String(previas[cot.orden].proveedor_id || '') === String(cot.proveedor_id || '')
        && previas[cot.orden].proveedor === cot.proveedor;
      const prev = mismo ? previas[cot.orden] : (cot.registro || {});
      const { rows } = await c.query(
        `INSERT INTO cotizaciones (proceso_id, orden, proveedor, contacto, telefono, nit, email, cuenta_bancaria, banco, seleccionada, criterios, proveedor_id)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
         ON CONFLICT (proceso_id, orden) DO UPDATE SET
           proveedor=EXCLUDED.proveedor, contacto=EXCLUDED.contacto, telefono=EXCLUDED.telefono, nit=EXCLUDED.nit,
           email=EXCLUDED.email, cuenta_bancaria=EXCLUDED.cuenta_bancaria, banco=EXCLUDED.banco,
           seleccionada=EXCLUDED.seleccionada, criterios=EXCLUDED.criterios, proveedor_id=EXCLUDED.proveedor_id
         RETURNING id`,
        [p.id, cot.orden, cot.proveedor, cot.contacto, cot.telefono, prev.nit || '', prev.email || '',
          prev.cuenta_bancaria || '', prev.banco || '', cot.seleccionada, JSON.stringify(cot.criterios), cot.proveedor_id || null],
      );
      await c.query('DELETE FROM cotizacion_precios WHERE cotizacion_id=$1', [rows[0].id]);
      for (const [itemId, precio] of Object.entries(cot.precios)) {
        await c.query('INSERT INTO cotizacion_precios (cotizacion_id, item_id, precio_unitario) VALUES ($1,$2,$3)', [rows[0].id, itemId, precio]);
      }
    }
    if (!p.firmas[`${documentoSolicitud(p)}.RECIBIDO`]) {
      await procesoModel.firmar(c, p.id, documentoSolicitud(p), 'RECIBIDO', u, ctx);
    }
    if (enviar) {
      await procesoModel.firmar(c, p.id, 'CUADRO', 'EVALUADOR', u, ctx);
      await procesoModel.transicion(c, p.id, 'EN_COTIZACION', 'COTIZACION_POR_APROBAR', u.id, 'Cuadro comparativo enviado a aprobación', '', ctx);
    }
  });
}

// datos.enviar = true envía a aprobación; si no, guarda borrador. Si el envío no es válido, guarda el borrador igual.
// Cada cotización se vincula a un proveedor del registro (o a uno ocasional de emergencia, 4.2.6)
async function resolverProveedores(u, p, d) {
  const cotizaciones = [];
  const vistos = new Set();
  for (const cot of [].concat(d.cotizaciones || [])) {
    if (!cot) continue;
    const prov = await proveedorService.resolverParaCuadro(u, cot, p.id);
    if (!prov) continue;
    if (vistos.has(String(prov.id))) throw new ErrorValidacion([`${prov.razon_social} está repetido en el cuadro: cada cotización debe ser de un proveedor distinto.`]);
    vistos.add(String(prov.id));
    cotizaciones.push({ ...cot, proveedor: prov.razon_social, proveedor_id: prov.id, registro: prov });
  }
  return { ...d, cotizaciones };
}

async function guardarCuadro(u, p, d, ctx) {
  const datos = normalizarCuadro(p, await resolverProveedores(u, p, d));
  const enviar = bool(d.enviar);
  if (enviar) {
    const errores = [];
    const sel = datos.cotizaciones.find((c) => c.seleccionada);
    if (!datos.cotizaciones.length) errores.push('Registre al menos un proveedor.');
    if (!sel) errores.push('Seleccione el proveedor adjudicado.');
    if (sel && p.items.some((it) => sel.precios[it.id] === undefined)) errores.push('El proveedor adjudicado debe tener precio en todos los ítems.');
    if (!datos.justificacion) errores.push('Escriba la justificación de la adjudicación.');
    if (sel) {
      const monto = montoBs({ ...p, ...datos }, sel.total);
      const requeridas = C.cotizacionesRequeridas(monto);
      const necesarias = Math.max(1, requeridas);
      if (datos.cotizaciones.length < necesarias && !p.excepcion_cotizaciones) {
        errores.push(`Para un monto de Bs ${fmt.dinero(monto)} se requieren ${requeridas} cotización(es) formal(es) y hay ${datos.cotizaciones.length}. `
          + 'El proceso está bloqueado: complete las cotizaciones o solicite a Gerencia una excepción.');
      }
    }
    if (errores.length) {
      await persistirCuadro(u, p, datos, false, ctx);
      throw new ErrorValidacion(errores);
    }
  }
  await persistirCuadro(u, p, datos, enviar, ctx);
  return enviar ? 'Cuadro comparativo enviado a aprobación de Gerencia.' : 'Cuadro comparativo guardado.';
}

async function desbloquear(u, p, d, ctx) {
  const motivo = exigir(d.motivo, 'Indique el motivo de la excepción.');
  await db.transaccion(async (c) => {
    await procesoModel.actualizar(c, p.id, {
      excepcion_cotizaciones: true, excepcion_motivo: motivo, excepcion_usuario_id: u.id, excepcion_fecha: new Date(),
    });
    await procesoModel.evento(c, p.id, u.id, 'Excepción autorizada: se permite continuar sin el número mínimo de cotizaciones', motivo, null, ctx);
  });
  return 'Excepción registrada. El proceso puede continuar sin el número mínimo de cotizaciones.';
}

async function aprobarCuadro(u, p, d, ctx) {
  if (decision(d) === 'observar') {
    const obs = exigir(d.comentario, 'Indique las observaciones para el Responsable de Compras.');
    await db.transaccion(async (c) => {
      await procesoModel.quitarFirma(c, p.id, 'CUADRO', 'EVALUADOR');
      await procesoModel.transicion(c, p.id, 'COTIZACION_POR_APROBAR', 'EN_COTIZACION', u.id, 'Cuadro comparativo observado', obs, ctx);
    });
    return 'Cuadro devuelto con observaciones.';
  }
  const unidad = await unidadModel.obtener(p.unidad_id);
  await db.transaccion(async (c) => {
    await procesoModel.firmar(c, p.id, 'CUADRO', 'APROBADO', u, ctx);
    if (p.requiere_oc) {
      await procesoModel.actualizar(c, p.id, {
        oc_lugar_entrega: p.oc_lugar_entrega || unidad.lugar_entrega,
        oc_lugar_cobranza: p.oc_lugar_cobranza || unidad.lugar_cobranza,
        oc_datos_factura: p.oc_datos_factura || [unidad.razon_social, unidad.nit && `NIT: ${unidad.nit}`].filter(Boolean).join(' - '),
      });
      await procesoModel.transicion(c, p.id, 'COTIZACION_POR_APROBAR', 'OC_EN_PREPARACION', u.id, 'Cuadro comparativo aprobado', comentario(d), ctx);
    } else {
      await procesoModel.transicion(c, p.id, 'COTIZACION_POR_APROBAR', 'EN_SEGUIMIENTO', u.id,
        'Cuadro comparativo aprobado (no requiere orden de compra)', comentario(d), ctx);
    }
  });
  return p.requiere_oc ? 'Cuadro aprobado. Pasa a emisión de la orden de compra.' : 'Cuadro aprobado. Pasa a seguimiento de la compra.';
}

// Completa los datos vacíos del proveedor en el registro con los que se cargaron en la OC (nunca sobrescribe)
async function completarRegistro(c, proveedorId, prov) {
  const { rows: [reg] } = await c.query('SELECT * FROM proveedores WHERE id=$1', [proveedorId]);
  if (!reg) return;
  const cambios = {};
  ['telefono', 'contacto', 'email', 'cuenta_bancaria', 'banco'].forEach((k) => {
    const v = texto(prov[k], 150);
    if (!reg[k] && v) cambios[k] = v;
  });
  const nit = texto(prov.nit, 40);
  if (!reg.nit && nit) {
    const { rows } = await c.query("SELECT 1 FROM proveedores WHERE lower(nit)=lower($1) AND nit <> '' AND id <> $2", [nit, proveedorId]);
    if (!rows.length) cambios.nit = nit;
  }
  const claves = Object.keys(cambios);
  if (!claves.length) return;
  await c.query(
    `UPDATE proveedores SET ${claves.map((k, i) => `${k}=$${i + 1}`).join(', ')}, actualizado_en=NOW() WHERE id=$${claves.length + 1}`,
    [...claves.map((k) => cambios[k]), proveedorId],
  );
}

// datos.emitir = true emite la OC (asigna número); datos.proveedor = { nit, telefono, contacto, email, cuenta_bancaria, banco }
async function guardarOc(u, p, d, ctx) {
  const sel = p.seleccionada;
  const prov = d.proveedor || {};
  const descuento = Math.max(0, numero(d.oc_descuento) || 0);
  const campos = {
    prioridad: opcion(d.prioridad, C.PRIORIDADES, p.prioridad),
    oc_plazo_entrega: texto(d.oc_plazo_entrega, 200),
    oc_condicion_pago: texto(d.oc_condicion_pago, 200),
    oc_lugar_entrega: texto(d.oc_lugar_entrega, 250),
    oc_lugar_cobranza: texto(d.oc_lugar_cobranza, 250),
    oc_certificado: texto(d.oc_certificado, 250),
    oc_datos_factura: texto(d.oc_datos_factura, 2000),
    oc_descuento: descuento,
    oc_comentarios: texto(d.oc_comentarios, 4000),
  };
  const emitir = bool(d.emitir);
  const errores = [];
  if (emitir) {
    if (!sel) errores.push('No hay proveedor adjudicado en el cuadro comparativo.');
    if (!campos.oc_plazo_entrega) errores.push('Indique el plazo o fecha de entrega.');
    if (!campos.oc_condicion_pago) errores.push('Indique la condición de pago.');
    if (!campos.oc_lugar_entrega) errores.push('Indique el lugar de entrega.');
    if (sel && descuento > sel.total) errores.push('El descuento no puede ser mayor al monto total.');
  }

  await db.transaccion(async (c) => {
    await procesoModel.actualizar(c, p.id, campos);
    if (sel) {
      await c.query(
        'UPDATE cotizaciones SET nit=$1, telefono=$2, contacto=$3, email=$4, cuenta_bancaria=$5, banco=$6 WHERE id=$7',
        [texto(prov.nit, 40), texto(prov.telefono, 60), texto(prov.contacto, 150), texto(prov.email, 150),
          texto(prov.cuenta_bancaria, 60), texto(prov.banco, 100), sel.id],
      );
      if (sel.proveedor_id) await completarRegistro(c, sel.proveedor_id, prov);
    }
    if (emitir && !errores.length) {
      if (!p.oc_numero) {
        const gestion = fmt.gestionActual();
        const numeroOc = await correlativo.siguiente(c, p.unidad_id, 'ORDEN_COMPRA', gestion);
        await procesoModel.actualizar(c, p.id, { oc_numero: numeroOc, oc_gestion: gestion, oc_fecha_emision: fmt.hoy() });
      }
      await procesoModel.firmar(c, p.id, 'ORDEN_COMPRA', 'SOLICITADO', u, ctx);
      await procesoModel.transicion(c, p.id, 'OC_EN_PREPARACION', 'OC_POR_AUTORIZAR', u.id, 'Orden de compra emitida, pendiente de autorización', '', ctx);
    }
  });
  if (errores.length) throw new ErrorValidacion(errores);
  return emitir ? 'Orden de compra emitida y enviada a autorización de Gerencia.' : 'Orden de compra guardada.';
}

async function autorizarOc(u, p, d, ctx) {
  if (decision(d) === 'observar') {
    const obs = exigir(d.comentario, 'Indique las observaciones de la orden de compra.');
    await db.transaccion(async (c) => {
      await procesoModel.quitarFirma(c, p.id, 'ORDEN_COMPRA', 'SOLICITADO');
      await procesoModel.transicion(c, p.id, 'OC_POR_AUTORIZAR', 'OC_EN_PREPARACION', u.id, 'Orden de compra observada', obs, ctx);
    });
    return 'Orden de compra devuelta con observaciones.';
  }
  await db.transaccion(async (c) => {
    await procesoModel.firmar(c, p.id, 'ORDEN_COMPRA', 'AUTORIZADO', u, ctx);
    await procesoModel.transicion(c, p.id, 'OC_POR_AUTORIZAR', 'EN_SEGUIMIENTO', u.id, 'Orden de compra autorizada', comentario(d), ctx);
  });
  return `Orden de compra ${fmt.codigoOc(p)} autorizada.`;
}

async function seguimiento(u, p, d, ctx) {
  const nota = exigir(d.comentario, 'Escriba la nota de seguimiento.');
  await procesoModel.evento(db, p.id, u.id, 'Seguimiento', nota, null, ctx);
  return 'Seguimiento registrado.';
}

async function cerrarServicio(u, p, d, ctx) {
  const conclusion = exigir(d.comentario, 'Describa la conclusión del servicio.');
  await db.transaccion(async (c) => {
    await procesoModel.actualizar(c, p.id, { cierre_comentario: conclusion });
    await procesoModel.transicion(c, p.id, 'EN_SEGUIMIENTO', 'CERRADO', u.id, 'Servicio concluido y proceso cerrado', conclusion, ctx);
  });
  return 'Proceso de servicio cerrado.';
}

// ===================== Fase 2 =====================
// datos.items = { itemId: { codigo_serie, modelo, cantidad, estado, observaciones } }; datos.enviar = true envía a aprobación
async function guardarRecepcion(u, p, d, ctx) {
  const enviar = bool(d.enviar);
  const campos = {
    rec_fecha: fecha(d.rec_fecha),
    rec_nro_factura: texto(d.rec_nro_factura, 80),
    rec_tipo_bien: opcion(d.rec_tipo_bien, C.TIPOS_BIEN, ''),
    rec_cantidad_ok: bool(d.rec_cantidad_ok),
    rec_estado_ok: bool(d.rec_estado_ok),
    rec_documentacion_ok: bool(d.rec_documentacion_ok),
    rec_accesorios_ok: bool(d.rec_accesorios_ok),
    rec_especificaciones_ok: bool(d.rec_especificaciones_ok),
    rec_comentarios: texto(d.rec_comentarios, 4000),
  };
  const enviados = d.items || {};
  const items = p.items.map((it) => {
    const x = enviados[it.id] || {};
    const est = texto(x.estado, 40);
    return {
      id: it.id,
      rec_codigo_serie: texto(x.codigo_serie, 120),
      rec_modelo: texto(x.modelo, 120),
      rec_cantidad: numero(x.cantidad),
      rec_estado: C.ESTADOS_INSPECCION.includes(est) ? est : '',
      rec_observaciones: texto(x.observaciones, 1000),
    };
  });
  const errores = [];
  if (enviar) {
    if (!campos.rec_fecha) errores.push('Indique la fecha de recepción.');
    if (!campos.rec_tipo_bien) errores.push('Seleccione el tipo de bien.');
    items.forEach((it, i) => {
      if (it.rec_cantidad === null || it.rec_cantidad < 0) errores.push(`Ítem ${i + 1}: indique la cantidad recibida.`);
      if (!it.rec_estado) errores.push(`Ítem ${i + 1}: indique el estado de inspección.`);
    });
  }
  await db.transaccion(async (c) => {
    await procesoModel.actualizar(c, p.id, campos);
    for (const it of items) {
      await c.query(
        `UPDATE proceso_items SET rec_codigo_serie=$1, rec_modelo=$2, rec_cantidad=$3, rec_estado=$4, rec_observaciones=$5
         WHERE id=$6 AND proceso_id=$7`,
        [it.rec_codigo_serie, it.rec_modelo, it.rec_cantidad, it.rec_estado, it.rec_observaciones, it.id, p.id],
      );
    }
    if (enviar && !errores.length) {
      await procesoModel.firmar(c, p.id, 'RECEPCION', 'RECEPCIONADO', u, ctx);
      await proveedorService.registrarIncidenciasRecepcion(c, p, items, u);
      // Sin revisión ni aprobación, y sin comprobante de ingreso: pasa directo a emitir la nota de entrega
      await procesoModel.transicion(c, p.id, 'EN_SEGUIMIENTO', 'EN_ALMACEN', u.id, 'Registro de inspección y recepción completado', '', ctx);
    }
  });
  if (errores.length) throw new ErrorValidacion(errores);
  return enviar ? 'Recepción registrada. Pasa al Coord. Adm. y RRHH para emitir la nota de entrega.' : 'Recepción guardada.';
}

// datos.items = { itemId: { cantidad } }; datos.entregar = true emite la nota de entrega (asigna número) y cierra el proceso
async function entrega(u, p, d, ctx) {
  const entregar = bool(d.entregar);
  const campos = {
    ne_fecha: fecha(d.ne_fecha),
    ne_entregado_a: texto(d.ne_entregado_a, 150),
  };
  const enviados = d.items || {};
  const items = p.items.map((it) => ({ id: it.id, cantidad: numero((enviados[it.id] || {}).cantidad) }));
  const errores = [];
  if (entregar) {
    if (!campos.ne_fecha) errores.push('Indique la fecha de entrega.');
    if (!campos.ne_entregado_a) errores.push('Indique a quién se entrega.');
    if (!items.some((it) => it.cantidad > 0)) errores.push('Indique la cantidad entregada de al menos un ítem.');
  }
  await db.transaccion(async (c) => {
    await procesoModel.actualizar(c, p.id, campos);
    for (const it of items) {
      await c.query('UPDATE proceso_items SET ne_cantidad=$1 WHERE id=$2 AND proceso_id=$3', [it.cantidad, it.id, p.id]);
    }
    if (entregar && !errores.length) {
      if (!p.ne_numero) {
        const gestion = fmt.gestionActual();
        const nro = await correlativo.siguiente(c, p.unidad_id, 'NOTA_ENTREGA', gestion);
        await procesoModel.actualizar(c, p.id, { ne_numero: nro, ne_gestion: gestion });
      }
      await procesoModel.firmar(c, p.id, 'NOTA_ENTREGA', 'ENTREGADO', u, ctx);
      await procesoModel.transicion(c, p.id, 'EN_ALMACEN', 'CERRADO', u.id, `Nota de entrega emitida: material entregado a ${campos.ne_entregado_a}. Proceso cerrado`, '', ctx);
    }
  });
  if (errores.length) throw new ErrorValidacion(errores);
  return entregar ? 'Nota de entrega emitida. Proceso cerrado.' : 'Nota de entrega guardada.';
}

async function confirmarEntrega(u, p, d, ctx) {
  await db.transaccion(async (c) => {
    await procesoModel.firmar(c, p.id, 'NOTA_ENTREGA', 'RECIBIDO', u, ctx);
    await procesoModel.evento(c, p.id, u.id, 'Solicitante confirmó la recepción del material', '', null, ctx);
  });
  return 'Recepción confirmada.';
}

// bandera: clave de calcularAcciones que habilita la acción.
// soloEnLinea: aprobaciones y decisiones. Por decisión del negocio requieren internet: la app no las pone en la
// cola sin conexión y la sincronización (/sync/push) las rechaza. Ver docs/APP_MOVIL.md.
const ACCIONES = {
  anular: { bandera: 'anular', ejecutar: anular },
  aprobarSolicitud: { bandera: 'aprobarSolicitud', soloEnLinea: true, ejecutar: aprobarSolicitud },
  guardarCuadro: { bandera: 'editarCuadro', ejecutar: guardarCuadro },
  desbloquear: { bandera: 'desbloquear', soloEnLinea: true, ejecutar: desbloquear },
  aprobarCuadro: { bandera: 'aprobarCuadro', soloEnLinea: true, ejecutar: aprobarCuadro },
  guardarOc: { bandera: 'editarOc', ejecutar: guardarOc },
  autorizarOc: { bandera: 'autorizarOc', soloEnLinea: true, ejecutar: autorizarOc },
  seguimiento: { bandera: 'seguimiento', ejecutar: seguimiento },
  cerrarServicio: { bandera: 'cerrarServicio', ejecutar: cerrarServicio },
  guardarRecepcion: { bandera: 'editarRecepcion', ejecutar: guardarRecepcion },
  entrega: { bandera: 'entrega', ejecutar: entrega },
  confirmarEntrega: { bandera: 'confirmarEntrega', ejecutar: confirmarEntrega },
};

const ACCIONES_SOLO_EN_LINEA = Object.keys(ACCIONES).filter((k) => ACCIONES[k].soloEnLinea);

// Carga el proceso, verifica visibilidad, estado esperado y permiso, y ejecuta la acción.
// datos puede ser una función (proceso) => datos, para traducir referencias (p. ej. uuid de ítems) con el proceso cargado.
// ctx = { origen: 'WEB' | 'MOVIL', fechaCliente, estadoEsperado }
async function ejecutar(usuario, procesoId, nombre, datos = {}, ctx = {}) {
  const def = ACCIONES[nombre];
  if (!def) throw new Error(`Acción desconocida: ${nombre}`);
  const id = Number(procesoId);
  if (!Number.isInteger(id) || id <= 0) throw new ErrorNoEncontrado();
  const proceso = await procesoModel.obtenerCompleto(id);
  if (!proceso) throw new ErrorNoEncontrado();
  if (!procesoModel.puedeVer(usuario, proceso)) throw new ErrorSinAcceso();
  if (ctx.estadoEsperado && ctx.estadoEsperado !== proceso.estado) {
    throw new ErrorFlujo(`El proceso ya no está en "${(C.ESTADOS[ctx.estadoEsperado] || {}).nombre || ctx.estadoEsperado}"; `
      + `ahora está en "${(C.ESTADOS[proceso.estado] || {}).nombre || proceso.estado}".`);
  }
  if (!calcularAcciones(usuario, proceso)[def.bandera]) throw new ErrorNoDisponible();
  const d = (typeof datos === 'function' ? datos(proceso) : datos) || {};
  const mensaje = await def.ejecutar(usuario, proceso, d, { origen: 'WEB', ...ctx });
  return { mensaje, procesoId: proceso.id };
}

module.exports = { ACCIONES, ACCIONES_SOLO_EN_LINEA, ejecutar };
