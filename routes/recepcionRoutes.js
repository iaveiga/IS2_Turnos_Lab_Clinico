const express = require('express');
const prisma = require('../config/prisma');
const { verificarPermiso } = require('../middlewares/authMiddleware');
const { validarCedulaEcuatoriana, validarCorreoElectronico } = require('../utils/validation');

const router = express.Router();
const OPCIONES_SEXO = ['FEMENINO', 'MASCULINO', 'OTRO', 'PREFIERO_NO_DECIR'];

function fechaLocalISO(fecha = new Date()) {
  const partes = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Guayaquil', year: 'numeric', month: '2-digit', day: '2-digit'
  }).formatToParts(fecha);
  const valor = (tipo) => partes.find((parte) => parte.type === tipo).value;
  return `${valor('year')}-${valor('month')}-${valor('day')}`;
}

function fechaISOValida(valor) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(valor || '')) return false;
  const fecha = new Date(`${valor}T00:00:00.000Z`);
  return !Number.isNaN(fecha.getTime()) && fecha.toISOString().slice(0, 10) === valor;
}

function fechaLegible(fecha) {
  return new Intl.DateTimeFormat('es-EC', {
    timeZone: 'UTC', weekday: 'short', day: '2-digit', month: 'short', year: 'numeric'
  }).format(fecha);
}

function horaLegible(fecha) {
  return new Intl.DateTimeFormat('es-EC', {
    timeZone: 'UTC', hour: '2-digit', minute: '2-digit', hour12: false
  }).format(fecha);
}

function fechaHoraLegible(fecha) {
  if (!fecha) return 'Sin fecha registrada';
  return new Intl.DateTimeFormat('es-EC', {
    timeZone: 'America/Guayaquil', dateStyle: 'medium', timeStyle: 'short'
  }).format(fecha);
}

function datosPaciente(body = {}) {
  return {
    nombres: String(body.nombres || '').trim(),
    apellidos: String(body.apellidos || '').trim(),
    identificacion: String(body.identificacion || '').trim(),
    edad: String(body.edad || '').trim(),
    sexo: String(body.sexo || '').trim().toUpperCase(),
    telefono: String(body.telefono || '').trim(),
    correo: String(body.correo || '').trim().toLowerCase(),
    direccion: String(body.direccion || '').trim()
  };
}

function validarPaciente(datos) {
  const errores = {};
  if (datos.nombres.length < 2 || datos.nombres.length > 100) errores.nombres = 'Ingresa nombres válidos.';
  if (datos.apellidos.length < 2 || datos.apellidos.length > 100) errores.apellidos = 'Ingresa apellidos válidos.';
  if (!validarCedulaEcuatoriana(datos.identificacion)) errores.identificacion = 'Ingresa una cédula ecuatoriana válida.';
  if (!/^\d+$/.test(datos.edad) || Number(datos.edad) < 1 || Number(datos.edad) > 120) errores.edad = 'Ingresa una edad entre 1 y 120 años.';
  if (!OPCIONES_SEXO.includes(datos.sexo)) errores.sexo = 'Selecciona una opción válida.';
  if (!/^[0-9]{7,20}$/.test(datos.telefono)) errores.telefono = 'Ingresa un teléfono válido usando solo números.';
  if (!validarCorreoElectronico(datos.correo)) errores.correo = 'Ingresa un correo electrónico válido.';
  if (datos.direccion.length > 300) errores.direccion = 'La dirección no puede superar 300 caracteres.';
  return errores;
}

function nombreTecnico(usuario) {
  if (!usuario) return 'Laboratorio clínico';
  return [usuario.nombres, usuario.apellidos].filter(Boolean).join(' ') || usuario.nombre_usuario;
}

function serializarResultado(resultado) {
  if (!resultado?.publicado) return null;
  return {
    resultado: resultado.resultado,
    observaciones: resultado.observaciones || '',
    fecha: fechaHoraLegible(resultado.fecha_resultado),
    tecnico: nombreTecnico(resultado.tecnico)
  };
}

