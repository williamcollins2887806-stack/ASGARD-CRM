/**
 * АСГАРД CRM — Визуальные эффекты
 * Этап 42
 * 
 * Функционал:
 * - Confetti при победе
 * - Skeleton loading
 * - Анимации переходов
 * - Микро-анимации
 * - Звуки (опционально)
 */
window.AsgardFX = (function(){
  
  // ========== CONFETTI ==========
  
  function confetti(options = {}) {
    const defaults = {
      particleCount: 100,
      spread: 70,
      origin: { x: 0.5, y: 0.5 },
      colors: ['#c0392b', '#f5d78e', '#2a3b66', '#22c55e', '#3b82f6'],
      duration: 3000
    };
    
    const config = { ...defaults, ...options };
    
    const container = document.createElement('div');
    container.className = 'confetti-container';
    container.innerHTML = `<style>
      .confetti-container { position: fixed; top: 0; left: 0; width: 100%; height: 100%; pointer-events: none; z-index: 99999; overflow: hidden; }
      .confetti-particle { position: absolute; width: 10px; height: 10px; opacity: 1; }
    </style>`;
    document.body.appendChild(container);
    
    for (let i = 0; i < config.particleCount; i++) {
      const particle = document.createElement('div');
      particle.className = 'confetti-particle';
      
      const color = config.colors[Math.floor(Math.random() * config.colors.length)];
      const size = Math.random() * 10 + 5;
      const shape = Math.random() > 0.5 ? '50%' : '0';
      
      particle.style.cssText = `
        left: ${config.origin.x * 100}%;
        top: ${config.origin.y * 100}%;
        width: ${size}px;
        height: ${size}px;
        background: ${color};
        border-radius: ${shape};
        transform: rotate(${Math.random() * 360}deg);
      `;
      
      container.appendChild(particle);
      
      // Анимация
      const angle = (Math.random() - 0.5) * config.spread * 2 * Math.PI / 180;
      const velocity = Math.random() * 500 + 200;
      const vx = Math.sin(angle) * velocity;
      const vy = -Math.cos(angle) * velocity + Math.random() * 200;
      const rotationSpeed = (Math.random() - 0.5) * 720;
      
      let x = 0, y = 0, rotation = 0, opacity = 1;
      const gravity = 500;
      const startTime = performance.now();
      
      const animate = (time) => {
        const elapsed = (time - startTime) / 1000;
        
        x = vx * elapsed;
        y = vy * elapsed + 0.5 * gravity * elapsed * elapsed;
        rotation += rotationSpeed * elapsed / 60;
        opacity = 1 - elapsed / (config.duration / 1000);
        
        if (opacity > 0) {
          particle.style.transform = `translate(${x}px, ${y}px) rotate(${rotation}deg)`;
          particle.style.opacity = opacity;
          requestAnimationFrame(animate);
        } else {
          particle.remove();
        }
      };
      
      requestAnimationFrame(animate);
    }
    
    setTimeout(() => container.remove(), config.duration + 500);
  }

  // ========== SKELETON LOADING ==========
  
  function skeleton(html) {
    return `
      <div class="skeleton-wrapper">
        ${html}
      </div>
      <style>
        .skeleton-wrapper .skeleton {
          background: linear-gradient(90deg, var(--bg-elevated) 25%, var(--bg-card) 50%, var(--bg-elevated) 75%);
          background-size: 200% 100%;
          animation: skeleton-shimmer 1.5s infinite;
          border-radius: 8px;
        }
        .skeleton-text { height: 16px; margin-bottom: 8px; }
        .skeleton-title { height: 24px; width: 60%; margin-bottom: 12px; }
        .skeleton-avatar { width: 48px; height: 48px; border-radius: 50%; }
        .skeleton-card { height: 120px; margin-bottom: 16px; }
        .skeleton-line { height: 14px; margin-bottom: 6px; }
        .skeleton-line:last-child { width: 80%; }
        @keyframes skeleton-shimmer {
          0% { background-position: 200% 0; }
          100% { background-position: -200% 0; }
        }
      </style>
    `;
  }

  // Предустановленные скелетоны
  const skeletons = {
    card: () => skeleton('<div class="skeleton skeleton-card"></div>'),
    list: (count = 3) => skeleton(Array(count).fill('<div class="skeleton skeleton-line"></div>').join('')),
    table: (rows = 5) => skeleton(`
      <div class="skeleton skeleton-title"></div>
      ${Array(rows).fill('<div class="skeleton skeleton-text"></div>').join('')}
    `),
    profile: () => skeleton(`
      <div style="display:flex;gap:16px;align-items:center">
        <div class="skeleton skeleton-avatar"></div>
        <div style="flex:1">
          <div class="skeleton skeleton-title"></div>
          <div class="skeleton skeleton-text"></div>
        </div>
      </div>
    `)
  };

  // ========== АНИМАЦИИ ПЕРЕХОДОВ ==========
  
  function pageTransition(direction = 'in') {
    const overlay = document.createElement('div');
    overlay.className = `page-transition ${direction}`;
    overlay.innerHTML = `
      <style>
        .page-transition {
          position: fixed;
          top: 0;
          left: 0;
          width: 100%;
          height: 100%;
          z-index: 99998;
          pointer-events: none;
        }
        .page-transition.in {
          animation: pageIn 0.4s ease forwards;
        }
        .page-transition.out {
          animation: pageOut 0.4s ease forwards;
        }
        @keyframes pageIn {
          from { 
            clip-path: circle(0% at 50% 50%);
            background: var(--bg-base);
          }
          to { 
            clip-path: circle(150% at 50% 50%);
            background: transparent;
          }
        }
        @keyframes pageOut {
          from { 
            clip-path: circle(150% at 50% 50%);
            background: transparent;
          }
          to { 
            clip-path: circle(0% at 50% 50%);
            background: var(--bg-base);
          }
        }
      </style>
    `;
    document.body.appendChild(overlay);
    setTimeout(() => overlay.remove(), 500);
  }

  // ========== ТОСТ С АНИМАЦИЕЙ ==========
  
  function animatedToast(title, message, type = 'ok') {
    const icons = {
      ok: '✅',
      err: '❌',
      warn: '⚠️',
      info: 'ℹ️'
    };
    
    const colors = {
      ok: 'var(--green)',
      err: 'var(--red)',
      warn: 'var(--amber)',
      info: 'var(--blue)'
    };
    
    const toast = document.createElement('div');
    toast.className = 'fx-toast';
    toast.innerHTML = `
      <div class="fx-toast-icon">${icons[type] || icons.info}</div>
      <div class="fx-toast-content">
        <div class="fx-toast-title">${esc(title)}</div>
        ${message ? `<div class="fx-toast-message">${esc(message)}</div>` : ''}
      </div>
      <style>
        .fx-toast {
          position: fixed;
          bottom: 24px;
          left: 50%;
          transform: translateX(-50%) translateY(100px);
          background: var(--bg-card);
          border: 1px solid ${colors[type] || colors.info};
          border-left: 4px solid ${colors[type] || colors.info};
          border-radius: 12px;
          padding: 14px 20px;
          display: flex;
          align-items: center;
          gap: 12px;
          box-shadow: 0 10px 40px rgba(0,0,0,0.4);
          z-index: 99999;
          animation: toastIn 0.4s cubic-bezier(0.34, 1.56, 0.64, 1) forwards;
        }
        .fx-toast.out {
          animation: toastOut 0.3s ease forwards;
        }
        @keyframes toastIn {
          from { transform: translateX(-50%) translateY(100px); opacity: 0; }
          to { transform: translateX(-50%) translateY(0); opacity: 1; }
        }
        @keyframes toastOut {
          from { transform: translateX(-50%) translateY(0); opacity: 1; }
          to { transform: translateX(-50%) translateY(100px); opacity: 0; }
        }
        .fx-toast-icon { font-size: 24px; }
        .fx-toast-title { font-weight: 600; font-size: 14px; }
        .fx-toast-message { font-size: 12px; opacity: 0.7; margin-top: 2px; }
      </style>
    `;
    
    document.body.appendChild(toast);
    
    setTimeout(() => {
      toast.classList.add('out');
      setTimeout(() => toast.remove(), 300);
    }, 3000);
  }

  // ========== RIPPLE EFFECT ==========
  
  function enableRipple(selector = '.btn') {
    document.addEventListener('click', (e) => {
      const target = e.target.closest(selector);
      if (!target) return;
      
      const ripple = document.createElement('span');
      ripple.className = 'ripple-effect';
      
      const rect = target.getBoundingClientRect();
      const size = Math.max(rect.width, rect.height);
      const x = e.clientX - rect.left - size / 2;
      const y = e.clientY - rect.top - size / 2;
      
      ripple.style.cssText = `
        position: absolute;
        width: ${size}px;
        height: ${size}px;
        left: ${x}px;
        top: ${y}px;
        background: rgba(255, 255, 255, 0.3);
        border-radius: 50%;
        transform: scale(0);
        animation: ripple 0.6s ease-out;
        pointer-events: none;
      `;
      
      target.style.position = 'relative';
      target.style.overflow = 'hidden';
      target.appendChild(ripple);
      
      setTimeout(() => ripple.remove(), 600);
    });
    
    // Добавляем стили
    if (!document.getElementById('ripple-styles')) {
      const style = document.createElement('style');
      style.id = 'ripple-styles';
      style.textContent = `
        @keyframes ripple {
          to { transform: scale(2.5); opacity: 0; }
        }
      `;
      document.head.appendChild(style);
    }
  }

  // ========== СЧЁТЧИК С АНИМАЦИЕЙ ==========
  
  function animateNumber(element, targetValue, duration = 1000) {
    const el = typeof element === 'string' ? document.getElementById(element) : element;
    if (!el) return;
    
    const startValue = parseInt(el.textContent) || 0;
    const startTime = performance.now();
    
    const animate = (currentTime) => {
      const elapsed = currentTime - startTime;
      const progress = Math.min(elapsed / duration, 1);
      
      // Easing
      const easeOutQuart = 1 - Math.pow(1 - progress, 4);
      const currentValue = Math.round(startValue + (targetValue - startValue) * easeOutQuart);
      
      el.textContent = currentValue.toLocaleString('ru-RU');
      
      if (progress < 1) {
        requestAnimationFrame(animate);
      }
    };
    
    requestAnimationFrame(animate);
  }

  // ========== ПРОГРЕСС-БАР С АНИМАЦИЕЙ ==========
  
  function animateProgress(element, targetPercent, duration = 1000) {
    const el = typeof element === 'string' ? document.getElementById(element) : element;
    if (!el) return;
    
    el.style.transition = `width ${duration}ms cubic-bezier(0.34, 1.56, 0.64, 1)`;
    el.style.width = `${targetPercent}%`;
  }

  // ========== ЗВУКИ ==========
  
  const sounds = {
    success: null,
    error: null,
    notification: null
  };

  // Создаём звуки программно (без внешних файлов)
  function createSound(type) {
    const audioContext = new (window.AudioContext || window.webkitAudioContext)();
    
    const frequencies = {
      success: [523.25, 659.25, 783.99], // C5, E5, G5
      error: [311.13, 277.18], // Eb4, Db4
      notification: [659.25, 783.99] // E5, G5
    };
    
    return () => {
      const freqs = frequencies[type] || frequencies.notification;
      freqs.forEach((freq, i) => {
        const oscillator = audioContext.createOscillator();
        const gainNode = audioContext.createGain();
        
        oscillator.connect(gainNode);
        gainNode.connect(audioContext.destination);
        
        oscillator.frequency.value = freq;
        oscillator.type = 'sine';
        
        gainNode.gain.setValueAtTime(0.3, audioContext.currentTime + i * 0.1);
        gainNode.gain.exponentialRampToValueAtTime(0.01, audioContext.currentTime + i * 0.1 + 0.3);
        
        oscillator.start(audioContext.currentTime + i * 0.1);
        oscillator.stop(audioContext.currentTime + i * 0.1 + 0.3);
      });
    };
  }

  function playSound(type) {
    const enabled = localStorage.getItem('asgard_sounds') !== 'false';
    if (!enabled) return;
    
    if (!sounds[type]) {
      sounds[type] = createSound(type);
    }
    
    try {
      sounds[type]();
    } catch(e) {
      // Игнорируем ошибки AudioContext
    }
  }

  // ========== ИНИЦИАЛИЗАЦИЯ ==========
  
  function init() {
    // Включаем ripple эффект для кнопок
    enableRipple('.btn');
    
    // Добавляем глобальные стили анимаций
    if (!document.getElementById('fx-global-styles')) {
      const style = document.createElement('style');
      style.id = 'fx-global-styles';
      style.textContent = `
        /* Fade In */
        .fx-fade-in { animation: fxFadeIn 0.3s ease; }
        @keyframes fxFadeIn { from { opacity: 0; } to { opacity: 1; } }
        
        /* Slide Up */
        .fx-slide-up { animation: fxSlideUp 0.4s ease; }
        @keyframes fxSlideUp { from { opacity: 0; transform: translateY(20px); } to { opacity: 1; transform: translateY(0); } }
        
        /* Scale In */
        .fx-scale-in { animation: fxScaleIn 0.3s cubic-bezier(0.34, 1.56, 0.64, 1); }
        @keyframes fxScaleIn { from { opacity: 0; transform: scale(0.9); } to { opacity: 1; transform: scale(1); } }
        
        /* Bounce */
        .fx-bounce { animation: fxBounce 0.5s cubic-bezier(0.34, 1.56, 0.64, 1); }
        @keyframes fxBounce { 0%, 100% { transform: translateY(0); } 50% { transform: translateY(-10px); } }
        
        /* Shake */
        .fx-shake { animation: fxShake 0.5s ease; }
        @keyframes fxShake { 0%, 100% { transform: translateX(0); } 20%, 60% { transform: translateX(-5px); } 40%, 80% { transform: translateX(5px); } }
        
        /* Pulse */
        .fx-pulse { animation: fxPulse 2s infinite; }
        @keyframes fxPulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.5; } }
        
        /* Glow */
        .fx-glow { animation: fxGlow 2s infinite; }
        @keyframes fxGlow { 0%, 100% { box-shadow: 0 0 5px rgba(245, 215, 142, 0.3); } 50% { box-shadow: 0 0 20px rgba(245, 215, 142, 0.6); } }
        
        /* Карточки с hover эффектом */
        .card { transition: transform 0.2s, box-shadow 0.2s; }
        .card:hover { transform: translateY(-2px); box-shadow: 0 8px 24px rgba(0,0,0,0.3); }
        
        /* Плавные переходы для всех интерактивных элементов */
        button, a, .btn, input, select, textarea { transition: all 0.2s ease; }
      `;
      document.head.appendChild(style);
    }
  }

  // Helper
  function esc(s) { return String(s || '').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }

  // Авто-инициализация
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

  return {
    confetti,
    skeleton,
    skeletons,
    pageTransition,
    animatedToast,
    enableRipple,
    animateNumber,
    animateProgress,
    playSound,
    init
  };
})();
