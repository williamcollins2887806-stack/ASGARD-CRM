import { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { fieldApi } from '@/api/fieldClient';

// ═══════���═══════════════════════════════════════════════════════════════════
// WHEEL OF NORNS — Full 1:1 port of WHEEL_OF_NORNS_RENDER.html (991 lines)
// + Bonus: gold dust particles, screen shake, triumph fanfare, anticipation
// ═════════════════════���══════════════════════════════════════════���══════════

const ITEM_H = 66;
const VISIBLE = 3;

// ═══ STYLES ═══
const WHEEL_CSS = `
.wn-root{--bg:#0b0e1a;--card:#141828;--card2:#1a2040;--gold:#F0C850;--gold-d:#C8940A;--gold-l:#FFE17A;
  --red:#E84057;--blue:#4A90FF;--purple:#A56EFF;--green:#3DDC84;--t1:#fff;--t2:rgba(255,255,255,.7);--t3:rgba(255,255,255,.4);
  background:var(--bg);color:var(--t1);font-family:-apple-system,BlinkMacSystemFont,'SF Pro Round',system-ui,sans-serif;
  overflow:hidden;height:100%;width:100%;-webkit-user-select:none;user-select:none;position:relative}
.wn-bg{position:absolute;inset:0;z-index:0;overflow:hidden}
.wn-glow{position:absolute;border-radius:50%;filter:blur(80px);opacity:.25}
.wn-g1{width:300px;height:300px;top:-50px;left:-50px;background:var(--blue)}
.wn-g2{width:250px;height:250px;bottom:-30px;right:-60px;background:var(--purple)}
.wn-g3{width:200px;height:200px;top:40%;left:50%;transform:translateX(-50%);background:var(--gold);opacity:.08}
.wn-stars{position:absolute;inset:0}.wn-s{position:absolute;background:#fff;border-radius:50%;animation:wnTw 3s ease-in-out infinite alternate}
@keyframes wnTw{0%{opacity:.1;transform:scale(.8)}100%{opacity:.5;transform:scale(1.3)}}
.wn-page{position:relative;z-index:5;display:flex;flex-direction:column;height:100%;max-width:430px;margin:0 auto}
.wn-top{display:flex;align-items:center;justify-content:space-between;padding:10px 16px;padding-top:max(env(safe-area-inset-top),10px)}
.wn-back{width:36px;height:36px;border-radius:12px;background:rgba(255,255,255,.06);display:flex;align-items:center;justify-content:center;cursor:pointer;border:none}
.wn-title{font-size:15px;font-weight:800;letter-spacing:.08em;color:var(--gold)}
.wn-sub{font-size:9px;color:var(--t3);letter-spacing:.15em;margin-top:1px;text-align:center}
.wn-wallet{display:flex;align-items:center;gap:5px;padding:5px 12px 5px 8px;background:linear-gradient(135deg,#2a2008,#1a1505);
  border:1.5px solid rgba(240,200,80,.3);border-radius:20px;box-shadow:0 2px 10px rgba(240,200,80,.1)}
.wn-coin{width:22px;height:22px;border-radius:50%;background:radial-gradient(circle at 40% 35%,var(--gold-l),var(--gold),var(--gold-d));
  box-shadow:0 2px 4px rgba(0,0,0,.4),inset 0 -2px 3px rgba(0,0,0,.2);display:flex;align-items:center;justify-content:center;font-size:11px;font-weight:900;color:#5a3e00}
.wn-bal{font-size:15px;font-weight:800;color:var(--gold);font-variant-numeric:tabular-nums}
.wn-lvl{display:flex;align-items:center;gap:8px;margin:4px 16px 0}
.wn-lvl-badge{padding:3px 10px;border-radius:10px;font-size:11px;font-weight:800;background:linear-gradient(135deg,var(--gold-d),var(--gold));color:#1a1000;box-shadow:0 2px 6px rgba(240,200,80,.25)}
.wn-lvl-track{flex:1;height:10px;border-radius:5px;background:rgba(255,255,255,.06);overflow:hidden;box-shadow:inset 0 2px 4px rgba(0,0,0,.3)}
.wn-lvl-fill{height:100%;border-radius:5px;background:linear-gradient(90deg,var(--gold-d),var(--gold),var(--gold-l));position:relative}
.wn-lvl-fill::after{content:'';position:absolute;top:1px;left:4px;right:4px;height:4px;border-radius:3px;background:rgba(255,255,255,.3)}
.wn-lvl-text{font-size:10px;color:var(--t3);font-weight:600;white-space:nowrap}
.wn-streak{display:flex;align-items:center;gap:8px;margin:8px 16px 0;padding:10px 14px;background:var(--card);border-radius:16px;border:1px solid rgba(255,255,255,.04)}
.wn-fire{font-size:28px;filter:drop-shadow(0 0 8px rgba(255,120,0,.5));animation:wnFlame .8s ease-in-out infinite alternate}
@keyframes wnFlame{0%{transform:scale(1) rotate(-3deg)}100%{transform:scale(1.1) rotate(3deg)}}
.wn-streak-info{flex:1}.wn-streak-title{font-size:13px;font-weight:700}
.wn-dots{display:flex;gap:4px;margin-top:5px}
.wn-dot{width:100%;height:7px;border-radius:4px;background:rgba(255,255,255,.06)}
.wn-dot-on{background:linear-gradient(90deg,var(--gold-d),var(--gold));position:relative}
.wn-dot-on::after{content:'';position:absolute;top:1px;left:2px;right:2px;height:3px;border-radius:2px;background:rgba(255,255,255,.3)}
.wn-dot-now{border:1.5px solid var(--gold);animation:wnDotP 1.5s ease-in-out infinite}
@keyframes wnDotP{0%,100%{box-shadow:0 0 3px var(--gold-d)}50%{box-shadow:0 0 10px var(--gold)}}
.wn-mult{padding:4px 10px;border-radius:10px;font-size:12px;font-weight:800;background:linear-gradient(135deg,var(--red),#ff6b6b);color:#fff;box-shadow:0 2px 8px rgba(232,64,87,.3)}
.wn-viking-area{position:relative;z-index:15;display:flex;justify-content:center;margin-top:4px;height:130px;pointer-events:none}
.wn-viking{position:relative;width:120px;height:130px}
.wn-viking svg{width:100%;height:100%;overflow:visible;filter:drop-shadow(0 6px 15px rgba(0,0,0,.5))}
.wn-bubble{position:absolute;top:2px;left:105%;padding:5px 12px;border-radius:14px;background:var(--card2);
  border:1px solid rgba(255,255,255,.08);font-size:12px;font-weight:700;white-space:nowrap;
  box-shadow:0 4px 15px rgba(0,0,0,.4);opacity:0;transform:scale(.7);transition:all .25s cubic-bezier(.34,1.56,.64,1);pointer-events:none}
.wn-bubble::before{content:'';position:absolute;left:-5px;top:50%;transform:translateY(-50%);border:5px solid transparent;border-right-color:var(--card2)}
.wn-bubble-on{opacity:1;transform:scale(1)}
.wn-wheel{flex:1;display:flex;flex-direction:column;align-items:center;justify-content:center;position:relative;z-index:10}
.wn-drum-wrap{position:relative;width:calc(100% - 32px);max-width:360px;height:200px;perspective:600px}
.wn-frame{position:absolute;inset:-8px;border-radius:24px;background:linear-gradient(180deg,#3d2f12,#2a1f0e,#3d2f12);
  border:2px solid rgba(240,200,80,.3);box-shadow:0 8px 30px rgba(0,0,0,.5),0 0 0 1px rgba(240,200,80,.1),inset 0 2px 0 rgba(255,255,255,.08),inset 0 -2px 0 rgba(0,0,0,.3)}
.wn-frame::before{content:'ᚠ';position:absolute;top:8px;left:12px;font-size:14px;color:rgba(240,200,80,.2)}
.wn-frame::after{content:'ᚱ';position:absolute;top:8px;right:12px;font-size:14px;color:rgba(240,200,80,.2)}
.wn-viewport{position:relative;width:100%;height:100%;overflow:hidden;border-radius:16px;background:linear-gradient(180deg,#08090f,#0d1020,#08090f)}
.wn-vp-top{position:absolute;top:0;left:0;right:0;height:50px;z-index:5;background:linear-gradient(180deg,rgba(8,9,15,.95),transparent);pointer-events:none}
.wn-vp-bot{position:absolute;bottom:0;left:0;right:0;height:50px;z-index:5;background:linear-gradient(0deg,rgba(8,9,15,.95),transparent);pointer-events:none}
.wn-highlight{position:absolute;top:50%;left:0;right:0;height:66px;transform:translateY(-50%);z-index:4;
  border-top:2px solid rgba(240,200,80,.35);border-bottom:2px solid rgba(240,200,80,.35);
  background:rgba(240,200,80,.04);pointer-events:none;box-shadow:0 0 30px rgba(240,200,80,.06)}
.wn-strip{position:absolute;left:0;right:0;z-index:2;will-change:transform}
.wn-ptr{position:absolute;top:50%;transform:translateY(-50%);z-index:6;width:14px;height:20px}
.wn-ptr-l{left:-1px}.wn-ptr-r{right:-1px}
.wn-item{display:flex;align-items:center;gap:14px;height:66px;padding:0 20px;border-bottom:1px solid rgba(255,255,255,.03)}
.wn-di-icon{font-size:30px;width:44px;height:44px;border-radius:12px;display:flex;align-items:center;justify-content:center;flex-shrink:0}
.wn-di-icon.common{background:rgba(61,220,132,.08);border:1px solid rgba(61,220,132,.15)}
.wn-di-icon.rare{background:rgba(74,144,255,.08);border:1px solid rgba(74,144,255,.15)}
.wn-di-icon.epic{background:rgba(165,110,255,.08);border:1px solid rgba(165,110,255,.15)}
.wn-di-icon.legendary{background:rgba(240,200,80,.1);border:1px solid rgba(240,200,80,.2);box-shadow:0 0 12px rgba(240,200,80,.08)}
.wn-di-name{font-size:14px;font-weight:700;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;color:var(--t1)}
.wn-di-desc{font-size:11px;color:var(--t3);margin-top:1px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.wn-di-tag{flex-shrink:0;padding:3px 10px;border-radius:8px;font-size:10px;font-weight:700}
.wn-di-tag.rare{background:rgba(74,144,255,.1);color:var(--blue)}
.wn-di-tag.epic{background:rgba(165,110,255,.1);color:var(--purple)}
.wn-di-tag.legendary{background:rgba(240,200,80,.1);color:var(--gold)}
.wn-spin-area{position:relative;z-index:10;padding:10px 16px 0;text-align:center}
.wn-btn{display:inline-flex;align-items:center;justify-content:center;gap:10px;width:100%;max-width:360px;padding:16px 24px;border-radius:18px;border:none;
  font-size:17px;font-weight:800;color:#fff;cursor:pointer;position:relative;overflow:hidden;
  background:linear-gradient(135deg,var(--red),#c0243a,var(--gold-d));box-shadow:0 6px 0 #7a1a28,0 8px 25px rgba(232,64,87,.3);transition:all .1s}
.wn-btn:active{transform:translateY(4px);box-shadow:0 2px 0 #7a1a28}
.wn-btn-off{opacity:.35;pointer-events:none}
.wn-btn::after{content:'';position:absolute;top:0;left:-100%;width:40%;height:100%;background:linear-gradient(90deg,transparent,rgba(255,255,255,.1),transparent);animation:wnShine 3s infinite}
@keyframes wnShine{0%,100%{left:-100%}50%{left:150%}}
.wn-btn-pulse{animation:wnBtnP 2s ease-in-out infinite}
@keyframes wnBtnP{0%,100%{box-shadow:0 6px 0 #7a1a28,0 8px 25px rgba(232,64,87,.3)}50%{box-shadow:0 6px 0 #7a1a28,0 8px 35px rgba(232,64,87,.45)}}
.wn-hint{text-align:center;font-size:12px;color:var(--t3);margin-top:6px;min-height:18px;position:relative;z-index:10}
.wn-loot{padding:8px 16px;padding-bottom:max(env(safe-area-inset-bottom),14px);position:relative;z-index:10}
.wn-loot-h{font-size:10px;font-weight:700;color:var(--t3);letter-spacing:.1em;text-transform:uppercase;margin-bottom:8px;text-align:center}
.wn-loot-row{display:flex;gap:8px;justify-content:center;flex-wrap:wrap}
.wn-lc{width:60px;padding:10px 4px 8px;border-radius:14px;text-align:center;background:var(--card);border:1px solid rgba(255,255,255,.04);box-shadow:0 4px 12px rgba(0,0,0,.2)}
.wn-lc-i{font-size:22px;display:block;margin-bottom:3px}
.wn-lc-n{font-size:8px;color:var(--t3);line-height:1.2}
.wn-lc.leg{border-color:rgba(240,200,80,.2);background:linear-gradient(180deg,rgba(240,200,80,.08),var(--card))}
.wn-lc.leg .wn-lc-i{animation:wnLG 2s ease-in-out infinite alternate}
@keyframes wnLG{0%{filter:brightness(1)}100%{filter:brightness(1.3) drop-shadow(0 0 4px var(--gold))}}
.wn-lc.epc{border-color:rgba(165,110,255,.2);background:linear-gradient(180deg,rgba(165,110,255,.06),var(--card))}
.wn-lc.rar{border-color:rgba(74,144,255,.15);background:linear-gradient(180deg,rgba(74,144,255,.05),var(--card))}
.wn-fx{position:absolute;inset:0;z-index:150;pointer-events:none;opacity:0}
.wn-fx-flash{background:radial-gradient(circle at 50% 50%,rgba(240,200,80,.35),transparent 70%);animation:wnFxO .5s forwards}
.wn-fx-mega{background:radial-gradient(circle at 50% 50%,rgba(240,200,80,.6),rgba(232,64,87,.2) 50%,transparent 80%);animation:wnFxO .8s forwards}
@keyframes wnFxO{from{opacity:1}to{opacity:0}}
.wn-fx-zap{animation:wnZF .12s ease 3}
@keyframes wnZF{0%{opacity:0}30%{opacity:1;background:rgba(240,200,80,.12)}60%{opacity:0}80%{opacity:.5;background:rgba(255,255,255,.08)}100%{opacity:0}}
.wn-ov{position:absolute;inset:0;z-index:200;background:rgba(0,0,0,0);pointer-events:none;transition:background .4s}
.wn-ov-on{background:rgba(0,0,0,.7);pointer-events:auto;backdrop-filter:blur(6px)}
.wn-rw{position:absolute;left:50%;bottom:0;width:100%;max-width:430px;transform:translate(-50%,110%);z-index:201;transition:transform .55s cubic-bezier(.34,1.56,.64,1)}
.wn-rw-on{transform:translate(-50%,0)}
.wn-rw-card{background:linear-gradient(180deg,var(--card2),var(--card));border-radius:28px 28px 0 0;border:1px solid rgba(255,255,255,.06);border-bottom:none;padding:20px;padding-bottom:max(env(safe-area-inset-bottom),28px);box-shadow:0 -10px 50px rgba(0,0,0,.5)}
.wn-rw-handle{width:40px;height:4px;border-radius:2px;background:rgba(255,255,255,.12);margin:0 auto 16px}
.wn-rw-icon{text-align:center;position:relative;height:110px;margin-bottom:8px}
.wn-rw-glow{position:absolute;top:50%;left:50%;transform:translate(-50%,-50%);width:140px;height:140px;border-radius:50%;filter:blur(20px)}
.wn-rw-glow.common{background:rgba(61,220,132,.2)}.wn-rw-glow.rare{background:rgba(74,144,255,.25)}
.wn-rw-glow.epic{background:rgba(165,110,255,.25)}.wn-rw-glow.legendary{background:rgba(240,200,80,.3)}
.wn-rw-emoji{position:relative;z-index:2;font-size:64px;line-height:110px;animation:wnRwB .7s cubic-bezier(.34,1.56,.64,1)}
@keyframes wnRwB{0%{transform:scale(0) rotate(-15deg)}60%{transform:scale(1.2) rotate(5deg)}100%{transform:scale(1) rotate(0)}}
.wn-rw-tag{display:inline-block;padding:4px 16px;border-radius:20px;font-size:10px;font-weight:800;letter-spacing:.1em;text-transform:uppercase;margin-bottom:6px}
.wn-rw-tag.common{background:rgba(61,220,132,.12);color:var(--green);border:1px solid rgba(61,220,132,.2)}
.wn-rw-tag.rare{background:rgba(74,144,255,.12);color:var(--blue);border:1px solid rgba(74,144,255,.2)}
.wn-rw-tag.epic{background:rgba(165,110,255,.12);color:var(--purple);border:1px solid rgba(165,110,255,.2)}
.wn-rw-tag.legendary{background:rgba(240,200,80,.12);color:var(--gold);border:1px solid rgba(240,200,80,.25)}
.wn-rw-name{font-size:22px;font-weight:800;text-align:center}
.wn-rw-desc{font-size:13px;color:var(--t2);text-align:center;margin:4px 0 14px}
.wn-rw-val{display:flex;align-items:center;justify-content:center;gap:8px;padding:10px 24px;border-radius:16px;font-size:22px;font-weight:800;margin:0 auto;width:fit-content}
.wn-rw-val.common{background:rgba(61,220,132,.1);color:var(--green)}
.wn-rw-val.rare{background:rgba(74,144,255,.1);color:var(--blue)}
.wn-rw-val.epic{background:rgba(165,110,255,.1);color:var(--purple)}
.wn-rw-val.legendary{background:linear-gradient(135deg,rgba(240,200,80,.12),rgba(232,64,87,.06));color:var(--gold)}
.wn-rw-btn{display:block;width:100%;margin-top:16px;padding:16px;border-radius:16px;border:none;font-size:16px;font-weight:800;color:#fff;cursor:pointer;position:relative;overflow:hidden}
.wn-rw-btn:active{transform:translateY(3px);box-shadow:none!important}
.wn-rw-btn.common{background:linear-gradient(180deg,#3DDC84,#2a9d5e);box-shadow:0 5px 0 #1a7040}
.wn-rw-btn.rare{background:linear-gradient(180deg,#4A90FF,#2a60cc);box-shadow:0 5px 0 #1a4099}
.wn-rw-btn.epic{background:linear-gradient(180deg,#A56EFF,#7c3aed);box-shadow:0 5px 0 #5b21b6}
.wn-rw-btn.legendary{background:linear-gradient(135deg,var(--red),var(--gold));box-shadow:0 5px 0 var(--gold-d)}
.wn-rw-btn::after{content:'';position:absolute;top:0;left:-100%;width:50%;height:100%;background:linear-gradient(90deg,transparent,rgba(255,255,255,.12),transparent);animation:wnShine 3s infinite}
.wn-shake{animation:wnShake .2s ease}
@keyframes wnShake{0%,100%{transform:translateX(0)}20%{transform:translateX(-4px)}40%{transform:translateX(4px)}60%{transform:translateX(-2px)}80%{transform:translateX(2px)}}
`;

// ═══ AUDIO UTILITIES ═══
let audioCtx = null;
function initAudio() { if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)(); }
function tick(freq = 700) {
  if (!audioCtx) return;
  const o = audioCtx.createOscillator(), g = audioCtx.createGain();
  o.connect(g); g.connect(audioCtx.destination);
  o.frequency.value = freq; o.type = 'triangle'; g.gain.value = 0.04;
  g.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + 0.03);
  o.start(); o.stop(audioCtx.currentTime + 0.03);
}
function winSound(tier) {
  if (!audioCtx) return;
  const notes = tier === 'legendary' ? [523, 659, 784, 1047] : tier === 'epic' ? [440, 554, 659] : tier === 'rare' ? [440, 554] : [440];
  notes.forEach((f, i) => {
    const o = audioCtx.createOscillator(), g = audioCtx.createGain();
    o.connect(g); g.connect(audioCtx.destination);
    o.frequency.value = f; o.type = 'sine'; g.gain.value = 0.08;
    g.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + 0.18 * (i + 1) + 0.3);
    o.start(audioCtx.currentTime + 0.15 * i); o.stop(audioCtx.currentTime + 0.18 * (i + 1) + 0.3);
  });
}
// BONUS: Triumph fanfare for epic/legendary (5-note ascending with sustain)
function triumphFanfare() {
  if (!audioCtx) return;
  const notes = [523, 659, 784, 988, 1318]; // C5 E5 G5 B5 E6
  notes.forEach((f, i) => {
    const o = audioCtx.createOscillator(), g = audioCtx.createGain();
    o.connect(g); g.connect(audioCtx.destination);
    o.frequency.value = f; o.type = 'sawtooth'; g.gain.value = 0.06;
    g.gain.setValueAtTime(0.06, audioCtx.currentTime + i * 0.1);
    g.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + i * 0.1 + 0.6);
    o.start(audioCtx.currentTime + i * 0.1); o.stop(audioCtx.currentTime + i * 0.1 + 0.6);
  });
}
function hap(pattern) { if (navigator.vibrate) navigator.vibrate(pattern); }