async function cargarDashboard(req) {
  const hoy = fechaLocalISO();
  const permisos = new Set(req.autorizacion?.permisos || []);
  const fecha = fechaISOValida(req.query.fecha) ? req.query.fecha : hoy;
  const buscar = String(req.query.buscar || '').trim();
  const estado = String(req.query.estado || '').trim().toUpperCase();
  const fechaDb = new Date(`${fecha}T00:00:00.000Z`);
  const condiciones = [{ fecha_turno: fechaDb }];

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
  if (estado) condiciones.push({ estado_turno: { codigo: estado } });

  const incluirTurno = {
    paciente: true,
    servicio: true,
    estado_turno: true,
    resultado_examen: { include: { tecnico: true } }
  };
  const [turnosDia, turnosFiltrados, estados] = await Promise.all([
    prisma.turno.findMany({ where: { fecha_turno: fechaDb }, include: { estado_turno: true } }),
    prisma.turno.findMany({
      where: { AND: condiciones },
      include: incluirTurno,
      orderBy: [{ hora_inicio: 'asc' }, { codigo_turno: 'asc' }]
    }),
    prisma.estado_turno.findMany({ orderBy: { id_estado: 'asc' } })
  ]);

  const idsPacientes = [...new Set(turnosFiltrados.map((turno) => turno.id_paciente).filter(Boolean))];
  const fichas = idsPacientes.length ? await prisma.paciente.findMany({
    where: { id_paciente: { in: idsPacientes } },
    include: {
      turno: {
        include: incluirTurno,
        orderBy: [{ fecha_turno: 'desc' }, { hora_inicio: 'asc' }]
      }
    }
  }) : [];

  const fichasPacientes = Object.fromEntries(fichas.map((paciente) => [paciente.id_paciente, {
    id: paciente.id_paciente,
    nombre: `${paciente.nombres} ${paciente.apellidos}`,
    identificacion: paciente.identificacion,
    edad: paciente.edad ? `${paciente.edad} años` : 'No registrada',
    sexo: paciente.sexo || 'No registrado',
    telefono: paciente.telefono || 'No registrado',
    correo: paciente.correo || 'No registrado',
    direccion: paciente.direccion || 'No registrada',
    examenes: paciente.turno.map((turno) => ({
      codigo: turno.codigo_turno,
      fecha: fechaLegible(turno.fecha_turno),
      fechaISO: turno.fecha_turno.toISOString().slice(0, 10),
      hora: `${horaLegible(turno.hora_inicio)} - ${horaLegible(turno.hora_fin)}`,
      servicio: turno.servicio?.nombre || 'Servicio no disponible',
      estado: turno.estado_turno?.nombre || 'Sin estado',
      estadoCodigo: turno.estado_turno?.codigo || 'SIN_ESTADO',
      resultado: permisos.has('VER_RESULTADOS') ? serializarResultado(turno.resultado_examen) : null
    }))
  }]));

  const contarEstado = (codigo) => turnosDia.filter((turno) => turno.estado_turno?.codigo === codigo).length;
  return {
    turnos: turnosFiltrados.map((turno) => ({
      id: turno.id_turno,
      idPaciente: turno.id_paciente,
      codigo: turno.codigo_turno,
      horaInicio: horaLegible(turno.hora_inicio),
      horaFin: horaLegible(turno.hora_fin),
      paciente: turno.paciente ? `${turno.paciente.nombres} ${turno.paciente.apellidos}` : 'Paciente no disponible',
      identificacion: turno.paciente?.identificacion || 'Sin identificación',
      telefono: turno.paciente?.telefono || 'Sin teléfono',
      servicio: turno.servicio?.nombre || 'Servicio no disponible',
      estado: turno.estado_turno?.nombre || 'Sin estado',
      estadoCodigo: turno.estado_turno?.codigo || 'SIN_ESTADO',
      tieneResultado: Boolean(turno.resultado_examen?.publicado),
      puedeRegistrarLlegada: fecha === hoy && turno.estado_turno?.codigo === 'PENDIENTE'
    })),
    estados,
    fichasPacientes,
    fichasPacientesJson: JSON.stringify(fichasPacientes).replace(/</g, '\\u003c'),
    kpis: { total: turnosDia.length, espera: contarEstado('CONFIRMADO'), cancelados: contarEstado('CANCELADO'), atendidos: contarEstado('ATENDIDO') },
    filtros: { fecha, buscar, estado },
    hoy,
    fechaLegible: fechaLegible(fechaDb),
    puedeRegistrarLlegada: permisos.has('REGISTRAR_LLEGADA'),
    puedeRegistrarPaciente: permisos.has('REGISTRAR_PACIENTES'),
    puedeVerResultados: permisos.has('VER_RESULTADOS')
  };
}

async function renderDashboard(req, res, opciones = {}) {
  const datos = await cargarDashboard(req);
  return res.status(opciones.status || 200).render('recepcion/dashboard', {
    ...datos,
    mensaje: opciones.mensaje || null,
    error: opciones.error || null,
    abrirPaciente: Boolean(opciones.abrirPaciente),
    formularioPaciente: opciones.formularioPaciente || {},
    erroresPaciente: opciones.erroresPaciente || {}
  });
}

router.get('/', verificarPermiso('ACCEDER_RECEPCION'), async (req, res, next) => {
  try {
    const mensajes = {
      llegada: 'Llegada registrada. El paciente ya figura en sala de espera.',
      paciente: 'Paciente registrado correctamente.'
    };
    const errores = {
      datos: 'Los datos enviados no son válidos.',
      turno: 'El turno seleccionado ya no está disponible.',
      fecha: 'La llegada solo puede registrarse en la fecha agendada.',
      estado: 'Este turno ya no está pendiente de llegada.'
    };
    return renderDashboard(req, res, { mensaje: mensajes[req.query.ok] || null, error: errores[req.query.error] || null });
  } catch (error) {
    return next(error);
  }
});

