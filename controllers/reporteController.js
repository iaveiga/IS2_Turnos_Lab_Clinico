const prisma = require('../config/prisma');

exports.obtenerReportesCompletos = async (req, res) => {
    try {

        const turnosPorEstado = await prisma.turno.groupBy({
            by: ['estado'],
            _count: { id_turno: true }
        });

        const serviciosPopulares = await prisma.servicio.findMany({
            include: {
                _count: { select: { turno: true } }
            },
            orderBy: {
                turno: { _count: 'desc' }
            },
            take: 5
        });

        const personalActivo = await prisma.usuario.findMany({
            where: { activo: true },
            include: {
                usuario_rol: {
                    include: {
                        rol: true
                    }
                }
            },
            orderBy: { nombre: 'asc' }
        });

        // 4. KPIs Globales
        const totalTurnos = await prisma.turno.count();
        const totalPacientes = await prisma.paciente.count();
        const totalPersonal = await prisma.usuario.count({ where: { activo: true } });

        res.render('admin/reportes', {
            usuario: req.session.user,
            turnosPorEstado,
            serviciosPopulares,
            personalActivo,
            metricas: {
                totalTurnos,
                totalPacientes,
                totalPersonal
            }
        });

    } catch (error) {
        console.error("Error al generar el panel de reportes:", error);
        res.status(500).render('error', { mensaje: 'Error interno al procesar los reportes de personal y estadísticas' });
    }
};
