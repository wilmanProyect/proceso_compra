// Prueba del módulo de proveedores y de formularios electrónicos.
// Uso: BASE=http://localhost:3299 ADMIN_PASSWORD=admin123 node tests/proveedores.js
// ATENCIÓN: crea usuarios, proveedores y procesos de prueba. Úsela solo en una base de pruebas.
const BASE = process.env.BASE || 'http://localhost:3000';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'admin123';
const sufijo = Date.now().toString(36).slice(-4);

class Cliente {
  constructor() { this.cookie = ''; this.csrf = ''; }
  async req(ruta, opts = {}) {
    const r = await fetch(BASE + ruta, { redirect: 'manual', ...opts, headers: { ...(opts.headers || {}), cookie: this.cookie } });
    (r.headers.getSetCookie ? r.headers.getSetCookie() : []).forEach((c) => {
      const kv = c.split(';')[0];
      if (kv.startsWith('pc.sid=')) this.cookie = kv;
    });
    const texto = await r.text();
    const m = texto.match(/name="_csrf" value="([^"]+)"/);
    if (m) this.csrf = m[1];
    return { status: r.status, location: r.headers.get('location'), texto, tipo: r.headers.get('content-type') };
  }
  get(ruta) { return this.req(ruta); }
  async post(ruta, datos = {}) {
    if (!this.csrf) await this.get('/login');
    const body = new URLSearchParams();
    for (const [k, v] of Object.entries(datos)) [].concat(v).forEach((x) => body.append(k, x));
    body.append('_csrf', this.csrf);
    return this.req(ruta, { method: 'POST', body, headers: { 'content-type': 'application/x-www-form-urlencoded' } });
  }
  postMultipart(ruta, form) { form.append('_csrf', this.csrf); return this.req(ruta, { method: 'POST', body: form }); }
  async login(usuario, password) {
    await this.get('/login');
    const r = await this.post('/login', { usuario, password });
    if (r.status !== 302 || r.location !== '/') throw new Error(`Login falló ${usuario}: ${r.status}`);
    await this.get('/');
  }
}

let fallos = 0;
function ok(cond, msg) { console.log(`${cond ? '✔' : '✘'} ${msg}`); if (!cond) fallos += 1; }
function flash(t) { return [...t.matchAll(/<div class="alert (ok|error)"[^>]*>([^<]+)</g)].map((x) => x[2].trim()).join(' | '); }
const idDe = (loc) => (loc || '').split('?')[0].split('/').pop();

// criterios c1..c6: valor 1..10 o 'NA'
function evaluacion(notas, extra = {}) {
  const d = { fecha_evaluacion: '2026-11-27', observaciones: 'Prueba', ...extra };
  notas.forEach((n, i) => { d[`criterios[c${i + 1}][nota]`] = String(n); d[`criterios[c${i + 1}][comentario]`] = extra[`com${i + 1}`] || ''; });
  return d;
}

