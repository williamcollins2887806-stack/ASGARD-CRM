/**
 * FieldShop.jsx — 1:1 port of FIELD_SHOP_RENDER.html
 * Norse dark + gold theme, confetti, Web Audio, haptic
 * ================================================================
 */
import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { fieldApi } from '@/api/fieldClient';

/* ═══ MOCK DATA (fallback when API has no items yet) ═══ */
const MOCK_ITEMS = [
  { id:1, category:'merch', name:'Футболка ASGARD', description:'Фирменная футболка компании. 100% хлопок, черная, золотой принт', icon:'👕', price_runes:2500, rarity:'legendary', stock:5 },
  { id:2, category:'merch', name:'Термос ASGARD', description:'Стальной термос 500мл с гравировкой руны', icon:'🏆', price_runes:1800, rarity:'epic', stock:8 },
  { id:3, category:'merch', name:'Толстовка ASGARD', description:'Утепленная толстовка с вышивкой. Легенда!', icon:'🧥', price_runes:4000, rarity:'legendary', stock:3, limited:true },
  { id:4, category:'merch', name:'Кепка ASGARD', description:'Бейсболка с вышитой руной на козырьке', icon:'🧢', price_runes:800, rarity:'rare', stock:15 },
  { id:5, category:'digital', name:'Стикер-пак Один', description:'20 нордических стикеров для Telegram', icon:'🎨', price_runes:150, rarity:'common', stock:99 },
  { id:6, category:'digital', name:'Стикер-пак Тор', description:'25 эпических стикеров с молнией и молотом', icon:'⚡', price_runes:300, rarity:'rare', stock:99 },
  { id:7, category:'digital', name:'Аватар Берсерк', description:'Анимированный аватар для профиля. Эксклюзив!', icon:'🎭', price_runes:500, rarity:'epic', stock:20, limited:true },
  { id:8, category:'digital', name:'Обои Вальхалла', description:'4K обои для рабочего стола в Norse стиле', icon:'🖼️', price_runes:100, rarity:'common', stock:99 },
  { id:9, category:'privilege', name:'VIP на 3 дня', description:'Удвоенные руны, приоритет задач, золотая рамка', icon:'⭐', price_runes:600, rarity:'rare', stock:99 },
  { id:10, category:'privilege', name:'VIP на неделю', description:'7 дней удвоенных рун и бонусов', icon:'👑', price_runes:1200, rarity:'epic', stock:99 },
  { id:11, category:'privilege', name:'Доп. спин Колеса', description:'+1 бесплатный спин Колеса Норн сегодня', icon:'🔄', price_runes:200, rarity:'common', stock:99 },
  { id:12, category:'privilege', name:'x3 Множитель', description:'Тройные руны за все квесты на 24 часа', icon:'🎯', price_runes:900, rarity:'epic', stock:10, limited:true },
  { id:13, category:'cosmetic', name:'Рамка Страж', description:'Эпическая рамка аватара: синее пламя', icon:'🛡️', price_runes:400, rarity:'rare', stock:30 },
  { id:14, category:'cosmetic', name:'Рамка Ярл', description:'Золотая рамка с рунами. Показывает статус!', icon:'⚔️', price_runes:1500, rarity:'legendary', stock:5, limited:true },
  { id:15, category:'cosmetic', name:'Эффект Молния', description:'Молнии вокруг аватара при входе в чат', icon:'⚡', price_runes:350, rarity:'rare', stock:50 },
  { id:16, category:'cosmetic', name:'Титул Воин', description:'Титул под именем в профиле и в чатах', icon:'🏅', price_runes:250, rarity:'common', stock:99 },
];

const RARITY_LABELS = { legendary:'ЛЕГЕНДА', epic:'ЭПИК', rare:'РЕДКИЙ', common:'ОБЫЧНЫЙ' };
const RARITY_LABELS_FULL = { legendary:'ЛЕГЕНДАРНЫЙ', epic:'ЭПИЧЕСКИЙ', rare:'РЕДКИЙ', common:'ОБЫЧНЫЙ' };
const CAT_CONFIG = [
  { key:'all', icon:'🏪', label:'Все' },
  { key:'food', icon:'🍞', label:'Еда' },
  { key:'merch', icon:'👕', label:'Мерч' },
  { key:'digital', icon:'🎨', label:'Цифровое' },
  { key:'privilege', icon:'⭐', label:'Привилегии' },
  { key:'cosmetic', icon:'✨', label:'Косметика' },
];
const SECTION_TITLES = { all:'Все товары', food:'Еда', merch:'Мерч', digital:'Цифровое', privilege:'Привилегии', cosmetic:'Косметика' };

function plural(n, forms) {
  return forms[n % 10 === 1 && n % 100 !== 11 ? 0 : n % 10 >= 2 && n % 10 <= 4 && (n % 100 < 10 || n % 100 >= 20) ? 1 : 2];
}

/* ═══ Confetti particle class ═══ */
class ConfettiPiece {
  constructor(x, y) {
    this.x = x; this.y = y;
    this.w = 4 + Math.random() * 4; this.h = 8 + Math.random() * 6;
    this.vx = (Math.random() - 0.5) * 8; this.vy = -6 - Math.random() * 8;
    this.rot = Math.random() * 360; this.rv = (Math.random() - 0.5) * 12;
    this.c = ['#F0C850','#FFE17A','#E84057','#4A90FF','#A56EFF','#3DDC84','#FF8A8A'][Math.floor(Math.random() * 7)];
    this.life = 120 + Math.random() * 60; this.ml = this.life;
  }
  update() { this.vy += 0.15; this.vx *= 0.99; this.x += this.vx; this.y += this.vy; this.rot += this.rv; this.life--; }
  draw(ctx) {
    const a = Math.max(0, this.life / this.ml);
    ctx.save(); ctx.translate(this.x, this.y); ctx.rotate(this.rot * Math.PI / 180);
    ctx.globalAlpha = a; ctx.fillStyle = this.c; ctx.fillRect(-this.w / 2, -this.h / 2, this.w, this.h); ctx.restore();
  }
}

