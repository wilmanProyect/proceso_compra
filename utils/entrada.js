// Helpers para leer y validar datos de formularios
function texto(valor, max = 500) {
  if (valor === undefined || valor === null) return '';
  return String(Array.isArray(valor) ? valor[0] : valor).trim().slice(0, max);
}

function numero(valor) {
  if (valor === undefined || valor === null || valor === '') return null;
  const n = Number(String(valor).replace(',', '.'));
  return Number.isFinite(n) ? n : null;
}

function fecha(valor) {
  const v = texto(valor, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : null;
}

function bool(valor) {
  return valor === 'on' || valor === '1' || valor === 'true' || valor === true;
}

function lista(valor) {
  if (valor === undefined || valor === null) return [];
  if (Array.isArray(valor)) return valor;
  if (typeof valor === 'object') return Object.values(valor);
  return [valor];
}

function opcion(valor, permitidos, porDefecto = null) {
  const v = texto(valor, 60);
  const claves = Array.isArray(permitidos) ? permitidos : Object.keys(permitidos);
  return claves.includes(v) ? v : porDefecto;
}

module.exports = { texto, numero, fecha, bool, lista, opcion };
