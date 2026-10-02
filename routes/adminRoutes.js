const express = require('express');
const prisma = require('../config/prisma');
const { verificarPermiso } = require('../middlewares/authMiddleware');
const { crearPasswordHash } = require('../utils/password');

const router = express.Router();
const PAGE_SIZE = 8;
const DIAS_HORARIO = [
  { codigo: 'LUNES', nombre: 'Lunes' },
  { codigo: 'MARTES', nombre: 'Martes' },
  { codigo: 'MIERCOLES', nombre: 'Miércoles' },
  { codigo: 'JUEVES', nombre: 'Jueves' },
  { codigo: 'VIERNES', nombre: 'Viernes' },
  { codigo: 'SABADO', nombre: 'Sábado' },
  { codigo: 'DOMINGO', nombre: 'Domingo' }
];
const ORDEN_DIAS = Object.fromEntries(DIAS_HORARIO.map((dia, indice) => [dia.codigo, indice]));
const TRANSICIONES_TURNO = {
  PENDIENTE: ['CONFIRMADO', 'CANCELADO', 'AUSENTE'],
  CONFIRMADO: ['ATENDIDO', 'CANCELADO', 'AUSENTE'],
  ATENDIDO: [],
  CANCELADO: [],
  AUSENTE: []
};
const PERMISOS_ADMIN_OBLIGATORIOS = new Set(['ACCEDER_CONSOLA', 'GESTIONAR_ROLES_PERMISOS']);

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

function fechaLocalISO(fecha = new Date()) {
  const partes = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Guayaquil',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).formatToParts(fecha);
  const valor = (tipo) => partes.find((parte) => parte.type === tipo).value;
  return `${valor('year')}-${valor('month')}-${valor('day')}`;
}

function fechaISOValida(valor) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(valor || '')) return false;
  const fecha = new Date(`${valor}T00:00:00.000Z`);
  return !Number.isNaN(fecha.getTime()) && fecha.toISOString().slice(0, 10) === valor;
}

function fechaUTCDesdeISO(valor) {
  return new Date(`${valor}T00:00:00.000Z`);
}

function sumarDiasISO(valor, dias) {
  const fecha = fechaUTCDesdeISO(valor);
  fecha.setUTCDate(fecha.getUTCDate() + dias);
  return fecha.toISOString().slice(0, 10);
}

function rangoMesAnteriorISO(hoy = fechaLocalISO()) {
  const fecha = fechaUTCDesdeISO(hoy);
  const anio = fecha.getUTCMonth() === 0 ? fecha.getUTCFullYear() - 1 : fecha.getUTCFullYear();
  const mes = fecha.getUTCMonth() === 0 ? 11 : fecha.getUTCMonth() - 1;
  const inicio = new Date(Date.UTC(anio, mes, 1));
  const fin = new Date(Date.UTC(anio, mes + 1, 0));
  return {
    desde: inicio.toISOString().slice(0, 10),
    hasta: fin.toISOString().slice(0, 10)
  };
}

function rangoSemanaAnteriorISO(hoy = fechaLocalISO()) {
  const fecha = fechaUTCDesdeISO(hoy);
  const diasDesdeLunes = (fecha.getUTCDay() + 6) % 7;
  const lunesActual = sumarDiasISO(hoy, -diasDesdeLunes);
  return {
    desde: sumarDiasISO(lunesActual, -7),
    hasta: sumarDiasISO(lunesActual, -1)
  };
}

function rangoReporteDesdeConsulta(query = {}) {
  const periodo = ['semana_anterior', 'dia_anterior', 'mes_anterior', 'personalizado'].includes(query.periodo)
    ? query.periodo
    : 'semana_anterior';
  const hoy = fechaLocalISO();
  let rango;
  let error = null;

  if (periodo === 'dia_anterior') {
    const ayer = sumarDiasISO(hoy, -1);
    rango = { desde: ayer, hasta: ayer };
  } else if (periodo === 'mes_anterior') {
    rango = rangoMesAnteriorISO(hoy);
  } else if (periodo === 'personalizado') {
    const desde = fechaISOValida(query.desde) ? query.desde : '';
    const hasta = fechaISOValida(query.hasta) ? query.hasta : '';
    rango = desde && hasta ? { desde, hasta } : rangoSemanaAnteriorISO(hoy);
    if (!desde || !hasta) error = 'Selecciona una fecha de inicio y una fecha de fin válidas.';
  } else {
    rango = rangoSemanaAnteriorISO(hoy);
  }

  if (rango.desde > rango.hasta) {
    error = 'La fecha de inicio no puede ser posterior a la fecha de fin.';
    rango = rangoSemanaAnteriorISO(hoy);
  }

  return { periodo, ...rango, error };
}

function horaDesdeTexto(valor) {
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(valor || '')) return null;
  return new Date(`1970-01-01T${valor}:00.000Z`);
}

function minutosHora(valor) {
  const [horas, minutos] = valor.split(':').map(Number);
  return horas * 60 + minutos;
}

function datosHorario(body = {}) {
  const valoresActivo = Array.isArray(body.activo) ? body.activo : [body.activo];
  const diasEntrada = body.dias_semana ?? body.dia_semana ?? [];
  const dias = (Array.isArray(diasEntrada) ? diasEntrada : [diasEntrada])
    .map((dia) => String(dia || '').toUpperCase())
    .filter((dia, indice, lista) => dia in ORDEN_DIAS && lista.indexOf(dia) === indice)
    .sort((a, b) => ORDEN_DIAS[a] - ORDEN_DIAS[b]);
  return {
    id_servicio: Number(body.id_servicio),
    dias_semana: dias,
    dia_semana: dias[0] || '',
    hora_inicio: String(body.hora_inicio || ''),
    hora_fin: String(body.hora_fin || ''),
    duracion_turno_min: Number(body.duracion_turno_min),
    capacidad: Number(body.capacidad),
    activo: valoresActivo.includes('true')
  };
}

function validarHorario(datos) {
  const errores = [];
  const inicioValido = horaDesdeTexto(datos.hora_inicio);
  const finValido = horaDesdeTexto(datos.hora_fin);

  if (!Number.isInteger(datos.id_servicio)) errores.push('Selecciona un servicio válido.');
  if (!datos.dias_semana.length) errores.push('Selecciona al menos un día de atención.');
  if (!inicioValido || !finValido) errores.push('Ingresa una jornada de atención válida.');
  if (inicioValido && finValido && minutosHora(datos.hora_inicio) >= minutosHora(datos.hora_fin)) {
    errores.push('La hora de fin debe ser posterior a la hora de inicio.');
  }
  if (!Number.isInteger(datos.duracion_turno_min)
    || datos.duracion_turno_min < 5
    || datos.duracion_turno_min > 240) {
    errores.push('La duración debe estar entre 5 y 240 minutos.');
  }
  if (inicioValido && finValido && Number.isInteger(datos.duracion_turno_min)
    && datos.duracion_turno_min > minutosHora(datos.hora_fin) - minutosHora(datos.hora_inicio)) {
    errores.push('La duración del turno no puede superar la jornada configurada.');
  }
  if (!Number.isInteger(datos.capacidad) || datos.capacidad < 1 || datos.capacidad > 100) {
    errores.push('Los cupos por bloque deben estar entre 1 y 100.');
  }
  return errores;
}

