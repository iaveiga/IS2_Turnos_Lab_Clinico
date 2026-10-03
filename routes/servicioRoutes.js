// routes/servicioRoutes.js
const express = require('express');
const prisma = require('../config/prisma');

const router = express.Router();

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
