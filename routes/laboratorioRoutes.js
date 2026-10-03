const express = require('express');
const prisma = require('../config/prisma');
const { verificarPermiso } = require('../middlewares/authMiddleware');

const router = express.Router();
const FILTROS_ESTADO = ['espera', 'en_proceso', 'atendidos'];

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
  if (!fecha) return '';
  return new Intl.DateTimeFormat('es-EC', {
    timeZone: 'America/Guayaquil', dateStyle: 'medium', timeStyle: 'short'
  }).format(fecha);
}

function nombreUsuario(usuario) {
  if (!usuario) return 'Sin asignar';
  return [usuario.nombres, usuario.apellidos].filter(Boolean).join(' ') || usuario.nombre_usuario;
}

function resultadoFormulario(body = {}) {
  return {
    resultado: String(body.resultado || '').trim(),
    observaciones: String(body.observaciones || '').trim()
  };
}

function validarResultado(datos) {
  if (datos.resultado.length < 3) return 'Ingresa el resultado del examen.';
  if (datos.resultado.length > 20000) return 'El resultado no puede superar 20.000 caracteres.';
  if (datos.observaciones.length > 5000) return 'Las observaciones no pueden superar 5.000 caracteres.';
  return null;
}

function estadoOperativo(turno) {
  if (turno.resultado_examen?.publicado) return { codigo: 'PUBLICADO', nombre: 'Publicado' };
  if (turno.estado_turno?.codigo === 'ATENDIDO') return { codigo: 'ATENDIDO', nombre: 'Atendido' };
  if (turno.atencion) return { codigo: 'EN_PROCESO', nombre: 'En proceso' };
  return { codigo: 'EN_ESPERA', nombre: 'En espera' };
}

