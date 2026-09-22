const express = require('express');
const router = express.Router();
const { verificarPermiso } = require('../middlewares/authMiddleware');

router.get('/perfil', verificarPermiso('VER_PERFIL'), async (req, res) => {
    // Consulta los datos del paciente logueado usando Prisma
    res.render('pacientes/perfil');
});

router.post('/perfil/actualizar', verificarPermiso('EDITAR_PERFIL'), async (req, res) => {
    // Lógica para actualizar información personal
});

module.exports = router;