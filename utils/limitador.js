// Limitador simple de intentos fallidos de inicio de sesión por IP + usuario (web y API comparten el contador)
const MAX_INTENTOS = 5;
const BLOQUEO_MS = 10 * 60 * 1000;
const intentos = new Map();

function clave(ip, usuario) { return `${ip}|${String(usuario || '').toLowerCase()}`; }

function vigente(registro) { return registro && Date.now() - registro.desde < BLOQUEO_MS; }

function bloqueado(k) {
  const r = intentos.get(k);
  return Boolean(vigente(r) && r.cantidad >= MAX_INTENTOS);
}

function registrarFallo(k) {
  const r = intentos.get(k);
  const actual = vigente(r) ? r : { cantidad: 0, desde: Date.now() };
  actual.cantidad += 1;
  intentos.set(k, actual);
  // Evita que el mapa crezca sin límite
  if (intentos.size > 10000) {
    for (const [kk, rr] of intentos) if (!vigente(rr)) intentos.delete(kk);
  }
}

function registrarExito(k) { intentos.delete(k); }

module.exports = { clave, bloqueado, registrarFallo, registrarExito };