function horarioParaBase(datos, diaSemana = datos.dia_semana) {
  return {
    id_servicio: datos.id_servicio,
    dia_semana: diaSemana,
    hora_inicio: horaDesdeTexto(datos.hora_inicio),
    hora_fin: horaDesdeTexto(datos.hora_fin),
    duracion_turno_min: datos.duracion_turno_min,
    capacidad: datos.capacidad,
    activo: datos.activo
  };
}

async function buscarSolapamiento(cliente, datos, idsHorariosIgnorados = [], diaSemana = datos.dia_semana) {
  if (!datos.activo) return null;
  const idsIgnorados = (Array.isArray(idsHorariosIgnorados) ? idsHorariosIgnorados : [idsHorariosIgnorados])
    .map(Number)
    .filter(Number.isInteger);
  return cliente.horario_servicio.findFirst({
    where: {
      id_servicio: datos.id_servicio,
      dia_semana: diaSemana,
      activo: true,
      hora_inicio: { lt: horaDesdeTexto(datos.hora_fin) },
      hora_fin: { gt: horaDesdeTexto(datos.hora_inicio) },
      ...(idsIgnorados.length ? { id_horario: { notIn: idsIgnorados } } : {})
    },
    select: { id_horario: true }
  });
}

function datosDiaNoLaborable(body = {}) {
  return {
    fecha: String(body.fecha || ''),
    descripcion: String(body.descripcion || '').trim(),
    activo: true
  };
}

