(() => {
  function isValidEcuadorianId(value) {
    if (!/^\d{10}$/.test(value)) return false;
    const province = Number(value.slice(0, 2));
    const personType = Number(value[2]);
    if (province < 1 || province > 24 || personType > 5) return false;
    const coefficients = [2, 1, 2, 1, 2, 1, 2, 1, 2];
    const sum = coefficients.reduce((total, coefficient, index) => {
      const product = Number(value[index]) * coefficient;
      return total + (product >= 10 ? product - 9 : product);
    }, 0);
    return (10 - (sum % 10)) % 10 === Number(value[9]);
  }

  function isValidEmail(value) {
    const email = value.trim().toLowerCase();
    if (!email || email.length > 254) return false;
    const parts = email.split('@');
    if (parts.length !== 2) return false;
    const [local, domain] = parts;
    if (!local || local.length > 64 || local.startsWith('.') || local.endsWith('.') || local.includes('..')) return false;
    if (!/^[a-z0-9.!#$%&'*+/=?^_`{|}~-]+$/i.test(local)) return false;
    const labels = domain.split('.');
    return domain.length <= 253
      && labels.length >= 2
      && /^[a-z]{2,63}$/i.test(labels.at(-1))
      && labels.every((label) => label.length > 0
        && label.length <= 63
        && /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/i.test(label));
  }

  const registrationForm = document.querySelector('form[action="/auth/registro"]');
  if (registrationForm) {
    const identification = registrationForm.elements.identificacion;
    const email = registrationForm.elements.correo;
    const validateIdentification = () => {
      identification.setCustomValidity(
        !identification.value || isValidEcuadorianId(identification.value.trim())
          ? ''
          : 'Ingresa una cédula ecuatoriana válida.'
      );
    };
    const validateEmail = () => {
      email.setCustomValidity(
        !email.value || isValidEmail(email.value)
          ? ''
          : 'Ingresa un correo electrónico válido.'
      );
    };

    identification.addEventListener('input', validateIdentification);
    email.addEventListener('input', validateEmail);
    registrationForm.addEventListener('submit', (event) => {
      validateIdentification();
      validateEmail();
      if (!registrationForm.checkValidity()) {
        event.preventDefault();
        registrationForm.reportValidity();
      }
    });
  }

  document.querySelectorAll('[data-password-toggle]').forEach((button) => {
    button.addEventListener('click', () => {
      const input = button.parentElement.querySelector('input');
      if (!input) return;

      const show = input.type === 'password';
      input.type = show ? 'text' : 'password';
      button.setAttribute('aria-label', show ? 'Ocultar contraseña' : 'Mostrar contraseña');
      button.setAttribute('title', show ? 'Ocultar contraseña' : 'Mostrar contraseña');
      button.innerHTML = show ? '<i data-lucide="eye-off"></i>' : '<i data-lucide="eye"></i>';
      window.lucide?.createIcons();
      input.focus();
    });
  });
})();
