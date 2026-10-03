const crypto = require('crypto');
const express = require('express');
const prisma = require('../config/prisma');
const { verificarPermiso } = require('../middlewares/authMiddleware');

const router = express.Router();
const DIAS_SEMANA = ['DOMINGO', 'LUNES', 'MARTES', 'MIERCOLES', 'JUEVES', 'VIERNES', 'SABADO'];
const MAX_DIAS_AGENDAMIENTO = 90;

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

function horaLocalEnMinutos(fecha = new Date()) {
  const partes = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Guayaquil',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23'
  }).formatToParts(fecha);
  const valor = (tipo) => Number(partes.find((parte) => parte.type === tipo).value);
  return valor('hour') * 60 + valor('minute');
}

function fechaDesdeISO(valor) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(valor || '')) return null;
  const fecha = new Date(`${valor}T00:00:00.000Z`);
  return Number.isNaN(fecha.getTime()) || fecha.toISOString().slice(0, 10) !== valor ? null : fecha;
}

function horaDesdeTexto(valor) {
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(valor || '')) return null;
  return new Date(`1970-01-01T${valor}:00.000Z`);
}

function minutosDesdeFecha(fecha) {
  return fecha.getUTCHours() * 60 + fecha.getUTCMinutes();
}

function textoHora(minutos) {
  const horas = String(Math.floor(minutos / 60)).padStart(2, '0');
  const mins = String(minutos % 60).padStart(2, '0');
  return `${horas}:${mins}`;
}

function diaDeFecha(fecha) {
  return DIAS_SEMANA[fecha.getUTCDay()];
}

function fechaDentroDeRango(valor) {
  const hoy = fechaLocalISO();
  const limite = new Date(`${hoy}T00:00:00.000Z`);
  limite.setUTCDate(limite.getUTCDate() + MAX_DIAS_AGENDAMIENTO);
  return valor >= hoy && valor <= limite.toISOString().slice(0, 10);
}

function horarioContieneHora(horario, hora) {
  const inicio = minutosDesdeFecha(horario.hora_inicio);
  const fin = minutosDesdeFecha(horario.hora_fin);
  const seleccion = minutosDesdeFecha(hora);
  return seleccion >= inicio
    && seleccion + horario.duracion_turno_min <= fin
    && (seleccion - inicio) % horario.duracion_turno_min === 0;
}

function fechaLegible(fecha) {
  return new Intl.DateTimeFormat('es-EC', {
    timeZone: 'UTC',
    weekday: 'short',
    day: '2-digit',
    month: 'short',
    year: 'numeric'
  }).format(fecha);
}

function horaLegible(fecha) {
  return new Intl.DateTimeFormat('es-EC', {
    timeZone: 'UTC',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false
  }).format(fecha);
}

function fechaHoraLegible(fecha) {
  if (!fecha) return '';
  return new Intl.DateTimeFormat('es-EC', {
    timeZone: 'America/Guayaquil',
    dateStyle: 'medium',
    timeStyle: 'short'
  }).format(fecha);
}

function nombreUsuario(usuario) {
  if (!usuario) return 'Laboratorio Clinico San Francisco';
  return [usuario.nombres, usuario.apellidos].filter(Boolean).join(' ') || usuario.nombre_usuario;
}

function sexoPacienteLegible(valor) {
  const sexo = String(valor || '').trim().toUpperCase();
  if (sexo === 'MASCULINO') return 'Masculino';
  if (sexo === 'FEMENINO') return 'Femenino';
  if (sexo === 'OTRO') return 'Otro';
  if (sexo === 'PREFIERO_NO_DECIR') return 'Prefiere no indicar';
  return 'No registrado';
}

function iconoServicio(nombre) {
  const texto = nombre.toLowerCase();
  if (texto.includes('orina') || texto.includes('copro')) return 'test-tube-diagonal';
  if (texto.includes('vih') || texto.includes('inmun')) return 'shield-check';
  if (texto.includes('alerg')) return 'scan-search';
  return 'droplets';
}

async function obtenerPacienteDeSesion(req) {
  const idPaciente = Number(req.session?.user?.id_paciente);
  if (!Number.isInteger(idPaciente)) return null;
  return prisma.paciente.findFirst({
    where: { id_paciente: idPaciente, activo: true }
  });
}

