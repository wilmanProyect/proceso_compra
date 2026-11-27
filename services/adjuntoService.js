// Reglas y operaciones de adjuntos, compartidas por la web y la API de la app móvil
const fs = require('fs');
const path = require('path');
const db = require('../config/db');
const procesoModel = require('../models/procesoModel');
const C = require('../utils/constantes');
const { DIR_ADJUNTOS } = require('../middlewares/subidas');

// Se puede adjuntar mientras el proceso está en curso, y también cuando está cerrado (p. ej. una factura tardía)
function puedeAdjuntar(proceso) {
  return !(C.ESTADOS_FINALES.includes(proceso.estado) && proceso.estado !== 'CERRADO');
}

// Solo quien subió el archivo, y únicamente mientras el proceso está en curso
function puedeEliminar(usuario, adjunto, proceso) {
  return String(adjunto.usuario_id) === String(usuario.id) && !C.ESTADOS_FINALES.includes(proceso.estado);
}

function ruta(adjunto) { return path.join(DIR_ADJUNTOS, path.basename(adjunto.archivo)); }

function borrarArchivos(archivos = []) {
  archivos.forEach((a) => a && a.path && fs.unlink(a.path, () => {}));
}

async function agregar(proceso, etapa, archivos, usuario, ctx = {}) {
  await procesoModel.agregarAdjuntos(proceso.id, etapa, archivos, usuario.id);
  await procesoModel.evento(db, proceso.id, usuario.id, 'Adjuntó documentos', archivos.map((a) => a.originalname).join(', '), null, ctx);
}

async function eliminar(adjunto, proceso, usuario, ctx = {}) {
  await procesoModel.eliminarAdjunto(adjunto.id);
  fs.unlink(ruta(adjunto), () => {});
  await procesoModel.evento(db, proceso.id, usuario.id, 'Eliminó adjunto', adjunto.nombre_original, null, ctx);
}

module.exports = {
  puedeAdjuntar, puedeEliminar, ruta, borrarArchivos, agregar, eliminar,
};