// ═���═ PARTICLE SYSTEM (canvas-based) ═══
class Particle {
  constructor(x, y, color, size, vx, vy, life) {
    this.x = x; this.y = y; this.color = color; this.size = size;
    this.vx = vx; this.vy = vy; this.life = life; this.maxLife = life;
  }
  update() { this.vy += 0.1; this.vx *= 0.97; this.vy *= 0.97; this.x += this.vx; this.y += this.vy; this.life--; }
  draw(ctx) {
    const alpha = Math.max(0, this.life / this.maxLife);
    const s = this.size * (0.3 + 0.7 * alpha);
    ctx.globalAlpha = alpha; ctx.fillStyle = this.color;
    ctx.beginPath(); ctx.arc(this.x, this.y, s, 0, Math.PI * 2); ctx.fill();
    ctx.globalAlpha = alpha * 0.2;
    ctx.beginPath(); ctx.arc(this.x, this.y, s * 2.5, 0, Math.PI * 2); ctx.fill();
    ctx.globalAlpha = 1;
  }
}

function explode(particles, x, y, colors, count, power) {
  for (let i = 0; i < count; i++) {
    const angle = Math.PI * 2 * i / count + (Math.random() - 0.5) * 0.5;
    const speed = power * (0.4 + Math.random());
    particles.push(new Particle(x, y, colors[Math.floor(Math.random() * colors.length)],
      1.5 + Math.random() * 3, Math.cos(angle) * speed, Math.sin(angle) * speed, 45 + Math.random() * 35));
  }
}

