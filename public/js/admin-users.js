(() => {
  const createModalElement = document.querySelector('#create-user-modal');
  const editModalElement = document.querySelector('#edit-user-modal');
  const editForm = document.querySelector('#edit-user-form');
  const Modal = window.tabler?.Modal;

  document.querySelectorAll('[data-edit-user]').forEach((button) => {
    button.addEventListener('click', () => {
      editForm.action = '/admin/usuarios/' + encodeURIComponent(button.dataset.id) + '/editar';
      editForm.elements.nombres.value = button.dataset.firstName;
      editForm.elements.apellidos.value = button.dataset.lastName;
      editForm.elements.identificacion.value = button.dataset.identification;
      editForm.elements.correo.value = button.dataset.email;
      editForm.elements.id_rol.value = button.dataset.role;
      editForm.elements.password.value = '';
      Modal?.getOrCreateInstance(editModalElement).show();
    });
  });

  document.querySelectorAll('[data-password-toggle]').forEach((button) => {
    button.addEventListener('click', () => {
      const input = button.parentElement.querySelector('input');
      const show = input.type === 'password';
      input.type = show ? 'text' : 'password';
      button.setAttribute('aria-label', show ? 'Ocultar clave' : 'Mostrar clave');
      button.innerHTML = show
        ? '<i data-lucide="eye-off"></i>'
        : '<i data-lucide="eye"></i>';
      window.lucide?.createIcons();
    });
  });

  document.querySelectorAll('.alert-dismissible').forEach((alert) => {
    alert.addEventListener('closed.bs.alert', () => {
      window.history.replaceState({}, '', '/admin/usuarios');
    });
  });

  if (createModalElement?.dataset.autoOpen === 'true') {
    Modal?.getOrCreateInstance(createModalElement).show();
  }
})();
