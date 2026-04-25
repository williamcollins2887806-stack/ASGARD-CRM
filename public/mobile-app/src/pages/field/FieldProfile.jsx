/**
 * FieldProfile.jsx — WOW Viking Character Card
 * Полноростовой персонаж, уровень, руны, снаряжение
 */
import { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Shield, ChevronDown, ChevronUp,
  LogOut, Sun, Moon, Edit3, Check, X, Briefcase, Award, Sparkles,
} from 'lucide-react';
import { fieldApi } from '@/api/fieldClient';
import { useFieldAuthStore } from '@/stores/fieldAuthStore';
import { useHaptic } from '@/hooks/useHaptic';

/* ═══════════════════════════════════════════════════════════════════
   CSS ANIMATIONS
═══════════════════════════════════════════════════════════════════ */
const ANIM_CSS = `
@keyframes runeOrbit {
  from { transform: translate(-50%,-50%) rotate(0deg); }
  to   { transform: translate(-50%,-50%) rotate(360deg); }
}
@keyframes goldPulse {
  0%,100% { filter: drop-shadow(0 0 6px rgba(240,200,80,.35)); }
  50%     { filter: drop-shadow(0 0 20px rgba(240,200,80,.8)) drop-shadow(0 0 40px rgba(240,200,80,.3)); }
}
@keyframes rankGlow {
  0%,100% { text-shadow: 0 0 6px rgba(240,200,80,.3); }
  50%     { text-shadow: 0 0 16px rgba(240,200,80,.95), 0 0 32px rgba(240,200,80,.5); }
}
@keyframes badgePop {
  0%  { transform: scale(0) rotate(-20deg); opacity:0; }
  65% { transform: scale(1.3) rotate(6deg); opacity:1; }
  100%{ transform: scale(1) rotate(0deg);  opacity:1; }
}
@keyframes runeFloat {
  0%,100%{ opacity:.14; transform:translateY(0) rotate(0deg); }
  50%    { opacity:.28; transform:translateY(-12px) rotate(25deg); }
}
@keyframes statSlide {
  from { opacity:0; transform:translateY(8px); }
  to   { opacity:1; transform:translateY(0); }
}
@keyframes characterReveal {
  from { opacity:0; transform:translateY(12px) scale(.96); }
  to   { opacity:1; transform:translateY(0) scale(1); }
}
@keyframes xpFill {
  from { width:0; }
}
@keyframes iceFrost {
  0%,100%{ filter:drop-shadow(0 0 6px rgba(140,200,255,.4)); }
  50%    { filter:drop-shadow(0 0 18px rgba(140,200,255,.9)) drop-shadow(0 0 32px rgba(100,160,255,.4)); }
}
@keyframes fireFrost {
  0%,100%{ filter:drop-shadow(0 0 6px rgba(255,120,30,.4)); }
  50%    { filter:drop-shadow(0 0 20px rgba(255,80,0,.9)) drop-shadow(0 0 36px rgba(255,120,30,.5)); }
}
`;

/* ═══════════════════════════════════════════════════════════════════
   UTILS
═══════════════════════════════════════════════════════════════════ */
function getInitials(fio) {
  if (!fio) return '??';
  return fio.trim().split(/\s+/).map(w => w[0]).slice(0, 2).join('').toUpperCase();
}
function shortFio(fio) {
  if (!fio) return '';
  const p = fio.trim().split(/\s+/);
  if (p.length >= 3) return `${p[0]} ${p[1][0]}.${p[2][0]}.`;
  if (p.length === 2) return `${p[0]} ${p[1][0]}.`;
  return p[0];
}
function formatPhone(p) {
  if (!p) return '';
  const d = p.replace(/\D/g, '').replace(/^8/, '7');
  return d.length === 11 ? `+${d[0]} (${d.slice(1,4)}) ${d.slice(4,7)}-${d.slice(7,9)}-${d.slice(9,11)}` : p;
}
function expiryStatus(ds) {
  if (!ds) return 'unknown';
  const diff = new Date(ds) - new Date();
  return diff < 0 ? 'expired' : diff < 30*86400000 ? 'expiring' : 'active';
}
const EXP_COLORS = {
  active:   {bg:'#16a34a22',color:'#16a34a',label:'Действует'},
  expiring: {bg:'#ca8a0422',color:'#ca8a04',label:'Истекает'},
  expired:  {bg:'#dc262622',color:'#dc2626',label:'Просрочен'},
  unknown:  {bg:'#71717a22',color:'#71717a',label:''},
};

/* ═══════════════════════════════════════════════════════════════════
   GAMIFICATION CONSTANTS
═══════════════════════════════════════════════════════════════════ */
const XP_LEVELS = [0,100,250,450,700,1000,1400,1900,2500,3200,4000,5000,6200,7500,9000,10800,12800,15000,17500,20000];
const RANKS = [
  {min:1, max:2,  title:'Трэль',     rune:'ᚦ'},
  {min:3, max:4,  title:'Карл',      rune:'ᚲ'},
  {min:5, max:7,  title:'Хускарл',   rune:'ᚹ'},
  {min:8, max:11, title:'Дружинник', rune:'ᛏ'},
  {min:12,max:15, title:'Витязь',    rune:'ᛒ'},
  {min:16,max:19, title:'Ярл',       rune:'ᛖ'},
  {min:20,max:Infinity,title:'Конунг',rune:'ᛟ'},
];
function getLevel(xp=0) {
  for (let i = XP_LEVELS.length-1; i >= 0; i--) if (xp >= XP_LEVELS[i]) return i+1;
  return 1;
}
function getRank(level) { return RANKS.find(r=>level>=r.min && level<=r.max)||RANKS[0]; }

