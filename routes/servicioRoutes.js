const express = require('express');
const router = express.Router();

router.get('/', async (req, res) => {
    // Lista los servicios activos (Sangre, VIH, Orina, Alergias)
    res.render('servicios/catalogo');
});

module.exports = router;