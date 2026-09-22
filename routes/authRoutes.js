const express = require('express');
const router = express.Router();
// Aquí importarías tus controladores correspondientes

router.get('/login', (req, res) => {
    res.render('auth/login');
});

router.post('/login', async (req, res) => {
    // Lógica para validar credenciales con Prisma y abrir sesión
});

router.get('/registro', (req, res) => {
    res.render('auth/registro'); // Vista de "Crea tu cuenta"
});

router.post('/registro', async (req, res) => {
    // Lógica para registrar un nuevo paciente en la BD
});

router.get('/logout', (req, res) => {
    req.session.destroy();
    res.redirect('/login');
});

module.exports = router;