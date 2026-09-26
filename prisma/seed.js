const prisma = require('../config/prisma');

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
    { codigo: 'ACCEDER_CONSOLA', nombre: 'Acceso Consola', descripcion: 'Permite acceder al panel administrativo' }
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
    RECEPCIONISTA: ['VER_TURNOS', 'CREAR_TURNO', 'VER_PERFIL', 'EDITAR_PERFIL'],
    TECNICO: ['VER_TURNOS', 'VER_PERFIL'],
    ADMINISTRADOR: ['ACCEDER_CONSOLA', 'VER_TURNOS', 'CREAR_TURNO', 'VER_PERFIL', 'EDITAR_PERFIL']
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

  // 4. Asignar rol PACIENTE a usuarios existentes que no tengan rol
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

    // 5. Crear usuario de prueba paciente@uees.edu.ec si no existe
    const crypto = require('crypto');
    const { promisify } = require('util');
    const scrypt = promisify(crypto.scrypt);
    const salt = crypto.randomBytes(16).toString('hex');
    const hash = await scrypt('password123', salt, 64);
    const passwordHash = `scrypt$${salt}$${hash.toString('hex')}`;

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

  console.log('--- Seed completado exitosamente ---');
}

seed()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
