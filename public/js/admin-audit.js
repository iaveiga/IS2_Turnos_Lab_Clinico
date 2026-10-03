(() => {
  const Modal = window.tabler?.Modal;
  const detailModal = document.querySelector('#audit-detail-modal');

  function setField(field, value) {
    const element = detailModal.querySelector(`[data-audit-field="${field}"]`);
    if (element) element.textContent = value || 'No registrado';
  }

  document.querySelectorAll('[data-view-audit]').forEach((button) => {
    button.addEventListener('click', () => {
      setField('id', `#${button.dataset.id}`);
      setField('date', button.dataset.date);
      setField('ip', button.dataset.ip);
      setField('action', button.dataset.action);
      setField('entity', button.dataset.entity);
      setField('record', button.dataset.record);
      setField('actor', button.dataset.actor);
      setField('role', button.dataset.role);
      setField('identification', button.dataset.identification);
      setField('email', button.dataset.email);
      setField('detail', button.dataset.detail);
      Modal?.getOrCreateInstance(detailModal).show();
    });
  });
})();