/* ═══════════════════════════════════════════════════════════════════
   CHARACTER SVGs — full-body Norse warriors (100×200 viewBox)
═══════════════════════════════════════════════════════════════════ */
const AVATAR_SVGS = {

  'Аватар "Один"': `<svg viewBox="0 0 100 200" width="100%" height="100%" preserveAspectRatio="xMidYMin slice" fill="none" xmlns="http://www.w3.org/2000/svg">
<defs>
  <radialGradient id="ob" cx="50%" cy="35%" r="65%"><stop offset="0%" stop-color="#1e2848"/><stop offset="100%" stop-color="#060810"/></radialGradient>
  <linearGradient id="oc" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stop-color="#18203a"/><stop offset="100%" stop-color="#0e1428"/></linearGradient>
  <linearGradient id="os" x1="0" y1="0" x2="1" y2="0"><stop offset="0%" stop-color="#3a4858"/><stop offset="100%" stop-color="#2a3848"/></linearGradient>
  <linearGradient id="osk" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stop-color="#c8a478"/><stop offset="100%" stop-color="#a8845a"/></linearGradient>
</defs>
<!-- atmosphere -->
<rect width="100" height="200" fill="url(#ob)"/>
<!-- spear shaft -->
<line x1="14" y1="180" x2="18" y2="20" stroke="#706048" stroke-width="2.5" stroke-linecap="round"/>
<path d="M16 16 L20 6 L24 16 L20 26Z" fill="#C8940A" stroke="#F0C850" stroke-width=".6"/>
<!-- raven left -->
<path d="M8 52 Q5 45 9 42 Q12 48 8 53Z" fill="#101828"/>
<path d="M9 42 L16 48" stroke="#101828" stroke-width="1.5" stroke-linecap="round"/>
<!-- raven right -->
<path d="M88 56 Q92 49 88 46 Q85 52 90 57Z" fill="#101828"/>
<path d="M88 46 L82 52" stroke="#101828" stroke-width="1.5" stroke-linecap="round"/>
<!-- boots -->
<path d="M34 170 L30 197 L25 197 Q24 192 27 184 L30 170Z" fill="#201810"/>
<path d="M66 170 L70 197 L75 197 Q76 192 73 184 L70 170Z" fill="#201810"/>
<path d="M28 182 L33 182" stroke="#3a2818" stroke-width="1.5"/>
<path d="M72 182 L67 182" stroke="#3a2818" stroke-width="1.5"/>
<!-- trousers -->
<path d="M32 140 L28 170 L38 170 L40 152 L50 155 L60 152 L62 170 L72 170 L68 140Z" fill="#282038"/>
<!-- cloak back -->
<path d="M20 80 Q15 120 16 165 L34 170 L30 140 L32 80Z" fill="#141c38" stroke="rgba(240,200,80,.1)" stroke-width=".5"/>
<path d="M80 80 Q85 120 84 165 L66 170 L70 140 L68 80Z" fill="#141c38" stroke="rgba(240,200,80,.1)" stroke-width=".5"/>
<!-- body / armor -->
<path d="M32 80 Q32 68 50 66 Q68 68 68 80 L68 140 L32 140Z" fill="url(#os)"/>
<!-- chainmail lines -->
<path d="M34 88 Q37 86 40 88 Q43 86 46 88 Q49 86 52 88 Q55 86 58 88 Q61 86 64 88 Q67 86 66 88" stroke="rgba(240,200,80,.18)" stroke-width=".6" fill="none"/>
<path d="M34 96 Q37 94 40 96 Q43 94 46 96 Q49 94 52 96 Q55 94 58 96 Q61 94 64 96 Q67 94 66 96" stroke="rgba(240,200,80,.15)" stroke-width=".6" fill="none"/>
<path d="M34 104 Q37 102 40 104 Q43 102 46 104 Q49 102 52 104 Q55 102 58 104 Q61 102 64 104 Q67 102 66 104" stroke="rgba(240,200,80,.12)" stroke-width=".6" fill="none"/>
<!-- armor chest rune -->
<text x="50" y="118" text-anchor="middle" font-size="12" fill="rgba(240,200,80,.25)" font-family="serif">ᚨ</text>
<!-- belt -->
<rect x="32" y="136" width="36" height="5" rx="2" fill="#303848" stroke="rgba(240,200,80,.35)" stroke-width=".5"/>
<rect x="47" y="135" width="6" height="7" rx="1" fill="#404858" stroke="rgba(240,200,80,.5)" stroke-width=".5"/>
<!-- fur shoulder trim -->
<path d="M22 80 Q30 72 50 68 Q70 72 78 80" fill="#5a4030" opacity=".9"/>
<!-- LEFT arm (hand holds spear) -->
<path d="M32 82 Q22 96 18 110" stroke="#3a4858" stroke-width="10" stroke-linecap="round" fill="none"/>
<path d="M32 82 Q22 96 18 110" stroke="#c8a060" stroke-width="7" stroke-linecap="round" fill="none"/>
<circle cx="18" cy="112" r="5" fill="#c8a060"/>
<!-- RIGHT arm (raised slightly) -->
<path d="M68 82 Q78 90 82 106" stroke="#3a4858" stroke-width="10" stroke-linecap="round" fill="none"/>
<path d="M68 82 Q78 90 82 106" stroke="#c8a060" stroke-width="7" stroke-linecap="round" fill="none"/>
<circle cx="83" cy="108" r="5" fill="#c8a060"/>
<!-- neck -->
<rect x="44" y="62" width="12" height="7" rx="3" fill="#c8a478"/>
<!-- head -->
<ellipse cx="50" cy="46" rx="18" ry="20" fill="url(#osk)"/>
<!-- white beard -->
<path d="M33 54 Q30 66 32 76 Q38 86 50 88 Q62 86 68 76 Q70 66 67 54" fill="#d4d4cc"/>
<path d="M36 58 Q34 68 36 76 Q42 84 50 86 Q58 84 64 76 Q66 68 64 58" fill="#c4c4bc" opacity=".5"/>
<!-- mustache -->
<path d="M39 55 Q44 50 50 51 Q56 50 61 55" stroke="#c8c8c0" stroke-width="2.5" fill="none" stroke-linecap="round"/>
<!-- eye patch -->
<path d="M32 43 L44 45" stroke="#5a4020" stroke-width="2" stroke-linecap="round"/>
<ellipse cx="37" cy="44" rx="5.5" ry="3.5" fill="#150e08" stroke="#3a2010" stroke-width=".6"/>
<!-- right eye -->
<ellipse cx="60" cy="43" rx="5" ry="4" fill="#f0ece4"/>
<circle cx="60" cy="43" r="2.8" fill="#1e50a8"/>
<circle cx="60" cy="43" r="1.6" fill="#0e3070"/>
<circle cx="61" cy="42" r=".8" fill="#fff"/>
<!-- eyebrow right -->
<path d="M55 39 Q60 36 65 39" stroke="#9a8060" stroke-width="1.8" fill="none" stroke-linecap="round"/>
<!-- helmet -->
<path d="M32 42 Q33 22 50 18 Q67 22 68 42 Q62 32 56 34 Q53 24 50 23 Q47 24 44 34 Q38 32 32 42Z" fill="#3a4050" stroke="#50586a" stroke-width=".5"/>
<!-- wings -->
<path d="M32 42 Q20 34 16 20 Q24 28 34 40Z" fill="#464e60"/>
<path d="M68 42 Q80 34 84 20 Q76 28 66 40Z" fill="#464e60"/>
<!-- helmet gold band -->
<path d="M32 42 Q37 36 43 35 Q46 27 50 26 Q54 27 57 35 Q63 36 68 42" stroke="#C8940A" stroke-width="1.3" fill="none"/>
<!-- nasal guard -->
<path d="M48.5 40 L50 50 L51.5 40" fill="#303845"/>
<!-- forehead rune -->
<text x="50" y="36" text-anchor="middle" font-size="7" fill="rgba(240,200,80,.55)" font-family="serif">ᚨ</text>
<!-- hair sides -->
<path d="M33 42 Q28 52 29 62" stroke="#7a6040" stroke-width="3.5" stroke-linecap="round" fill="none"/>
<path d="M67 42 Q72 52 71 62" stroke="#7a6040" stroke-width="3.5" stroke-linecap="round" fill="none"/>
</svg>`,

  'Аватар "Тор"': `<svg viewBox="0 0 100 200" width="100%" height="100%" preserveAspectRatio="xMidYMin slice" fill="none" xmlns="http://www.w3.org/2000/svg">
<defs>
  <radialGradient id="tb" cx="50%" cy="35%" r="65%"><stop offset="0%" stop-color="#1a2040"/><stop offset="100%" stop-color="#060810"/></radialGradient>
  <linearGradient id="tl" x1=".5" y1="0" x2=".5" y2="1"><stop offset="0%" stop-color="#F0C850"/><stop offset="100%" stop-color="#ff6800"/></linearGradient>
  <linearGradient id="ts" x1="0" y1="0" x2="1" y2="0"><stop offset="0%" stop-color="#3a4860"/><stop offset="100%" stop-color="#2a3850"/></linearGradient>
</defs>
<rect width="100" height="200" fill="url(#tb)"/>
<!-- lightning hints -->
<path d="M70 4 L64 22 L70 22 L56 50" stroke="url(#tl)" stroke-width="1.8" fill="none" opacity=".18" stroke-linecap="round"/>
<path d="M28 8 L24 24 L30 24 L18 48" stroke="url(#tl)" stroke-width="1.2" fill="none" opacity=".12" stroke-linecap="round"/>
<!-- boots -->
<path d="M34 170 L30 197 L25 197 Q24 192 27 184 L30 170Z" fill="#201810"/>
<path d="M66 170 L70 197 L75 197 Q76 192 73 184 L70 170Z" fill="#201810"/>
<path d="M28 182 L33 182" stroke="#3a2818" stroke-width="1.5"/>
<path d="M72 182 L67 182" stroke="#3a2818" stroke-width="1.5"/>
<!-- trousers -->
<path d="M32 140 L28 170 L38 170 L40 152 L50 156 L60 152 L62 170 L72 170 L68 140Z" fill="#1e1830"/>
<!-- red cape back -->
<path d="M18 80 Q12 120 14 168 L30 170 L28 140 L30 80Z" fill="#3a0e0e" opacity=".8"/>
<path d="M82 80 Q88 120 86 168 L70 170 L72 140 L70 80Z" fill="#3a0e0e" opacity=".8"/>
<!-- cape gold trim -->
<path d="M18 80 Q15 100 14 120" stroke="rgba(240,200,80,.3)" stroke-width="1" fill="none" stroke-dasharray="3 3"/>
<path d="M82 80 Q85 100 86 120" stroke="rgba(240,200,80,.3)" stroke-width="1" fill="none" stroke-dasharray="3 3"/>
<!-- body / plate armor -->
<path d="M30 80 Q30 68 50 65 Q70 68 70 80 L70 140 L30 140Z" fill="url(#ts)"/>
<!-- plate bands -->
<path d="M30 90 L70 90" stroke="rgba(240,200,80,.2)" stroke-width=".8"/>
<path d="M30 100 L70 100" stroke="rgba(240,200,80,.18)" stroke-width=".8"/>
<path d="M30 110 L70 110" stroke="rgba(240,200,80,.15)" stroke-width=".8"/>
<!-- chest emblem: hammer -->
<path d="M44 115 L56 115 L56 110 L44 110Z" fill="rgba(240,200,80,.3)"/>
<path d="M48 110 L52 110 L52 98 L48 98Z" fill="rgba(240,200,80,.25)"/>
<!-- belt -->
<rect x="30" y="136" width="40" height="5" rx="2" fill="#303848" stroke="rgba(240,200,80,.35)" stroke-width=".5"/>
<rect x="46" y="135" width="8" height="7" rx="1" fill="#404858" stroke="rgba(240,200,80,.5)" stroke-width=".5"/>
<!-- fur shoulder -->
<path d="M20 82 Q30 72 50 68 Q70 72 80 82" fill="#5a4030" opacity=".9"/>
<!-- LEFT arm -->
<path d="M30 84 Q20 98 16 114" stroke="#3a4858" stroke-width="10" stroke-linecap="round" fill="none"/>
<path d="M30 84 Q20 98 16 114" stroke="#c88458" stroke-width="7" stroke-linecap="round" fill="none"/>
<circle cx="15" cy="116" r="5" fill="#c88458"/>
<!-- RIGHT arm (holding hammer) -->
<path d="M70 84 Q82 94 86 110" stroke="#3a4858" stroke-width="10" stroke-linecap="round" fill="none"/>
<path d="M70 84 Q82 94 86 110" stroke="#c88458" stroke-width="7" stroke-linecap="round" fill="none"/>
<!-- Mjolnir handle -->
<line x1="86" y1="112" x2="86" y2="85" stroke="#605040" stroke-width="3" stroke-linecap="round"/>
<!-- Mjolnir head -->
<path d="M78 78 L94 78 L94 90 L90 92 L82 92 L78 90Z" fill="#484858" stroke="#F0C850" stroke-width=".7"/>
<path d="M80 84 L84 82 L84 88" stroke="rgba(240,200,80,.4)" stroke-width=".6" fill="none"/>
<!-- neck -->
<rect x="44" y="60" width="12" height="7" rx="3" fill="#c88458"/>
<!-- head -->
<ellipse cx="50" cy="44" rx="19" ry="21" fill="#c88458"/>
<!-- red-blond beard -->
<path d="M31 52 Q28 64 30 74 Q36 86 50 88 Q64 86 70 74 Q72 64 69 52" fill="#b06828"/>
<path d="M34 56 Q32 66 34 74 Q40 84 50 86 Q60 84 66 74 Q68 66 66 56" fill="#c07838" opacity=".5"/>
<!-- mustache -->
<path d="M38 53 Q44 48 50 49 Q56 48 62 53" stroke="#a05820" stroke-width="3" fill="none" stroke-linecap="round"/>
<!-- left eye -->
<ellipse cx="43" cy="43" rx="5" ry="4" fill="#f0ece4"/>
<circle cx="43" cy="43" r="2.8" fill="#1a60cc"/>
<circle cx="43" cy="43" r="1.6" fill="#0a3080"/>
<circle cx="44" cy="42" r=".8" fill="#fff"/>
<!-- right eye -->
<ellipse cx="57" cy="43" rx="5" ry="4" fill="#f0ece4"/>
<circle cx="57" cy="43" r="2.8" fill="#1a60cc"/>
<circle cx="57" cy="43" r="1.6" fill="#0a3080"/>
<circle cx="58" cy="42" r=".8" fill="#fff"/>
<!-- eyebrows -->
<path d="M37 38 Q43 35 48 38" stroke="#a05820" stroke-width="2.5" fill="none" stroke-linecap="round"/>
<path d="M52 38 Q57 35 63 38" stroke="#a05820" stroke-width="2.5" fill="none" stroke-linecap="round"/>
<!-- winged helmet -->
<path d="M31 42 Q31 20 50 16 Q69 20 69 42 Q62 30 56 32 Q53 22 50 21 Q47 22 44 32 Q38 30 31 42Z" fill="#3a4860" stroke="#505870" stroke-width=".5"/>
<path d="M31 42 Q18 34 14 18 Q23 28 33 40Z" fill="#505e72"/>
<path d="M69 42 Q82 34 86 18 Q77 28 67 40Z" fill="#505e72"/>
<!-- helmet gold trim -->
<path d="M31 42 Q37 36 44 35 Q47 26 50 25 Q53 26 56 35 Q63 36 69 42" stroke="#C8940A" stroke-width="1.3" fill="none"/>
<!-- nasal -->
<path d="M48.5 40 L50 50 L51.5 40" fill="#303848"/>
<!-- forehead rune -->
<text x="50" y="34" text-anchor="middle" font-size="7" fill="rgba(240,200,80,.55)" font-family="serif">ᚦ</text>
<!-- red-blond hair sides -->
<path d="M31 42 Q26 52 27 62" stroke="#b06828" stroke-width="4" stroke-linecap="round" fill="none"/>
<path d="M69 42 Q74 52 73 62" stroke="#b06828" stroke-width="4" stroke-linecap="round" fill="none"/>
<!-- lightning glow eyes hint -->
<ellipse cx="43" cy="43" rx="6" ry="5" fill="none" stroke="rgba(100,160,255,.25)" stroke-width="1"/>
<ellipse cx="57" cy="43" rx="6" ry="5" fill="none" stroke="rgba(100,160,255,.25)" stroke-width="1"/>
</svg>`,

  'Аватар "Воин"': `<svg viewBox="0 0 100 200" width="100%" height="100%" preserveAspectRatio="xMidYMin slice" fill="none" xmlns="http://www.w3.org/2000/svg">
<defs>
  <radialGradient id="wbg" cx="50%" cy="35%" r="65%"><stop offset="0%" stop-color="#1a2218"/><stop offset="100%" stop-color="#070c06"/></radialGradient>
  <linearGradient id="wla" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stop-color="#7a4a20"/><stop offset="100%" stop-color="#4a2810"/></linearGradient>
  <radialGradient id="wsk" cx="45%" cy="38%" r="55%"><stop offset="0%" stop-color="#d4a870"/><stop offset="50%" stop-color="#c09050"/><stop offset="100%" stop-color="#8a5830"/></radialGradient>
</defs>
<rect width="100" height="200" fill="url(#wbg)"/>
<path d="M34 170 L30 197 L25 197 Q24 192 27 184 L30 170Z" fill="#1a1008"/>
<path d="M66 170 L70 197 L75 197 Q76 192 73 184 L70 170Z" fill="#1a1008"/>
<path d="M27 184 L32 184" stroke="#302010" stroke-width="1.5"/>
<path d="M73 184 L68 184" stroke="#302010" stroke-width="1.5"/>
<path d="M32 140 L28 170 L38 170 L40 152 L50 155 L60 152 L62 170 L72 170 L68 140Z" fill="#282218"/>
<path d="M32 80 Q32 68 50 66 Q68 68 68 80 L68 140 L32 140Z" fill="url(#wla)"/>
<path d="M38 80 L38 140" stroke="#301808" stroke-width=".8" opacity=".6"/>
<path d="M62 80 L62 140" stroke="#301808" stroke-width=".8" opacity=".6"/>
<path d="M34 95 Q50 92 66 95" stroke="#301808" stroke-width=".7" fill="none" opacity=".5"/>
<path d="M34 115 Q50 112 66 115" stroke="#301808" stroke-width=".7" fill="none" opacity=".5"/>
<circle cx="40" cy="88" r="1.5" fill="#b08838" opacity=".7"/>
<circle cx="60" cy="88" r="1.5" fill="#b08838" opacity=".7"/>
<circle cx="40" cy="108" r="1.5" fill="#b08838" opacity=".5"/>
<circle cx="60" cy="108" r="1.5" fill="#b08838" opacity=".5"/>
<rect x="32" y="136" width="36" height="5" rx="2" fill="#3a2810" stroke="rgba(200,160,60,.4)" stroke-width=".5"/>
<rect x="47" y="135" width="6" height="7" rx="1" fill="#503820" stroke="rgba(200,160,60,.5)" stroke-width=".5"/>
<path d="M22 82 Q30 72 50 68 Q70 72 78 82" fill="#6a5040" opacity=".8"/>
<path d="M32 82 Q22 96 18 112" stroke="#7a4a20" stroke-width="10" stroke-linecap="round" fill="none"/>
<path d="M32 82 Q22 96 18 112" stroke="#c8a060" stroke-width="7" stroke-linecap="round" fill="none"/>
<circle cx="17" cy="114" r="5" fill="#c8a060"/>
<path d="M68 82 Q80 92 84 108" stroke="#7a4a20" stroke-width="10" stroke-linecap="round" fill="none"/>
<path d="M68 82 Q80 92 84 108" stroke="#c8a060" stroke-width="7" stroke-linecap="round" fill="none"/>
<line x1="85" y1="114" x2="82" y2="74" stroke="#604828" stroke-width="2.5" stroke-linecap="round"/>
<path d="M78 68 Q70 60 72 74 Q78 76 86 74 Q88 62 78 68Z" fill="#686880" stroke="rgba(240,200,80,.6)" stroke-width=".7"/>
<path d="M76 70 Q78 66 80 70" stroke="rgba(255,255,255,.2)" stroke-width=".5" fill="none"/>
<rect x="44" y="62" width="12" height="7" rx="3" fill="#c8a060"/>
<ellipse cx="50" cy="46" rx="18" ry="20" fill="url(#wsk)"/>
<path d="M33 54 Q30 66 32 76 Q38 86 50 88 Q62 86 68 76 Q70 66 67 54" fill="#8a4818"/>
<path d="M36 58 Q34 68 36 76 Q42 84 50 86 Q58 84 64 76 Q66 68 64 58" fill="#a05820" opacity=".4"/>
<path d="M38 55 Q44 50 50 51 Q56 50 62 55" stroke="#7a3810" stroke-width="2.5" fill="none" stroke-linecap="round"/>
<ellipse cx="42" cy="43" rx="5" ry="4" fill="#f0ece4"/>
<circle cx="42" cy="43" r="2.8" fill="#3a6820"/>
<circle cx="42" cy="43" r="1.6" fill="#1a4010"/>
<circle cx="43" cy="42" r=".8" fill="#fff"/>
<ellipse cx="58" cy="43" rx="5" ry="4" fill="#f0ece4"/>
<circle cx="58" cy="43" r="2.8" fill="#3a6820"/>
<circle cx="58" cy="43" r="1.6" fill="#1a4010"/>
<circle cx="59" cy="42" r=".8" fill="#fff"/>
<path d="M36 38 Q42 35 47 38" stroke="#6a3810" stroke-width="2" fill="none" stroke-linecap="round"/>
<path d="M53 38 Q58 35 64 38" stroke="#6a3810" stroke-width="2" fill="none" stroke-linecap="round"/>
<path d="M32 36 Q34 18 50 16 Q66 18 68 36" fill="#7a3a10"/>
<path d="M33 38 Q28 50 29 62" stroke="#7a3a10" stroke-width="4" stroke-linecap="round" fill="none"/>
<path d="M67 38 Q72 50 71 62" stroke="#7a3a10" stroke-width="4" stroke-linecap="round" fill="none"/>
<circle cx="29" cy="62" r="3" fill="#4a2010"/>
<circle cx="71" cy="62" r="3" fill="#4a2010"/>
<path d="M44 34 L48 38" stroke="#7a5030" stroke-width=".8" stroke-linecap="round" opacity=".7"/>
</svg>`,

  'Аватар "Берсерк"': `<svg viewBox="0 0 100 200" width="100%" height="100%" preserveAspectRatio="xMidYMin slice" fill="none" xmlns="http://www.w3.org/2000/svg">
<defs>
  <radialGradient id="bbg" cx="50%" cy="35%" r="65%"><stop offset="0%" stop-color="#1a0808"/><stop offset="100%" stop-color="#080404"/></radialGradient>
  <radialGradient id="bsk" cx="45%" cy="38%" r="55%"><stop offset="0%" stop-color="#d4906a"/><stop offset="50%" stop-color="#c07850"/><stop offset="100%" stop-color="#8a5030"/></radialGradient>
  <linearGradient id="bch" x1="0" y1="0" x2="1" y2="1"><stop offset="0%" stop-color="#c8907a"/><stop offset="100%" stop-color="#a06048"/></linearGradient>
</defs>
<rect width="100" height="200" fill="url(#bbg)"/>
<path d="M34 170 L30 197 L25 197 Q24 192 27 184 L30 170Z" fill="#241008"/>
<path d="M66 170 L70 197 L75 197 Q76 192 73 184 L70 170Z" fill="#241008"/>
<path d="M32 140 L28 170 L38 170 L40 152 L50 155 L60 152 L62 170 L72 170 L68 140Z" fill="#2a1a10"/>
<path d="M32 80 Q32 70 50 68 Q68 70 68 80 L68 140 L32 140Z" fill="url(#bch)"/>
<path d="M36 80 L38 140" stroke="rgba(180,80,40,.3)" stroke-width="1" opacity=".5"/>
<path d="M64 80 L62 140" stroke="rgba(180,80,40,.3)" stroke-width="1" opacity=".5"/>
<path d="M34 88 L44 96" stroke="#cc2020" stroke-width="1.8" stroke-linecap="round" opacity=".7"/>
<path d="M66 88 L56 96" stroke="#cc2020" stroke-width="1.8" stroke-linecap="round" opacity=".7"/>
<path d="M38 104 L48 112" stroke="#cc2020" stroke-width="1.5" stroke-linecap="round" opacity=".6"/>
<path d="M62 104 L52 112" stroke="#cc2020" stroke-width="1.5" stroke-linecap="round" opacity=".6"/>
<rect x="32" y="136" width="36" height="5" rx="2" fill="#3a1810" stroke="rgba(200,80,40,.4)" stroke-width=".5"/>
<rect x="47" y="135" width="6" height="7" rx="1" fill="#501820" stroke="rgba(200,80,40,.5)" stroke-width=".5"/>
<path d="M22 82 Q30 70 50 66 Q70 70 78 82" fill="#8a5030" opacity=".7"/>
<path d="M30 82 Q18 94 14 110" stroke="#8a5030" stroke-width="10" stroke-linecap="round" fill="none"/>
<path d="M30 82 Q18 94 14 110" stroke="#c8806a" stroke-width="7" stroke-linecap="round" fill="none"/>
<line x1="13" y1="114" x2="8" y2="75" stroke="#5a3820" stroke-width="2" stroke-linecap="round"/>
<path d="M4 65 Q-1 57 3 70 Q8 72 14 70 Q14 57 4 65Z" fill="#585868" stroke="rgba(220,80,40,.7)" stroke-width=".8"/>
<path d="M70 82 Q82 92 87 108" stroke="#8a5030" stroke-width="10" stroke-linecap="round" fill="none"/>
<path d="M70 82 Q82 92 87 108" stroke="#c8806a" stroke-width="7" stroke-linecap="round" fill="none"/>
<line x1="88" y1="112" x2="92" y2="74" stroke="#5a3820" stroke-width="2" stroke-linecap="round"/>
<path d="M96 64 Q101 56 97 70 Q92 72 86 70 Q86 57 96 64Z" fill="#585868" stroke="rgba(220,80,40,.7)" stroke-width=".8"/>
<rect x="44" y="62" width="12" height="7" rx="3" fill="#c8806a"/>
<ellipse cx="50" cy="46" rx="18" ry="20" fill="url(#bsk)"/>
<path d="M34 52 Q30 64 32 74 Q38 86 50 88 Q62 86 68 74 Q70 64 66 52" fill="#a03010"/>
<path d="M36 55 Q34 66 36 74 Q42 84 50 86 Q58 84 64 74 Q66 66 64 55" fill="#c04020" opacity=".4"/>
<path d="M39 53 Q44 48 50 49 Q56 48 61 53" stroke="#8a2010" stroke-width="3" fill="none" stroke-linecap="round"/>
<ellipse cx="42" cy="42" rx="5.5" ry="4.5" fill="#f0ece4"/>
<circle cx="42" cy="42" r="3" fill="#cc2020"/>
<circle cx="42" cy="42" r="1.8" fill="#800000"/>
<circle cx="43" cy="41" r=".9" fill="#ffaaaa"/>
<ellipse cx="58" cy="42" rx="5.5" ry="4.5" fill="#f0ece4"/>
<circle cx="58" cy="42" r="3" fill="#cc2020"/>
<circle cx="58" cy="42" r="1.8" fill="#800000"/>
<circle cx="59" cy="41" r=".9" fill="#ffaaaa"/>
<path d="M35 37 Q42 33 48 37" stroke="#8a2010" stroke-width="2.5" fill="none" stroke-linecap="round"/>
<path d="M52 37 Q58 33 65 37" stroke="#8a2010" stroke-width="2.5" fill="none" stroke-linecap="round"/>
<path d="M32 36 Q34 14 50 10 Q66 14 68 36" fill="#b03010"/>
<path d="M33 36 Q22 46 20 62 L28 60" stroke="#b03010" stroke-width="5" stroke-linecap="round" fill="none"/>
<path d="M67 36 Q78 46 80 62 L72 60" stroke="#b03010" stroke-width="5" stroke-linecap="round" fill="none"/>
<path d="M40 38 Q38 26 36 16" stroke="#c04020" stroke-width="2.2" stroke-linecap="round" fill="none" opacity=".6"/>
<path d="M60 38 Q62 26 64 16" stroke="#c04020" stroke-width="2.2" stroke-linecap="round" fill="none" opacity=".6"/>
<path d="M34 42 L42 46" stroke="#cc2020" stroke-width="1.5" stroke-linecap="round" opacity=".8"/>
<path d="M58 46 L66 42" stroke="#cc2020" stroke-width="1.5" stroke-linecap="round" opacity=".8"/>
</svg>`,

  'Аватар "Вёльва"': `<svg viewBox="0 0 100 200" width="100%" height="100%" preserveAspectRatio="xMidYMin slice" fill="none" xmlns="http://www.w3.org/2000/svg">
<defs>
  <radialGradient id="vbg" cx="50%" cy="35%" r="65%"><stop offset="0%" stop-color="#12101e"/><stop offset="100%" stop-color="#060408"/></radialGradient>
  <linearGradient id="vrb" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stop-color="#3a2860"/><stop offset="100%" stop-color="#1e1438"/></linearGradient>
  <radialGradient id="vsk" cx="45%" cy="38%" r="55%"><stop offset="0%" stop-color="#d4c4b8"/><stop offset="50%" stop-color="#b8a898"/><stop offset="100%" stop-color="#8a7868"/></radialGradient>
</defs>
<rect width="100" height="200" fill="url(#vbg)"/>
<path d="M50 170 L50 197" stroke="#2a1e48" stroke-width="18" stroke-linecap="round"/>
<path d="M38 170 L34 197 L28 197 Q28 190 32 182Z" fill="#2a1e48"/>
<path d="M62 170 L66 197 L72 197 Q72 190 68 182Z" fill="#2a1e48"/>
<path d="M30 84 Q28 110 32 140 Q38 165 50 172 Q62 165 68 140 Q72 110 70 84 Q60 78 50 76 Q40 78 30 84Z" fill="url(#vrb)"/>
<path d="M30 84 Q25 100 24 130 Q26 155 38 168 L38 170 L30 170 Q24 145 24 120 Q24 98 30 82Z" fill="#2a1e50" opacity=".9"/>
<path d="M70 84 Q75 100 76 130 Q74 155 62 168 L62 170 L70 170 Q76 145 76 120 Q76 98 70 82Z" fill="#2a1e50" opacity=".9"/>
<path d="M32 100 L68 100" stroke="rgba(180,140,255,.12)" stroke-width=".7"/>
<path d="M30 120 L70 120" stroke="rgba(180,140,255,.1)" stroke-width=".7"/>
<path d="M32 140 L68 140" stroke="rgba(180,140,255,.08)" stroke-width=".7"/>
<text x="50" y="112" text-anchor="middle" font-size="10" fill="rgba(180,140,255,.18)" font-family="serif">ᛟ</text>
<text x="42" y="128" text-anchor="middle" font-size="7" fill="rgba(180,140,255,.14)" font-family="serif">ᚨ</text>
<text x="58" y="128" text-anchor="middle" font-size="7" fill="rgba(180,140,255,.14)" font-family="serif">ᚱ</text>
<path d="M22 84 Q30 74 50 70 Q70 74 78 84 Q60 78 50 76 Q40 78 22 84Z" fill="#28204a" opacity=".9"/>
<path d="M26 82 Q22 70 24 55 Q26 45 32 44 Q28 55 30 68Z" fill="#2a1e50"/>
<path d="M74 82 Q78 70 76 55 Q74 45 68 44 Q72 55 70 68Z" fill="#2a1e50"/>
<path d="M30 82 Q20 94 18 112" stroke="#3a2860" stroke-width="10" stroke-linecap="round" fill="none"/>
<path d="M30 82 Q20 94 18 112" stroke="#8878b8" stroke-width="7" stroke-linecap="round" fill="none"/>
<line x1="17" y1="115" x2="12" y2="170" stroke="#403050" stroke-width="2.5" stroke-linecap="round"/>
<path d="M8 162 Q6 150 12 148 Q16 150 12 170Z" fill="#7858c8" opacity=".8"/>
<circle cx="12" cy="148" r="3" fill="#9878e8" opacity=".7"/>
<path d="M70 82 Q80 94 82 112" stroke="#3a2860" stroke-width="10" stroke-linecap="round" fill="none"/>
<path d="M70 82 Q80 94 82 112" stroke="#8878b8" stroke-width="7" stroke-linecap="round" fill="none"/>
<circle cx="83" cy="114" r="5" fill="#8878b8"/>
<rect x="44" y="62" width="12" height="8" rx="3" fill="#b0a0c0"/>
<ellipse cx="50" cy="47" rx="16" ry="18" fill="url(#vsk)"/>
<path d="M35 54 Q32 66 34 76 Q40 86 50 88 Q60 86 66 76 Q68 66 65 54" fill="#d0c8d8" opacity=".9"/>
<path d="M36 58 Q34 68 36 76 Q42 84 50 86 Q58 84 64 76 Q66 68 64 58" fill="#e0d8e8" opacity=".35"/>
<path d="M40 56 Q44 52 50 53 Q56 52 60 56" stroke="#b0a8c0" stroke-width="1.5" fill="none" stroke-linecap="round"/>
<ellipse cx="43" cy="44" rx="5" ry="4" fill="#f0ece8"/>
<circle cx="43" cy="44" r="2.8" fill="#7858c8"/>
<circle cx="43" cy="44" r="1.6" fill="#5038a8"/>
<circle cx="44" cy="43" r=".9" fill="#ddd8ff"/>
<ellipse cx="57" cy="44" rx="5" ry="4" fill="#f0ece8"/>
<circle cx="57" cy="44" r="2.8" fill="#7858c8"/>
<circle cx="57" cy="44" r="1.6" fill="#5038a8"/>
<circle cx="58" cy="43" r=".9" fill="#ddd8ff"/>
<path d="M37 39 Q43 36 48 39" stroke="#a090b0" stroke-width="1.5" fill="none" stroke-linecap="round"/>
<path d="M52 39 Q57 36 63 39" stroke="#a090b0" stroke-width="1.5" fill="none" stroke-linecap="round"/>
<path d="M34 40 Q36 22 50 18 Q64 22 66 40" fill="#c8c0d8"/>
<path d="M34 42 Q26 52 24 66 L28 68 Q26 55 34 45Z" stroke="#d0c8e0" stroke-width="3" stroke-linecap="round" fill="none"/>
<path d="M66 42 Q74 52 76 66 L72 68 Q74 55 66 45Z" stroke="#d0c8e0" stroke-width="3" stroke-linecap="round" fill="none"/>
<text x="50" y="38" text-anchor="middle" font-size="6" fill="rgba(180,140,255,.55)" font-family="serif">᛹</text>
</svg>`,

  'Аватар "Скальд"': `<svg viewBox="0 0 100 200" width="100%" height="100%" preserveAspectRatio="xMidYMin slice" fill="none" xmlns="http://www.w3.org/2000/svg">
<defs>
  <radialGradient id="sbg" cx="50%" cy="35%" r="65%"><stop offset="0%" stop-color="#1a1408"/><stop offset="100%" stop-color="#080602"/></radialGradient>
  <linearGradient id="stu" x1="0" y1="0" x2="1" y2="1"><stop offset="0%" stop-color="#2e6040"/><stop offset="50%" stop-color="#1a4828"/><stop offset="100%" stop-color="#3a1e08"/></linearGradient>
  <radialGradient id="ssk" cx="45%" cy="38%" r="55%"><stop offset="0%" stop-color="#d4aa78"/><stop offset="50%" stop-color="#c09060"/><stop offset="100%" stop-color="#8a6035"/></radialGradient>
</defs>
<rect width="100" height="200" fill="url(#sbg)"/>
<path d="M34 170 L30 197 L25 197 Q24 192 27 184 L30 170Z" fill="#1a1208"/>
<path d="M66 170 L70 197 L75 197 Q76 192 73 184 L70 170Z" fill="#1a1208"/>
<path d="M27 184 L32 184" stroke="#302010" stroke-width="1.5"/>
<path d="M73 184 L68 184" stroke="#302010" stroke-width="1.5"/>
<path d="M32 140 L28 170 L38 170 L40 152 L50 155 L60 152 L62 170 L72 170 L68 140Z" fill="#241c10"/>
<path d="M32 80 Q32 68 50 66 Q68 68 68 80 L68 140 L32 140Z" fill="url(#stu)"/>
<path d="M35 78 Q38 90 38 140" stroke="rgba(200,160,60,.15)" stroke-width=".8" fill="none"/>
<path d="M65 78 Q62 90 62 140" stroke="rgba(200,160,60,.15)" stroke-width=".8" fill="none"/>
<path d="M34 94 L66 94" stroke="rgba(240,180,60,.15)" stroke-width=".6"/>
<path d="M34 110 L66 110" stroke="rgba(240,180,60,.12)" stroke-width=".6"/>
<path d="M34 126 L66 126" stroke="rgba(240,180,60,.1)" stroke-width=".6"/>
<path d="M42 80 L42 94 M50 80 L50 94 M58 80 L58 94" stroke="rgba(240,160,40,.2)" stroke-width="1"/>
<rect x="32" y="136" width="36" height="5" rx="2" fill="#302010" stroke="rgba(240,180,60,.45)" stroke-width=".5"/>
<rect x="47" y="135" width="6" height="7" rx="1" fill="#483020" stroke="rgba(240,180,60,.55)" stroke-width=".5"/>
<path d="M22 82 Q30 72 50 68 Q70 72 78 82" fill="#5a4428" opacity=".8"/>
<path d="M32 82 Q22 96 18 112" stroke="#4a3820" stroke-width="10" stroke-linecap="round" fill="none"/>
<path d="M32 82 Q22 96 18 112" stroke="#c8a060" stroke-width="7" stroke-linecap="round" fill="none"/>
<circle cx="17" cy="114" r="5" fill="#c8a060"/>
<path d="M68 82 Q80 92 83 108" stroke="#4a3820" stroke-width="10" stroke-linecap="round" fill="none"/>
<path d="M68 82 Q80 92 83 108" stroke="#c8a060" stroke-width="7" stroke-linecap="round" fill="none"/>
<ellipse cx="90" cy="100" rx="9" ry="14" fill="#1a120a" stroke="rgba(240,180,60,.5)" stroke-width=".8"/>
<line x1="84" y1="94" x2="84" y2="106" stroke="rgba(240,180,60,.35)" stroke-width=".6"/>
<line x1="87" y1="92" x2="87" y2="108" stroke="rgba(240,180,60,.4)" stroke-width=".6"/>
<line x1="90" y1="91" x2="90" y2="109" stroke="rgba(240,180,60,.4)" stroke-width=".6"/>
<line x1="93" y1="92" x2="93" y2="108" stroke="rgba(240,180,60,.4)" stroke-width=".6"/>
<line x1="96" y1="94" x2="96" y2="106" stroke="rgba(240,180,60,.35)" stroke-width=".6"/>
<path d="M82 94 L98 94" stroke="rgba(240,180,60,.4)" stroke-width=".7"/>
<path d="M82 106 L98 106" stroke="rgba(240,180,60,.4)" stroke-width=".7"/>
<circle cx="90" cy="88" r="3" fill="#1a120a" stroke="rgba(240,180,60,.6)" stroke-width=".8"/>
<rect x="44" y="62" width="12" height="7" rx="3" fill="#c8a060"/>
<ellipse cx="50" cy="46" rx="18" ry="20" fill="url(#ssk)"/>
<path d="M33 54 Q30 66 32 76 Q38 86 50 88 Q62 86 68 76 Q70 66 67 54" fill="#6a4020"/>
<path d="M36 58 Q34 68 36 76 Q42 84 50 86 Q58 84 64 76 Q66 68 64 58" fill="#7a4828" opacity=".45"/>
<path d="M38 55 Q44 50 50 51 Q56 50 62 55" stroke="#5a3010" stroke-width="2" fill="none" stroke-linecap="round"/>
<ellipse cx="42" cy="43" rx="5" ry="4" fill="#f0ece4"/>
<circle cx="42" cy="43" r="2.8" fill="#a85820"/>
<circle cx="42" cy="43" r="1.6" fill="#6a3410"/>
<circle cx="43" cy="42" r=".8" fill="#fff"/>
<ellipse cx="58" cy="43" rx="5" ry="4" fill="#f0ece4"/>
<circle cx="58" cy="43" r="2.8" fill="#a85820"/>
<circle cx="58" cy="43" r="1.6" fill="#6a3410"/>
<circle cx="59" cy="42" r=".8" fill="#fff"/>
<path d="M36 38 Q42 35 47 38" stroke="#5a3010" stroke-width="2" fill="none" stroke-linecap="round"/>
<path d="M53 38 Q58 35 64 38" stroke="#5a3010" stroke-width="2" fill="none" stroke-linecap="round"/>
<path d="M32 36 Q33 18 50 14 Q67 18 68 36" fill="#5a3818"/>
<path d="M33 36 Q28 48 29 60" stroke="#5a3818" stroke-width="4" stroke-linecap="round" fill="none"/>
<path d="M67 36 Q72 48 71 60" stroke="#5a3818" stroke-width="4" stroke-linecap="round" fill="none"/>
<path d="M32 37 Q50 34 68 37" fill="none" stroke="#c89030" stroke-width="2.5"/>
<circle cx="50" cy="35" r="2.5" fill="#c89030"/>
</svg>`
};

