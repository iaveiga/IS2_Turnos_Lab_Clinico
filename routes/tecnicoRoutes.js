const express = require('express');
const prisma = require('../config/prisma');
const { verificarPermiso } = require('../middlewares/authMiddleware');

const router = express.Router();
const ESTADOS_TECNICO = new Set(['ATENDIDO', 'PENDIENTE', 'CANCELADO']);

function fechaLocalISO(fecha = new Date()) {
  const partes = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Guayaquil', year: 'numeric', month: '2-digit', day: '2-digit'
  }).formatToParts(fecha);
  const valor = (tipo) => partes.find((parte) => parte.type === tipo).value;
  return `${valor('year')}-${valor('month')}-${valor('day')}`;
}

function fechaValida(valor) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(valor || '')) return false;
  const fecha = new Date(`${valor}T00:00:00.000Z`);
  return !Number.isNaN(fecha.getTime()) && fecha.toISOString().slice(0, 10) === valor;
}

function horaLegible(fecha) {
  return new Intl.DateTimeFormat('es-EC', {
    timeZone: 'UTC', hour: '2-digit', minute: '2-digit', hour12: false
  }).format(fecha);
}

function fechaLegible(fecha) {
  return new Intl.DateTimeFormat('es-EC', {
    timeZone: 'UTC', weekday: 'long', day: '2-digit', month: 'long', year: 'numeric'
  }).format(fecha);
}

async function cargarDashboard(req) {
  const hoy = fechaLocalISO();
  const fecha = fechaValida(req.query.fecha) ? req.query.fecha : hoy;
  const buscar = String(req.query.buscar || '').trim();
  const condiciones = [
    { fecha_turno: new Date(`${fecha}T00:00:00.000Z`) },
    { OR: [
      { estado_turno: { codigo: 'CONFIRMADO' } },
      { atencion: { some: { id_tecnico: req.session.userId } } }
    ] }
  ];
  if (buscar) {
    condiciones.push({ OR: [
      { codigo_turno: { contains: buscar, mode: 'insensitive' } },
      { paciente: { nombres: { contains: buscar, mode: 'insensitive' } } },
      { paciente: { apellidos: { contains: buscar, mode: 'insensitive' } } },
      { paciente: { identificacion: { contains: buscar, mode: 'insensitive' } } },
      { servicio: { nombre: { contains: buscar, mode: 'insensitive' } } }
    ] });
  }

  const turnosDb = await prisma.turno.findMany({
    where: { AND: condiciones },
    include: {
      paciente: true,
      servicio: true,
      estado_turno: true,
      atencion: {
        where: { id_tecnico: req.session.userId },
        orderBy: { fecha_registro: 'desc' },
        take: 1
      }
    },
    orderBy: [{ hora_inicio: 'asc' }, { codigo_turno: 'asc' }]
  });

  const turnos = turnosDb.map((turno) => ({
    id: turno.id_turno,
    codigo: turno.codigo_turno,
    fecha: turno.fecha_turno.toISOString().slice(0, 10),
    hora: `${horaLegible(turno.hora_inicio)} - ${horaLegible(turno.hora_fin)}`,
    horaInicio: horaLegible(turno.hora_inicio),
    paciente: turno.paciente ? `${turno.paciente.nombres} ${turno.paciente.apellidos}` : 'Paciente no disponible',
    identificacion: turno.paciente?.identificacion || 'Sin identificación',
    servicio: turno.servicio?.nombre || 'Servicio no disponible',
    estado: turno.estado_turno?.nombre || 'Sin estado',
    estadoCodigo: turno.estado_turno?.codigo || 'SIN_ESTADO',
    observacion: turno.atencion[0]?.observacion_operativa || '',
    puedeEditar: turno.estado_turno?.codigo === 'CONFIRMADO' || turno.atencion.length > 0
  }));
  return {
    turnos,
    hoy,
    fecha,
    fechaLegible: fechaLegible(new Date(`${fecha}T00:00:00.000Z`)),
    buscar,
    kpis: {
      asignados: turnos.filter((turno) => turno.estadoCodigo === 'CONFIRMADO').length,
      pendientes: turnos.filter((turno) => turno.estadoCodigo === 'PENDIENTE').length,
      atendidos: turnos.filter((turno) => turno.estadoCodigo === 'ATENDIDO').length,
      cancelados: turnos.filter((turno) => turno.estadoCodigo === 'CANCELADO').length
    }
  };
}