async function obtenerDisponibilidad(idServicio, fechaTexto) {
  const fecha = fechaDesdeISO(fechaTexto);
  if (!fecha || !fechaDentroDeRango(fechaTexto)) {
    return { error: 'Selecciona una fecha válida dentro de los próximos 90 días.', status: 422 };
  }

  const [servicio, diaNoLaborable] = await Promise.all([
    prisma.servicio.findFirst({
      where: { id_servicio: idServicio, activo: true },
      select: { id_servicio: true, nombre: true }
    }),
    prisma.dia_no_laborable.findFirst({
      where: { fecha, activo: true },
      select: { descripcion: true }
    })
  ]);

  if (!servicio) return { error: 'El tipo de examen no está disponible.', status: 404 };
  if (diaNoLaborable) {
    return {
      servicio,
      fecha: fechaTexto,
      slots: [],
      aviso: diaNoLaborable.descripcion || 'El laboratorio no atiende en esta fecha.'
    };
  }

  const horarios = await prisma.horario_servicio.findMany({
    where: {
      id_servicio: idServicio,
      dia_semana: diaDeFecha(fecha),
      activo: true
    },
    orderBy: { hora_inicio: 'asc' }
  });

  if (horarios.length === 0) {
    return { servicio, fecha: fechaTexto, slots: [], aviso: 'No hay atención configurada para este día.' };
  }

  const turnosReservados = await prisma.turno.findMany({
    where: {
      fecha_turno: fecha,
      id_servicio: idServicio,
      id_horario: { in: horarios.map((horario) => horario.id_horario) },
      estado_turno: { consume_cupo: true }
    },
    select: { id_horario: true, hora_inicio: true }
  });

  const ocupacion = new Map();
  for (const turno of turnosReservados) {
    const clave = `${turno.id_horario}-${textoHora(minutosDesdeFecha(turno.hora_inicio))}`;
    ocupacion.set(clave, (ocupacion.get(clave) || 0) + 1);
  }

  const hoy = fechaLocalISO();
  const minutoActual = horaLocalEnMinutos();
  const slotsPorHora = new Map();

  for (const horario of horarios) {
    const inicio = minutosDesdeFecha(horario.hora_inicio);
    const fin = minutosDesdeFecha(horario.hora_fin);

    for (let minuto = inicio; minuto + horario.duracion_turno_min <= fin; minuto += horario.duracion_turno_min) {
      if (fechaTexto === hoy && minuto <= minutoActual) continue;

      const hora = textoHora(minuto);
      const reservados = ocupacion.get(`${horario.id_horario}-${hora}`) || 0;
      const disponibles = Math.max(horario.capacidad - reservados, 0);
      const existente = slotsPorHora.get(hora);

      if (!existente || disponibles > existente.disponibles) {
        slotsPorHora.set(hora, {
          hora,
          id_horario: horario.id_horario,
          disponibles,
          capacidad: horario.capacidad
        });
      }
    }
  }

  return {
    servicio,
    fecha: fechaTexto,
    slots: [...slotsPorHora.values()].filter((slot) => slot.disponibles > 0)
  };
}

