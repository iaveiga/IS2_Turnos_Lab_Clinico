const express = require('express');
const prisma = require('../config/prisma');
const { verificarPermiso } = require('../middlewares/authMiddleware');
const { crearPasswordHash } = require('../utils/password');

const router = express.Router();
const PAGE_SIZE = 8;

function datosPersonal(body = {}) {
  return {
    nombres: String(body.nombres || '').trim(),
    apellidos: String(body.apellidos || '').trim(),
    identificacion: String(body.identificacion || '').trim(),
    correo: String(body.correo || '').trim().toLowerCase(),
    id_rol: Number(body.id_rol),
    password: String(body.password || '')
  };
}

function validarPersonal(datos, { passwordRequerido = true, permitirAliasAdmin = false } = {}) {
  const errores = [];
  const identificacionValida = /^\d{10}$/.test(datos.identificacion)
    || (permitirAliasAdmin && datos.identificacion === 'administrador');

  if (datos.nombres.length < 2) errores.push('Ingresa los nombres del usuario.');
  if (datos.apellidos.length < 2) errores.push('Ingresa los apellidos del usuario.');
  if (!identificacionValida) errores.push('La cédula debe contener 10 dígitos.');
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(datos.correo)) errores.push('Ingresa un correo válido.');
  if (!Number.isInteger(datos.id_rol)) errores.push('Selecciona un rol.');
  if (passwordRequerido && datos.password.length < 8) errores.push('La clave debe tener al menos 8 caracteres.');
  if (!passwordRequerido && datos.password && datos.password.length < 8) {
    errores.push('La nueva clave debe tener al menos 8 caracteres.');
  }
  return errores;
}

function nombreCompleto(usuario) {
  if (usuario.paciente) return `${usuario.paciente.nombres} ${usuario.paciente.apellidos}`;
  return [usuario.nombres, usuario.apellidos].filter(Boolean).join(' ') || usuario.nombre_usuario;
}

function identificacionUsuario(usuario) {
  return usuario.paciente?.identificacion || usuario.identificacion || 'Sin identificación';
}

function obtenerRol(usuario) {
  return usuario.usuario_rol.find((asignacion) => asignacion.activo)?.rol || null;
}

async function cargarPaginaUsuarios(req) {
  const buscar = String(req.query.buscar || '').trim();
  const rolFiltro = Number(req.query.rol) || null;
  const estado = ['activo', 'inactivo'].includes(req.query.estado) ? req.query.estado : '';
  const paginaSolicitada = Math.max(Number.parseInt(req.query.pagina, 10) || 1, 1);
  const condiciones = [{ id_paciente: null }];

  if (buscar) {
    condiciones.push({
      OR: [
        { nombres: { contains: buscar, mode: 'insensitive' } },
        { apellidos: { contains: buscar, mode: 'insensitive' } },
        { identificacion: { contains: buscar, mode: 'insensitive' } },
        { correo: { contains: buscar, mode: 'insensitive' } },
        { nombre_usuario: { contains: buscar, mode: 'insensitive' } }
      ]
    });
  }
  if (rolFiltro) {
    condiciones.push({
      usuario_rol: { some: { id_rol: rolFiltro, activo: true } }
    });
  }
  if (estado) condiciones.push({ activo: estado === 'activo' });

  const where = condiciones.length ? { AND: condiciones } : {};
  const total = await prisma.usuario.count({ where });
  const totalPaginas = Math.max(Math.ceil(total / PAGE_SIZE), 1);
  const pagina = Math.min(paginaSolicitada, totalPaginas);

  const [usuarios, roles] = await Promise.all([
    prisma.usuario.findMany({
      where,
      include: {
        paciente: true,
        usuario_rol: {
          where: { activo: true },
          include: { rol: true }
        }
      },
      orderBy: [{ activo: 'desc' }, { fecha_creacion: 'desc' }],
      skip: (pagina - 1) * PAGE_SIZE,
      take: PAGE_SIZE
    }),
    prisma.rol.findMany({
      where: { activo: true, NOT: { nombre: 'PACIENTE' } },
      orderBy: { nombre: 'asc' }
    })
  ]);

  const usuariosVista = usuarios.map((usuario) => {
    const rol = obtenerRol(usuario);
    return {
      id: usuario.id_usuario,
      nombre: nombreCompleto(usuario),
      nombres: usuario.paciente?.nombres || usuario.nombres || '',
      apellidos: usuario.paciente?.apellidos || usuario.apellidos || '',
      identificacion: identificacionUsuario(usuario),
      correo: usuario.correo,
      activo: Boolean(usuario.activo),
      rol: rol?.nombre || 'SIN ROL',
      idRol: rol?.id_rol || '',
      esPaciente: Boolean(usuario.id_paciente),
      esActual: usuario.id_usuario === req.session.userId,
      ultimoAcceso: usuario.ultimo_acceso
        ? new Intl.DateTimeFormat('es-EC', {
          dateStyle: 'medium',
          timeStyle: 'short',
          timeZone: 'America/Guayaquil'
        }).format(usuario.ultimo_acceso)
        : 'Sin acceso registrado'
    };
  });

  return {
    usuarios: usuariosVista,
    roles,
    rolesPersonal: roles,
    filtros: { buscar, rol: rolFiltro || '', estado },
    paginacion: {
      pagina,
      totalPaginas,
      total,
      desde: total ? (pagina - 1) * PAGE_SIZE + 1 : 0,
      hasta: Math.min(pagina * PAGE_SIZE, total)
    }
  };
}

