require('dotenv').config();

const path = require('path');
const crypto = require('crypto');
const express = require('express');
const session = require('express-session');
const PgStore = require('connect-pg-simple')(session);
const expressLayouts = require('express-ejs-layouts');
const db = require('./config/db');
const { migrar } = require('./database/migrate');
const rutas = require('./routes');
const { cargarUsuario, prepararCsrf, csrfGlobal, flash } = require('./middlewares/auth');
const C = require('./utils/constantes');
const fmt = require('./utils/formato');
const { calcularPasos } = require('./utils/pasos');

const app = express();
const port = Number(process.env.PORT) || 3000;
const produccion = process.env.NODE_ENV === 'production';

if (!process.env.SESSION_SECRET) {
  console.warn('ADVERTENCIA: SESSION_SECRET no está definido; se usará uno temporal (las sesiones se perderán al reiniciar).');
}

app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
app.set('trust proxy', 1);
app.disable('x-powered-by');
app.use(expressLayouts);
app.set('layout', 'layouts/main');

app.use((req, res, next) => {
  res.setHeader('X-Frame-Options', 'SAMEORIGIN');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'same-origin');
  next();
});
app.use(express.static(path.join(__dirname, 'public')));
// API de la app móvil: token Bearer, sin sesión ni CSRF (debe ir antes de esos middlewares)
app.use('/api/v1', require('./routes/api'));
app.use(express.urlencoded({ extended: true, limit: '1mb', parameterLimit: 5000 }));

app.use(session({
  store: new PgStore({ pool: db, tableName: 'session' }),
  name: 'pc.sid',
  secret: process.env.SESSION_SECRET || crypto.randomBytes(32).toString('hex'),
  resave: false,
  saveUninitialized: false,
  cookie: {
    httpOnly: true,
    sameSite: 'lax',
    secure: produccion && process.env.COOKIE_SECURE === 'true',
    maxAge: 1000 * 60 * 60 * 10,
  },
}));

app.use((req, res, next) => {
  res.locals.C = C;
  res.locals.fmt = fmt;
  res.locals.calcularPasos = calcularPasos;
  // Ícono SVG decorativo del sprite /img/iconos.svg (Lucide)
  res.locals.icono = (nombre, clase = '') => `<svg class="ico ${clase}" aria-hidden="true" focusable="false"><use href="/img/iconos.svg#i-${nombre}"></use></svg>`;
  res.locals.ruta = req.path;
  next();
});
app.use(flash);
app.use(prepararCsrf);
app.use(cargarUsuario);
app.use(csrfGlobal);

app.use(rutas);

app.use((req, res) => {
  res.status(404).render('error', {
    title: 'Página no encontrada', status: 404, message: 'No encontramos la página que busca.',
  });
});

app.use((error, req, res, next) => {
  console.error('Error al procesar la solicitud:', error);
  if (res.headersSent) return next(error);
  return res.status(500).render('error', {
    title: 'Error del servidor', status: 500, message: 'Ocurrió un error al procesar su solicitud. Inténtelo de nuevo más tarde.',
  });
});

migrar()
  .then(() => {
    app.listen(port, '0.0.0.0', () => console.log(`proceso_compra escuchando en el puerto ${port}`));
  })
  .catch((error) => {
    console.error('No se pudo preparar la base de datos:', error);
    process.exit(1);
  });
