/* Рендер сцены: экраны × темы × устройства. Управление — query-параметрами.
   ?theme=dark|light|both   ?screen=login,home,...   ?device=iphone|android|both
   ?embed=1 (без внешней рамки-подписи, для скриншот-харнесса) */
(function () {
  const q = new URLSearchParams(location.search);
  const themeArg = q.get('theme') || 'both';
  const screenArg = q.get('screen');
  const deviceArg = q.get('device') || 'all';

  const DEVICE_CLASS = { android: 'phone--android' };

  /* Строка состояния iPhone + Dynamic Island — часть оболочки, на всех экранах. */
  const statusbarHTML = `
    <div class="phone__statusbar">
      <span class="phone__time">9:41</span>
      <span class="phone__sysicons">
        <svg width="18" height="12" viewBox="0 0 18 12" fill="currentColor"><rect x="0" y="7" width="3" height="5" rx="1"/><rect x="4" y="5" width="3" height="7" rx="1"/><rect x="8" y="2.5" width="3" height="9.5" rx="1"/><rect x="12" y="0" width="3" height="12" rx="1"/></svg>
        <svg width="16" height="12" viewBox="0 0 16 12" fill="currentColor"><path d="M8 11.2 5.6 8.6a3.4 3.4 0 0 1 4.8 0zM3.3 6.2a6.8 6.8 0 0 1 9.4 0l-1.5 1.6a4.6 4.6 0 0 0-6.4 0zM.9 3.7a10.2 10.2 0 0 1 14.2 0L13.6 5.3a8 8 0 0 0-11.2 0z"/></svg>
        <svg width="26" height="12" viewBox="0 0 26 12" fill="none"><rect x=".6" y=".6" width="21" height="10.8" rx="3" stroke="currentColor" stroke-opacity=".45" stroke-width="1.1"/><rect x="2.2" y="2.2" width="15" height="7.6" rx="1.6" fill="currentColor"/><rect x="23" y="4" width="1.7" height="4" rx=".85" fill="currentColor" fill-opacity=".5"/></svg>
      </span>
    </div>
    <div class="phone__island"></div>`;

  function phone(screenKey, theme, device) {
    const s = window.SCREENS[screenKey];
    const col = document.createElement('div');
    col.className = 'stage__col';
    const ph = document.createElement('div');
    ph.className = 'phone ' + (DEVICE_CLASS[device] || '') + (s.full ? ' phone--full' : '');
    ph.setAttribute('data-screen', screenKey);
    ph.setAttribute('data-theme', theme);
    ph.setAttribute('data-device', device);
    ph.innerHTML = `<div class="phone__screen" data-theme="${theme}">
        ${statusbarHTML}
        ${s.render()}
      </div>`;
    ph.querySelector('.phone__screen').setAttribute('data-theme', theme);
    col.appendChild(ph);
    if (!q.get('embed')) {
      const cap = document.createElement('div');
      cap.className = 'stage__cap';
      cap.textContent = `${s.title} · ${theme} · ${device}`;
      col.appendChild(cap);
    }
    return col;
  }

  function render() {
    const stage = document.getElementById('stage');
    stage.innerHTML = '';
    const screens = screenArg ? screenArg.split(',') : Object.keys(window.SCREENS);
    const themes = themeArg === 'both' ? ['dark', 'light'] : [themeArg];
    const devices = deviceArg === 'both' ? ['iphone', 'android'] : (deviceArg === 'all' ? ['iphone'] : [deviceArg]);
    for (const device of devices) {
      for (const theme of themes) {
        for (const key of screens) {
          if (!window.SCREENS[key]) continue;
          stage.appendChild(phone(key, theme, device));
        }
      }
    }
  }

  window.addEventListener('DOMContentLoaded', render);
  window.__renderScreens = render;
})();
