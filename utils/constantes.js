// paso: en cuál de los 5 documentos está el proceso · tarea: qué hay que hacer · quien: quién lo hace
const ESTADOS = {
  CERRADO_STOCK: { nombre: 'Atendido con stock', fase: 1, paso: 1, clase: 'cerrado' },
  PENDIENTE_APROBACION: {
    nombre: 'Revisión presupuestaria', fase: 1, paso: 1, clase: 'pendiente', permiso: 'solicitud.aprobar',
    tarea: 'Aprobar o rechazar la solicitud', quien: 'Gerencia', rapida: 'aprobar-solicitud',
  },
  RECHAZADO: { nombre: 'Rechazado', fase: 1, paso: 1, clase: 'rechazado' },
  ANULADO: { nombre: 'Anulado', fase: 1, paso: 1, clase: 'rechazado' },
  EN_COTIZACION: {
    nombre: 'En cotización', fase: 1, paso: 2, clase: 'proceso', permiso: 'cotizacion.gestionar',
    tarea: 'Registrar las cotizaciones de los proveedores', quien: 'Responsable de Compras',
  },
  COTIZACION_POR_APROBAR: {
    nombre: 'Cuadro comparativo por aprobar', fase: 1, paso: 2, clase: 'pendiente', permiso: 'cotizacion.aprobar',
    tarea: 'Aprobar el cuadro comparativo', quien: 'Gerencia', rapida: 'aprobar-cuadro',
  },
  OC_EN_PREPARACION: {
    nombre: 'Orden de compra en preparación', fase: 1, paso: 3, clase: 'proceso', permiso: 'oc.emitir',
    tarea: 'Completar y emitir la orden de compra', quien: 'Responsable de Compras',
  },
  OC_POR_AUTORIZAR: {
    nombre: 'Orden de compra por autorizar', fase: 1, paso: 3, clase: 'pendiente', permiso: 'oc.autorizar',
    tarea: 'Autorizar la orden de compra', quien: 'Gerencia', rapida: 'autorizar-oc',
  },
  EN_SEGUIMIENTO: {
    nombre: 'Esperando recepción', fase: 1, paso: 4, clase: 'proceso', permiso: ['seguimiento.registrar', 'recepcion.registrar'],
    tarea: 'Registrar la recepción cuando llegue el material', tareaServicio: 'Cerrar el proceso cuando el servicio concluya', quien: 'Responsable de Compras',
  },
  EN_ALMACEN: {
    nombre: 'Por entregar', fase: 2, paso: 5, clase: 'proceso', permiso: 'entrega.registrar',
    tarea: 'Emitir la nota de entrega', quien: 'Coord. Adm. y RRHH',
  },
  CERRADO: { nombre: 'Cerrado', fase: 2, paso: 6, clase: 'cerrado' },
};

// Los 5 pasos del flujo: uno por documento
const PASOS = [
  { n: 1, titulo: 'Solicitud', corto: 'Solicitud', documento: 'SOLICITUD' },
  { n: 2, titulo: 'Cuadro comparativo de cotizaciones', corto: 'Cotizaciones', documento: 'CUADRO' },
  { n: 3, titulo: 'Orden de compra', corto: 'Orden de compra', documento: 'ORDEN_COMPRA' },
  { n: 4, titulo: 'Registro de inspección y recepción', corto: 'Recepción', documento: 'RECEPCION' },
  { n: 5, titulo: 'Nota de entrega', corto: 'Entrega', documento: 'NOTA_ENTREGA' },
];

const ESTADOS_FINALES = ['CERRADO_STOCK', 'RECHAZADO', 'ANULADO', 'CERRADO'];

const TIPOS_SOLICITUD = {
  COMPRA: 'Compra de bienes / materiales',
  SERVICIO: 'Contratación de servicio',
  EQUIPO_TECNOLOGICO: 'Equipo tecnológico',
};

const PRIORIDADES = { ALTA: 'Alta', MEDIA: 'Media', BAJA: 'Baja' };

const MONEDAS = { BS: 'Bolivianos (Bs)', USD: 'Dólares ($us)' };

