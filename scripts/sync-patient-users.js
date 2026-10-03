const prisma = require('../config/prisma');

async function syncPatientUsers() {
  const linkedUsers = await prisma.usuario.findMany({
    where: { id_paciente: { not: null } },
    include: { paciente: true }
  });
  const outdatedUsers = linkedUsers.filter((user) => (
    user.paciente
    && (
      user.identificacion !== user.paciente.identificacion
      || user.nombres !== user.paciente.nombres
      || user.apellidos !== user.paciente.apellidos
    )
  ));

  if (!outdatedUsers.length) {
    console.log('Los usuarios vinculados ya están sincronizados con sus pacientes.');
    return;
  }

  const administrator = await prisma.usuario.findFirst({
    where: {
      usuario_rol: {
        some: { activo: true, rol: { nombre: 'ADMINISTRADOR', activo: true } }
      }
    },
    orderBy: { id_usuario: 'asc' }
  });

  await prisma.$transaction([
    ...outdatedUsers.map((user) => prisma.usuario.update({
      where: { id_usuario: user.id_usuario },
      data: {
        identificacion: user.paciente.identificacion,
        nombres: user.paciente.nombres,
        apellidos: user.paciente.apellidos
      }
    })),
    prisma.auditoria.create({
      data: {
        id_usuario: administrator?.id_usuario || null,
        accion: 'SINCRONIZAR_DATOS_PACIENTE',
        entidad: 'usuario',
        detalle: `${outdatedUsers.length} usuarios vinculados actualizados con identificación, nombres y apellidos del paciente`,
        direccion_ip: 'script-local'
      }
    })
  ]);

  console.log(`Usuarios sincronizados: ${outdatedUsers.length}`);
}

syncPatientUsers()
  .catch((error) => {
    console.error('No se pudieron sincronizar los usuarios:', error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
