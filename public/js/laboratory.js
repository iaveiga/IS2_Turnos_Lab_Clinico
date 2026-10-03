(() => {
  const dataNode = document.querySelector('#laboratory-turn-data');
  let turns = {};
  try {
    turns = JSON.parse(dataNode?.textContent || '{}');
  } catch (_error) {
    turns = {};
  }

  const readableSex = (value) => ({
    FEMENINO: 'Femenino',
    MASCULINO: 'Masculino',
    OTRO: 'Otro',
    PREFIERO_NO_DECIR: 'Prefiere no decir'
  }[value] || value);

  const detailModal = document.querySelector('#lab-detail-modal');
  document.querySelectorAll('[data-view-lab-turn]').forEach((button) => {
    button.addEventListener('click', () => {
      const turn = turns[button.dataset.viewLabTurn];
      if (!turn || !detailModal) return;

      detailModal.querySelector('[data-detail-patient]').textContent = turn.paciente;
      detailModal.querySelectorAll('[data-detail-field]').forEach((field) => {
        const key = field.dataset.detailField;
        field.textContent = key === 'sexo' ? readableSex(turn[key]) : turn[key];
      });
      detailModal.querySelector('[data-detail-time]').textContent = `${turn.horaInicio} - ${turn.horaFin}`;
      const resultSection = detailModal.querySelector('[data-detail-result-section]');
      resultSection.hidden = !turn.resultado;
      detailModal.querySelector('[data-detail-result-meta]').textContent = turn.resultado
        ? `${turn.resultadoPublicado ? 'Publicado' : 'Borrador'}${turn.fechaResultado ? ` · ${turn.fechaResultado}` : ''}`
        : '';
      window.tabler?.Modal.getOrCreateInstance(detailModal).show();
    });
  });

  const takeModal = document.querySelector('#take-turn-modal');
  document.querySelectorAll('[data-take-turn]').forEach((button) => {
    button.addEventListener('click', () => {
      const turn = turns[button.dataset.takeTurn];
      if (!turn || !takeModal) return;
      takeModal.querySelector('[data-take-form]').action = `/laboratorio/turnos/${turn.id}/tomar`;
      takeModal.querySelector('[data-take-patient]').textContent = turn.paciente;
      takeModal.querySelector('[data-take-service]').textContent = turn.servicio;
      window.tabler?.Modal.getOrCreateInstance(takeModal).show();
    });
  });

  const resultModal = document.querySelector('#result-modal');
  function openResult(turn, preserveValues = false) {
    if (!turn || !resultModal) return;
    const form = resultModal.querySelector('[data-result-form]');
    form.action = `/laboratorio/turnos/${turn.id}/resultado`;
    resultModal.querySelector('[data-result-service]').textContent = turn.servicio;
    resultModal.querySelector('[data-result-patient]').textContent = `${turn.paciente} · CI ${turn.identificacion}`;
    resultModal.querySelector('[data-result-code]').textContent = turn.codigo;
    resultModal.querySelector('[data-result-time]').textContent = `${turn.horaInicio} - ${turn.horaFin}`;
    if (!preserveValues) {
      resultModal.querySelector('[name="resultado"]').value = turn.resultado || '';
      resultModal.querySelector('[name="observaciones"]').value = turn.observacionesResultado || '';
    }
    window.tabler?.Modal.getOrCreateInstance(resultModal).show();
  }

  document.querySelectorAll('[data-manage-result]').forEach((button) => {
    button.addEventListener('click', () => openResult(turns[button.dataset.manageResult]));
  });

  resultModal?.querySelectorAll('[data-result-action]').forEach((button) => {
    button.addEventListener('click', () => {
      resultModal.querySelector('[data-result-action-value]').value = button.dataset.resultAction;
    });
  });

  document.querySelectorAll('form').forEach((form) => {
    form.addEventListener('submit', () => {
      form.querySelectorAll('button[type="submit"]').forEach((button) => {
        button.disabled = true;
        button.setAttribute('aria-busy', 'true');
      });
    });
  });

  const autoOpenId = resultModal?.dataset.autoOpenId;
  if (autoOpenId && turns[autoOpenId]) openResult(turns[autoOpenId], true);
})();
