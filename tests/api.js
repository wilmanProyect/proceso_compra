// Prueba de punta a punta de la API móvil (/api/v1): sesión, catálogos, cola sin conexión, aprobaciones en línea,
// sincronización y adjuntos. Uso: BASE=http://localhost:3299 ADMIN_PASSWORD=admin123 node tests/api.js
// ATENCIÓN: crea usuarios y procesos de prueba. Úsela solo en una base de pruebas.
const { randomUUID } = require('crypto');

const BASE = process.env.BASE || 'http://localhost:3000';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'admin123';
const sufijo = Date.now().toString(36).slice(-4);
let fallos = 0;
function ok(cond, msg, extra) {
  console.log(`${cond ? '✔' : '✘'} ${msg}`);
  if (!cond) { fallos += 1; if (extra !== undefined) console.log('   ', JSON.stringify(extra).slice(0, 600)); }
}

// ---------- Cliente web (solo para crear usuarios como admin) ----------
class Web {
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
  async post(ruta, datos) {
    const body = new URLSearchParams();
    for (const [k, v] of Object.entries(datos)) [].concat(v).forEach((x) => body.append(k, x));
    body.append('_csrf', this.csrf);
    return this.req(ruta, { method: 'POST', body, headers: { 'content-type': 'application/x-www-form-urlencoded' } });
  }
}

// ---------- Cliente de la API (como la app) ----------
class App {
  constructor() { this.dispositivo = randomUUID(); this.token = ''; this.refresh = ''; this.usuario = null; }
  async req(metodo, ruta, cuerpo, extra = {}) {
    const headers = { ...(this.token ? { authorization: `Bearer ${this.token}` } : {}), ...(extra.headers || {}) };
    let body;
    if (cuerpo instanceof FormData) body = cuerpo;
    else if (cuerpo !== undefined) { body = JSON.stringify(cuerpo); headers['content-type'] = 'application/json'; }
    const r = await fetch(`${BASE}/api/v1${ruta}`, { method: metodo, headers, body });
    const texto = await r.text();
    let json = null;
    try { json = texto ? JSON.parse(texto) : null; } catch (e) { json = { crudo: texto }; }
    return { status: r.status, json, headers: r.headers };
  }
  async login(usuario, password) {
    const r = await this.req('POST', '/auth/login', { usuario, password, dispositivo_id: this.dispositivo, dispositivo_nombre: 'Prueba' });
    if (r.status !== 200) throw new Error(`Login API falló ${usuario}: ${r.status} ${JSON.stringify(r.json)}`);
    this.token = r.json.access_token; this.refresh = r.json.refresh_token; this.usuario = r.json.usuario;
    return r;
  }
  push(operaciones) { return this.req('POST', '/sync/push', { operaciones }); }
  accion(procesoUuid, tipo, estadoEsperado, datos = {}) {
    return this.req('POST', `/procesos/${procesoUuid}/acciones`, { op_id: randomUUID(), tipo, estado_esperado: estadoEsperado, datos });
  }
}

const opp = (tipo, procesoUuid, datos = {}, estadoEsperado) => ({
  op_id: randomUUID(), tipo, proceso_uuid: procesoUuid, estado_esperado: estadoEsperado, creada_en: new Date().toISOString(), datos,
});

