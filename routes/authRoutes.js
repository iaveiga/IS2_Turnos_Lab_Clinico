const express = require('express');
const prisma = require('../config/prisma');
const { evitarCachePrivada } = require('../middlewares/authMiddleware');
const { crearPasswordHash, verificarPassword } = require('../utils/password');
const { validarCedulaEcuatoriana, validarCorreoElectronico } = require('../utils/validation');

const router = express.Router();
const opcionesSexo = ['FEMENINO', 'MASCULINO', 'OTRO', 'PREFIERO_NO_DECIR'];

router.use(evitarCachePrivada);

function renovarSesion(req) {
  return new Promise((resolve, reject) => {
    req.session.regenerate((error) => (error ? reject(error) : resolve()));
  });
}

function guardarSesion(req) {
  return new Promise((resolve, reject) => {
    req.session.save((error) => (error ? reject(error) : resolve()));
  });
}

function datosFormulario(body = {}) {
  return {
    nombres: body.nombres?.trim() || '',
    apellidos: body.apellidos?.trim() || '',
    identificacion: body.identificacion?.trim() || '',
    edad: body.edad?.trim() || '',
    sexo: body.sexo || '',
    telefono: body.telefono?.trim() || '',
    correo: body.correo?.trim().toLowerCase() || ''
  };
}

function validarRegistro(datos, password) {
  const errores = {};

  if (datos.nombres.length < 2) errores.nombres = 'Ingresa tus nombres.';
  if (datos.apellidos.length < 2) errores.apellidos = 'Ingresa tus apellidos.';
  if (!validarCedulaEcuatoriana(datos.identificacion)) {
    errores.identificacion = 'Ingresa una cédula ecuatoriana válida.';
  }
  if (!/^\d+$/.test(datos.edad) || Number(datos.edad) < 1 || Number(datos.edad) > 120) errores.edad = 'Ingresa una edad valida.';
  if (!opcionesSexo.includes(datos.sexo)) errores.sexo = 'Selecciona una opcion.';
  if (!/^[0-9]{7,20}$/.test(datos.telefono)) errores.telefono = 'Ingresa un teléfono válido usando solo números.';
  if (!validarCorreoElectronico(datos.correo)) errores.correo = 'Ingresa un correo electrónico válido.';
  if (!password || password.length < 8) errores.password = 'Usa al menos 8 caracteres.';

  return errores;
}

router.get('/login', (req, res) => {
  if (req.session?.userId) {
    return res.redirect('/');
  }
  res.render('auth/login', {
    error: null,
    identificador: req.query.identificador || '',
    registrado: req.query.creado === '1' || req.query.registrado === '1',
    salida: req.query.salida === '1'
  });
});

