const prisma = require('../config/prisma');
const { crearPasswordHash } = require('../utils/password');
const { validarCedulaEcuatoriana } = require('../utils/validation');

const START_DATE = '2026-10-03';
const END_DATE = '2026-10-25';
const DEMO_CODE_PREFIX = 'DEMO-';
const DEMO_PASSWORD = 'Paciente2026!';
const WEEKDAYS = ['DOMINGO', 'LUNES', 'MARTES', 'MIERCOLES', 'JUEVES', 'VIERNES', 'SABADO'];

const MALE_PATIENTS = [
  ['Alejandro', 'Mendez'], ['Andres', 'Molina'], ['Bruno', 'Herrera'],
  ['Carlos', 'Vega'], ['Cristian', 'Torres'], ['Daniel', 'Castro'],
  ['David', 'Romero'], ['Diego', 'Salazar'], ['Eduardo', 'Paredes'],
  ['Emilio', 'Zambrano'], ['Esteban', 'Cevallos'], ['Felipe', 'Guerrero'],
  ['Fernando', 'Naranjo'], ['Gabriel', 'Rios'], ['Hugo', 'Cabrera'],
  ['Isaac', 'Delgado'], ['Javier', 'Peralta'], ['Jorge', 'Valencia'],
  ['Jose', 'Alvarado'], ['Juan', 'Benitez'], ['Leonardo', 'Espinoza'],
  ['Luis', 'Aguirre'], ['Marco', 'Villacis'], ['Mateo', 'Cardenas'],
  ['Miguel', 'Carrillo'], ['Nicolas', 'Andrade'], ['Pablo', 'Navarrete'],
  ['Ricardo', 'Soria'], ['Santiago', 'Velez'], ['Victor', 'Mora']
];

const FEMALE_PATIENTS = [
  ['Adriana', 'Flores'], ['Alejandra', 'Ortiz'], ['Andrea', 'Luna'],
  ['Camila', 'Reyes'], ['Carla', 'Mendoza'], ['Daniela', 'Acosta'],
  ['Diana', 'Paz'], ['Elena', 'Roldan'], ['Emilia', 'Leon'],
  ['Gabriela', 'Silva'], ['Isabel', 'Mejia'], ['Karla', 'Vera'],
  ['Laura', 'Pena'], ['Lucia', 'Rivas'], ['Maria', 'Cedeno'],
  ['Natalia', 'Bravo'], ['Paula', 'Jaramillo'], ['Sofia', 'Calderon'],
  ['Valentina', 'Bustos'], ['Victoria', 'Tapia']
];

const EMAIL_DOMAINS = ['gmail.com', 'outlook.com', 'hotmail.com', 'yahoo.com', 'proton.me'];
const ADDRESSES = [
  'Alborada, Guayaquil',
  'Urdesa, Guayaquil',
  'Sauces, Guayaquil',
  'Samanes, Guayaquil',
  'Kennedy, Guayaquil',
  'Garzota, Guayaquil',
  'Ceibos, Guayaquil',
  'Centro, Guayaquil'
];
const OBSERVATIONS = [
  null,
  'Control preventivo',
  'Examen solicitado por medicina general',
  'Seguimiento de resultados',
  'Paciente en ayunas'
];

function createRandom(seed) {
  let value = seed >>> 0;
  return () => {
    value += 0x6D2B79F5;
    let result = value;
    result = Math.imul(result ^ (result >>> 15), result | 1);
    result ^= result + Math.imul(result ^ (result >>> 7), result | 61);
    return ((result ^ (result >>> 14)) >>> 0) / 4294967296;
  };
}

const random = createRandom(20261003);

function randomItem(items) {
  return items[Math.floor(random() * items.length)];
}

function randomInteger(min, max) {
  return Math.floor(random() * (max - min + 1)) + min;
}

function normalizeEmailPart(value) {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '');
}