function validarDiaNoLaborable(datos) {
  const fecha = /^\d{4}-\d{2}-\d{2}$/.test(datos.fecha)
    ? new Date(`${datos.fecha}T00:00:00.000Z`)
    : null;
  if (!fecha || Number.isNaN(fecha.getTime()) || fecha.toISOString().slice(0, 10) !== datos.fecha) {
    return 'Selecciona una fecha válida.';
  }
  if (datos.fecha < fechaLocalISO()) return 'La fecha no laborable no puede estar en el pasado.';
  if (datos.descripcion.length < 3) return 'Ingresa un motivo de al menos 3 caracteres.';
  if (datos.descripcion.length > 200) return 'El motivo no puede superar los 200 caracteres.';
  return null;
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

function datosRol(body = {}) {
  return {
    nombre: String(body.nombre || '').trim().replace(/\s+/g, ' ').toUpperCase(),
    descripcion: String(body.descripcion || '').trim(),
    id_rol_base: Number(body.id_rol_base) || null,
    activo: true
  };
}

function validarRol(datos) {
  const errores = [];
  if (datos.nombre.length < 3 || datos.nombre.length > 50) {
    errores.push('El nombre del rol debe tener entre 3 y 50 caracteres.');
  } else if (!/^[A-ZÁÉÍÓÚÜÑ0-9][A-ZÁÉÍÓÚÜÑ0-9 _-]*$/u.test(datos.nombre)) {
    errores.push('El nombre del rol contiene caracteres no permitidos.');
  }
  if (datos.descripcion.length > 240) errores.push('La descripción no puede superar los 240 caracteres.');
  return errores;
}

async function cargarPaginaRoles(req) {
  const rolesDb = await prisma.rol.findMany({
    include: {
      rol_permiso: { include: { permiso: true } },
      usuario_rol: { where: { activo: true }, select: { id_usuario: true } }
    },
    orderBy: [{ activo: 'desc' }, { nombre: 'asc' }]
  });
  const permisosDb = await prisma.permiso.findMany({ orderBy: [{ nombre: 'asc' }, { codigo: 'asc' }] });
  const idSolicitado = Number(req.query.rol);
  const rolSeleccionado = rolesDb.find((rol) => rol.id_rol === idSolicitado)
    || rolesDb.find((rol) => rol.nombre === 'ADMINISTRADOR')
    || rolesDb[0]
    || null;
  const idsAsignados = new Set(rolSeleccionado?.rol_permiso.map((relacion) => relacion.id_permiso) || []);

  const presentarPermiso = (permiso) => ({
    id: permiso.id_permiso,
    codigo: permiso.codigo,
    nombre: permiso.nombre,
    descripcion: permiso.descripcion || 'Sin descripción registrada',
    bloqueado: rolSeleccionado?.nombre === 'ADMINISTRADOR'
      && PERMISOS_ADMIN_OBLIGATORIOS.has(permiso.codigo)
  });

  return {
    roles: rolesDb.map((rol) => ({
      id: rol.id_rol,
      nombre: rol.nombre,
      descripcion: rol.descripcion || 'Sin descripción registrada',
      activo: rol.activo !== false,
      usuarios: rol.usuario_rol.length,
      permisos: rol.rol_permiso.length
    })),
    rolSeleccionado: rolSeleccionado ? {
      id: rolSeleccionado.id_rol,
      nombre: rolSeleccionado.nombre,
      descripcion: rolSeleccionado.descripcion || 'Sin descripción registrada',
      activo: rolSeleccionado.activo !== false,
      usuarios: rolSeleccionado.usuario_rol.length
    } : null,
    permisosAsignados: permisosDb.filter((permiso) => idsAsignados.has(permiso.id_permiso)).map(presentarPermiso),
    permisosDisponibles: permisosDb.filter((permiso) => !idsAsignados.has(permiso.id_permiso)).map(presentarPermiso),
    totalPermisos: permisosDb.length
  };
}

function rutaAdministrativaInicial(permisos = []) {
  const disponibles = new Set(permisos);
  const rutas = [
    ['GESTIONAR_TURNOS', '/admin/turnos'],
    ['GESTIONAR_USUARIOS', '/admin/usuarios'],
    ['GESTIONAR_SERVICIOS', '/admin/servicios'],
    ['GESTIONAR_HORARIOS', '/admin/horarios'],
    ['GESTIONAR_ROLES_PERMISOS', '/admin/roles'],
    ['VER_REPORTES', '/admin/reportes'],
    ['VER_AUDITORIA', '/admin/auditoria']
  ];
  return rutas.find(([permiso]) => disponibles.has(permiso))?.[1] || null;
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

function generoPacienteLegible(valor) {
  const genero = String(valor || '').trim().toUpperCase();
  if (['M', 'MASCULINO', 'HOMBRE'].includes(genero)) return 'Masculino';
  if (['F', 'FEMENINO', 'MUJER'].includes(genero)) return 'Femenino';
  return 'No especificado';
}

function porcentajeReporte(valor, total) {
  if (!total) return 0;
  return Math.round((valor / total) * 100);
}

async function cargarPaginaReportes(req) {
  const rango = rangoReporteDesdeConsulta(req.query);
  const desde = fechaUTCDesdeISO(rango.desde);
  const hastaExclusivo = fechaUTCDesdeISO(sumarDiasISO(rango.hasta, 1));
  const estadoAtendido = await prisma.estado_turno.findUnique({
    where: { codigo: 'ATENDIDO' },
    select: { id_estado: true }
  });

  if (!estadoAtendido) {
    return {
      filtros: rango,
      resumen: { pacientes: 0, turnos: 0, servicios: 0, generos: 0 },
      usuariosPorServicio: [],
      usuariosPorGeneroServicio: [],
      detalleServicios: [],
      fechaMaxima: fechaLocalISO(),
      errorReporte: 'No existe el estado ATENDIDO en la base de datos.'
    };
  }

  const turnos = await prisma.turno.findMany({
    where: {
      id_estado: estadoAtendido.id_estado,
      fecha_turno: { gte: desde, lt: hastaExclusivo }
    },
    include: {
      paciente: true,
      servicio: true
    },
    orderBy: [{ fecha_turno: 'desc' }, { hora_inicio: 'asc' }, { codigo_turno: 'asc' }]
  });

  const serviciosMap = new Map();
  const generoServicioMap = new Map();
  const pacientesUnicos = new Set();
  const serviciosUnicos = new Set();
  const generosUnicos = new Set();

  for (const turno of turnos) {
    const servicioId = turno.id_servicio || 'sin-servicio';
    const servicioNombre = turno.servicio?.nombre || 'Servicio no disponible';
    const pacienteId = turno.id_paciente || `turno-${turno.id_turno}`;
    const pacienteNombre = turno.paciente ? `${turno.paciente.nombres} ${turno.paciente.apellidos}` : 'Paciente no disponible';
    const genero = generoPacienteLegible(turno.paciente?.sexo);

    pacientesUnicos.add(pacienteId);
    serviciosUnicos.add(servicioId);
    generosUnicos.add(genero);

    if (!serviciosMap.has(servicioId)) {
      serviciosMap.set(servicioId, {
        id: servicioId,
        servicio: servicioNombre,
        descripcion: turno.servicio?.descripcion || 'Sin descripción registrada',
        turnos: 0,
        pacientes: new Set()
      });
    }
    const servicio = serviciosMap.get(servicioId);
    servicio.turnos += 1;
    servicio.pacientes.add(pacienteId);

    const claveGenero = `${servicioId}|${genero}`;
    if (!generoServicioMap.has(claveGenero)) {
      generoServicioMap.set(claveGenero, {
        servicio: servicioNombre,
        genero,
        turnos: 0,
        pacientes: new Set(),
        usuarios: new Map()
      });
    }
    const generoServicio = generoServicioMap.get(claveGenero);
    generoServicio.turnos += 1;
    generoServicio.pacientes.add(pacienteId);
    generoServicio.usuarios.set(pacienteId, {
      nombre: pacienteNombre,
      identificacion: turno.paciente?.identificacion || 'Sin identificación'
    });
  }

  const usuariosPorServicio = [...serviciosMap.values()]
    .map((servicio) => ({
      ...servicio,
      pacientes: servicio.pacientes.size,
      porcentaje: porcentajeReporte(servicio.pacientes.size, pacientesUnicos.size)
    }))
    .sort((a, b) => b.pacientes - a.pacientes || a.servicio.localeCompare(b.servicio, 'es'));

  const usuariosPorGeneroServicio = [...generoServicioMap.values()]
    .map((item) => ({
      ...item,
      pacientes: item.pacientes.size,
      usuarios: [...item.usuarios.values()].sort((a, b) => a.nombre.localeCompare(b.nombre, 'es')),
      porcentaje: porcentajeReporte(item.pacientes.size, pacientesUnicos.size)
    }))
    .sort((a, b) => a.servicio.localeCompare(b.servicio, 'es') || a.genero.localeCompare(b.genero, 'es'));

  return {
    filtros: rango,
    resumen: {
      pacientes: pacientesUnicos.size,
      turnos: turnos.length,
      servicios: serviciosUnicos.size,
      generos: generosUnicos.size
    },
    usuariosPorServicio,
    usuariosPorGeneroServicio,
    detalleServicios: turnos.map((turno) => ({
      id: turno.id_turno,
      codigo: turno.codigo_turno,
      fecha: fechaTurnoLegible(turno.fecha_turno),
      fechaISO: turno.fecha_turno.toISOString().slice(0, 10),
      hora: `${horaTurnoLegible(turno.hora_inicio)}-${horaTurnoLegible(turno.hora_fin)}`,
      paciente: turno.paciente ? `${turno.paciente.nombres} ${turno.paciente.apellidos}` : 'Paciente no disponible',
      identificacion: turno.paciente?.identificacion || 'Sin identificación',
      genero: generoPacienteLegible(turno.paciente?.sexo),
      servicio: turno.servicio?.nombre || 'Servicio no disponible'
    })),
    fechaMaxima: fechaLocalISO(),
    errorReporte: rango.error
  };
}

function fechaAuditoriaDesdeTexto(value, endOfDay = false) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value || '')) return null;
  const date = new Date(`${value}T05:00:00.000Z`);
  if (Number.isNaN(date.getTime())) return null;
  if (endOfDay) date.setUTCDate(date.getUTCDate() + 1);
  return date;
}

function etiquetaAuditoria(value = '') {
  const labels = {
    turno: 'Turno',
    servicio: 'Servicio',
    horario_servicio: 'Horario de servicio',
    dia_no_laborable: 'Día no laborable',
    usuario: 'Usuario',
    paciente: 'Paciente',
    rol: 'Rol',
    rol_permiso: 'Permisos del rol',
    CREAR: 'Creación',
    MODIFICAR: 'Modificación',
    CAMBIAR_ESTADO: 'Cambio de estado',
    ACTIVAR: 'Activación',
    DESACTIVAR: 'Desactivación',
    MODIFICAR_GRUPO: 'Modificación de horarios',
    ACTIVAR_GRUPO: 'Activación de horarios',
    DESACTIVAR_GRUPO: 'Desactivación de horarios'
  };
  return labels[value] || value.toLowerCase().replaceAll('_', ' ').replace(/^./, (letter) => letter.toUpperCase());
}

function estiloAccionAuditoria(action) {
  if (action.startsWith('CREAR')) return { color: 'green', icon: 'plus-circle' };
  if (action.startsWith('ACTIVAR')) return { color: 'azure', icon: 'circle-check' };
  if (action.startsWith('DESACTIVAR')) return { color: 'red', icon: 'circle-off' };
  if (action.includes('ESTADO')) return { color: 'orange', icon: 'refresh-cw' };
  return { color: 'purple', icon: 'pencil' };
}

