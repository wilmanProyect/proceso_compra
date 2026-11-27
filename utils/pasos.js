const { ESTADOS, PASOS } = require('./constantes');

const TERMINALES_PASO1 = {
  RECHAZADO: 'Rechazada',
  ANULADO: 'Anulada',
  CERRADO_STOCK: 'Atendida con stock',
};

function noAplica(p, n) {
  if (n === 3 && !p.requiere_oc) return 'No requiere orden de compra (no es producto crítico ni activo fijo).';
  if (p.tipo_solicitud === 'SERVICIO' && n === 5) return 'Los servicios no generan nota de entrega.';
  return null;
}

// Devuelve los 5 pasos con su estado: hecho | actual | pendiente | no_aplica | detenido
function calcularPasos(p) {
  const est = ESTADOS[p.estado] || {};
  const actual = est.paso || 1;
  const terminal = TERMINALES_PASO1[p.estado];
  return PASOS.map((paso) => {
    const titulo = paso.n === 1 && p.tipo_solicitud === 'EQUIPO_TECNOLOGICO' ? 'Acta de solicitud de equipo tecnológico' : paso.titulo;
    const corto = paso.n === 4 && p.tipo_solicitud === 'SERVICIO' ? 'Cierre' : paso.corto;
    const base = { ...paso, titulo, corto };
    const na = noAplica(p, paso.n);
    if (na) return { ...base, estado: 'no_aplica', nota: na };
    if (terminal) return { ...base, estado: paso.n === 1 ? 'detenido' : 'pendiente', nota: paso.n === 1 ? terminal : '' };
    if (paso.n < actual) return { ...base, estado: 'hecho' };
    if (paso.n === actual) return { ...base, estado: 'actual' };
    return { ...base, estado: 'pendiente' };
  });
}

// Paso a mostrar por defecto: el actual, o el último aplicable si el proceso está cerrado
function pasoPorDefecto(p, pasos) {
  const actual = pasos.find((x) => x.estado === 'actual' || x.estado === 'detenido');
  if (actual) return actual.n;
  const aplicables = pasos.filter((x) => x.estado !== 'no_aplica');
  return aplicables[aplicables.length - 1].n;
}

// Qué sigue, en lenguaje simple
function siguiente(p, acciones) {
  const est = ESTADOS[p.estado] || {};
  if (p.estado === 'CERRADO') return { tipo: 'fin', titulo: 'Proceso terminado', texto: 'Todos los pasos se completaron.' };
  if (p.estado === 'RECHAZADO') return { tipo: 'detenido', titulo: 'Solicitud rechazada', texto: p.motivo_rechazo };
  if (p.estado === 'ANULADO') return { tipo: 'detenido', titulo: 'Solicitud anulada', texto: 'El solicitante anuló esta solicitud.' };
  if (p.estado === 'CERRADO_STOCK') {
    return { tipo: 'fin', titulo: 'Atendida con stock', texto: 'El material existe en almacén. Coordine la entrega con el Coordinador Adm. y RRHH.' };
  }
  const tarea = p.tipo_solicitud === 'SERVICIO' && est.tareaServicio ? est.tareaServicio : est.tarea;
  const meToca = Object.entries(acciones).some(([k, v]) => v && !['anular', 'seguimiento', 'desbloquear', 'confirmarEntrega'].includes(k));
  return { tipo: meToca ? 'mio' : 'espera', titulo: tarea, quien: est.quien, paso: est.paso };
}

module.exports = { calcularPasos, pasoPorDefecto, siguiente };