/* ═══════════════════════════════════════════════════════════════════
   BADGE SVGs (40×40)
═══════════════════════════════════════════════════════════════════ */
const BADGE_SVGS = {
  'Бейдж "Берсерк"': `<svg viewBox="0 0 40 40" fill="none"><circle cx="20" cy="20" r="19" fill="#150808" stroke="#cc2222" stroke-width="1.5"/><line x1="20" y1="5" x2="20" y2="35" stroke="#6a3820" stroke-width="2.5" stroke-linecap="round"/><path d="M13 9 L19 7 L19 18 L13 20Z" fill="#cc2222"/><path d="M27 9 L21 7 L21 18 L27 20Z" fill="#aa1818"/><path d="M14 20 Q20 24 26 20 Q20 28 14 20Z" fill="#cc2222"/><text x="20" y="37" text-anchor="middle" font-size="4" fill="#cc4444" font-family="sans-serif" font-weight="700" letter-spacing=".3">БЕРСЕРК</text></svg>`,
  'Бейдж "Скальд"': `<svg viewBox="0 0 40 40" fill="none"><circle cx="20" cy="20" r="19" fill="#141208" stroke="#F0C850" stroke-width="1.5"/><path d="M12 8 Q20 5 28 8 Q30 22 20 28 Q10 22 12 8Z" fill="#1e1a0a" stroke="#C8940A" stroke-width=".8"/><path d="M15 14 L25 14" stroke="#F0C850" stroke-width="1" stroke-linecap="round"/><path d="M14 18 L26 18" stroke="#F0C850" stroke-width="1" stroke-linecap="round"/><path d="M16 22 L24 22" stroke="#F0C850" stroke-width="1" stroke-linecap="round"/><circle cx="27" cy="11" r="3" fill="#1e1a0a" stroke="#F0C850" stroke-width=".8"/><line x1="27" y1="14" x2="27" y2="24" stroke="#F0C850" stroke-width="1"/><circle cx="27" cy="24" r="2.5" fill="#F0C850"/><text x="20" y="37" text-anchor="middle" font-size="4" fill="#C8A800" font-family="sans-serif" font-weight="700" letter-spacing=".3">СКАЛЬД</text></svg>`,
  'Эффект "Молния"': `<svg viewBox="0 0 40 40" fill="none"><circle cx="20" cy="20" r="19" fill="#08081a" stroke="#F0C850" stroke-width="1.5"/><path d="M22 4 L16 20 L22 20 L18 36 L26 17 L20 17 Z" fill="#F0C850" stroke="#ff6a00" stroke-width=".5"/><circle cx="20" cy="20" r="15" fill="none" stroke="rgba(240,200,80,.15)" stroke-width=".5"/><text x="20" y="37" text-anchor="middle" font-size="4" fill="#C8A800" font-family="sans-serif" font-weight="700" letter-spacing=".3">МОЛНИЯ</text></svg>`,
};

