// Errores de negocio compartidos por la web y la API. Cada uno trae un código y un estado HTTP.
class ErrorNegocio extends Error {
  constructor(codigo, mensaje, status) {
    super(mensaje);
    this.codigo = codigo;
    this.status = status;
  }
}

// Datos inválidos: trae la lista de mensajes para mostrar al usuario
class ErrorValidacion extends ErrorNegocio {
  constructor(errores) {
    super('VALIDACION', errores.join(' '), 422);
    this.errores = errores;
  }
}

// El proceso ya no está en el estado esperado (otra persona actuó antes)
class ErrorFlujo extends ErrorNegocio {
  constructor(mensaje = 'El proceso cambió de estado mientras realizaba la acción. Revise el estado actual.') {
    super('CONFLICTO_ESTADO', mensaje, 409);
  }
}

class ErrorNoEncontrado extends ErrorNegocio {
  constructor(mensaje = 'No se encontró el proceso.') { super('NO_ENCONTRADO', mensaje, 404); }
}

// El usuario no puede ver el proceso
class ErrorSinAcceso extends ErrorNegocio {
  constructor(mensaje = 'No tiene acceso a este proceso.') { super('SIN_ACCESO', mensaje, 403); }
}

// El usuario ve el proceso, pero la acción no le corresponde en el estado actual
class ErrorNoDisponible extends ErrorNegocio {
  constructor(mensaje = 'Esta acción no está disponible para usted en el estado actual del proceso.') {
    super('ACCION_NO_DISPONIBLE', mensaje, 403);
  }
}

module.exports = {
  ErrorNegocio, ErrorValidacion, ErrorFlujo, ErrorNoEncontrado, ErrorSinAcceso, ErrorNoDisponible,
};
