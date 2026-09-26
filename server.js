require('dotenv').config();
const express = require('express');
const path = require('path');
const prisma = require('./config/prisma');

const session = require('express-session');

const app = express();
const port = process.env.PORT || 3000;

// 1. Configurar EJS como motor de vistas
app.set('view engine', 'ejs');

// 2. Middlewares esenciales (¡Cruciales para formularios y archivos estáticos!)
app.use(express.urlencoded({ extended: true })); // Permite leer los datos enviados desde formularios POST
app.use(express.json());                         // Permite procesar peticiones JSON
app.use(express.static(path.join(__dirname, 'public'))); // Sirve tu custom.css y recursos

// 2.1. Configuración de sesiones de usuario
app.use(session({
  secret: process.env.SESSION_SECRET || 'turnos_clinica_san_francisco_uees_2026',
  resave: false,
  saveUninitialized: false,
  cookie: {
    maxAge: 1000 * 60 * 60 * 24, // 24 horas
    httpOnly: true,
    sameSite: 'lax'
  }
}));

// 2.2. Pasar información de la sesión a las vistas
app.use((req, res, next) => {
  res.locals.usuario = req.session?.user || null;
  next();
});

// Redirecciones directas de conveniencia
app.get('/login', (req, res) => res.redirect('/auth/login'));
app.get('/registro', (req, res) => res.redirect('/auth/registro'));

// 3. Montar las rutas del sistema
// (Asegúrate de crear la carpeta 'routes' y los archivos correspondientes)
app.use('/', require('./routes/indexRoutes'));
app.use('/auth', require('./routes/authRoutes'));
app.use('/turnos', require('./routes/turnoRoutes'));
app.use('/servicios', require('./routes/servicioRoutes'));
app.use('/pacientes', require('./routes/pacienteRoutes'));

// 4. Verificar la base de datos antes de iniciar el servidor
async function iniciarServidor() {
  try {
    await prisma.$connect();
    console.log('Conexion con PostgreSQL establecida');

    app.listen(port, () => {
      console.log(`Servidor corriendo en http://localhost:${port}`);
    });
  } catch (error) {
    console.error('No se pudo conectar con PostgreSQL:', error.message);
    process.exit(1);
  }
}

async function cerrarConexion() {
  await prisma.$disconnect();
  process.exit(0);
}

process.on('SIGINT', cerrarConexion);
process.on('SIGTERM', cerrarConexion);

iniciarServidor();
