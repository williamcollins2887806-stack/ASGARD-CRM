/**
 * ASGARD CRM — Theme Manager
 * Business Viking 2026 Design System
 *
 * Features:
 * - Dark/Light theme toggle
 * - System preference detection
 * - Persistent storage
 * - Smooth transitions
 * - Event notifications
 */
(function(){
  const KEY = "asgard_theme"; // 'dark' | 'light' | 'system'
  const SIDEBAR_KEY = "asgard_sidebar_collapsed";
  const NAV_GROUPS_KEY = "asgard_nav_groups";

  // Get stored theme preference
  function getStoredPreference(){
    try { return localStorage.getItem(KEY) || "dark"; }
    catch(e) { return "dark"; }
  }

  // Get system preference
  function getSystemPreference(){
    try {
      if (window.matchMedia && window.matchMedia('(prefers-color-scheme: light)').matches) {
        return "light";
      }
      return "dark";
    } catch(e) { return "dark"; }
  }

  // Resolve effective theme based on preference
  function resolveTheme(preference){
    if (preference === "system") {
      return getSystemPreference();
    }
    return preference === "light" ? "light" : "dark";
  }

  // Get the current active theme (resolved)
  function get(){
    return resolveTheme(getStoredPreference());
  }

  // Get the stored preference (may be 'system')
  function getPreference(){
    return getStoredPreference();
  }

  // Apply theme to document
  function apply(preference){
    const pref = (preference === "system" || preference === "light") ? preference : "dark";
    const theme = resolveTheme(pref);

    try {
      document.documentElement.dataset.theme = theme;
      document.documentElement.classList.remove('theme-dark', 'theme-light');
      document.documentElement.classList.add('theme-' + theme);
    } catch(e){}

    try { localStorage.setItem(KEY, pref); } catch(e){}

    // Notify listeners
    try {
      window.dispatchEvent(new CustomEvent("asgard:theme", {
        detail: { theme, preference: pref }
      }));
    } catch(e){}

    // Update meta theme-color for mobile browsers
    try {
      const meta = document.querySelector('meta[name="theme-color"]');
      if (meta) {
        meta.content = theme === 'light' ? '#f8fafc' : '#0a1628';
      }
    } catch(e){}

    return theme;
  }

  // Cycle through: dark -> light -> system -> dark
  function toggle(){
    const current = getStoredPreference();
    let next;
    if (current === "dark") next = "light";
    else if (current === "light") next = "system";
    else next = "dark";
    return apply(next);
  }

  // ─────────────────────────────────────────────────────
  // Smooth transition (P2)
  // ─────────────────────────────────────────────────────
  // Перекраска идёт через CSS-переменные на :root — все узлы меняют цвет за
  // один кадр. Класс html.theme-transitioning добавляет transition ТОЛЬКО на
  // корень (html/body), давая визуальную плавность без блокировки main thread
  // (путь `*` на 12k узлов раньше давал первый кадр 6.8с).
  function _prefersReducedMotion(){
    try {
      return window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    } catch(e) { return false; }
  }

  var _transitionTimer = null;

  /**
   * Плавная смена темы: html.theme-transitioning → apply → снять класс.
   * @param {string} pref  'dark' | 'light' | 'system'
   * @param {object} [opts] { instant: boolean } — без анимации (первый рендер, экран выбора)
   */
  function applySmooth(pref, opts){
    var instant = !!(opts && opts.instant) || _prefersReducedMotion();
    var root = document.documentElement;

    if (instant) {
      if (_transitionTimer) { clearTimeout(_transitionTimer); _transitionTimer = null; }
      root.classList.remove('theme-transitioning');
      return apply(pref);
    }

    // Стартуем переход: включаем transition на корне, меняем тему, снимаем класс.
    root.classList.add('theme-transitioning');
    var theme = apply(pref);

    if (_transitionTimer) clearTimeout(_transitionTimer);
    var finish = function(){
      _transitionTimer = null;
      root.classList.remove('theme-transitioning');
    };
    _transitionTimer = setTimeout(finish, 320);
    return theme;
  }

  // Simple toggle: dark <-> light с плавным переходом
  function toggleSimple(){
    var current = get();
    return applySmooth(current === "light" ? "dark" : "light");
  }

  /** Мгновенная установка темы без анимации (напр. экран выбора, первый рендер). */
  function applyInstant(pref){
    return applySmooth(pref, { instant: true });
  }

  // Initialize theme
  function init(){
    // Apply stored preference
    apply(getStoredPreference());

    // Listen for system preference changes
    try {
      const mediaQuery = window.matchMedia('(prefers-color-scheme: light)');
      const handler = (e) => {
        const pref = getStoredPreference();
        if (pref === "system") {
          apply("system");
        }
      };

      if (mediaQuery.addEventListener) {
        mediaQuery.addEventListener('change', handler);
      } else if (mediaQuery.addListener) {
        mediaQuery.addListener(handler);
      }
    } catch(e){}
  }

  // ─────────────────────────────────────────────────────
  // Sidebar Collapsed State
  // ─────────────────────────────────────────────────────

  function getSidebarCollapsed(){
    try { return localStorage.getItem(SIDEBAR_KEY) === "1"; }
    catch(e) { return false; }
  }

  function setSidebarCollapsed(collapsed){
    try {
      localStorage.setItem(SIDEBAR_KEY, collapsed ? "1" : "0");
      document.body.classList.toggle('sidebar-collapsed', collapsed);
      window.dispatchEvent(new CustomEvent("asgard:sidebar", {
        detail: { collapsed }
      }));
    } catch(e){}
  }

  function toggleSidebar(){
    const collapsed = !getSidebarCollapsed();
    setSidebarCollapsed(collapsed);
    return collapsed;
  }

  function initSidebar(){
    const collapsed = getSidebarCollapsed();
    document.body.classList.toggle('sidebar-collapsed', collapsed);
  }

  // ─────────────────────────────────────────────────────
  // Navigation Groups State
  // ─────────────────────────────────────────────────────

  function getNavGroupsState(){
    try {
      const stored = localStorage.getItem(NAV_GROUPS_KEY);
      return stored ? JSON.parse(stored) : {};
    } catch(e) { return {}; }
  }

  function setNavGroupState(groupId, expanded){
    try {
      const state = getNavGroupsState();
      state[groupId] = expanded;
      localStorage.setItem(NAV_GROUPS_KEY, JSON.stringify(state));
    } catch(e){}
  }

  function isNavGroupExpanded(groupId, defaultExpanded = true){
    const state = getNavGroupsState();
    return state[groupId] !== undefined ? state[groupId] : defaultExpanded;
  }

  // Export
  window.AsgardTheme = {
    KEY,
    get,
    getPreference,
    getSystemPreference,
    apply,
    toggle,
    toggleSimple,
    applyInstant,
    init,
    // Sidebar
    getSidebarCollapsed,
    setSidebarCollapsed,
    toggleSidebar,
    initSidebar,
    // Nav Groups
    getNavGroupsState,
    setNavGroupState,
    isNavGroupExpanded
  };
})();
