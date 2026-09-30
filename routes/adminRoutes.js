const express = require('express');
const prisma = require('../config/prisma');
const { verificarPermiso } = require('../middlewares/authMiddleware');
const { crearPasswordHash } = require('../utils/password');

const router = express.Router();
const PAGE_SIZE = 8;
const TRANSICIONES_TURNO = {
  PENDIENTE: ['CONFIRMADO', 'CANCELADO', 'AUSENTE'],
  CONFIRMADO: ['ATENDIDO', 'CANCELADO', 'AUSENTE'],
  ATENDIDO: [],
  CANCELADO: [],
  AUSENTE: []
};

function fechaTurnoLegible(fecha) {
  return new Intl.DateTimeFormat('es-EC', {
    timeZone: 'UTC',
    weekday: 'short',
    day: '2-digit',
    month: 'short',
    year: 'numeric'
  }).format(fecha);
}

function horaTurnoLegible(fecha) {
  return new Intl.DateTimeFormat('es-EC', {
    timeZone: 'UTC',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false
  }).format(fecha);
}

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

function datosServicio(body = {}) {
  const valoresActivo = Array.isArray(body.activo) ? body.activo : [body.activo];
  return {
    nombre: String(body.nombre || '').trim(),
    descripcion: String(body.descripcion || '').trim(),
    activo: valoresActivo.includes('true')
  };
}

