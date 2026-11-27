const ZONA = process.env.TZ_APP || 'America/La_Paz';

function dinero(valor) {
  const n = Number(valor) || 0;
  return n.toLocaleString('es-BO', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function cantidad(valor) {
  if (valor === null || valor === undefined || valor === '') return '';
  const n = Number(valor);
  return Number.isInteger(n) ? String(n) : n.toLocaleString('es-BO', { maximumFractionDigits: 2 });
}

// Partes de fecha en la zona horaria de la empresa
function partes(d) {
  const f = new Intl.DateTimeFormat('en-CA', {
    timeZone: ZONA, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false,
  }).formatToParts(d);
  const o = {};
  f.forEach((p) => { o[p.type] = p.value; });
  return o;
}

// Las columnas DATE llegan como texto 'YYYY-MM-DD' (ver config/db.js)
function fecha(valor) {
  if (!valor) return '';
  if (typeof valor === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(valor)) {
    const [y, m, d] = valor.split('-');
    return `${d}/${m}/${y}`;
  }
  const d = new Date(valor);
  if (Number.isNaN(d.getTime())) return '';
  const p = partes(d);
  return `${p.day}/${p.month}/${p.year}`;
}

function fechaHora(valor) {
  if (!valor) return '';
  const d = new Date(valor);
  if (Number.isNaN(d.getTime())) return '';
  const p = partes(d);
  return `${p.day}/${p.month}/${p.year} ${p.hour === '24' ? '00' : p.hour}:${p.minute}`;
}

function fechaInput(valor) {
  if (!valor) return '';
  if (typeof valor === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(valor)) return valor;
  const d = new Date(valor);
  if (Number.isNaN(d.getTime())) return '';
  const p = partes(d);
  return `${p.year}-${p.month}-${p.day}`;
}

function hoy() { return fechaInput(new Date()); }
function gestionActual() { return Number(hoy().slice(0, 4)); }

// Códigos correlativos sin ceros a la izquierda
function codigoRequerimiento(p) { return `${p.sigla}-REQ-${p.nro_requerimiento}`; }
function codigoOc(p) { return p.oc_numero ? `${p.sigla}-${p.oc_numero}` : ''; }
function codigoNotaEntrega(p) { return p.ne_numero ? String(p.ne_numero) : ''; }

module.exports = {
  dinero, cantidad, fecha, fechaHora, fechaInput, hoy, gestionActual,
  codigoRequerimiento, codigoOc, codigoNotaEntrega,
};