(async () => {
  // ---------- Preparación: usuarios por rol ----------
  const admin = new Web();
  await admin.req('/login');
  const rl = await admin.post('/login', { usuario: 'admin', password: ADMIN_PASSWORD });
  ok(rl.status === 302, 'Login web admin');
  const unidades = await admin.req('/admin/unidades');
  const idRV = unidades.texto.match(/href="\/admin\/unidades\/(\d+)"[^>]*>[\s\S]{0,400}?Río Verde/)[1];
  const form = await admin.req('/admin/usuarios/nuevo');
  const roles = Object.fromEntries([...form.texto.matchAll(/<option value="(\d+)"[^>]*>([^<]+)<\/option>/g)].map((m) => [m[2], m[1]]));
  const rolesUsuarios = {
    coord: 'Coordinador de Área', gerente: 'Gerencia General / Financiera', compras: 'Responsable de Compras',
    contador: 'Contador', adm: 'Coordinador Adm. y RRHH', otro: 'Coordinador de Área',
  };
  for (const [u, rol] of Object.entries(rolesUsuarios)) {
    await admin.req('/admin/usuarios/nuevo');
    const r = await admin.post('/admin/usuarios/nuevo', {
      usuario: `api${u}${sufijo}`, nombre: `${u} api`, cargo: rol, rol_id: roles[rol], password: 'clave12345', unidades: [idRV],
    });
    if (r.status !== 302) throw new Error(`No se pudo crear ${u}`);
  }

  // ---------- Sesión ----------
  const anon = new App();
  ok((await anon.req('GET', '/ping')).json.ok === true, 'GET /ping sin token');
  ok((await anon.req('GET', '/catalogos')).status === 401, 'Sin token → 401');
  anon.token = 'a.b.c';
  ok((await anon.req('GET', '/catalogos')).json.error.codigo === 'TOKEN_INVALIDO', 'Token falso → TOKEN_INVALIDO');
  anon.token = '';
  ok((await anon.req('POST', '/auth/login', { usuario: `apicoord${sufijo}`, password: 'clave12345' })).status === 422, 'Login sin dispositivo_id → 422');
  ok((await anon.req('POST', '/auth/login', { usuario: `apicoord${sufijo}`, password: 'mala', dispositivo_id: randomUUID() })).status === 401, 'Contraseña incorrecta → 401');
  const malJson = await fetch(`${BASE}/api/v1/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{malo' });
  ok(malJson.status === 400, 'JSON inválido → 400');

  const a = {};
  for (const u of Object.keys(rolesUsuarios)) { a[u] = new App(); await a[u].login(`api${u}${sufijo}`, 'clave12345'); }
  ok(a.coord.usuario.permisos.includes('procesos.crear') && a.coord.usuario.unidades.length === 1, 'Login devuelve perfil con permisos y unidades');
  ok((await a.coord.req('GET', '/auth/yo')).json.usuario.id === a.coord.usuario.id, 'GET /auth/yo');

  // ---------- Catálogos ----------
  let r = await a.coord.req('GET', '/catalogos');
  const cat = r.json;
  ok(r.status === 200 && cat.unidades.length === 1 && cat.unidades[0].sigla === 'RV', 'Catálogos: solo la unidad asignada');
  ok(cat.departamentos.length > 0 && cat.formularios.length > 0 && cat.constantes.criterios.length === 8, 'Catálogos: departamentos, formularios y constantes');
  ok(cat.constantes.operaciones_solo_en_linea.includes('APROBAR_SOLICITUD') && !cat.constantes.operaciones_solo_en_linea.includes('GUARDAR_CUADRO'),
    `Operaciones solo en línea: ${cat.constantes.operaciones_solo_en_linea.join(', ')}`);
  r = await a.coord.req('GET', '/catalogos', undefined, { headers: { 'if-none-match': r.headers.get('etag') } });
  ok(r.status === 304, 'Catálogos con ETag sin cambios → 304');
  const dep = cat.departamentos[0];

  // ---------- Crear solicitud desde la cola sin conexión ----------
  const P = randomUUID();
  const I1 = randomUUID();
  const I2 = randomUUID();
  const crear = opp('CREAR_SOLICITUD', P, {
    unidad_id: dep.unidad_id, departamento_id: dep.id, tipo_solicitud: 'COMPRA', prioridad: 'ALTA', requiere_oc: true, monto_estimado: 5000,
    items: [{ uuid: I1, descripcion: 'Bomba de agua 2HP', cantidad: 2, unidad: 'pza' }, { uuid: I2, descripcion: 'Manguera', cantidad: 50, unidad: 'm' }],
  });
  r = await a.coord.push([crear]);
  let res0 = r.json.resultados[0];
  ok(res0.estado === 'APLICADA' && /^RV-REQ-\d+$/.test(res0.proceso.codigo) && res0.proceso.uuid === P, `Push CREAR_SOLICITUD → ${res0.proceso && res0.proceso.codigo}`, res0);
  const codigo = res0.proceso.codigo;
  r = await a.coord.push([crear]);
  ok(r.json.resultados[0].repetida === true && r.json.resultados[0].proceso.codigo === codigo, 'Reenviar el mismo op_id no duplica (idempotente)');
  const lista = await a.coord.req('GET', `/procesos?q=${encodeURIComponent(codigo)}`);
  ok(lista.json.procesos.filter((x) => x.uuid === P).length === 1, 'El proceso existe una sola vez');
  r = await a.coord.push([opp('CREAR_SOLICITUD', randomUUID(), { unidad_id: dep.unidad_id, tipo_solicitud: 'COMPRA', items: [] })]);
  ok(r.json.resultados[0].estado === 'RECHAZADA' && r.json.resultados[0].error.detalles.length > 0, 'Datos inválidos → RECHAZADA con detalles');
  r = await a.coord.push([opp('BORRAR_TODO', P)]);
  ok(r.json.resultados[0].error.codigo === 'TIPO_INVALIDO', 'Tipo desconocido → TIPO_INVALIDO');

  // ---------- Aprobaciones: solo en línea ----------
  r = await a.gerente.push([
    opp('APROBAR_SOLICITUD', P, { decision: 'aprobar' }, 'PENDIENTE_APROBACION'),
    opp('SEGUIMIENTO', P, { comentario: 'x' }),
  ]);
  ok(r.json.resultados[0].error.codigo === 'SOLO_EN_LINEA', 'Aprobación desde la cola → SOLO_EN_LINEA');
  ok(r.json.resultados[1].estado === 'OMITIDA', 'La siguiente operación del mismo proceso → OMITIDA');
  r = await a.coord.accion(P, 'APROBAR_SOLICITUD', 'PENDIENTE_APROBACION', { decision: 'aprobar' });
  ok(r.status === 403 && r.json.resultado.error.codigo === 'ACCION_NO_DISPONIBLE', 'El coordinador no puede aprobar → 403');
  r = await a.gerente.accion(P, 'APROBAR_SOLICITUD', 'EN_COTIZACION', { decision: 'aprobar' });
  ok(r.status === 409 && r.json.resultado.estado === 'CONFLICTO', 'Estado esperado distinto → 409 CONFLICTO');
  r = await a.gerente.accion(P, 'APROBAR_SOLICITUD', 'PENDIENTE_APROBACION', { decision: 'rechazar' });
  ok(r.status === 422 && r.json.resultado.error.codigo === 'VALIDACION', 'Rechazo sin motivo → 422');
  r = await a.gerente.accion(P, 'APROBAR_SOLICITUD', 'PENDIENTE_APROBACION', { decision: 'aprobar', comentario: 'OK' });
  ok(r.status === 200 && r.json.proceso.estado === 'EN_COTIZACION', 'Gerencia aprueba en línea → EN_COTIZACION', r.json);
  const firma = r.json.proceso.firmas.find((f) => f.tipo === 'AUTORIZADO');
  ok(firma && firma.origen === 'MOVIL', 'La firma queda con origen MOVIL');

  // ---------- Visibilidad ----------
  ok((await a.otro.req('GET', `/procesos/${P}`)).status === 404, 'Otro coordinador no ve el proceso → 404');
  ok((await a.contador.req('GET', `/procesos/${P}`)).status === 200, 'Contador de la unidad sí lo ve');
  r = await a.otro.push([opp('ANULAR', P, {}, 'EN_COTIZACION')]);
  ok(r.json.resultados[0].estado === 'RECHAZADA' && !r.json.resultados[0].proceso, 'Operación sobre proceso ajeno → RECHAZADA sin datos del proceso');

  // ---------- Adjuntos ----------
  const ADJ = randomUUID();
  const subir = (cli, adjUuid) => {
    const f = new FormData();
    f.append('uuid', adjUuid); f.append('etapa', 'SOLICITUD');
    f.append('archivo', new Blob(['%PDF-1.4 prueba api'], { type: 'application/pdf' }), 'proforma ñandú.pdf');
    return cli.req('POST', `/procesos/${P}/adjuntos`, f);
  };
  r = await subir(a.coord, ADJ);
  ok(r.status === 201 && r.json.adjunto.uuid === ADJ && r.json.adjunto.nombre_original === 'proforma ñandú.pdf', 'Subir adjunto → 201 (nombre UTF-8)', r.json);
  r = await subir(a.coord, ADJ);
  ok(r.status === 200 && r.json.repetido === true, 'Subir el mismo uuid otra vez → no duplica');
  const desc = await fetch(`${BASE}/api/v1/adjuntos/${ADJ}`, { headers: { authorization: `Bearer ${a.contador.token}` } });
  ok(desc.status === 200 && (await desc.text()) === '%PDF-1.4 prueba api', 'Descargar adjunto');
  ok((await a.otro.req('GET', `/adjuntos/${ADJ}`)).status === 404, 'Otro usuario no descarga el adjunto');
  ok((await a.gerente.req('DELETE', `/adjuntos/${ADJ}`)).status === 403, 'Solo quien lo subió puede borrarlo');
  const ADJ2 = randomUUID();
  await subir(a.coord, ADJ2);
  ok((await a.coord.req('DELETE', `/adjuntos/${ADJ2}`)).status === 200, 'El dueño borra su adjunto');
  const f = new FormData(); f.append('uuid', randomUUID());
  f.append('archivo', new Blob(['x']), 'virus.exe');
  ok((await a.coord.req('POST', `/procesos/${P}/adjuntos`, f)).status === 422, 'Extensión no permitida → 422');

  // ---------- Pull ----------
  r = await a.compras.req('GET', '/sync/pull?desde=0&limite=100');
  let prc = r.json.procesos.find((x) => x.uuid === P);
  ok(prc && prc.items.length === 2 && prc.items[0].uuid === I1 && prc.acciones.editarCuadro === true, 'Pull: proceso completo con ítems y acciones del usuario');
  ok(prc && prc.adjuntos.length === 1 && !('archivo' in prc.adjuntos[0]), 'Pull: adjuntos sin la ruta interna del archivo');
  let cursor = r.json.cursor;
  r = await a.compras.req('GET', `/sync/pull?desde=${cursor}`);
  ok(r.json.procesos.length === 0 && r.json.hay_mas === false, 'Pull desde el cursor sin cambios → vacío');
  r = await a.compras.req('GET', '/sync/pull?desde=0&limite=1');
  ok(r.json.procesos.length <= 1, 'Pull respeta el límite');

  // ---------- Cuadro desde la cola (precios por uuid de ítem) ----------
  const cot = (orden, proveedor, p1, p2, sel) => ({
    orden, proveedor, contacto: 'Ana', telefono: '700', criterios: { 1: 9, 7: 8 }, precios: { [I1]: p1, [I2]: p2 }, seleccionada: sel,
  });
  r = await a.compras.push([opp('GUARDAR_CUADRO', P, {
    enviar: true, moneda: 'BS', justificacion: 'Mejor precio', cotizaciones: [cot(1, 'Agro SRL', 2000, 20, true), cot(2, 'Riego SA', 2100, 22, false)],
  }, 'EN_COTIZACION')]);
  ok(r.json.resultados[0].estado === 'APLICADA' && r.json.resultados[0].proceso.estado === 'COTIZACION_POR_APROBAR', 'Push GUARDAR_CUADRO (enviar) → por aprobar', r.json.resultados[0]);
  r = await a.compras.req('GET', `/sync/pull?desde=${cursor}`);
  prc = r.json.procesos.find((x) => x.uuid === P);
  ok(prc && prc.cotizaciones.length === 2 && prc.cotizaciones[0].precios[I1] === 2000, 'Pull trae el cambio con precios indexados por uuid de ítem');
  cursor = r.json.cursor;

  r = await a.gerente.accion(P, 'APROBAR_CUADRO', 'COTIZACION_POR_APROBAR', {});
  ok(r.json.proceso.estado === 'OC_EN_PREPARACION', 'Gerencia aprueba el cuadro en línea → OC');

  // ---------- Orden de compra ----------
  r = await a.compras.push([opp('GUARDAR_OC', P, {
    emitir: true, oc_plazo_entrega: '10 días', oc_condicion_pago: 'Contado', oc_lugar_entrega: 'Almacén', oc_descuento: 100,
    proveedor: { nit: '123', banco: 'BNB' },
  }, 'OC_EN_PREPARACION')]);
  res0 = r.json.resultados[0];
  ok(res0.estado === 'APLICADA' && /^RV-\d+$/.test(res0.proceso.codigo_oc), `Push GUARDAR_OC (emitir) → ${res0.proceso && res0.proceso.codigo_oc}`, res0);
  r = await a.gerente.push([opp('AUTORIZAR_OC', P, {}, 'OC_POR_AUTORIZAR')]);
  ok(r.json.resultados[0].error.codigo === 'SOLO_EN_LINEA', 'Autorizar OC desde la cola → SOLO_EN_LINEA');
  r = await a.gerente.accion(P, 'AUTORIZAR_OC', 'OC_POR_AUTORIZAR', {});
  ok(r.json.proceso.estado === 'EN_SEGUIMIENTO', 'Autorizar OC en línea → seguimiento');

  // ---------- Recepción (varias operaciones en un lote) ----------
  const itemsRec = { [I1]: { cantidad: 2, estado: 'Aceptado', codigo_serie: 'SN1' }, [I2]: { cantidad: 50, estado: 'Aceptado' } };
  r = await a.compras.push([
    opp('SEGUIMIENTO', P, { comentario: 'Proveedor confirmó despacho' }, 'EN_SEGUIMIENTO'),
    opp('GUARDAR_RECEPCION', P, { enviar: false, rec_fecha: '2026-11-20', items: itemsRec }, 'EN_SEGUIMIENTO'),
    opp('GUARDAR_RECEPCION', P, { enviar: true, rec_fecha: '2026-11-20', rec_tipo_bien: 'OPERATIVO', rec_cantidad_ok: true, items: itemsRec }, 'EN_SEGUIMIENTO'),
  ]);
  ok(r.json.resultados.every((x) => x.estado === 'APLICADA') && r.json.resultados[2].proceso.estado === 'EN_ALMACEN',
    'Lote: seguimiento + borrador + envío de recepción → directo a EN_ALMACEN', r.json.resultados);
  r = await a.adm.push([opp('REVISAR_RECEPCION', P, {}, 'EN_ALMACEN')]);
  ok(r.json.resultados[0].error.codigo === 'TIPO_INVALIDO', 'REVISAR_RECEPCION ya no existe → TIPO_INVALIDO');
  r = await a.compras.req('GET', `/procesos/${P}`);
  const itemRec = r.json.proceso.items.find((it) => it.uuid === I1);
  ok(itemRec.rec_codigo_serie === 'SN1' && Number(itemRec.rec_cantidad) === 2, 'Datos de recepción guardados por uuid de ítem');

  // ---------- Fase 2 desde la cola ----------
  r = await a.contador.push([opp('INGRESO', P, { ingreso_comprobante: 'OCT-55' }, 'EN_ALMACEN')]);
  ok(r.json.resultados[0].error.codigo === 'TIPO_INVALIDO', 'INGRESO ya no existe → TIPO_INVALIDO');
  r = await a.adm.push([opp('ENTREGA', P, { entregar: true, ne_fecha: '2026-11-20', ne_entregado_a: 'Juan', items: { [I1]: { cantidad: 2 } } }, 'EN_ALMACEN')]);
  res0 = r.json.resultados[0];
  ok(res0.proceso.estado === 'CERRADO' && /^\d+$/.test(res0.proceso.codigo_ne), `Push ENTREGA → nota N° ${res0.proceso.codigo_ne} y proceso CERRADO`);
  r = await a.adm.push([opp('ENTREGA', P, { entregar: true, ne_fecha: '2026-11-20', ne_entregado_a: 'Juan', items: { [I1]: { cantidad: 2 } } }, 'EN_ALMACEN')]);
  ok(r.json.resultados[0].estado === 'CONFLICTO', 'Repetir la entrega con otro op_id → CONFLICTO (no se emite dos veces)');
  r = await a.coord.push([opp('CONFIRMAR_ENTREGA', P)]);
  ok(r.json.resultados[0].estado === 'APLICADA', 'El solicitante confirma la recepción (opcional, con el proceso cerrado)');
  r = await a.contador.push([opp('EGRESO', P, { egreso_registro: 'EG-9' }, 'CERRADO')]);
  ok(r.json.resultados[0].error.codigo === 'TIPO_INVALIDO', 'EGRESO ya no existe → TIPO_INVALIDO');

  // ---------- Visibles y filtro de cerrados ----------
  r = await a.coord.req('GET', '/sync/visibles');
  ok(r.json.procesos.some((x) => x.uuid === P), 'Visibles incluye el proceso');
  r = await a.coord.req('GET', '/sync/visibles?cerrados_desde=2999-01-01');
  ok(!r.json.procesos.some((x) => x.uuid === P), 'cerrados_desde excluye procesos cerrados antiguos');

  // ---------- La web ve lo que hizo la app ----------
  const web = await admin.req(`/procesos/${lista.json.procesos[0].id}`);
  ok(web.status === 200 && web.texto.includes(codigo), 'La web muestra el proceso creado desde la app');

  // ---------- Refresh y cierre de sesión ----------
  const r1 = a.coord.refresh;
  r = await anon.req('POST', '/auth/refresh', { dispositivo_id: a.coord.dispositivo, refresh_token: r1 });
  ok(r.status === 200 && r.json.refresh_token !== r1, 'Refresh rota el token');
  const r2 = r.json.refresh_token;
  a.coord.token = r.json.access_token;
  r = await anon.req('POST', '/auth/refresh', { dispositivo_id: a.coord.dispositivo, refresh_token: r1 });
  ok(r.status === 200, 'El refresh anterior se acepta dentro del período de gracia (respuesta perdida)');
  const r3 = r.json.refresh_token;
  r = await anon.req('POST', '/auth/refresh', { dispositivo_id: a.coord.dispositivo, refresh_token: r1 });
  ok(r.status === 401, 'Un refresh de dos rotaciones atrás → 401');
  ok((await anon.req('POST', '/auth/refresh', { dispositivo_id: a.coord.dispositivo, refresh_token: 'inventado' })).status === 401, 'Refresh inventado → 401');
  ok(r2 && r3, 'Tokens nuevos emitidos');
  a.coord.token = (await anon.req('POST', '/auth/refresh', { dispositivo_id: a.coord.dispositivo, refresh_token: r3 })).json.access_token;
  ok((await a.coord.req('POST', '/auth/logout')).status === 200, 'Logout');
  r = await a.coord.req('GET', '/auth/yo');
  ok(r.status === 401 && r.json.error.codigo === 'SESION_REVOCADA', 'Tras logout el token de acceso deja de valer');

  // ---------- Desactivar usuario desde la web ----------
  const edit = await admin.req(`/admin/usuarios/${a.otro.usuario.id}`);
  ok(edit.status === 200, 'Admin abre el usuario');
  await admin.post(`/admin/usuarios/${a.otro.usuario.id}`, {
    usuario: `apiotro${sufijo}`, nombre: 'otro api', cargo: 'x', rol_id: roles['Coordinador de Área'], unidades: [idRV],
  });
  r = await a.otro.req('GET', '/auth/yo');
  ok(r.status === 401, `Usuario desactivado en la web → la app pierde acceso (${r.json.error.codigo})`);
  r = await anon.req('POST', '/auth/refresh', { dispositivo_id: a.otro.dispositivo, refresh_token: a.otro.refresh });
  ok(r.status === 401, 'Y tampoco puede renovar la sesión');

  console.log(fallos ? `\n${fallos} FALLO(S)` : '\nTODO OK');
  process.exit(fallos ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
