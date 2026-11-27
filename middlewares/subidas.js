const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const multer = require('multer');

const DIR_ADJUNTOS = path.resolve(process.env.UPLOADS_DIR || path.join(__dirname, '..', 'uploads'));
const DIR_LOGOS = path.join(__dirname, '..', 'public', 'img', 'logos');
fs.mkdirSync(DIR_ADJUNTOS, { recursive: true });
fs.mkdirSync(DIR_LOGOS, { recursive: true });

const EXT_ADJUNTOS = ['.pdf', '.jpg', '.jpeg', '.png', '.webp', '.doc', '.docx', '.xls', '.xlsx', '.xlsm', '.csv', '.txt', '.zip'];
const EXT_LOGOS = ['.png', '.jpg', '.jpeg', '.webp', '.svg'];

function nombreSeguro(file) {
  return `${Date.now()}-${crypto.randomBytes(8).toString('hex')}${path.extname(file.originalname).toLowerCase()}`;
}

function filtro(extensiones) {
  return (req, file, cb) => {
    // multer entrega el nombre en latin1; convertir a utf8
    file.originalname = Buffer.from(file.originalname, 'latin1').toString('utf8');
    const ext = path.extname(file.originalname).toLowerCase();
    if (extensiones.includes(ext)) return cb(null, true);
    return cb(new multer.MulterError('LIMIT_UNEXPECTED_FILE', `Tipo de archivo no permitido (${ext || 'sin extensión'})`));
  };
}

const adjuntos = multer({
  storage: multer.diskStorage({ destination: DIR_ADJUNTOS, filename: (req, file, cb) => cb(null, nombreSeguro(file)) }),
  limits: { fileSize: 15 * 1024 * 1024, files: 10 },
  fileFilter: filtro(EXT_ADJUNTOS),
});

const logos = multer({
  storage: multer.diskStorage({ destination: DIR_LOGOS, filename: (req, file, cb) => cb(null, nombreSeguro(file)) }),
  limits: { fileSize: 3 * 1024 * 1024, files: 1 },
  fileFilter: filtro(EXT_LOGOS),
});

// Envuelve multer para mostrar errores amigables
function manejar(middleware) {
  return (req, res, next) => middleware(req, res, (error) => {
    if (!error) return next();
    if (error instanceof multer.MulterError) {
      const mensaje = error.code === 'LIMIT_FILE_SIZE' ? 'El archivo supera el tamaño máximo permitido.' : (error.field || error.message);
      req.flash('error', mensaje);
      return res.redirect(req.get('referer') || '/');
    }
    return next(error);
  });
}

module.exports = {
  DIR_ADJUNTOS,
  EXT_ADJUNTOS,
  MAX_ADJUNTO_BYTES: 15 * 1024 * 1024,
  adjuntoApi: adjuntos.single('archivo'), // la API maneja los errores en JSON
  subirAdjuntos: manejar(adjuntos.array('archivos', 10)),
  subirLogo: manejar(logos.single('logo')),
};
