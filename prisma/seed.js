const prisma = require('../config/prisma');
const { crearPasswordHash } = require('../utils/password');

async function seed() {
  console.log('--- Iniciando Seed ---');

  // 1. Roles
  const roles = [
    { nombre: 'PACIENTE', descripcion: 'Paciente que solicita turnos' },
    { nombre: 'RECEPCIONISTA', descripcion: 'Personal administrativo de recepcion' },
    { nombre: 'TECNICO', descripcion: 'Tecnico de toma de muestras y analisis' },
    { nombre: 'ADMINISTRADOR', descripcion: 'Administrador del sistema' }
  ];

  for (const r of roles) {
    await prisma.rol.upsert({
      where: { nombre: r.nombre },
      update: {},
      create: { nombre: r.nombre, descripcion: r.descripcion, activo: true }
    });
  }
  console.log('Roles verificados/creados');

  // 1.1 Permisos
  const permisos = [
    { codigo: 'VER_TURNOS', nombre: 'Ver Turnos', descripcion: 'Permite consultar el listado de turnos' },
    { codigo: 'CREAR_TURNO', nombre: 'Crear Turno', descripcion: 'Permite reservar un nuevo turno' },
    { codigo: 'VER_PERFIL', nombre: 'Ver Perfil', descripcion: 'Permite consultar el perfil' },
    { codigo: 'EDITAR_PERFIL', nombre: 'Editar Perfil', descripcion: 'Permite modificar datos del perfil' },
    { codigo: 'ACCEDER_CONSOLA', nombre: 'Acceso Consola', descripcion: 'Permite acceder al panel administrativo' },
    { codigo: 'GESTIONAR_USUARIOS', nombre: 'Gestionar Usuarios', descripcion: 'Permite crear, modificar, activar y desactivar usuarios' },
    { codigo: 'GESTIONAR_TURNOS', nombre: 'Gestionar Turnos', descripcion: 'Permite administrar y cambiar el estado de los turnos' },
    { codigo: 'GESTIONAR_ROLES_PERMISOS', nombre: 'Gestionar Roles y Permisos', descripcion: 'Permite asignar roles y permisos' },
    { codigo: 'GESTIONAR_SERVICIOS', nombre: 'Gestionar Servicios', descripcion: 'Permite administrar tipos de examen' },
    { codigo: 'GESTIONAR_HORARIOS', nombre: 'Gestionar Horarios', descripcion: 'Permite configurar horarios y capacidad' },
    { codigo: 'GESTIONAR_DIAS_NO_LABORABLES', nombre: 'Gestionar Días no Laborables', descripcion: 'Permite configurar fechas sin atención' },
    { codigo: 'GESTIONAR_PARAMETROS', nombre: 'Gestionar Parámetros', descripcion: 'Permite configurar parámetros generales' },
    { codigo: 'VER_REPORTES', nombre: 'Ver Reportes', descripcion: 'Permite consultar reportes administrativos' },
    { codigo: 'VER_AUDITORIA', nombre: 'Ver Auditoría', descripcion: 'Permite consultar registros de auditoría' },
    { codigo: 'ACCEDER_RECEPCION', nombre: 'Acceso Recepción', descripcion: 'Permite acceder al módulo operativo de recepción' },
    { codigo: 'REGISTRAR_LLEGADA', nombre: 'Registrar Llegada', descripcion: 'Permite registrar la llegada de pacientes agendados' },
    { codigo: 'REGISTRAR_PACIENTES', nombre: 'Registrar Pacientes', descripcion: 'Permite crear fichas de nuevos pacientes' },
    { codigo: 'VER_RESULTADOS', nombre: 'Ver Resultados', descripcion: 'Permite consultar resultados de exámenes publicados' }
  ];

  for (const p of permisos) {
    await prisma.permiso.upsert({
      where: { codigo: p.codigo },
      update: {},
      create: { codigo: p.codigo, nombre: p.nombre, descripcion: p.descripcion }
    });
  }
  console.log('Permisos verificados/creados');

  // 1.2 Asignar permisos a roles
  const rolesEnDb = await prisma.rol.findMany();
  const permisosEnDb = await prisma.permiso.findMany();
  const permMap = Object.fromEntries(permisosEnDb.map(p => [p.codigo, p.id_permiso]));

  const matrizRolPermiso = {
    PACIENTE: ['VER_TURNOS', 'CREAR_TURNO', 'VER_PERFIL', 'EDITAR_PERFIL'],
    RECEPCIONISTA: [
      'ACCEDER_RECEPCION',
      'REGISTRAR_LLEGADA',
      'REGISTRAR_PACIENTES',
      'VER_RESULTADOS',
      'VER_TURNOS',
      'CREAR_TURNO',
      'VER_PERFIL',
      'EDITAR_PERFIL'
    ],
    TECNICO: ['VER_TURNOS', 'VER_PERFIL'],
    ADMINISTRADOR: [
      'ACCEDER_CONSOLA',
      'VER_TURNOS',
      'CREAR_TURNO',
      'VER_PERFIL',
      'EDITAR_PERFIL',
      'GESTIONAR_USUARIOS',
      'GESTIONAR_TURNOS',
      'GESTIONAR_ROLES_PERMISOS',
      'GESTIONAR_SERVICIOS',
      'GESTIONAR_HORARIOS',
      'GESTIONAR_DIAS_NO_LABORABLES',
      'GESTIONAR_PARAMETROS',
      'VER_REPORTES',
      'VER_AUDITORIA',
      'ACCEDER_RECEPCION',
      'REGISTRAR_LLEGADA',
      'REGISTRAR_PACIENTES',
      'VER_RESULTADOS'
    ]
  };

  for (const rol of rolesEnDb) {
    const permList = matrizRolPermiso[rol.nombre] || [];
    for (const codigo of permList) {
      const idPermiso = permMap[codigo];
      if (idPermiso) {
        await prisma.rol_permiso.upsert({
          where: { id_rol_id_permiso: { id_rol: rol.id_rol, id_permiso: idPermiso } },
          update: {},
          create: { id_rol: rol.id_rol, id_permiso: idPermiso }
        });
      }
    }
  }
  console.log('Asociaciones rol-permiso verificadas');

  // 2. Estados de turno
  const estados = [
    { codigo: 'PENDIENTE', nombre: 'Pendiente', descripcion: 'Turno reservado' },
    { codigo: 'CONFIRMADO', nombre: 'Confirmado', descripcion: 'Paciente en sala de espera' },
    { codigo: 'ATENDIDO', nombre: 'Atendido', descripcion: 'Muestra tomada y atencion realizada' },
    { codigo: 'CANCELADO', nombre: 'Cancelado', descripcion: 'Turno cancelado', consume_cupo: false },
    { codigo: 'AUSENTE', nombre: 'Ausente', descripcion: 'Paciente no se presento', consume_cupo: false }
  ];

  for (const e of estados) {
    await prisma.estado_turno.upsert({
      where: { codigo: e.codigo },
      update: {},
      create: { codigo: e.codigo, nombre: e.nombre, descripcion: e.descripcion, consume_cupo: e.consume_cupo ?? true }
    });
  }
  console.log('Estados de turno verificados/creados');

  // 3. Servicios
  const servicios = [
    { nombre: 'Examenes de sangre y hematologia', descripcion: 'Perfil lipidico, glucosa, hemograma completo y mas.' },
    { nombre: 'VIH e inmunologia', descripcion: 'Serologia, pruebas rapidas e inmunologicas confirmatorias.' },
    { nombre: 'Analisis de orina y coproanalisis', descripcion: 'Examen general de orina, cultivo y analisis coprologico.' },
    { nombre: 'Pruebas de alergias', descripcion: 'Paneles de alergenos ambientales y alimentarios.' }
  ];

  for (const s of servicios) {
    const existe = await prisma.servicio.findFirst({ where: { nombre: s.nombre } });
    if (!existe) {
      await prisma.servicio.create({ data: { nombre: s.nombre, descripcion: s.descripcion, activo: true } });
    }
  }
  console.log('Servicios verificados/creados');

  // 4. Horarios recurrentes para servicios activos
  const diasLaborables = ['LUNES', 'MARTES', 'MIERCOLES', 'JUEVES', 'VIERNES', 'SABADO'];
  const serviciosActivos = await prisma.servicio.findMany({ where: { activo: true } });

  for (const servicio of serviciosActivos) {
    for (const dia of diasLaborables) {
      const horarioExistente = await prisma.horario_servicio.findFirst({
        where: { id_servicio: servicio.id_servicio, dia_semana: dia }
      });

      if (!horarioExistente) {
        const esSabado = dia === 'SABADO';
        await prisma.horario_servicio.create({
          data: {
            id_servicio: servicio.id_servicio,
            dia_semana: dia,
            hora_inicio: new Date(`1970-01-01T${esSabado ? '08:00' : '07:00'}:00.000Z`),
            hora_fin: new Date(`1970-01-01T${esSabado ? '12:00' : '15:00'}:00.000Z`),
            duracion_turno_min: 30,
            capacidad: 3,
            activo: true
          }
        });
      }
    }
  }
  console.log('Horarios de servicios verificados/creados');

  // 5. Asignar rol PACIENTE a usuarios existentes que no tengan rol
  const rolPaciente = await prisma.rol.findFirst({ where: { nombre: 'PACIENTE' } });
  if (rolPaciente) {
    const usuarios = await prisma.usuario.findMany({
      include: { usuario_rol: true }
    });
    for (const u of usuarios) {
      if (u.usuario_rol.length === 0) {
        await prisma.usuario_rol.create({
          data: { id_usuario: u.id_usuario, id_rol: rolPaciente.id_rol }
        });
        console.log('Asignado rol PACIENTE a usuario ' + u.correo);
      }
    }

    // 6. Crear usuario de prueba paciente@uees.edu.ec si no existe
    const passwordHash = await crearPasswordHash('password123');

    let pacienteDemo = await prisma.paciente.findFirst({
      where: { identificacion: '0999999999' }
    });
    if (!pacienteDemo) {
      pacienteDemo = await prisma.paciente.create({
        data: {
          identificacion: '0999999999',
          nombres: 'Diego Ariel',
          apellidos: 'Ortiz Martínez',
          edad: 22,
          sexo: 'MASCULINO',
          telefono: '0991234567',
          correo: 'paciente@uees.edu.ec',
          activo: true
        }
      });
      console.log('Paciente de prueba creado: 0999999999');
    }

    let usuarioDemo = await prisma.usuario.findFirst({
      where: { correo: 'paciente@uees.edu.ec' }
    });
    if (!usuarioDemo) {
      usuarioDemo = await prisma.usuario.create({
        data: {
          id_paciente: pacienteDemo.id_paciente,
          nombre_usuario: 'paciente@uees.edu.ec',
          correo: 'paciente@uees.edu.ec',
          password_hash: passwordHash,
          activo: true
        }
      });
      await prisma.usuario_rol.create({
        data: { id_usuario: usuarioDemo.id_usuario, id_rol: rolPaciente.id_rol }
      });
      console.log('Usuario de prueba creado: paciente@uees.edu.ec / password123');
    }
  }

  // 7. Usuario administrador de prueba
  const rolAdministrador = await prisma.rol.findFirst({ where: { nombre: 'ADMINISTRADOR' } });
  if (rolAdministrador) {
    let usuarioAdministrador = await prisma.usuario.findUnique({
      where: { nombre_usuario: 'administrador' }
    });

    if (!usuarioAdministrador) {
      usuarioAdministrador = await prisma.usuario.create({
        data: {
          identificacion: 'administrador',
          nombres: 'Administrador',
          apellidos: 'Sistema',
          nombre_usuario: 'administrador',
          correo: 'administrador@clinicasanfrancisco.local',
          password_hash: await crearPasswordHash('administrador'),
          activo: true
        }
      });
      console.log('Usuario administrador creado: administrador / administrador');
    }

    await prisma.usuario_rol.upsert({
      where: {
        id_usuario_id_rol: {
          id_usuario: usuarioAdministrador.id_usuario,
          id_rol: rolAdministrador.id_rol
        }
      },
      update: { activo: true },
      create: {
        id_usuario: usuarioAdministrador.id_usuario,
        id_rol: rolAdministrador.id_rol,
        activo: true
      }
    });
  }

  console.log('--- Seed completado exitosamente ---');
}

seed()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
