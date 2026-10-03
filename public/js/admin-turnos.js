(() => {
  const Modal = window.tabler?.Modal;
  const detailModalElement = document.querySelector('#appointment-detail-modal');
  const statusModalElement = document.querySelector('#appointment-status-modal');
  const statusForm = document.querySelector('#appointment-status-form');
  const statusSelect = document.querySelector('#new-appointment-status');
  const reasonInput = document.querySelector('#status-reason');

  function setDetail(field, value) {
    const element = detailModalElement.querySelector(`[data-detail-field="${field}"]`);
    if (element) element.textContent = value || 'No registrado';
  }

  document.querySelectorAll('[data-view-appointment]').forEach((button) => {
    button.addEventListener('click', () => {
      setDetail('code', button.dataset.code);
      setDetail('date', button.dataset.date);
      setDetail('time', button.dataset.time);
      setDetail('status', button.dataset.status);
      setDetail('created', button.dataset.created);
      setDetail('patient', button.dataset.patient);
      setDetail('identification', button.dataset.identification);
      setDetail('phone', button.dataset.phone);
      setDetail('email', button.dataset.email);
      setDetail('service', button.dataset.service);
      setDetail('serviceDescription', button.dataset.serviceDescription);
      setDetail('notes', button.dataset.notes);
      setDetail('lastReason', button.dataset.lastReason);
      Modal?.getOrCreateInstance(detailModalElement).show();
    });
  });

  function updateReasonRequirement() {
    const code = statusSelect.selectedOptions[0]?.dataset.code;
    const required = ['CANCELADO', 'AUSENTE'].includes(code);
    reasonInput.required = required;
  }

  statusSelect?.addEventListener('change', updateReasonRequirement);

  document.querySelectorAll('[data-change-appointment-status]').forEach((button) => {
    button.addEventListener('click', () => {
      const allowed = button.dataset.transitions.split(',').filter(Boolean);
      statusForm.action = '/admin/turnos/' + encodeURIComponent(button.dataset.id) + '/estado';
      statusForm.reset();

      statusModalElement.querySelector('[data-status-summary="code"]').textContent = button.dataset.code;
      statusModalElement.querySelector('[data-status-summary="patient"]').textContent = button.dataset.patient;
      statusModalElement.querySelector('[data-status-summary="service"]').textContent = button.dataset.service;

      Array.from(statusSelect.options).forEach((option) => {
        if (!option.dataset.code) return;
        const enabled = allowed.includes(option.dataset.code);
        option.hidden = !enabled;
        option.disabled = !enabled;
      });
      const firstAllowed = Array.from(statusSelect.options).find((option) => allowed.includes(option.dataset.code));
      statusSelect.value = firstAllowed?.value || '';
      updateReasonRequirement();
      Modal?.getOrCreateInstance(statusModalElement).show();
    });
  });

  document.querySelectorAll('.alert-dismissible').forEach((alert) => {
    alert.addEventListener('closed.bs.alert', () => {
      window.history.replaceState({}, '', '/admin/turnos');
    });
  });
})();
