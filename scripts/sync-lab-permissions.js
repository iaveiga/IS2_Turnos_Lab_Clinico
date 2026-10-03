const prisma = require('../config/prisma');

const PERMISSIONS = [
  ['ACCEDER_LABORATORIO', 'Acceso Laboratorio', 'Permite acceder al módulo operativo del laboratorio'],
  ['TOMAR_TURNOS', 'Tomar Turnos', 'Permite iniciar la atención de turnos confirmados'],
  ['REGISTRAR_RESULTADOS', 'Registrar Resultados', 'Permite guardar resultados de exámenes en borrador'],
  ['PUBLICAR_RESULTADOS', 'Publicar Resultados', 'Permite publicar resultados y finalizar atenciones']
];

async function syncLabPermissions() {
  const roles = await prisma.rol.findMany({
    where: { nombre: { in: ['TECNICO', 'ADMINISTRADOR'] } }
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

  console.log(`Permisos de laboratorio asignados a: ${roles.map((role) => role.nombre).join(', ')}`);
}

syncLabPermissions()
  .catch((error) => {
    console.error('No se pudieron sincronizar los permisos de laboratorio:', error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
