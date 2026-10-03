const express = require('express');
const router = express.Router();
const { verificarPermiso } = require('../middlewares/authMiddleware');
const reporteController = require('../controllers/reporteController');

// Ruta protegida para la vista de reportes estadísticos en la consola
//router.get('/admin/reportes', verificarPermiso('ACCEDER_CONSOLA'), reporteController.obtenerReportesEstadisticos);
router.get('/admin/reportes', reporteController.obtenerReportesCompletos);
module.exports = router;