async function cargarPaginaPacientes(req) {
  const buscar = String(req.query.buscar || '').trim();
  const estado = ['activo', 'inactivo'].includes(req.query.estado) ? req.query.estado : '';
  const paginaSolicitada = Math.max(Number.parseInt(req.query.pagina, 10) || 1, 1);
  const condiciones = [];

  if (buscar) {
    condiciones.push({
      OR: [
        { nombres: { contains: buscar, mode: 'insensitive' } },
        { apellidos: { contains: buscar, mode: 'insensitive' } },
        { identificacion: { contains: buscar, mode: 'insensitive' } },
        { correo: { contains: buscar, mode: 'insensitive' } },
        { telefono: { contains: buscar, mode: 'insensitive' } }
      ]
    });
  }
  if (estado) condiciones.push({ activo: estado === 'activo' });

  const where = condiciones.length ? { AND: condiciones } : {};
  const total = await prisma.paciente.count({ where });
  const totalPaginas = Math.max(Math.ceil(total / PAGE_SIZE), 1);
  const pagina = Math.min(paginaSolicitada, totalPaginas);
  const pacientes = await prisma.paciente.findMany({
    where,
    include: {
      usuario: {
        select: { id_usuario: true, activo: true, ultimo_acceso: true }
      },
      _count: { select: { turno: true } }
    },
    orderBy: [{ activo: 'desc' }, { fecha_registro: 'desc' }],
    skip: (pagina - 1) * PAGE_SIZE,
    take: PAGE_SIZE
  });

  return {
    pacientes: pacientes.map((paciente) => ({
      id: paciente.id_paciente,
      nombre: `${paciente.nombres} ${paciente.apellidos}`,
      identificacion: paciente.identificacion,
      correo: paciente.correo || 'Sin correo registrado',
      telefono: paciente.telefono || 'Sin teléfono registrado',
      edad: paciente.edad,
      activo: paciente.activo !== false,
      tieneCuenta: paciente.usuario.length > 0,
      cuentaActiva: paciente.usuario.some((usuario) => usuario.activo !== false),
      turnos: paciente._count.turno,
      fechaRegistro: paciente.fecha_registro
        ? new Intl.DateTimeFormat('es-EC', {
          dateStyle: 'medium',
          timeZone: 'America/Guayaquil'
        }).format(paciente.fecha_registro)
        : 'Sin fecha de registro'
    })),
    filtros: { buscar, estado },
    paginacion: {
      pagina,
      totalPaginas,
      total,
      desde: total ? (pagina - 1) * PAGE_SIZE + 1 : 0,
      hasta: Math.min(pagina * PAGE_SIZE, total)
    }
  };
}

async function renderUsuarios(req, res, opciones = {}) {
  const datos = await cargarPaginaUsuarios(req);
  return res.status(opciones.status || 200).render('admin/usuarios', {
    ...datos,
    mensaje: opciones.mensaje || null,
    error: opciones.error || null,
    abrirCrear: Boolean(opciones.abrirCrear),
    formulario: opciones.formulario || {}
  });
}

