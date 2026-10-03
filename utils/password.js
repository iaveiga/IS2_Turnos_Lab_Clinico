const crypto = require('crypto');
const { promisify } = require('util');

const scrypt = promisify(crypto.scrypt);

async function crearPasswordHash(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = await scrypt(password, salt, 64);
  return `scrypt$${salt}$${hash.toString('hex')}`;
}

async function verificarPassword(password, passwordHash) {
  if (!password || !passwordHash) return false;

  try {
    if (!passwordHash.startsWith('scrypt$')) return password === passwordHash;

    const parts = passwordHash.split('$');
    if (parts.length !== 3) return false;

    const [, salt, originalHashHex] = parts;
    const computedHash = await scrypt(password, salt, 64);
    const originalBuffer = Buffer.from(originalHashHex, 'hex');
    if (originalBuffer.length !== computedHash.length) return false;
    return crypto.timingSafeEqual(originalBuffer, computedHash);
  } catch (error) {
    console.error('Error al verificar hash de contraseña:', error);
    return false;
  }
}

module.exports = { crearPasswordHash, verificarPassword };