router.get('/', verificarPermiso('ACCEDER_TECNICO'), async (req, res, next) => {
  try {
    const datos = await cargarDashboard(req);
    const mensajes = {
      guardado: 'La atención y el estado del turno se guardaron correctamente.',
      error: 'No fue posible guardar la atención. Actualiza la página e inténtalo otra vez.',
      datos: 'Revisa el estado y la observación ingresados.',
      turno: 'El turno ya no está disponible para tu atención.'
    };
    return res.render('tecnico/dashboard', {
      ...datos,
      mensaje: mensajes[req.query.ok] || null,
      error: mensajes[req.query.error] || null
    });
  } catch (error) {
    return next(error);
  }
});

router.post('/turnos/:id/estado', verificarPermiso('REGISTRAR_ATENCION'), async (req, res, next) => {
  const idTurno = Number(req.params.id);
  const fecha = fechaValida(req.body.fecha) ? req.body.fecha : fechaLocalISO();
  const estadoCodigo = String(req.body.estado || '').trim().toUpperCase();
  const observacion = String(req.body.observacion || '').trim();
  const redirigir = (clave) => res.redirect(`/tecnico?fecha=${encodeURIComponent(fecha)}&error=${clave}`);
  if (!Number.isInteger(idTurno) || idTurno < 1 || !ESTADOS_TECNICO.has(estadoCodigo) || observacion.length > 2000) {
    return redirigir('datos');
  }

  try {
    await prisma.$transaction(async (tx) => {
      const turno = await tx.turno.findUnique({
        where: { id_turno: idTurno },
        include: { estado_turno: true, atencion: { where: { id_tecnico: req.session.userId }, take: 1 } }
      });
      if (!turno || (turno.estado_turno?.codigo !== 'CONFIRMADO' && !turno.atencion.length)) {
        const error = new Error('Turno no asignado a este técnico.');
        error.tecnicoCode = 'turno';
        throw error;
      }
      const estadoNuevo = await tx.estado_turno.findUnique({ where: { codigo: estadoCodigo } });
      if (!estadoNuevo) {
        const error = new Error(`No está configurado el estado ${estadoCodigo}.`);
        error.tecnicoCode = 'datos';
        throw error;
      }

      const ahora = new Date();
      const atencionExistente = turno.atencion[0];
      if (atencionExistente) {
        await tx.atencion.update({
          where: { id_atencion: atencionExistente.id_atencion },
          data: {
            observacion_operativa: observacion || null,
            ...(estadoCodigo === 'ATENDIDO' ? { fecha_hora_inicio: atencionExistente.fecha_hora_inicio || ahora, fecha_hora_fin: ahora } : {})
          }
        });
      } else {
        await tx.atencion.create({
          data: {
            id_turno: idTurno,
            id_tecnico: req.session.userId,
            fecha_hora_inicio: estadoCodigo === 'ATENDIDO' ? ahora : null,
            fecha_hora_fin: estadoCodigo === 'ATENDIDO' ? ahora : null,
            observacion_operativa: observacion || null
          }
        });
      }
      await tx.turno.update({ where: { id_turno: idTurno }, data: { id_estado: estadoNuevo.id_estado } });
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
          accion: `ATENCION_${estadoCodigo}`,
          motivo: observacion || `Estado actualizado por técnico: ${estadoNuevo.nombre}`
        }
      });
      await tx.auditoria.create({
        data: {
          id_usuario: req.session.userId,
          accion: `ATENCION_${estadoCodigo}`,
          entidad: 'turno',
          id_registro: idTurno,
          detalle: `Turno ${turno.codigo_turno}: ${estadoNuevo.nombre}${observacion ? `. ${observacion}` : ''}`,
          direccion_ip: req.ip
        }
      });
    }, { isolationLevel: 'Serializable' });
    return res.redirect(`/tecnico?fecha=${encodeURIComponent(fecha)}&ok=guardado`);
  } catch (error) {
    if (error.tecnicoCode) return redirigir(error.tecnicoCode);
    return next(error);
  }
});

module.exports = router;
