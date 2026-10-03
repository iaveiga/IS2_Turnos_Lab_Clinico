// routes/servicioRoutes.js
const express = require('express');
const prisma = require('../config/prisma');

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

function iconoServicio(nombre = '') {
    const normalizado = nombre.toLowerCase();
    if (normalizado.includes('sangre') || normalizado.includes('hematolog')) return 'droplets';
    if (normalizado.includes('vih') || normalizado.includes('inmunolog')) return 'scan-heart';
    if (normalizado.includes('orina') || normalizado.includes('copro')) return 'test-tube';
    if (normalizado.includes('alerg')) return 'scan-search';
    return 'flask-conical';
}

router.get('/', async (req, res, next) => {
    try {
        const registros = await prisma.servicio.findMany({
            include: {
                horario_servicio: {
                    where: { activo: true },
                    select: { id_horario: true }
                }
            },
            orderBy: { nombre: 'asc' }
        });

        const servicios = registros.map((servicio) => ({
            id: servicio.id_servicio,
            nombre: servicio.nombre,
            descripcion: servicio.descripcion,
            activo: Boolean(servicio.activo),
            disponible: Boolean(servicio.activo) && servicio.horario_servicio.length > 0,
            horarios: servicio.horario_servicio.length,
            icono: iconoServicio(servicio.nombre)
        }));

        res.render('servicios/catalogo', { servicios });
    } catch (error) {
        next(error);
    }
});

module.exports = router;