/* ═══ COMPONENT ═══ */
export default function FieldShop() {
  const navigate = useNavigate();
  const canvasRef = useRef(null);
  const audioCtxRef = useRef(null);
  const confRef = useRef([]);
  const confAnimRef = useRef(false);
  const balElRef = useRef(null);

  const [balance, setBalance] = useState(0);
  const [items, setItems] = useState([]);
  const [category, setCategory] = useState('all');
  const [selectedItem, setSelectedItem] = useState(null);
  const [showModal, setShowModal] = useState(false);
  const [showSuccess, setShowSuccess] = useState(false);
  const [successItem, setSuccessItem] = useState(null);
  const [loading, setLoading] = useState(true);

  /* ── Load data ── */
  useEffect(() => {
    Promise.all([
      fieldApi.get('/gamification/wallet').catch(() => ({ runes: 0 })),
      fieldApi.get('/gamification/shop').catch(() => ({ items: [] })),
    ]).then(([wallet, shop]) => {
      setBalance(wallet.runes || 0);
      const apiItems = shop.items || [];
      setItems(apiItems.map(it => ({
        ...it, rarity: it.rarity || 'common', stock: it.current_stock ?? it.stock ?? 99, limited: it.is_limited || it.limited || false,
      })));
    }).finally(() => setLoading(false));
  }, []);

  /* ── Canvas resize ── */
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const resize = () => {
      canvas.width = innerWidth * devicePixelRatio;
      canvas.height = innerHeight * devicePixelRatio;
      const ctx = canvas.getContext('2d');
      ctx.setTransform(devicePixelRatio, 0, 0, devicePixelRatio, 0, 0);
    };
    resize();
    window.addEventListener('resize', resize);
    return () => window.removeEventListener('resize', resize);
  }, []);

  /* ── Init audio on first interaction ── */
  const initAudio = useCallback(() => {
    if (!audioCtxRef.current) {
      audioCtxRef.current = new (window.AudioContext || window.webkitAudioContext)();
    }
  }, []);

  useEffect(() => {
    const h = () => initAudio();
    document.addEventListener('touchstart', h, { once: true });
    document.addEventListener('click', h, { once: true });
    return () => { document.removeEventListener('touchstart', h); document.removeEventListener('click', h); };
  }, [initAudio]);

  /* ── Haptic helper ── */
  const hap = useCallback((pattern) => { if (navigator.vibrate) navigator.vibrate(pattern); }, []);

  /* ── Play win sound ── */
  const playWinSound = useCallback(() => {
    initAudio();
    const au = audioCtxRef.current;
    if (!au) return;
    [523, 659, 784].forEach((f, i) => {
      const o = au.createOscillator(), g = au.createGain();
      o.connect(g); g.connect(au.destination);
      o.frequency.value = f; o.type = 'sine'; g.gain.value = 0.06;
      g.gain.exponentialRampToValueAtTime(0.001, au.currentTime + 0.15 * (i + 1) + 0.3);
      o.start(au.currentTime + 0.12 * i); o.stop(au.currentTime + 0.15 * (i + 1) + 0.3);
    });
  }, [initAudio]);

  /* ── Confetti ── */
  const fireConfetti = useCallback(() => {
    const cx = innerWidth / 2, cy = innerHeight / 3;
    for (let i = 0; i < 60; i++) confRef.current.push(new ConfettiPiece(cx, cy));
    if (!confAnimRef.current) {
      confAnimRef.current = true;
      const animate = () => {
        const canvas = canvasRef.current;
        if (!canvas) { confAnimRef.current = false; return; }
        const ctx = canvas.getContext('2d');
        ctx.clearRect(0, 0, canvas.width / devicePixelRatio, canvas.height / devicePixelRatio);
        confRef.current = confRef.current.filter(p => p.life > 0);
        confRef.current.forEach(p => { p.update(); p.draw(ctx); });
        if (confRef.current.length) requestAnimationFrame(animate);
        else confAnimRef.current = false;
      };
      animate();
    }
  }, []);

  /* ── Animate balance counter ── */
  const animateBalance = useCallback((from, to) => {
    const el = balElRef.current;
    if (!el) return;
    const t0 = performance.now();
    const dur = 600;
    const tick = (now) => {
      const p = Math.min((now - t0) / dur, 1);
      const eased = 1 - Math.pow(1 - p, 3);
      el.textContent = Math.round(from + (to - from) * eased).toLocaleString('ru');
      if (p < 1) requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  }, []);

  /* ── Open purchase modal ── */
  const openModal = useCallback((item) => {
    if (!item || item.stock <= 0) return;
    setSelectedItem(item);
    setShowModal(true);
    hap([20]);
  }, [hap]);

  /* ── Close purchase modal ── */
  const closeModal = useCallback(() => {
    setShowModal(false);
    setTimeout(() => setSelectedItem(null), 300);
  }, []);

  /* ── Confirm purchase ── */
  const confirmPurchase = useCallback(async () => {
    if (!selectedItem || balance < selectedItem.price_runes) return;
    const item = selectedItem;
    const oldBal = balance;
    const newBal = oldBal - item.price_runes;

    // Optimistic update
    setBalance(newBal);
    setItems(prev => prev.map(it => it.id === item.id ? { ...it, stock: it.stock - 1 } : it));
    animateBalance(oldBal, newBal);
    closeModal();

    // Fire API
    try {
      await fieldApi.post('/gamification/shop/buy', { item_id: item.id });
    } catch {
      // Revert on error
      setBalance(oldBal);
      setItems(prev => prev.map(it => it.id === item.id ? { ...it, stock: it.stock + 1 } : it));
      return;
    }

    // Show success after modal closes
    setTimeout(() => {
      setSuccessItem(item);
      setShowSuccess(true);
      hap([30, 20, 50]);
      fireConfetti();
      playWinSound();
    }, 400);
  }, [selectedItem, balance, animateBalance, closeModal, hap, fireConfetti, playWinSound]);

  /* ── Close success modal ── */
  const closeSuccess = useCallback(() => {
    setShowSuccess(false);
    setTimeout(() => setSuccessItem(null), 300);
  }, []);

  /* ── Filtered items ── */
  const filtered = useMemo(() =>
    category === 'all' ? items : items.filter(i => i.category === category),
  [items, category]);

  /* ── Category counts ── */
  const counts = useMemo(() => {
    const c = { all: items.length, food: 0, merch: 0, digital: 0, privilege: 0, cosmetic: 0 };
    items.forEach(i => { if (c[i.category] !== undefined) c[i.category]++; });
    return c;
  }, [items]);

  /* ── Featured (banner) item ── */
  const featured = useMemo(() => items.find(i => i.limited && i.stock > 0) || items[0], [items]);

  /* ── Stars data ── */
  const stars = useMemo(() =>
    Array.from({ length: 20 }, (_, i) => ({
      left: Math.random() * 100, top: Math.random() * 40,
      size: 1 + Math.random() * 2, delay: Math.random() * 3, dur: 2 + Math.random() * 2,
    })),
  []);

  /* ── Skeleton loader ── */
  if (loading) {
    return (
      <>
        <style>{SHOP_CSS}</style>
        <div className="fshop">
          <div className="fshop-page" style={{ padding: '60px 16px' }}>
            {[1, 2, 3, 4, 5, 6].map(i => (
              <div key={i} className="fshop-skeleton" style={{
                height: 180, borderRadius: 16, marginBottom: 10,
                background: 'linear-gradient(90deg, #141828 25%, #1a2040 50%, #141828 75%)',
                backgroundSize: '200% 100%', animation: 'fshop-shimmer 1.5s infinite',
              }} />
            ))}
          </div>
        </div>
      </>
    );
  }

  const canBuy = selectedItem ? balance >= selectedItem.price_runes : false;
  const afterBal = selectedItem ? balance - selectedItem.price_runes : 0;

  return (
    <>
      <style>{SHOP_CSS}</style>

      {/* Background */}
      <div className="fshop">
        <div className="fshop-bg">
          <div className="fshop-bg-glow g1" />
          <div className="fshop-bg-glow g2" />
          <div className="fshop-bg-glow g3" />
          <div className="fshop-stars">
            {stars.map((s, i) => (
              <div key={i} className="fshop-s" style={{
                left: `${s.left}%`, top: `${s.top}%`, width: s.size, height: s.size,
                animationDelay: `${s.delay}s`, animationDuration: `${s.dur}s`,
              }} />
            ))}
          </div>
        </div>

        <canvas ref={canvasRef} className="fshop-confetti" />

        <div className="fshop-page">

          {/* ═══ TOP BAR ═══ */}
          <div className="fshop-top">
            <div className="fshop-top-back" onClick={() => navigate(-1)}>
              <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="rgba(255,255,255,.7)" strokeWidth="2.2" strokeLinecap="round"><path d="M15 18l-6-6 6-6" /></svg>
            </div>
            <div className="fshop-top-center">
              <div className="fshop-top-title">МАГАЗИН АСГАРДА</div>
              <div className="fshop-top-sub">ТРАТЬ РУНЫ С УМОМ</div>
            </div>
            <div className="fshop-wallet">
              <div className="fshop-wallet-coin">ᚱ</div>
              <span className="fshop-wallet-num" ref={balElRef}>{balance.toLocaleString('ru')}</span>
            </div>
          </div>

          {/* ═══ BANNER ═══ */}
          {featured && (
            <div className="fshop-banner" onClick={() => openModal(featured)}>
              {featured.limited && <div className="fshop-banner-tag">ЛИМИТКА</div>}
              <div className="fshop-banner-row">
                <div className="fshop-banner-icon">
                  {featured.icon_svg
                    ? <span className="fshop-svg-icon" dangerouslySetInnerHTML={{ __html: featured.icon_svg }} />
                    : featured.icon}
                </div>
                <div className="fshop-banner-text">
                  <div className="fshop-banner-title">{featured.name}</div>
                  <div className="fshop-banner-desc">{featured.description}{featured.stock < 10 ? ` Осталось ${featured.stock} шт.` : ''}</div>
                </div>
              </div>
            </div>
          )}

          {/* ═══ CATEGORIES ═══ */}
          <div className="fshop-cats">
            {CAT_CONFIG.map(c => (
              <button key={c.key} className={`fshop-cat-btn${category === c.key ? ' active' : ''}`}
                onClick={() => { setCategory(c.key); hap([15]); }}>
                <span className="fshop-cat-icon">{c.icon}</span>
                {c.label}
                <span className="fshop-cat-count">{counts[c.key]}</span>
              </button>
            ))}
          </div>

          {/* ═══ SECTION HEADER ═══ */}
          <div className="fshop-section-head">
            <div className="fshop-section-title">{SECTION_TITLES[category]}</div>
            <div className="fshop-section-count">{filtered.length} {plural(filtered.length, ['товар','товара','товаров'])}</div>
          </div>

          {/* ═══ GRID ═══ */}
          <div className="fshop-grid">
            {filtered.length === 0 ? (
              <div className="fshop-empty" style={{ gridColumn: '1/-1' }}>
                <div className="fshop-empty-icon">🪶</div>
                <div className="fshop-empty-text">Пусто... пока</div>
              </div>
            ) : filtered.map((item) => {
              const canAfford = balance >= item.price_runes;
              const soldOut = item.stock <= 0;
              const deficit = item.price_runes - balance;
              const cls = ['fshop-card', item.category, !canAfford && !soldOut ? 'locked' : '', soldOut ? 'soldout' : ''].filter(Boolean).join(' ');
              return (
                <div key={item.id} className={cls} onClick={() => !soldOut && openModal(item)}>
                  <div className="fshop-card-img">
                    <div className="fshop-card-glow" />
                    <div className="fshop-card-icon">
                      {item.icon_svg
                        ? <span className="fshop-svg-icon" dangerouslySetInnerHTML={{ __html: item.icon_svg }} />
                        : item.icon}
                    </div>
                    <div className={`fshop-card-rarity ${item.rarity}`}>{RARITY_LABELS[item.rarity]}</div>
                    {item.limited && <div className="fshop-card-limited">ЛИМИТКА</div>}
                  </div>
                  {soldOut && <div className="fshop-card-soldout-badge">РАСКУПЛЕНО</div>}
                  <div className="fshop-card-body">
                    <div className="fshop-card-name">{item.name}</div>
                    <div className="fshop-card-desc">{item.description}</div>
                    <div className="fshop-card-price-row">
                      <div className="fshop-card-price">
                        <span className="fshop-cp-coin">ᚱ</span>
                        <span className="fshop-cp-num">{item.price_runes.toLocaleString('ru')}</span>
                      </div>
                      <button className={`fshop-card-buy${canAfford && !soldOut ? ' can' : ''}`}>
                        {soldOut ? 'Нет' : 'Купить'}
                      </button>
                    </div>
                    {!canAfford && !soldOut && (
                      <div className="fshop-card-deficit">
                        <svg viewBox="0 0 24 24" width="10" height="10" fill="none" stroke="#E84057" strokeWidth="2.5" strokeLinejoin="round">
                          <path d="M12 2L2 22h20L12 2z" /><path d="M12 9v4M12 17h.01" />
                        </svg>
                        Не хватает {deficit > 0 ? deficit.toLocaleString('ru') : 0} ᚱ
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>

        </div>

        {/* ═══ PURCHASE MODAL ═══ */}
        <div className={`fshop-modal-ov${showModal ? ' on' : ''}`} onClick={closeModal} />
        <div className={`fshop-modal${showModal ? ' on' : ''}`}>
          <div className="fshop-modal-card">
            <div className="fshop-modal-handle" />
            {selectedItem && (
              <>
                <div className="fshop-modal-icon-area">
                  <div className={`fshop-modal-glow ${selectedItem.category}`} />
                  <div className="fshop-modal-emoji" key={selectedItem.id}>
                    {selectedItem.icon_svg
                      ? <span className="fshop-svg-icon fshop-svg-icon--lg" dangerouslySetInnerHTML={{ __html: selectedItem.icon_svg }} />
                      : selectedItem.icon}
                  </div>
                </div>
                <div style={{ textAlign: 'center' }}>
                  <div className={`fshop-modal-rarity ${selectedItem.rarity}`}>{RARITY_LABELS_FULL[selectedItem.rarity]}</div>
                  <div className="fshop-modal-name">{selectedItem.name}</div>
                  <div className="fshop-modal-desc">
                    {selectedItem.description}
                    {selectedItem.limited ? `\n\nОсталось: ${selectedItem.stock} шт.` : ''}
                  </div>
                  <div className="fshop-modal-price-box">
                    <div className="fshop-mpb-coin">ᚱ</div>
                    <span className="fshop-mpb-num">{selectedItem.price_runes.toLocaleString('ru')}</span>
                  </div>
                  <div className="fshop-modal-balance">
                    {canBuy
                      ? <>После покупки: <b>{afterBal.toLocaleString('ru')} ᚱ</b></>
                      : <span style={{ color: 'var(--fshop-red)' }}>Не хватает {(selectedItem.price_runes - balance).toLocaleString('ru')} ᚱ</span>
                    }
                  </div>
                  <button className="fshop-modal-confirm"
                    style={{ opacity: canBuy ? 1 : 0.35, pointerEvents: canBuy ? 'auto' : 'none' }}
                    onClick={confirmPurchase}>
                    {canBuy ? `Купить за ${selectedItem.price_runes.toLocaleString('ru')} ᚱ` : 'Недостаточно рун'}
                  </button>
                  <button className="fshop-modal-cancel" onClick={closeModal}>Отмена</button>
                </div>
              </>
            )}
          </div>
        </div>

        {/* ═══ SUCCESS MODAL ═══ */}
        <div className={`fshop-success-ov${showSuccess ? ' on' : ''}`} onClick={closeSuccess} />
        <div className={`fshop-success-modal${showSuccess ? ' on' : ''}`}>
          <div className="fshop-success-card">
            <div className="fshop-success-check">
              <svg viewBox="0 0 24 24" width="36" height="36" fill="none" stroke="#fff" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                <path d="M20 6L9 17l-5-5" />
              </svg>
            </div>
            <div className="fshop-success-title">Добыча твоя!</div>
            <div className="fshop-success-desc">
              {successItem?.category === 'food' ? 'Забери у прораба или на складе объекта!' :
               successItem?.category === 'merch' ? 'Мерч добавлен! Забери на складе у кладовщика.' :
               successItem?.category === 'digital' ? 'Цифровой контент активирован!' :
               successItem?.category === 'privilege' ? 'Привилегия активирована!' :
               'Косметика применена к профилю!'}
            </div>
            {successItem && (
              <div className="fshop-success-item">
                <span className="fshop-success-item-icon">
                  {successItem.icon_svg
                    ? <span className="fshop-svg-icon fshop-svg-icon--md" dangerouslySetInnerHTML={{ __html: successItem.icon_svg }} />
                    : successItem.icon}
                </span>
                <span className="fshop-success-item-name">{successItem.name}</span>
              </div>
            )}
            <button className="fshop-success-btn" onClick={closeSuccess}>Отлично!</button>
          </div>
        </div>

      </div>
    </>
  );
}

/* ═══════════════════════════════════════════════════════════
   CSS — 1:1 from FIELD_SHOP_RENDER.html
   Scoped with .fshop prefix
   ═══════════════════════════════════════════════════════════ */
const SHOP_CSS = `
.fshop {
  --fshop-bg:#0b0e1a;--fshop-card:#141828;--fshop-card2:#1a2040;--fshop-card3:#1e2550;
  --fshop-gold:#F0C850;--fshop-gold-d:#C8940A;--fshop-gold-l:#FFE17A;
  --fshop-red:#E84057;--fshop-blue:#4A90FF;--fshop-purple:#A56EFF;--fshop-green:#3DDC84;
  --fshop-t1:#fff;--fshop-t2:rgba(255,255,255,.7);--fshop-t3:rgba(255,255,255,.4);
  --fshop-radius:16px;
  position:relative;min-height:100dvh;width:100%;background:var(--fshop-bg);color:var(--fshop-t1);
  font-family:-apple-system,BlinkMacSystemFont,'SF Pro Round',system-ui,sans-serif;
  -webkit-user-select:none;user-select:none;overflow-x:hidden;
}
@keyframes fshop-shimmer{0%{background-position:200% 0}100%{background-position:-200% 0}}
.fshop-skeleton{display:block}

/* ═══ BG ═══ */
.fshop-bg{position:fixed;inset:0;z-index:0;overflow:hidden;pointer-events:none}
.fshop-bg-glow{position:absolute;border-radius:50%;filter:blur(80px);opacity:.2}
.fshop-bg-glow.g1{width:300px;height:300px;top:-80px;left:-60px;background:var(--fshop-gold)}
.fshop-bg-glow.g2{width:250px;height:250px;bottom:10%;right:-80px;background:var(--fshop-purple)}
.fshop-bg-glow.g3{width:200px;height:200px;top:50%;left:40%;background:var(--fshop-blue);opacity:.08}
.fshop-stars{position:absolute;inset:0}
.fshop-s{position:absolute;background:#fff;border-radius:50%;animation:fshop-tw 3s ease-in-out infinite alternate}
@keyframes fshop-tw{0%{opacity:.1;transform:scale(.8)}100%{opacity:.5;transform:scale(1.3)}}

.fshop-page{position:relative;z-index:5;display:flex;flex-direction:column;min-height:100dvh;max-width:430px;margin:0 auto;
  padding-bottom:max(env(safe-area-inset-bottom),20px)}
.fshop-confetti{position:fixed;inset:0;z-index:400;pointer-events:none}

/* ═══ TOP BAR ═══ */
.fshop-top{display:flex;align-items:center;justify-content:space-between;padding:10px 16px;
  padding-top:max(env(safe-area-inset-top),10px);position:sticky;top:0;z-index:50;
  background:linear-gradient(180deg,var(--fshop-bg) 60%,transparent);backdrop-filter:blur(12px);-webkit-backdrop-filter:blur(12px)}
.fshop-top-back{width:36px;height:36px;border-radius:12px;background:rgba(255,255,255,.06);display:flex;align-items:center;justify-content:center;
  cursor:pointer;transition:background .2s}
.fshop-top-back:active{background:rgba(255,255,255,.12)}
.fshop-top-center{text-align:center}
.fshop-top-title{font-size:15px;font-weight:800;letter-spacing:.08em;color:var(--fshop-gold)}
.fshop-top-sub{font-size:9px;color:var(--fshop-t3);letter-spacing:.15em;margin-top:1px}
.fshop-wallet{display:flex;align-items:center;gap:5px;padding:5px 12px 5px 8px;
  background:linear-gradient(135deg,#2a2008,#1a1505);border:1.5px solid rgba(240,200,80,.3);
  border-radius:20px;box-shadow:0 2px 10px rgba(240,200,80,.1);cursor:pointer;transition:all .2s}
.fshop-wallet:active{transform:scale(.96)}
.fshop-wallet-coin{width:22px;height:22px;border-radius:50%;
  background:radial-gradient(circle at 40% 35%,var(--fshop-gold-l),var(--fshop-gold),var(--fshop-gold-d));
  box-shadow:0 2px 4px rgba(0,0,0,.4),inset 0 -2px 3px rgba(0,0,0,.2);
  display:flex;align-items:center;justify-content:center;font-size:11px;font-weight:900;color:#5a3e00}
.fshop-wallet-num{font-size:15px;font-weight:800;color:var(--fshop-gold);font-variant-numeric:tabular-nums}

/* ═══ BANNER ═══ */
.fshop-banner{margin:4px 16px 8px;padding:14px 16px;border-radius:var(--fshop-radius);position:relative;overflow:hidden;
  background:linear-gradient(135deg,#1a1030,#0f1828,#1a1030);cursor:pointer;
  border:1px solid rgba(240,200,80,.12);box-shadow:0 4px 20px rgba(0,0,0,.3)}
.fshop-banner::before{content:'';position:absolute;inset:0;
  background:linear-gradient(135deg,rgba(240,200,80,.05),transparent 50%,rgba(165,110,255,.04));pointer-events:none}
.fshop-banner-row{display:flex;align-items:center;gap:12px}
.fshop-banner-icon{font-size:36px;filter:drop-shadow(0 0 10px rgba(240,200,80,.3))}
.fshop-banner-text{flex:1}
.fshop-banner-title{font-size:14px;font-weight:800;color:var(--fshop-gold)}
.fshop-banner-desc{font-size:11px;color:var(--fshop-t3);margin-top:2px;line-height:1.4}
.fshop-banner-tag{position:absolute;top:8px;right:10px;padding:2px 8px;border-radius:6px;font-size:8px;font-weight:800;
  letter-spacing:.12em;background:rgba(232,64,87,.15);color:var(--fshop-red);border:1px solid rgba(232,64,87,.2)}

/* ═══ CATEGORIES ═══ */
.fshop-cats{display:flex;gap:6px;padding:0 16px;margin:4px 0 12px;overflow-x:auto;-webkit-overflow-scrolling:touch;scrollbar-width:none}
.fshop-cats::-webkit-scrollbar{display:none}
.fshop-cat-btn{flex-shrink:0;display:flex;align-items:center;gap:6px;padding:8px 14px;border-radius:12px;border:none;
  font-size:12px;font-weight:700;color:var(--fshop-t3);background:var(--fshop-card);cursor:pointer;
  border:1.5px solid transparent;transition:all .25s;white-space:nowrap}
.fshop-cat-btn:active{transform:scale(.96)}
.fshop-cat-btn.active{color:var(--fshop-gold);background:linear-gradient(135deg,#2a2008,#1a1505);
  border-color:rgba(240,200,80,.3);box-shadow:0 2px 12px rgba(240,200,80,.1)}
.fshop-cat-icon{font-size:16px}
.fshop-cat-count{padding:2px 6px;border-radius:6px;font-size:9px;font-weight:800;
  background:rgba(255,255,255,.06);color:var(--fshop-t3)}
.fshop-cat-btn.active .fshop-cat-count{background:rgba(240,200,80,.12);color:var(--fshop-gold)}

/* ═══ SECTION HEADER ═══ */
.fshop-section-head{display:flex;align-items:center;justify-content:space-between;padding:16px 16px 8px}
.fshop-section-title{font-size:13px;font-weight:800;color:var(--fshop-t2);letter-spacing:.06em}
.fshop-section-count{font-size:11px;color:var(--fshop-t3)}

/* ═══ GRID ═══ */
.fshop-grid{display:grid;grid-template-columns:1fr 1fr;gap:10px;padding:0 16px}

/* ═══ CARD ═══ */
.fshop-card{position:relative;border-radius:var(--fshop-radius);overflow:hidden;
  background:var(--fshop-card);border:1px solid rgba(255,255,255,.04);
  box-shadow:0 4px 16px rgba(0,0,0,.2);transition:all .3s cubic-bezier(.34,1.56,.64,1);cursor:pointer}
.fshop-card:active{transform:scale(.96)}
@media(hover:hover){.fshop-card:hover{transform:translateY(-4px) scale(1.02);
  box-shadow:0 8px 30px rgba(0,0,0,.35);border-color:rgba(255,255,255,.08)}}

.fshop-card-img{position:relative;height:120px;display:flex;align-items:center;justify-content:center;overflow:hidden}
.fshop-card-img::before{content:'';position:absolute;inset:0;opacity:.5}
.fshop-card.food .fshop-card-img::before{background:linear-gradient(135deg,#1a1008,#0f180a)}
.fshop-card.merch .fshop-card-img::before{background:linear-gradient(135deg,#1a1030,#0f1828)}
.fshop-card.digital .fshop-card-img::before{background:linear-gradient(135deg,#0f1828,#0b1a20)}
.fshop-card.privilege .fshop-card-img::before{background:linear-gradient(135deg,#1a1020,#1a0818)}
.fshop-card.cosmetic .fshop-card-img::before{background:linear-gradient(135deg,#0e1520,#0b1a18)}
.fshop-card-icon{position:relative;z-index:2;font-size:48px;
  filter:drop-shadow(0 4px 12px rgba(0,0,0,.4));transition:all .4s cubic-bezier(.34,1.56,.64,1)}
@media(hover:hover){.fshop-card:hover .fshop-card-icon{transform:scale(1.15) rotate(-5deg)}}
.fshop-card-glow{position:absolute;width:80px;height:80px;border-radius:50%;filter:blur(25px);opacity:.3;z-index:1}
.fshop-card.food .fshop-card-glow{background:#84CC16}
.fshop-card.merch .fshop-card-glow{background:var(--fshop-gold)}
.fshop-card.digital .fshop-card-glow{background:var(--fshop-blue)}
.fshop-card.privilege .fshop-card-glow{background:var(--fshop-purple)}
.fshop-card.cosmetic .fshop-card-glow{background:var(--fshop-green)}

.fshop-card-rarity{position:absolute;top:8px;left:8px;padding:2px 8px;border-radius:6px;font-size:8px;font-weight:800;
  letter-spacing:.1em;z-index:3;backdrop-filter:blur(6px);-webkit-backdrop-filter:blur(6px)}
.fshop-card-rarity.common{background:rgba(61,220,132,.12);color:var(--fshop-green);border:1px solid rgba(61,220,132,.15)}
.fshop-card-rarity.rare{background:rgba(74,144,255,.12);color:var(--fshop-blue);border:1px solid rgba(74,144,255,.15)}
.fshop-card-rarity.epic{background:rgba(165,110,255,.12);color:var(--fshop-purple);border:1px solid rgba(165,110,255,.15)}
.fshop-card-rarity.legendary{background:rgba(240,200,80,.12);color:var(--fshop-gold);border:1px solid rgba(240,200,80,.2)}

.fshop-card-limited{position:absolute;top:8px;right:8px;padding:2px 6px;border-radius:6px;font-size:8px;font-weight:800;
  background:rgba(232,64,87,.15);color:var(--fshop-red);border:1px solid rgba(232,64,87,.2);z-index:3}

.fshop-card-body{padding:10px 12px 12px}
.fshop-card-name{font-size:13px;font-weight:700;line-height:1.3;display:-webkit-box;-webkit-line-clamp:2;
  -webkit-box-orient:vertical;overflow:hidden}
.fshop-card-desc{font-size:10px;color:var(--fshop-t3);margin-top:3px;line-height:1.3;display:-webkit-box;-webkit-line-clamp:2;
  -webkit-box-orient:vertical;overflow:hidden}

.fshop-card-price-row{display:flex;align-items:center;justify-content:space-between;margin-top:8px}
.fshop-card-price{display:flex;align-items:center;gap:4px}
.fshop-cp-coin{width:16px;height:16px;border-radius:50%;
  background:radial-gradient(circle at 40% 35%,var(--fshop-gold-l),var(--fshop-gold),var(--fshop-gold-d));
  display:flex;align-items:center;justify-content:center;font-size:8px;font-weight:900;color:#5a3e00;
  box-shadow:0 1px 3px rgba(0,0,0,.3)}
.fshop-cp-num{font-size:15px;font-weight:800;color:var(--fshop-gold);font-variant-numeric:tabular-nums}
.fshop-card-buy{padding:6px 12px;border-radius:10px;border:none;font-size:11px;font-weight:800;color:#fff;cursor:pointer;
  position:relative;overflow:hidden;transition:all .2s;background:rgba(255,255,255,.06);color:var(--fshop-t3);box-shadow:none}
.fshop-card-buy:active{transform:scale(.94)}
.fshop-card-buy.can{background:linear-gradient(135deg,var(--fshop-gold-d),var(--fshop-gold));color:#1a1000;
  box-shadow:0 3px 0 #8B6914,0 4px 12px rgba(240,200,80,.2)}
.fshop-card-buy.can:active{box-shadow:0 1px 0 #8B6914;transform:translateY(2px) scale(.98)}
.fshop-card-buy.can::after{content:'';position:absolute;top:0;left:-100%;width:40%;height:100%;
  background:linear-gradient(90deg,transparent,rgba(255,255,255,.2),transparent);animation:fshop-shine 3s infinite}
@keyframes fshop-shine{0%,100%{left:-100%}50%{left:150%}}

/* ═══ LOCKED ═══ */
.fshop-card.locked .fshop-card-img{filter:saturate(.3) brightness(.6)}
.fshop-card.locked .fshop-card-icon{filter:saturate(.2) brightness(.5) drop-shadow(0 4px 12px rgba(0,0,0,.4))}
.fshop-card.locked .fshop-card-name{color:var(--fshop-t3)}
.fshop-card.locked .fshop-card-glow{opacity:.08}
.fshop-card.locked .fshop-cp-num{color:var(--fshop-t3)}
.fshop-card.locked .fshop-card-buy{cursor:not-allowed}
.fshop-card.locked .fshop-card-buy::after{display:none}
.fshop-card-deficit{display:flex;align-items:center;gap:3px;font-size:9px;font-weight:700;color:var(--fshop-red);margin-top:3px}

/* ═══ SOLD OUT ═══ */
.fshop-card.soldout{pointer-events:none}
.fshop-card.soldout .fshop-card-img{filter:saturate(.2) brightness(.4)}
.fshop-card.soldout .fshop-card-body{opacity:.4}
.fshop-card-soldout-badge{display:none;position:absolute;top:50%;left:50%;transform:translate(-50%,-50%) rotate(-12deg);
  z-index:10;padding:6px 20px;border-radius:8px;font-size:12px;font-weight:900;letter-spacing:.15em;
  background:rgba(232,64,87,.15);color:var(--fshop-red);border:2px solid rgba(232,64,87,.3);
  backdrop-filter:blur(4px);-webkit-backdrop-filter:blur(4px)}
.fshop-card.soldout .fshop-card-soldout-badge{display:block}

/* ═══ MODAL OVERLAY ═══ */
.fshop-modal-ov{position:fixed;inset:0;z-index:200;background:rgba(0,0,0,0);pointer-events:none;transition:background .3s}
.fshop-modal-ov.on{background:rgba(0,0,0,.7);pointer-events:auto;backdrop-filter:blur(6px);-webkit-backdrop-filter:blur(6px)}

/* ═══ PURCHASE MODAL ═══ */
.fshop-modal{position:fixed;left:50%;bottom:0;width:100%;max-width:430px;transform:translate(-50%,110%);z-index:201;
  transition:transform .5s cubic-bezier(.34,1.56,.64,1)}
.fshop-modal.on{transform:translate(-50%,0)}
.fshop-modal-card{background:linear-gradient(180deg,var(--fshop-card2),var(--fshop-card));border-radius:28px 28px 0 0;
  border:1px solid rgba(255,255,255,.06);border-bottom:none;padding:20px;
  padding-bottom:max(env(safe-area-inset-bottom),28px);box-shadow:0 -10px 50px rgba(0,0,0,.5)}
.fshop-modal-handle{width:40px;height:4px;border-radius:2px;background:rgba(255,255,255,.12);margin:0 auto 16px}
.fshop-modal-icon-area{text-align:center;position:relative;height:100px;margin-bottom:8px}
.fshop-modal-glow{position:absolute;top:50%;left:50%;transform:translate(-50%,-50%);width:120px;height:120px;border-radius:50%;filter:blur(25px)}
.fshop-modal-glow.food{background:rgba(132,204,22,.2)}
.fshop-modal-glow.merch{background:rgba(240,200,80,.25)}
.fshop-modal-glow.digital{background:rgba(74,144,255,.2)}
.fshop-modal-glow.privilege{background:rgba(165,110,255,.2)}
.fshop-modal-glow.cosmetic{background:rgba(61,220,132,.2)}
.fshop-modal-emoji{position:relative;z-index:2;font-size:56px;line-height:100px;animation:fshop-mPop .5s cubic-bezier(.34,1.56,.64,1)}
@keyframes fshop-mPop{0%{transform:scale(0) rotate(-10deg)}60%{transform:scale(1.15) rotate(3deg)}100%{transform:scale(1) rotate(0)}}
.fshop-modal-rarity{display:inline-block;padding:3px 14px;border-radius:20px;font-size:9px;font-weight:800;
  letter-spacing:.1em;text-transform:uppercase;margin-bottom:6px}
.fshop-modal-rarity.common{background:rgba(61,220,132,.12);color:var(--fshop-green);border:1px solid rgba(61,220,132,.2)}
.fshop-modal-rarity.rare{background:rgba(74,144,255,.12);color:var(--fshop-blue);border:1px solid rgba(74,144,255,.2)}
.fshop-modal-rarity.epic{background:rgba(165,110,255,.12);color:var(--fshop-purple);border:1px solid rgba(165,110,255,.2)}
.fshop-modal-rarity.legendary{background:rgba(240,200,80,.12);color:var(--fshop-gold);border:1px solid rgba(240,200,80,.25)}
.fshop-modal-name{font-size:20px;font-weight:800;text-align:center;margin-top:4px}
.fshop-modal-desc{font-size:12px;color:var(--fshop-t2);text-align:center;margin:4px 0 16px;line-height:1.5;white-space:pre-line}

.fshop-modal-price-box{display:flex;align-items:center;justify-content:center;gap:8px;padding:12px 24px;
  border-radius:16px;background:rgba(240,200,80,.06);border:1px solid rgba(240,200,80,.1);margin:0 auto;width:fit-content}
.fshop-mpb-coin{width:28px;height:28px;border-radius:50%;
  background:radial-gradient(circle at 40% 35%,var(--fshop-gold-l),var(--fshop-gold),var(--fshop-gold-d));
  display:flex;align-items:center;justify-content:center;font-size:14px;font-weight:900;color:#5a3e00;
  box-shadow:0 2px 4px rgba(0,0,0,.3),inset 0 -2px 3px rgba(0,0,0,.2)}
.fshop-mpb-num{font-size:24px;font-weight:800;color:var(--fshop-gold);font-variant-numeric:tabular-nums}

.fshop-modal-balance{text-align:center;margin-top:8px;font-size:11px;color:var(--fshop-t3)}
.fshop-modal-balance b{color:var(--fshop-t2)}

.fshop-modal-confirm{display:block;width:100%;margin-top:16px;padding:16px;border-radius:16px;border:none;
  font-size:16px;font-weight:800;cursor:pointer;position:relative;overflow:hidden;
  background:linear-gradient(135deg,var(--fshop-gold-d),var(--fshop-gold));color:#1a1000;
  box-shadow:0 5px 0 #8B6914,0 6px 20px rgba(240,200,80,.2);transition:all .1s}
.fshop-modal-confirm:active{transform:translateY(4px);box-shadow:0 1px 0 #8B6914}
.fshop-modal-confirm::after{content:'';position:absolute;top:0;left:-100%;width:50%;height:100%;
  background:linear-gradient(90deg,transparent,rgba(255,255,255,.15),transparent);animation:fshop-shine 3s infinite}
.fshop-modal-cancel{display:block;width:100%;margin-top:8px;padding:12px;border-radius:12px;border:none;
  font-size:13px;font-weight:700;color:var(--fshop-t3);background:rgba(255,255,255,.04);cursor:pointer;transition:all .2s}
.fshop-modal-cancel:active{background:rgba(255,255,255,.08)}

/* ═══ SUCCESS MODAL ═══ */
.fshop-success-ov{position:fixed;inset:0;z-index:300;background:rgba(0,0,0,0);pointer-events:none;transition:background .3s}
.fshop-success-ov.on{background:rgba(0,0,0,.7);pointer-events:auto;backdrop-filter:blur(6px);-webkit-backdrop-filter:blur(6px)}
.fshop-success-modal{position:fixed;top:50%;left:50%;width:calc(100% - 48px);max-width:380px;
  transform:translate(-50%,-50%) scale(.7);z-index:301;opacity:0;pointer-events:none;
  transition:all .4s cubic-bezier(.34,1.56,.64,1)}
.fshop-success-modal.on{transform:translate(-50%,-50%) scale(1);opacity:1;pointer-events:auto}
.fshop-success-card{background:linear-gradient(180deg,var(--fshop-card2),var(--fshop-card));border-radius:24px;
  border:1px solid rgba(240,200,80,.15);padding:28px 24px;box-shadow:0 20px 60px rgba(0,0,0,.5);text-align:center}
.fshop-success-check{width:72px;height:72px;margin:0 auto 16px;border-radius:50%;
  background:linear-gradient(135deg,var(--fshop-green),#2a9d5e);display:flex;align-items:center;justify-content:center;
  box-shadow:0 6px 20px rgba(61,220,132,.3);animation:fshop-checkBounce .6s cubic-bezier(.34,1.56,.64,1)}
@keyframes fshop-checkBounce{0%{transform:scale(0)}60%{transform:scale(1.2)}100%{transform:scale(1)}}
.fshop-success-title{font-size:20px;font-weight:800;color:var(--fshop-gold);margin-bottom:4px}
.fshop-success-desc{font-size:13px;color:var(--fshop-t2);margin-bottom:16px;line-height:1.5}
.fshop-success-item{display:inline-flex;align-items:center;gap:8px;padding:8px 20px;border-radius:12px;
  background:rgba(240,200,80,.06);border:1px solid rgba(240,200,80,.1)}
.fshop-success-item-icon{font-size:28px}
.fshop-success-item-name{font-size:14px;font-weight:700}
.fshop-success-btn{display:block;width:100%;margin-top:20px;padding:14px;border-radius:14px;border:none;
  font-size:15px;font-weight:800;color:#1a1000;cursor:pointer;
  background:linear-gradient(135deg,var(--fshop-gold-d),var(--fshop-gold));
  box-shadow:0 4px 0 #8B6914,0 5px 16px rgba(240,200,80,.2);transition:all .1s}
.fshop-success-btn:active{transform:translateY(3px);box-shadow:0 1px 0 #8B6914}

/* ═══ EMPTY STATE ═══ */
.fshop-empty{text-align:center;padding:40px 20px}
.fshop-empty-icon{font-size:48px;margin-bottom:12px;opacity:.4}
.fshop-empty-text{font-size:14px;color:var(--fshop-t3)}

/* ═══ SVG ICONS ═══ */
.fshop-svg-icon{display:inline-flex;align-items:center;justify-content:center;width:48px;height:48px}
.fshop-svg-icon svg{width:48px;height:48px}
.fshop-svg-icon--lg{width:56px;height:56px}
.fshop-svg-icon--lg svg{width:56px;height:56px}
.fshop-svg-icon--md{width:36px;height:36px}
.fshop-svg-icon--md svg{width:36px;height:36px}
.fshop-banner-icon .fshop-svg-icon{width:52px;height:52px}
.fshop-banner-icon .fshop-svg-icon svg{width:52px;height:52px}

/* ═══ SCROLLBAR ═══ */
.fshop ::-webkit-scrollbar{width:0;height:0}
`;
