const prisma = require('../config/prisma');

const REPORT_ROWS = [
  {
    code: 'RPT-20260921-001', identification: '0957000011', service: 'Analisis de orina y coproanalisis',
    date: '2026-09-21', time: '08:00', result: 'Color amarillo claro. Aspecto transparente. Valores dentro de los rangos de referencia.'
  },
  {
    code: 'RPT-20260921-002', identification: '0957000029', service: 'VIH e inmunologia',
    date: '2026-09-21', time: '09:00', result: 'Prueba de tamizaje: no reactivo.'
  },
  {
    code: 'RPT-20260922-003', identification: '0957000037', service: 'Examenes de sangre y hematologia',
    date: '2026-09-22', time: '08:30', result: 'Hemoglobina 14.2 g/dL. Hematocrito 42%. Leucocitos 6.8 x10^3/uL.'
  },
  {
    code: 'RPT-20260922-004', identification: '0957000078', service: 'Pruebas de alergias',
    date: '2026-09-22', time: '10:00', result: 'Sensibilidad leve a polvo domestico. Panel restante sin reactividad significativa.'
  },
  {
    code: 'RPT-20260923-005', identification: '0957000102', service: 'Sangre',
    date: '2026-09-23', time: '07:30', result: 'Muestra procesada correctamente. Parametros evaluados dentro de referencia.'
  },
  {
    code: 'RPT-20260923-006', identification: '0957000235', service: 'Glucosa',
    date: '2026-09-23', time: '08:00', result: 'Glucosa en ayunas: 94 mg/dL.'
  },
  {
    code: 'RPT-20260924-007', identification: '0957000318', service: 'VIH e inmunologia',
    date: '2026-09-24', time: '09:30', result: 'Prueba de tamizaje: no reactivo.'
  },
  {
    code: 'RPT-20260924-008', identification: '0957000326', service: 'Analisis de orina y coproanalisis',
    date: '2026-09-24', time: '10:30', result: 'Examen fisico y quimico sin hallazgos relevantes.'
  },
  {
    code: 'RPT-20260925-009', identification: '0957000375', service: 'Examenes de sangre y hematologia',
    date: '2026-09-25', time: '08:30', result: 'Hemoglobina 13.6 g/dL. Hematocrito 40%. Plaquetas 258 x10^3/uL.'
  },
  {
    code: 'RPT-20260925-010', identification: '0957000409', service: 'Pruebas de alergias',
    date: '2026-09-25', time: '11:00', result: 'Panel de alergenos ambientales sin reactividad significativa.'
  }
];

function dateOnly(value) {
  return new Date(`${value}T00:00:00.000Z`);
}

function timeOnly(value, extraMinutes = 0) {
  const [hours, minutes] = value.split(':').map(Number);
  return new Date(Date.UTC(1970, 0, 1, hours, minutes + extraMinutes));
}

function timestamp(value, time, extraMinutes = 0) {
  const [year, month, day] = value.split('-').map(Number);
  const [hours, minutes] = time.split(':').map(Number);
  return new Date(Date.UTC(year, month - 1, day, hours + 5, minutes + extraMinutes));
}

