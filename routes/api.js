// API JSON para la app móvil (docs/APP_MOVIL.md §7). Autenticación por token Bearer, sin cookies ni CSRF.
const express = require('express');
const multer = require('multer');
const authApi = require('../controllers/api/authApi');
const procesosApi = require('../controllers/api/procesosApi');
const { requiereToken } = require('../middlewares/apiAuth');
const { adjuntoApi } = require('../middlewares/subidas');
const { error } = require('../controllers/api/comun');

const router = express.Router();
router.use(express.json({ limit: '1mb' }));
router.use((req, res, next) => { res.setHeader('Cache-Control', 'no-store'); next(); });

// Multer con errores en JSON
function subida(req, res, next) {
  adjuntoApi(req, res, (e) => {
    if (!e) return next();
    if (e instanceof multer.MulterError) {
      const grande = e.code === 'LIMIT_FILE_SIZE';
      return error(res, grande ? 413 : 422, grande ? 'ARCHIVO_GRANDE' : 'ARCHIVO_INVALIDO',
        grande ? 'El archivo supera el tamaño máximo permitido.' : (e.field || e.message));
    }
    return next(e);
  });
}

router.get('/ping', (req, res) => res.json({ ok: true, hora: new Date().toISOString() }));

// ---------- Autenticación ----------
router.post('/auth/login', authApi.login);
router.post('/auth/refresh', authApi.refrescar);

router.use(requiereToken);

router.post('/auth/logout', authApi.salir);
router.get('/auth/yo', authApi.yo);
router.post('/auth/password', authApi.cambiarPassword);

// ---------- Datos ----------
router.get('/catalogos', procesosApi.catalogos);
router.get('/procesos', procesosApi.listar);
router.post('/procesos', procesosApi.crear);
router.get('/procesos/:uuid', procesosApi.obtener);
router.post('/procesos/:uuid/acciones', procesosApi.accion);
router.post('/procesos/:uuid/adjuntos', subida, procesosApi.subirAdjunto);
router.get('/adjuntos/:uuid', procesosApi.descargarAdjunto);
router.delete('/adjuntos/:uuid', procesosApi.eliminarAdjunto);

// ---------- Sincronización ----------
router.post('/sync/push', procesosApi.push);
router.get('/sync/pull', procesosApi.pull);
router.get('/sync/visibles', procesosApi.visibles);

router.use((req, res) => error(res, 404, 'NO_ENCONTRADO', 'Ruta no encontrada.'));

// eslint-disable-next-line no-unused-vars
router.use((e, req, res, next) => {
  if (e.type === 'entity.parse.failed') return error(res, 400, 'JSON_INVALIDO', 'El cuerpo no es un JSON válido.');
  if (e.type === 'entity.too.large') return error(res, 413, 'CUERPO_GRANDE', 'El cuerpo de la petición es demasiado grande.');
  console.error('Error en la API:', e);
  return error(res, 500, 'ERROR', 'Ocurrió un error en el servidor.');
});

module.exports = router;