async function cargarPaginaAuditoria(req) {
  const buscar = String(req.query.buscar || '').trim();
  const accion = String(req.query.accion || '').trim();
  const entidad = String(req.query.entidad || '').trim();
  const fechaDesde = /^\d{4}-\d{2}-\d{2}$/.test(req.query.desde || '') ? req.query.desde : '';
  const fechaHasta = /^\d{4}-\d{2}-\d{2}$/.test(req.query.hasta || '') ? req.query.hasta : '';
  const paginaSolicitada = Math.max(Number.parseInt(req.query.pagina, 10) || 1, 1);
  const condiciones = [];

  if (buscar) {
    const criterios = [
      { detalle: { contains: buscar, mode: 'insensitive' } },
      { direccion_ip: { contains: buscar, mode: 'insensitive' } },
      { usuario: { nombres: { contains: buscar, mode: 'insensitive' } } },
      { usuario: { apellidos: { contains: buscar, mode: 'insensitive' } } },
      { usuario: { correo: { contains: buscar, mode: 'insensitive' } } },
      { usuario: { identificacion: { contains: buscar, mode: 'insensitive' } } },
      { usuario: { paciente: { nombres: { contains: buscar, mode: 'insensitive' } } } },
      { usuario: { paciente: { apellidos: { contains: buscar, mode: 'insensitive' } } } },
      { usuario: { paciente: { identificacion: { contains: buscar, mode: 'insensitive' } } } }
    ];
    if (/^\d+$/.test(buscar)) criterios.push({ id_registro: Number(buscar) });
    condiciones.push({ OR: criterios });
  }
  if (accion) condiciones.push({ accion });
  if (entidad) condiciones.push({ entidad });
  if (fechaDesde || fechaHasta) {
    condiciones.push({
      fecha_hora: {
        ...(fechaDesde ? { gte: fechaAuditoriaDesdeTexto(fechaDesde) } : {}),
        ...(fechaHasta ? { lt: fechaAuditoriaDesdeTexto(fechaHasta, true) } : {})
      }
    });
  }

  const where = condiciones.length ? { AND: condiciones } : {};
  const total = await prisma.auditoria.count({ where });
  const totalPaginas = Math.max(Math.ceil(total / PAGE_SIZE), 1);
  const pagina = Math.min(paginaSolicitada, totalPaginas);
  const [registros, acciones, entidades] = await Promise.all([
    prisma.auditoria.findMany({
      where,
      include: {
        usuario: {
          include: {
            paciente: true,
            usuario_rol: {
              where: { activo: true },
              include: { rol: true }
            }
          }
        }
      },
      orderBy: [{ fecha_hora: 'desc' }, { id_auditoria: 'desc' }],
      skip: (pagina - 1) * PAGE_SIZE,
      take: PAGE_SIZE
    }),
    prisma.auditoria.groupBy({ by: ['accion'], orderBy: { accion: 'asc' } }),
    prisma.auditoria.groupBy({ by: ['entidad'], orderBy: { entidad: 'asc' } })
  ]);

  return {
    registros: registros.map((registro) => {
      const usuario = registro.usuario;
      const actor = usuario?.paciente
        ? `${usuario.paciente.nombres} ${usuario.paciente.apellidos}`
        : [usuario?.nombres, usuario?.apellidos].filter(Boolean).join(' ') || usuario?.nombre_usuario || 'Sistema';
      const style = estiloAccionAuditoria(registro.accion);
      return {
        id: registro.id_auditoria,
        actor,
        actorEmail: usuario?.correo || 'No registrado',
        actorIdentification: usuario?.paciente?.identificacion || usuario?.identificacion || 'No registrada',
        actorRole: usuario?.usuario_rol.map((assignment) => etiquetaAuditoria(assignment.rol.nombre)).join(', ') || 'Sistema',
        accion: registro.accion,
        accionLabel: etiquetaAuditoria(registro.accion),
        accionColor: style.color,
        accionIcon: style.icon,
        entidad: registro.entidad,
        entidadLabel: etiquetaAuditoria(registro.entidad),
        idRegistro: registro.id_registro ?? 'No registrado',
        detalle: registro.detalle || 'Sin detalle registrado',
        fecha: registro.fecha_hora
          ? new Intl.DateTimeFormat('es-EC', {
            dateStyle: 'medium',
            timeStyle: 'medium',
            timeZone: 'America/Guayaquil'
          }).format(registro.fecha_hora)
          : 'Sin fecha registrada',
        fechaISO: registro.fecha_hora?.toISOString() || '',
        ip: registro.direccion_ip || 'No registrada'
      };
    }),
    acciones: acciones.map((item) => ({ value: item.accion, label: etiquetaAuditoria(item.accion) })),
    entidades: entidades.map((item) => ({ value: item.entidad, label: etiquetaAuditoria(item.entidad) })),
    filtros: { buscar, accion, entidad, desde: fechaDesde, hasta: fechaHasta },
    paginacion: {
      pagina,
      totalPaginas,
      total,
      desde: total ? (pagina - 1) * PAGE_SIZE + 1 : 0,
      hasta: Math.min(pagina * PAGE_SIZE, total)
    }
  };
}

