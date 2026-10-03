(() => {
  const createModalElement = document.querySelector('#create-service-modal');
  const editModalElement = document.querySelector('#edit-service-modal');
  const editForm = document.querySelector('#edit-service-form');
  const Modal = window.tabler?.Modal;

  document.querySelectorAll('[data-edit-service]').forEach((button) => {
    button.addEventListener('click', () => {
      editForm.action = '/admin/servicios/' + encodeURIComponent(button.dataset.id) + '/editar';
      editForm.elements.nombre.value = button.dataset.name;
      editForm.elements.descripcion.value = button.dataset.description;
      Modal?.getOrCreateInstance(editModalElement).show();
    });
  });

  document.querySelectorAll('.alert-dismissible').forEach((alert) => {
    alert.addEventListener('closed.bs.alert', () => {
      window.history.replaceState({}, '', '/admin/servicios');
    });
  });

  if (createModalElement?.dataset.autoOpen === 'true') {
    Modal?.getOrCreateInstance(createModalElement).show();
  }
})();
