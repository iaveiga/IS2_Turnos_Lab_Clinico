const express = require('express');
const router = express.Router();
// ¡Fíjate en las llaves {} aquí!
const { verificarPermiso } = require('../middlewares/authMiddleware');



router.get('/', (req, res) => {
    res.render('index'); 
});

router.get('/admin/console', verificarPermiso('ACCEDER_CONSOLA'), async (req, res) => {
    try {
        res.render('admin/console', { 
            usuario: req.session.user 
        });
    } catch (error) {
        console.error("Error al cargar la consola:", error);
        res.status(500).send("Error interno");
    }
});

module.exports = router;