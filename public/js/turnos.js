(() => {
  const dialog = document.querySelector('#booking-modal');
  if (!dialog) return;

  const form = dialog.querySelector('#booking-form');
  const Modal = window.tabler?.Modal;
  const modal = Modal?.getOrCreateInstance(dialog);
  const dateInput = form.elements.fecha_turno;
  const scheduleInput = form.elements.id_horario;
  const timeInput = form.elements.hora_inicio;
  const slotsContainer = dialog.querySelector('#time-slots');
  const slotsState = dialog.querySelector('#slots-state');
  const errorBox = dialog.querySelector('#booking-error');
  const submitButton = form.querySelector('button[type="submit"]');
  let availabilityRequest;

  function selectedService() {
    return form.querySelector('input[name="id_servicio"]:checked')?.value || '';
  }

  function setError(message = '') {
    errorBox.textContent = message;
    errorBox.hidden = !message;
  }

  function setSlotsState(message, icon = 'calendar-clock') {
    slotsState.replaceChildren();
    const iconElement = document.createElement('i');
    iconElement.setAttribute('data-lucide', icon);
    iconElement.setAttribute('aria-hidden', 'true');
    const text = document.createElement('span');
    text.textContent = message;
    slotsState.append(iconElement, text);
    slotsState.hidden = false;
    window.lucide?.createIcons();
  }

  function clearSelectedSlot() {
    scheduleInput.value = '';
    timeInput.value = '';
    submitButton.disabled = true;
    slotsContainer.replaceChildren();
  }

  function resetDialog() {
    availabilityRequest?.abort();
    form.reset();
    clearSelectedSlot();
    setError();
    setSlotsState('Selecciona un examen y una fecha.', 'mouse-pointer-click');
  }

  function openDialog() {
    modal?.show();
  }

  async function loadAvailability() {
    const serviceId = selectedService();
    const date = dateInput.value;
    clearSelectedSlot();
    setError();

    if (!serviceId || !date) {
      setSlotsState('Selecciona un examen y una fecha.', 'mouse-pointer-click');
      return;
    }

    availabilityRequest?.abort();
    availabilityRequest = new AbortController();
    setSlotsState('Consultando cupos disponibles...', 'loader-circle');
    slotsState.querySelector('svg')?.classList.add('spin');

    try {
      const params = new URLSearchParams({ servicio: serviceId, fecha: date });
      const response = await fetch('/turnos/disponibilidad?' + params.toString(), {
        headers: { Accept: 'application/json' },
        signal: availabilityRequest.signal
      });

      if (response.redirected && response.url.includes('/auth/login')) {
        window.location.assign(response.url);
        return;
      }

      const result = await response.json();
      if (!response.ok) throw new Error(result.error || 'No fue posible consultar los horarios.');

      if (!result.slots.length) {
        setSlotsState(result.aviso || 'No quedan horarios con cupo para esta fecha.', 'calendar-x');
        return;
      }

      slotsState.hidden = true;
      result.slots.forEach((slot) => {
        const label = document.createElement('label');
        label.className = 'time-slot';

        const radio = document.createElement('input');
        radio.type = 'radio';
        radio.name = 'slot';
        radio.value = slot.hora;
        radio.dataset.schedule = String(slot.id_horario);

        const content = document.createElement('span');
        const time = document.createElement('strong');
        time.textContent = slot.hora;
        const capacity = document.createElement('small');
        capacity.textContent = slot.disponibles === 1 ? 'Último cupo' : slot.disponibles + ' cupos';
        content.append(time, capacity);
        label.append(radio, content);
        slotsContainer.append(label);
      });
    } catch (error) {
      if (error.name === 'AbortError') return;
      setSlotsState(error.message, 'circle-alert');
    }
  }

  document.querySelectorAll('[data-open-booking]').forEach((button) => {
    button.addEventListener('click', openDialog);
  });

  dialog.addEventListener('hidden.bs.modal', resetDialog);

  form.querySelectorAll('input[name="id_servicio"]').forEach((input) => {
    input.addEventListener('change', loadAvailability);
  });
  dateInput.addEventListener('change', loadAvailability);

  slotsContainer.addEventListener('change', (event) => {
    const selected = event.target.closest('input[name="slot"]');
    if (!selected) return;
    scheduleInput.value = selected.dataset.schedule;
    timeInput.value = selected.value;
    submitButton.disabled = false;
    setError();
  });

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    setError();

    if (!selectedService() || !dateInput.value || !scheduleInput.value || !timeInput.value) {
      setError('Selecciona el examen, la fecha y un horario disponible.');
      return;
    }

    submitButton.disabled = true;
    submitButton.setAttribute('aria-busy', 'true');

    try {
      const body = Object.fromEntries(new FormData(form));
      delete body.slot;
      const response = await fetch('/turnos/nuevo', {
        method: 'POST',
        headers: {
          Accept: 'application/json',
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(body)
      });

      if (response.redirected && response.url.includes('/auth/login')) {
        window.location.assign(response.url);
        return;
      }

      const result = await response.json();
      if (!response.ok) throw new Error(result.error || 'No fue posible agendar el turno.');
      window.location.assign('/turnos?creado=' + encodeURIComponent(result.codigo));
    } catch (error) {
      setError(error.message);
      submitButton.disabled = false;
    } finally {
      submitButton.removeAttribute('aria-busy');
    }
  });

  document.querySelector('.booking-success')?.addEventListener('closed.bs.alert', () => {
    window.history.replaceState({}, '', '/turnos');
  });

  if (dialog.dataset.autoOpen === 'true') openDialog();
})();

