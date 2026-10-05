/**
 * Boot Huginn dock after login in CRM shell.
 */
(function () {
  function tryMount() {
    if (!localStorage.getItem('asgard_token')) return;
    if (typeof HuginnDock === 'undefined') return;
    HuginnDock.mount();
  }
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => setTimeout(tryMount, 400));
  } else {
    setTimeout(tryMount, 400);
  }
  window.addEventListener('asgard:login', tryMount);
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden && typeof HuginnSSE !== 'undefined') HuginnSSE.catchUp();
  });
})();
