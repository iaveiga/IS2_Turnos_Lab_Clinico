(() => {
  const form = document.querySelector('[data-report-filters]');
  const printButton = document.querySelector('[data-print-report]');

  printButton?.addEventListener('click', () => window.print());
  if (!form) return;

  const period = form.elements.periodo;
  const start = form.elements.desde;
  const end = form.elements.hasta;
  let submitTimer;

  function updateDateLimits() {
    start.max = end.value || start.dataset.maximum || start.max;
    end.min = start.value || '';
  }

  function submitWhenValid() {
    window.clearTimeout(submitTimer);
    updateDateLimits();
    if (!start.value || !end.value || start.value > end.value) return;
    submitTimer = window.setTimeout(() => form.requestSubmit(), 120);
  }

  period.addEventListener('change', () => form.requestSubmit());
  start.addEventListener('change', () => {
    period.value = 'personalizado';
    submitWhenValid();
  });
  end.addEventListener('change', () => {
    period.value = 'personalizado';
    submitWhenValid();
  });
  form.addEventListener('submit', () => {
    form.querySelector('button[type="submit"]')?.setAttribute('aria-busy', 'true');
  });

  start.dataset.maximum = start.max;
  updateDateLimits();
})();