async function cargarDashboard(req) {
  const hoy = fechaLocalISO();
  const fecha = fechaISOValida(req.query.fecha) ? req.query.fecha : hoy;
  const buscar = String(req.query.buscar || '').trim();
  const estado = FILTROS_ESTADO.includes(req.query.estado) ? req.query.estado : '';
  const fechaDb = new Date(`${fecha}T00:00:00.000Z`);
  const userId = req.session.userId;
  const permisos = new Set(req.autorizacion?.permisos || []);
  const include = {
    paciente: true,
    servicio: true,
    estado_turno: true,
    atencion: { include: { usuario: true } },
    resultado_examen: { include: { tecnico: true } }
  };
  const condiciones = [
    { fecha_turno: fechaDb },
    { estado_turno: { codigo: { in: ['CONFIRMADO', 'ATENDIDO'] } } }
  ];

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
  if (estado === 'espera') {
    condiciones.push({ estado_turno: { codigo: 'CONFIRMADO' }, atencion: { is: null } });
  } else if (estado === 'en_proceso') {
    condiciones.push({
      estado_turno: { codigo: 'CONFIRMADO' },
      atencion: { is: { fecha_hora_fin: null } }
    });
  } else if (estado === 'atendidos') {
    condiciones.push({ estado_turno: { codigo: 'ATENDIDO' } });
  }

  const [turnos, turnosDia] = await Promise.all([
    prisma.turno.findMany({
      where: { AND: condiciones },
      include,
      orderBy: [{ hora_inicio: 'asc' }, { codigo_turno: 'asc' }]
    }),
    prisma.turno.findMany({
      where: {
        fecha_turno: fechaDb,
        estado_turno: { codigo: { in: ['CONFIRMADO', 'ATENDIDO'] } }
      },
      include: {
        estado_turno: true,
        atencion: true,
        resultado_examen: true
      }
    })
  ]);

  const filas = turnos.map((turno) => {
    const operativo = estadoOperativo(turno);
    const asignadoAlUsuario = turno.atencion?.id_tecnico === userId;
    const resultadoPublicado = Boolean(turno.resultado_examen?.publicado);
    return {
      id: turno.id_turno,
      codigo: turno.codigo_turno,
      horaInicio: horaLegible(turno.hora_inicio),
      horaFin: horaLegible(turno.hora_fin),
      paciente: turno.paciente ? `${turno.paciente.nombres} ${turno.paciente.apellidos}` : 'Paciente no disponible',
      identificacion: turno.paciente?.identificacion || 'Sin identificación',
      edad: turno.paciente?.edad ? `${turno.paciente.edad} años` : 'No registrada',
      sexo: turno.paciente?.sexo || 'No registrado',
      telefono: turno.paciente?.telefono || 'No registrado',
      correo: turno.paciente?.correo || 'No registrado',
      servicio: turno.servicio?.nombre || 'Servicio no disponible',
      servicioDescripcion: turno.servicio?.descripcion || 'Sin descripción',
      observacion: turno.observacion || 'Sin observaciones',
      estado: operativo.nombre,
      estadoCodigo: operativo.codigo,
      tecnico: nombreUsuario(turno.atencion?.usuario),
      tecnicoId: turno.atencion?.id_tecnico || null,
      inicioAtencion: fechaHoraLegible(turno.atencion?.fecha_hora_inicio),
      resultado: turno.resultado_examen?.resultado || '',
      observacionesResultado: turno.resultado_examen?.observaciones || '',
      resultadoPublicado,
      fechaResultado: fechaHoraLegible(turno.resultado_examen?.fecha_resultado),
      puedeTomar: permisos.has('TOMAR_TURNOS')
        && fecha === hoy
        && turno.estado_turno?.codigo === 'CONFIRMADO'
        && !turno.atencion,
      puedeGestionarResultado: permisos.has('REGISTRAR_RESULTADOS')
        && asignadoAlUsuario
        && !resultadoPublicado
        && ['CONFIRMADO', 'ATENDIDO'].includes(turno.estado_turno?.codigo),
      puedePublicar: permisos.has('PUBLICAR_RESULTADOS') && asignadoAlUsuario && !resultadoPublicado
    };
  });

  const kpis = {
    espera: turnosDia.filter((turno) => turno.estado_turno?.codigo === 'CONFIRMADO' && !turno.atencion).length,
    proceso: turnosDia.filter((turno) => turno.estado_turno?.codigo === 'CONFIRMADO' && turno.atencion && !turno.atencion.fecha_hora_fin).length,
    atendidos: turnosDia.filter((turno) => turno.estado_turno?.codigo === 'ATENDIDO').length,
    publicados: turnosDia.filter((turno) => turno.resultado_examen?.publicado).length
  };

  return {
    turnos: filas,
    turnosJson: JSON.stringify(Object.fromEntries(filas.map((turno) => [turno.id, turno]))).replace(/</g, '\\u003c'),
    kpis,
    filtros: { fecha, buscar, estado },
    hoy,
    fechaLegible: fechaLegible(fechaDb),
    puedeTomarTurnos: permisos.has('TOMAR_TURNOS'),
    puedeRegistrarResultados: permisos.has('REGISTRAR_RESULTADOS'),
    puedePublicarResultados: permisos.has('PUBLICAR_RESULTADOS')
  };
}

async function renderDashboard(req, res, opciones = {}) {
  const datos = await cargarDashboard(req);
  return res.status(opciones.status || 200).render('laboratorio/dashboard', {
    ...datos,
    mensaje: opciones.mensaje || null,
    error: opciones.error || null,
    abrirResultadoId: opciones.abrirResultadoId || null,
    formularioResultado: opciones.formularioResultado || {}
  });
}

