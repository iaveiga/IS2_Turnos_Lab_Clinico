(() => {
  const roleSelector = document.querySelector('[data-role-selector]');
  const form = document.querySelector('[data-permissions-form]');
  const createModal = document.querySelector('#create-role-modal');

  roleSelector?.addEventListener('change', () => {
    window.location.assign(`/admin/roles?rol=${encodeURIComponent(roleSelector.value)}`);
  });

  if (createModal?.dataset.autoOpen === 'true') {
    window.tabler?.Modal.getOrCreateInstance(createModal).show();
  }
  if (!form) return;

  const lists = {
    available: form.querySelector('[data-permission-list="available"]'),
    enabled: form.querySelector('[data-permission-list="enabled"]')
  };

  function items(side) {
    return [...lists[side].querySelectorAll('[data-permission-item]')];
  }

  function sortList(side) {
    items(side)
      .sort((a, b) => a.textContent.trim().localeCompare(b.textContent.trim(), 'es'))
      .forEach((item) => lists[side].appendChild(item));
  }

  function updateState() {
    ['available', 'enabled'].forEach((side) => {
      const allItems = items(side);
      const visibleItems = allItems.filter((item) => !item.hidden);
      form.querySelector(`[data-permission-count="${side}"]`).textContent = allItems.length;
      form.querySelector(`[data-permission-empty="${side}"]`).hidden = visibleItems.length > 0;
    });
    const totalEnabled = form.closest('.admin-role-card').querySelector('[data-total-enabled]');
    if (totalEnabled) totalEnabled.textContent = items('enabled').length;
  }

  function move(permissionItems, targetSide) {
    permissionItems
      .filter((item) => item.dataset.side !== targetSide && item.dataset.locked !== 'true')
      .forEach((item) => {
        item.querySelector('[data-permission-check]').checked = false;
        item.dataset.side = targetSide;
        item.hidden = false;
        lists[targetSide].appendChild(item);
      });
    sortList(targetSide);
    updateState();
  }

  function selected(side, includeAll = false) {
    return items(side).filter((item) => (
      item.dataset.locked !== 'true'
      && (includeAll || item.querySelector('[data-permission-check]').checked)
    ));
  }

  form.querySelectorAll('[data-transfer]').forEach((button) => {
    button.addEventListener('click', () => {
      const action = button.dataset.transfer;
      if (action === 'grant') move(selected('available'), 'enabled');
      if (action === 'grant-all') move(selected('available', true), 'enabled');
      if (action === 'revoke') move(selected('enabled'), 'available');
      if (action === 'revoke-all') move(selected('enabled', true), 'available');
    });
  });

  form.querySelectorAll('[data-permission-search]').forEach((search) => {
    search.addEventListener('input', () => {
      const side = search.dataset.permissionSearch;
      const term = search.value.trim().toLocaleLowerCase('es');
      items(side).forEach((item) => {
        item.hidden = Boolean(term) && !item.textContent.toLocaleLowerCase('es').includes(term);
      });
      updateState();
    });
  });

  form.addEventListener('dragstart', (event) => {
    const item = event.target.closest('[data-permission-item]');
    if (!item || item.dataset.locked === 'true') return event.preventDefault();
    event.dataTransfer.effectAllowed = 'move';
    event.dataTransfer.setData('text/plain', item.dataset.id);
    item.classList.add('is-dragging');
  });

  form.addEventListener('dragend', (event) => {
    event.target.closest('[data-permission-item]')?.classList.remove('is-dragging');
    form.querySelectorAll('.is-drag-over').forEach((zone) => zone.classList.remove('is-drag-over'));
  });

  form.querySelectorAll('[data-permission-zone]').forEach((zone) => {
    zone.addEventListener('dragover', (event) => {
      event.preventDefault();
      event.dataTransfer.dropEffect = 'move';
      zone.classList.add('is-drag-over');
    });
    zone.addEventListener('dragleave', (event) => {
      if (!zone.contains(event.relatedTarget)) zone.classList.remove('is-drag-over');
    });
    zone.addEventListener('drop', (event) => {
      event.preventDefault();
      zone.classList.remove('is-drag-over');
      const item = form.querySelector(`[data-permission-item][data-id="${CSS.escape(event.dataTransfer.getData('text/plain'))}"]`);
      if (item) move([item], zone.dataset.permissionZone);
    });
  });

  form.addEventListener('submit', () => {
    const inputContainer = form.querySelector('[data-permission-inputs]');
    inputContainer.replaceChildren(...items('enabled').map((item) => {
      const input = document.createElement('input');
      input.type = 'hidden';
      input.name = 'id_permiso';
      input.value = item.dataset.id;
      return input;
    }));
  });

  updateState();
})();
