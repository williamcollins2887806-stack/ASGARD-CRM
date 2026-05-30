import { useState, useEffect } from 'react';
import { X, Smartphone, Download, ChevronRight } from 'lucide-react';

const STORAGE_KEY = 'asgard_mobile_banner_dismissed_v1';

export function MobileAppBanner() {
  const [visible, setVisible] = useState(false);
  const [closing, setClosing] = useState(false);

  useEffect(() => {
    if (localStorage.getItem(STORAGE_KEY)) return;
    // Show with a small delay so page loads first
    const t = setTimeout(() => setVisible(true), 1200);
    return () => clearTimeout(t);
  }, []);

  function dismiss() {
    setClosing(true);
    localStorage.setItem(STORAGE_KEY, '1');
    setTimeout(() => { setVisible(false); setClosing(false); }, 300);
  }

  if (!visible) return null;

  return (
    <div
      style={{
        position: 'fixed', inset: 0, zIndex: 9000,
        background: 'rgba(5,5,8,0.8)',
        backdropFilter: 'blur(16px)',
        WebkitBackdropFilter: 'blur(16px)',
        display: 'flex', alignItems: 'flex-end', justifyContent: 'center',
        paddingBottom: 'env(safe-area-inset-bottom, 16px)',
        animation: closing ? 'mabFadeOut 300ms ease forwards' : 'mabFadeIn 300ms ease forwards',
      }}
      onClick={dismiss}
    >
      <div
        style={{
          width: '100%', maxWidth: 480,
          background: 'linear-gradient(180deg, #141418 0%, #0f0f13 100%)',
          borderRadius: '28px 28px 0 0',
          border: '0.5px solid rgba(200,168,78,0.25)',
          borderBottom: 'none',
          overflow: 'hidden',
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Top gradient bar */}
        <div style={{
          height: 3,
          background: 'linear-gradient(90deg, #c8a84e, #4A90D9, #30d158)',
        }} />

        <div style={{ padding: '24px 20px 0' }}>
          {/* Close */}
          <button
            onClick={dismiss}
            style={{
              position: 'absolute', top: 20, right: 20,
              width: 32, height: 32, borderRadius: '50%',
              background: 'rgba(255,255,255,0.06)',
              border: '0.5px solid rgba(255,255,255,0.1)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              cursor: 'pointer',
            }}
          >
            <X size={15} style={{ color: 'rgba(255,255,255,0.5)' }} />
          </button>

          {/* Header */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 14, marginBottom: 20 }}>
            <div style={{
              width: 54, height: 54, borderRadius: 16, flexShrink: 0,
              background: 'linear-gradient(135deg, rgba(200,168,78,0.25) 0%, rgba(74,144,217,0.15) 100%)',
              border: '1px solid rgba(200,168,78,0.4)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
            }}>
              <Smartphone size={26} style={{ color: '#c8a84e' }} />
            </div>
            <div>
              <p style={{
                fontSize: 11, fontWeight: 700, color: '#c8a84e',
                textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 4,
              }}>Новинка</p>
              <p style={{ fontSize: 20, fontWeight: 800, color: '#fff', lineHeight: 1.2 }}>
                ASGARD CRM Mobile
              </p>
            </div>
          </div>

          {/* Description */}
          <p style={{ fontSize: 15, color: 'rgba(255,255,255,0.75)', lineHeight: 1.6, marginBottom: 20 }}>
            Вышла мобильная версия ASGARD CRM — весь функционал CRM в кармане.
            Сейчас доступна только для <strong style={{ color: '#fff' }}>Android</strong>,
            версия iOS в разработке.
          </p>

          {/* How to install */}
          <div style={{
            background: 'rgba(255,255,255,0.04)',
            border: '0.5px solid rgba(255,255,255,0.08)',
            borderRadius: 16,
            padding: '16px',
            marginBottom: 20,
          }}>
            <p style={{
              fontSize: 11, fontWeight: 700, color: 'rgba(255,255,255,0.4)',
              textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 12,
            }}>Как установить</p>

            {[
              { n: '1', text: 'Откройте страницу загрузки в браузере телефона (Chrome)' },
              { n: '2', text: 'Нажмите «Скачать APK» и дождитесь загрузки файла' },
              { n: '3', text: 'Разрешите установку из неизвестных источников (один раз)' },
              { n: '4', text: 'Нажмите «Установить» — готово!' },
            ].map((step) => (
              <div key={step.n} style={{ display: 'flex', gap: 12, marginBottom: 10, alignItems: 'flex-start' }}>
                <div style={{
                  width: 24, height: 24, borderRadius: 8, flexShrink: 0,
                  background: 'rgba(200,168,78,0.15)',
                  border: '1px solid rgba(200,168,78,0.3)',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  fontSize: 12, fontWeight: 800, color: '#c8a84e',
                }}>{step.n}</div>
                <p style={{ fontSize: 13, color: 'rgba(255,255,255,0.7)', lineHeight: 1.5, paddingTop: 2 }}>
                  {step.text}
                </p>
              </div>
            ))}
          </div>
        </div>

        {/* CTA */}
        <div style={{ padding: '0 20px 28px', display: 'flex', flexDirection: 'column', gap: 10 }}>
          <a
            href="https://asgard-crm.ru/download"
            target="_blank"
            rel="noreferrer"
            style={{
              display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
              padding: '15px 0',
              background: 'linear-gradient(135deg, #c8a84e, #b8943e)',
              border: 'none', borderRadius: 16,
              color: '#0a0a0c', fontSize: 15, fontWeight: 800,
              textDecoration: 'none', letterSpacing: '0.01em',
            }}
          >
            <Download size={17} />
            Открыть страницу загрузки
            <ChevronRight size={17} />
          </a>
          <button
            onClick={dismiss}
            style={{
              padding: '13px 0',
              background: 'transparent',
              border: '0.5px solid rgba(255,255,255,0.12)',
              borderRadius: 16,
              color: 'rgba(255,255,255,0.45)', fontSize: 14, fontWeight: 600,
              cursor: 'pointer',
            }}
          >
            Напомнить позже
          </button>
        </div>
      </div>

      <style>{`
        @keyframes mabFadeIn { from { opacity: 0 } to { opacity: 1 } }
        @keyframes mabFadeOut { from { opacity: 1 } to { opacity: 0 } }
      `}</style>
    </div>
  );
}
