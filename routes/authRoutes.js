const express = require('express');
const crypto = require('crypto');
const { promisify } = require('util');
const prisma = require('../config/prisma');

const router = express.Router();
const scrypt = promisify(crypto.scrypt);
const opcionesSexo = ['FEMENINO', 'MASCULINO', 'OTRO', 'PREFIERO_NO_DECIR'];

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
  if (!/^\d{10}$/.test(datos.identificacion)) errores.identificacion = 'La cedula debe tener 10 digitos.';
  if (!/^\d+$/.test(datos.edad) || Number(datos.edad) < 1 || Number(datos.edad) > 120) errores.edad = 'Ingresa una edad valida.';
  if (!opcionesSexo.includes(datos.sexo)) errores.sexo = 'Selecciona una opcion.';
  if (!/^[\d\s()+-]{7,20}$/.test(datos.telefono)) errores.telefono = 'Ingresa un telefono valido.';
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(datos.correo)) errores.correo = 'Ingresa un correo valido.';
  if (!password || password.length < 8) errores.password = 'Usa al menos 8 caracteres.';

  return errores;
}

async function crearPasswordHash(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = await scrypt(password, salt, 64);
  return `scrypt$${salt}$${hash.toString('hex')}`;
}

async function verificarPassword(password, passwordHash) {
  if (!password || !passwordHash) return false;
  try {
    if (passwordHash.startsWith('scrypt$')) {
      const parts = passwordHash.split('$');
      if (parts.length !== 3) return false;
      const [, salt, originalHashHex] = parts;
      const computedHash = await scrypt(password, salt, 64);
      const originalBuffer = Buffer.from(originalHashHex, 'hex');
      if (originalBuffer.length !== computedHash.length) return false;
      return crypto.timingSafeEqual(originalBuffer, computedHash);
    }
    return password === passwordHash;
  } catch (err) {
    console.error('Error al verificar hash de contraseña:', err);
    return false;
  }
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
  const identificador = (req.body.identificador || req.body.correo || req.body.cedula || '').trim();
  const password = req.body.password || '';

  if (!identificador || !password) {
    return res.status(400).render('auth/login', {
      error: 'Por favor ingresa tu correo o cédula y tu contraseña.',
      identificador,
      registrado: false,
      salida: false
    });
  }

  try {
    // Buscar usuario por correo, nombre_usuario o cédula del paciente asociado
    const usuario = await prisma.usuario.findFirst({
      where: {
        OR: [
          { correo: { equals: identificador, mode: 'insensitive' } },
          { nombre_usuario: { equals: identificador, mode: 'insensitive' } },
          { paciente: { identificacion: identificador } }
        ]
      },
      include: {
        paciente: true,
        usuario_rol: {
          include: {
            rol: true
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

    // Obtener roles asociados al usuario
    const roles = (usuario.usuario_rol || []).map(ur => ur.rol.nombre);
    const rolPrincipal = roles[0] || 'PACIENTE';
    const nombreCompleto = usuario.paciente
      ? `${usuario.paciente.nombres} ${usuario.paciente.apellidos}`
      : usuario.nombre_usuario;

    // Guardar sesión
    req.session.userId = usuario.id_usuario;
    req.session.user = {
      id: usuario.id_usuario,
      correo: usuario.correo,
      nombre: nombreCompleto,
      rol: rolPrincipal,
      roles: roles,
      id_paciente: usuario.id_paciente
    };

    // Redirigir según el rol
    if (roles.includes('ADMINISTRADOR')) {
      return res.redirect('/admin/console');
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

router.get('/logout', (req, res) => {
  if (!req.session) return res.redirect('/auth/login');
  req.session.destroy(() => res.redirect('/auth/login?salida=1'));
});

module.exports = router;
