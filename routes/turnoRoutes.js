const express = require('express');
const router = express.Router();
const { verificarPermiso } = require('../middlewares/authMiddleware');

// Listar turnos del paciente o laboratorio
router.get('/', verificarPermiso('VER_TURNOS'), async (req, res) => {
    res.render('turnos/lista');
});

// Formulario para reservar un nuevo turno
router.get('/nuevo', verificarPermiso('CREAR_TURNO'), async (req, res) => {
    res.render('turnos/nuevo');
});

// Guardar turno en la base de datos
router.post('/nuevo', verificarPermiso('CREAR_TURNO'), async (req, res) => {
    // Lógica con Prisma para insertar el turno validando cupos y horarios
});

module.exports = router;