router.post('/login', async (req, res) => {
  const identificador = (req.body.identificador || req.body.correo || req.body.cedula || '').trim().toLowerCase();
  const password = req.body.password || '';

  if (!identificador || !password) {
    return res.status(400).render('auth/login', {
      error: 'Por favor ingresa tu correo o cédula de paciente y tu contraseña.',
      identificador,
      registrado: false,
      salida: false
    });
  }

  try {
    // El personal ingresa por correo; los pacientes también pueden usar su cédula.
    const usuario = await prisma.usuario.findFirst({
      where: {
        OR: [
          { correo: { equals: identificador, mode: 'insensitive' } },
          {
            AND: [
              { paciente: { identificacion: identificador } },
              { usuario_rol: { some: { activo: true, rol: { nombre: 'PACIENTE', activo: true } } } }
            ]
          }
        ]
      },
      include: {
        paciente: true,
        usuario_rol: {
          include: {
            rol: {
              include: {
                rol_permiso: {
                  include: { permiso: true }
                }
              }
            }
          }
        }
      }
    });

    if (!usuario) {
      return res.status(401).render('auth/login', {
        error: 'Credenciales inválidas. Verifica tus datos o crea una cuenta.',
        identificador,
        registrado: false,
        salida: false
      });
    }

    if (!usuario.activo) {
      return res.status(403).render('auth/login', {
        error: 'Tu usuario se encuentra inactivo. Comunícate con el laboratorio.',
        identificador,
        registrado: false,
        salida: false
      });
    }

    const roles = (usuario.usuario_rol || [])
      .filter((asignacion) => asignacion.activo && asignacion.rol.activo)
      .map((asignacion) => asignacion.rol.nombre);
    const permisos = [...new Set((usuario.usuario_rol || [])
      .filter((asignacion) => asignacion.activo && asignacion.rol.activo)
      .flatMap((asignacion) => asignacion.rol.rol_permiso.map((relacion) => relacion.permiso.codigo)))];
    const esPaciente = roles.includes('PACIENTE');
    const esPersonal = roles.some((rol) => ['ADMINISTRADOR', 'TECNICO', 'RECEPCIONISTA'].includes(rol));
    const accesoPermitido = esPaciente && !esPersonal
      ? usuario.correo.toLowerCase() === identificador
        || usuario.paciente?.identificacion === identificador
      : usuario.correo.toLowerCase() === identificador;

    if (!accesoPermitido) {
      return res.status(401).render('auth/login', {
        error: esPersonal
          ? 'El personal del laboratorio debe ingresar con su correo electrónico.'
          : 'Credenciales inválidas para el tipo de usuario.',
        identificador,
        registrado: false,
        salida: false
      });
    }

    const passwordValida = await verificarPassword(password, usuario.password_hash);
    if (!passwordValida) {
      return res.status(401).render('auth/login', {
        error: 'Credenciales inválidas. Verifica tu contraseña.',
        identificador,
        registrado: false,
        salida: false
      });
    }

    // Actualizar fecha de último acceso en segundo plano
    prisma.usuario.update({
      where: { id_usuario: usuario.id_usuario },
      data: { ultimo_acceso: new Date() }
    }).catch(err => console.warn('Aviso: no se pudo actualizar último acceso:', err.message));

    const rolPrincipal = roles.includes('ADMINISTRADOR') ? 'ADMINISTRADOR' : roles[0] || 'PACIENTE';
    const nombreCompleto = usuario.paciente
      ? `${usuario.paciente.nombres} ${usuario.paciente.apellidos}`
      : [usuario.nombres, usuario.apellidos].filter(Boolean).join(' ') || usuario.nombre_usuario;

    // Evita reutilizar el identificador de una sesión previa al autenticar.
    await renovarSesion(req);
    req.session.userId = usuario.id_usuario;
    req.session.user = {
      id: usuario.id_usuario,
      correo: usuario.correo,
      nombre: nombreCompleto,
      rol: rolPrincipal,
      roles: roles,
      permisos,
      identificacion: usuario.identificacion,
      id_paciente: usuario.id_paciente
    };
    await guardarSesion(req);

    // Redirigir según el rol
    if (permisos.includes('ACCEDER_CONSOLA')) {
      return res.redirect('/admin');
    }
    if (permisos.includes('ACCEDER_RECEPCION')) {
      return res.redirect('/recepcion');
    }
    if (permisos.includes('ACCEDER_LABORATORIO')) {
      return res.redirect('/laboratorio');
    }
    return res.redirect('/turnos');

  } catch (error) {
    console.error('Error durante el inicio de sesión:', error);
    return res.status(500).render('auth/login', {
      error: 'Ocurrió un error en el servidor al intentar iniciar sesión. Intenta nuevamente.',
      identificador,
      registrado: false,
      salida: false
    });
  }
});

router.get('/registro', (req, res) => {
  res.render('auth/registro', {
    datos: datosFormulario(),
    errores: {},
    creado: req.query.creado === '1'
  });
});

router.post('/registro', async (req, res) => {
  const datos = datosFormulario(req.body);
  const errores = validarRegistro(datos, req.body.password);

  if (Object.keys(errores).length > 0) {
    return res.status(422).render('auth/registro', { datos, errores, creado: false });
  }

  try {
    const passwordHash = await crearPasswordHash(req.body.password);

    await prisma.$transaction(async (tx) => {
      const paciente = await tx.paciente.create({
        data: {
          identificacion: datos.identificacion,
          nombres: datos.nombres,
          apellidos: datos.apellidos,
          edad: Number(datos.edad),
          sexo: datos.sexo,
          telefono: datos.telefono,
          correo: datos.correo
        }
      });

      const usuario = await tx.usuario.create({
        data: {
          id_paciente: paciente.id_paciente,
          identificacion: paciente.identificacion,
          nombres: paciente.nombres,
          apellidos: paciente.apellidos,
          nombre_usuario: datos.correo,
          correo: datos.correo,
          password_hash: passwordHash
        }
      });

      const rolPaciente = await tx.rol.findFirst({
        where: { nombre: { equals: 'PACIENTE', mode: 'insensitive' }, activo: true }
      });

      if (rolPaciente) {
        await tx.usuario_rol.create({
          data: { id_usuario: usuario.id_usuario, id_rol: rolPaciente.id_rol }
        });
      }
    });

    return res.redirect('/auth/registro?creado=1');
  } catch (error) {
    if (error.code === 'P2002') {
      const campo = error.meta?.target?.includes('identificacion') ? 'identificacion' : 'correo';
      errores[campo] = campo === 'identificacion'
        ? 'Ya existe un paciente con esta cedula.'
        : 'Ya existe una cuenta con este correo.';
      return res.status(409).render('auth/registro', { datos, errores, creado: false });
    }

    console.error('Error al registrar paciente:', error);
    errores.general = 'No pudimos crear la cuenta. Intenta nuevamente.';
    return res.status(500).render('auth/registro', { datos, errores, creado: false });
  }
});

router.get('/logout', (req, res, next) => {
  const finalizar = () => {
    res.clearCookie('connect.sid', { path: '/' });
    return res.redirect('/auth/login?salida=1');
  };

  if (!req.session) return finalizar();

  return req.session.destroy((error) => {
    if (error) return next(error);
    return finalizar();
  });
});

module.exports = router;