const TIPOS_BIEN = { CONSUMO: 'Consumo / Consumible', OPERATIVO: 'Operativo', ACTIVO_FIJO: 'Activo Fijo' };

const ESTADOS_INSPECCION = ['Aceptado', 'Aceptado con observaciones', 'Rechazado'];

const CRITERIOS = [
  'Calidad del Producto o Servicio',
  'Cumplimiento de Especificaciones Técnicas',
  'Cumplimiento Documental y Requisitos',
  'Disponibilidad de Soporte Técnico',
  'Garantías Ofrecidas',
  'Tiempo o Plazo de Entrega',
  'Precio Ofertado Total',
  'Condiciones de Pago',
];

const FORMULARIOS = {
  SOLICITUD: 'Solicitud de Compras/Servicios',
  ACTA_TECNOLOGICO: 'Acta de Solicitud de Equipo Tecnológico',
  CUADRO: 'Cuadro Comparativo de Cotizaciones',
  ORDEN_COMPRA: 'Orden de Compra',
  RECEPCION: 'Registro de Inspección y Recepción',
  NOTA_ENTREGA: 'Nota de Entrega',
  EVAL_PROVEEDOR: 'Evaluación y Re-evaluación de Proveedores',
  LISTADO_PROVEEDORES: 'Listado de Proveedores Aprobados',
};

// Formularios que usa el sistema: [clave, sufijo de código, versión, fecha, título en mayúsculas]
// (de las plantillas de /docs/procesos; cada unidad usa su sigla como prefijo: RV.FCOM.01.1, ZB.FCOM.01.1...)
const FORMULARIOS_SISTEMA = [
  ['SOLICITUD', 'FCOM.01.1', '0', '2025-02-18', 'SOLICITUD DE COMPRAS/SERVICIOS'],
  ['ACTA_TECNOLOGICO', 'FCOM.01.4', '0', '2026-11-04', 'ACTA DE SOLICITUD DE EQUIPO TECNOLÓGICO'],
  ['CUADRO', 'FCOM.01.2', '1', '2026-11-09', 'CUADRO COMPARATIVO DE COTIZACIONES'],
  ['ORDEN_COMPRA', 'FCOM.01.3', '1', '2026-11-09', 'ORDEN DE COMPRA'],
  ['RECEPCION', 'FCOM.01.1', '0', '2026-06-06', 'REGISTRO DE INSPECCIÓN Y RECEPCIÓN'],
  ['NOTA_ENTREGA', 'FCOM.01.2', '0', '2026-06-06', 'NOTA DE ENTREGA'],
  ['EVAL_PROVEEDOR', 'FCOM.02.1', '0', '2026-06-20', 'EVALUACIÓN Y RE-EVALUACIÓN DE PROVEEDORES'],
  ['LISTADO_PROVEEDORES', 'FCOM.02.2', '0', '2026-06-20', 'LISTADO DE PROVEEDORES APROBADOS'],
];

// "Tabla N°1" del documento de encabezados (no venía en el archivo): editable desde Formularios
const TIPOS_DOCUMENTO = ['Formulario', 'Registro', 'Procedimiento', 'Instructivo', 'Manual', 'Política'];
const ESTADOS_FORMULARIO = { EN_REVISION: 'En revisión', APROBADO: 'Aprobado' };

// ===================== Proveedores (RV.PCOM.02) =====================
// elegible: se puede elegir en el cuadro comparativo
const ESTADOS_PROVEEDOR = {
  NUEVO: { nombre: 'Nuevo (sin evaluar)', clase: 'neutro', elegible: true },
  APROBADO: { nombre: 'Aprobado', clase: 'cerrado', elegible: true },
  APROBADO_OBS: { nombre: 'Aprobado con observaciones', clase: 'pendiente', elegible: true },
  NO_APROBADO: { nombre: 'No aprobado', clase: 'rechazado', elegible: false },
  SUSPENDIDO: { nombre: 'Suspendido', clase: 'rechazado', elegible: false },
  RETIRADO: { nombre: 'Retirado del listado', clase: 'rechazado', elegible: false },
};
const CLASIFICACIONES = { CRITICO: 'Crítico', NO_CRITICO: 'No crítico' };
// Reevaluación por defecto (4.7): críticos cada año, no críticos cada dos años. La define quien aprueba.
const MESES_REEVALUACION = { CRITICO: 12, NO_CRITICO: 24 };