router.get('/', verificarPermiso('ACCEDER_LABORATORIO'), async (req, res, next) => {
  try {
    const mensajes = {
      tomado: 'Turno asignado. La atención se encuentra en proceso.',
      borrador: 'Borrador del resultado guardado correctamente.',
      publicado: 'Resultado publicado y atención finalizada correctamente.'
    };
    const errores = {
      datos: 'Los datos enviados no son válidos.',
      turno: 'El turno seleccionado ya no se encuentra disponible.',
      fecha: 'Solo se pueden tomar turnos correspondientes al día de hoy.',
      estado: 'El turno ya no está confirmado para atención.',
      asignado: 'El turno ya fue tomado por otro técnico.',
      propietario: 'Solo el técnico asignado puede registrar este resultado.',
      publicado: 'El resultado de este turno ya fue publicado.'
    };
    return renderDashboard(req, res, {
      mensaje: mensajes[req.query.ok] || null,
      error: errores[req.query.error] || null
    });
  } catch (error) {
    return next(error);
  }
});

router.post('/turnos/:id/tomar', verificarPermiso('TOMAR_TURNOS'), async (req, res, next) => {
  const idTurno = Number(req.params.id);
  const hoy = fechaLocalISO();
  if (!Number.isInteger(idTurno)) return res.redirect(`/laboratorio?fecha=${hoy}&error=datos`);

  try {
    await prisma.$transaction(async (tx) => {
      const turno = await tx.turno.findUnique({
        where: { id_turno: idTurno },
        include: { estado_turno: true, atencion: true, paciente: true, servicio: true }
      });
      if (!turno) {
        const error = new Error('Turno no encontrado.'); error.labCode = 'turno'; throw error;
      }
      if (turno.fecha_turno.toISOString().slice(0, 10) !== hoy) {
        const error = new Error('Fecha no permitida.'); error.labCode = 'fecha'; throw error;
      }
      if (turno.estado_turno?.codigo !== 'CONFIRMADO') {
        const error = new Error('Estado no permitido.'); error.labCode = 'estado'; throw error;
      }
      if (turno.atencion) {
        const error = new Error('Turno asignado.'); error.labCode = 'asignado'; throw error;
      }

      await tx.atencion.create({
        data: {
          id_turno: turno.id_turno,
          id_tecnico: req.session.userId,
          fecha_hora_inicio: new Date()
        }
      });
      await tx.historial_turno.create({
        data: {
          id_turno: turno.id_turno,
          id_usuario: req.session.userId,
          id_estado_anterior: turno.id_estado,
          id_estado_nuevo: turno.id_estado,
          fecha_anterior: turno.fecha_turno,
          hora_anterior: turno.hora_inicio,
          fecha_nueva: turno.fecha_turno,
          hora_nueva: turno.hora_inicio,
          accion: 'INICIAR_ATENCION',
          motivo: 'Turno tomado por el técnico de laboratorio'
        }
      });
      await tx.auditoria.create({
        data: {
          id_usuario: req.session.userId,
          accion: 'TOMAR_TURNO',
          entidad: 'turno',
          id_registro: turno.id_turno,
          detalle: `Turno ${turno.codigo_turno}. Paciente: ${turno.paciente?.nombres || ''} ${turno.paciente?.apellidos || ''}. Examen: ${turno.servicio?.nombre || 'No disponible'}`,
          direccion_ip: req.ip
        }
      });
    }, { isolationLevel: 'Serializable' });
    return res.redirect(`/laboratorio?fecha=${hoy}&ok=tomado`);
  } catch (error) {
    if (error.code === 'P2002') return res.redirect(`/laboratorio?fecha=${hoy}&error=asignado`);
    if (error.labCode) return res.redirect(`/laboratorio?fecha=${hoy}&error=${error.labCode}`);
    return next(error);
  }
});