// BONUS: Gold dust particles (parabolic motion around prize)
function goldDust(particles, x, y) {
  for (let i = 0; i < 18; i++) {
    const angle = Math.PI * 2 * i / 18;
    const dist = 30 + Math.random() * 20;
    particles.push(new Particle(
      x + Math.cos(angle) * dist, y + Math.sin(angle) * dist,
      ['#F0C850', '#FFE17A', '#FFD700', '#C8940A'][Math.floor(Math.random() * 4)],
      1 + Math.random() * 2, Math.cos(angle) * 0.5, -1 - Math.random() * 2, 60 + Math.random() * 30
    ));
  }
}

// ═══ PRIZE DATA (from render, simplified for API integration) ═══
const DEMO_PRIZES = [
  { name: '5 Рун', icon: 'ᚱ', desc: 'Мелочь, а приятно', tier: 'common' },
  { name: '10 Рун', icon: 'ᚱ', desc: 'Малая дань Норн', tier: 'common' },
  { name: '+10 XP', icon: '⚡', desc: 'Немного опыта', tier: 'common' },
  { name: '20 Рун', icon: 'ᚱ', desc: 'Норны благосклонны', tier: 'common' },
  { name: '+20 XP', icon: '⚡', desc: 'Воин растёт', tier: 'common' },
  { name: '50 Рун', icon: '💰', desc: 'Щедрость Норн!', tier: 'rare' },
  { name: 'Множ. ×2', icon: '🎯', desc: 'Следующий приз удвоен!', tier: 'rare' },
  { name: '250 Рун', icon: '💎', desc: 'Руническое богатство!', tier: 'epic' },
  { name: 'Рамка «Воин»', icon: '⚔️', desc: 'Рамка огня и стали', tier: 'epic' },
  { name: 'Футболка ASGARD', icon: '👕', desc: 'Фирменная футболка!', tier: 'legendary' },
  { name: '1000 Рун', icon: '💎', desc: 'Легендарное сокровище!', tier: 'legendary' },
];

function randomPrize(pool) { return pool[Math.floor(Math.random() * pool.length)]; }

// S3 fix: escape HTML to prevent XSS from API data
function escHtml(s) { if (!s) return ''; return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }

function buildStripHTML(items) {
  return items.map(p => {
    const tier = escHtml(p.tier);
    const tag = tier === 'legendary' ? 'ЛЕГЕНДА' : tier === 'epic' ? 'ЭПИК' : tier === 'rare' ? 'РЕДКИЙ' : '';
    // Use SVG icon if available (safe — comes from our own DB), else emoji
    const iconContent = p.icon_svg
      ? `<span style="display:inline-flex;align-items:center;justify-content:center;width:30px;height:30px">${p.icon_svg}</span>`
      : escHtml(p.icon || '?');
    return `<div class="wn-item"><div class="wn-di-icon ${tier}" style="${p.icon_svg ? 'font-size:0;padding:0' : ''}">${iconContent}</div><div style="flex:1;min-width:0"><div class="wn-di-name">${escHtml(p.name)}</div><div class="wn-di-desc">${escHtml(p.desc || p.description || '')}</div></div>${tag ? `<div class="wn-di-tag ${tier}">${tag}</div>` : ''}</div>`;
  }).join('');
}