function buildValidId(index) {
  const base = `0957000${String(index).padStart(2, '0')}`;
  const coefficients = [2, 1, 2, 1, 2, 1, 2, 1, 2];
  const sum = coefficients.reduce((total, coefficient, position) => {
    const product = Number(base[position]) * coefficient;
    return total + (product >= 10 ? product - 9 : product);
  }, 0);
  const id = `${base}${(10 - (sum % 10)) % 10}`;
  if (!validarCedulaEcuatoriana(id)) throw new Error(`No fue posible generar la cedula ${id}.`);
  return id;
}

function minutesFromTime(value) {
  return value.getUTCHours() * 60 + value.getUTCMinutes();
}

function timeFromMinutes(minutes) {
  const hours = String(Math.floor(minutes / 60)).padStart(2, '0');
  const mins = String(minutes % 60).padStart(2, '0');
  return new Date(`1970-01-01T${hours}:${mins}:00.000Z`);
}

function dateRange(start, end) {
  const dates = [];
  const current = new Date(`${start}T00:00:00.000Z`);
  const last = new Date(`${end}T00:00:00.000Z`);
  while (current <= last) {
    dates.push(new Date(current));
    current.setUTCDate(current.getUTCDate() + 1);
  }
  return dates;
}

function buildPatients() {
  const records = [
    ...MALE_PATIENTS.map(([nombres, apellidos]) => ({ nombres, apellidos, sexo: 'MASCULINO' })),
    ...FEMALE_PATIENTS.map(([nombres, apellidos]) => ({ nombres, apellidos, sexo: 'FEMENINO' }))
  ];

  return records.map((patient, index) => {
    const sequence = String(index + 1).padStart(3, '0');
    const domain = randomItem(EMAIL_DOMAINS);
    return {
      ...patient,
      identificacion: buildValidId(index + 1),
      legacyIdentification: `0997000${sequence}`,
      edad: randomInteger(20, 40),
      telefono: `0987000${sequence}`,
      correo: `${normalizeEmailPart(patient.nombres)}.${normalizeEmailPart(patient.apellidos)}@${domain}`,
      direccion: randomItem(ADDRESSES),
      activo: true
    };
  });
}

function buildSlots(schedules, closedDates) {
  const slots = [];
  for (const date of dateRange(START_DATE, END_DATE)) {
    const dateText = date.toISOString().slice(0, 10);
    if (closedDates.has(dateText)) continue;
    const weekday = WEEKDAYS[date.getUTCDay()];
    for (const schedule of schedules.filter((item) => item.dia_semana === weekday)) {
      const start = minutesFromTime(schedule.hora_inicio);
      const end = minutesFromTime(schedule.hora_fin);
      for (let minute = start; minute + schedule.duracion_turno_min <= end; minute += schedule.duracion_turno_min) {
        slots.push({
          date,
          dateText,
          startMinute: minute,
          endMinute: minute + schedule.duracion_turno_min,
          schedule
        });
      }
    }
  }
  return slots;
}

function selectAppointments(patients, slots, states, existingOccupancy) {
  const appointments = [];
  const statePlan = [
    ...Array(60).fill('PENDIENTE'),
    ...Array(30).fill('CONFIRMADO'),
    ...Array(10).fill('CANCELADO')
  ];

  for (let index = statePlan.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(random() * (index + 1));
    [statePlan[index], statePlan[swapIndex]] = [statePlan[swapIndex], statePlan[index]];
  }

  let stateIndex = 0;
  for (const patient of patients) {
    const patientAppointments = [];
    for (let number = 0; number < 2; number += 1) {
      const state = states.get(statePlan[stateIndex]);
      stateIndex += 1;
      let selected = null;

      for (let attempt = 0; attempt < 5000 && !selected; attempt += 1) {
        const candidate = randomItem(slots);
        const occupancyKey = `${candidate.schedule.id_horario}|${candidate.dateText}|${candidate.startMinute}`;
        const sameService = patientAppointments.some((item) => (
          item.schedule.id_servicio === candidate.schedule.id_servicio
        ));
        const overlaps = patientAppointments.some((item) => (
          item.dateText === candidate.dateText
          && item.startMinute < candidate.endMinute
          && item.endMinute > candidate.startMinute
        ));
        const isFull = state.consume_cupo !== false
          && (existingOccupancy.get(occupancyKey) || 0) >= candidate.schedule.capacidad;

        if (!sameService && !overlaps && !isFull) selected = { ...candidate, state, occupancyKey };
      }

      if (!selected) throw new Error(`No fue posible asignar un turno a ${patient.correo}.`);
      if (selected.state.consume_cupo !== false) {
        existingOccupancy.set(
          selected.occupancyKey,
          (existingOccupancy.get(selected.occupancyKey) || 0) + 1
        );
      }
      patientAppointments.push(selected);
      appointments.push({ patient, ...selected });
    }
  }

  return appointments;
}

