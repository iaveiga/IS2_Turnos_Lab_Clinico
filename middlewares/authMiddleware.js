const prisma = require('../config/prisma');

function establecerCabecerasPrivadas(res) {
  res.set({
    'Cache-Control': 'private, no-store, no-cache, must-revalidate, max-age=0',
    Pragma: 'no-cache',
    Expires: '0'
  });
}

function evitarCachePrivada(_req, res, next) {
  establecerCabecerasPrivadas(res);
  next();
}

async function consultarAutorizacion(idUsuario) {
  return prisma.usuario.findUnique({
    where: { id_usuario: idUsuario },
    include: {
      paciente: true,
      usuario_rol: {
        include: {
          rol: {
            include: {
              rol_permiso: {
                include: { permiso: true }
              }
            }
          }
        }
      }
    }
  });
}

function aplicarAutorizacion(req, res, usuario) {
  const asignaciones = usuario.usuario_rol.filter((asignacion) => asignacion.activo && asignacion.rol.activo);
  const roles = asignaciones.map((asignacion) => asignacion.rol.nombre);
  const permisos = [...new Set(asignaciones.flatMap((asignacion) => (
    asignacion.rol.rol_permiso.map((relacion) => relacion.permiso.codigo)
  )))];
  const rolPrincipal = roles.includes('ADMINISTRADOR') ? 'ADMINISTRADOR' : roles[0] || 'SIN_ROL';
  const nombre = usuario.paciente
    ? `${usuario.paciente.nombres} ${usuario.paciente.apellidos}`
    : [usuario.nombres, usuario.apellidos].filter(Boolean).join(' ') || usuario.nombre_usuario;

  req.session.user = {
    ...(req.session.user || {}),
    id: usuario.id_usuario,
    correo: usuario.correo,
    nombre,
    rol: rolPrincipal,
    roles,
    permisos,
    identificacion: usuario.paciente?.identificacion || usuario.identificacion,
    id_paciente: usuario.id_paciente
  };
  req.autorizacion = { usuario, roles, permisos };
  res.locals.usuario = req.session.user;
  res.locals.permisosUsuario = permisos;
  return req.autorizacion;
}

async function sincronizarAutorizacion(req, res, next) {
  res.locals.usuario = req.session?.user || null;
  res.locals.permisosUsuario = req.session?.user?.permisos || [];
  if (!req.session?.userId) return next();

  establecerCabecerasPrivadas(res);
  try {
    const usuario = await consultarAutorizacion(req.session.userId);
    if (!usuario || !usuario.activo) {
      return req.session.destroy(() => res.redirect('/auth/login'));
    }
    aplicarAutorizacion(req, res, usuario);
    return next();
  } catch (error) {
    return next(error);
  }
}

function verificarPermiso(codigoPermisoRequerido) {
  return async (req, res, next) => {
    establecerCabecerasPrivadas(res);
    const userId = req.session?.userId;

    if (!userId) return res.redirect('/auth/login');

    try {
      let autorizacion = req.autorizacion;
      if (!autorizacion) {
        const usuario = await consultarAutorizacion(userId);
        if (!usuario || !usuario.activo) {
          return res.status(403).render('error', { mensaje: 'Usuario no autorizado o inactivo' });
        }
        autorizacion = aplicarAutorizacion(req, res, usuario);
      }

      if (!autorizacion.permisos.includes(codigoPermisoRequerido)) {
        return res.status(403).render('error', { mensaje: 'No tienes permisos para realizar esta acción' });
      }
      return next();
    } catch (error) {
      return next(error);
    }
  };
}

module.exports = {
  evitarCachePrivada,
  sincronizarAutorizacion,
  verificarPermiso
};
