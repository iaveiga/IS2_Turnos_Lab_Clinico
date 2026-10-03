(() => {
  const dataNode = document.querySelector('#reception-patient-data');
  let patients = {};
  try {
    patients = JSON.parse(dataNode?.textContent || '{}');
  } catch (_error) {
    patients = {};
  }

  const text = (tag, value, className = '') => {
    const node = document.createElement(tag);
    node.textContent = value;
    if (className) node.className = className;
    return node;
  };

  const statusClass = (code) => {
    if (code === 'ATENDIDO') return 'bg-green-lt';
    if (code === 'CANCELADO') return 'bg-red-lt';
    if (code === 'AUSENTE') return 'bg-orange-lt';
    if (code === 'CONFIRMADO') return 'bg-azure-lt';
    return 'bg-yellow-lt';
  };

  const readableSex = (value) => ({
    FEMENINO: 'Femenino',
    MASCULINO: 'Masculino',
    OTRO: 'Otro',
    PREFIERO_NO_DECIR: 'Prefiere no decir'
  }[value] || value);

  function emptyState(message) {
    const node = text('div', message, 'reception-inline-empty');
    node.setAttribute('role', 'status');
    return node;
  }

  function createExamRow(exam) {
    const row = document.createElement('article');
    row.className = 'reception-exam-row';

    const main = document.createElement('div');
    main.className = 'reception-exam-main';
    main.append(text('strong', exam.servicio), text('small', `${exam.codigo} · ${exam.fecha} · ${exam.hora}`));

    const badge = text('span', exam.estado, `badge ${statusClass(exam.estadoCodigo)}`);
    row.append(main, badge);
    return row;
  }

  function createResultRow(exam) {
    const row = document.createElement('article');
    row.className = 'reception-result-row';

    const heading = document.createElement('div');
    heading.className = 'reception-result-heading';
    const title = document.createElement('div');
    title.append(text('strong', exam.servicio), text('small', `${exam.codigo} · ${exam.resultado.fecha}`));
    heading.append(title, text('span', 'Publicado', 'badge bg-green-lt'));

    const result = text('p', exam.resultado.resultado, 'reception-result-content');
    const meta = text('small', `Responsable: ${exam.resultado.tecnico}`, 'text-secondary');
    row.append(heading, result);
    if (exam.resultado.observaciones) row.append(text('p', exam.resultado.observaciones, 'reception-result-notes'));
    row.append(meta);
    return row;
  }

  document.querySelectorAll('[data-view-patient]').forEach((button) => {
    button.addEventListener('click', () => {
      const patient = patients[button.dataset.viewPatient];
      const modalNode = document.querySelector('#patient-detail-modal');
      if (!patient || !modalNode) return;

      modalNode.querySelector('[data-patient-name]').textContent = patient.nombre;
      modalNode.querySelectorAll('[data-patient-field]').forEach((field) => {
        const key = field.dataset.patientField;
        field.textContent = key === 'sexo' ? readableSex(patient[key]) : patient[key];
      });

      const exams = patient.examenes || [];
      const examList = modalNode.querySelector('[data-exam-list]');
      const resultList = modalNode.querySelector('[data-result-list]');
      examList.replaceChildren(...(exams.length ? exams.map(createExamRow) : [emptyState('No hay exámenes agendados.') ]));
      modalNode.querySelector('[data-exam-count]').textContent = String(exams.length);

      const canViewResults = modalNode.dataset.canViewResults === 'true';
      const published = canViewResults ? exams.filter((exam) => exam.resultado) : [];
      const resultEmpty = canViewResults ? 'No existen resultados publicados para este paciente.' : 'Tu rol no tiene acceso a resultados.';
      resultList.replaceChildren(...(published.length ? published.map(createResultRow) : [emptyState(resultEmpty)]));

      window.lucide?.createIcons();
      window.tabler?.Modal.getOrCreateInstance(modalNode).show();
    });
  });

  const arrivalModal = document.querySelector('#arrival-modal');
  document.querySelectorAll('[data-register-arrival]').forEach((button) => {
    button.addEventListener('click', () => {
      if (!arrivalModal) return;
      arrivalModal.querySelector('[data-arrival-form]').action = `/recepcion/turnos/${button.dataset.id}/llegada`;
      arrivalModal.querySelector('[data-arrival-patient]').textContent = button.dataset.patient;
      arrivalModal.querySelector('[data-arrival-code]').textContent = button.dataset.code;
      window.tabler?.Modal.getOrCreateInstance(arrivalModal).show();
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

  const newPatientModal = document.querySelector('#new-patient-modal[data-auto-open="true"]');
  if (newPatientModal) window.tabler?.Modal.getOrCreateInstance(newPatientModal).show();
})();
