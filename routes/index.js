const express = require('express');
const auth = require('../controllers/authController');
const admin = require('../controllers/adminController');
const procesos = require('../controllers/procesoController');
const flujo = require('../controllers/flujoController');
const proveedores = require('../controllers/proveedorController');
const formularios = require('../controllers/formularioController');
const { requiereLogin, requierePermiso, validarCsrf } = require('../middlewares/auth');
const { subirAdjuntos, subirLogo } = require('../middlewares/subidas');

const router = express.Router();

// CSRF para formularios multipart: se valida después de multer y se borran los archivos si falla
function csrfMultipart(req, res, next) {
  const original = res.render.bind(res);
  res.render = (...args) => {
    procesos.borrarArchivos(req.files || (req.file ? [req.file] : []));
    return original(...args);
  };
  return validarCsrf(req, res, () => {
    res.render = original;
    next();
  });
}

// ---------- Autenticación ----------
router.get('/login', auth.formulario);
router.post('/login', auth.ingresar);
router.post('/logout', auth.salir);

router.use(requiereLogin);

router.get('/cuenta/password', auth.formularioPassword);
router.post('/cuenta/password', auth.cambiarPassword);

// ---------- Procesos ----------
router.get('/', procesos.inicio);
router.get('/procesos', procesos.listar);
router.get('/procesos/nuevo', requierePermiso('procesos.crear'), procesos.nuevo);
router.post('/procesos', requierePermiso('procesos.crear'), subirAdjuntos, csrfMultipart, procesos.crear);
router.get('/procesos/:id', procesos.detalle);
router.get('/procesos/:id/imprimir/:doc', procesos.imprimir);
router.post('/procesos/:id/adjuntos', subirAdjuntos, csrfMultipart, procesos.subirAdjuntos);
router.get('/adjuntos/:id', procesos.descargarAdjunto);
router.post('/adjuntos/:id/eliminar', procesos.eliminarAdjunto);

// Fase 1
router.post('/procesos/:id/anular', flujo.anular);
router.post('/procesos/:id/aprobar-solicitud', flujo.aprobarSolicitud);
router.post('/procesos/:id/cuadro', flujo.guardarCuadro);
router.post('/procesos/:id/excepcion', flujo.desbloquear);
router.post('/procesos/:id/aprobar-cuadro', flujo.aprobarCuadro);
router.post('/procesos/:id/orden-compra', flujo.guardarOc);
router.post('/procesos/:id/autorizar-oc', flujo.autorizarOc);
router.post('/procesos/:id/seguimiento', flujo.seguimiento);
router.post('/procesos/:id/cerrar-servicio', flujo.cerrarServicio);
// Fase 2
router.post('/procesos/:id/recepcion', flujo.guardarRecepcion);
router.post('/procesos/:id/entrega', flujo.entrega);
router.post('/procesos/:id/confirmar-entrega', flujo.confirmarEntrega);

// ---------- Administración ----------
router.get('/admin/usuarios', requierePermiso('admin.usuarios'), admin.usuarios);
router.get('/admin/usuarios/nuevo', requierePermiso('admin.usuarios'), admin.formularioUsuario);
router.post('/admin/usuarios/nuevo', requierePermiso('admin.usuarios'), admin.guardarUsuario);
router.get('/admin/usuarios/:id', requierePermiso('admin.usuarios'), admin.formularioUsuario);
router.post('/admin/usuarios/:id', requierePermiso('admin.usuarios'), admin.guardarUsuario);
router.get('/admin/roles', requierePermiso('admin.roles'), admin.roles);
router.post('/admin/roles', requierePermiso('admin.roles'), admin.guardarRoles);
router.get('/admin/unidades', requierePermiso('admin.unidades'), admin.unidades);
router.get('/admin/unidades/:id', requierePermiso('admin.unidades'), admin.formularioUnidad);
router.post('/admin/unidades/:id', requierePermiso('admin.unidades'), subirLogo, csrfMultipart, admin.guardarUnidad);
router.post('/admin/unidades/:id/departamentos', requierePermiso('admin.unidades'), admin.agregarDepartamento);
router.post('/admin/unidades/:id/departamentos/:depId', requierePermiso('admin.unidades'), admin.cambiarDepartamento);

// Formularios electrónicos (encabezados)
router.get('/admin/formularios', requierePermiso('admin.formularios'), formularios.listar);
router.get('/admin/formularios/nuevo', requierePermiso('admin.formularios'), formularios.formulario);
router.post('/admin/formularios/nuevo', requierePermiso('admin.formularios'), formularios.guardar);
router.post('/admin/formularios/tipos', requierePermiso('admin.formularios'), formularios.agregarTipo);
router.post('/admin/formularios/tipos/:id', requierePermiso('admin.formularios'), formularios.cambiarTipo);
router.get('/admin/formularios/:id', requierePermiso('admin.formularios'), formularios.formulario);
router.post('/admin/formularios/:id', requierePermiso('admin.formularios'), formularios.guardar);

// ---------- Proveedores ----------
const ver = requierePermiso('proveedores.ver');
const gestionar = requierePermiso('proveedores.gestionar');
const aprobar = requierePermiso('proveedores.aprobar');
router.get('/proveedores', ver, proveedores.listar);
router.get('/proveedores/listado/imprimir', ver, proveedores.imprimirListado);
router.get('/proveedores/listado.csv', ver, proveedores.exportarListado);
router.get('/proveedores/nuevo', gestionar, proveedores.formulario);
router.post('/proveedores', gestionar, proveedores.guardar);
router.get('/proveedores/adjuntos/:id', ver, proveedores.descargarAdjunto);
router.post('/proveedores/adjuntos/:id/eliminar', ver, proveedores.eliminarAdjunto);
router.get('/proveedores/evaluaciones/:id', ver, proveedores.verEvaluacion);
router.get('/proveedores/evaluaciones/:id/imprimir', ver, proveedores.imprimirEvaluacion);
router.post('/proveedores/evaluaciones/:id', gestionar, proveedores.guardarEvaluacion);
router.post('/proveedores/evaluaciones/:id/aprobar', aprobar, proveedores.aprobarEvaluacion);
router.post('/proveedores/evaluaciones/:id/descartar', gestionar, proveedores.descartarEvaluacion);
router.get('/proveedores/:id', ver, proveedores.ficha);
router.get('/proveedores/:id/editar', gestionar, proveedores.formulario);
router.post('/proveedores/:id', gestionar, proveedores.guardar);
router.post('/proveedores/:id/estado', aprobar, proveedores.cambiarEstado);
router.post('/proveedores/:id/reevaluacion', aprobar, proveedores.cambiarReevaluacion);
router.post('/proveedores/:id/incidencias', gestionar, proveedores.agregarIncidencia);
router.post('/proveedores/:id/adjuntos', gestionar, subirAdjuntos, csrfMultipart, proveedores.subirAdjuntos);
router.post('/proveedores/:id/evaluaciones', gestionar, proveedores.nuevaEvaluacion);

module.exports = router;