router.get('/', verificarPermiso('ACCEDER_CONSOLA'), (req, res) => {
  res.redirect('/admin/usuarios');
});

router.get('/console', verificarPermiso('ACCEDER_CONSOLA'), (req, res) => {
  res.redirect('/admin/usuarios');
});

router.get('/usuarios', verificarPermiso('GESTIONAR_USUARIOS'), async (req, res, next) => {
  try {
    const erroresConsulta = {
      datos: 'Los datos enviados no son válidos.',
      usuario: 'El usuario seleccionado no puede editarse desde este módulo.'
    };
    return renderUsuarios(req, res, {
      mensaje: req.query.creado === '1'
        ? 'Usuario creado correctamente.'
        : req.query.actualizado === '1'
          ? 'Usuario actualizado correctamente.'
          : req.query.estado === 'actualizado'
            ? 'Estado del usuario actualizado.'
            : null,
      error: erroresConsulta[req.query.error] || null
    });
  } catch (error) {
    return next(error);
  }
});

router.get('/pacientes', verificarPermiso('GESTIONAR_USUARIOS'), async (req, res, next) => {
  try {
    const datos = await cargarPaginaPacientes(req);
    return res.render('admin/pacientes', {
      ...datos,
      mensaje: req.query.estado === 'actualizado' ? 'Estado del paciente actualizado.' : null,
      error: null
    });
  } catch (error) {
    return next(error);
  }
});

router.post('/usuarios', verificarPermiso('GESTIONAR_USUARIOS'), async (req, res, next) => {
  const datos = datosPersonal(req.body);
  const errores = validarPersonal(datos);

  if (errores.length) {
    return renderUsuarios(req, res, {
      status: 422,
      error: errores[0],
      abrirCrear: true,
      formulario: datos
    });
  }

  try {
    const rol = await prisma.rol.findFirst({
      where: { id_rol: datos.id_rol, activo: true, NOT: { nombre: 'PACIENTE' } }
    });
    if (!rol) {
      return renderUsuarios(req, res, {
        status: 422,
        error: 'Selecciona un rol de personal válido.',
        abrirCrear: true,
        formulario: datos
      });
    }

    const passwordHash = await crearPasswordHash(datos.password);
    await prisma.$transaction(async (tx) => {
      const usuario = await tx.usuario.create({
        data: {
          identificacion: datos.identificacion,
          nombres: datos.nombres,
          apellidos: datos.apellidos,
          nombre_usuario: datos.identificacion,
          correo: datos.correo,
          password_hash: passwordHash,
          activo: true
        }
      });

      await tx.usuario_rol.create({
        data: {
          id_usuario: usuario.id_usuario,
          id_rol: rol.id_rol,
          activo: true
        }
      });

      await tx.auditoria.create({
        data: {
          id_usuario: req.session.userId,
          accion: 'CREAR',
          entidad: 'usuario',
          id_registro: usuario.id_usuario,
          detalle: `Usuario ${datos.identificacion} creado con rol ${rol.nombre}`,
          direccion_ip: req.ip
        }
      });
    });

    return res.redirect('/admin/usuarios?creado=1');
  } catch (error) {
    if (error.code === 'P2002') {
      return renderUsuarios(req, res, {
        status: 409,
        error: 'La cédula o el correo ya están registrados.',
        abrirCrear: true,
        formulario: datos
      });
    }
    return next(error);
  }
});

