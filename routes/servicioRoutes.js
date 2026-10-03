// routes/servicioRoutes.js
const express = require('express');
const router = express.Router();
const { verificarPermiso } = require('../middlewares/authMiddleware');
const servicioController = require('../controllers/servicioController');

//comentado para testear sin iniciar sesión

/*
// Listar todos los servicios / exámenes
router.get('/admin/servicios', verificarPermiso('ACCEDER_CONSOLA'), servicioController.listarServicios);

// Formulario para crear nuevo servicio
router.get('/admin/servicios/nuevo', verificarPermiso('ACCEDER_CONSOLA'), servicioController.mostrarCrear);
router.post('/admin/servicios/nuevo', verificarPermiso('ACCEDER_CONSOLA'), servicioController.crearServicio);

// Formulario para editar servicio existente
router.get('/admin/servicios/editar/:id', verificarPermiso('ACCEDER_CONSOLA'), servicioController.mostrarEditar);
router.post('/admin/servicios/editar/:id', verificarPermiso('ACCEDER_CONSOLA'), servicioController.actualizarServicio);

// Eliminar o desactivar servicio
router.post('/admin/servicios/eliminar/:id', verificarPermiso('ACCEDER_CONSOLA'), servicioController.eliminarServicio);
*/

router.get('/servicios', servicioController.listarServicios);

router.get('/servicios/nuevo', servicioController.mostrarCrear);
router.post('/servicios/nuevo', servicioController.crearServicio);

router.get('/servicios/editar/:id', servicioController.mostrarEditar);
router.post('/servicios/editar/:id', servicioController.actualizarServicio);

router.post('/servicios/eliminar/:id', servicioController.eliminarServicio);


module.exports = router;