router.post('/turnos/:id/resultado', verificarPermiso('REGISTRAR_RESULTADOS'), async (req, res, next) => {
  const idTurno = Number(req.params.id);
  const publicar = req.body.accion === 'publicar';
  const fecha = fechaISOValida(req.body.fecha) ? req.body.fecha : fechaLocalISO();
  const datos = resultadoFormulario(req.body);
  const errorValidacion = validarResultado(datos);

  if (!Number.isInteger(idTurno)) return res.redirect(`/laboratorio?fecha=${fecha}&error=datos`);
  if (publicar && !(req.autorizacion?.permisos || []).includes('PUBLICAR_RESULTADOS')) {
    return res.status(403).render('error', { mensaje: 'No tienes permiso para publicar resultados.' });
  }
  if (errorValidacion) {
    req.query = { fecha };
    try {
      return await renderDashboard(req, res, {
        status: 422,
        error: errorValidacion,
        abrirResultadoId: idTurno,
        formularioResultado: datos
      });
    } catch (error) {
      return next(error);
    }
  }

  try {
    await prisma.$transaction(async (tx) => {
      const turno = await tx.turno.findUnique({
        where: { id_turno: idTurno },
        include: { atencion: true, resultado_examen: true, estado_turno: true, paciente: true, servicio: true }
      });
      if (!turno || !turno.atencion) {
        const error = new Error('Turno no disponible.'); error.labCode = 'turno'; throw error;
      }
      if (turno.atencion.id_tecnico !== req.session.userId) {
        const error = new Error('Técnico diferente.'); error.labCode = 'propietario'; throw error;
      }
      if (!['CONFIRMADO', 'ATENDIDO'].includes(turno.estado_turno?.codigo)) {
        const error = new Error('Estado no permitido.'); error.labCode = 'estado'; throw error;
      }
      if (turno.resultado_examen?.publicado) {
        const error = new Error('Resultado publicado.'); error.labCode = 'publicado'; throw error;
      }

      const ahora = new Date();
      await tx.resultado_examen.upsert({
        where: { id_turno: turno.id_turno },
        update: {
          id_tecnico: req.session.userId,
          resultado: datos.resultado,
          observaciones: datos.observaciones || null,
          fecha_resultado: ahora,
          publicado: publicar
        },
        create: {
          id_turno: turno.id_turno,
          id_tecnico: req.session.userId,
          resultado: datos.resultado,
          observaciones: datos.observaciones || null,
          fecha_resultado: ahora,
          publicado: publicar
        }
      });

      if (publicar) {
        const estadoAtendido = await tx.estado_turno.findUnique({ where: { codigo: 'ATENDIDO' } });
        if (!estadoAtendido) throw new Error('No existe el estado ATENDIDO.');
        await tx.atencion.update({
          where: { id_atencion: turno.atencion.id_atencion },
          data: { fecha_hora_fin: ahora, observacion_operativa: 'Resultado publicado' }
        });
        await tx.turno.update({
          where: { id_turno: turno.id_turno },
          data: { id_estado: estadoAtendido.id_estado }
        });
        await tx.historial_turno.create({
          data: {
            id_turno: turno.id_turno,
            id_usuario: req.session.userId,
            id_estado_anterior: turno.id_estado,
            id_estado_nuevo: estadoAtendido.id_estado,
            fecha_anterior: turno.fecha_turno,
            hora_anterior: turno.hora_inicio,
            fecha_nueva: turno.fecha_turno,
            hora_nueva: turno.hora_inicio,
            accion: 'PUBLICAR_RESULTADO',
            motivo: 'Resultado publicado y atención finalizada'
          }
        });
      }

      await tx.auditoria.create({
        data: {
          id_usuario: req.session.userId,
          accion: publicar ? 'PUBLICAR_RESULTADO' : 'GUARDAR_BORRADOR_RESULTADO',
          entidad: 'resultado_examen',
          id_registro: turno.id_turno,
          detalle: `Turno ${turno.codigo_turno}. Paciente: ${turno.paciente?.nombres || ''} ${turno.paciente?.apellidos || ''}. Examen: ${turno.servicio?.nombre || 'No disponible'}`,
          direccion_ip: req.ip
        }
      });
    }, { isolationLevel: 'Serializable' });
    return res.redirect(`/laboratorio?fecha=${fecha}&ok=${publicar ? 'publicado' : 'borrador'}`);
  } catch (error) {
    if (error.labCode) return res.redirect(`/laboratorio?fecha=${fecha}&error=${error.labCode}`);
    return next(error);
  }
});

module.exports = router;
