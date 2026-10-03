const prisma = require('../config/prisma');

const PERMISSIONS = [
  ['ACCEDER_RECEPCION', 'Acceso Recepción', 'Permite acceder al módulo operativo de recepción'],
  ['REGISTRAR_LLEGADA', 'Registrar Llegada', 'Permite registrar la llegada de pacientes agendados'],
  ['REGISTRAR_PACIENTES', 'Registrar Pacientes', 'Permite crear fichas de nuevos pacientes'],
  ['VER_RESULTADOS', 'Ver Resultados', 'Permite consultar resultados de exámenes publicados']
];

async function syncReceptionPermissions() {
  const roles = await prisma.rol.findMany({
    where: { nombre: { in: ['RECEPCIONISTA', 'ADMINISTRADOR'] } }
  });

  for (const [codigo, nombre, descripcion] of PERMISSIONS) {
    const permiso = await prisma.permiso.upsert({
      where: { codigo },
      update: { nombre, descripcion },
      create: { codigo, nombre, descripcion }
    });

    for (const rol of roles) {
      await prisma.rol_permiso.upsert({
        where: {
          id_rol_id_permiso: {
            id_rol: rol.id_rol,
            id_permiso: permiso.id_permiso
          }
        },
        update: {},
        create: { id_rol: rol.id_rol, id_permiso: permiso.id_permiso }
      });
    }
  }

  console.log(`Permisos de recepción asignados a: ${roles.map((rol) => rol.nombre).join(', ')}`);
}

syncReceptionPermissions()
  .catch((error) => {
    console.error('No se pudieron sincronizar los permisos de recepción:', error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
