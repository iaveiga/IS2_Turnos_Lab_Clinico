(() => {
  document.querySelectorAll('[data-digits-only]').forEach((input) => {
    const sanitize = () => {
      const maximum = Number(input.maxLength) > 0 ? Number(input.maxLength) : Infinity;
      const sanitized = input.value.replace(/[^0-9]/g, '').slice(0, maximum);
      if (sanitized !== input.value) input.value = sanitized;
    };

    input.addEventListener('beforeinput', (event) => {
      if (event.inputType.startsWith('insert') && event.data && /[^0-9]/.test(event.data)) {
        event.preventDefault();
      }
    });
    input.addEventListener('input', sanitize);
    sanitize();
  });
})();
