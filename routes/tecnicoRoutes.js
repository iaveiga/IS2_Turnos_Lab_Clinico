const express = require('express');
const prisma = require('../config/prisma');
const { verificarPermiso } = require('../middlewares/authMiddleware');

const router = express.Router();
const ESTADOS_TECNICO = new Set(['ATENDIDO', 'PENDIENTE', 'CANCELADO']);
const SECCIONES = {
  confirmados: { estado: 'CONFIRMADO', ruta: '/tecnico' },
  pendientes: { estado: 'PENDIENTE', ruta: '/tecnico/pendientes' },
  atendidos: { estado: 'ATENDIDO', ruta: '/tecnico/atendidos' },
  cancelados: { estado: 'CANCELADO', ruta: '/tecnico/cancelados' }
};

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

async function cargarDashboard(req, seccion) {
  const hoy = fechaLocalISO();
  const fecha = fechaValida(req.query.fecha) ? req.query.fecha : hoy;
  const buscar = String(req.query.buscar || '').trim();
  const condiciones = [{ fecha_turno: new Date(`${fecha}T00:00:00.000Z`) }];
  if (seccion === 'confirmados') {
    condiciones.push({ estado_turno: { codigo: SECCIONES[seccion].estado } });
  } else {
    condiciones.push({ estado_turno: { codigo: SECCIONES[seccion].estado } });
    condiciones.push({ atencion: { some: { id_tecnico: req.session.userId } } });
  }
  if (buscar) {
    condiciones.push({ OR: [
      { codigo_turno: { contains: buscar, mode: 'insensitive' } },
      { paciente: { nombres: { contains: buscar, mode: 'insensitive' } } },
      { paciente: { apellidos: { contains: buscar, mode: 'insensitive' } } },
      { paciente: { identificacion: { contains: buscar, mode: 'insensitive' } } },
      { servicio: { nombre: { contains: buscar, mode: 'insensitive' } } }
    ] });
  }

  const fechaDb = new Date(`${fecha}T00:00:00.000Z`);
  const pertenenciaTecnico = { atencion: { some: { id_tecnico: req.session.userId } } };
  const [turnosDb, conteos] = await Promise.all([
    prisma.turno.findMany({
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
    }),
    Promise.all([
      prisma.turno.count({ where: { fecha_turno: fechaDb, estado_turno: { codigo: 'CONFIRMADO' } } }),
      ...['PENDIENTE', 'ATENDIDO', 'CANCELADO'].map((codigo) => prisma.turno.count({
        where: { fecha_turno: fechaDb, estado_turno: { codigo }, ...pertenenciaTecnico }
      }))
    ])
  ]);

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
    puedeEditar: turno.atencion.length > 0 || turno.estado_turno?.codigo === 'CONFIRMADO'
  }));
  return {
    turnos,
    hoy,
    fecha,
    fechaLegible: fechaLegible(new Date(`${fecha}T00:00:00.000Z`)),
    buscar,
    seccion,
    rutaSeccion: SECCIONES[seccion].ruta,
    kpis: { asignados: conteos[0], pendientes: conteos[1], atendidos: conteos[2], cancelados: conteos[3] }
  };
}

async function mostrarSeccion(req, res, next, seccion) {
  try {
    const datos = await cargarDashboard(req, seccion);
    const mensajes = {
      guardado: 'La atención y el estado del turno se guardaron correctamente.',
      eliminado: 'El turno confirmado se eliminó correctamente.',
      error: 'No fue posible guardar la atención. Actualiza la página e inténtalo otra vez.',
      datos: 'Revisa el estado y la observación ingresados.',
      turno: 'El turno ya no está disponible para tu atención.',
      eliminacion: 'Solo puedes eliminar turnos que continúan confirmados para atención.'
    };
    return res.render('tecnico/dashboard', {
      ...datos,
      // Mantiene la vista renderizable incluso si se llama sin sección desde otra ruta.
      seccion: datos.seccion || 'confirmados',
      rutaSeccion: datos.rutaSeccion || '/tecnico',
      mensaje: mensajes[req.query.ok] || null,
      error: mensajes[req.query.error] || null
    });
  } catch (error) {
    return next(error);
  }
}

router.get('/', verificarPermiso('ACCEDER_TECNICO'), (req, res, next) => mostrarSeccion(req, res, next, 'confirmados'));
router.get('/pendientes', verificarPermiso('ACCEDER_TECNICO'), (req, res, next) => mostrarSeccion(req, res, next, 'pendientes'));
router.get('/atendidos', verificarPermiso('ACCEDER_TECNICO'), (req, res, next) => mostrarSeccion(req, res, next, 'atendidos'));
router.get('/cancelados', verificarPermiso('ACCEDER_TECNICO'), (req, res, next) => mostrarSeccion(req, res, next, 'cancelados'));

router.post('/turnos/:id/estado', verificarPermiso('REGISTRAR_ATENCION'), async (req, res, next) => {
  const idTurno = Number(req.params.id);
  const fecha = fechaValida(req.body.fecha) ? req.body.fecha : fechaLocalISO();
  const estadoCodigo = String(req.body.estado || '').trim().toUpperCase();
  const observacion = String(req.body.observacion || '').trim();
  const redirigir = (clave) => res.redirect(`${SECCIONES[estadoCodigo]?.ruta || '/tecnico'}?fecha=${encodeURIComponent(fecha)}&error=${clave}`);
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
            fecha_hora_inicio: estadoCodigo === 'ATENDIDO' ? (atencionExistente.fecha_hora_inicio || ahora) : null,
            fecha_hora_fin: estadoCodigo === 'ATENDIDO' ? ahora : null
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
    return res.redirect(`${SECCIONES[estadoCodigo].ruta}?fecha=${encodeURIComponent(fecha)}&ok=guardado`);
  } catch (error) {
    if (error.tecnicoCode) return redirigir(error.tecnicoCode);
    return next(error);
  }
});

router.post('/turnos/:id/eliminar', verificarPermiso('REGISTRAR_ATENCION'), async (req, res, next) => {
  const idTurno = Number(req.params.id);
  const fecha = fechaValida(req.body.fecha) ? req.body.fecha : fechaLocalISO();
  const regreso = `/tecnico?fecha=${encodeURIComponent(fecha)}`;
  if (!Number.isInteger(idTurno) || idTurno < 1) return res.redirect(`${regreso}&error=datos`);

  try {
    await prisma.$transaction(async (tx) => {
      const turno = await tx.turno.findUnique({
        where: { id_turno: idTurno },
        include: { estado_turno: true }
      });
      if (!turno || turno.estado_turno?.codigo !== 'CONFIRMADO') {
        const error = new Error('Solo se eliminan turnos confirmados.');
        error.tecnicoCode = 'eliminacion';
        throw error;
      }
      await tx.auditoria.create({
        data: {
          id_usuario: req.session.userId,
          accion: 'ELIMINAR_TURNO_TECNICO',
          entidad: 'turno',
          id_registro: turno.id_turno,
          detalle: `El técnico eliminó el turno confirmado ${turno.codigo_turno}`,
          direccion_ip: req.ip
        }
      });
      await tx.turno.delete({ where: { id_turno: idTurno } });
    }, { isolationLevel: 'Serializable' });
    return res.redirect(`${regreso}&ok=eliminado`);
  } catch (error) {
    if (error.tecnicoCode) return res.redirect(`${regreso}&error=${error.tecnicoCode}`);
    return next(error);
  }
});

module.exports = router;
