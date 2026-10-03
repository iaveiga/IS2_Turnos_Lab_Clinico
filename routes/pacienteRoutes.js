const express = require('express');
const prisma = require('../config/prisma');
const router = express.Router();
const { verificarPermiso } = require('../middlewares/authMiddleware');

router.get('/perfil', verificarPermiso('VER_PERFIL'), async (req, res, next) => {
    try {
        const usuario = await prisma.usuario.findUnique({
            where: { id_usuario: req.session.userId },
            include: { paciente: true }
        });

        if (!usuario?.paciente) {
            return res.status(404).render('error', {
                mensaje: 'No existe un perfil de paciente asociado a tu cuenta.'
            });
        }

        return res.render('pacientes/perfil', { paciente: usuario.paciente });
    } catch (error) {
        return next(error);
    }
});

router.post('/perfil/actualizar', verificarPermiso('EDITAR_PERFIL'), async (req, res) => {
    // Lógica para actualizar información personal
});

module.exports = router;
