// middlewares/authMiddleware.js

const path = require('path');

// Apuntamos al archivo client.ts generado por Prisma
const { PrismaClient } = require('../generated/prisma/client');
const prisma = new PrismaClient();


function verificarPermiso(codigoPermisoRequerido) {
    return async (req, res, next) => {
        const userId = req.session?.userId; 

        if (!userId) {
            return res.redirect('/auth/login');
        }

        try {
            const usuario = await prisma.usuario.findUnique({
                where: { id_usuario: userId },
                include: {
                    usuario_rol: {
                        include: {
                            rol: {
                                include: {
                                    rol_permiso: {
                                        include: {
                                            permiso: true
                                        }
                                    }
                                }
                            }
                        }
                    }
                }
            });

            if (!usuario || !usuario.activo) {
                return res.status(403).render('error', { mensaje: 'Usuario no autorizado o inactivo' });
            }

            let tienePermiso = false;
            for (const ur of usuario.usuario_rol) {
                for (const rp of ur.rol.rol_permiso) {
                    if (rp.permiso.codigo === codigoPermisoRequerido) {
                        tienePermiso = true;
                        break;
                    }
                }
                if (tienePermiso) break;
            }

            if (!tienePermiso) {
                return res.status(403).render('error', { mensaje: 'No tienes permisos para realizar esta acción' });
            }

            next();

        } catch (error) {
            console.error("Error al verificar permisos:", error);
            res.status(500).send("Error interno del servidor");
        }
    };
}

// ¡Esta línea es la clave! Debe ser un objeto para que coincida con tus llaves {}
module.exports = { verificarPermiso };