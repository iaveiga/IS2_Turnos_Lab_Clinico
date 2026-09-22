require('dotenv').config();
const express = require('express');
const path = require('path');

const app = express();
const port = process.env.PORT || 3000;

// 1. Configurar EJS como motor de vistas
app.set('view engine', 'ejs');

// 2. Middlewares esenciales (¡Cruciales para formularios y archivos estáticos!)
app.use(express.urlencoded({ extended: true })); // Permite leer los datos enviados desde formularios POST
app.use(express.json());                         // Permite procesar peticiones JSON
app.use(express.static(path.join(__dirname, 'public'))); // Sirve tu custom.css y recursos

// 3. Montar las rutas del sistema
// (Asegúrate de crear la carpeta 'routes' y los archivos correspondientes)
app.use('/', require('./routes/indexRoutes'));
app.use('/auth', require('./routes/authRoutes'));
app.use('/turnos', require('./routes/turnoRoutes'));
app.use('/servicios', require('./routes/servicioRoutes'));
app.use('/pacientes', require('./routes/pacienteRoutes'));

// 4. Iniciar el servidor
app.listen(port, () => {
  console.log(`Servidor corriendo en http://localhost:${port}`);
});