router.post('/turnos/:id/llegada', verificarPermiso('REGISTRAR_LLEGADA'), async (req, res, next) => {
  const idTurno = Number(req.params.id);
  const hoy = fechaLocalISO();
  if (!Number.isInteger(idTurno)) return res.redirect(`/recepcion?fecha=${hoy}&error=datos`);
  try {
    await prisma.$transaction(async (tx) => {
      const [turno, estadoConfirmado] = await Promise.all([
        tx.turno.findUnique({ where: { id_turno: idTurno }, include: { estado_turno: true, paciente: true, servicio: true } }),
        tx.estado_turno.findUnique({ where: { codigo: 'CONFIRMADO' } })
      ]);
      if (!turno || !estadoConfirmado) {
        const error = new Error('Turno no disponible.'); error.recepcionCode = 'turno'; throw error;
      }
      if (turno.fecha_turno.toISOString().slice(0, 10) !== hoy) {
        const error = new Error('Fecha de turno diferente.'); error.recepcionCode = 'fecha'; throw error;
      }
      if (turno.estado_turno?.codigo !== 'PENDIENTE') {
        const error = new Error('Estado de turno no permitido.'); error.recepcionCode = 'estado'; throw error;
      }
      await tx.turno.update({ where: { id_turno: idTurno }, data: { id_estado: estadoConfirmado.id_estado } });
      await tx.historial_turno.create({
        data: {
          id_turno: idTurno, id_usuario: req.session.userId,
          id_estado_anterior: turno.id_estado, id_estado_nuevo: estadoConfirmado.id_estado,
          fecha_anterior: turno.fecha_turno, hora_anterior: turno.hora_inicio,
          fecha_nueva: turno.fecha_turno, hora_nueva: turno.hora_inicio,
          accion: 'REGISTRAR_LLEGADA', motivo: 'Llegada registrada en recepción'
        }
      });
      await tx.auditoria.create({
        data: {
          id_usuario: req.session.userId, accion: 'REGISTRAR_LLEGADA', entidad: 'turno', id_registro: turno.id_turno,
          detalle: `Turno ${turno.codigo_turno}. Paciente: ${turno.paciente?.nombres || ''} ${turno.paciente?.apellidos || ''}. Servicio: ${turno.servicio?.nombre || 'No disponible'}`,
          direccion_ip: req.ip
        }
      });
    }, { isolationLevel: 'Serializable' });
    return res.redirect(`/recepcion?fecha=${hoy}&ok=llegada`);
  } catch (error) {
    if (error.recepcionCode) return res.redirect(`/recepcion?fecha=${hoy}&error=${error.recepcionCode}`);
    return next(error);
  }
});

router.post('/pacientes', verificarPermiso('REGISTRAR_PACIENTES'), async (req, res, next) => {
  const datos = datosPaciente(req.body);
  const errores = validarPaciente(datos);
  if (Object.keys(errores).length) {
    try {
      return await renderDashboard(req, res, { status: 422, error: 'Revisa los campos señalados.', abrirPaciente: true, formularioPaciente: datos, erroresPaciente: errores });
    } catch (error) {
      return next(error);
    }
  }
  try {
    const repetido = await prisma.paciente.findFirst({
      where: { OR: [{ identificacion: datos.identificacion }, { correo: { equals: datos.correo, mode: 'insensitive' } }] },
      select: { identificacion: true, correo: true }
    });
    if (repetido) {
      const erroresRepetido = repetido.identificacion === datos.identificacion
        ? { identificacion: 'Ya existe un paciente con esta cédula.' }
        : { correo: 'Ya existe un paciente con este correo.' };
      return await renderDashboard(req, res, { status: 409, error: 'El paciente ya se encuentra registrado.', abrirPaciente: true, formularioPaciente: datos, erroresPaciente: erroresRepetido });
    }
    await prisma.$transaction(async (tx) => {
      const paciente = await tx.paciente.create({
        data: {
          nombres: datos.nombres, apellidos: datos.apellidos, identificacion: datos.identificacion,
          edad: Number(datos.edad), sexo: datos.sexo, telefono: datos.telefono,
          correo: datos.correo, direccion: datos.direccion || null, activo: true
        }
      });
      await tx.auditoria.create({
        data: {
          id_usuario: req.session.userId, accion: 'CREAR_PACIENTE', entidad: 'paciente', id_registro: paciente.id_paciente,
          detalle: `Paciente ${paciente.nombres} ${paciente.apellidos} registrado desde recepción`, direccion_ip: req.ip
        }
      });
    });
    return res.redirect(`/recepcion?fecha=${fechaLocalISO()}&ok=paciente`);
  } catch (error) {
    if (error.code === 'P2002') {
      return renderDashboard(req, res, {
        status: 409, error: 'Ya existe un paciente con esta cédula.', abrirPaciente: true,
        formularioPaciente: datos, erroresPaciente: { identificacion: 'La cédula ya se encuentra registrada.' }
      });
    }
    return next(error);
  }
});

module.exports = router;
