// Prueba de punta a punta del flujo de compras (requiere la app corriendo y el usuario admin inicial).
// Uso: BASE=http://localhost:3100 ADMIN_PASSWORD=admin123 node tests/e2e.js
// ATENCIÓN: crea usuarios y procesos de prueba. Úsela solo en una base de pruebas.
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
    return { status: r.status, location: r.headers.get('location'), texto };
  }
  get(ruta) { return this.req(ruta); }
  async post(ruta, datos = {}) {
    if (!this.csrf) await this.get('/login');
    const body = new URLSearchParams();
    for (const [k, v] of Object.entries(datos)) [].concat(v).forEach((x) => body.append(k, x));
    body.append('_csrf', this.csrf);
    return this.req(ruta, { method: 'POST', body, headers: { 'content-type': 'application/x-www-form-urlencoded' } });
  }
  postMultipart(ruta, form) {
    form.append('_csrf', this.csrf);
    return this.req(ruta, { method: 'POST', body: form });
  }
  async login(usuario, password) {
    await this.get('/login');
    const r = await this.post('/login', { usuario, password });
    if (r.status !== 302 || r.location !== '/') throw new Error(`Login falló ${usuario}: ${r.status}`);
    await this.get('/');
  }
}

let fallos = 0;
function ok(cond, msg) { console.log(`${cond ? '✔' : '✘'} ${msg}`); if (!cond) fallos += 1; }
function flash(texto) { return [...texto.matchAll(/<div class="alert (ok|error)"[^>]*>([^<]+)</g)].map((x) => `[${x[1]}] ${x[2].trim()}`).join(' | '); }
function estado(texto) { const m = texto.match(/<span class="badge (?:pendiente|proceso|cerrado|rechazado)">([^<]+)<\/span>/); return m && m[1]; }

function solicitud(campos, items) {
  const f = new FormData();
  Object.entries(campos).forEach(([k, v]) => f.append(k, v));
  items.forEach((it, i) => Object.entries(it).forEach(([k, v]) => f.append(`items[${i}][${k}]`, v)));
  return f;
}