(() => {
  const dialog = document.querySelector('#patient-result-modal');
  const dataElement = document.querySelector('#patient-results-data');
  if (!dialog || !dataElement) return;

  let results = {};
  try {
    results = JSON.parse(dataElement.textContent || '{}');
  } catch (error) {
    console.error('No fue posible cargar los resultados publicados.', error);
    return;
  }

  const modal = window.tabler?.Modal?.getOrCreateInstance(dialog);
  const observationsSection = dialog.querySelector('[data-result-observations-section]');
  const printReport = document.querySelector('.patient-result-print');
  const printButton = dialog.querySelector('[data-print-result]');
  let selectedExam = null;

  function setText(selector, value) {
    const element = dialog.querySelector(selector);
    if (element) element.textContent = value || '';
  }

  function setPrintText(selector, value) {
    const element = printReport?.querySelector(selector);
    if (element) element.textContent = value || '';
  }

  function populatePrintReport(exam) {
    const patient = exam.resultado.paciente;
    const printDate = new Intl.DateTimeFormat('es-EC', {
      timeZone: 'America/Guayaquil',
      dateStyle: 'long',
      timeStyle: 'short'
    }).format(new Date());

    setPrintText('[data-print-code]', exam.codigo);
    setPrintText('[data-print-date]', printDate);
    setPrintText('[data-print-patient]', patient.nombre);
    setPrintText('[data-print-identification]', patient.identificacion);
    setPrintText('[data-print-age]', patient.edad);
    setPrintText('[data-print-sex]', patient.sexo);
    setPrintText('[data-print-service]', exam.servicio);
    setPrintText('[data-print-service-date]', `${exam.fecha}, ${exam.hora}`);
    setPrintText('[data-print-result-text]', exam.resultado.resultado);
    setPrintText('[data-print-observations]', exam.resultado.observaciones || 'Sin observaciones registradas.');
    setPrintText('[data-print-technician]', exam.resultado.tecnico);
    setPrintText('[data-print-published]', exam.resultado.fechaPublicacion);
  }

  document.querySelectorAll('[data-view-result]').forEach((button) => {
    button.addEventListener('click', () => {
      const exam = results[button.dataset.viewResult];
      if (!exam?.resultado) return;
      selectedExam = exam;

      setText('[data-result-service]', exam.servicio);
      setText('[data-result-code]', exam.codigo);
      setText('[data-result-date]', `${exam.fecha}, ${exam.hora}`);
      setText('[data-result-text]', exam.resultado.resultado);
      setText('[data-result-observations]', exam.resultado.observaciones);
      setText('[data-result-technician]', `Responsable: ${exam.resultado.tecnico}`);
      setText('[data-result-published]', `Publicado: ${exam.resultado.fechaPublicacion}`);
      observationsSection.hidden = !exam.resultado.observaciones;
      modal?.show();
    });
  });

  printButton?.addEventListener('click', () => {
    if (!selectedExam || !printReport) return;
    populatePrintReport(selectedExam);
    document.body.classList.add('patient-result-print-active');
    window.print();
  });

  window.addEventListener('afterprint', () => {
    document.body.classList.remove('patient-result-print-active');
  });
})();