router.post('/usuarios/:id/editar', verificarPermiso('GESTIONAR_USUARIOS'), async (req, res, next) => {
  const idUsuario = Number(req.params.id);
  const datos = datosPersonal(req.body);
  const permitirAliasAdmin = datos.identificacion === 'administrador';
  const errores = validarPersonal(datos, { passwordRequerido: false, permitirAliasAdmin });

  if (!Number.isInteger(idUsuario) || errores.length) {
    return res.redirect('/admin/usuarios?error=datos');
  }

  try {
    const [usuarioActual, rol] = await Promise.all([
      prisma.usuario.findUnique({
        where: { id_usuario: idUsuario },
        include: { paciente: true, usuario_rol: { where: { activo: true }, include: { rol: true } } }
      }),
      prisma.rol.findFirst({
        where: { id_rol: datos.id_rol, activo: true, NOT: { nombre: 'PACIENTE' } }
      })
    ]);

    if (!usuarioActual || usuarioActual.id_paciente || !rol) {
      return res.redirect('/admin/usuarios?error=usuario');
    }

    const rolActual = obtenerRol(usuarioActual);
    if (idUsuario === req.session.userId && rol.nombre !== 'ADMINISTRADOR') {
      return res.status(409).send('No puedes retirar tu propio rol de administrador.');
    }

    await prisma.$transaction(async (tx) => {
      const cambios = {
        identificacion: datos.identificacion,
        nombres: datos.nombres,
        apellidos: datos.apellidos,
        nombre_usuario: datos.identificacion,
        correo: datos.correo
      };
      if (datos.password) cambios.password_hash = await crearPasswordHash(datos.password);

      await tx.usuario.update({ where: { id_usuario: idUsuario }, data: cambios });
      await tx.usuario_rol.updateMany({
        where: { id_usuario: idUsuario },
        data: { activo: false }
      });
      await tx.usuario_rol.upsert({
        where: { id_usuario_id_rol: { id_usuario: idUsuario, id_rol: rol.id_rol } },
        update: { activo: true },
        create: { id_usuario: idUsuario, id_rol: rol.id_rol, activo: true }
      });
      await tx.auditoria.create({
        data: {
          id_usuario: req.session.userId,
          accion: 'MODIFICAR',
          entidad: 'usuario',
          id_registro: idUsuario,
          detalle: `Usuario actualizado. Rol: ${rolActual?.nombre || 'SIN ROL'} -> ${rol.nombre}`,
          direccion_ip: req.ip
        }
      });
    });

    return res.redirect('/admin/usuarios?actualizado=1');
  } catch (error) {
    if (error.code === 'P2002') {
      return res.status(409).send('La cédula o el correo ya están registrados.');
    }
    return next(error);
  }
});

router.post('/usuarios/:id/estado', verificarPermiso('GESTIONAR_USUARIOS'), async (req, res, next) => {
  const idUsuario = Number(req.params.id);
  const activo = req.body.activo === 'true';

  if (!Number.isInteger(idUsuario)) return res.status(422).send('Usuario inválido.');
  if (idUsuario === req.session.userId && !activo) {
    return res.status(409).send('No puedes desactivar tu propia cuenta.');
  }

  try {
    const usuarioActual = await prisma.usuario.findUnique({
      where: { id_usuario: idUsuario },
      select: { id_paciente: true }
    });
    if (!usuarioActual || usuarioActual.id_paciente) {
      return res.redirect('/admin/usuarios?error=usuario');
    }

    await prisma.$transaction(async (tx) => {
      const usuario = await tx.usuario.update({
        where: { id_usuario: idUsuario },
        data: { activo }
      });
      await tx.auditoria.create({
        data: {
          id_usuario: req.session.userId,
          accion: activo ? 'ACTIVAR' : 'DESACTIVAR',
          entidad: 'usuario',
          id_registro: usuario.id_usuario,
          detalle: `Usuario ${usuario.nombre_usuario} ${activo ? 'activado' : 'desactivado'}`,
          direccion_ip: req.ip
        }
      });
    });
    return res.redirect('/admin/usuarios?estado=actualizado');
  } catch (error) {
    return next(error);
  }
});

router.post('/pacientes/:id/estado', verificarPermiso('GESTIONAR_USUARIOS'), async (req, res, next) => {
  const idPaciente = Number(req.params.id);
  const activo = req.body.activo === 'true';

  if (!Number.isInteger(idPaciente)) return res.status(422).send('Paciente inválido.');

  try {
    await prisma.$transaction(async (tx) => {
      const paciente = await tx.paciente.update({
        where: { id_paciente: idPaciente },
        data: { activo }
      });
      await tx.usuario.updateMany({
        where: { id_paciente: idPaciente },
        data: { activo }
      });
      await tx.auditoria.create({
        data: {
          id_usuario: req.session.userId,
          accion: activo ? 'ACTIVAR' : 'DESACTIVAR',
          entidad: 'paciente',
          id_registro: paciente.id_paciente,
          detalle: `Paciente ${paciente.identificacion} ${activo ? 'activado' : 'desactivado'}`,
          direccion_ip: req.ip
        }
      });
    });
    return res.redirect('/admin/pacientes?estado=actualizado');
  } catch (error) {
    return next(error);
  }
});

module.exports = router;