router.get('/', verificarPermiso('VER_TURNOS'), async (req, res, next) => {
  try {
    const paciente = await obtenerPacienteDeSesion(req);
    const catalogoServicios = await prisma.servicio.findMany({
      select: {
        id_servicio: true,
        nombre: true,
        descripcion: true,
        activo: true,
        horario_servicio: {
          where: { activo: true },
          select: { id_horario: true },
          take: 1
        }
      },
      orderBy: { nombre: 'asc' }
    });
    const servicios = catalogoServicios.map((servicio) => ({
      id_servicio: servicio.id_servicio,
      nombre: servicio.nombre,
      descripcion: servicio.descripcion,
      disponible: servicio.activo && servicio.horario_servicio.length > 0,
      icono: iconoServicio(servicio.nombre)
    }));
    const hayServiciosDisponibles = servicios.some((servicio) => servicio.disponible);

    const turnosPaciente = paciente
      ? await prisma.turno.findMany({
        where: { id_paciente: paciente.id_paciente },
        include: {
          servicio: true,
          estado_turno: true,
          resultado_examen: { include: { tecnico: true } }
        },
        orderBy: [{ fecha_turno: 'asc' }, { hora_inicio: 'asc' }]
      })
      : [];

    const serializarTurno = (turno) => ({
      id: turno.id_turno,
      codigo: turno.codigo_turno,
      servicio: turno.servicio?.nombre || 'Servicio no disponible',
      servicioDescripcion: turno.servicio?.descripcion || 'Examen de laboratorio',
      fecha: fechaLegible(turno.fecha_turno),
      hora: horaLegible(turno.hora_inicio),
      estado: turno.estado_turno?.nombre || 'Sin estado',
      estadoCodigo: turno.estado_turno?.codigo?.toLowerCase() || 'sin-estado',
      observacion: turno.observacion
    });
    const turnos = turnosPaciente
      .filter((turno) => turno.estado_turno?.codigo !== 'ATENDIDO')
      .map(serializarTurno);
    const historial = turnosPaciente
      .filter((turno) => turno.estado_turno?.codigo === 'ATENDIDO')
      .reverse()
      .map((turno) => {
        const resultadoPublicado = turno.resultado_examen?.publicado === true;
        return {
          ...serializarTurno(turno),
          resultado: resultadoPublicado ? {
            resultado: turno.resultado_examen.resultado,
            observaciones: turno.resultado_examen.observaciones || '',
            fechaPublicacion: fechaHoraLegible(turno.resultado_examen.fecha_resultado),
            tecnico: nombreUsuario(turno.resultado_examen.tecnico),
            paciente: {
              nombre: `${paciente.nombres} ${paciente.apellidos}`,
              identificacion: paciente.identificacion,
              edad: paciente.edad ? `${paciente.edad} años` : 'No registrada',
              sexo: sexoPacienteLegible(paciente.sexo)
            }
          } : null
        };
      });
    const resultadosJson = JSON.stringify(Object.fromEntries(
      historial.filter((turno) => turno.resultado).map((turno) => [turno.id, turno])
    )).replace(/</g, '\\u003c');

    const hoy = fechaLocalISO();
    const fechaMaxima = new Date(`${hoy}T00:00:00.000Z`);
    fechaMaxima.setUTCDate(fechaMaxima.getUTCDate() + MAX_DIAS_AGENDAMIENTO);

    res.render('turnos/lista', {
      paciente,
      servicios,
      hayServiciosDisponibles,
      turnos,
      historial,
      resultadosJson,
      fechaMinima: hoy,
      fechaMaxima: fechaMaxima.toISOString().slice(0, 10),
      abrirModal: req.query.agendar === '1',
      turnoCreado: req.query.creado || null
    });
  } catch (error) {
    next(error);
  }
});

router.get('/nuevo', verificarPermiso('CREAR_TURNO'), (req, res) => {
  res.redirect('/turnos?agendar=1');
});

router.get('/disponibilidad', verificarPermiso('CREAR_TURNO'), async (req, res) => {
  try {
    const idServicio = Number(req.query.servicio);
    if (!Number.isInteger(idServicio)) {
      return res.status(422).json({ error: 'Selecciona un tipo de examen.' });
    }

    const resultado = await obtenerDisponibilidad(idServicio, req.query.fecha);
    if (resultado.error) return res.status(resultado.status).json({ error: resultado.error });
    return res.json(resultado);
  } catch (error) {
    console.error('Error al consultar disponibilidad:', error);
    return res.status(500).json({ error: 'No fue posible consultar los horarios disponibles.' });
  }
});

