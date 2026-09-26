const passwordInput = document.querySelector('#password');
const passwordToggle = document.querySelector('.password-toggle');

if (passwordInput && passwordToggle) {
  passwordToggle.addEventListener('click', () => {
    const mostrar = passwordInput.type === 'password';
    passwordInput.type = mostrar ? 'text' : 'password';
    passwordToggle.setAttribute('aria-pressed', String(mostrar));
    passwordToggle.setAttribute('aria-label', mostrar ? 'Ocultar contraseña' : 'Mostrar contraseña');
    passwordToggle.setAttribute('title', mostrar ? 'Ocultar contraseña' : 'Mostrar contraseña');
    passwordInput.focus();
  });
}
