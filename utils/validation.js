function validarCedulaEcuatoriana(value) {
  const cedula = String(value || '').trim();
  if (!/^\d{10}$/.test(cedula)) return false;

  const province = Number(cedula.slice(0, 2));
  const personType = Number(cedula[2]);
  if (province < 1 || province > 24 || personType > 5) return false;

  const coefficients = [2, 1, 2, 1, 2, 1, 2, 1, 2];
  const sum = coefficients.reduce((total, coefficient, index) => {
    const product = Number(cedula[index]) * coefficient;
    return total + (product >= 10 ? product - 9 : product);
  }, 0);
  const verifier = (10 - (sum % 10)) % 10;
  return verifier === Number(cedula[9]);
}

function validarCorreoElectronico(value) {
  const email = String(value || '').trim().toLowerCase();
  if (!email || email.length > 254) return false;

  const parts = email.split('@');
  if (parts.length !== 2) return false;
  const [local, domain] = parts;
  if (!local || local.length > 64 || local.startsWith('.') || local.endsWith('.') || local.includes('..')) {
    return false;
  }
  if (!/^[a-z0-9.!#$%&'*+/=?^_`{|}~-]+$/i.test(local)) return false;

  const labels = domain.split('.');
  if (domain.length > 253 || labels.length < 2 || !/^[a-z]{2,63}$/i.test(labels.at(-1))) return false;
  return labels.every((label) => (
    label.length > 0
    && label.length <= 63
    && /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/i.test(label)
  ));
}

module.exports = { validarCedulaEcuatoriana, validarCorreoElectronico };
