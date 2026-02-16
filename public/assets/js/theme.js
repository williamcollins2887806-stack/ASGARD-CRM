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

  // Simple toggle: just dark <-> light
  function toggleSimple(){
    const current = get();
    return apply(current === "light" ? "dark" : "light");
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
