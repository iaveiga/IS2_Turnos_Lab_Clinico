(() => {
  const Modal = window.tabler?.Modal;
  const createScheduleModal = document.querySelector('#create-schedule-modal');
  const editScheduleModal = document.querySelector('#edit-schedule-modal');
  const createClosedDayModal = document.querySelector('#create-closed-day-modal');
  const editForm = document.querySelector('#edit-schedule-form');

  document.querySelectorAll('[data-edit-schedule]').forEach((button) => {
    button.addEventListener('click', () => {
      const selectedDays = new Set(button.dataset.days.split(','));
      editForm.querySelector('#edit-schedule-service').value = button.dataset.service;
      editForm.querySelector('#edit-schedule-service-value').value = button.dataset.service;
      editForm.querySelector('#edit-schedule-ids').value = button.dataset.ids;
      editForm.querySelectorAll('[name="dias_semana"]').forEach((checkbox) => {
        checkbox.checked = selectedDays.has(checkbox.value);
      });
      editForm.elements.hora_inicio.value = button.dataset.start;
      editForm.elements.hora_fin.value = button.dataset.end;
      editForm.elements.duracion_turno_min.value = button.dataset.duration;
      editForm.elements.capacidad.value = button.dataset.capacity;
      editForm.querySelector('#edit-schedule-active').checked = button.dataset.active === 'true';
      Modal?.getOrCreateInstance(editScheduleModal).show();
    });
  });

  document.querySelectorAll('#create-schedule-modal form, #edit-schedule-modal form').forEach((form) => {
    const checkboxes = [...form.querySelectorAll('[name="dias_semana"]')];
    const validateDays = () => {
      const hasSelection = checkboxes.some((checkbox) => checkbox.checked);
      checkboxes[0]?.setCustomValidity(hasSelection ? '' : 'Selecciona al menos un día de atención.');
      return hasSelection;
    };
    checkboxes.forEach((checkbox) => checkbox.addEventListener('change', validateDays));
    form.addEventListener('submit', (event) => {
      if (!validateDays()) {
        event.preventDefault();
        checkboxes[0]?.reportValidity();
      }
    });
  });

  document.querySelectorAll('.alert-dismissible').forEach((alert) => {
    alert.addEventListener('closed.bs.alert', () => {
      const url = new URL(window.location.href);
      url.searchParams.delete('ok');
      url.searchParams.delete('error');
      window.history.replaceState({}, '', url.pathname + url.search);
    });
  });

  if (createScheduleModal?.dataset.autoOpen === 'true') {
    Modal?.getOrCreateInstance(createScheduleModal).show();
  }
  if (createClosedDayModal?.dataset.autoOpen === 'true') {
    Modal?.getOrCreateInstance(createClosedDayModal).show();
  }
})();