/* ═══════════════════════════════════════════════════════════════════
   RUNE ORBIT RING — animates around character card
═══════════════════════════════════════════════════════════════════ */
const FRAME_RUNES = 'ᚠᚢᚦᚨᚱᚲᚷᚹᚺᚾᛁᛃᛈᛇᛉᛊ'.split('');

function RuneOrbitRing({ size, frameType }) {
  const isFire = frameType?.includes('Огонь') || frameType?.includes('Тор');
  const isIce  = frameType?.includes('Лёд')   || frameType?.includes('Мороз');
  const color  = isFire ? '#ff8c30' : isIce ? '#88ccff' : '#F0C850';
  const R = size * 0.48;
  const C = size / 2;
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}
      style={{
        position: 'absolute', top: '50%', left: '50%',
        animation: 'runeOrbit 18s linear infinite',
        pointerEvents: 'none',
      }}>
      <defs>
        <filter id="rGlo" x="-60%" y="-60%" width="220%" height="220%">
          <feGaussianBlur in="SourceGraphic" stdDeviation="1.8" result="blur"/>
          <feMerge><feMergeNode in="blur"/><feMergeNode in="SourceGraphic"/></feMerge>
        </filter>
      </defs>
      {FRAME_RUNES.map((r, i) => {
        const a = (i / FRAME_RUNES.length) * Math.PI * 2 - Math.PI / 2;
        return (
          <text key={i} x={C + R * Math.cos(a)} y={C + R * Math.sin(a)}
            textAnchor="middle" dominantBaseline="middle"
            fontSize="13" fontFamily="serif" fill={color}
            filter="url(#rGlo)" opacity={0.85}>
            {r}
          </text>
        );
      })}
    </svg>
  );
}

