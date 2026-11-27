// Determina qué acciones puede realizar el usuario sobre el proceso según estado y permisos
function calcularAcciones(usuario, p) {
  const puede = (permiso) => usuario.permisos.includes(permiso);
  const e = p.estado;
  const esSolicitante = String(p.solicitante_id) === String(usuario.id);
  const esServicio = p.tipo_solicitud === 'SERVICIO';

  return {
    anular: esSolicitante && e === 'PENDIENTE_APROBACION',
    aprobarSolicitud: puede('solicitud.aprobar') && e === 'PENDIENTE_APROBACION',
    editarCuadro: puede('cotizacion.gestionar') && e === 'EN_COTIZACION',
    desbloquear: puede('cotizacion.desbloquear') && ['EN_COTIZACION', 'COTIZACION_POR_APROBAR'].includes(e),
    aprobarCuadro: puede('cotizacion.aprobar') && e === 'COTIZACION_POR_APROBAR',
    editarOc: puede('oc.emitir') && e === 'OC_EN_PREPARACION',
    autorizarOc: puede('oc.autorizar') && e === 'OC_POR_AUTORIZAR',
    seguimiento: puede('seguimiento.registrar') && ['OC_POR_AUTORIZAR', 'EN_SEGUIMIENTO'].includes(e),
    cerrarServicio: puede('seguimiento.registrar') && esServicio && e === 'EN_SEGUIMIENTO',
    editarRecepcion: puede('recepcion.registrar') && !esServicio && e === 'EN_SEGUIMIENTO',
    entrega: puede('entrega.registrar') && e === 'EN_ALMACEN',
    confirmarEntrega: esSolicitante && e === 'CERRADO' && p.ne_numero && !p.firmas['NOTA_ENTREGA.RECIBIDO'],
  };
}

module.exports = { calcularAcciones };
