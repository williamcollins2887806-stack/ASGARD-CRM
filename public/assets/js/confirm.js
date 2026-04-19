window.AsgardConfirm=(function(){
  const { $, esc, toast } = AsgardUI;

  let _overlay = null;

  function _ensureOverlay() {
    if (_overlay) return;

    _overlay = document.createElement('div');
    _overlay.className = 'cr-cf-overlay';

    const box = document.createElement('div');
    box.className = 'cr-cf';

    // Top accent line
    const topline = document.createElement('div');
    topline.className = 'cr-cf__topline';
    box.appendChild(topline);

    // Body
    const body = document.createElement('div');
    body.className = 'cr-cf__body';

    const icon = document.createElement('div');
    icon.className = 'cr-cf__icon';
    icon.id = 'cfIcon';
    icon.textContent = '⚡';
    body.appendChild(icon);

    const title = document.createElement('div');
    title.className = 'cr-cf__title';
    title.id = 'cfTitle';
    body.appendChild(title);

    const message = document.createElement('div');
    message.className = 'cr-cf__message';
    message.id = 'cfMessage';
    body.appendChild(message);

    box.appendChild(body);

    // Actions
    const actions = document.createElement('div');
    actions.className = 'cr-cf__actions';

    const cancelBtn = document.createElement('button');
    cancelBtn.className = 'btn ghost';
    cancelBtn.id = 'cfCancel';
    cancelBtn.type = 'button';
    actions.appendChild(cancelBtn);

    const okBtn = document.createElement('button');
    okBtn.className = 'btn primary';
    okBtn.id = 'cfOk';
    okBtn.type = 'button';
    actions.appendChild(okBtn);

    box.appendChild(actions);
    _overlay.appendChild(box);
    document.body.appendChild(_overlay);
  }

  function _close() {
    if (!_overlay) return;
    _overlay.classList.remove('cr-cf-overlay--visible');
    setTimeout(() => {
      _overlay.style.display = 'none';
    }, 300);
  }

  function open(opts={}){
    _ensureOverlay();

    const title = opts.title || "Подтверждение";
    const body = opts.body || "Подтвердите действие.";
    const okText = opts.okText || "Подтвердить";
    const cancelText = opts.cancelText || "Отмена";
    const danger = !!opts.danger;

    const box = $('.cr-cf', _overlay);

    // Set danger variant
    box.classList.toggle('cr-cf--danger', danger);

    // Icon
    const iconEl = $('#cfIcon', _overlay);
    if (danger) {
      iconEl.textContent = '⚠️';
    } else {
      iconEl.textContent = '❓';
    }

    // Title & message
    $('#cfTitle', _overlay).textContent = title;
    const msgEl = $('#cfMessage', _overlay);
    // Support HTML in body (many callers pass HTML)
    if (/<[a-z][\s\S]*>/i.test(body)) {
      msgEl.innerHTML = body;
    } else {
      msgEl.textContent = body;
    }

    // Buttons
    const okBtn = $('#cfOk', _overlay);
    const cancelBtn = $('#cfCancel', _overlay);
    okBtn.textContent = okText;
    okBtn.className = danger ? 'btn danger' : 'btn primary';
    cancelBtn.textContent = cancelText;

    // Show
    _overlay.style.display = 'flex';
    void _overlay.offsetHeight;
    _overlay.classList.add('cr-cf-overlay--visible');

    return new Promise((resolve) => {
      let resolved = false;
      const done = (v) => {
        if (resolved) return;
        resolved = true;
        _close();
        // Remove listeners
        okBtn.removeEventListener('click', onOk);
        cancelBtn.removeEventListener('click', onCancel);
        document.removeEventListener('keydown', onKey);
        _overlay.removeEventListener('click', onOverlay);
        resolve(v);
      };

      const onOk = () => done(true);
      const onCancel = () => done(false);
      const onKey = (e) => { if (e.key === 'Escape') done(false); };
      const onOverlay = (e) => { if (e.target === _overlay) done(false); };

      okBtn.addEventListener('click', onOk);
      cancelBtn.addEventListener('click', onCancel);
      document.addEventListener('keydown', onKey);
      _overlay.addEventListener('click', onOverlay);

      setTimeout(() => okBtn.focus(), 100);
    });
  }

  return { open };
})();