async function main() {
  const [attended, confirmed, technician, administrator] = await Promise.all([
    prisma.estado_turno.findUnique({ where: { codigo: 'ATENDIDO' } }),
    prisma.estado_turno.findUnique({ where: { codigo: 'CONFIRMADO' } }),
    prisma.usuario.findFirst({
      where: { activo: true, usuario_rol: { some: { activo: true, rol: { nombre: 'TECNICO', activo: true } } } },
      orderBy: { id_usuario: 'asc' }
    }),
    prisma.usuario.findFirst({
      where: { activo: true, usuario_rol: { some: { activo: true, rol: { nombre: 'ADMINISTRADOR', activo: true } } } },
      orderBy: { id_usuario: 'asc' }
    })
  ]);

  if (!attended || !confirmed) throw new Error('Faltan los estados CONFIRMADO o ATENDIDO.');
  if (!technician) throw new Error('No existe un usuario tecnico activo.');

  const created = [];
  for (const row of REPORT_ROWS) {
    const [patient, service] = await Promise.all([
      prisma.paciente.findUnique({ where: { identificacion: row.identification } }),
      prisma.servicio.findFirst({ where: { nombre: row.service } })
    ]);
    if (!patient) throw new Error(`No existe el paciente ${row.identification}.`);
    if (!service) throw new Error(`No existe el servicio ${row.service}.`);

    const turn = await prisma.$transaction(async (tx) => {
      const appointmentDate = dateOnly(row.date);
      const startTime = timeOnly(row.time);
      const endTime = timeOnly(row.time, 30);
      const attentionStart = timestamp(row.date, row.time);
      const attentionEnd = new Date(attentionStart.getTime() + 25 * 60 * 1000);
      const publishedAt = new Date(attentionEnd.getTime() + 15 * 60 * 1000);

      const savedTurn = await tx.turno.upsert({
        where: { codigo_turno: row.code },
        update: {
          id_paciente: patient.id_paciente,
          id_servicio: service.id_servicio,
          id_estado: attended.id_estado,
          id_usuario_creador: administrator?.id_usuario || technician.id_usuario,
          fecha_turno: appointmentDate,
          hora_inicio: startTime,
          hora_fin: endTime,
          observacion: 'Registro historico de demostracion para reportes administrativos.'
        },
        create: {
          codigo_turno: row.code,
          id_paciente: patient.id_paciente,
          id_servicio: service.id_servicio,
          id_estado: attended.id_estado,
          id_usuario_creador: administrator?.id_usuario || technician.id_usuario,
          fecha_turno: appointmentDate,
          hora_inicio: startTime,
          hora_fin: endTime,
          fecha_creacion: new Date(attentionStart.getTime() - 24 * 60 * 60 * 1000),
          observacion: 'Registro historico de demostracion para reportes administrativos.'
        }
      });

      await tx.atencion.upsert({
        where: { id_turno: savedTurn.id_turno },
        update: {
          id_tecnico: technician.id_usuario,
          fecha_hora_inicio: attentionStart,
          fecha_hora_fin: attentionEnd,
          observacion_operativa: 'Atencion completada para datos de demostracion.'
        },
        create: {
          id_turno: savedTurn.id_turno,
          id_tecnico: technician.id_usuario,
          fecha_hora_inicio: attentionStart,
          fecha_hora_fin: attentionEnd,
          fecha_registro: attentionStart,
          observacion_operativa: 'Atencion completada para datos de demostracion.'
        }
      });

      await tx.resultado_examen.upsert({
        where: { id_turno: savedTurn.id_turno },
        update: {
          id_tecnico: technician.id_usuario,
          resultado: row.result,
          observaciones: 'Resultado ficticio para demostracion del sistema.',
          fecha_resultado: publishedAt,
          publicado: true
        },
        create: {
          id_turno: savedTurn.id_turno,
          id_tecnico: technician.id_usuario,
          resultado: row.result,
          observaciones: 'Resultado ficticio para demostracion del sistema.',
          fecha_resultado: publishedAt,
          publicado: true
        }
      });

      const history = await tx.historial_turno.findFirst({
        where: { id_turno: savedTurn.id_turno, accion: 'CARGA_DEMO_REPORTES' }
      });
      if (!history) {
        await tx.historial_turno.create({
          data: {
            id_turno: savedTurn.id_turno,
            id_usuario: technician.id_usuario,
            id_estado_anterior: confirmed.id_estado,
            id_estado_nuevo: attended.id_estado,
            fecha_anterior: appointmentDate,
            hora_anterior: startTime,
            fecha_nueva: appointmentDate,
            hora_nueva: startTime,
            accion: 'CARGA_DEMO_REPORTES',
            motivo: 'Registro historico para validar reportes administrativos.',
            fecha_evento: attentionEnd
          }
        });
      }

      const audit = await tx.auditoria.findFirst({
        where: { entidad: 'turno', id_registro: savedTurn.id_turno, accion: 'CARGAR_DEMO_REPORTES' }
      });
      if (!audit) {
        await tx.auditoria.create({
          data: {
            id_usuario: administrator?.id_usuario || technician.id_usuario,
            accion: 'CARGAR_DEMO_REPORTES',
            entidad: 'turno',
            id_registro: savedTurn.id_turno,
            detalle: `Turno ${row.code} creado para demostracion de reportes.`,
            fecha_hora: publishedAt,
            direccion_ip: '127.0.0.1'
          }
        });
      }

      return savedTurn;
    });
    created.push(turn.id_turno);
  }

  const summary = await prisma.turno.groupBy({
    by: ['id_servicio'],
    where: { id_turno: { in: created } },
    _count: { _all: true }
  });

  console.log(`Registros de reporte preparados: ${created.length}`);
  console.log('Periodo: 2026-09-21 a 2026-09-25');
  console.log(`Servicios representados: ${summary.length}`);
  console.log('Consulta: /admin/reportes?periodo=semana_anterior');
}

main()
  .catch((error) => {
    console.error('No fue posible preparar los datos de reportes:', error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
