/**
 * ASGARD Field — Login Page
 * SMS auth with code input, phone mask, WOW animations
 */
(() => {
'use strict';
const el = Utils.el;

const QUOTES_MORNING = [
  'Один мудрый сказал: "Рано встал — уже победил"',
  'Новый день — новый поход за славой!',
  'Руки крепкие, дух несгибаемый — вперёд!',
  'Настоящий воин не ждёт команды — он готов',
  'Сегодня мы делаем то, что другие не могут',
];

function randomQuote() {
  return QUOTES_MORNING[Math.floor(Math.random() * QUOTES_MORNING.length)];
}

function formatPhoneInput(value) {
  let digits = value.replace(/\D/g, '');
  if (digits.startsWith('8')) digits = '7' + digits.slice(1);
  if (digits.startsWith('7')) digits = digits;
  else if (digits.length > 0) digits = '7' + digits;

  let formatted = '+7';
  if (digits.length > 1) formatted += ' (' + digits.slice(1, 4);
  if (digits.length >= 4) formatted += ') ';
  if (digits.length > 4) formatted += digits.slice(4, 7);
  if (digits.length > 7) formatted += '-' + digits.slice(7, 9);
  if (digits.length > 9) formatted += '-' + digits.slice(9, 11);
  return formatted;
}

function rawPhone(value) {
  return '+' + value.replace(/\D/g, '');
}

const LoginPage = {
  render() {
    const t = DS.t;

    const page = el('div', {
      style: {
        minHeight:'100dvh', display:'flex', flexDirection:'column',
        alignItems:'center', justifyContent:'center',
        padding:'40px 24px', paddingBottom:'max(40px, env(safe-area-inset-bottom))',
        background: t.heroGrad, backgroundSize:'200% 200%',
        animation:'fieldGradShift 12s ease infinite',
        position:'relative', overflow:'hidden',
      },
    });

    // Subtle bg pattern
    const pattern = el('div', {
      style: {
        position:'absolute', inset:'0', opacity:'0.02',
        backgroundImage: 'radial-gradient(circle at 25% 25%, #fff 1px, transparent 1px)',
        backgroundSize: '48px 48px', pointerEvents:'none',
      },
    });
    page.appendChild(pattern);

    // Content wrapper
    const wrap = el('div', {
      style: {
        position:'relative', zIndex:'1', width:'100%', maxWidth:'340px',
        display:'flex', flexDirection:'column', alignItems:'center',
      },
    });

    // Emblem
    const emblem = el('img', {
      src: '/assets/img/asgard_emblem.png',
      style: {
        width:'100px', height:'100px', borderRadius:'20px',
        animation:'fieldGlow 3s ease infinite',
        marginBottom:'20px',
      },
    });
    wrap.appendChild(emblem);

    // Title
    wrap.appendChild(el('div', {
      style: {
        color: t.gold, fontWeight:'700', fontSize:'2rem', letterSpacing:'4px',
        marginBottom:'4px', textAlign:'center',
      },
    }, 'ASGARD'));

    wrap.appendChild(el('div', {
      style: {
        color: t.textSec, fontSize:'0.6875rem', fontWeight:'600',
        letterSpacing:'0.12em', textTransform:'uppercase', marginBottom:'24px',
      },
    }, 'ПОЛЕВОЙ МОДУЛЬ'));

    // Gold divider
    wrap.appendChild(el('div', {
      style: {
        width:'40px', height:'2px', borderRadius:'1px',
        background: t.goldGrad, opacity:'0.4', marginBottom:'32px',
      },
    }));

    // ─── Phone Step ──────────────────────────────────────────────────
    const phoneStep = el('div', {
      style: { width:'100%', display:'flex', flexDirection:'column', gap:'16px', animation:'fieldFadeIn 0.5s ease' },
    });

    const phoneInput = el('input', {
      type: 'tel',
      placeholder: '+7 (___) ___-__-__',
      style: {
        width:'100%', height:'56px', boxSizing:'border-box',
        background: 'rgba(255,255,255,0.06)', border:'2px solid ' + t.border,
        borderRadius:'14px', padding:'0 20px',
        color: t.text, fontSize:'1.25rem', fontWeight:'500',
        letterSpacing:'0.5px', textAlign:'center',
        outline:'none', transition:'border-color 0.2s',
        WebkitAppearance:'none',
      },
    });
    phoneInput.addEventListener('focus', () => { phoneInput.style.borderColor = t.gold; });
    phoneInput.addEventListener('blur', () => { phoneInput.style.borderColor = t.border; });
    phoneInput.addEventListener('input', () => {
      const pos = phoneInput.selectionStart;
      const raw = phoneInput.value;
      phoneInput.value = formatPhoneInput(raw);
      // Adjust cursor
      const newLen = phoneInput.value.length;
      const diff = newLen - raw.length;
      phoneInput.setSelectionRange(pos + diff, pos + diff);
    });
    phoneStep.appendChild(phoneInput);

    const errorBox = el('div', {
      style: { color: t.red, fontSize:'0.8125rem', textAlign:'center', minHeight:'20px' },
    });
    phoneStep.appendChild(errorBox);

    const sendBtn = F.BigButton({
      label: 'ПОЛУЧИТЬ КОД',
      variant: 'gold',
      onClick: () => requestCode(),
    });
    phoneStep.appendChild(sendBtn);

    wrap.appendChild(phoneStep);

    // ─── Code Step (hidden initially) ────────────────────────────────
    const codeStep = el('div', {
      style: { width:'100%', display:'none', flexDirection:'column', alignItems:'center', gap:'20px' },
    });

    const codeLabel = el('div', {
      style: { color: t.textSec, fontSize:'0.875rem', textAlign:'center' },
    }, 'Введите код из SMS');

    const phoneDisplay = el('div', {
      style: { color: t.gold, fontSize:'0.8125rem', fontWeight:'500' },
    });

    codeStep.appendChild(codeLabel);
    codeStep.appendChild(phoneDisplay);

    // 4 code boxes
    const codeBoxes = el('div', {
      style: { display:'flex', gap:'12px', justifyContent:'center' },
    });
    const codeInputs = [];
    for (let i = 0; i < 4; i++) {
      const inp = el('input', {
        type: 'tel',
        maxLength: '1',
        style: {
          width:'56px', height:'64px', textAlign:'center',
          fontSize:'1.5rem', fontWeight:'700', color: t.text,
          background: 'rgba(255,255,255,0.06)', border:'2px solid ' + t.border,
          borderRadius:'14px', outline:'none', transition:'border-color 0.2s, transform 0.15s',
          WebkitAppearance:'none',
        },
      });
      inp.addEventListener('focus', () => { inp.style.borderColor = t.gold; });
      inp.addEventListener('blur', () => { inp.style.borderColor = t.border; });
      inp.addEventListener('input', () => {
        if (inp.value.length === 1 && i < 3) {
          codeInputs[i + 1].focus();
        }
        // Auto-submit on 4th digit
        const fullCode = codeInputs.map(ci => ci.value).join('');
        if (fullCode.length === 4) {
          verifyCode(fullCode);
        }
      });
      inp.addEventListener('keydown', (e) => {
        if (e.key === 'Backspace' && !inp.value && i > 0) {
          codeInputs[i - 1].focus();
        }
      });
      // Handle paste
      inp.addEventListener('paste', (e) => {
        e.preventDefault();
        const pasted = (e.clipboardData.getData('text') || '').replace(/\D/g, '').slice(0, 4);
        for (let j = 0; j < pasted.length; j++) {
          if (codeInputs[i + j]) codeInputs[i + j].value = pasted[j];
        }
        if (pasted.length === 4) verifyCode(pasted);
        else if (codeInputs[i + pasted.length]) codeInputs[i + pasted.length].focus();
      });
      codeInputs.push(inp);
      codeBoxes.appendChild(inp);
    }
    codeStep.appendChild(codeBoxes);

    const codeError = el('div', {
      style: { color: t.red, fontSize:'0.8125rem', textAlign:'center', minHeight:'20px' },
    });
    codeStep.appendChild(codeError);

    // Timer / Resend
    const timerEl = el('div', {
      style: { color: t.textTer, fontSize:'0.8125rem', textAlign:'center', cursor:'default' },
    });
    codeStep.appendChild(timerEl);

    // Back link
    const backLink = el('div', {
      style: { color: t.textSec, fontSize:'0.8125rem', cursor:'pointer', textDecoration:'underline', marginTop:'4px' },
      onClick: () => showPhoneStep(),
    }, 'Изменить номер');
    codeStep.appendChild(backLink);

    wrap.appendChild(codeStep);

    // ─── Success overlay ─────────────────────────────────────────────
    const successOverlay = el('div', {
      style: {
        position:'fixed', inset:'0', background: t.bg0,
        display:'none', flexDirection:'column', alignItems:'center', justifyContent:'center',
        zIndex:'1000',
      },
    });
    const successCheck = el('div', {
      style: { fontSize:'4rem', color: t.green, animation:'fieldPop 0.6s cubic-bezier(0.175,0.885,0.32,1.275) both' },
    }, '\u2713');
    const successText = el('div', {
      style: { color: t.text, fontSize:'1.25rem', fontWeight:'600', marginTop:'16px', opacity:'0', animation:'fieldFadeIn 0.5s ease 0.3s both' },
    });
    successOverlay.appendChild(successCheck);
    successOverlay.appendChild(successText);
    page.appendChild(successOverlay);

    // Quote at bottom
    const quoteEl = el('div', {
      style: {
        position:'absolute', bottom: 'max(24px, env(safe-area-inset-bottom))',
        left:'24px', right:'24px', textAlign:'center',
        color: 'rgba(255,255,255,0.15)', fontSize:'0.75rem', fontStyle:'italic',
      },
    }, randomQuote());
    page.appendChild(quoteEl);

    page.appendChild(wrap);

    // Auto-focus
    setTimeout(() => phoneInput.focus(), 500);

    // ─── Logic ───────────────────────────────────────────────────────
    let timerInterval = null;
    let isLoading = false;

    function showPhoneStep() {
      phoneStep.style.display = 'flex';
      codeStep.style.display = 'none';
      codeInputs.forEach(ci => ci.value = '');
      codeError.textContent = '';
      if (timerInterval) clearInterval(timerInterval);
      setTimeout(() => phoneInput.focus(), 100);
    }

    function showCodeStep(phone) {
      phoneStep.style.display = 'none';
      codeStep.style.display = 'flex';
      codeStep.style.animation = 'fieldFadeIn 0.3s ease';
      phoneDisplay.textContent = formatPhoneInput(phone);
      codeInputs[0].focus();
      startTimer();
    }

    function startTimer() {
      let seconds = 60;
      timerEl.style.cursor = 'default';
      timerEl.style.color = t.textTer;
      const update = () => {
        const m = Math.floor(seconds / 60);
        const s = seconds % 60;
        timerEl.textContent = 'Повторить через ' + m + ':' + String(s).padStart(2, '0');
      };
      update();
      if (timerInterval) clearInterval(timerInterval);
      timerInterval = setInterval(() => {
        seconds--;
        if (seconds <= 0) {
          clearInterval(timerInterval);
          timerEl.textContent = 'Отправить ещё раз';
          timerEl.style.cursor = 'pointer';
          timerEl.style.color = t.gold;
          timerEl.onclick = () => requestCode();
        } else {
          update();
        }
      }, 1000);
    }

    async function requestCode() {
      if (isLoading) return;
      const phone = rawPhone(phoneInput.value);
      if (phone.length < 12) {
        errorBox.textContent = 'Введите номер телефона';
        phoneInput.style.animation = 'fieldShake 0.4s ease';
        setTimeout(() => { phoneInput.style.animation = ''; }, 400);
        return;
      }

      isLoading = true;
      errorBox.textContent = '';
      sendBtn.replaceWith(F.BigButton({ label: '', variant: 'gold', loading: true }));

      const resp = await API.fetch('/auth/request-code', { method: 'POST', body: { phone } });

      // Restore button
      const newBtn = F.BigButton({ label: 'ПОЛУЧИТЬ КОД', variant: 'gold', onClick: () => requestCode() });
      const loadingBtn = phoneStep.querySelector('button');
      if (loadingBtn) loadingBtn.replaceWith(newBtn);
      isLoading = false;

      if (!resp || !resp._ok) {
        errorBox.textContent = resp?.error || 'Ошибка. Попробуйте позже';
        return;
      }

      showCodeStep(phone);
    }

    async function verifyCode(code) {
      if (isLoading) return;
      isLoading = true;
      codeError.textContent = '';

      const phone = rawPhone(phoneInput.value);
      const resp = await API.fetch('/auth/verify-code', { method: 'POST', body: { phone, code } });

      isLoading = false;

      if (!resp || !resp._ok) {
        codeError.textContent = resp?.error || 'Неверный код';
        // Shake animation
        codeBoxes.style.animation = 'fieldShake 0.4s ease';
        setTimeout(() => { codeBoxes.style.animation = ''; }, 400);
        codeInputs.forEach(ci => {
          ci.style.borderColor = t.red;
          setTimeout(() => { ci.style.borderColor = t.border; }, 1500);
          ci.value = '';
        });
        codeInputs[0].focus();
        return;
      }

      // Success!
      API.setToken(resp.token);
      Store.set('me', resp.employee);

      // Show success animation
      successOverlay.style.display = 'flex';
      successText.textContent = 'Добро пожаловать, ' + (resp.employee?.fio?.split(' ')[1] || resp.employee?.fio || 'воин') + '!';

      Utils.vibrate(100);

      setTimeout(() => {
        Router.navigate('/field/home', { replace: true });
      }, 1500);
    }

    return page;
  },
};

Router.register('/field/login', LoginPage);
})();
