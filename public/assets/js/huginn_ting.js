/**
 * Huginn ↔ Ting bridge: video overlay + PiP without leaving CRM hash when possible.
 */
(function (global) {
  'use strict';

  let overlay = null;
  let pip = null;

  function openHub() {
    // Prefer in-app ting page if present
    if (typeof AsgardTing !== 'undefined' || document.querySelector('[data-page="ting"]')) {
      location.hash = '#/ting';
      return;
    }
    location.hash = '#/ting';
  }

  function openOverlay(opts) {
    closeOverlay();
    overlay = document.createElement('div');
    overlay.className = 'hg-ting-overlay';
    overlay.innerHTML = `
      <div class="hg-ting-stage">
        <div style="padding:16px;display:flex;justify-content:space-between;align-items:center">
          <strong>Тинг</strong>
          <div>
            <button type="button" class="hg-chip" id="hgTingPip">Свернуть</button>
            <button type="button" class="hg-chip" id="hgTingClose">Закрыть</button>
          </div>
        </div>
        <iframe title="Ting" src="/ting/" style="width:100%;height:calc(100% - 56px);border:0;background:#000"></iframe>
      </div>`;
    document.body.appendChild(overlay);
    overlay.querySelector('#hgTingClose').onclick = () => {
      closeOverlay();
      if (opts && opts.chatId) {
        fetch('/api/chat-groups/' + opts.chatId + '/call-event', {
          method: 'POST',
          headers: {
            Authorization: 'Bearer ' + (localStorage.getItem('asgard_token') || ''),
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({ kind: 'ting', status: 'ended', duration_sec: 0 })
        }).catch(() => {});
      }
    };
    overlay.querySelector('#hgTingPip').onclick = () => toPip(opts);
  }

  function toPip(opts) {
    if (!overlay) return;
    const iframe = overlay.querySelector('iframe');
    pip = document.createElement('div');
    pip.className = 'hg-ting-pip';
    pip.appendChild(iframe);
    const bar = document.createElement('div');
    bar.style.cssText = 'position:absolute;left:0;right:0;top:0;display:flex;gap:6px;padding:6px;background:rgba(0,0,0,.45)';
    bar.innerHTML = '<button type="button" class="hg-chip" id="hgPipExpand">Развернуть</button><button type="button" class="hg-chip" id="hgPipClose">✕</button>';
    pip.appendChild(bar);
    document.body.appendChild(pip);
    overlay.remove();
    overlay = null;
    bar.querySelector('#hgPipExpand').onclick = () => {
      const frame = pip.querySelector('iframe');
      pip.remove();
      pip = null;
      openOverlay(opts);
      const stage = overlay.querySelector('.hg-ting-stage');
      const old = stage.querySelector('iframe');
      if (old && frame) stage.replaceChild(frame, old);
    };
    bar.querySelector('#hgPipClose').onclick = closeOverlay;
  }

  function closeOverlay() {
    if (overlay) { overlay.remove(); overlay = null; }
    if (pip) { pip.remove(); pip = null; }
  }

  global.HuginnTing = { openHub, openOverlay, closeOverlay };
})(typeof window !== 'undefined' ? window : global);