router.post('/nuevo', verificarPermiso('CREAR_TURNO'), async (req, res) => {
  const idServicio = Number(req.body.id_servicio);
  const idHorario = Number(req.body.id_horario);
  const fechaTexto = String(req.body.fecha_turno || '');
  const horaTexto = String(req.body.hora_inicio || '');
  const observacion = String(req.body.observacion || '').trim().slice(0, 500);
  const fecha = fechaDesdeISO(fechaTexto);
  const horaInicio = horaDesdeTexto(horaTexto);

  if (!Number.isInteger(idServicio) || !Number.isInteger(idHorario) || !fecha || !horaInicio) {
    return res.status(422).json({ error: 'Completa el tipo de examen, la fecha y la hora.' });
  }
  if (!fechaDentroDeRango(fechaTexto)) {
    return res.status(422).json({ error: 'La fecha seleccionada está fuera del rango permitido.' });
  }
  if (fechaTexto === fechaLocalISO() && minutosDesdeFecha(horaInicio) <= horaLocalEnMinutos()) {
    return res.status(409).json({ error: 'La hora seleccionada ya no está disponible.' });
  }

  const paciente = await obtenerPacienteDeSesion(req);
  if (!paciente) {
    return res.status(403).json({ error: 'Tu usuario no tiene un paciente activo asociado.' });
  }

  const intentarCrear = async () => prisma.$transaction(async (tx) => {
    const [horario, estadoPendiente, diaNoLaborable] = await Promise.all([
      tx.horario_servicio.findFirst({
        where: {
          id_horario: idHorario,
          id_servicio: idServicio,
          dia_semana: diaDeFecha(fecha),
          activo: true,
          servicio: { activo: true }
        },
        include: { servicio: true }
      }),
      tx.estado_turno.findUnique({ where: { codigo: 'PENDIENTE' } }),
      tx.dia_no_laborable.findFirst({ where: { fecha, activo: true } })
    ]);

    if (!horario || !horarioContieneHora(horario, horaInicio)) {
      const error = new Error('El horario seleccionado no pertenece al servicio o ya no está disponible.');
      error.status = 409;
      throw error;
    }
    if (!estadoPendiente) {
      const error = new Error('Falta configurar el estado PENDIENTE en la base de datos.');
      error.status = 503;
      throw error;
    }
    if (diaNoLaborable) {
      const error = new Error(diaNoLaborable.descripcion || 'El laboratorio no atiende en esta fecha.');
      error.status = 409;
      throw error;
    }

    const [reservados, turnoSuperpuesto] = await Promise.all([
      tx.turno.count({
        where: {
          id_horario: idHorario,
          fecha_turno: fecha,
          hora_inicio: horaInicio,
          estado_turno: { consume_cupo: true }
        }
      }),
      tx.turno.findFirst({
        where: {
          id_paciente: paciente.id_paciente,
          fecha_turno: fecha,
          hora_inicio: { lt: new Date(horaInicio.getTime() + horario.duracion_turno_min * 60000) },
          hora_fin: { gt: horaInicio },
          estado_turno: { consume_cupo: true }
        },
        select: { codigo_turno: true }
      })
    ]);

    if (reservados >= horario.capacidad) {
      const error = new Error('El último cupo de este horario acaba de ser reservado. Elige otra hora.');
      error.status = 409;
      throw error;
    }
    if (turnoSuperpuesto) {
      const error = new Error(`Ya tienes el turno ${turnoSuperpuesto.codigo_turno} dentro de este horario.`);
      error.status = 409;
      throw error;
    }

    const horaFin = new Date(horaInicio);
    horaFin.setUTCMinutes(horaFin.getUTCMinutes() + horario.duracion_turno_min);
    const codigo = `TUR-${fechaTexto.replaceAll('-', '')}-${crypto.randomBytes(3).toString('hex').toUpperCase()}`;

    const turno = await tx.turno.create({
      data: {
        codigo_turno: codigo,
        id_paciente: paciente.id_paciente,
        id_servicio: idServicio,
        id_horario: idHorario,
        id_estado: estadoPendiente.id_estado,
        id_usuario_creador: req.session.userId,
        fecha_turno: fecha,
        hora_inicio: horaInicio,
        hora_fin: horaFin,
        observacion: observacion || null
      }
    });

    await Promise.all([
      tx.historial_turno.create({
        data: {
          id_turno: turno.id_turno,
          id_usuario: req.session.userId,
          id_estado_nuevo: estadoPendiente.id_estado,
          fecha_nueva: fecha,
          hora_nueva: horaInicio,
          accion: 'CREACION',
          motivo: 'Turno agendado por el paciente'
        }
      }),
      tx.auditoria.create({
        data: {
          id_usuario: req.session.userId,
          accion: 'CREAR',
          entidad: 'turno',
          id_registro: turno.id_turno,
          detalle: `Turno ${codigo} para ${horario.servicio.nombre}`,
          direccion_ip: req.ip
        }
      })
    ]);

    return turno;
  }, { isolationLevel: 'Serializable' });

  try {
    let turno;
    for (let intento = 0; intento < 3; intento += 1) {
      try {
        turno = await intentarCrear();
        break;
      } catch (error) {
        if (error.code !== 'P2034' || intento === 2) throw error;
      }
    }

    return res.status(201).json({
      mensaje: 'Tu turno fue agendado correctamente.',
      codigo: turno.codigo_turno
    });
  } catch (error) {
    if (!error.status) console.error('Error al agendar turno:', error);
    return res.status(error.status || 500).json({
      error: error.status ? error.message : 'No fue posible agendar el turno. Intenta nuevamente.'
    });
  }
});

module.exports = router;