async function cargarPaginaHorarios(req) {
  const vista = req.query.vista === 'dias' ? 'dias' : 'horarios';
  const idServicio = Number(req.query.servicio) || null;
  const dia = req.query.dia in ORDEN_DIAS ? req.query.dia : '';
  const estado = ['activo', 'inactivo'].includes(req.query.estado) ? req.query.estado : '';
  const paginaSolicitada = Math.max(Number.parseInt(req.query.pagina, 10) || 1, 1);
  const condiciones = [];

  if (idServicio) condiciones.push({ id_servicio: idServicio });
  if (estado) condiciones.push({ activo: estado === 'activo' });

  const [registros, servicios, diasNoLaborables] = await Promise.all([
    prisma.horario_servicio.findMany({
      where: condiciones.length ? { AND: condiciones } : {},
      include: { servicio: true }
    }),
    prisma.servicio.findMany({ orderBy: [{ activo: 'desc' }, { nombre: 'asc' }] }),
    prisma.dia_no_laborable.findMany({ orderBy: [{ fecha: 'asc' }] })
  ]);

  const gruposMap = new Map();
  for (const horario of registros) {
    const inicio = horario.hora_inicio.toISOString().slice(11, 16);
    const fin = horario.hora_fin.toISOString().slice(11, 16);
    const clave = [
      horario.id_servicio,
      inicio,
      fin,
      horario.duracion_turno_min,
      horario.capacidad,
      horario.activo !== false
    ].join('|');
    if (!gruposMap.has(clave)) {
      gruposMap.set(clave, {
        ids: [],
        idServicio: horario.id_servicio,
        servicio: horario.servicio?.nombre || 'Servicio no disponible',
        servicioActivo: horario.servicio?.activo !== false,
        diasCodigos: [],
        horaInicio: inicio,
        horaFin: fin,
        duracion: horario.duracion_turno_min,
        capacidad: horario.capacidad,
        activo: horario.activo !== false
      });
    }
    const grupo = gruposMap.get(clave);
    grupo.ids.push(horario.id_horario);
    if (!grupo.diasCodigos.includes(horario.dia_semana)) grupo.diasCodigos.push(horario.dia_semana);
  }

  const grupos = [...gruposMap.values()]
    .map((grupo) => ({
      ...grupo,
      ids: grupo.ids.sort((a, b) => a - b),
      diasCodigos: grupo.diasCodigos.sort((a, b) => (ORDEN_DIAS[a] ?? 99) - (ORDEN_DIAS[b] ?? 99))
    }))
    .filter((grupo) => !dia || grupo.diasCodigos.includes(dia))
    .sort((a, b) => {
      const porServicio = a.servicio.localeCompare(b.servicio, 'es');
      if (porServicio !== 0) return porServicio;
      const porHora = a.horaInicio.localeCompare(b.horaInicio);
      if (porHora !== 0) return porHora;
      return (ORDEN_DIAS[a.diasCodigos[0]] ?? 99) - (ORDEN_DIAS[b.diasCodigos[0]] ?? 99);
    });

  const total = grupos.length;
  const totalPaginas = Math.max(Math.ceil(total / PAGE_SIZE), 1);
  const pagina = Math.min(paginaSolicitada, totalPaginas);
  const horariosPagina = grupos.slice((pagina - 1) * PAGE_SIZE, pagina * PAGE_SIZE);

  return {
    vista,
    diasSemana: DIAS_HORARIO,
    servicios,
    horarios: horariosPagina.map((horario) => {
      const bloques = Math.floor((minutosHora(horario.horaFin) - minutosHora(horario.horaInicio)) / horario.duracion);
      return {
        ...horario,
        dias: horario.diasCodigos.map((codigo) => (
          DIAS_HORARIO.find((item) => item.codigo === codigo)?.nombre || codigo
        )),
        bloques,
        cuposJornada: bloques * horario.capacidad,
      };
    }),
    diasNoLaborables: diasNoLaborables.map((diaNoLaborable) => ({
      id: diaNoLaborable.id_dia_no_laborable,
      fechaISO: diaNoLaborable.fecha.toISOString().slice(0, 10),
      fecha: new Intl.DateTimeFormat('es-EC', {
        weekday: 'long',
        day: '2-digit',
        month: 'long',
        year: 'numeric',
        timeZone: 'UTC'
      }).format(diaNoLaborable.fecha),
      descripcion: diaNoLaborable.descripcion || 'Sin motivo registrado',
      activo: diaNoLaborable.activo !== false,
      pasado: diaNoLaborable.fecha.toISOString().slice(0, 10) < fechaLocalISO()
    })),
    filtros: { servicio: idServicio || '', dia, estado },
    paginacion: {
      pagina,
      totalPaginas,
      total,
      desde: total ? (pagina - 1) * PAGE_SIZE + 1 : 0,
      hasta: Math.min(pagina * PAGE_SIZE, total)
    },
    fechaMinima: fechaLocalISO()
  };
}

async function renderHorarios(req, res, opciones = {}) {
  const datos = await cargarPaginaHorarios(req);
  return res.status(opciones.status || 200).render('admin/horarios', {
    ...datos,
    mensaje: opciones.mensaje || null,
    error: opciones.error || null,
    abrirCrearHorario: Boolean(opciones.abrirCrearHorario),
    abrirCrearDia: Boolean(opciones.abrirCrearDia),
    formularioHorario: opciones.formularioHorario || {
      id_servicio: datos.filtros.servicio || '',
      dias_semana: ['LUNES'],
      hora_inicio: '07:00',
      hora_fin: '15:00',
      duracion_turno_min: 30,
      capacidad: 1,
      activo: true
    },
    formularioDia: opciones.formularioDia || {}
  });
}

