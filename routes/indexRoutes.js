const express = require('express');
const router = express.Router();
const { verificarPermiso } = require('../middlewares/authMiddleware');

// 1. Ruta de Bienvenida / Home Público
router.get('/', (req, res) => {
    // Si el usuario ya inició sesión, podríamos redirigirlo al dashboard o perfil
    res.render('index'); 
});

// 2. Consola Operativa (Panel de control para el personal del laboratorio)
// Ideal para ver los turnos del día, cambiar estados y registrar la atención
router.get('/admin/console', verificarPermiso('ACCEDER_CONSOLA'), async (req, res) => {
    try {
        // Aquí usarías Prisma para traer un resumen rápido:
        // - Turnos programados para hoy (Sangre, VIH, Orina, Alergias)
        // - Estadísticas del día
        res.render('admin/console', { 
            usuario: req.session.user 
        });
    } catch (error) {
        console.error("Error al cargar la consola:", error);
        res.status(500).send("Error interno");
    }
});

module.exports = router;