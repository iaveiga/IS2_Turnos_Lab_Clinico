const path = require('path');
const { PrismaClient } = require(path.join(__dirname, '../generated/prisma/client'));
const prisma = new PrismaClient();

// Listar servicios
exports.listarServicios = async (req, res) => {
    try {
        const servicios = await prisma.servicio.findMany({
            orderBy: { nombre: 'asc' }
        });
        res.render('servicios/listar', { usuario: req.session.user, servicios, error: null });
    } catch (error) {
        console.error("Error al listar servicios:", error);
        res.status(500).render('error', { mensaje: 'Error al cargar los servicios de laboratorio' });
    }
};

// Mostrar formulario de creación
exports.mostrarCrear = (req, res) => {
    res.render('servicios/crear', { usuario: req.session.user, error: null });
};

// Guardar nuevo servicio
exports.crearServicio = async (req, res) => {
    try {
        const { nombre, descripcion } = req.body;
        if (!nombre) {
            return res.render('servicios/crear', { usuario: req.session.user, error: 'El nombre del examen es obligatorio.' });
        }

        await prisma.servicio.create({
            data: {
                nombre,
                descripcion,
                activo: true
            }
        });

        res.redirect('/servicios');
    } catch (error) {
        console.error("Error al crear servicio:", error);
        res.render('servicios/crear', { usuario: req.session.user, error: 'No se pudo registrar el servicio.' });
    }
};

// Mostrar formulario de edición
exports.mostrarEditar = async (req, res) => {
    try {
        const { id } = req.params;
        const servicio = await prisma.servicio.findUnique({
            where: { id_servicio: parseInt(id) }
        });

        if (!servicio) return res.redirect('/servicios');

        res.render('servicios/editar', { usuario: req.session.user, servicio, error: null });
    } catch (error) {
        console.error("Error al cargar servicio para editar:", error);
        res.redirect('/servicios');
    }
};

// Actualizar servicio
exports.actualizarServicio = async (req, res) => {
    try {
        const { id } = req.params;
        const { nombre, descripcion, activo } = req.body;

        await prisma.servicio.update({
            where: { id_servicio: parseInt(id) },
            data: {
                nombre,
                descripcion,
                activo: activo === 'on' || activo === true
            }
        });

        res.redirect('/servicios');
    } catch (error) {
        console.error("Error al actualizar servicio:", error);
        res.redirect('/servicios');
    }
};

// Eliminar o desactivar servicio
exports.eliminarServicio = async (req, res) => {
    try {
        const { id } = req.params;
        // Intenta eliminar directamente
        await prisma.servicio.delete({
            where: { id_servicio: parseInt(id) }
        });
        res.redirect('/servicios');
    } catch (error) {
        // Si hay restricción de integridad por turnos existentes, hacemos baja lógica (activo = false)
        try {
            await prisma.servicio.update({
                where: { id_servicio: parseInt(id) },
                data: { activo: false }
            });
            res.redirect('/servicios');
        } catch (innerError) {
            console.error("Error al desactivar servicio:", innerError);
            res.redirect('/servicios');
        }
    }
};