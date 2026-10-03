(() => {
  document.querySelectorAll('form[data-auto-submit-filters]').forEach((form) => {
    const submitButton = form.querySelector('button[type="submit"]');
    let searchTimer;
    let composing = false;

    function submitFilters() {
      window.clearTimeout(searchTimer);
      if (submitButton) submitButton.setAttribute('aria-busy', 'true');
      form.requestSubmit();
    }

    form.addEventListener('change', (event) => {
      if (!event.target.matches('select, input[type="date"], input[type="radio"], input[type="checkbox"]')) return;
      submitFilters();
    });

    form.querySelectorAll('input[type="search"]').forEach((input) => {
      input.addEventListener('compositionstart', () => {
        composing = true;
      });
      input.addEventListener('compositionend', () => {
        composing = false;
        submitFilters();
      });
      input.addEventListener('input', () => {
        if (composing) return;
        window.clearTimeout(searchTimer);
        searchTimer = window.setTimeout(submitFilters, 450);
      });
    });

    form.addEventListener('submit', () => {
      window.clearTimeout(searchTimer);
      if (submitButton) submitButton.setAttribute('aria-busy', 'true');
    });
  });
})();