(async () => {
  const admin = new Cliente();
  await admin.login('admin', ADMIN_PASSWORD);
  ok(true, 'Login admin');

  const unidades = await admin.get('/admin/unidades');
  const idUnidad = (nombre) => unidades.texto.match(new RegExp(`href="/admin/unidades/(\\d+)"[^>]*>[\\s\\S]{0,400}?${nombre}`))[1];
  const idRV = idUnidad('Río Verde');
  const idZB = idUnidad('Zentta Bio');
  const form = await admin.get('/admin/usuarios/nuevo');
  const roles = Object.fromEntries([...form.texto.matchAll(/<option value="(\d+)"[^>]*>([^<]+)<\/option>/g)].map((m) => [m[2], m[1]]));
  ok(Object.keys(roles).length === 6, `6 roles: ${Object.keys(roles).join(', ')}`);

  const usuarios = {
    gerente: 'Gerencia General / Financiera', coord: 'Coordinador de Área', compras: 'Responsable de Compras',
    contador: 'Contador', adm: 'Coordinador Adm. y RRHH', otro: 'Coordinador de Área',
  };
  const c = {};
  for (const [u, rol] of Object.entries(usuarios)) {
    const r = await admin.post('/admin/usuarios/nuevo', {
      usuario: `${u}${sufijo}`, nombre: `${u} prueba`, cargo: rol, rol_id: roles[rol], password: 'clave12345', unidades: [idRV],
    });
    ok(r.status === 302 && r.location === '/admin/usuarios', `Crear usuario ${u}`);
    c[u] = new Cliente();
    await c[u].login(`${u}${sufijo}`, 'clave12345');
  }

  const malo = new Cliente();
  await malo.get('/login');
  ok((await malo.post('/login', { usuario: `coord${sufijo}`, password: 'mala' })).status === 401, 'Contraseña incorrecta rechazada');

  // ---------- Paso 1: Solicitud ----------
  const nuevo = await c.coord.get('/procesos/nuevo');
  ok(nuevo.texto.includes('Río Verde') && !nuevo.texto.includes('Zentta Bio'), 'Coordinador solo ve su unidad asignada');
  ok(nuevo.texto.includes('asistente-nav'), 'Nueva solicitud como asistente de 4 partes');
  const depRV = nuevo.texto.match(new RegExp(`<option value="(\\d+)" data-unidad="${idRV}"`))[1];

  let r = await c.coord.postMultipart('/procesos', solicitud(
    { unidad_id: idZB, tipo_solicitud: 'COMPRA', departamento_id: depRV }, [{ descripcion: 'X', cantidad: '1' }],
  ));
  ok(r.location === '/procesos/nuevo', 'No puede crear procesos en una unidad no asignada');
  await c.coord.get('/procesos/nuevo');

  const f = solicitud(
    { unidad_id: idRV, tipo_solicitud: 'COMPRA', departamento_id: depRV, prioridad: 'ALTA', requiere_oc: 'on', monto_estimado: '5000', comentarios: 'Reposición de riego' },
    [{ descripcion: 'Bomba de agua 2HP', cantidad: '2', unidad: 'pza' }, { descripcion: 'Manguera 1"', cantidad: '50', unidad: 'm' }],
  );
  f.append('archivos', new Blob(['%PDF-1.4 prueba'], { type: 'application/pdf' }), 'proforma ñandú.pdf');
  r = await c.coord.postMultipart('/procesos', f);
  ok(r.status === 302 && /^\/procesos\/\d+$/.test(r.location), `Solicitud creada → ${r.location}`);
  const ruta = r.location;
  let d = await c.coord.get(ruta);
  const codigo = d.texto.match(/<h1[^>]*>(RV-REQ-\d+)/)[1];
  ok(/^RV-REQ-\d+$/.test(codigo), `Código sin ceros: ${codigo}`);
  ok(estado(d.texto) === 'Revisión presupuestaria', `Estado: ${estado(d.texto)}`);
  ok(d.texto.includes('proforma ñandú.pdf'), 'Adjunto con nombre UTF-8');
  ok(d.texto.includes('Logo_Rio_Verde.png') && d.texto.includes('RV.26.001'), 'Logo y código de revisión de la unidad');
  ok(d.texto.includes('class="sidebar"') && d.texto.includes('class="stepper"'), 'Sidebar y línea de 5 pasos');
  ok(/<li class="actual[^"]*">\s*<a href="\/procesos\/\d+\?paso=1"/.test(d.texto), 'Paso 1 marcado como actual');
  ok(d.texto.includes('Esperando a: <strong>Gerencia'), 'El solicitante ve "Esperando a Gerencia"');

  ok((await c.contador.get(ruta)).status === 200, 'Contador (unidad RV) ve el proceso');
  ok((await c.otro.get(ruta)).status === 403, 'Otro coordinador NO ve procesos ajenos');

  await c.coord.post(`${ruta}/aprobar-solicitud`, { decision: 'aprobar' });
  ok(estado((await c.coord.get(ruta)).texto) === 'Revisión presupuestaria', 'El coordinador no puede aprobar');

  let ini = await c.gerente.get('/');
  ok(ini.texto.includes('Aprobar o rechazar la solicitud') && ini.texto.includes(codigo), 'Gerencia ve la tarea en Mis tareas');
  ok(/class="contador">(?:<span class="sr-only">[^<]*<\/span>)?\d+/.test(ini.texto), 'Contador de pendientes en el sidebar');
  r = await c.gerente.post(`${ruta}/aprobar-solicitud`, { decision: 'aprobar', comentario: 'Presupuesto OK', volver: 'inicio' });
  ok(r.location === '/', 'Aprobación rápida desde Mis tareas vuelve a Inicio');
  ok(estado((await c.gerente.get(ruta)).texto) === 'En cotización', 'Solicitud aprobada → En cotización');

  // ---------- Paso 2: Cuadro comparativo (proveedores del registro) ----------
  await c.compras.get('/proveedores/nuevo');
  r = await c.compras.post('/proveedores', { razon_social: `Agro Insumos SRL ${sufijo}`, nit: `NIT-${sufijo}`, clasificacion: 'CRITICO', contacto: 'Ana' });
  const idProv = (r.location || '').split('/').pop();
  ok(/^\d+$/.test(idProv), 'Compras registra un proveedor en el registro');
  ini = await c.compras.get('/');
  ok(ini.texto.includes('Registrar las cotizaciones de los proveedores'), 'Compras ve la tarea de cotizar');
  d = await c.compras.get(ruta);
  ok(d.texto.includes('Te toca a ti') && d.texto.includes('prov-card'), 'Compras: "Te toca a ti" y tarjetas de proveedor');
  const items = [...d.texto.matchAll(/name="cot\[p1\]\[precio\]\[i(\d+)\]"/g)].map((m) => m[1]);
  ok(items.length === 2, 'Tarjeta de proveedor con 2 ítems');
  const cuadro = {
    fecha_evaluacion: '2026-11-17', moneda: 'BS', tipo_cambio: '6.96', justificacion: 'Mejor precio y garantía', paso: '2',
    'cot[p1][proveedor_id]': idProv, [`cot[p1][precio][i${items[0]}]`]: '2000', [`cot[p1][precio][i${items[1]}]`]: '20',
    'cot[p1][criterio][c1]': '9', 'cot[p1][criterio][c7]': '8', seleccionada: 'p1', accion: 'enviar',
  };
  r = await c.compras.post(`${ruta}/cuadro`, cuadro);
  ok(r.location === `${ruta}?paso=2`, 'Al bloquearse se queda en el paso 2');
  d = await c.compras.get(ruta);
  ok(estado(d.texto) === 'En cotización' && /se requieren 2 cotizaci/.test(flash(d.texto)), 'Bloqueado por falta de cotizaciones (Bs 5.000 → 2)');
  ok(d.texto.includes(`Agro Insumos SRL ${sufijo}`), 'El borrador se conservó (con el proveedor del registro)');

  await c.gerente.get(ruta);
  await c.gerente.post(`${ruta}/excepcion`, { comentario: 'Proveedor único en la zona' });
  ok((await c.gerente.get(ruta)).texto.includes('Excepción autorizada'), 'Gerencia desbloquea con excepción');

  await c.compras.get(ruta);
  await c.compras.post(`${ruta}/cuadro`, cuadro);
  ok(estado((await c.compras.get(ruta)).texto) === 'Cuadro comparativo por aprobar', 'Cuadro enviado a aprobación');

  await c.gerente.get(ruta);
  await c.gerente.post(`${ruta}/aprobar-cuadro`, { decision: 'observar', comentario: 'Revisar criterio 2' });
  ok(estado((await c.gerente.get(ruta)).texto) === 'En cotización', 'Gerencia devuelve con observaciones');
  await c.compras.get(ruta);
  await c.compras.post(`${ruta}/cuadro`, { ...cuadro, 'cot[p1][criterio][c2]': '8' });
  await c.gerente.get('/');
  r = await c.gerente.post(`${ruta}/aprobar-cuadro`, { decision: 'aprobar', volver: 'inicio' });
  ok(estado((await c.gerente.get(ruta)).texto) === 'Orden de compra en preparación', 'Cuadro aprobado (rápido) → Paso 3');

  // ---------- Paso 3: Orden de compra ----------
  await c.compras.get(ruta);
  await c.compras.post(`${ruta}/orden-compra`, {
    prioridad: 'ALTA', oc_plazo_entrega: '10 días', oc_condicion_pago: 'Crédito 30 días', oc_lugar_entrega: 'Propiedad Río Verde',
    oc_descuento: '100', 'prov[nit]': '123456', 'prov[banco]': 'BNB', accion: 'emitir', paso: '3',
  });
  d = await c.compras.get(ruta);
  const oc = (d.texto.match(/O\.C\. (RV-\d+)/) || [])[1];
  ok(estado(d.texto) === 'Orden de compra por autorizar' && /^RV-\d+$/.test(oc), `OC emitida ${oc}`);
  await c.gerente.get(ruta);
  await c.gerente.post(`${ruta}/autorizar-oc`, { decision: 'aprobar' });
  ok(estado((await c.gerente.get(ruta)).texto) === 'Esperando recepción', 'OC autorizada → Paso 4');

  // ---------- Paso 4: Recepción ----------
  await c.compras.get(ruta);
  await c.compras.post(`${ruta}/seguimiento`, { comentario: 'Proveedor despacha el viernes', paso: '4' });
  d = await c.compras.get(`${ruta}?paso=4`);
  ok(d.texto.includes('Proveedor despacha el viernes'), 'Nota de seguimiento visible en el paso 4');
  await c.compras.post(`${ruta}/recepcion`, {
    rec_fecha: '2026-11-20', rec_nro_factura: 'F-998', rec_tipo_bien: 'ACTIVO_FIJO', rec_cantidad_ok: 'on', rec_estado_ok: 'on',
    [`it[i${items[0]}][cantidad]`]: '2', [`it[i${items[0]}][estado]`]: 'Aceptado', [`it[i${items[0]}][codigo_serie]`]: 'SN-1',
    [`it[i${items[1]}][cantidad]`]: '50', [`it[i${items[1]}][estado]`]: 'Aceptado con observaciones', accion: 'enviar', paso: '4',
  });
  d = await c.compras.get(ruta);
  ok(estado(d.texto) === 'Por entregar', 'Recepción registrada → directo a emitir la nota de entrega');
  d = await c.compras.get(`${ruta}?paso=4`);
  ok(!d.texto.includes('Revisar el registro') && !d.texto.includes('Aprobar la recepción'), 'Paso 4 sin sub-tareas de revisión/aprobación');
  ok((await c.adm.post(`${ruta}/revisar-recepcion`, {})).status === 404, 'La ruta de revisar recepción ya no existe');
  ok(!(await c.gerente.get('/')).texto.includes(codigo), 'Gerencia no tiene tarea de recepción');

  // ---------- Paso 5: Nota de entrega (sin ingreso ni egreso) ----------
  ok(!(await c.contador.get('/')).texto.includes(codigo), 'El Contador ya no tiene tareas de ingreso/egreso');
  ok((await c.contador.post(`${ruta}/ingreso`, { ingreso_comprobante: 'X' })).status === 404, 'La ruta de comprobante de ingreso ya no existe');
  ini = await c.adm.get('/');
  ok(ini.texto.includes('Emitir la nota de entrega') && ini.texto.includes(codigo), 'Coord. Adm. ve "Emitir la nota de entrega" en Mis tareas');
  d = await c.adm.get(`${ruta}?paso=5`);
  ok(!d.texto.includes('almacen_observaciones') && !d.texto.includes('Octopus') && !d.texto.includes('egreso'), 'Paso 5 sin almacenamiento, ingreso ni egreso');
  await c.adm.post(`${ruta}/entrega`, {
    ne_fecha: '2026-11-22', ne_entregado_a: 'coord prueba',
    [`it[i${items[0]}][cantidad]`]: '2', [`it[i${items[1]}][cantidad]`]: '50', accion: 'entregar', paso: '5',
  });
  d = await c.adm.get(ruta);
  ok(estado(d.texto) === 'Cerrado' && d.texto.includes('Proceso terminado'), 'Emitir la nota de entrega cierra el proceso');
  ok(/Nota de entrega N° \d+/.test(d.texto), 'Nota de entrega con número sin ceros');
  ok((d.texto.match(/<li class="hecho/g) || []).length === 5, 'Los 5 pasos marcados como completados');
  d = await c.coord.get(`${ruta}?paso=5`);
  ok(d.texto.includes('Sí, lo recibí'), 'El solicitante puede confirmar (opcional) con el proceso ya cerrado');
  await c.coord.post(`${ruta}/confirmar-entrega`, {});
  d = await c.coord.get(`${ruta}?paso=5`);
  ok(!d.texto.includes('Sí, lo recibí') && /Recibido por \(solicitante\)<\/b>\s*<svg/.test(d.texto), 'Confirmación registrada como firma "Recibido por"');

  for (const doc of ['solicitud', 'cuadro', 'orden-compra', 'recepcion', 'nota-entrega']) {
    const p = await c.coord.get(`${ruta}/imprimir/${doc}`);
    ok(p.status === 200 && p.texto.includes('RV.FCOM') && p.texto.includes('Aprobado en el sistema'), `Imprimir ${doc}`);
  }
  const ocPrint = await c.coord.get(`${ruta}/imprimir/orden-compra`);
  ok(ocPrint.texto.includes('4,900.00') || ocPrint.texto.includes('4.900,00'), 'OC: 5.000 − 100 = 4.900');

  // ---------- Stock y servicio ----------
  await c.coord.get('/procesos/nuevo');
  r = await c.coord.postMultipart('/procesos', solicitud(
    { unidad_id: idRV, tipo_solicitud: 'COMPRA', departamento_id: depRV, existe_stock: 'on' }, [{ descripcion: 'Guantes', cantidad: '10' }],
  ));
  ok(estado((await c.coord.get(r.location)).texto) === 'Atendido con stock', 'Existe en stock → atendido con stock');

  await c.coord.get('/procesos/nuevo');
  r = await c.coord.postMultipart('/procesos', solicitud(
    { unidad_id: idRV, tipo_solicitud: 'SERVICIO', departamento_id: depRV }, [{ descripcion: 'Mantenimiento de tractor', cantidad: '1' }],
  ));
  const ruta3 = r.location;
  await c.gerente.get(ruta3);
  await c.gerente.post(`${ruta3}/aprobar-solicitud`, { decision: 'rechazar' });
  ok(estado((await c.gerente.get(ruta3)).texto) === 'Revisión presupuestaria', 'Rechazo sin motivo no se permite');
  await c.gerente.post(`${ruta3}/aprobar-solicitud`, { decision: 'aprobar' });
  d = await c.compras.get(ruta3);
  const it3 = d.texto.match(/name="cot\[p1\]\[precio\]\[i(\d+)\]"/)[1];
  await c.compras.post(`${ruta3}/cuadro`, { 'cot[p1][proveedor_id]': 'ocasional', 'cot[p1][ocasional_nombre]': `Taller X ${sufijo}`, [`cot[p1][precio][i${it3}]`]: '800', seleccionada: 'p1', justificacion: 'Único', accion: 'enviar' });
  await c.gerente.get(ruta3);
  await c.gerente.post(`${ruta3}/aprobar-cuadro`, { decision: 'aprobar' });
  d = await c.compras.get(ruta3);
  ok(estado(d.texto) === 'Esperando recepción', 'Servicio sin OC → paso 4 (cierre)');
  ok(/<li class="no_aplica[^"]*">\s*<a href="[^"]*paso=3"/.test(d.texto) && /<li class="no_aplica[^"]*">\s*<a href="[^"]*paso=5"/.test(d.texto), 'Pasos 3 y 5 "No aplica" en servicios');
  await c.compras.post(`${ruta3}/cerrar-servicio`, { comentario: 'Servicio concluido conforme' });
  ok(estado((await c.compras.get(ruta3)).texto) === 'Cerrado', 'Servicio cerrado');

  ok((await c.gerente.get('/procesos')).texto.includes(codigo), 'Gerencia ve los procesos en el listado');
  ok(!(await c.otro.get('/procesos')).texto.includes(codigo), 'Otro coordinador no ve el proceso en su listado');

  const sinCsrf = await fetch(`${BASE}${ruta}/seguimiento`, {
    method: 'POST', redirect: 'manual', headers: { cookie: c.compras.cookie, 'content-type': 'application/x-www-form-urlencoded' }, body: 'comentario=x',
  });
  ok(sinCsrf.status === 403, 'POST sin token CSRF rechazado');

  for (const p of ['/admin/usuarios', '/admin/roles', '/admin/unidades', `/admin/unidades/${idRV}`, '/cuenta/password', '/procesos?vista=pendientes']) {
    ok((await admin.get(p)).status === 200, `Página ${p}`);
  }

  console.log(fallos ? `\n${fallos} FALLO(S)` : '\nTODO OK');
  process.exit(fallos ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