/* ═══════════════════════════════════════════════════════════════════
   XP PROGRESS BAR (animated on mount)
═══════════════════════════════════════════════════════════════════ */
function XpBar({ xpCurrent, xpNext, level }) {
  const barRef = useRef(null);
  const pct = xpNext ? Math.min((xpCurrent / xpNext) * 100, 100) : 100;
  useEffect(() => {
    if (!barRef.current) return;
    barRef.current.style.width = '0%';
    const t = requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        barRef.current.style.transition = 'width 1.4s cubic-bezier(.25,.46,.45,.94)';
        barRef.current.style.width = `${pct}%`;
      });
    });
    return () => cancelAnimationFrame(t);
  }, [pct]);

  return (
    <div style={{ width: '100%', padding: '0 20px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
        <span style={{ fontSize: 10, color: 'rgba(255,255,255,.45)', letterSpacing: .5 }}>
          XP {xpCurrent.toLocaleString('ru-RU')} / {xpNext?.toLocaleString('ru-RU') || '—'}
        </span>
        <span style={{ fontSize: 10, color: 'rgba(255,255,255,.45)' }}>
          Ур.{level} → Ур.{level + 1}
        </span>
      </div>
      <div style={{ height: 6, borderRadius: 3, background: 'rgba(255,255,255,.08)', overflow: 'hidden' }}>
        <div ref={barRef} style={{
          height: '100%', borderRadius: 3, width: '0%',
          background: 'linear-gradient(90deg, #F0C850, #ff8c00)',
          boxShadow: '0 0 8px rgba(240,200,80,.5)',
        }} />
      </div>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════════
   STAT PILL
═══════════════════════════════════════════════════════════════════ */
function StatPill({ icon, value, label, delay = 0 }) {
  return (
    <div style={{ display:'flex', flexDirection:'column', alignItems:'center', gap:2, animation:`statSlide .5s ease ${delay}s both` }}>
      <div style={{ display:'flex', alignItems:'baseline', gap:3 }}>
        <span style={{ fontSize:14, color:'#F0C850', fontFamily:'serif' }}>{icon}</span>
        <span style={{ fontSize:18, fontWeight:800, color:'#fff', letterSpacing:-.5 }}>{value}</span>
      </div>
      <span style={{ fontSize:10, color:'rgba(255,255,255,.38)', textTransform:'uppercase', letterSpacing:.8 }}>{label}</span>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════════
   VIKING HERO CARD — the WOW section
═══════════════════════════════════════════════════════════════════ */
function VikingHeroCard({ profile, runes, xp, level, totalShifts, cosmetics }) {
  const navigate = useNavigate();
  const haptic = useHaptic();
  const rank = getRank(level);

  const isThemeDark = cosmetics?.active_theme?.includes('Тёмный') || cosmetics?.active_theme?.includes('Берсерк');
  const isThemeFire = cosmetics?.active_theme?.includes('Огонь') || cosmetics?.active_theme?.includes('Красный');
  const isThemeIce  = cosmetics?.active_theme?.includes('Лёд') || cosmetics?.active_theme?.includes('Мороз');

  const accent = isThemeFire ? '#ff6030' : isThemeIce ? '#88ccff' : '#F0C850';
  const bg = isThemeFire
    ? 'linear-gradient(180deg,#150808 0%,#1e0c0c 50%,#0a0606 100%)'
    : isThemeIce
    ? 'linear-gradient(180deg,#080e1a 0%,#0e1828 50%,#060c14 100%)'
    : isThemeDark
    ? 'linear-gradient(180deg,#0a0a0a 0%,#100808 50%,#080808 100%)'
    : 'linear-gradient(180deg,#0a0e1a 0%,#111827 60%,#0a0a0a 100%)';

  const xpFloor = XP_LEVELS[level - 1] || 0;
  const xpCeil  = XP_LEVELS[level]     || XP_LEVELS[XP_LEVELS.length - 1];
  const xpCurrent = xp - xpFloor;
  const xpNext    = xpCeil - xpFloor;

  const hasAvatar = !!cosmetics?.active_avatar && AVATAR_SVGS[cosmetics.active_avatar];
  const hasFrame  = !!cosmetics?.active_frame;
  const hasBadge  = !!cosmetics?.active_badge  && BADGE_SVGS[cosmetics.active_badge];
  const frameAnim = isThemeFire ? 'fireFrost' : isThemeIce ? 'iceFrost' : 'goldPulse';

  const PORTRAIT_W = 120;
  const ORBIT_SZ   = PORTRAIT_W + 50;

  return (
    <div style={{ background: bg, borderRadius: '0 0 28px 28px', overflow: 'hidden', position: 'relative', paddingBottom: 28 }}>
      {/* Floating background runes */}
      {['ᚠ','ᚢ','ᚨ','ᚱ','ᛟ'].map((r, i) => (
        <div key={i} style={{
          position: 'absolute', fontSize: 20, color: `${accent}22`,
          top: `${8 + i * 16}%`, ...(i % 2 === 0 ? { left: `${4 + i * 3}%` } : { right: `${4 + i * 3}%` }),
          animation: `runeFloat ${5 + i * 1.4}s ease-in-out ${i * 0.7}s infinite`,
          pointerEvents: 'none', fontFamily: 'serif', userSelect: 'none',
        }}>{r}</div>
      ))}

      {/* Character portrait section */}
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', paddingTop: 32, gap: 0 }}>
        {/* Portrait + orbit container */}
        <div style={{ position: 'relative', width: ORBIT_SZ, height: ORBIT_SZ, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          {/* Rune orbit (if frame equipped) */}
          {hasFrame && <RuneOrbitRing size={ORBIT_SZ} frameType={cosmetics.active_frame} />}

          {/* Character portrait card */}
          <div style={{
            width: PORTRAIT_W, height: 170, borderRadius: 16,
            background: 'linear-gradient(180deg, rgba(255,255,255,.04) 0%, rgba(0,0,0,.3) 100%)',
            border: `1.5px solid ${hasFrame ? accent : 'rgba(240,200,80,.2)'}`,
            overflow: 'hidden', position: 'relative',
            animation: `${frameAnim} 3s ease-in-out infinite`,
            boxShadow: hasFrame
              ? `0 0 24px ${accent}60, 0 0 50px ${accent}20, inset 0 0 30px rgba(0,0,0,.5)`
              : `0 0 16px rgba(240,200,80,.15), inset 0 0 30px rgba(0,0,0,.5)`,
          }}>
            {hasAvatar ? (
              <div style={{ width: '100%', height: '100%' }}
                dangerouslySetInnerHTML={{ __html: AVATAR_SVGS[cosmetics.active_avatar] }} />
            ) : (
              /* Default: stylized initials portrait */
              <div style={{
                width: '100%', height: '100%',
                background: 'linear-gradient(180deg,#1e2840,#0a0e1a)',
                display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 8,
              }}>
                <div style={{
                  width: 70, height: 70, borderRadius: '50%',
                  background: `linear-gradient(135deg, ${accent}40, ${accent}15)`,
                  border: `2px solid ${accent}60`,
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                }}>
                  <span style={{ fontSize: 28, fontWeight: 900, color: accent }}>{getInitials(profile?.fio)}</span>
                </div>
                <span style={{ fontSize: 9, color: 'rgba(255,255,255,.3)', textAlign: 'center', padding: '0 8px', lineHeight: 1.4 }}>
                  Нет аватара{'\n'}Купи в магазине ᚱ
                </span>
              </div>
            )}

            {/* Gradient vignette bottom */}
            <div style={{ position: 'absolute', bottom: 0, left: 0, right: 0, height: 40, background: 'linear-gradient(transparent, rgba(0,0,0,.6))', pointerEvents: 'none' }} />
          </div>

          {/* Badge */}
          {hasBadge && (
            <div style={{
              position: 'absolute', bottom: ORBIT_SZ/2 - 85 - 20, right: ORBIT_SZ/2 - PORTRAIT_W/2 - 22,
              width: 36, height: 36,
              animation: 'badgePop .5s cubic-bezier(.34,1.56,.64,1) .9s both',
            }} dangerouslySetInnerHTML={{ __html: BADGE_SVGS[cosmetics.active_badge] }} />
          )}
        </div>

        {/* Name */}
        <h1 style={{ color: '#fff', fontSize: 19, fontWeight: 800, marginTop: 6, textAlign: 'center', padding: '0 16px', lineHeight: 1.2 }}>
          {profile?.fio || 'Воин Асгарда'}
        </h1>
        <p style={{ color: 'rgba(255,255,255,.45)', fontSize: 12, marginTop: 3 }}>
          {[profile?.position, profile?.city].filter(Boolean).join(' · ')}
        </p>

        {/* Rank badge */}
        <div style={{
          marginTop: 10, display: 'flex', alignItems: 'center', gap: 7,
          background: `${accent}18`, border: `1px solid ${accent}40`,
          borderRadius: 20, padding: '6px 14px',
        }}>
          <span style={{ fontSize: 17, fontFamily: 'serif', color: accent, animation: 'rankGlow 2.5s ease-in-out infinite' }}>
            {rank.rune}
          </span>
          <span style={{ fontSize: 14, fontWeight: 800, color: accent, letterSpacing: .5 }}>{rank.title}</span>
          <span style={{ fontSize: 11, color: `${accent}80` }}>· Ур.{level}</span>
        </div>

        {/* Stats */}
        <div style={{ display: 'flex', gap: 24, marginTop: 16, marginBottom: 10 }}>
          <StatPill icon="ᚱ" value={runes.toLocaleString('ru-RU')} label="рун" delay={0.1} />
          <div style={{ width: 1, background: 'rgba(255,255,255,.1)', alignSelf: 'stretch' }} />
          <StatPill icon="⚡" value={xp.toLocaleString('ru-RU')} label="XP" delay={0.2} />
          <div style={{ width: 1, background: 'rgba(255,255,255,.1)', alignSelf: 'stretch' }} />
          <StatPill icon="🗡" value={totalShifts} label="смен" delay={0.3} />
        </div>

        {/* XP progress bar */}
        <XpBar xpCurrent={xpCurrent} xpNext={xpNext} level={level} />
      </div>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════════
   EQUIPMENT SLOTS PANEL
═══════════════════════════════════════════════════════════════════ */
const APPEARANCE_SLOTS = [
  { key: 'active_avatar', label: 'Аватар', rune: 'ᚠ' },
  { key: 'active_frame',  label: 'Рамка',  rune: 'ᚢ' },
  { key: 'active_badge',  label: 'Бейдж',  rune: 'ᚦ' },
  { key: 'active_theme',  label: 'Тема',   rune: 'ᚨ' },
];
const AMMO_SLOTS = [
  { key: 'active_helmet', label: 'Шлем',   rune: 'ᛏ' },
  { key: 'active_weapon', label: 'Оружие', rune: 'ᛒ' },
  { key: 'active_armor',  label: 'Броня',  rune: 'ᛖ' },
];

function SlotGrid({ slots, cosmetics, navigate, haptic }) {
  return (
    <div style={{ display: 'grid', gridTemplateColumns: `repeat(${slots.length},1fr)`, gap: 8, padding: '8px 12px' }}>
      {slots.map(slot => {
        const val = cosmetics?.[slot.key];
        const shortName = val ? val.replace(/^[^"]*"([^"]*)".*$/, '$1') : null;
        return (
          <button key={slot.key}
            onClick={() => { haptic.light(); navigate('/field/inventory'); }}
            style={{
              display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4,
              padding: '10px 4px', borderRadius: 12,
              background: val ? 'rgba(240,200,80,.07)' : 'var(--bg-primary)',
              border: `1px solid ${val ? 'rgba(240,200,80,.28)' : 'var(--border-norse)'}`,
              cursor: 'pointer', WebkitTapHighlightColor: 'transparent',
            }}>
            <span style={{ fontSize: 20 }}>{val ? '✨' : slot.rune}</span>
            <span style={{ fontSize: 9, color: 'var(--text-tertiary)', textAlign: 'center' }}>{slot.label}</span>
            <span style={{
              fontSize: 8, color: val ? 'var(--gold)' : 'rgba(255,255,255,.18)',
              textAlign: 'center', maxWidth: 60, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
            }}>
              {shortName || '—'}
            </span>
          </button>
        );
      })}
    </div>
  );
}

function EquipmentSlots({ cosmetics, navigate, haptic }) {
  const allSlots = [...APPEARANCE_SLOTS, ...AMMO_SLOTS];
  const count = allSlots.filter(s => cosmetics?.[s.key]).length;
  return (
    <div style={{ borderRadius: 16, overflow: 'hidden', border: '1px solid var(--border-norse)', backgroundColor: 'var(--bg-elevated)' }}>
      {/* Header */}
      <div style={{ padding: '12px 16px 8px', borderBottom: '1px solid var(--border-norse)', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <Sparkles size={15} color="var(--gold)" />
          <span style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 1, color: 'var(--text-tertiary)' }}>
            Снаряжение
          </span>
        </div>
        {count > 0 && (
          <span style={{ fontSize: 11, color: 'var(--gold)', fontWeight: 600 }}>{count}/7 надето</span>
        )}
      </div>

      {/* Row 1: Appearance (4 slots) */}
      <div style={{ padding: '4px 0 0', borderBottom: '1px solid var(--border-norse)' }}>
        <p style={{ fontSize: 9, color: 'var(--text-tertiary)', textTransform: 'uppercase', letterSpacing: .8, padding: '4px 12px 0' }}>Образ</p>
        <SlotGrid slots={APPEARANCE_SLOTS} cosmetics={cosmetics} navigate={navigate} haptic={haptic} />
      </div>

      {/* Row 2: Ammo (3 slots) */}
      <div style={{ padding: '4px 0 0' }}>
        <p style={{ fontSize: 9, color: 'var(--text-tertiary)', textTransform: 'uppercase', letterSpacing: .8, padding: '4px 12px 0' }}>Амуниция</p>
        <SlotGrid slots={AMMO_SLOTS} cosmetics={cosmetics} navigate={navigate} haptic={haptic} />
      </div>

      {/* CTA */}
      <button
        onClick={() => { haptic.medium(); navigate('/field/inventory'); }}
        style={{
          width: 'calc(100% - 24px)', margin: '4px 12px 12px', padding: '11px 0', borderRadius: 12,
          background: 'linear-gradient(135deg,rgba(240,200,80,.12),rgba(240,200,80,.04))',
          border: '1px solid rgba(240,200,80,.25)',
          color: 'var(--gold)', fontSize: 13, fontWeight: 600,
          display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6, cursor: 'pointer',
          WebkitTapHighlightColor: 'transparent',
        }}>
        <Sparkles size={14} /> Настроить образ
      </button>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════════
   ACHIEVEMENTS
═══════════════════════════════════════════════════════════════════ */
const ACHIEVEMENTS = [
  { id: 'first_shift',  icon: '🔥', name: 'Первая смена',    earned: p => (p?.total_shifts || 0) >= 1 },
  { id: 'iron_warrior', icon: '⚡', name: 'Железный воин',   earned: p => (p?.achievements?.find?.(a=>a.id==='iron_warrior')?.earned) },
  { id: 'veteran',      icon: '🏆', name: 'Ветеран',         earned: p => (p?.total_shifts || 0) >= 50 },
  { id: 'chronicler',   icon: '📷', name: 'Летописец',       earned: p => (p?.achievements?.find?.(a=>a.id==='chronicler')?.earned) },
  { id: 'punctual',     icon: '⏰', name: 'Пунктуальный',    earned: p => (p?.achievements?.find?.(a=>a.id==='punctual')?.earned) },
  { id: 'berserker',    icon: '🛡️', name: 'Берсерк',        earned: p => (p?.achievements?.find?.(a=>a.id==='berserker')?.earned) },
  { id: 'traveler',     icon: '🗺️', name: 'Странник',       earned: p => (p?.achievements?.find?.(a=>a.id==='traveler')?.earned) },
  { id: 'mentor',       icon: '🎓', name: 'Наставник',       earned: p => (p?.achievements?.find?.(a=>a.id==='mentor')?.earned) },
];

/* ═══════════════════════════════════════════════════════════════════
   SKELETON
═══════════════════════════════════════════════════════════════════ */
function Skeleton() {
  return (
    <div style={{ background: 'linear-gradient(180deg,#0a0e1a,#111827)', borderRadius: '0 0 28px 28px', padding: '32px 24px 28px' }}>
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 12 }}>
        <div style={{ width: 120, height: 170, borderRadius: 16, background: 'rgba(255,255,255,.06)', animation: 'statSlide 1s ease infinite alternate' }} />
        <div style={{ width: 160, height: 16, borderRadius: 8, background: 'rgba(255,255,255,.06)' }} />
        <div style={{ width: 100, height: 12, borderRadius: 6, background: 'rgba(255,255,255,.04)' }} />
        <div style={{ display: 'flex', gap: 20, marginTop: 8 }}>
          {[1,2,3].map(i=><div key={i} style={{ width: 50, height: 32, borderRadius: 8, background: 'rgba(255,255,255,.05)' }} />)}
        </div>
      </div>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════════
   MAIN COMPONENT
═══════════════════════════════════════════════════════════════════ */
export default function FieldProfile() {
  const navigate = useNavigate();
  const haptic = useHaptic();
  const [profile, setProfile] = useState(null);
  const [permits, setPermits] = useState([]);
  const [personal, setPersonal] = useState(null);
  const [workData, setWorkData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [personalOpen, setPersonalOpen] = useState(false);
  const [editing, setEditing] = useState(false);
  const [editData, setEditData] = useState({});
  const [saving, setSaving] = useState(false);
  const [darkMode, setDarkMode] = useState(() => document.documentElement.classList.contains('dark'));

  useEffect(() => {
    (async () => {
      try {
        const [me, perms, pers, proj] = await Promise.all([
          fieldApi.get('/worker/me'),
          fieldApi.get('/worker/permits').catch(() => []),
          fieldApi.get('/worker/personal').catch(() => null),
          fieldApi.get('/worker/active-project').catch(() => null),
        ]);
        setProfile(me);
        setPermits(Array.isArray(perms) ? perms : perms?.permits || []);
        setPersonal(pers?.employee || pers);
        setWorkData(proj?.project || proj);
      } catch {}
      setLoading(false);
    })();
  }, []);

  const toggleTheme = () => {
    haptic.light();
    const next = !darkMode;
    setDarkMode(next);
    document.documentElement.classList.toggle('dark', next);
    localStorage.setItem('theme', next ? 'dark' : 'light');
  };
  const handleLogout = () => {
    haptic.heavy();
    useFieldAuthStore.getState().logout();
    navigate('/field-login');
  };
  const startEdit  = () => { haptic.light(); setEditing(true); setEditData(personal || {}); };
  const cancelEdit = () => { setEditing(false); setEditData({}); };
  const saveEdit   = async () => {
    haptic.medium(); setSaving(true);
    try { await fieldApi.put('/worker/personal', editData); setPersonal(editData); setEditing(false); } catch {}
    setSaving(false);
  };

  if (loading) return <Skeleton />;

  const runes  = profile?.runes  || 0;
  const xp     = profile?.xp     || 0;
  const level  = getLevel(xp);
  const totalShifts = profile?.total_shifts || 0;
  const cosmetics = {
    active_avatar: profile?.active_avatar,
    active_frame:  profile?.active_frame,
    active_badge:  profile?.active_badge,
    active_theme:  profile?.active_theme,
    active_helmet: profile?.active_helmet,
    active_weapon: profile?.active_weapon,
    active_armor:  profile?.active_armor,
  };

  return (
    <>
      <style>{ANIM_CSS}</style>
      <div className="pb-24" style={{ backgroundColor: 'var(--bg-primary)', minHeight: '100%' }}>

        {/* ═══ HERO CARD ══════════════════════════════════════════════ */}
        <VikingHeroCard
          profile={profile} runes={runes} xp={xp} level={level}
          totalShifts={totalShifts} cosmetics={cosmetics}
        />

        <div className="space-y-3 p-4 pt-3">

          {/* ═══ EQUIPMENT SLOTS ══════════════════════════════════════ */}
          <EquipmentSlots cosmetics={cosmetics} navigate={navigate} haptic={haptic} />

          {/* ═══ ACTIVE WORK ══════════════════════════════════════════ */}
          <div className="rounded-xl p-4" style={{ backgroundColor: 'var(--bg-elevated)', border: '1px solid var(--border-norse)' }}>
            <div className="flex items-center gap-2 mb-3">
              <Briefcase size={15} style={{ color: 'var(--gold)' }} />
              <span className="text-xs font-semibold uppercase tracking-widest" style={{ color: 'var(--text-tertiary)' }}>Моя работа</span>
            </div>
            {workData && (workData.work_title || workData.title) ? (
              <div className="space-y-2">
                <p className="font-semibold" style={{ color: 'var(--text-primary)' }}>{workData.work_title || workData.title}</p>
                {(workData.date_from || workData.date_to) && (
                  <p className="text-xs" style={{ color: 'var(--text-secondary)' }}>
                    📅 {workData.date_from ? new Date(workData.date_from).toLocaleDateString('ru-RU') : ''} — {workData.date_to ? new Date(workData.date_to).toLocaleDateString('ru-RU') : '...'}
                  </p>
                )}
                {workData.shift_type && (
                  <p className="text-xs" style={{ color: 'var(--text-secondary)' }}>
                    {workData.shift_type === 'night' ? '🌙 Ночная' : '☀️ Дневная'} смена
                  </p>
                )}
                {workData.masters?.length > 0 && (
                  <div className="pt-2 mt-2 space-y-1" style={{ borderTop: '1px solid var(--border-norse)' }}>
                    <p className="text-xs font-semibold" style={{ color: 'var(--text-tertiary)' }}>👷 Мастера</p>
                    {workData.masters.map((m, i) => (
                      <div key={i} className="flex items-center justify-between">
                        <span className="text-sm" style={{ color: 'var(--text-primary)' }}>{shortFio(m.fio)}</span>
                        {m.phone && (
                          <a href={`tel:${m.phone.replace(/[^\d+]/g, '')}`} className="px-3 py-1 rounded-lg text-xs font-medium"
                            style={{ background: 'linear-gradient(135deg,var(--gold),#b8860b)', color: '#fff' }}>📞 Звонок</a>
                        )}
                      </div>
                    ))}
                  </div>
                )}
                {workData.pm?.fio && (
                  <div className="pt-2 mt-1 space-y-1" style={{ borderTop: '1px solid var(--border-norse)' }}>
                    <p className="text-xs font-semibold" style={{ color: 'var(--text-tertiary)' }}>👔 РП</p>
                    <div className="flex items-center justify-between">
                      <span className="text-sm" style={{ color: 'var(--text-primary)' }}>{shortFio(workData.pm.fio)}</span>
                      {workData.pm.phone && (
                        <a href={`tel:${workData.pm.phone.replace(/[^\d+]/g, '')}`} className="px-3 py-1 rounded-lg text-xs font-medium"
                          style={{ background: 'linear-gradient(135deg,var(--gold),#b8860b)', color: '#fff' }}>📞 Звонок</a>
                      )}
                    </div>
                  </div>
                )}
                <button onClick={() => navigate('/field/history')} className="w-full mt-2 py-2.5 rounded-lg text-sm font-medium text-center"
                  style={{ backgroundColor: 'var(--bg-primary)', border: '1px solid var(--border-norse)', color: 'var(--text-primary)' }}>
                  📋 Мой табель
                </button>
              </div>
            ) : (
              <p className="text-sm text-center py-2" style={{ color: 'var(--text-tertiary)' }}>Нет активной работы</p>
            )}
          </div>

          {/* ═══ ACHIEVEMENTS ═════════════════════════════════════════ */}
          <div className="rounded-xl p-4" style={{ backgroundColor: 'var(--bg-elevated)', border: '1px solid var(--border-norse)' }}>
            <div className="flex items-center gap-2 mb-3">
              <Award size={15} style={{ color: 'var(--gold)' }} />
              <span className="text-xs font-semibold uppercase tracking-widest" style={{ color: 'var(--text-tertiary)' }}>Достижения</span>
            </div>
            <div className="grid grid-cols-4 gap-2">
              {ACHIEVEMENTS.map(a => {
                const unlocked = a.earned(profile);
                return (
                  <div key={a.id} className="flex flex-col items-center gap-1 p-2 rounded-lg"
                    style={{ backgroundColor: 'var(--bg-primary)', opacity: unlocked ? 1 : 0.3 }}>
                    <span className="text-2xl">{a.icon}</span>
                    <span className="text-center leading-tight" style={{ color: 'var(--text-secondary)', fontSize: '0.55rem' }}>{a.name}</span>
                  </div>
                );
              })}
            </div>
          </div>

          {/* ═══ PERMITS ══════════════════════════════════════════════ */}
          {permits.length > 0 && (
            <div className="rounded-xl p-4 space-y-3" style={{ backgroundColor: 'var(--bg-elevated)', border: '1px solid var(--border-norse)' }}>
              <div className="flex items-center gap-2 mb-1">
                <Shield size={16} style={{ color: 'var(--gold)' }} />
                <span className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>Допуски и удостоверения</span>
              </div>
              {permits.map((p, i) => {
                const st = expiryStatus(p.expiry_date || p.valid_until);
                const ec = EXP_COLORS[st];
                return (
                  <div key={i} className="flex items-start justify-between gap-2 py-2 border-t" style={{ borderColor: 'var(--border-norse)' }}>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium truncate" style={{ color: 'var(--text-primary)' }}>{p.name || p.title || p.permit_name}</p>
                      {p.doc_number && <p className="text-xs" style={{ color: 'var(--text-tertiary)' }}>№ {p.doc_number}</p>}
                      {(p.expiry_date || p.valid_until) && <p className="text-xs" style={{ color: 'var(--text-tertiary)' }}>до {new Date(p.expiry_date || p.valid_until).toLocaleDateString('ru-RU')}</p>}
                    </div>
                    {ec.label && <span className="text-xs px-2 py-0.5 rounded-full whitespace-nowrap" style={{ backgroundColor: ec.bg, color: ec.color }}>{ec.label}</span>}
                  </div>
                );
              })}
            </div>
          )}

          {/* ═══ PERSONAL DATA ════════════════════════════════════════ */}
          <div className="rounded-xl overflow-hidden" style={{ backgroundColor: 'var(--bg-elevated)', border: '1px solid var(--border-norse)' }}>
            <button className="w-full flex items-center justify-between p-4"
              onClick={() => { haptic.light(); setPersonalOpen(!personalOpen); }}>
              <span className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>Личные данные</span>
              {personalOpen ? <ChevronUp size={18} style={{ color: 'var(--text-tertiary)' }} /> : <ChevronDown size={18} style={{ color: 'var(--text-tertiary)' }} />}
            </button>
            {personalOpen && (
              <div className="px-4 pb-4 space-y-2">
                {editing ? (
                  <>
                    {PERSONAL_FIELDS.map(f => (
                      <div key={f.key}>
                        <label className="text-xs" style={{ color: 'var(--text-tertiary)' }}>{f.label}</label>
                        {f.key === 'is_self_employed' ? (
                          <select className="w-full rounded-lg px-3 py-2 text-sm mt-0.5 outline-none"
                            style={{ backgroundColor: 'var(--bg-primary)', border: '1px solid var(--border-norse)', color: 'var(--text-primary)' }}
                            value={editData[f.key] || ''} onChange={e => setEditData({ ...editData, [f.key]: e.target.value })}>
                            <option value="">—</option><option value="true">Да</option><option value="false">Нет</option>
                          </select>
                        ) : f.key === 'gender' ? (
                          <select className="w-full rounded-lg px-3 py-2 text-sm mt-0.5 outline-none"
                            style={{ backgroundColor: 'var(--bg-primary)', border: '1px solid var(--border-norse)', color: 'var(--text-primary)' }}
                            value={editData[f.key] || ''} onChange={e => setEditData({ ...editData, [f.key]: e.target.value })}>
                            <option value="">—</option><option value="М">Мужской</option><option value="Ж">Женский</option>
                          </select>
                        ) : (
                          <input className="w-full rounded-lg px-3 py-2 text-sm mt-0.5 outline-none"
                            style={{ backgroundColor: 'var(--bg-primary)', border: '1px solid var(--border-norse)', color: 'var(--text-primary)' }}
                            type={f.type || 'text'}
                            value={f.type === 'date' && editData[f.key] ? String(editData[f.key]).slice(0, 10) : (editData[f.key] || '')}
                            onChange={e => setEditData({ ...editData, [f.key]: e.target.value })} />
                        )}
                      </div>
                    ))}
                    <div className="flex gap-2 pt-2">
                      <button className="flex-1 flex items-center justify-center gap-1 rounded-lg py-2 text-sm font-medium"
                        style={{ backgroundColor: 'var(--gold)', color: 'var(--bg-primary)' }} onClick={saveEdit} disabled={saving}>
                        <Check size={16} /> {saving ? '...' : 'Сохранить'}
                      </button>
                      <button className="flex-1 flex items-center justify-center gap-1 rounded-lg py-2 text-sm font-medium"
                        style={{ border: '1px solid var(--border-norse)', color: 'var(--text-secondary)' }} onClick={cancelEdit}>
                        <X size={16} /> Отмена
                      </button>
                    </div>
                  </>
                ) : (
                  <>
                    {personal ? (
                      <div className="space-y-2">
                        {PERSONAL_FIELDS.map(f => {
                          let val = personal[f.key];
                          if (val == null || val === '') return null;
                          if (f.key === 'is_self_employed') val = val === true || val === 'true' ? 'Да' : 'Нет';
                          if (f.type === 'date' && val) {
                            try { val = new Date(val).toLocaleDateString('ru-RU', { day:'2-digit', month:'2-digit', year:'numeric' }); } catch {}
                          }
                          return (
                            <div key={f.key}>
                              <p className="text-xs" style={{ color: 'var(--text-tertiary)' }}>{f.label}</p>
                              <p className="text-sm" style={{ color: 'var(--text-primary)' }}>{val}</p>
                            </div>
                          );
                        })}
                      </div>
                    ) : (
                      <p className="text-sm" style={{ color: 'var(--text-tertiary)' }}>Данные не заполнены</p>
                    )}
                    <button className="flex items-center gap-1 mt-3 text-sm font-medium" style={{ color: 'var(--gold)' }} onClick={startEdit}>
                      <Edit3 size={14} /> Редактировать
                    </button>
                  </>
                )}
              </div>
            )}
          </div>

          {/* ═══ THEME TOGGLE ═════════════════════════════════════════ */}
          <button className="w-full flex items-center justify-between rounded-xl p-4"
            style={{ backgroundColor: 'var(--bg-elevated)', border: '1px solid var(--border-norse)' }} onClick={toggleTheme}>
            <span className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>{darkMode ? 'Тёмная тема' : 'Светлая тема'}</span>
            {darkMode ? <Moon size={18} style={{ color: 'var(--gold)' }} /> : <Sun size={18} style={{ color: 'var(--gold)' }} />}
          </button>

          {/* ═══ LOGOUT ═══════════════════════════════════════════════ */}
          <button className="w-full flex items-center justify-center gap-2 rounded-xl p-4 font-medium text-sm"
            style={{ backgroundColor: '#dc262615', color: '#dc2626', border: '1px solid #dc262630' }} onClick={handleLogout}>
            <LogOut size={18} /> Выйти из аккаунта
          </button>

          <p className="text-center text-xs py-2" style={{ color: 'var(--text-tertiary)' }}>ASGARD Field v2.0.0</p>
        </div>
      </div>
    </>
  );
}

const PERSONAL_FIELDS = [
  { key: 'fio',             label: 'ФИО' },
  { key: 'phone',           label: 'Телефон' },
  { key: 'email',           label: 'Email' },
  { key: 'birth_date',      label: 'Дата рождения', type: 'date' },
  { key: 'gender',          label: 'Пол' },
  { key: 'city',            label: 'Город' },
  { key: 'address',         label: 'Адрес регистрации' },
  { key: 'passport_data',   label: 'Паспорт (серия номер)' },
  { key: 'inn',             label: 'ИНН' },
  { key: 'snils',           label: 'СНИЛС' },
  { key: 'is_self_employed',label: 'Самозанятый' },
  { key: 'naks',            label: 'НАКС' },
  { key: 'naks_expiry',     label: 'НАКС до', type: 'date' },
  { key: 'imt_number',      label: 'Удостоверение ИТР' },
  { key: 'imt_expires',     label: 'ИТР до', type: 'date' },
  { key: 'clothing_size',   label: 'Размер одежды' },
  { key: 'shoe_size',       label: 'Размер обуви' },
  { key: 'employment_date', label: 'Дата трудоустройства', type: 'date' },
];