async function main() {
  const patients = buildPatients();
  const [role, schedules, statesList, closedDays, existingTurns] = await Promise.all([
    prisma.rol.findUnique({ where: { nombre: 'PACIENTE' } }),
    prisma.horario_servicio.findMany({
      where: { activo: true, servicio: { activo: true } },
      include: { servicio: true }
    }),
    prisma.estado_turno.findMany(),
    prisma.dia_no_laborable.findMany({
      where: {
        activo: true,
        fecha: {
          gte: new Date(`${START_DATE}T00:00:00.000Z`),
          lte: new Date(`${END_DATE}T00:00:00.000Z`)
        }
      }
    }),
    prisma.turno.findMany({
      where: {
        codigo_turno: { not: { startsWith: DEMO_CODE_PREFIX } },
        fecha_turno: {
          gte: new Date(`${START_DATE}T00:00:00.000Z`),
          lte: new Date(`${END_DATE}T00:00:00.000Z`)
        },
        estado_turno: { consume_cupo: true }
      },
      select: { id_horario: true, fecha_turno: true, hora_inicio: true }
    })
  ]);

  if (!role || schedules.length === 0) {
    throw new Error('Ejecuta primero npm run seed para crear roles, servicios y horarios.');
  }

  const states = new Map(statesList.map((state) => [state.codigo, state]));
  for (const code of ['PENDIENTE', 'CONFIRMADO', 'CANCELADO']) {
    if (!states.has(code)) throw new Error(`No existe el estado ${code}.`);
  }

  const closedDates = new Set(closedDays.map((day) => day.fecha.toISOString().slice(0, 10)));
  const slots = buildSlots(schedules, closedDates);
  if (slots.length === 0) throw new Error('No existen horarios disponibles dentro del rango solicitado.');

  const occupancy = new Map();
  for (const turn of existingTurns) {
    const key = `${turn.id_horario}|${turn.fecha_turno.toISOString().slice(0, 10)}|${minutesFromTime(turn.hora_inicio)}`;
    occupancy.set(key, (occupancy.get(key) || 0) + 1);
  }

  const appointments = selectAppointments(patients, slots, states, occupancy);
  const passwordHash = await crearPasswordHash(DEMO_PASSWORD);

  await prisma.$transaction(async (tx) => {
    const previousTurns = await tx.turno.findMany({
      where: { codigo_turno: { startsWith: DEMO_CODE_PREFIX } },
      select: { id_turno: true }
    });
    const previousIds = previousTurns.map((turn) => turn.id_turno);
    if (previousIds.length) {
      await tx.auditoria.deleteMany({
        where: { entidad: 'turno', id_registro: { in: previousIds } }
      });
      await tx.turno.deleteMany({ where: { id_turno: { in: previousIds } } });
    }

    const patientMap = new Map();
    const userMap = new Map();
    for (const data of patients) {
      const { legacyIdentification, ...patientData } = data;
      const existingPatient = await tx.paciente.findFirst({
        where: {
          OR: [
            { identificacion: patientData.identificacion },
            { identificacion: legacyIdentification }
          ]
        }
      });
      const patient = existingPatient
        ? await tx.paciente.update({
          where: { id_paciente: existingPatient.id_paciente },
          data: patientData
        })
        : await tx.paciente.create({ data: patientData });
      const user = await tx.usuario.upsert({
        where: { correo: data.correo },
        update: {
          id_paciente: patient.id_paciente,
          identificacion: patient.identificacion,
          nombres: patient.nombres,
          apellidos: patient.apellidos,
          nombre_usuario: data.correo,
          password_hash: passwordHash,
          activo: true
        },
        create: {
          id_paciente: patient.id_paciente,
          identificacion: patient.identificacion,
          nombres: patient.nombres,
          apellidos: patient.apellidos,
          nombre_usuario: data.correo,
          correo: data.correo,
          password_hash: passwordHash,
          activo: true
        }
      });
      await tx.usuario_rol.upsert({
        where: {
          id_usuario_id_rol: { id_usuario: user.id_usuario, id_rol: role.id_rol }
        },
        update: { activo: true },
        create: { id_usuario: user.id_usuario, id_rol: role.id_rol, activo: true }
      });
      patientMap.set(patientData.identificacion, patient);
      userMap.set(patientData.identificacion, user);
    }

    const turnsData = appointments.map((appointment, index) => {
      const patient = patientMap.get(appointment.patient.identificacion);
      const user = userMap.get(appointment.patient.identificacion);
      return {
        codigo_turno: `${DEMO_CODE_PREFIX}${appointment.dateText.replaceAll('-', '')}-${String(index + 1).padStart(3, '0')}`,
        id_paciente: patient.id_paciente,
        id_servicio: appointment.schedule.id_servicio,
        id_horario: appointment.schedule.id_horario,
        id_estado: appointment.state.id_estado,
        id_usuario_creador: user.id_usuario,
        fecha_turno: appointment.date,
        hora_inicio: timeFromMinutes(appointment.startMinute),
        hora_fin: timeFromMinutes(appointment.endMinute),
        observacion: randomItem(OBSERVATIONS)
      };
    });

    await tx.turno.createMany({ data: turnsData });
    const createdTurns = await tx.turno.findMany({
      where: { codigo_turno: { in: turnsData.map((turn) => turn.codigo_turno) } },
      include: { servicio: true }
    });
    const turnByCode = new Map(createdTurns.map((turn) => [turn.codigo_turno, turn]));

    await tx.historial_turno.createMany({
      data: turnsData.map((data) => {
        const turn = turnByCode.get(data.codigo_turno);
        return {
          id_turno: turn.id_turno,
          id_usuario: data.id_usuario_creador,
          id_estado_nuevo: data.id_estado,
          fecha_nueva: data.fecha_turno,
          hora_nueva: data.hora_inicio,
          accion: 'CREACION',
          motivo: 'Turno generado como dato de demostracion'
        };
      })
    });

    await tx.auditoria.createMany({
      data: turnsData.map((data) => {
        const turn = turnByCode.get(data.codigo_turno);
        return {
          id_usuario: data.id_usuario_creador,
          accion: 'CREAR',
          entidad: 'turno',
          id_registro: turn.id_turno,
          detalle: `[DEMO] Turno ${data.codigo_turno} para ${turn.servicio?.nombre || 'servicio'}`,
          direccion_ip: 'seed:patients'
        };
      })
    });
  }, { maxWait: 10000, timeout: 120000 });

  const domainCounts = patients.reduce((counts, patient) => {
    const domain = patient.correo.split('@')[1];
    counts[domain] = (counts[domain] || 0) + 1;
    return counts;
  }, {});
  console.log('Carga de demostracion completada.');
  console.log(`Pacientes: ${patients.length} (30 hombres, 20 mujeres)`);
  console.log(`Turnos: ${appointments.length} entre ${START_DATE} y ${END_DATE}`);
  console.log(`Dominios: ${JSON.stringify(domainCounts)}`);
  console.log(`Clave comun de pacientes: ${DEMO_PASSWORD}`);
}

main()
  .catch((error) => {
    console.error('No fue posible generar los pacientes de demostracion:', error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