(async () => {
  const admin = new Cliente();
  await admin.login('admin', ADMIN_PASSWORD);
  const unidades = await admin.get('/admin/unidades');
  const idRV = unidades.texto.match(/href="\/admin\/unidades\/(\d+)"[^>]*>[\s\S]{0,400}?Río Verde/)[1];
  const form = await admin.get('/admin/usuarios/nuevo');
  const roles = Object.fromEntries([...form.texto.matchAll(/<option value="(\d+)"[^>]*>([^<]+)<\/option>/g)].map((m) => [m[2], m[1]]));
  const u = {
    compras: 'Responsable de Compras', adm: 'Coordinador Adm. y RRHH', gerente: 'Gerencia General / Financiera', coord: 'Coordinador de Área',
  };
  const c = {};
  for (const [k, rol] of Object.entries(u)) {
    await admin.post('/admin/usuarios/nuevo', { usuario: `p${k}${sufijo}`, nombre: `${k} prov`, cargo: rol, rol_id: roles[rol], password: 'clave12345', unidades: [idRV] });
    c[k] = new Cliente();
    await c[k].login(`p${k}${sufijo}`, 'clave12345');
  }

  // ---------- Formularios electrónicos ----------
  let r = await admin.get(`/admin/formularios?unidad=${idRV}`);
  ok(r.texto.includes('RV.FCOM.02.1') && r.texto.includes('EVALUACIÓN Y RE-EVALUACIÓN DE PROVEEDORES'), 'Formularios: incluye RV.FCOM.02.1 (evaluación de proveedores)');
  ok(r.texto.includes('RV.FCOM.02.2') && r.texto.includes('Código repetido'), 'Formularios: incluye RV.FCOM.02.2 y avisa códigos repetidos');
  r = await admin.get(`/admin/formularios?unidad=${idRV}&q=CUADRO`);
  const idForm = r.texto.match(/href="\/admin\/formularios\/(\d+)"/)[1];
  await admin.get(`/admin/formularios/${idForm}`);
  r = await admin.post(`/admin/formularios/${idForm}`, {
    tipo_documento_id: (await admin.get(`/admin/formularios/${idForm}`)).texto.match(/<option value="(\d+)" selected>Formulario/)[1],
    proceso_area: 'Compras', codigo: 'rv.fcom.01.2', version: '2', titulo: 'cuadro comparativo de cotizaciones', fecha: '2026-11-27', estado: 'APROBADO',
  });
  r = await admin.get(`/admin/formularios/${idForm}`);
  ok(/Versión:<\/strong> 1 → 2/.test(r.texto) && r.texto.includes('Administrador del sistema'), 'Formularios: el cambio de versión queda en el historial con usuario');
  ok((await c.coord.get('/admin/formularios')).status === 403, 'Formularios: solo el administrador los gestiona');

  // ---------- Alta de proveedores ----------
  ok((await c.coord.get('/proveedores')).status === 200, 'Coordinador de Área puede ver proveedores');
  ok((await c.coord.post('/proveedores', { razon_social: 'X', clasificacion: 'CRITICO' })).status === 403, 'Coordinador de Área no puede registrar proveedores');
  await c.compras.get('/proveedores/nuevo');
  r = await c.compras.post('/proveedores', { razon_social: `Semillas del Sur ${sufijo}`, nit: `A-${sufijo}`, clasificacion: 'CRITICO', tipo_suministro: 'Insumos agrícolas', contacto: 'Luis' });
  const A = idDe(r.location);
  r = await c.compras.post('/proveedores', { razon_social: `Papelería Centro ${sufijo}`, nit: `B-${sufijo}`, clasificacion: 'NO_CRITICO' });
  const B = idDe(r.location);
  ok(/^\d+$/.test(A) && /^\d+$/.test(B), 'Compras registra dos proveedores');
  r = await c.compras.post('/proveedores', { razon_social: 'Duplicado', nit: `a-${sufijo}`, clasificacion: 'CRITICO' });
  ok(r.location === '/proveedores/nuevo' && /Ya existe un proveedor con el NIT/.test(flash((await c.compras.get('/proveedores/nuevo')).texto)), 'NIT duplicado rechazado');
  r = await c.compras.get(`/proveedores/${A}`);
  ok(r.texto.includes('Nuevo (sin evaluar)') && r.texto.includes('Iniciar evaluación'), 'Ficha: proveedor nuevo sin evaluar');

  // ---------- Evaluación de A (Compras evalúa, Gerencia aprueba) ----------
  r = await c.compras.post(`/proveedores/${A}/evaluaciones`, { unidad_id: idRV });
  const EA = idDe(r.location);
  await c.compras.get(`/proveedores/evaluaciones/${EA}`);
  r = await c.compras.post(`/proveedores/evaluaciones/${EA}`, { ...evaluacion([9, 9, 'NA', 8, 9, 8]), accion: 'enviar' });
  ok(/justifique en comentarios/.test(flash((await c.compras.get(`/proveedores/evaluaciones/${EA}`)).texto)), 'N/A sin justificar bloquea el envío');
  await c.compras.post(`/proveedores/evaluaciones/${EA}`, { ...evaluacion([9, 9, 'NA', 8, 9, 8], { com3: 'No requiere soporte técnico' }), 'acciones[mantener]': 'on', accion: 'enviar' });
  r = await c.compras.get(`/proveedores/evaluaciones/${EA}`);
  ok(r.texto.includes('Por aprobar') && r.texto.includes('8,60'), 'Evaluación enviada: promedio 8,60 (N/A no cuenta)');
  ok((await c.compras.post(`/proveedores/evaluaciones/${EA}/aprobar`, { decision: 'aprobar', meses_reevaluacion: 12 })).status === 403, 'Compras no puede aprobar evaluaciones');
  r = await c.gerente.get('/');
  ok(r.texto.includes(`Aprobar la evaluación de Semillas del Sur ${sufijo}`), 'Gerencia ve la evaluación en Mis tareas');
  await c.gerente.get(`/proveedores/evaluaciones/${EA}`);
  await c.gerente.post(`/proveedores/evaluaciones/${EA}/aprobar`, { decision: 'aprobar', meses_reevaluacion: '12' });
  r = await c.compras.get(`/proveedores/${A}`);
  ok(r.texto.includes('badge cerrado">Aprobado<') && r.texto.includes('Próxima reevaluación: 27/11/2027'), 'Aprobada: proveedor Aprobado, reevaluación en 12 meses');

  // ---------- Evaluación de B (Coord. Adm. evalúa: no puede aprobarse a sí mismo) ----------
  r = await c.adm.post(`/proveedores/${B}/evaluaciones`, { unidad_id: idRV });
  const EB = idDe(r.location);
  await c.adm.get(`/proveedores/evaluaciones/${EB}`);
  await c.adm.post(`/proveedores/evaluaciones/${EB}`, { ...evaluacion([4, 3, 5, 4, 4, 4]), accion: 'enviar' });
  await c.adm.post(`/proveedores/evaluaciones/${EB}/aprobar`, { decision: 'aprobar', meses_reevaluacion: '24' });
  ok(/No puede aprobar una evaluación que usted mismo realizó/.test(flash((await c.adm.get(`/proveedores/evaluaciones/${EB}`)).texto)), 'Nadie aprueba su propia evaluación');
  await c.gerente.get(`/proveedores/evaluaciones/${EB}`);
  await c.gerente.post(`/proveedores/evaluaciones/${EB}/aprobar`, { decision: 'devolver' });
  ok(/observaciones para el evaluador/.test(flash((await c.gerente.get(`/proveedores/evaluaciones/${EB}`)).texto)), 'Devolver exige observaciones');
  await c.gerente.post(`/proveedores/evaluaciones/${EB}/aprobar`, { decision: 'devolver', comentario: 'Revisar criterio 2' });
  ok((await c.adm.get('/')).texto.includes(`Corregir la evaluación de Papelería Centro ${sufijo}`), 'El evaluador ve la evaluación devuelta en Mis tareas');
  await c.adm.get(`/proveedores/evaluaciones/${EB}`);
  await c.adm.post(`/proveedores/evaluaciones/${EB}`, { ...evaluacion([4, 4, 5, 4, 4, 4]), accion: 'enviar' });
  await c.gerente.get(`/proveedores/evaluaciones/${EB}`);
  await c.gerente.post(`/proveedores/evaluaciones/${EB}/aprobar`, { decision: 'aprobar', meses_reevaluacion: '24' });
  r = await c.adm.get(`/proveedores/${B}`);
  ok(r.texto.includes('badge rechazado">No aprobado<') && r.texto.includes('no se puede elegir'), 'Promedio 4,17: No aprobado y no elegible');

  // ---------- Proceso de compra con el registro ----------
  const nuevo = await c.coord.get('/procesos/nuevo');
  const dep = nuevo.texto.match(new RegExp(`<option value="(\\d+)" data-unidad="${idRV}"`))[1];
  const f = new FormData();
  Object.entries({ unidad_id: idRV, tipo_solicitud: 'COMPRA', departamento_id: dep }).forEach(([k, v]) => f.append(k, v));
  f.append('items[0][descripcion]', 'Bolsas de semilla'); f.append('items[0][cantidad]', '10'); f.append('items[0][unidad]', 'pza');
  r = await c.coord.postMultipart('/procesos', f);
  const ruta = r.location;
  await c.gerente.get(ruta);
  await c.gerente.post(`${ruta}/aprobar-solicitud`, { decision: 'aprobar' });
  let d = await c.compras.get(ruta);
  const item = d.texto.match(/name="cot\[p1\]\[precio\]\[i(\d+)\]"/)[1];
  ok(d.texto.includes(`Semillas del Sur ${sufijo}`) && !d.texto.includes(`<option value="${B}"`), 'Cuadro: ofrece proveedores aprobados y no los No aprobados');
  await c.compras.post(`${ruta}/cuadro`, { 'cot[p1][proveedor_id]': B, [`cot[p1][precio][i${item}]`]: '50', seleccionada: 'p1', justificacion: 'x', accion: 'guardar' });
  ok(/no se puede elegir/.test(flash((await c.compras.get(ruta)).texto)), 'Elegir un proveedor No aprobado se rechaza');
  await c.compras.post(`${ruta}/cuadro`, { 'cot[p1][proveedor_id]': A, [`cot[p1][precio][i${item}]`]: '50', seleccionada: 'p1', justificacion: 'Proveedor aprobado', accion: 'enviar' });
  await c.gerente.get(ruta);
  await c.gerente.post(`${ruta}/aprobar-cuadro`, { decision: 'aprobar' });
  await c.compras.get(ruta);
  await c.compras.post(`${ruta}/recepcion`, {
    rec_fecha: '2026-11-27', rec_tipo_bien: 'CONSUMO', [`it[i${item}][cantidad]`]: '10', [`it[i${item}][estado]`]: 'Rechazado',
    [`it[i${item}][observaciones]`]: 'Bolsas rotas', accion: 'enviar', paso: '4',
  });
  r = await c.compras.get(`/proveedores/${A}`);
  ok(r.texto.includes('Rechazado en recepción') && r.texto.includes('Bolsas rotas'), 'Recepción con ítem rechazado genera una incidencia en la ficha');
  ok(r.texto.includes('Adjudicado'), 'La ficha muestra las compras en las que participó');
  const imp = await c.coord.get(`${ruta}/imprimir/cuadro`);
  ok(imp.texto.includes('Versión: 2') && imp.texto.includes('CUADRO COMPARATIVO DE COTIZACIONES'), 'El encabezado impreso usa la versión del módulo de formularios');

  // Proveedor ocasional / de emergencia
  const f2 = new FormData();
  Object.entries({ unidad_id: idRV, tipo_solicitud: 'SERVICIO', departamento_id: dep }).forEach(([k, v]) => f2.append(k, v));
  f2.append('items[0][descripcion]', 'Reparación urgente'); f2.append('items[0][cantidad]', '1');
  r = await c.coord.postMultipart('/procesos', f2);
  const ruta2 = r.location;
  await c.gerente.get(ruta2);
  await c.gerente.post(`${ruta2}/aprobar-solicitud`, { decision: 'aprobar' });
  d = await c.compras.get(ruta2);
  const item2 = d.texto.match(/name="cot\[p1\]\[precio\]\[i(\d+)\]"/)[1];
  await c.compras.post(`${ruta2}/cuadro`, {
    'cot[p1][proveedor_id]': 'ocasional', 'cot[p1][ocasional_nombre]': `Taller Urgente ${sufijo}`, 'cot[p1][ocasional_nit]': `O-${sufijo}`,
    [`cot[p1][precio][i${item2}]`]: '300', seleccionada: 'p1', justificacion: 'Emergencia', accion: 'guardar',
  });
  r = await c.compras.get(`/proveedores?q=Taller%20Urgente%20${sufijo}`);
  ok(r.texto.includes('Ocasional') && r.texto.includes('Nuevo (sin evaluar)'), 'Proveedor ocasional: se registra como Nuevo y marcado como ocasional');

  // ---------- Estado y reevaluación (solo Gerencia / Administración) ----------
  ok((await c.compras.post(`/proveedores/${A}/estado`, { estado: 'SUSPENDIDO', motivo: 'x' })).status === 403, 'Compras no puede suspender');
  await c.gerente.get(`/proveedores/${A}`);
  await c.gerente.post(`/proveedores/${A}/estado`, { estado: 'SUSPENDIDO', motivo: 'Reclamos recurrentes' });
  ok((await c.gerente.get(`/proveedores/${A}`)).texto.includes('badge rechazado">Suspendido<'), 'Gerencia suspende al proveedor');
  await c.gerente.post(`/proveedores/${A}/estado`, { estado: 'REACTIVAR', motivo: 'Corrigió' });
  ok((await c.gerente.get(`/proveedores/${A}`)).texto.includes('badge cerrado">Aprobado<'), 'Reactivar vuelve al resultado de su última evaluación');
  await c.gerente.post(`/proveedores/${A}/reevaluacion`, { proxima_reevaluacion: '2020-01-01', motivo: 'Adelantar' });
  ok((await c.compras.get('/')).texto.includes(`Reevaluar a Semillas del Sur ${sufijo}`), 'Reevaluación vencida aparece en Mis tareas de Compras');

  // ---------- Documentos e impresión ----------
  await c.compras.get(`/proveedores/${A}`);
  const fd = new FormData();
  fd.append('tipo_doc', 'Registro tributario (NIT)');
  fd.append('archivos', new Blob(['%PDF-1.4 nit'], { type: 'application/pdf' }), 'NIT proveedor.pdf');
  await c.compras.postMultipart(`/proveedores/${A}/adjuntos`, fd);
  r = await c.compras.get(`/proveedores/${A}`);
  const adj = (r.texto.match(/href="\/proveedores\/adjuntos\/(\d+)/) || [])[1];
  ok(r.texto.includes('NIT proveedor.pdf') && (await c.coord.get(`/proveedores/adjuntos/${adj}`)).status === 200, 'Documento de respaldo adjuntado y descargable');
  r = await c.coord.get(`/proveedores/evaluaciones/${EA}/imprimir`);
  ok(r.status === 200 && r.texto.includes('RV.FCOM.02.1') && r.texto.includes('PROMEDIO FINAL OBTENIDO') && r.texto.includes('Aprobado en el sistema'), 'Imprimir evaluación (RV.FCOM.02.1) con firmas del sistema');
  r = await c.coord.get(`/proveedores/listado/imprimir?unidad=${idRV}`);
  ok(r.texto.includes('RV.FCOM.02.2') && r.texto.includes(`Semillas del Sur ${sufijo}`) && r.texto.includes(`Papelería Centro ${sufijo}`), 'Imprimir Listado de Proveedores Aprobados');
  // fetch().text() descarta el BOM: se revisan los bytes
  const csv = await fetch(`${BASE}/proveedores/listado.csv`, { headers: { cookie: c.coord.cookie } });
  const bytes = Buffer.from(await csv.arrayBuffer());
  ok(/text\/csv/.test(csv.headers.get('content-type')) && bytes.slice(0, 3).equals(Buffer.from([0xef, 0xbb, 0xbf]))
    && bytes.toString('utf8').includes(`Semillas del Sur ${sufijo}`), 'Exportar el listado a Excel (CSV con BOM)');

  console.log(fallos ? `\n${fallos} FALLO(S)` : '\nTODO OK');
  process.exit(fallos ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
