require('dotenv').config();
const express = require('express');
const { Pool } = require('pg');

const app = express();
const port = process.env.PORT || 3000;

// Configuración de la conexión a Neon PostgreSQL
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: {
    rejectUnauthorized: false
  }
});

// Configurar EJS como motor de vistas
app.set('view engine', 'ejs');

// Carpeta de archivos estáticos (CSS, imágenes, etc.)
app.use(express.static('public'));

// Ruta principal para probar servidor y base de datos
app.get('/', async (req, res) => {
  try {
    // Intentar una consulta rápida a Neon para verificar conectividad
    const client = await pool.connect();
    const result = await client.query('SELECT NOW()');
    const dbTime = result.rows[0].now;
    client.release();

    // Renderizar la vista pasando los datos de prueba
    res.render('index', { dbTime, error: null });
  } catch (err) {
    console.error('Error al conectar con la base de datos:', err);
    res.render('index', { dbTime: null, error: err.message });
  }
});

// Iniciar el servidor (mantiene el proceso abierto)
app.listen(port, () => {
  console.log(`Servidor corriendo en http://localhost:${port}`);
});