// Criterios del formulario RV.FCOM.02.1 (los 6 del formulario)
const CRITERIOS_PROVEEDOR = [
  'Calidad del Producto o Servicio',
  'Cumplimiento de Plazos de Entrega',
  'Atención y Soporte Técnico',
  'Cumplimiento Documental y Requisitos',
  'Garantías y Respaldo Comercial',
  'Competitividad de Precios',
];
const ESCALA_PROVEEDOR = [
  ['1 a 2', 'Muy Deficiente'], ['3 a 4', 'Deficiente'], ['5 a 6', 'Aceptable'],
  ['7 a 8', 'Bueno'], ['9 a 10', 'Excelente'], ['N/A', 'No Aplica'],
];
const RESULTADOS_EVALUACION = { APROBADO: 'Aprobado', APROBADO_OBS: 'Aprobado con observaciones', NO_APROBADO: 'No aprobado' };
const ACCIONES_EVALUACION = {
  mantener: 'Mantener como proveedor aprobado',
  seguimiento: 'Realizar seguimiento',
  reevaluar: 'Reevaluar en ___ meses',
  correctivas: 'Solicitar acciones correctivas',
  suspender: 'Suspender temporalmente',
  retirar: 'Retirar del listado de proveedores aprobados',
};
const TIPOS_TIPO_EVALUACION = { INICIAL: 'Inicial', REEVALUACION: 'Re-evaluación' };
const ESTADOS_EVALUACION = {
  BORRADOR: { nombre: 'Borrador', clase: 'neutro' },
  POR_APROBAR: { nombre: 'Por aprobar', clase: 'pendiente' },
  APROBADA: { nombre: 'Aprobada', clase: 'cerrado' },
};
const TIPOS_DOC_PROVEEDOR = [
  'Registro tributario (NIT)', 'Certificación o acreditación', 'Catálogo o ficha técnica',
  'Licencia, autorización o permiso', 'Documentación comercial o referencia', 'Garantía o soporte técnico', 'Otro',
];

// Resultado según el promedio (4.5): 8 a 10 Aprobado; 6 a 7,9 Aprobado con observaciones; menor a 6 No aprobado
function resultadoEvaluacion(promedio) {
  if (promedio === null || promedio === undefined) return null;
  if (promedio >= 8) return 'APROBADO';
  if (promedio >= 6) return 'APROBADO_OBS';
  return 'NO_APROBADO';
}

const ETAPAS_ADJUNTO = {
  SOLICITUD: 'Solicitud',
  COTIZACION: 'Cotizaciones / proformas',
  ORDEN_COMPRA: 'Orden de compra',
  RECEPCION: 'Recepción (factura, recibo, proforma)',
  ENTREGA: 'Nota de entrega',
};

// Escala de cotizaciones según monto en Bs (PROCESOS DE COMPRAS Rev.1)
function cotizacionesRequeridas(montoBs) {
  const monto = Number(montoBs) || 0;
  if (monto <= 1000) return 0;
  if (monto <= 3000) return 1;
  if (monto <= 20000) return 2;
  return 3;
}

module.exports = {
  ESTADOS, PASOS, ESTADOS_FINALES, TIPOS_SOLICITUD, PRIORIDADES, MONEDAS, TIPOS_BIEN,
  ESTADOS_INSPECCION, CRITERIOS, FORMULARIOS, ETAPAS_ADJUNTO, cotizacionesRequeridas,
  FORMULARIOS_SISTEMA, TIPOS_DOCUMENTO, ESTADOS_FORMULARIO,
  ESTADOS_PROVEEDOR, CLASIFICACIONES, MESES_REEVALUACION, CRITERIOS_PROVEEDOR, ESCALA_PROVEEDOR,
  RESULTADOS_EVALUACION, ACCIONES_EVALUACION, TIPOS_TIPO_EVALUACION, ESTADOS_EVALUACION, TIPOS_DOC_PROVEEDOR,
  resultadoEvaluacion,
};