async function renderServicios(req, res, opciones = {}) {
  const datos = await cargarPaginaServicios(req);
  return res.status(opciones.status || 200).render('admin/servicios', {
    ...datos,
    mensaje: opciones.mensaje || null,
    error: opciones.error || null,
    abrirCrear: Boolean(opciones.abrirCrear),
    formulario: opciones.formulario || {}
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

async function renderRoles(req, res, opciones = {}) {
  const datos = await cargarPaginaRoles(req);
  return res.status(opciones.status || 200).render('admin/roles', {
    ...datos,
    mensaje: opciones.mensaje || null,
    error: opciones.error || null,
    abrirCrear: Boolean(opciones.abrirCrear),
    formulario: opciones.formulario || { activo: true }
  });
}

router.get('/', verificarPermiso('ACCEDER_CONSOLA'), (req, res) => {
  const ruta = rutaAdministrativaInicial(req.autorizacion?.permisos || []);
  if (!ruta) return res.status(403).render('error', { mensaje: 'Tu rol no tiene módulos administrativos habilitados.' });
  return res.redirect(ruta);
});

router.get('/console', verificarPermiso('ACCEDER_CONSOLA'), (req, res) => {
  const ruta = rutaAdministrativaInicial(req.autorizacion?.permisos || []);
  if (!ruta) return res.status(403).render('error', { mensaje: 'Tu rol no tiene módulos administrativos habilitados.' });
  return res.redirect(ruta);
});

router.get('/roles', verificarPermiso('GESTIONAR_ROLES_PERMISOS'), async (req, res, next) => {
  try {
    const mensajes = {
      creado: 'Rol creado correctamente. Ya puedes personalizar sus permisos.',
      permisos: 'Permisos del rol actualizados correctamente.'
    };
    const errores = {
      datos: 'Los datos enviados no son válidos.',
      rol: 'El rol seleccionado ya no existe.',
      permisos: 'Uno o más permisos seleccionados no son válidos.',
      protegido: 'El rol ADMINISTRADOR debe conservar el acceso a consola y la gestión de roles.'
    };
    return renderRoles(req, res, {
      mensaje: mensajes[req.query.ok] || null,
      error: errores[req.query.error] || null
    });
  } catch (error) {
    return next(error);
  }
});

router.post('/roles', verificarPermiso('GESTIONAR_ROLES_PERMISOS'), async (req, res, next) => {
  const datos = datosRol(req.body);
  const errores = validarRol(datos);
  if (errores.length) {
    return renderRoles(req, res, {
      status: 422,
      error: errores[0],
      abrirCrear: true,
      formulario: datos
    });
  }

  try {
    const rol = await prisma.$transaction(async (tx) => {
      let permisosBase = [];
      if (datos.id_rol_base) {
        const base = await tx.rol.findUnique({
          where: { id_rol: datos.id_rol_base },
          select: { rol_permiso: { select: { id_permiso: true } } }
        });
        if (!base) {
          const error = new Error('Rol base no encontrado.');
          error.adminCode = 'rol';
          throw error;
        }
        permisosBase = base.rol_permiso.map((relacion) => relacion.id_permiso);
      }

      const nuevoRol = await tx.rol.create({
        data: {
          nombre: datos.nombre,
          descripcion: datos.descripcion || null,
          activo: datos.activo
        }
      });
      if (permisosBase.length) {
        await tx.rol_permiso.createMany({
          data: permisosBase.map((idPermiso) => ({ id_rol: nuevoRol.id_rol, id_permiso: idPermiso }))
        });
      }
      await tx.auditoria.create({
        data: {
          id_usuario: req.session.userId,
          accion: 'CREAR',
          entidad: 'rol',
          id_registro: nuevoRol.id_rol,
          detalle: `Rol ${nuevoRol.nombre} creado con ${permisosBase.length} permisos iniciales`,
          direccion_ip: req.ip
        }
      });
      return nuevoRol;
    });
    return res.redirect(`/admin/roles?rol=${rol.id_rol}&ok=creado`);
  } catch (error) {
    if (error.code === 'P2002') {
      return renderRoles(req, res, {
        status: 409,
        error: 'Ya existe un rol con ese nombre.',
        abrirCrear: true,
        formulario: datos
      });
    }
    if (error.adminCode) return res.redirect(`/admin/roles?error=${error.adminCode}`);
    return next(error);
  }
});

router.post('/roles/:id/permisos', verificarPermiso('GESTIONAR_ROLES_PERMISOS'), async (req, res, next) => {
  const idRol = Number(req.params.id);
  const entrada = req.body.id_permiso ?? [];
  const idsPermisos = [...new Set((Array.isArray(entrada) ? entrada : [entrada])
    .map(Number)
    .filter(Number.isInteger))];
  if (!Number.isInteger(idRol)) return res.redirect('/admin/roles?error=datos');

  try {
    await prisma.$transaction(async (tx) => {
      const [rol, permisos, asignacionesActuales] = await Promise.all([
        tx.rol.findUnique({ where: { id_rol: idRol } }),
        tx.permiso.findMany({ where: { id_permiso: { in: idsPermisos } } }),
        tx.rol_permiso.findMany({
          where: { id_rol: idRol },
          include: { permiso: true }
        })
      ]);
      if (!rol) {
        const error = new Error('Rol no encontrado.');
        error.adminCode = 'rol';
        throw error;
      }
      if (permisos.length !== idsPermisos.length) {
        const error = new Error('Permisos inválidos.');
        error.adminCode = 'permisos';
        throw error;
      }

      const codigosNuevos = new Set(permisos.map((permiso) => permiso.codigo));
      if (rol.nombre === 'ADMINISTRADOR'
        && [...PERMISOS_ADMIN_OBLIGATORIOS].some((codigo) => !codigosNuevos.has(codigo))) {
        const error = new Error('Permisos administrativos obligatorios.');
        error.adminCode = 'protegido';
        throw error;
      }

      const idsActuales = new Set(asignacionesActuales.map((relacion) => relacion.id_permiso));
      const agregados = permisos.filter((permiso) => !idsActuales.has(permiso.id_permiso));
      const retirados = asignacionesActuales
        .filter((relacion) => !idsPermisos.includes(relacion.id_permiso))
        .map((relacion) => relacion.permiso);

      await tx.rol_permiso.deleteMany({ where: { id_rol: idRol } });
      if (idsPermisos.length) {
        await tx.rol_permiso.createMany({
          data: idsPermisos.map((idPermiso) => ({ id_rol: idRol, id_permiso: idPermiso }))
        });
      }
      await tx.auditoria.create({
        data: {
          id_usuario: req.session.userId,
          accion: 'MODIFICAR',
          entidad: 'rol_permiso',
          id_registro: idRol,
          detalle: `Rol ${rol.nombre}. Agregados: ${agregados.map((item) => item.codigo).join(', ') || 'ninguno'}. Retirados: ${retirados.map((item) => item.codigo).join(', ') || 'ninguno'}`,
          direccion_ip: req.ip
        }
      });
    }, { isolationLevel: 'Serializable' });
    return res.redirect(`/admin/roles?rol=${idRol}&ok=permisos`);
  } catch (error) {
    if (error.adminCode) return res.redirect(`/admin/roles?rol=${idRol}&error=${error.adminCode}`);
    return next(error);
  }
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

router.get('/reportes', verificarPermiso('VER_REPORTES'), async (req, res, next) => {
  try {
    const datos = await cargarPaginaReportes(req);
    return res.render('admin/reportes', datos);
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

router.get('/auditoria', verificarPermiso('VER_AUDITORIA'), async (req, res, next) => {
  try {
    const datos = await cargarPaginaAuditoria(req);
    return res.render('admin/auditoria', datos);
  } catch (error) {
    return next(error);
  }
});

router.get('/horarios', verificarPermiso('GESTIONAR_HORARIOS'), async (req, res, next) => {
  try {
    const mensajes = {
      creado: 'Horario creado correctamente.',
      actualizado: 'Horario actualizado correctamente.',
      estado: 'Estado del horario actualizado.',
      dia_creado: 'Día no laborable registrado correctamente.',
      dia_estado: 'Estado del día no laborable actualizado.'
    };
    const errores = {
      datos: 'Los datos enviados no son válidos.',
      horario: 'El horario seleccionado ya no existe.',
      servicio: 'Selecciona un servicio válido.',
      solapamiento: 'La franja se superpone con otro horario activo del mismo servicio y día.',
      dia_duplicado: 'La fecha seleccionada ya está registrada como día no laborable.',
      dia: 'El día no laborable seleccionado ya no existe.'
    };
    return renderHorarios(req, res, {
      mensaje: mensajes[req.query.ok] || null,
      error: errores[req.query.error] || null
    });
  } catch (error) {
    return next(error);
  }
});

router.post('/horarios', verificarPermiso('GESTIONAR_HORARIOS'), async (req, res, next) => {
  const datos = datosHorario(req.body);
  const errores = validarHorario(datos);

  if (errores.length) {
    return renderHorarios(req, res, {
      status: 422,
      error: errores[0],
      abrirCrearHorario: true,
      formularioHorario: datos
    });
  }

  try {
    await prisma.$transaction(async (tx) => {
      const servicio = await tx.servicio.findUnique({ where: { id_servicio: datos.id_servicio } });
      if (!servicio) {
        const error = new Error('Servicio no encontrado.');
        error.adminCode = 'servicio';
        throw error;
      }

      for (const dia of datos.dias_semana) {
        if (await buscarSolapamiento(tx, datos, [], dia)) {
          const error = new Error('Horario superpuesto.');
          error.adminCode = 'solapamiento';
          throw error;
        }
      }

      for (const dia of datos.dias_semana) {
        const horario = await tx.horario_servicio.create({ data: horarioParaBase(datos, dia) });
        await tx.auditoria.create({
          data: {
            id_usuario: req.session.userId,
            accion: 'CREAR',
            entidad: 'horario_servicio',
            id_registro: horario.id_horario,
            detalle: `${servicio.nombre}: ${dia} ${datos.hora_inicio}-${datos.hora_fin}, ${datos.capacidad} cupos`,
            direccion_ip: req.ip
          }
        });
      }
    }, { isolationLevel: 'Serializable' });

    return res.redirect(`/admin/horarios?servicio=${datos.id_servicio}&ok=creado`);
  } catch (error) {
    if (error.adminCode) {
      return renderHorarios(req, res, {
        status: error.adminCode === 'solapamiento' ? 409 : 422,
        error: error.adminCode === 'solapamiento'
          ? 'La franja se superpone con otro horario activo del mismo servicio y día.'
          : 'Selecciona un servicio válido.',
        abrirCrearHorario: true,
        formularioHorario: datos
      });
    }
    return next(error);
  }
});

router.post('/horarios/editar-grupo', verificarPermiso('GESTIONAR_HORARIOS'), async (req, res, next) => {
  const idsHorarios = [...new Set(String(req.body.ids_horarios || '')
    .split(',')
    .map(Number)
    .filter(Number.isInteger))];
  const datos = datosHorario(req.body);
  const errores = validarHorario(datos);

  if (!idsHorarios.length || errores.length) {
    return res.redirect('/admin/horarios?error=datos');
  }

  try {
    await prisma.$transaction(async (tx) => {
      const [horariosActuales, servicio] = await Promise.all([
        tx.horario_servicio.findMany({
          where: { id_horario: { in: idsHorarios } },
          include: { _count: { select: { turno: true } } }
        }),
        tx.servicio.findUnique({ where: { id_servicio: datos.id_servicio } })
      ]);
      if (horariosActuales.length !== idsHorarios.length) {
        const error = new Error('Grupo de horarios no encontrado.');
        error.adminCode = 'horario';
        throw error;
      }
      const horarioBase = horariosActuales[0];
      const mismoGrupo = horariosActuales.every((horario) => (
        horario.id_servicio === horarioBase.id_servicio
        && horario.hora_inicio.getTime() === horarioBase.hora_inicio.getTime()
        && horario.hora_fin.getTime() === horarioBase.hora_fin.getTime()
        && horario.duracion_turno_min === horarioBase.duracion_turno_min
        && horario.capacidad === horarioBase.capacidad
        && (horario.activo !== false) === (horarioBase.activo !== false)
      ));
      if (!mismoGrupo || !servicio || datos.id_servicio !== horarioBase.id_servicio) {
        const error = new Error('Datos de grupo inválidos.');
        error.adminCode = 'datos';
        throw error;
      }

      for (const dia of datos.dias_semana) {
        if (await buscarSolapamiento(tx, datos, idsHorarios, dia)) {
          const error = new Error('Horario superpuesto.');
          error.adminCode = 'solapamiento';
          throw error;
        }
      }

      const diasSeleccionados = new Set(datos.dias_semana);
      for (const horario of horariosActuales) {
        if (diasSeleccionados.has(horario.dia_semana)) {
          await tx.horario_servicio.update({
            where: { id_horario: horario.id_horario },
            data: horarioParaBase(datos, horario.dia_semana)
          });
          diasSeleccionados.delete(horario.dia_semana);
        } else if (horario._count.turno > 0) {
          await tx.horario_servicio.update({
            where: { id_horario: horario.id_horario },
            data: { activo: false }
          });
        } else {
          await tx.horario_servicio.delete({ where: { id_horario: horario.id_horario } });
        }
      }

      for (const dia of diasSeleccionados) {
        await tx.horario_servicio.create({ data: horarioParaBase(datos, dia) });
      }

      await tx.auditoria.create({
        data: {
          id_usuario: req.session.userId,
          accion: 'MODIFICAR_GRUPO',
          entidad: 'horario_servicio',
          id_registro: horariosActuales[0].id_horario,
          detalle: `${servicio.nombre}: ${datos.dias_semana.join(', ')} ${datos.hora_inicio}-${datos.hora_fin}, ${datos.capacidad} cupos`,
          direccion_ip: req.ip
        }
      });
    }, { isolationLevel: 'Serializable' });

    return res.redirect(`/admin/horarios?servicio=${datos.id_servicio}&ok=actualizado`);
  } catch (error) {
    if (error.adminCode) return res.redirect(`/admin/horarios?error=${error.adminCode}`);
    return next(error);
  }
});

router.post('/horarios/estado-grupo', verificarPermiso('GESTIONAR_HORARIOS'), async (req, res, next) => {
  const idsHorarios = [...new Set(String(req.body.ids_horarios || '')
    .split(',')
    .map(Number)
    .filter(Number.isInteger))];
  const activo = req.body.activo === 'true';
  if (!idsHorarios.length) return res.redirect('/admin/horarios?error=datos');

  try {
    let idServicio;
    await prisma.$transaction(async (tx) => {
      const horarios = await tx.horario_servicio.findMany({
        where: { id_horario: { in: idsHorarios } },
        include: { servicio: true }
      });
      if (horarios.length !== idsHorarios.length) {
        const error = new Error('Grupo de horarios no encontrado.');
        error.adminCode = 'horario';
        throw error;
      }
      idServicio = horarios[0].id_servicio;

      if (activo) {
        for (const horario of horarios) {
          const datos = {
            id_servicio: horario.id_servicio,
            dia_semana: horario.dia_semana,
            hora_inicio: horario.hora_inicio.toISOString().slice(11, 16),
            hora_fin: horario.hora_fin.toISOString().slice(11, 16),
            activo: true
          };
          if (await buscarSolapamiento(tx, datos, idsHorarios, horario.dia_semana)) {
            const error = new Error('Horario superpuesto.');
            error.adminCode = 'solapamiento';
            throw error;
          }
        }
      }

      await tx.horario_servicio.updateMany({
        where: { id_horario: { in: idsHorarios } },
        data: { activo }
      });
      await tx.auditoria.create({
        data: {
          id_usuario: req.session.userId,
          accion: activo ? 'ACTIVAR_GRUPO' : 'DESACTIVAR_GRUPO',
          entidad: 'horario_servicio',
          id_registro: horarios[0].id_horario,
          detalle: `Horarios de ${horarios[0].servicio?.nombre || 'servicio'} ${activo ? 'activados' : 'desactivados'}`,
          direccion_ip: req.ip
        }
      });
    }, { isolationLevel: 'Serializable' });

    return res.redirect(`/admin/horarios?servicio=${idServicio || ''}&ok=estado`);
  } catch (error) {
    if (error.adminCode) return res.redirect(`/admin/horarios?error=${error.adminCode}`);
    return next(error);
  }
});

router.post('/horarios/:id/editar', verificarPermiso('GESTIONAR_HORARIOS'), async (req, res, next) => {
  const idHorario = Number(req.params.id);
  const datos = datosHorario(req.body);
  const errores = validarHorario(datos);

  if (!Number.isInteger(idHorario) || errores.length) {
    return res.redirect('/admin/horarios?error=datos');
  }

  try {
    await prisma.$transaction(async (tx) => {
      const [horarioActual, servicio] = await Promise.all([
        tx.horario_servicio.findUnique({ where: { id_horario: idHorario } }),
        tx.servicio.findUnique({ where: { id_servicio: datos.id_servicio } })
      ]);
      if (!horarioActual) {
        const error = new Error('Horario no encontrado.');
        error.adminCode = 'horario';
        throw error;
      }
      if (!servicio) {
        const error = new Error('Servicio no encontrado.');
        error.adminCode = 'servicio';
        throw error;
      }
      if (await buscarSolapamiento(tx, datos, idHorario)) {
        const error = new Error('Horario superpuesto.');
        error.adminCode = 'solapamiento';
        throw error;
      }

      await tx.horario_servicio.update({
        where: { id_horario: idHorario },
        data: horarioParaBase(datos)
      });
      await tx.auditoria.create({
        data: {
          id_usuario: req.session.userId,
          accion: 'MODIFICAR',
          entidad: 'horario_servicio',
          id_registro: idHorario,
          detalle: `${servicio.nombre}: ${datos.dia_semana} ${datos.hora_inicio}-${datos.hora_fin}, ${datos.capacidad} cupos`,
          direccion_ip: req.ip
        }
      });
    }, { isolationLevel: 'Serializable' });

    return res.redirect(`/admin/horarios?servicio=${datos.id_servicio}&ok=actualizado`);
  } catch (error) {
    if (error.adminCode) return res.redirect(`/admin/horarios?error=${error.adminCode}`);
    return next(error);
  }
});

router.post('/horarios/:id/estado', verificarPermiso('GESTIONAR_HORARIOS'), async (req, res, next) => {
  const idHorario = Number(req.params.id);
  const activo = req.body.activo === 'true';
  if (!Number.isInteger(idHorario)) return res.redirect('/admin/horarios?error=datos');

  try {
    let idServicio;
    await prisma.$transaction(async (tx) => {
      const horario = await tx.horario_servicio.findUnique({
        where: { id_horario: idHorario },
        include: { servicio: true }
      });
      if (!horario) {
        const error = new Error('Horario no encontrado.');
        error.adminCode = 'horario';
        throw error;
      }
      idServicio = horario.id_servicio;

      const datos = {
        id_servicio: horario.id_servicio,
        dia_semana: horario.dia_semana,
        hora_inicio: horario.hora_inicio.toISOString().slice(11, 16),
        hora_fin: horario.hora_fin.toISOString().slice(11, 16),
        activo
      };
      if (await buscarSolapamiento(tx, datos, idHorario)) {
        const error = new Error('Horario superpuesto.');
        error.adminCode = 'solapamiento';
        throw error;
      }

      await tx.horario_servicio.update({ where: { id_horario: idHorario }, data: { activo } });
      await tx.auditoria.create({
        data: {
          id_usuario: req.session.userId,
          accion: activo ? 'ACTIVAR' : 'DESACTIVAR',
          entidad: 'horario_servicio',
          id_registro: idHorario,
          detalle: `Horario de ${horario.servicio?.nombre || 'servicio'} ${activo ? 'activado' : 'desactivado'}`,
          direccion_ip: req.ip
        }
      });
    }, { isolationLevel: 'Serializable' });

    return res.redirect(`/admin/horarios?servicio=${idServicio || ''}&ok=estado`);
  } catch (error) {
    if (error.adminCode) return res.redirect(`/admin/horarios?error=${error.adminCode}`);
    return next(error);
  }
});

router.post('/horarios/dias-no-laborables', verificarPermiso('GESTIONAR_DIAS_NO_LABORABLES'), async (req, res, next) => {
  const datos = datosDiaNoLaborable(req.body);
  const errorValidacion = validarDiaNoLaborable(datos);
  if (errorValidacion) {
    req.query.vista = 'dias';
    return renderHorarios(req, res, {
      status: 422,
      error: errorValidacion,
      abrirCrearDia: true,
      formularioDia: datos
    });
  }

  try {
    await prisma.$transaction(async (tx) => {
      const fecha = new Date(`${datos.fecha}T00:00:00.000Z`);
      const existente = await tx.dia_no_laborable.findUnique({ where: { fecha } });
      if (existente) {
        const error = new Error('Fecha duplicada.');
        error.adminCode = 'dia_duplicado';
        throw error;
      }
      const diaNoLaborable = await tx.dia_no_laborable.create({
        data: { fecha, descripcion: datos.descripcion, activo: true }
      });
      await tx.auditoria.create({
        data: {
          id_usuario: req.session.userId,
          accion: 'CREAR',
          entidad: 'dia_no_laborable',
          id_registro: diaNoLaborable.id_dia_no_laborable,
          detalle: `${datos.fecha}: ${datos.descripcion}`,
          direccion_ip: req.ip
        }
      });
    });
    return res.redirect('/admin/horarios?vista=dias&ok=dia_creado');
  } catch (error) {
    if (error.adminCode === 'dia_duplicado' || error.code === 'P2002') {
      return res.redirect('/admin/horarios?vista=dias&error=dia_duplicado');
    }
    return next(error);
  }
});

router.post('/horarios/dias-no-laborables/:id/estado', verificarPermiso('GESTIONAR_DIAS_NO_LABORABLES'), async (req, res, next) => {
  const idDia = Number(req.params.id);
  const activo = req.body.activo === 'true';
  if (!Number.isInteger(idDia)) return res.redirect('/admin/horarios?vista=dias&error=datos');

  try {
    await prisma.$transaction(async (tx) => {
      const dia = await tx.dia_no_laborable.update({
        where: { id_dia_no_laborable: idDia },
        data: { activo }
      });
      await tx.auditoria.create({
        data: {
          id_usuario: req.session.userId,
          accion: activo ? 'ACTIVAR' : 'DESACTIVAR',
          entidad: 'dia_no_laborable',
          id_registro: idDia,
          detalle: `${dia.fecha.toISOString().slice(0, 10)} ${activo ? 'habilitado' : 'deshabilitado'} como día no laborable`,
          direccion_ip: req.ip
        }
      });
    });
    return res.redirect('/admin/horarios?vista=dias&ok=dia_estado');
  } catch (error) {
    if (error.code === 'P2025') return res.redirect('/admin/horarios?vista=dias&error=dia');
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