// ═══ MAIN COMPONENT ═══
export default function WheelOfNorns() {
  const navigate = useNavigate();
  const rootRef = useRef(null);
  const stripRef = useRef(null);
  const canvasRef = useRef(null);
  const fxRef = useRef(null);
  const vBodyRef = useRef(null);
  const mouthRef = useRef(null);
  const teethRef = useRef(null);
  const browLRef = useRef(null);
  const browRRef = useRef(null);
  const pupilLRef = useRef(null);
  const pupilRRef = useRef(null);
  const bubbleRef = useRef(null);
  const pendingTimers = useRef([]); // Q3: track timeouts for cleanup
  const startParticlesRef = useRef(null); // Q9: no global leak
  // Q6: memoize stars so they don't jump on re-render
  const starsData = useMemo(() => Array.from({ length: 25 }, () => ({ x: Math.random() * 100, y: Math.random() * 50, w: 1 + Math.random() * 2, d: Math.random() * 3, dur: 2 + Math.random() * 2 })), []);

  const [prizesPool, setPrizesPool] = useState(DEMO_PRIZES);
  const [balance, setBalance] = useState(0);
  const [level, setLevel] = useState(1);
  const [xpPct, setXpPct] = useState(65);
  const [xpText, setXpText] = useState('0 / 100');
  const [streak, setStreak] = useState(0);
  const [spinning, setSpinning] = useState(false);
  const [canSpin, setCanSpin] = useState(true);
  const [showReward, setShowReward] = useState(false);
  const [wonPrize, setWonPrize] = useState(null);
  const [hint, setHint] = useState('Нажми чтобы испытать судьбу!');
  const [shaking, setShaking] = useState(false);
  const [spinsLeft, setSpinsLeft] = useState(null); // { free, checkin, purchased, total }

  // Spring physics state
  const springState = useRef({ vY: 0, vVel: 0, vRot: 0, vRVel: 0, vScale: 1, vSVel: 0, target: { y: 0, rot: 0, scale: 1 }, state: 'idle', phase: 0 });
  const particles = useRef([]);
  const animRunning = useRef(false);
  const blinkTimer = useRef(null);
  const bubbleTimer = useRef(null);

  // Q3+Q4: cleanup all pending timeouts on unmount
  // Q3+Q4+Q8: cleanup timeouts + AudioContext on unmount
  useEffect(() => {
    return () => {
      pendingTimers.current.forEach(t => clearTimeout(t)); pendingTimers.current = [];
      if (audioCtx) { audioCtx.close().catch(() => {}); audioCtx = null; }
    };
  }, []);

  // Load wallet + spin status
  const loadSpinStatus = useCallback(() => {
    fieldApi.get('/gamification/spin-status').then(s => {
      setSpinsLeft(s);
      setCanSpin(s.total > 0);
      if (s.total <= 0) setHint('Спины закончились');
    }).catch(() => {});
  }, []);

  useEffect(() => {
    fieldApi.get('/gamification/wallet').then(w => {
      setBalance(w.runes || 0);
      setLevel(w.level || 1);
      const pct = w.xp_per_level ? Math.round((w.xp_in_level / w.xp_per_level) * 100) : 65;
      setXpPct(pct);
      setXpText(`${w.xp_in_level || 0} / ${w.xp_per_level || 100}`);
    }).catch(() => {});
    // Load real prizes pool from API
    fieldApi.get('/gamification/prizes').then(d => {
      if (d.prizes?.length) {
        setPrizesPool(d.prizes.map(p => ({
          name: p.name, icon: p.icon, icon_svg: p.icon_svg || null,
          desc: p.description, tier: p.tier,
        })));
      }
    }).catch(() => {});
    fieldApi.get('/gamification/quests').then(d => {
      // Use streak from API response (added in Phase 1)
      if (typeof d?.streak === 'number') setStreak(d.streak);
      else {
        // Fallback: read from quest progress
        const streakQ = (d?.quests || []).find(q => q.target_action === 'streak');
        if (streakQ) setStreak(streakQ.progress || 0);
      }
    }).catch(() => {});
    loadSpinStatus();
  }, [loadSpinStatus]);

  // Init strip with random items (re-init when prizesPool loads from API)
  useEffect(() => {
    if (stripRef.current) {
      const items = []; for (let i = 0; i < 5; i++) items.push(randomPrize(prizesPool));
      stripRef.current.innerHTML = buildStripHTML(items);
      stripRef.current.style.transform = `translateY(${-ITEM_H + ITEM_H * ((VISIBLE - 1) / 2)}px)`;
    }
  }, [prizesPool]);

  // Viking spring physics RAF loop
  useEffect(() => {
    const ss = springState.current;
    let running = true;

    function vikingTick() {
      if (!running) return;
      ss.phase += 0.04;

      // Target based on state
      if (ss.state === 'idle') { ss.target.y = Math.sin(ss.phase) * 2.5; ss.target.rot = Math.sin(ss.phase * 0.7) * 0.8; ss.target.scale = 1; }
      else if (ss.state === 'spin') { ss.target.y = Math.sin(ss.phase * 6) * 5; ss.target.rot = Math.sin(ss.phase * 4) * 2; ss.target.scale = 1 + Math.sin(ss.phase * 6) * 0.02; }
      else if (ss.state === 'win') { ss.target.y = Math.sin(ss.phase * 4) * 6; ss.target.rot = Math.sin(ss.phase * 3) * 3; ss.target.scale = 1 + Math.sin(ss.phase * 5) * 0.03; }
      else if (ss.state === 'epic') { ss.target.y = Math.sin(ss.phase * 5) * 8; ss.target.rot = Math.sin(ss.phase * 4) * 5; ss.target.scale = 1 + Math.sin(ss.phase * 6) * 0.04; }

      // Spring step: Y
      const fY = (ss.target.y - ss.vY) * 0.15 - ss.vVel * 0.3; ss.vVel += fY; ss.vY += ss.vVel;
      // Rotation
      const fR = (ss.target.rot - ss.vRot) * 0.12 - ss.vRVel * 0.35; ss.vRVel += fR; ss.vRot += ss.vRVel;
      // Scale
      const fS = (ss.target.scale - ss.vScale) * 0.2 - ss.vSVel * 0.3; ss.vSVel += fS; ss.vScale += ss.vSVel;

      if (vBodyRef.current) {
        vBodyRef.current.setAttribute('transform', `translate(0,${ss.vY}) rotate(${ss.vRot},70,80) scale(${ss.vScale})`);
      }

      // Pupils
      let px = Math.sin(ss.phase * 0.5) * 1.5, py = Math.sin(ss.phase * 0.3) * 1;
      if (ss.state === 'spin' || ss.state === 'win' || ss.state === 'epic') { py = 2; px = Math.sin(ss.phase * 3) * 1.5; }
      if (pupilLRef.current) { pupilLRef.current.setAttribute('cx', 60 + px); pupilLRef.current.setAttribute('cy', 55.5 + py); }
      if (pupilRRef.current) { pupilRRef.current.setAttribute('cx', 86 + px); pupilRRef.current.setAttribute('cy', 55.5 + py); }

      requestAnimationFrame(vikingTick);
    }
    vikingTick();

    // Blink loop
    function doBlink() {
      const eyes = vBodyRef.current?.querySelectorAll('.v-eye-white');
      if (eyes) { eyes.forEach(e => e.setAttribute('ry', '1')); setTimeout(() => { eyes.forEach(e => e.setAttribute('ry', '9'));
        if (Math.random() < 0.2) { setTimeout(() => { eyes.forEach(e => e.setAttribute('ry', '1')); setTimeout(() => eyes.forEach(e => e.setAttribute('ry', '9')), 100); }, 200); }
      }, 120); }
      blinkTimer.current = setTimeout(doBlink, 2500 + Math.random() * 3000);
    }
    blinkTimer.current = setTimeout(doBlink, 2000);

    // Initial bubble
    setTimeout(() => say('Крути, воин! ⚔️', 2500), 600);

    return () => { running = false; if (blinkTimer.current) clearTimeout(blinkTimer.current); if (bubbleTimer.current) clearTimeout(bubbleTimer.current); };
  }, []);

  // Particle animation loop
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    let running = true;

    function resize() { canvas.width = canvas.offsetWidth * devicePixelRatio; canvas.height = canvas.offsetHeight * devicePixelRatio; ctx.scale(devicePixelRatio, devicePixelRatio); }
    resize(); window.addEventListener('resize', resize);

    function loop() {
      if (!running) return;
      ctx.clearRect(0, 0, canvas.width / devicePixelRatio, canvas.height / devicePixelRatio);
      const pts = particles.current;
      for (let i = pts.length - 1; i >= 0; i--) { pts[i].update(); if (pts[i].life <= 0) pts.splice(i, 1); else pts[i].draw(ctx); }
      if (pts.length > 0) requestAnimationFrame(loop); else animRunning.current = false;
    }
    // Export starter
    animRunning.current = false;
    startParticlesRef.current = () => { if (!animRunning.current) { animRunning.current = true; loop(); } };

    return () => { running = false; window.removeEventListener('resize', resize); };
  }, []);

  function say(text, duration = 2200) {
    if (bubbleRef.current) { bubbleRef.current.textContent = text; bubbleRef.current.classList.add('wn-bubble-on'); }
    if (bubbleTimer.current) clearTimeout(bubbleTimer.current);
    bubbleTimer.current = setTimeout(() => { if (bubbleRef.current) bubbleRef.current.classList.remove('wn-bubble-on'); }, duration);
  }

  function setVikingState(state) {
    springState.current.state = state;
    const mouth = mouthRef.current, teeth = teethRef.current, bL = browLRef.current, bR = browRRef.current;
    if (!mouth) return;
    if (state === 'idle') { mouth.setAttribute('d', 'M58 70 Q70 77 82 70'); teeth.setAttribute('opacity', '0'); bL.setAttribute('d', 'M45 42 Q52 36 66 41'); bR.setAttribute('d', 'M74 41 Q88 36 95 42'); }
    if (state === 'spin') { mouth.setAttribute('d', 'M58 69 Q70 79 82 69'); teeth.setAttribute('opacity', '0'); bL.setAttribute('d', 'M45 40 Q52 34 66 39'); bR.setAttribute('d', 'M74 39 Q88 34 95 40'); }
    if (state === 'win') { mouth.setAttribute('d', 'M56 68 Q70 82 84 68'); teeth.setAttribute('opacity', '.8'); teeth.setAttribute('d', 'M60 73 L64 73 L68 73 L72 73 L76 73 L80 73'); bL.setAttribute('d', 'M45 40 Q52 34 66 40'); bR.setAttribute('d', 'M74 40 Q88 34 95 40'); }
    if (state === 'epic') { mouth.setAttribute('d', 'M54 66 Q70 86 86 66'); teeth.setAttribute('opacity', '1'); teeth.setAttribute('d', 'M58 72 L62 72 L66 72 L70 72 L74 72 L78 72 L82 72'); bL.setAttribute('d', 'M46 38 Q52 31 66 38'); bR.setAttribute('d', 'M74 38 Q88 31 94 38'); }
  }

  // ═══ VIKING QUOTES (when no spins left) ═══
  const VIKING_NOSPINS = [
    'Иди работай, бездельник! Руны сами себя не заработают! 💀',
    'Один бы тебя выгнал за лень. На объект, воин! ⚒️',
    'Тор не крутил рулетку — он молотом махал! 🔨',
    'Хватит тыкать, иди трубы вари! 🔥',
    'Сначала работа — потом призы. Это закон Асгарда! ⚔️',
    'Валькирии не забирают лентяев. Иди на объект! 🛡️',
    'Ты думал тут казино? Марш на смену! 💪',
    'Локи бы тебя обманул, а я говорю правду — РАБОТАЙ! 🐍',
    'Даже Фенрир работает усерднее тебя! 🐺',
    'Мьёльнир сам себя не поднимет. Как и твоя зарплата! ⚡',
    'Бесплатных рун не бывает. Отметься на объекте! 📍',
    'Рагнарёк наступит раньше, чем ты заработаешь на спин! 🌋',
    'Норны видят — ты сидишь без дела. Позор! 👀',
    'Кузнец Брок не прерывался на рулетку! За работу! 🏗️',
    'Эйнхерии тренируются, а ты в телефоне залип? 📱',
    'Вальхалла для тех, кто пашет! А не для тех, кто тыкает! 👊',
  ];

  function handleNoSpins() {
    hap([15, 10, 15]);
    const quote = VIKING_NOSPINS[Math.floor(Math.random() * VIKING_NOSPINS.length)];
    say(quote, 3500);
    setShaking(true);
    setTimeout(() => setShaking(false), 200);
  }

  // ═══ SPIN ═══
  async function handleSpin() {
    if (spinning) return;
    if (!canSpin) { handleNoSpins(); return; }
    initAudio(); hap([25]);
    setSpinning(true);
    setVikingState('spin');
    say('Поехали!! 🔥', 6000);
    setHint('Колесо Норн вращается...');

    let prize;
    try {
      const data = await fieldApi.post('/gamification/spin', {});
      prize = data.prize;
    } catch (err) {
      setSpinning(false); setVikingState('idle');
      loadSpinStatus(); // refresh counter
      if (err.message.includes('использован') || err.message.includes('закончились')) {
        setCanSpin(false);
        handleNoSpins();
      } else {
        setHint(err.message);
      }
      return;
    }

    // Build strip with near-miss suspense
    const pool = prizesPool;
    const totalItems = 200;
    const winIndex = totalItems - 4;
    const items = [];
    for (let i = 0; i < totalItems; i++) {
      if (i === winIndex) items.push(prize);
      else {
        const isNearEnd = i > totalItems - 15 && i !== winIndex;
        if (isNearEnd && Math.random() < 0.3) {
          const teasers = pool.filter(p => p.tier === 'rare' || p.tier === 'epic');
          items.push(teasers.length ? randomPrize(teasers) : randomPrize(pool));
        } else items.push(randomPrize(pool));
      }
    }

    const strip = stripRef.current;
    strip.innerHTML = buildStripHTML(items);
    strip.style.transition = 'none';
    strip.style.transform = `translateY(${ITEM_H}px)`;

    const targetY = -(winIndex * ITEM_H) + ITEM_H * ((VISIBLE - 1) / 2);
    const startY = ITEM_H;
    const ACCEL = 800, CRUISE = 2500, DECEL = 5000, TOTAL = ACCEL + CRUISE + DECEL;
    const t0 = performance.now();
    let lastItemIdx = -1, lastTickTime = 0;

    function getProgress(elapsed) {
      if (elapsed < ACCEL) { const t = elapsed / ACCEL; return 0.08 * (t * t); }
      if (elapsed < ACCEL + CRUISE) { return 0.08 + 0.52 * ((elapsed - ACCEL) / CRUISE); }
      const t = (elapsed - ACCEL - CRUISE) / DECEL;
      return 0.60 + 0.40 * (1 - Math.pow(1 - t, 4));
    }

    function frame(now) {
      const elapsed = now - t0;
      const progress = Math.min(getProgress(Math.min(elapsed, TOTAL)), 1);
      const currentY = startY + (targetY - startY) * progress;
      strip.style.transform = `translateY(${currentY}px)`;

      const phase = elapsed < ACCEL ? 'accel' : elapsed < ACCEL + CRUISE ? 'cruise' : 'decel';
      const decelProgress = phase === 'decel' ? (elapsed - ACCEL - CRUISE) / DECEL : 0;

      // Tick + haptic on each item pass
      const itemIdx = Math.floor(Math.abs(currentY) / ITEM_H);
      if (itemIdx !== lastItemIdx) {
        lastItemIdx = itemIdx;
        const minInterval = phase === 'cruise' ? 30 : phase === 'accel' ? 60 : 80;
        if (now - lastTickTime > minInterval) {
          lastTickTime = now;
          if (phase === 'decel') {
            const freq = 400 + 200 * (1 - decelProgress);
            tick(freq);
            hap([8 + Math.floor(decelProgress * 15)]); // Progressive haptic
            // BONUS: Viking anticipation on last 3 ticks
            if (decelProgress > 0.85 && springState.current.state !== 'epic') {
              setVikingState('epic'); say('Ну давай... 😱', 3000);
            } else if (decelProgress > 0.7 && springState.current.state !== 'epic') {
              setVikingState('epic'); say('Ну давай... давай!! 😱', 3000);
            } else if (decelProgress > 0.4 && decelProgress <= 0.7 && springState.current.state === 'spin') {
              say('Что выпадет?! 👀', 2000);
            }
          } else {
            tick(500 + 300 * Math.random());
            hap([3]); // Light haptic on every tick
          }
        }
      }

      // Drum blur
      if (phase === 'cruise') strip.style.filter = 'blur(0.5px)';
      else if (phase === 'decel' && decelProgress > 0.3) strip.style.filter = 'none';
      else strip.style.filter = `blur(${phase === 'accel' ? 0.3 : 0.5}px)`;

      if (elapsed < TOTAL) requestAnimationFrame(frame);
      else { strip.style.filter = 'none'; onWin(prize); }
    }
    requestAnimationFrame(frame);
  }

  function onWin(prize) {
    setSpinning(false);
    setCanSpin(false);
    const tier = prize.tier;

    // Haptic pattern by tier
    hap(tier === 'legendary' ? [50, 30, 80, 30, 100] : [40, 20, 60]);
    winSound(tier);
    if (tier === 'legendary' || tier === 'epic') triumphFanfare(); // BONUS

    // Viking reaction
    if (tier === 'legendary') { setVikingState('epic'); say('ЛЕГЕНДА!!! 🏆🔥⚔️', 4000); }
    else if (tier === 'epic') { setVikingState('epic'); say('ЭПИК!! ВАЛЬХАЛЛА! 💜', 3000); }
    else if (tier === 'rare') { setVikingState('win'); say('Неплохо, воин! 💪', 2500); }
    else { setVikingState('win'); say('Skál! 🍻', 2000); }

    // FX flash
    if (fxRef.current) {
      fxRef.current.className = 'wn-fx';
      void fxRef.current.offsetWidth;
      fxRef.current.classList.add(tier === 'legendary' ? 'wn-fx-mega' : 'wn-fx-flash');
      if (tier === 'legendary') setTimeout(() => { fxRef.current.className = 'wn-fx'; void fxRef.current.offsetWidth; fxRef.current.classList.add('wn-fx-zap'); }, 200);
    }

    // BONUS: Screen shake on legendary
    if (tier === 'legendary') { setShaking(true); setTimeout(() => setShaking(false), 200); }

    // Particles
    const rect = stripRef.current?.getBoundingClientRect();
    if (rect) {
      const bx = rect.left + rect.width / 2 - (rootRef.current?.getBoundingClientRect().left || 0);
      const by = rect.top + rect.height / 2 - (rootRef.current?.getBoundingClientRect().top || 0);
      const colors = tier === 'legendary' ? ['#F0C850', '#FFE17A', '#E84057', '#FF8A8A', '#FFD700'] :
        tier === 'epic' ? ['#A56EFF', '#C084FC', '#E0C3FC'] : tier === 'rare' ? ['#4A90FF', '#60A5FA', '#93C5FD'] : ['#3DDC84', '#86EFAC'];
      explode(particles.current, bx, by, colors, tier === 'legendary' ? 80 : tier === 'epic' ? 50 : 25, tier === 'legendary' ? 12 : tier === 'epic' ? 8 : 4);
      if (tier === 'legendary') { setTimeout(() => { explode(particles.current, bx, by, colors, 40, 8); goldDust(particles.current, bx, by); }, 300); setTimeout(() => explode(particles.current, bx, by, colors, 25, 6), 650); }
      else if (tier === 'epic') goldDust(particles.current, bx, by); // BONUS: gold dust for epic too
      if (startParticlesRef.current) startParticlesRef.current();
    }

    setWonPrize(prize);
    setTimeout(() => setShowReward(true), tier === 'legendary' ? 900 : 500);
    // Refresh balance + spin status
    fieldApi.get('/gamification/wallet').then(w => setBalance(w.runes || 0)).catch(() => {});
    loadSpinStatus();
  }

  function claim() {
    setShowReward(false);
    hap([12]);
    setVikingState('idle');
    // Check remaining spins
    loadSpinStatus();
    if (spinsLeft && spinsLeft.total <= 1) {
      setHint('Спины закончились');
    } else {
      setHint('Крути ещё!');
    }
    // Re-init strip
    if (stripRef.current) {
      const items = []; for (let i = 0; i < 5; i++) items.push(randomPrize(prizesPool));
      stripRef.current.innerHTML = buildStripHTML(items);
      stripRef.current.style.transform = `translateY(${-ITEM_H + ITEM_H * ((VISIBLE - 1) / 2)}px)`;
    }
  }

  const streakDots = Array.from({ length: 7 }, (_, i) => i < streak ? 'on' : i === streak ? 'now' : '');

  return (
    <div ref={rootRef} className={`wn-root ${shaking ? 'wn-shake' : ''}`} style={{ height: '100%' }}>
      <style>{WHEEL_CSS}</style>
      {/* Background */}
      <div className="wn-bg">
        <div className="wn-glow wn-g1" /><div className="wn-glow wn-g2" /><div className="wn-glow wn-g3" />
        <div className="wn-stars">{starsData.map((s, i) => (
          <div key={i} className="wn-s" style={{ left: `${s.x}%`, top: `${s.y}%`, width: `${s.w}px`, height: `${s.w}px`, animationDelay: `${s.d}s`, animationDuration: `${s.dur}s` }} />
        ))}</div>
      </div>
      {/* Particle canvas */}
      <canvas ref={canvasRef} style={{ position: 'absolute', inset: 0, zIndex: 100, pointerEvents: 'none', width: '100%', height: '100%' }} />
      {/* FX overlay */}
      <div ref={fxRef} className="wn-fx" />

      <div className="wn-page">
        {/* TOP BAR */}
        <div className="wn-top">
          <button className="wn-back" onClick={() => navigate('/field/home')}>
            <svg viewBox="0 0 24 24" width="20" height="20" stroke="rgba(255,255,255,.7)" fill="none" strokeWidth="2.2" strokeLinecap="round"><path d="M15 18l-6-6 6-6" /></svg>
          </button>
          <div style={{ textAlign: 'center' }}>
            <div className="wn-title">КОЛЕСО НОРН</div>
            <div className="wn-sub">ИСПЫТАЙ СУДЬБУ</div>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            {/* Spin counter */}
            {spinsLeft != null && (
              <div style={{
                display: 'flex', alignItems: 'center', gap: 4, padding: '5px 10px 5px 7px',
                background: spinsLeft.total > 0
                  ? 'linear-gradient(135deg, #3a0a10, #1a0508)'
                  : 'linear-gradient(135deg, #1a1a1a, #0a0a0a)',
                border: `1.5px solid ${spinsLeft.total > 0 ? 'rgba(232,64,87,.4)' : 'rgba(255,255,255,.1)'}`,
                borderRadius: 20, boxShadow: spinsLeft.total > 0 ? '0 2px 10px rgba(232,64,87,.15)' : 'none',
              }}>
                <span style={{ fontSize: 16 }}>🎰</span>
                <span style={{
                  fontSize: 15, fontWeight: 800, fontVariantNumeric: 'tabular-nums',
                  color: spinsLeft.total > 0 ? '#E84057' : 'rgba(255,255,255,.3)',
                }}>×{spinsLeft.total}</span>
              </div>
            )}
            {/* Rune balance */}
            <div className="wn-wallet">
              <div className="wn-coin">ᚱ</div>
              <span className="wn-bal">{balance}</span>
            </div>
          </div>
        </div>

        {/* LEVEL */}
        <div className="wn-lvl">
          <div className="wn-lvl-badge">LV {level}</div>
          <div className="wn-lvl-track"><div className="wn-lvl-fill" style={{ width: `${xpPct}%` }} /></div>
          <div className="wn-lvl-text">{xpText}</div>
        </div>

        {/* STREAK */}
        <div className="wn-streak">
          <div className="wn-fire">🔥</div>
          <div className="wn-streak-info">
            <div className="wn-streak-title"><b style={{ color: 'var(--gold)' }}>{streak} {streak === 1 ? 'день' : streak < 5 ? 'дня' : 'дней'}</b> подряд!</div>
            <div className="wn-dots">{streakDots.map((s, i) => <div key={i} className={`wn-dot ${s === 'on' ? 'wn-dot-on' : s === 'now' ? 'wn-dot-now' : ''}`} />)}</div>
          </div>
          {streak >= 5 && <div className="wn-mult">×2</div>}
        </div>

        {/* VIKING */}
        <div className="wn-viking-area">
          <div className="wn-viking">
            <svg viewBox="0 0 140 145" overflow="visible">
              <defs>
                <linearGradient id="wn-hlm" x1="70" y1="15" x2="70" y2="55" gradientUnits="userSpaceOnUse"><stop offset="0%" stopColor="rgba(255,255,255,.25)" /><stop offset="100%" stopColor="transparent" /></linearGradient>
                <linearGradient id="wn-armG" x1="70" y1="85" x2="70" y2="130" gradientUnits="userSpaceOnUse"><stop offset="0%" stopColor="rgba(255,255,255,.1)" /><stop offset="100%" stopColor="transparent" /></linearGradient>
                <linearGradient id="wn-hornG" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#FFE17A" /><stop offset="40%" stopColor="#F0C850" /><stop offset="100%" stopColor="#A07010" /></linearGradient>
                <radialGradient id="wn-skinG" cx=".45" cy=".38" r=".55"><stop offset="0%" stopColor="#FFE8D4" /><stop offset="70%" stopColor="#F5D0A8" /><stop offset="100%" stopColor="#E0B888" /></radialGradient>
                <radialGradient id="wn-noseG" cx=".45" cy=".35" r=".6"><stop offset="0%" stopColor="#F5C8A0" /><stop offset="100%" stopColor="#DDAA78" /></radialGradient>
                <linearGradient id="wn-beardG" x1="70" y1="65" x2="70" y2="118" gradientUnits="userSpaceOnUse"><stop offset="0%" stopColor="#D08838" /><stop offset="100%" stopColor="#A06020" /></linearGradient>
              </defs>
              <g ref={vBodyRef}>
                {/* BODY/ARMOR */}
                <path d="M42 98 Q45 86 56 82 L84 82 Q95 86 98 98 L102 132 Q70 138 38 132Z" fill="#5C2E10" />
                <path d="M42 98 Q45 86 56 82 L84 82 Q95 86 98 98 L102 132 Q70 138 38 132Z" fill="url(#wn-armG)" />
                <path d="M55 90 L55 120" stroke="rgba(0,0,0,.06)" strokeWidth="1" fill="none" /><path d="M65 88 L65 122" stroke="rgba(0,0,0,.06)" strokeWidth="1" fill="none" />
                <path d="M75 88 L75 122" stroke="rgba(0,0,0,.06)" strokeWidth="1" fill="none" /><path d="M85 90 L85 120" stroke="rgba(0,0,0,.06)" strokeWidth="1" fill="none" />
                <path d="M56 86 L70 96 L84 86" stroke="rgba(160,170,180,.18)" strokeWidth="8" fill="none" strokeLinejoin="round" />
                <path d="M58 86 L70 94 L82 86" stroke="rgba(160,170,180,.08)" strokeWidth="4" fill="none" strokeLinejoin="round" />
                <ellipse cx="44" cy="92" rx="8" ry="5" fill="#704218" /><ellipse cx="96" cy="92" rx="8" ry="5" fill="#704218" />
                <ellipse cx="44" cy="91" rx="7" ry="4" fill="rgba(255,255,255,.06)" /><ellipse cx="96" cy="91" rx="7" ry="4" fill="rgba(255,255,255,.06)" />
                <circle cx="44" cy="92" r="1.5" fill="#D4A843" /><circle cx="96" cy="92" r="1.5" fill="#D4A843" />
                <rect x="40" y="110" width="60" height="8" rx="3.5" fill="#704010" /><rect x="40" y="110" width="60" height="4" rx="2" fill="rgba(255,255,255,.06)" />
                <circle cx="48" cy="114" r="1.5" fill="#B08030" /><circle cx="56" cy="114" r="1.5" fill="#B08030" /><circle cx="84" cy="114" r="1.5" fill="#B08030" /><circle cx="92" cy="114" r="1.5" fill="#B08030" />
                <path d="M63 108 L77 108 L77 118 L70 122 L63 118Z" fill="#D4A843" stroke="#8B6914" strokeWidth="1" />
                <text x="70" y="117" textAnchor="middle" fontSize="6" fontWeight="900" fill="#5a3e00" fontFamily="system-ui" letterSpacing=".3">ΛS</text>
                <ellipse cx="70" cy="84" rx="28" ry="11" fill="#8A6030" /><ellipse cx="70" cy="83" rx="26" ry="9" fill="#A07840" />
                <ellipse cx="70" cy="82" rx="24" ry="7" fill="#B8904A" /><ellipse cx="70" cy="81" rx="22" ry="5" fill="#D0A858" />
                <path d="M48 79 Q50 75 52 79 Q54 75 56 79 Q58 75 60 79 Q62 75 64 79 Q66 75 68 79 Q70 75 72 79 Q74 75 76 79 Q78 75 80 79 Q82 75 84 79 Q86 75 88 79 Q90 75 92 79" stroke="#A07030" strokeWidth="1.2" fill="none" />
                {/* HEAD */}
                <ellipse cx="70" cy="58" rx="27" ry="25" fill="url(#wn-skinG)" />
                <path d="M46 64 Q70 78 94 64" stroke="rgba(180,140,100,.1)" strokeWidth="1" fill="none" />
                <ellipse cx="43" cy="56" rx="5" ry="8" fill="#F0C8A0" /><ellipse cx="43" cy="56" rx="3.5" ry="6" fill="#E8B890" />
                <path d="M42 60 Q40 64 43 64" stroke="#D4A843" strokeWidth="1.5" fill="none" /><circle cx="43" cy="65" r="1.5" fill="#D4A843" />
                <ellipse cx="97" cy="56" rx="5" ry="8" fill="#F0C8A0" /><ellipse cx="97" cy="56" rx="3.5" ry="6" fill="#E8B890" />
                <path d="M98 60 Q100 64 97 64" stroke="#D4A843" strokeWidth="1.5" fill="none" /><circle cx="97" cy="65" r="1.5" fill="#D4A843" />
                <ellipse cx="50" cy="63" rx="8" ry="4.5" fill="rgba(255,130,130,.15)" /><ellipse cx="90" cy="63" rx="8" ry="4.5" fill="rgba(255,130,130,.15)" />
                {/* EYES */}
                <ellipse cx="57" cy="54" rx="10" ry="10" fill="rgba(160,120,80,.08)" /><ellipse cx="83" cy="54" rx="10" ry="10" fill="rgba(160,120,80,.08)" />
                <ellipse className="v-eye-white" cx="57" cy="54" rx="9" ry="9" fill="white" stroke="rgba(0,0,0,.06)" strokeWidth=".5" />
                <ellipse className="v-eye-white" cx="83" cy="54" rx="9" ry="9" fill="white" stroke="rgba(0,0,0,.06)" strokeWidth=".5" />
                <circle cx="59" cy="55" r="5.5" fill="#2860aa" /><circle cx="85" cy="55" r="5.5" fill="#2860aa" />
                <circle cx="59" cy="55" r="4" fill="#1a4a8a" /><circle cx="85" cy="55" r="4" fill="#1a4a8a" />
                <circle ref={pupilLRef} cx="60" cy="55.5" r="2.8" fill="#0a1428" /><circle ref={pupilRRef} cx="86" cy="55.5" r="2.8" fill="#0a1428" />
                <circle cx="63" cy="52" r="2.2" fill="white" /><circle cx="89" cy="52" r="2.2" fill="white" />
                <circle cx="57" cy="57" r="1.2" fill="rgba(255,255,255,.4)" /><circle cx="83" cy="57" r="1.2" fill="rgba(255,255,255,.4)" />
                <path d="M48 58 Q57 62 66 58" stroke="rgba(200,160,120,.15)" strokeWidth="1" fill="none" />
                <path d="M74 58 Q83 62 92 58" stroke="rgba(200,160,120,.15)" strokeWidth="1" fill="none" />
                {/* BROWS */}
                <path ref={browLRef} d="M45 42 Q52 36 66 41" stroke="#6a3a10" strokeWidth="4" fill="none" strokeLinecap="round" />
                <path ref={browRRef} d="M74 41 Q88 36 95 42" stroke="#6a3a10" strokeWidth="4" fill="none" strokeLinecap="round" />
                <path d="M48 42 L46 39" stroke="#7a4a18" strokeWidth="1" fill="none" strokeLinecap="round" /><path d="M54 40 L53 37" stroke="#7a4a18" strokeWidth="1" fill="none" strokeLinecap="round" />
                <path d="M86 40 L87 37" stroke="#7a4a18" strokeWidth="1" fill="none" strokeLinecap="round" /><path d="M92 42 L94 39" stroke="#7a4a18" strokeWidth="1" fill="none" strokeLinecap="round" />
                <path d="M67 42 L70 40 L73 42" stroke="rgba(180,140,100,.12)" strokeWidth=".8" fill="none" />
                {/* NOSE */}
                <path d="M68 46 L66 58 Q70 65 74 58 L72 46" fill="url(#wn-noseG)" stroke="rgba(200,160,120,.1)" strokeWidth=".5" />
                <ellipse cx="70" cy="62" rx="5.5" ry="4.5" fill="url(#wn-noseG)" />
                <path d="M65 63 Q67 65 70 65 Q73 65 75 63" stroke="#C89868" strokeWidth="1" fill="none" />
                <ellipse cx="67" cy="63.5" rx="1.5" ry="1" fill="rgba(160,100,60,.2)" /><ellipse cx="73" cy="63.5" rx="1.5" ry="1" fill="rgba(160,100,60,.2)" />
                <ellipse cx="68" cy="58" rx="2" ry="3" fill="rgba(255,255,255,.12)" />
                <path d="M46 58 L50 64" stroke="rgba(200,160,130,.2)" strokeWidth="1.5" fill="none" strokeLinecap="round" />
                {/* MOUTH */}
                <path ref={mouthRef} d="M58 70 Q70 77 82 70" stroke="#7a3a10" strokeWidth="2.5" fill="none" strokeLinecap="round" />
                <path ref={teethRef} d="M62 72 L64 72 L66 72 L68 72 L70 72 L72 72 L74 72 L76 72 L78 72" stroke="white" strokeWidth="2.5" fill="none" strokeLinecap="round" opacity="0" />
                <path d="M62 69 Q70 66 78 69" stroke="rgba(255,200,180,.15)" strokeWidth="1" fill="none" />
                {/* BEARD */}
                <path d="M43 65 Q38 84 46 102 Q54 114 70 118 Q86 114 94 102 Q102 84 97 65" fill="url(#wn-beardG)" />
                <path d="M43 65 Q40 80 46 98" stroke="rgba(255,220,160,.1)" strokeWidth="2" fill="none" /><path d="M97 65 Q100 80 94 98" stroke="rgba(255,220,160,.1)" strokeWidth="2" fill="none" />
                <path d="M50 72 Q54 80 52 90 Q50 98 54 104" stroke="#A06020" strokeWidth="1.2" fill="none" opacity=".6" />
                <path d="M56 74 Q60 82 58 92 Q56 100 60 108" stroke="#A06020" strokeWidth="1.2" fill="none" opacity=".5" />
                <path d="M62 75 Q66 84 64 94 Q62 102 66 110" stroke="#A06020" strokeWidth="1.2" fill="none" opacity=".5" />
                <path d="M70 76 L70 112" stroke="#A06020" strokeWidth="1.2" fill="none" opacity=".5" />
                <path d="M78 75 Q74 84 76 94 Q78 102 74 110" stroke="#A06020" strokeWidth="1.2" fill="none" opacity=".5" />
                <path d="M84 74 Q80 82 82 92 Q84 100 80 108" stroke="#A06020" strokeWidth="1.2" fill="none" opacity=".5" />
                <path d="M90 72 Q86 80 88 90 Q90 98 86 104" stroke="#A06020" strokeWidth="1.2" fill="none" opacity=".6" />
                <path d="M58 68 Q52 70 48 68 Q46 66 48 64" stroke="#C88838" strokeWidth="3" fill="none" strokeLinecap="round" />
                <path d="M82 68 Q88 70 92 68 Q94 66 92 64" stroke="#C88838" strokeWidth="3" fill="none" strokeLinecap="round" />
                {/* Beard braids — left with wrapping */}
                <path d="M52 100 Q48 106 46 114 Q45 118 46 120" stroke="#C07830" strokeWidth="4.5" strokeLinecap="round" fill="none" />
                <path d="M48 108 L50 110 M47 112 L49 114" stroke="#A06020" strokeWidth="1" fill="none" />
                <circle cx="46" cy="121" r="3.5" fill="#D4A843" stroke="#8B6914" strokeWidth="1" />
                {/* Beard braids — right with wrapping */}
                <path d="M88 100 Q92 106 94 114 Q95 118 94 120" stroke="#C07830" strokeWidth="4.5" strokeLinecap="round" fill="none" />
                <path d="M92 108 L90 110 M93 112 L91 114" stroke="#A06020" strokeWidth="1" fill="none" />
                <circle cx="94" cy="121" r="3.5" fill="#D4A843" stroke="#8B6914" strokeWidth="1" />
                {/* Beard braids — center (longer) with wrapping */}
                <path d="M70 112 L70 126" stroke="#C07830" strokeWidth="5" strokeLinecap="round" fill="none" />
                <path d="M68 116 L72 118 M68 120 L72 122" stroke="#A06020" strokeWidth="1" fill="none" />
                <circle cx="70" cy="127" r="4" fill="#D4A843" stroke="#8B6914" strokeWidth="1" /><circle cx="70" cy="127" r="2" fill="#F0C850" />
                {/* HELMET */}
                <path d="M38 50 Q38 22 70 16 Q102 22 102 50 L98 57 Q70 48 42 57Z" fill="#707880" />
                <path d="M38 50 Q38 22 70 16 Q102 22 102 50 L98 57 Q70 48 42 57Z" fill="url(#wn-hlm)" />
                <path d="M70 16 L70 48" stroke="rgba(100,110,120,.2)" strokeWidth="1" fill="none" />
                <path d="M54 20 Q54 38 50 52" stroke="rgba(100,110,120,.15)" strokeWidth="1" fill="none" />
                <path d="M86 20 Q86 38 90 52" stroke="rgba(100,110,120,.15)" strokeWidth="1" fill="none" />
                {/* Helmet battle dents */}
                <ellipse cx="55" cy="32" rx="3" ry="2" fill="rgba(0,0,0,.04)" />
                <ellipse cx="82" cy="28" rx="2" ry="3" fill="rgba(0,0,0,.03)" />
                <rect x="38" y="46" width="64" height="9" rx="4" fill="#D4A843" />
                <rect x="38" y="46" width="64" height="5" rx="2.5" fill="rgba(255,255,255,.15)" />
                <path d="M44 50.5 Q48 48 52 50.5 Q56 53 60 50.5 Q64 48 68 50.5 Q72 53 76 50.5 Q80 48 84 50.5 Q88 53 92 50.5 Q96 48 100 50.5" stroke="rgba(139,105,20,.4)" strokeWidth="1" fill="none" />
                <circle cx="46" cy="50.5" r="2.5" fill="#F0C850" stroke="#A07010" strokeWidth=".6" /><circle cx="58" cy="50.5" r="2.5" fill="#F0C850" stroke="#A07010" strokeWidth=".6" />
                <circle cx="70" cy="50.5" r="3.2" fill="#F0C850" stroke="#A07010" strokeWidth=".6" /><circle cx="82" cy="50.5" r="2.5" fill="#F0C850" stroke="#A07010" strokeWidth=".6" />
                <circle cx="94" cy="50.5" r="2.5" fill="#F0C850" stroke="#A07010" strokeWidth=".6" /><circle cx="70" cy="50.5" r="2" fill="#FFE17A" />
                <rect x="59" y="32" width="22" height="12" rx="3" fill="#D4A843" stroke="#8B6914" strokeWidth="1" />
                <rect x="59" y="32" width="22" height="6" rx="2" fill="rgba(255,255,255,.12)" />
                <text x="70" y="40.5" textAnchor="middle" fontSize="5.5" fontWeight="900" fill="#4a2e00" fontFamily="system-ui" letterSpacing=".3">ASGARD</text>
                {/* Nose guard */}
                <rect x="66" y="44" width="8" height="20" rx="3" fill="#8A9098" />
                <rect x="66" y="44" width="4" height="20" rx="2" fill="rgba(255,255,255,.08)" />
                <path d="M70 44 L70 64" stroke="rgba(255,255,255,.06)" strokeWidth="1" />
                {/* HORNS */}
                <path d="M38 46 Q24 30 14 6 Q10 -6 18 -2 Q28 4 34 24 Q38 36 40 46" fill="url(#wn-hornG)" stroke="#A07010" strokeWidth="1.2" />
                <path d="M102 46 Q116 30 126 6 Q130 -6 122 -2 Q112 4 106 24 Q102 36 100 46" fill="url(#wn-hornG)" stroke="#A07010" strokeWidth="1.2" />
                <path d="M36 40 Q30 32 24 18" stroke="rgba(255,255,255,.2)" strokeWidth="2.5" fill="none" strokeLinecap="round" />
                <path d="M34 34 Q30 28 26 20" stroke="rgba(255,255,255,.1)" strokeWidth="1.5" fill="none" />
                <path d="M32 28 Q28 22 26 16" stroke="rgba(255,255,255,.06)" strokeWidth="1" fill="none" />
                <path d="M104 40 Q110 32 116 18" stroke="rgba(255,255,255,.2)" strokeWidth="2.5" fill="none" strokeLinecap="round" />
                <path d="M106 34 Q110 28 114 20" stroke="rgba(255,255,255,.1)" strokeWidth="1.5" fill="none" />
                <path d="M108 28 Q112 22 114 16" stroke="rgba(255,255,255,.06)" strokeWidth="1" fill="none" />
                {/* Horn ring grooves */}
                <path d="M30 30 Q28 32 30 34" stroke="rgba(160,112,16,.3)" strokeWidth="1.5" fill="none" />
                <path d="M26 22 Q24 24 26 26" stroke="rgba(160,112,16,.3)" strokeWidth="1.5" fill="none" />
                <path d="M110 30 Q112 32 110 34" stroke="rgba(160,112,16,.3)" strokeWidth="1.5" fill="none" />
                <path d="M114 22 Q116 24 114 26" stroke="rgba(160,112,16,.3)" strokeWidth="1.5" fill="none" />
                {/* Horn tips glow */}
                <circle cx="15" cy="2" r="4" fill="rgba(240,200,80,.25)" /><circle cx="125" cy="2" r="4" fill="rgba(240,200,80,.25)" />
                <circle cx="15" cy="2" r="2" fill="rgba(255,225,122,.3)" /><circle cx="125" cy="2" r="2" fill="rgba(255,225,122,.3)" />
                {/* ARMS */}
                <path d="M38 96 Q28 102 22 114 Q20 120 24 126" stroke="#E8C0A0" strokeWidth="8" fill="none" strokeLinecap="round" />
                <path d="M38 96 Q28 102 22 114" stroke="#5C2E10" strokeWidth="9" fill="none" strokeLinecap="round" opacity=".6" />
                <path d="M102 96 Q112 102 118 114 Q120 120 116 126" stroke="#E8C0A0" strokeWidth="8" fill="none" strokeLinecap="round" />
                <path d="M102 96 Q112 102 118 114" stroke="#5C2E10" strokeWidth="9" fill="none" strokeLinecap="round" opacity=".6" />
                <rect x="19" y="113" width="12" height="9" rx="3.5" fill="#604018" stroke="#D4A843" strokeWidth="1" />
                <rect x="19" y="113" width="12" height="4" rx="2" fill="rgba(255,255,255,.06)" />
                <rect x="109" y="113" width="12" height="9" rx="3.5" fill="#604018" stroke="#D4A843" strokeWidth="1" />
                <rect x="109" y="113" width="12" height="4" rx="2" fill="rgba(255,255,255,.06)" />
                {/* Gloves */}
                <path d="M22 124 Q20 130 24 132 Q28 134 30 130 Q32 126 28 124" fill="#4A2410" />
                <path d="M118 124 Q120 130 116 132 Q112 134 110 130 Q108 126 112 124" fill="#4A2410" />
                {/* Knuckle bumps */}
                <circle cx="25" cy="128" r="1.5" fill="#5C2E10" /><circle cx="28" cy="129" r="1.5" fill="#5C2E10" />
                <circle cx="115" cy="128" r="1.5" fill="#5C2E10" /><circle cx="112" cy="129" r="1.5" fill="#5C2E10" />
              </g>
            </svg>
            <div ref={bubbleRef} className="wn-bubble">Крути, воин! ⚔️</div>
          </div>
        </div>

        {/* DRUM */}
        <div className="wn-wheel">
          <div className="wn-drum-wrap">
            <div className="wn-frame" />
            <div className="wn-viewport">
              <div className="wn-vp-top" /><div className="wn-vp-bot" />
              <div className="wn-highlight" />
              <div ref={stripRef} className="wn-strip" />
              <div className="wn-ptr wn-ptr-l"><svg viewBox="0 0 14 20"><path d="M0 10 L14 0 L14 20Z" fill="var(--gold)" stroke="var(--gold-d)" strokeWidth="1" /><path d="M0 10 L14 0 L14 10Z" fill="rgba(255,255,255,.15)" /></svg></div>
              <div className="wn-ptr wn-ptr-r"><svg viewBox="0 0 14 20"><path d="M14 10 L0 0 L0 20Z" fill="var(--gold)" stroke="var(--gold-d)" strokeWidth="1" /><path d="M14 10 L0 0 L0 10Z" fill="rgba(255,255,255,.15)" /></svg></div>
            </div>
          </div>
        </div>

        {/* SPIN BUTTON */}
        <div className="wn-spin-area">
          <button className={`wn-btn ${spinning ? 'wn-btn-off' : !canSpin ? '' : 'wn-btn-pulse'}`} onClick={handleSpin} disabled={spinning}
            style={!canSpin && !spinning ? { background: 'linear-gradient(135deg, #333, #222)', boxShadow: '0 6px 0 #111, 0 8px 15px rgba(0,0,0,.3)', opacity: 0.7 } : {}}>
            <span style={{ fontSize: 22 }}>ᚾ</span> {canSpin ? 'КРУТИТЬ КОЛЕСО' : 'СПИНЫ ЗАКОНЧИЛИСЬ'}
          </button>
        </div>
        <div className="wn-hint">{hint}</div>

        {/* LOOT PREVIEW */}
        <div className="wn-loot">
          <div className="wn-loot-h">Возможные награды</div>
          <div className="wn-loot-row">
            <div className="wn-lc"><span className="wn-lc-i">🍜</span><span className="wn-lc-n">Еда</span></div>
            <div className="wn-lc rar"><span className="wn-lc-i">👕</span><span className="wn-lc-n">Мерч</span></div>
            <div className="wn-lc rar"><span className="wn-lc-i">⭐</span><span className="wn-lc-n">Привилегии</span></div>
            <div className="wn-lc epc"><span className="wn-lc-i">💎</span><span className="wn-lc-n">Цифровое</span></div>
            <div className="wn-lc leg"><span className="wn-lc-i">🧥</span><span className="wn-lc-n">Куртка</span></div>
          </div>
        </div>
      </div>

      {/* REWARD POPUP */}
      <div className={`wn-ov ${showReward ? 'wn-ov-on' : ''}`} onClick={claim} />
      <div className={`wn-rw ${showReward ? 'wn-rw-on' : ''}`}>
        {wonPrize && (
          <div className="wn-rw-card">
            <div className="wn-rw-handle" />
            <div className="wn-rw-icon">
              <div className={`wn-rw-glow ${wonPrize.tier}`} />
              {wonPrize.icon_svg
                ? <span className="wn-rw-emoji" style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', fontSize: 0, lineHeight: '110px' }}
                    dangerouslySetInnerHTML={{ __html: wonPrize.icon_svg.replace(/(<svg[^>]*)\s+(width|height)="[^"]*"/g, '$1').replace(/<svg/, '<svg width="72" height="72"') }} />
                : <div className="wn-rw-emoji">{wonPrize.icon}</div>}
            </div>
            <div style={{ textAlign: 'center' }}>
              <div className={`wn-rw-tag ${wonPrize.tier}`}>
                {wonPrize.tier === 'legendary' ? 'ЛЕГЕНДАРНЫЙ' : wonPrize.tier === 'epic' ? 'ЭПИЧЕСКИЙ' : wonPrize.tier === 'rare' ? 'РЕДКИЙ' : 'ОБЫЧНЫЙ'}
              </div><br />
              <div className="wn-rw-name">{wonPrize.name}</div>
              <div className="wn-rw-desc">{wonPrize.description || wonPrize.desc}</div>
              <div className={`wn-rw-val ${wonPrize.tier}`}>{wonPrize.value ? `+${wonPrize.value}` : '✓ Получено!'}</div>
              <button className={`wn-rw-btn ${wonPrize.tier}`} onClick={claim}>Забрать добычу!</button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
