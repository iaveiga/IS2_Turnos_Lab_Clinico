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

router.get('/login', (req, res) => {
  res.render('auth/login');
});

router.post('/login', async (req, res) => {
  res.status(501).send('Inicio de sesion pendiente de implementar');
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
  if (!req.session) return res.redirect('/');
  req.session.destroy(() => res.redirect('/'));
});

module.exports = router;