function validarServicio(datos) {
  const errores = [];
  if (datos.nombre.length < 3) errores.push('Ingresa un nombre de al menos 3 caracteres.');
  if (datos.nombre.length > 120) errores.push('El nombre no puede superar los 120 caracteres.');
  if (datos.descripcion.length > 500) errores.push('La descripción no puede superar los 500 caracteres.');
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

async function cargarPaginaServicios(req) {
  const buscar = String(req.query.buscar || '').trim();
  const estado = ['activo', 'inactivo'].includes(req.query.estado) ? req.query.estado : '';
  const disponibilidad = ['con_horarios', 'sin_horarios'].includes(req.query.disponibilidad)
    ? req.query.disponibilidad
    : '';
  const paginaSolicitada = Math.max(Number.parseInt(req.query.pagina, 10) || 1, 1);
  const condiciones = [];

  if (buscar) {
    condiciones.push({
      OR: [
        { nombre: { contains: buscar, mode: 'insensitive' } },
        { descripcion: { contains: buscar, mode: 'insensitive' } }
      ]
    });
  }
  if (estado) condiciones.push({ activo: estado === 'activo' });
  if (disponibilidad === 'con_horarios') {
    condiciones.push({ horario_servicio: { some: { activo: true } } });
  }
  if (disponibilidad === 'sin_horarios') {
    condiciones.push({ horario_servicio: { none: { activo: true } } });
  }

  const where = condiciones.length ? { AND: condiciones } : {};
  const total = await prisma.servicio.count({ where });
  const totalPaginas = Math.max(Math.ceil(total / PAGE_SIZE), 1);
  const pagina = Math.min(paginaSolicitada, totalPaginas);
  const servicios = await prisma.servicio.findMany({
    where,
    include: {
      horario_servicio: {
        where: { activo: true },
        select: { id_horario: true }
      },
      _count: { select: { turno: true } }
    },
    orderBy: [{ activo: 'desc' }, { nombre: 'asc' }],
    skip: (pagina - 1) * PAGE_SIZE,
    take: PAGE_SIZE
  });

  return {
    servicios: servicios.map((servicio) => ({
      id: servicio.id_servicio,
      nombre: servicio.nombre,
      descripcion: servicio.descripcion || '',
      activo: servicio.activo !== false,
      horariosActivos: servicio.horario_servicio.length,
      turnos: servicio._count.turno,
      disponible: servicio.activo !== false && servicio.horario_servicio.length > 0
    })),
    filtros: { buscar, estado, disponibilidad },
    paginacion: {
      pagina,
      totalPaginas,
      total,
      desde: total ? (pagina - 1) * PAGE_SIZE + 1 : 0,
      hasta: Math.min(pagina * PAGE_SIZE, total)
    }
  };
}

async function cargarPaginaTurnos(req) {
  const buscar = String(req.query.buscar || '').trim();
  const idEstado = Number(req.query.estado) || null;
  const idServicio = Number(req.query.servicio) || null;
  const fecha = /^\d{4}-\d{2}-\d{2}$/.test(req.query.fecha || '') ? req.query.fecha : '';
  const paginaSolicitada = Math.max(Number.parseInt(req.query.pagina, 10) || 1, 1);
  const condiciones = [];

  if (buscar) {
    condiciones.push({
      OR: [
        { codigo_turno: { contains: buscar, mode: 'insensitive' } },
        { paciente: { nombres: { contains: buscar, mode: 'insensitive' } } },
        { paciente: { apellidos: { contains: buscar, mode: 'insensitive' } } },
        { paciente: { identificacion: { contains: buscar, mode: 'insensitive' } } },
        { servicio: { nombre: { contains: buscar, mode: 'insensitive' } } }
      ]
    });
  }
  if (idEstado) condiciones.push({ id_estado: idEstado });
  if (idServicio) condiciones.push({ id_servicio: idServicio });
  if (fecha) condiciones.push({ fecha_turno: new Date(`${fecha}T00:00:00.000Z`) });

  const where = condiciones.length ? { AND: condiciones } : {};
  const total = await prisma.turno.count({ where });
  const totalPaginas = Math.max(Math.ceil(total / PAGE_SIZE), 1);
  const pagina = Math.min(paginaSolicitada, totalPaginas);
  const [turnos, estados, servicios] = await Promise.all([
    prisma.turno.findMany({
      where,
      include: {
        paciente: true,
        servicio: true,
        estado_turno: true,
        horario_servicio: true,
        historial_turno: {
          orderBy: { fecha_evento: 'desc' },
          take: 1
        }
      },
      orderBy: [{ fecha_turno: 'desc' }, { hora_inicio: 'asc' }],
      skip: (pagina - 1) * PAGE_SIZE,
      take: PAGE_SIZE
    }),
    prisma.estado_turno.findMany({ orderBy: { id_estado: 'asc' } }),
    prisma.servicio.findMany({ orderBy: { nombre: 'asc' } })
  ]);

  return {
    turnos: turnos.map((turno) => {
      const codigoEstado = turno.estado_turno?.codigo || 'SIN_ESTADO';
      return {
        id: turno.id_turno,
        codigo: turno.codigo_turno,
        fecha: fechaTurnoLegible(turno.fecha_turno),
        fechaISO: turno.fecha_turno.toISOString().slice(0, 10),
        horaInicio: horaTurnoLegible(turno.hora_inicio),
        horaFin: horaTurnoLegible(turno.hora_fin),
        paciente: turno.paciente
          ? `${turno.paciente.nombres} ${turno.paciente.apellidos}`
          : 'Paciente no disponible',
        pacienteIdentificacion: turno.paciente?.identificacion || 'Sin identificación',
        pacienteTelefono: turno.paciente?.telefono || 'Sin teléfono registrado',
        pacienteCorreo: turno.paciente?.correo || 'Sin correo registrado',
        servicio: turno.servicio?.nombre || 'Servicio no disponible',
        servicioDescripcion: turno.servicio?.descripcion || 'Sin descripción registrada',
        estado: turno.estado_turno?.nombre || 'Sin estado',
        estadoCodigo: codigoEstado,
        idEstado: turno.id_estado,
        observacion: turno.observacion || 'Sin observaciones',
        fechaCreacion: turno.fecha_creacion
          ? new Intl.DateTimeFormat('es-EC', {
            dateStyle: 'medium',
            timeStyle: 'short',
            timeZone: 'America/Guayaquil'
          }).format(turno.fecha_creacion)
          : 'Sin fecha de creación',
        ultimoMotivo: turno.historial_turno[0]?.motivo || 'Sin motivo registrado',
        transiciones: TRANSICIONES_TURNO[codigoEstado] || []
      };
    }),
    estados,
    servicios,
    filtros: {
      buscar,
      estado: idEstado || '',
      servicio: idServicio || '',
      fecha
    },
    paginacion: {
      pagina,
      totalPaginas,
      total,
      desde: total ? (pagina - 1) * PAGE_SIZE + 1 : 0,
      hasta: Math.min(pagina * PAGE_SIZE, total)
    }
  };
}

async function renderServicios(req, res, opciones = {}) {
  const datos = await cargarPaginaServicios(req);
  return res.status(opciones.status || 200).render('admin/servicios', {
    ...datos,
    mensaje: opciones.mensaje || null,
    error: opciones.error || null,
    abrirCrear: Boolean(opciones.abrirCrear),
    formulario: opciones.formulario || { activo: true }
  });
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

router.get('/turnos', verificarPermiso('GESTIONAR_TURNOS'), async (req, res, next) => {
  try {
    const erroresConsulta = {
      datos: 'Los datos enviados no son válidos.',
      transicion: 'El cambio de estado solicitado no está permitido.',
      motivo: 'Ingresa un motivo para registrar este cambio de estado.',
      turno: 'El turno seleccionado ya no se encuentra disponible.'
    };
    const datos = await cargarPaginaTurnos(req);
    return res.render('admin/turnos', {
      ...datos,
      mensaje: req.query.estado === 'actualizado' ? 'Estado del turno actualizado correctamente.' : null,
      error: erroresConsulta[req.query.error] || null
    });
  } catch (error) {
    return next(error);
  }
});

router.post('/turnos/:id/estado', verificarPermiso('GESTIONAR_TURNOS'), async (req, res, next) => {
  const idTurno = Number(req.params.id);
  const idEstadoNuevo = Number(req.body.id_estado);
  const motivo = String(req.body.motivo || '').trim().slice(0, 500);

  if (!Number.isInteger(idTurno) || !Number.isInteger(idEstadoNuevo)) {
    return res.redirect('/admin/turnos?error=datos');
  }

  try {
    await prisma.$transaction(async (tx) => {
      const [turno, estadoNuevo] = await Promise.all([
        tx.turno.findUnique({
          where: { id_turno: idTurno },
          include: { estado_turno: true }
        }),
        tx.estado_turno.findUnique({ where: { id_estado: idEstadoNuevo } })
      ]);

      if (!turno || !estadoNuevo) {
        const error = new Error('Turno no encontrado.');
        error.adminCode = 'turno';
        throw error;
      }

      const permitidos = TRANSICIONES_TURNO[turno.estado_turno?.codigo] || [];
      if (!permitidos.includes(estadoNuevo.codigo)) {
        const error = new Error('Transición no permitida.');
        error.adminCode = 'transicion';
        throw error;
      }

      if (['CANCELADO', 'AUSENTE'].includes(estadoNuevo.codigo) && motivo.length < 3) {
        const error = new Error('Motivo requerido.');
        error.adminCode = 'motivo';
        throw error;
      }

      await tx.turno.update({
        where: { id_turno: idTurno },
        data: { id_estado: estadoNuevo.id_estado }
      });
      await tx.historial_turno.create({
        data: {
          id_turno: idTurno,
          id_usuario: req.session.userId,
          id_estado_anterior: turno.id_estado,
          id_estado_nuevo: estadoNuevo.id_estado,
          fecha_anterior: turno.fecha_turno,
          hora_anterior: turno.hora_inicio,
          fecha_nueva: turno.fecha_turno,
          hora_nueva: turno.hora_inicio,
          accion: 'CAMBIO_ESTADO',
          motivo: motivo || `Cambio administrativo a ${estadoNuevo.nombre}`
        }
      });
      await tx.auditoria.create({
        data: {
          id_usuario: req.session.userId,
          accion: 'CAMBIAR_ESTADO',
          entidad: 'turno',
          id_registro: turno.id_turno,
          detalle: `Turno ${turno.codigo_turno}: ${turno.estado_turno?.nombre || 'Sin estado'} -> ${estadoNuevo.nombre}`,
          direccion_ip: req.ip
        }
      });
    });

    return res.redirect('/admin/turnos?estado=actualizado');
  } catch (error) {
    if (error.adminCode) return res.redirect(`/admin/turnos?error=${error.adminCode}`);
    return next(error);
  }
});

router.get('/servicios', verificarPermiso('GESTIONAR_SERVICIOS'), async (req, res, next) => {
  try {
    const erroresConsulta = {
      datos: 'Los datos enviados no son válidos.',
      duplicado: 'Ya existe un servicio con ese nombre.'
    };
    return renderServicios(req, res, {
      mensaje: req.query.creado === '1'
        ? 'Servicio creado correctamente.'
        : req.query.actualizado === '1'
          ? 'Servicio actualizado correctamente.'
          : req.query.estado === 'actualizado'
            ? 'Estado del servicio actualizado.'
            : null,
      error: erroresConsulta[req.query.error] || null
    });
  } catch (error) {
    return next(error);
  }
});

router.post('/servicios', verificarPermiso('GESTIONAR_SERVICIOS'), async (req, res, next) => {
  const datos = datosServicio(req.body);
  const errores = validarServicio(datos);

  if (errores.length) {
    return renderServicios(req, res, {
      status: 422,
      error: errores[0],
      abrirCrear: true,
      formulario: datos
    });
  }

  try {
    const existente = await prisma.servicio.findFirst({
      where: { nombre: { equals: datos.nombre, mode: 'insensitive' } },
      select: { id_servicio: true }
    });
    if (existente) {
      return renderServicios(req, res, {
        status: 409,
        error: 'Ya existe un servicio con ese nombre.',
        abrirCrear: true,
        formulario: datos
      });
    }

    await prisma.$transaction(async (tx) => {
      const servicio = await tx.servicio.create({ data: datos });
      await tx.auditoria.create({
        data: {
          id_usuario: req.session.userId,
          accion: 'CREAR',
          entidad: 'servicio',
          id_registro: servicio.id_servicio,
          detalle: `Servicio ${servicio.nombre} creado`,
          direccion_ip: req.ip
        }
      });
    });
    return res.redirect('/admin/servicios?creado=1');
  } catch (error) {
    return next(error);
  }
});

router.post('/servicios/:id/editar', verificarPermiso('GESTIONAR_SERVICIOS'), async (req, res, next) => {
  const idServicio = Number(req.params.id);
  const datos = datosServicio(req.body);
  const errores = validarServicio(datos);

  if (!Number.isInteger(idServicio) || errores.length) {
    return res.redirect('/admin/servicios?error=datos');
  }

  try {
    const duplicado = await prisma.servicio.findFirst({
      where: {
        id_servicio: { not: idServicio },
        nombre: { equals: datos.nombre, mode: 'insensitive' }
      },
      select: { id_servicio: true }
    });
    if (duplicado) return res.redirect('/admin/servicios?error=duplicado');

    await prisma.$transaction(async (tx) => {
      const servicio = await tx.servicio.update({
        where: { id_servicio: idServicio },
        data: { nombre: datos.nombre, descripcion: datos.descripcion }
      });
      await tx.auditoria.create({
        data: {
          id_usuario: req.session.userId,
          accion: 'MODIFICAR',
          entidad: 'servicio',
          id_registro: servicio.id_servicio,
          detalle: `Servicio ${servicio.nombre} actualizado`,
          direccion_ip: req.ip
        }
      });
    });
    return res.redirect('/admin/servicios?actualizado=1');
  } catch (error) {
    return next(error);
  }
});

router.post('/servicios/:id/estado', verificarPermiso('GESTIONAR_SERVICIOS'), async (req, res, next) => {
  const idServicio = Number(req.params.id);
  const activo = req.body.activo === 'true';
  if (!Number.isInteger(idServicio)) return res.status(422).send('Servicio inválido.');

  try {
    await prisma.$transaction(async (tx) => {
      const servicio = await tx.servicio.update({
        where: { id_servicio: idServicio },
        data: { activo }
      });
      await tx.auditoria.create({
        data: {
          id_usuario: req.session.userId,
          accion: activo ? 'ACTIVAR' : 'DESACTIVAR',
          entidad: 'servicio',
          id_registro: servicio.id_servicio,
          detalle: `Servicio ${servicio.nombre} ${activo ? 'activado' : 'desactivado'}`,
          direccion_ip: req.ip
        }
      });
    });
    return res.redirect('/admin/servicios?estado=actualizado');
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
