/**
 * FieldInventory.jsx — 1:1 port of FIELD_INVENTORY_RENDER.html
 * Norse dark + gold, 12 unique SVGs, timeline, detail modal, floating runes
 * ================================================================
 */
import { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { fieldApi } from '@/api/fieldClient';

/* ═══ SVG ILLUSTRATIONS — 12 unique Norse geometric ═══ */
const SVGS = {
  tshirt: `<svg viewBox="0 0 80 80" fill="none"><defs><linearGradient id="ts1" x1="20" y1="10" x2="60" y2="70" gradientUnits="userSpaceOnUse"><stop offset="0%" stop-color="#2a2040"/><stop offset="100%" stop-color="#1a1530"/></linearGradient></defs><path d="M25 18L15 28L22 35L25 30V65H55V30L58 35L65 28L55 18H48L44 24H36L32 18Z" fill="url(#ts1)" stroke="#F0C850" stroke-width="1.5"/><path d="M36 24Q40 30 44 24" stroke="#F0C850" stroke-width="1" fill="none"/><text x="40" y="48" text-anchor="middle" font-family="Cinzel,serif" font-size="7" font-weight="900" fill="#F0C850" letter-spacing=".5">ASGARD</text><path d="M30 52H50" stroke="rgba(240,200,80,.3)" stroke-width=".5"/><path d="M33 56H47" stroke="rgba(240,200,80,.2)" stroke-width=".5"/><path d="M17 26L20 30" stroke="rgba(240,200,80,.4)" stroke-width="1" stroke-linecap="round"/><path d="M63 26L60 30" stroke="rgba(240,200,80,.4)" stroke-width="1" stroke-linecap="round"/></svg>`,
  thermomug: `<svg viewBox="0 0 80 80" fill="none"><defs><linearGradient id="tm1" x1="25" y1="15" x2="55" y2="70" gradientUnits="userSpaceOnUse"><stop offset="0%" stop-color="#404858"/><stop offset="100%" stop-color="#2a3040"/></linearGradient></defs><rect x="24" y="18" width="32" height="50" rx="4" fill="url(#tm1)" stroke="#F0C850" stroke-width="1"/><rect x="22" y="14" width="36" height="8" rx="4" fill="#505868" stroke="#F0C850" stroke-width="1"/><circle cx="40" cy="18" r="3" fill="#606878" stroke="#F0C850" stroke-width=".8"/><path d="M56 30Q68 30 68 44Q68 58 56 58" stroke="#F0C850" stroke-width="2" fill="none" stroke-linecap="round"/><text x="40" y="48" text-anchor="middle" font-size="16" fill="rgba(240,200,80,.5)" font-family="serif">&#x16A0;</text><path d="M33 12Q35 6 33 2" stroke="rgba(255,255,255,.15)" stroke-width="1.5" fill="none" stroke-linecap="round"/><path d="M40 10Q42 4 40 0" stroke="rgba(255,255,255,.1)" stroke-width="1.5" fill="none" stroke-linecap="round"/><path d="M47 12Q49 6 47 2" stroke="rgba(255,255,255,.15)" stroke-width="1.5" fill="none" stroke-linecap="round"/><rect x="24" y="36" width="32" height="4" rx="2" fill="rgba(240,200,80,.15)"/></svg>`,
  beanie: `<svg viewBox="0 0 80 80" fill="none"><defs><linearGradient id="bn1" x1="20" y1="20" x2="60" y2="70" gradientUnits="userSpaceOnUse"><stop offset="0%" stop-color="#1a2848"/><stop offset="100%" stop-color="#0e1830"/></linearGradient></defs><circle cx="40" cy="16" r="8" fill="#C8940A" stroke="#F0C850" stroke-width="1"/><circle cx="38" cy="14" r="2" fill="rgba(255,255,255,.2)"/><path d="M18 45Q18 22 40 18Q62 22 62 45V55Q62 62 40 65Q18 62 18 55Z" fill="url(#bn1)" stroke="#F0C850" stroke-width="1.2"/><path d="M18 45Q18 42 40 40Q62 42 62 45V55Q62 58 40 60Q18 58 18 55Z" fill="rgba(240,200,80,.06)"/><path d="M22 46V54" stroke="rgba(240,200,80,.15)" stroke-width="1"/><path d="M28 45V56" stroke="rgba(240,200,80,.15)" stroke-width="1"/><path d="M34 44V57" stroke="rgba(240,200,80,.15)" stroke-width="1"/><path d="M40 44V58" stroke="rgba(240,200,80,.15)" stroke-width="1"/><path d="M46 44V57" stroke="rgba(240,200,80,.15)" stroke-width="1"/><path d="M52 45V56" stroke="rgba(240,200,80,.15)" stroke-width="1"/><path d="M58 46V54" stroke="rgba(240,200,80,.15)" stroke-width="1"/><path d="M22 30Q28 28 34 30Q40 32 46 30Q52 28 58 30" stroke="rgba(240,200,80,.2)" stroke-width="1" fill="none"/><text x="40" y="52" text-anchor="middle" font-size="5" font-weight="800" fill="rgba(240,200,80,.5)" font-family="system-ui" letter-spacing="1">ASGARD</text></svg>`,
  vipseat: `<svg viewBox="0 0 80 80" fill="none"><defs><linearGradient id="vs1" x1="15" y1="20" x2="65" y2="70" gradientUnits="userSpaceOnUse"><stop offset="0%" stop-color="#3a2008"/><stop offset="100%" stop-color="#1a1005"/></linearGradient></defs><path d="M15 20Q15 12 40 10Q65 12 65 20V50Q65 54 40 56Q15 54 15 50Z" fill="url(#vs1)" stroke="#F0C850" stroke-width="1.2"/><path d="M12 50Q12 46 40 44Q68 46 68 50V58Q68 62 40 64Q12 62 12 58Z" fill="#2a1808" stroke="#F0C850" stroke-width="1"/><path d="M20 62L16 74" stroke="#F0C850" stroke-width="2" stroke-linecap="round"/><path d="M60 62L64 74" stroke="#F0C850" stroke-width="2" stroke-linecap="round"/><path d="M28 24L32 18L36 24L40 16L44 24L48 18L52 24" stroke="#F0C850" stroke-width="1.5" fill="none" stroke-linecap="round" stroke-linejoin="round"/><text x="40" y="40" text-anchor="middle" font-family="Cinzel,serif" font-size="8" font-weight="900" fill="#F0C850">VIP</text></svg>`,
  hoodie: `<svg viewBox="0 0 80 80" fill="none"><defs><linearGradient id="hd1" x1="15" y1="10" x2="65" y2="75" gradientUnits="userSpaceOnUse"><stop offset="0%" stop-color="#1a1530"/><stop offset="100%" stop-color="#0e0a20"/></linearGradient></defs><path d="M22 25L12 35L20 42L22 38V70H58V38L60 42L68 35L58 25H50L46 30H34L30 25Z" fill="url(#hd1)" stroke="#F0C850" stroke-width="1.5"/><path d="M30 25Q30 12 40 10Q50 12 50 25" fill="rgba(26,21,48,.8)" stroke="#F0C850" stroke-width="1.2"/><path d="M34 24Q40 14 46 24" stroke="rgba(240,200,80,.3)" stroke-width=".8" fill="none"/><path d="M28 50H52V60Q52 62 40 63Q28 62 28 60Z" fill="rgba(255,255,255,.03)" stroke="rgba(240,200,80,.3)" stroke-width="1"/><text x="40" y="46" text-anchor="middle" font-family="Cinzel,serif" font-size="6" font-weight="900" fill="#F0C850" letter-spacing=".5">ASGARD</text><path d="M36 25L34 35" stroke="rgba(240,200,80,.4)" stroke-width=".8" stroke-linecap="round"/><path d="M44 25L46 35" stroke="rgba(240,200,80,.4)" stroke-width=".8" stroke-linecap="round"/></svg>`,
  powerbank: `<svg viewBox="0 0 80 80" fill="none"><defs><linearGradient id="pb1" x1="22" y1="10" x2="58" y2="70" gradientUnits="userSpaceOnUse"><stop offset="0%" stop-color="#303848"/><stop offset="100%" stop-color="#1a2030"/></linearGradient></defs><rect x="22" y="12" width="36" height="56" rx="6" fill="url(#pb1)" stroke="#F0C850" stroke-width="1.2"/><rect x="22" y="12" width="36" height="10" rx="6" fill="rgba(255,255,255,.05)"/><rect x="35" y="14" width="10" height="4" rx="1.5" fill="#1a1828" stroke="rgba(240,200,80,.3)" stroke-width=".8"/><rect x="28" y="30" width="24" height="5" rx="2" fill="#22c55e" opacity=".8"/><rect x="28" y="38" width="24" height="5" rx="2" fill="#22c55e" opacity=".6"/><rect x="28" y="46" width="24" height="5" rx="2" fill="#22c55e" opacity=".4"/><rect x="28" y="54" width="24" height="5" rx="2" fill="rgba(255,255,255,.06)"/><text x="40" y="63" text-anchor="middle" font-size="5" font-weight="700" fill="rgba(240,200,80,.5)" font-family="system-ui">20000mAh</text><path d="M38 26L36 32H42L39 38" stroke="#F0C850" stroke-width="1.5" fill="none" stroke-linecap="round" stroke-linejoin="round"/></svg>`,
  vikingmug: `<svg viewBox="0 0 80 80" fill="none"><defs><linearGradient id="vm1" x1="18" y1="20" x2="55" y2="70" gradientUnits="userSpaceOnUse"><stop offset="0%" stop-color="#5a3a18"/><stop offset="100%" stop-color="#3a2008"/></linearGradient></defs><path d="M18 25Q18 22 40 20Q62 22 62 25V60Q62 66 40 68Q18 66 18 60Z" fill="url(#vm1)" stroke="#F0C850" stroke-width="1.2"/><path d="M18 32Q40 30 62 32" stroke="#C8940A" stroke-width="2" fill="none"/><path d="M18 50Q40 48 62 50" stroke="#C8940A" stroke-width="2" fill="none"/><path d="M25 25V65" stroke="rgba(200,148,10,.15)" stroke-width=".5"/><path d="M33 23V67" stroke="rgba(200,148,10,.15)" stroke-width=".5"/><path d="M40 22V68" stroke="rgba(200,148,10,.15)" stroke-width=".5"/><path d="M47 23V67" stroke="rgba(200,148,10,.15)" stroke-width=".5"/><path d="M55 25V65" stroke="rgba(200,148,10,.15)" stroke-width=".5"/><path d="M62 32Q74 30 76 40Q76 52 62 50" stroke="#C8940A" stroke-width="3" fill="none" stroke-linecap="round"/><circle cx="33" cy="40" r="2" fill="rgba(240,200,80,.2)"/><circle cx="47" cy="40" r="2" fill="rgba(240,200,80,.2)"/><path d="M36 46Q40 50 44 46" stroke="rgba(240,200,80,.2)" stroke-width="1" fill="none"/><path d="M30 36L26 30" stroke="rgba(240,200,80,.3)" stroke-width="1.5" stroke-linecap="round"/><path d="M50 36L54 30" stroke="rgba(240,200,80,.3)" stroke-width="1.5" stroke-linecap="round"/><path d="M20 25Q30 22 40 24Q50 22 60 25" stroke="rgba(255,255,255,.2)" stroke-width="3" fill="none" stroke-linecap="round"/></svg>`,
  backpack: `<svg viewBox="0 0 80 80" fill="none"><defs><linearGradient id="bp1" x1="18" y1="10" x2="62" y2="75" gradientUnits="userSpaceOnUse"><stop offset="0%" stop-color="#2a3040"/><stop offset="100%" stop-color="#1a1828"/></linearGradient></defs><path d="M20 24Q20 14 40 10Q60 14 60 24V68Q60 72 40 74Q20 72 20 68Z" fill="url(#bp1)" stroke="#F0C850" stroke-width="1.2"/><path d="M20 24Q20 20 40 18Q60 20 60 24V30Q60 33 40 35Q20 33 20 30Z" fill="rgba(255,255,255,.04)" stroke="rgba(240,200,80,.3)" stroke-width=".8"/><rect x="26" y="42" width="28" height="18" rx="4" fill="rgba(255,255,255,.03)" stroke="rgba(240,200,80,.3)" stroke-width="1"/><rect x="36" y="34" width="8" height="6" rx="2" fill="#C8940A" stroke="#F0C850" stroke-width=".8"/><path d="M28 24Q24 24 22 28L22 60" stroke="rgba(240,200,80,.4)" stroke-width="2.5" fill="none" stroke-linecap="round"/><path d="M52 24Q56 24 58 28L58 60" stroke="rgba(240,200,80,.4)" stroke-width="2.5" fill="none" stroke-linecap="round"/><rect x="30" y="46" width="20" height="10" rx="2" fill="rgba(240,200,80,.1)" stroke="rgba(240,200,80,.3)" stroke-width=".5"/><text x="40" y="53" text-anchor="middle" font-size="5" font-weight="800" fill="#F0C850" font-family="system-ui" letter-spacing=".3">ASGARD</text></svg>`,
  keychain: `<svg viewBox="0 0 80 80" fill="none"><defs><linearGradient id="kc1" x1="30" y1="20" x2="55" y2="70" gradientUnits="userSpaceOnUse"><stop offset="0%" stop-color="#707880"/><stop offset="100%" stop-color="#404850"/></linearGradient></defs><circle cx="40" cy="18" r="8" fill="none" stroke="#C8940A" stroke-width="3"/><circle cx="40" cy="18" r="5" fill="none" stroke="rgba(240,200,80,.3)" stroke-width="1"/><ellipse cx="40" cy="30" rx="4" ry="3" fill="none" stroke="#888" stroke-width="1.5"/><ellipse cx="40" cy="36" rx="3" ry="3" fill="none" stroke="#888" stroke-width="1.5"/><rect x="37" y="40" width="6" height="14" rx="2" fill="url(#kc1)" stroke="#F0C850" stroke-width="1"/><rect x="26" y="54" width="28" height="14" rx="3" fill="url(#kc1)" stroke="#F0C850" stroke-width="1.2"/><path d="M33 57Q37 55 40 57Q43 59 47 57" stroke="rgba(240,200,80,.25)" stroke-width=".8" fill="none"/><path d="M33 63Q37 61 40 63Q43 65 47 63" stroke="rgba(240,200,80,.25)" stroke-width=".8" fill="none"/><text x="40" y="50" text-anchor="middle" font-size="6" fill="rgba(240,200,80,.4)">&#x16A6;</text></svg>`,
  badge: `<svg viewBox="0 0 80 80" fill="none"><defs><linearGradient id="bd1" x1="20" y1="12" x2="60" y2="68" gradientUnits="userSpaceOnUse"><stop offset="0%" stop-color="#F0C850"/><stop offset="50%" stop-color="#C8940A"/><stop offset="100%" stop-color="#8B6914"/></linearGradient><linearGradient id="bd2" x1="40" y1="20" x2="40" y2="60" gradientUnits="userSpaceOnUse"><stop offset="0%" stop-color="#1a2040"/><stop offset="100%" stop-color="#0e1428"/></linearGradient></defs><path d="M40 10L60 18V44Q60 60 40 70Q20 60 20 44V18Z" fill="url(#bd1)" stroke="#FFE17A" stroke-width="1.5"/><path d="M40 16L54 22V44Q54 56 40 64Q26 56 26 44V22Z" fill="url(#bd2)"/><path d="M40 28L43 36H51L45 41L47 49L40 44L33 49L35 41L29 36H37Z" fill="#F0C850" stroke="#C8940A" stroke-width=".5"/><text x="40" y="58" text-anchor="middle" font-size="5" font-weight="800" fill="#F0C850" font-family="system-ui" letter-spacing=".5">ВЕТЕРАН</text></svg>`,
  stickers: `<svg viewBox="0 0 80 80" fill="none"><defs><linearGradient id="st1" x1="10" y1="10" x2="70" y2="70" gradientUnits="userSpaceOnUse"><stop offset="0%" stop-color="#1a2848"/><stop offset="100%" stop-color="#0e1830"/></linearGradient></defs><rect x="22" y="8" width="40" height="40" rx="6" fill="#1a1530" stroke="rgba(240,200,80,.2)" stroke-width="1" transform="rotate(12 42 28)"/><rect x="14" y="22" width="40" height="40" rx="6" fill="#141828" stroke="rgba(240,200,80,.25)" stroke-width="1" transform="rotate(-8 34 42)"/><rect x="20" y="30" width="44" height="40" rx="6" fill="url(#st1)" stroke="#F0C850" stroke-width="1.2"/><text x="42" y="48" text-anchor="middle" font-family="Cinzel,serif" font-size="6" font-weight="900" fill="#F0C850" letter-spacing=".5">ASGARD</text><text x="42" y="56" text-anchor="middle" font-size="4" fill="rgba(240,200,80,.5)" font-family="system-ui">СЕРВИС</text><path d="M56 30L64 30L56 38Z" fill="rgba(255,255,255,.06)" stroke="rgba(240,200,80,.2)" stroke-width=".5"/></svg>`,
  dayoff: `<svg viewBox="0 0 80 80" fill="none"><defs><linearGradient id="do1" x1="14" y1="14" x2="66" y2="70" gradientUnits="userSpaceOnUse"><stop offset="0%" stop-color="#2a2040"/><stop offset="100%" stop-color="#1a1530"/></linearGradient></defs><rect x="14" y="18" width="52" height="50" rx="6" fill="url(#do1)" stroke="#F0C850" stroke-width="1.2"/><rect x="14" y="18" width="52" height="14" rx="6" fill="rgba(240,200,80,.1)"/><rect x="14" y="26" width="52" height="6" fill="rgba(240,200,80,.1)"/><rect x="26" y="14" width="4" height="10" rx="2" fill="#C8940A" stroke="#F0C850" stroke-width=".5"/><rect x="50" y="14" width="4" height="10" rx="2" fill="#C8940A" stroke="#F0C850" stroke-width=".5"/><text x="40" y="52" text-anchor="middle" font-size="20" font-weight="900" fill="#F0C850" font-family="system-ui">+1</text><text x="40" y="62" text-anchor="middle" font-size="7" font-weight="700" fill="rgba(240,200,80,.6)" font-family="system-ui">ВЫХОДНОЙ</text></svg>`,
};

/* ═══ MOCK DATA ═══ */
const MOCK_ITEMS = [
  { id:5, name:'Толстовка ASGARD', status:'ready', svg:'hoodie', source:'wheel', sourceLabel:'Рулетка', sourceIcon:'\uD83C\uDFB0', date:'18.04.2026', pm:'Андросов Н.А.', pmPhone:'+79001234567', object:'ЖК Северный', desc:'Фирменная толстовка Асгард Сервис. 100% хлопок, плотность 320 г/м2. Размер L.' },
  { id:6, name:'Powerbank 20000mAh', status:'ready', svg:'powerbank', source:'quest', sourceLabel:'Квест', sourceIcon:'\u2694', date:'17.04.2026', pm:'Андросов Н.А.', pmPhone:'+79001234567', object:'ЖК Северный', desc:'Мощный внешний аккумулятор с быстрой зарядкой QC3.0.' },
  { id:7, name:'Кружка викинга', status:'ready', svg:'vikingmug', source:'wheel', sourceLabel:'Рулетка', sourceIcon:'\uD83C\uDFB0', date:'16.04.2026', pm:'Соловьёв Д.В.', pmPhone:'+79009876543', object:'БЦ Валхалла', desc:'Деревянная кружка ручной работы в стиле викингов. Объём 500 мл.' },
  { id:1, name:'Футболка ASGARD', status:'pending', svg:'tshirt', source:'shop', sourceLabel:'Магазин', sourceIcon:'\uD83D\uDECD', date:'18.04.2026', desc:'Фирменная футболка Асгард Сервис с рунической вышивкой.' },
  { id:2, name:'Термокружка', status:'pending', svg:'thermomug', source:'wheel', sourceLabel:'Рулетка', sourceIcon:'\uD83C\uDFB0', date:'19.04.2026', desc:'Термокружка из нержавеющей стали 450 мл.' },
  { id:3, name:'Шапка зимняя', status:'pending', svg:'beanie', source:'wheel', sourceLabel:'Рулетка', sourceIcon:'\uD83C\uDFB0', date:'19.04.2026', desc:'Вязаная шапка с помпоном и вышивкой ASGARD.' },
  { id:4, name:'Vip-место в автобусе', status:'pending', svg:'vipseat', source:'shop', sourceLabel:'Магазин', sourceIcon:'\uD83D\uDECD', date:'20.04.2026', desc:'Персональное VIP-место в служебном автобусе на 1 месяц.' },
  { id:8, name:'Рюкзак 30л', status:'delivered', svg:'backpack', source:'shop', sourceLabel:'Магазин', sourceIcon:'\uD83D\uDECD', date:'12.04.2026', deliveredDate:'14.04.2026', pm:'Андросов Н.А.', pmPhone:'+79001234567', object:'ЖК Северный', desc:'Вместительный городской рюкзак с отделением для ноутбука.' },
  { id:9, name:'Брелок Мьёльнир', status:'delivered', svg:'keychain', source:'wheel', sourceLabel:'Рулетка', sourceIcon:'\uD83C\uDFB0', date:'10.04.2026', deliveredDate:'11.04.2026', pm:'Андросов Н.А.', desc:'Металлический брелок в форме молота Тора.' },
  { id:10, name:'Бейдж Ветеран', status:'delivered', svg:'badge', source:'achievement', sourceLabel:'Ачивка', sourceIcon:'\uD83C\uDFC6', date:'08.04.2026', deliveredDate:'08.04.2026', pm:'Соловьёв Д.В.', desc:'Эксклюзивный металлический бейдж за 6+ месяцев непрерывной работы.' },
  { id:11, name:'Наклейки ASGARD', status:'delivered', svg:'stickers', source:'wheel', sourceLabel:'Рулетка', sourceIcon:'\uD83C\uDFB0', date:'05.04.2026', deliveredDate:'06.04.2026', pm:'Андросов Н.А.', desc:'Набор из 12 виниловых стикеров с нордическим дизайном.' },
  { id:12, name:'+1 выходной', status:'delivered', svg:'dayoff', source:'shop', sourceLabel:'Магазин', sourceIcon:'\uD83D\uDECD', date:'01.04.2026', deliveredDate:'02.04.2026', pm:'Соловьёв Д.В.', desc:'Один дополнительный оплачиваемый выходной день.' },
];

const STATUS_ORDER = { ready: 0, pending: 1, delivered: 2 };
const FUTHARK = ['ᚠ','ᚢ','ᚦ','ᚨ','ᚱ','ᚲ','ᚷ','ᚹ','ᚺ','ᚾ','ᛁ','ᛃ','ᛈ','ᛇ','ᛉ','ᛊ','ᛏ','ᛒ','ᛖ','ᛗ','ᛚ','ᛜ','ᛞ','ᛟ'];

/* ═══ SVG renderer (dangerouslySetInnerHTML) ═══ */
function SvgIcon({ name, size = 60 }) {
  const html = SVGS[name] || SVGS.tshirt;
  return <div style={{ width: size, height: size }} dangerouslySetInnerHTML={{ __html: html.replace('viewBox="0 0 80 80"', `viewBox="0 0 80 80" width="${size}" height="${size}"`) }} />;
}

/* ═══ COMPONENT ═══ */
export default function FieldInventory() {
  const navigate = useNavigate();
  const [items, setItems] = useState([]);
  const [filter, setFilter] = useState(null);
  const [modalItem, setModalItem] = useState(null);
  const [showModal, setShowModal] = useState(false);
  const [loading, setLoading] = useState(true);
  const [visibleCards, setVisibleCards] = useState(new Set());
  const touchStartY = useRef(0);

  /* ── Load from API ── */
  useEffect(() => {
    fieldApi.get('/gamification/inventory').then(d => {
      const apiItems = d?.inventory || [];
      if (apiItems.length > 0) {
        setItems(apiItems.map(it => ({
          id: it.id, name: it.item_name || it.name, status: it.delivery_status || 'pending',
          svg: it.svg_key || 'tshirt', source: it.source_type || 'shop',
          sourceLabel: it.source_type === 'spin' ? 'Рулетка' : it.source_type === 'shop' ? 'Магазин' : 'Ачивка',
          sourceIcon: it.source_type === 'spin' ? '\uD83C\uDFB0' : it.source_type === 'shop' ? '\uD83D\uDECD' : '\uD83C\uDFC6',
          date: new Date(it.acquired_at).toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit', year: 'numeric' }),
          deliveredDate: it.delivered_at ? new Date(it.delivered_at).toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit', year: 'numeric' }) : null,
          pm: it.pm_name || null, pmPhone: it.pm_phone || null, object: it.work_name || null,
          desc: it.item_description || it.description || '',
        })));
      } else {
        setItems(MOCK_ITEMS);
      }
    }).catch(() => setItems(MOCK_ITEMS))
      .finally(() => setLoading(false));
  }, []);

  /* ── Stagger animation ── */
  useEffect(() => {
    if (loading) return;
    const sorted = [...items].sort((a, b) => STATUS_ORDER[a.status] - STATUS_ORDER[b.status]);
    const timeouts = sorted.map((item, idx) =>
      setTimeout(() => setVisibleCards(prev => new Set(prev).add(item.id)), 80 + idx * 70)
    );
    return () => timeouts.forEach(t => clearTimeout(t));
  }, [items, loading]);

  /* ── Counts ── */
  const counts = useMemo(() => {
    const c = { pending: 0, ready: 0, delivered: 0 };
    items.forEach(i => c[i.status]++);
    return c;
  }, [items]);

  /* ── Filtered & sorted ── */
  const sorted = useMemo(() => {
    const s = [...items].sort((a, b) => STATUS_ORDER[a.status] - STATUS_ORDER[b.status]);
    if (!filter) return s;
    return s.filter(i => i.status === filter);
  }, [items, filter]);

  /* ── Ready PM info ── */
  const readyItems = useMemo(() => items.filter(i => i.status === 'ready'), [items]);
  const readyPm = readyItems[0]?.pm;
  const readyPhone = readyItems[0]?.pmPhone;

  /* ── Toggle filter ── */
  const toggleFilter = useCallback((f) => {
    setFilter(prev => prev === f ? null : f);
  }, []);

  /* ── Modal ── */
  const openModal = useCallback((item) => {
    setModalItem(item);
    setShowModal(true);
  }, []);

  const closeModal = useCallback(() => {
    setShowModal(false);
    setTimeout(() => setModalItem(null), 400);
  }, []);

  // Body overflow managed via effect (cleanup on unmount)
  useEffect(() => {
    if (showModal) { document.body.style.overflow = 'hidden'; }
    else { document.body.style.overflow = ''; }
    return () => { document.body.style.overflow = ''; };
  }, [showModal]);

  /* ── Swipe to close ── */
  const handleTouchStart = useCallback((e) => { touchStartY.current = e.touches[0].clientY; }, []);
  const handleTouchMove = useCallback((e) => {
    if (e.touches[0].clientY - touchStartY.current > 80) closeModal();
  }, [closeModal]);

  /* ── Stars ── */
  const stars = useMemo(() => Array.from({ length: 30 }, () => ({
    left: Math.random() * 100, top: Math.random() * 100,
    size: 1 + Math.random() * 2, delay: Math.random() * 3, dur: 2 + Math.random() * 2,
  })), []);

  /* ── Floating runes ── */
  const floatingRunes = useMemo(() => Array.from({ length: 6 }, () => ({
    char: FUTHARK[Math.floor(Math.random() * FUTHARK.length)],
    left: 5 + Math.random() * 90, delay: Math.random() * 20, dur: 15 + Math.random() * 15,
    size: 20 + Math.random() * 20,
  })), []);

  /* ── Timeline for modal ── */
  const getTimeline = useCallback((status) => {
    if (status === 'pending') return { dots: ['current','empty','empty'], lines: ['empty','empty'], labels: ['active','',''] };
    if (status === 'ready') return { dots: ['filled','current','empty'], lines: ['filled','empty'], labels: ['active','active',''] };
    return { dots: ['filled','filled','filled'], lines: ['filled','filled'], labels: ['active','active','active'] };
  }, []);

  /* ── Skeleton ── */
  if (loading) {
    return (
      <>
        <style>{INV_CSS}</style>
        <div className="finv">
          <div className="finv-page" style={{ padding: '60px 16px' }}>
            {[1,2,3,4].map(i => (
              <div key={i} style={{ height: 100, borderRadius: 18, marginBottom: 10,
                background: 'linear-gradient(90deg,#141828 25%,#1a2040 50%,#141828 75%)',
                backgroundSize: '200% 100%', animation: 'finv-shimmer 1.5s infinite' }} />
            ))}
          </div>
        </div>
      </>
    );
  }

  return (
    <>
      <style>{INV_CSS}</style>
      <div className="finv">
        {/* Background */}
        <div className="finv-bg">
          <div className="finv-bg-glow g1" /><div className="finv-bg-glow g2" />
          <div className="finv-bg-glow g3" /><div className="finv-bg-glow g4" />
          <div className="finv-stars">
            {stars.map((s, i) => (
              <div key={i} className="finv-s" style={{
                left: `${s.left}%`, top: `${s.top}%`, width: s.size, height: s.size,
                animationDelay: `${s.delay}s`, animationDuration: `${s.dur}s`,
              }} />
            ))}
          </div>
        </div>

        {/* Floating runes */}
        {floatingRunes.map((r, i) => (
          <div key={i} className="finv-rune-float" style={{
            left: `${r.left}%`, animationDelay: `${r.delay}s`,
            animationDuration: `${r.dur}s`, fontSize: r.size,
          }}>{r.char}</div>
        ))}

        <div className="finv-page">

          {/* ═══ HEADER ═══ */}
          <div className="finv-header">
            <div className="finv-hdr-back" onClick={() => navigate(-1)}>
              <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="rgba(255,255,255,.7)" strokeWidth="2.2" strokeLinecap="round"><path d="M15 18l-6-6 6-6" /></svg>
            </div>
            <div className="finv-hdr-center">
              <div className="finv-hdr-title">СОКРОВИЩА ВОИНА</div>
            </div>
            <div className="finv-hdr-counter">
              <span className="finv-hdr-counter-icon">{'\uD83D\uDDDD'}</span>
              <span>{items.length} предметов</span>
            </div>
          </div>

          {/* ═══ FILTER PILLS ═══ */}
          <div className="finv-status-bar">
            {[
              { key: 'pending', icon: '\u23F3', label: 'Готовят' },
              { key: 'ready', icon: '\uD83D\uDCE6', label: 'Готовы' },
              { key: 'delivered', icon: '\u2705', label: 'Получены' },
            ].map(p => (
              <div key={p.key} className={`finv-pill${filter === p.key ? ' active' : ''}`}
                data-filter={p.key} onClick={() => toggleFilter(p.key)}>
                <span className="finv-pill-icon">{p.icon}</span>
                <span className="finv-pill-count">{counts[p.key]}</span>
                <span>{p.label}</span>
              </div>
            ))}
          </div>

          {/* ═══ READY BANNER ═══ */}
          {counts.ready > 0 && (!filter || filter === 'ready') && (
            <div className="finv-ready-banner">
              <div className="finv-ready-banner-icon">{'\uD83D\uDCE6'}</div>
              <div className="finv-ready-banner-text">
                <div className="finv-ready-banner-title">{counts.ready} {counts.ready === 1 ? 'приз ждёт' : 'приза ждут'} тебя</div>
                <div className="finv-ready-banner-sub">у РП {readyPm || ''}</div>
              </div>
              {readyPhone && (
                <a href={`tel:${readyPhone}`} className="finv-ready-banner-cta"
                  onClick={e => e.stopPropagation()}>
                  {'\uD83D\uDCDE'} Позвонить
                </a>
              )}
            </div>
          )}

          {/* ═══ ITEM LIST ═══ */}
          <div className="finv-item-list">
            {sorted.length === 0 ? (
              <div className="finv-empty-state show">
                <div className="finv-empty-rune">{'\u16C3'}</div>
                <div className="finv-empty-title">Сокровищница пуста</div>
                <div className="finv-empty-sub">Крути рулетку или выполняй квесты,<br/>чтобы заполнить свой инвентарь</div>
                <button className="finv-empty-btn" onClick={() => navigate('/field/wheel')}>
                  {'\u2694'} Крутить рулетку {'\u2192'}
                </button>
              </div>
            ) : sorted.map((item) => {
              const isVisible = visibleCards.has(item.id);
              let statusIcon, statusText, statusClass, subText;
              if (item.status === 'pending') {
                statusIcon = '\u23F3'; statusText = 'Готовят'; statusClass = 'pending'; subText = 'Ожидайте, заказ в обработке';
              } else if (item.status === 'ready') {
                statusIcon = '\uD83D\uDCE6'; statusText = 'Готов к выдаче'; statusClass = 'ready'; subText = 'Подойдите к РП на объекте';
              } else {
                statusIcon = '\u2705'; statusText = 'Получен'; statusClass = 'delivered'; subText = 'Выдано ' + item.deliveredDate;
              }

              return (
                <div key={item.id} className={`finv-item-card${isVisible ? ' visible' : ''}`}
                  data-status={item.status} onClick={() => openModal(item)}>
                  <div className="finv-item-svg-wrap">
                    <div className="finv-item-svg-glow" />
                    <SvgIcon name={item.svg} size={60} />
                  </div>
                  <div className="finv-item-info">
                    <div className="finv-item-name">{item.name}</div>
                    <div className={`finv-item-status-badge ${statusClass}`}>{statusIcon} {statusText}</div>
                    <div className="finv-item-sub">{subText}</div>
                    {item.pm && item.status === 'ready' && (
                      <div className="finv-item-pm-row">
                        <span>{'\uD83D\uDC64'} {item.pm}</span>
                        {item.pmPhone && (
                          <a href={`tel:${item.pmPhone}`} className="finv-item-pm-call"
                            onClick={e => e.stopPropagation()}>
                            <svg viewBox="0 0 24 24" width="14" height="14" fill="#3b82f6">
                              <path d="M22 16.92v3a2 2 0 01-2.18 2 19.79 19.79 0 01-8.63-3.07 19.5 19.5 0 01-6-6 19.79 19.79 0 01-3.07-8.67A2 2 0 014.11 2h3a2 2 0 012 1.72c.127.96.361 1.903.7 2.81a2 2 0 01-.45 2.11L8.09 9.91a16 16 0 006 6l1.27-1.27a2 2 0 012.11-.45c.907.339 1.85.573 2.81.7A2 2 0 0122 16.92z"/>
                            </svg>
                          </a>
                        )}
                      </div>
                    )}
                    {item.pm && item.status === 'delivered' && (
                      <div className="finv-item-pm-row"><span>{'\uD83D\uDC64'} {item.pm}</span></div>
                    )}
                    <div className="finv-item-source">
                      <span className="finv-item-source-icon">{item.sourceIcon}</span>
                      <span>{item.sourceLabel}</span>
                      <span style={{ marginLeft: 6 }} className="finv-item-date">{item.date}</span>
                    </div>
                    <div className="finv-item-more">{'\u25B8'} Подробнее</div>
                  </div>
                </div>
              );
            })}
          </div>

        </div>

        {/* ═══ DETAIL MODAL ═══ */}
        <div className={`finv-modal-overlay${showModal ? ' on' : ''}`} onClick={closeModal} />
        <div className={`finv-modal-sheet${showModal ? ' on' : ''}`}
          onTouchStart={handleTouchStart} onTouchMove={handleTouchMove}>
          <div className="finv-modal-card" onClick={e => e.stopPropagation()}>
            <div className="finv-modal-handle" />
            <button className="finv-modal-close" onClick={closeModal}>
              <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="rgba(255,255,255,.7)" strokeWidth="2.5" strokeLinecap="round">
                <path d="M18 6L6 18M6 6l12 12" />
              </svg>
            </button>
            {modalItem && (() => {
              const tl = getTimeline(modalItem.status);
              return (
                <>
                  <div className="finv-modal-svg-area">
                    <div className="finv-modal-svg-glow" />
                    <div className="finv-modal-rune-ring" />
                    <SvgIcon name={modalItem.svg} size={140} />
                  </div>
                  <div className="finv-modal-name">{modalItem.name}</div>
                  <div className="finv-modal-desc">{modalItem.desc}</div>

                  {/* Info grid */}
                  <div className="finv-modal-grid">
                    <div className="finv-modal-grid-item">
                      <div className="finv-modal-grid-label">Источник</div>
                      <div className="finv-modal-grid-value">{modalItem.sourceIcon} {modalItem.sourceLabel}</div>
                    </div>
                    <div className="finv-modal-grid-item">
                      <div className="finv-modal-grid-label">Дата</div>
                      <div className="finv-modal-grid-value">{modalItem.date}</div>
                    </div>
                    <div className="finv-modal-grid-item">
                      <div className="finv-modal-grid-label">Статус</div>
                      <div className="finv-modal-grid-value">
                        {modalItem.status === 'pending' ? '\u23F3 Готовят' :
                         modalItem.status === 'ready' ? '\uD83D\uDCE6 Готов к выдаче' :
                         '\u2705 Получен ' + modalItem.deliveredDate}
                      </div>
                    </div>
                    {modalItem.pm && (
                      <div className="finv-modal-grid-item">
                        <div className="finv-modal-grid-label">Руководитель проекта</div>
                        <div className="finv-modal-grid-value">{'\uD83D\uDC64'} {modalItem.pm}</div>
                      </div>
                    )}
                    {modalItem.object && (
                      <div className="finv-modal-grid-item full">
                        <div className="finv-modal-grid-label">Объект</div>
                        <div className="finv-modal-grid-value">{'\uD83D\uDDFA'} {modalItem.object}</div>
                      </div>
                    )}
                  </div>

                  {/* Timeline */}
                  <div className="finv-modal-timeline">
                    <div className={`finv-tl-dot ${tl.dots[0]}`}>{'\u23F3'}</div>
                    <div className={`finv-tl-line ${tl.lines[0]}`} />
                    <div className={`finv-tl-dot ${tl.dots[1]}`}>{'\uD83D\uDCE6'}</div>
                    <div className={`finv-tl-line ${tl.lines[1]}`} />
                    <div className={`finv-tl-dot ${tl.dots[2]}`}>{'\u2705'}</div>
                  </div>
                  <div className="finv-tl-labels">
                    <div className={`finv-tl-label ${tl.labels[0]}`}>Готовят</div>
                    <div className={`finv-tl-label ${tl.labels[1]}`}>Готов</div>
                    <div className={`finv-tl-label ${tl.labels[2]}`}>Получен</div>
                  </div>

                  {/* CTA */}
                  {modalItem.status === 'ready' && modalItem.pmPhone && (
                    <a href={`tel:${modalItem.pmPhone}`} className="finv-modal-cta show">
                      {'\uD83D\uDCDE'} Позвонить РП {modalItem.pm}
                    </a>
                  )}
                </>
              );
            })()}
          </div>
        </div>
      </div>
    </>
  );
}

/* ═══════════════════════════════════════════════════════════
   CSS — 1:1 from FIELD_INVENTORY_RENDER.html
   ═══════════════════════════════════════════════════════════ */
const INV_CSS = `
/* Q10: Cinzel font loaded via index.html link — no @import FOUC */
@keyframes finv-shimmer{0%{background-position:200% 0}100%{background-position:-200% 0}}
.finv{
  --finv-bg:#0b0e1a;--finv-card:#141828;--finv-card2:#1a2040;
  --finv-gold:#F0C850;--finv-gold-d:#C8940A;--finv-gold-l:#FFE17A;
  --finv-red:#E84057;--finv-blue:#4A90FF;--finv-purple:#A56EFF;--finv-green:#3DDC84;
  --finv-t1:#fff;--finv-t2:rgba(255,255,255,.7);--finv-t3:rgba(255,255,255,.4);
  --finv-gold-warm:#f59e0b;--finv-rune-accent:#b45309;
  --finv-status-grey:#6b7280;--finv-status-blue:#3b82f6;--finv-status-green:#22c55e;
  position:relative;min-height:100dvh;width:100%;background:var(--finv-bg);color:var(--finv-t1);
  font-family:-apple-system,BlinkMacSystemFont,'SF Pro Round',system-ui,sans-serif;
  -webkit-user-select:none;user-select:none;overflow-x:hidden;overflow-y:auto;
}
/* BG */
.finv-bg{position:fixed;inset:0;z-index:0;overflow:hidden;pointer-events:none}
.finv-bg-glow{position:absolute;border-radius:50%;filter:blur(80px);opacity:.25}
.finv-bg-glow.g1{width:300px;height:300px;top:-50px;left:-50px;background:var(--finv-blue)}
.finv-bg-glow.g2{width:250px;height:250px;bottom:-30px;right:-60px;background:var(--finv-purple)}
.finv-bg-glow.g3{width:200px;height:200px;top:40%;left:50%;transform:translateX(-50%);background:var(--finv-gold);opacity:.08}
.finv-bg-glow.g4{width:180px;height:180px;top:60%;left:20%;background:var(--finv-gold-warm);opacity:.06}
.finv-stars{position:absolute;inset:0}.finv-s{position:absolute;background:#fff;border-radius:50%;animation:finv-tw 3s ease-in-out infinite alternate}
@keyframes finv-tw{0%{opacity:.1;transform:scale(.8)}100%{opacity:.5;transform:scale(1.3)}}

.finv-rune-float{position:fixed;font-size:28px;color:rgba(180,83,9,.08);pointer-events:none;z-index:0;
  font-family:'Cinzel',serif;animation:finv-runeFloat 20s linear infinite}
@keyframes finv-runeFloat{0%{transform:translateY(100vh) rotate(0deg);opacity:0}10%{opacity:.08}90%{opacity:.08}100%{transform:translateY(-100px) rotate(360deg);opacity:0}}

.finv-page{position:relative;z-index:5;max-width:430px;margin:0 auto;min-height:100dvh;
  padding-bottom:max(env(safe-area-inset-bottom),24px)}

/* Header */
.finv-header{position:sticky;top:0;z-index:50;display:flex;align-items:center;justify-content:space-between;
  padding:10px 16px;padding-top:max(env(safe-area-inset-top),10px);
  background:linear-gradient(180deg,var(--finv-bg) 60%,transparent);backdrop-filter:blur(12px);-webkit-backdrop-filter:blur(12px)}
.finv-hdr-back{width:36px;height:36px;border-radius:12px;background:rgba(255,255,255,.06);display:flex;align-items:center;justify-content:center;cursor:pointer;transition:background .2s;flex-shrink:0}
.finv-hdr-back:active{background:rgba(255,255,255,.12)}
.finv-hdr-center{text-align:center;flex:1;min-width:0}
.finv-hdr-title{font-family:'Cinzel',serif;font-size:14px;font-weight:900;letter-spacing:.1em;color:var(--finv-gold);text-shadow:0 0 20px rgba(240,200,80,.2)}
.finv-hdr-counter{display:flex;align-items:center;gap:5px;padding:5px 12px 5px 8px;
  background:linear-gradient(135deg,#2a2008,#1a1505);border:1.5px solid rgba(240,200,80,.3);border-radius:20px;
  box-shadow:0 2px 10px rgba(240,200,80,.1);font-size:13px;font-weight:700;color:var(--finv-gold);flex-shrink:0}
.finv-hdr-counter-icon{font-size:16px}

/* Status pills */
.finv-status-bar{display:flex;gap:8px;padding:12px 16px 8px;justify-content:center}
.finv-pill{display:flex;align-items:center;gap:5px;padding:8px 14px;border-radius:20px;font-size:12px;font-weight:700;
  cursor:pointer;transition:all .3s ease;border:1.5px solid transparent;background:rgba(255,255,255,.04);color:var(--finv-t2);
  -webkit-tap-highlight-color:transparent}
.finv-pill:active{transform:scale(.95)}
.finv-pill-icon{font-size:14px}
.finv-pill-count{min-width:20px;height:20px;border-radius:10px;display:flex;align-items:center;justify-content:center;
  font-size:11px;font-weight:800;background:rgba(255,255,255,.08);color:var(--finv-t2)}

.finv-pill[data-filter="pending"]{border-color:rgba(107,114,128,.3)}
.finv-pill[data-filter="pending"].active{background:rgba(107,114,128,.12);border-color:rgba(107,114,128,.5);color:#d1d5db}
.finv-pill[data-filter="pending"].active .finv-pill-count{background:var(--finv-status-grey);color:#fff}
.finv-pill[data-filter="ready"]{border-color:rgba(59,130,246,.3)}
.finv-pill[data-filter="ready"].active{background:rgba(59,130,246,.12);border-color:rgba(59,130,246,.5);color:#93c5fd}
.finv-pill[data-filter="ready"].active .finv-pill-count{background:var(--finv-status-blue);color:#fff}
.finv-pill[data-filter="ready"] .finv-pill-icon{animation:finv-pulseBlue 2s ease-in-out infinite}
@keyframes finv-pulseBlue{0%,100%{opacity:.7}50%{opacity:1;text-shadow:0 0 8px rgba(59,130,246,.5)}}
.finv-pill[data-filter="delivered"]{border-color:rgba(34,197,94,.3)}
.finv-pill[data-filter="delivered"].active{background:rgba(34,197,94,.12);border-color:rgba(34,197,94,.5);color:#86efac}
.finv-pill[data-filter="delivered"].active .finv-pill-count{background:var(--finv-status-green);color:#fff}

/* Ready banner */
.finv-ready-banner{margin:4px 16px 8px;padding:12px 16px;border-radius:16px;
  background:linear-gradient(135deg,rgba(59,130,246,.12),rgba(59,130,246,.06));
  border:1px solid rgba(59,130,246,.25);display:flex;align-items:center;gap:12px;
  animation:finv-bannerPulse 3s ease-in-out infinite}
@keyframes finv-bannerPulse{0%,100%{box-shadow:0 0 0 0 rgba(59,130,246,0)}50%{box-shadow:0 0 20px 2px rgba(59,130,246,.15)}}
.finv-ready-banner-icon{font-size:24px;flex-shrink:0}
.finv-ready-banner-text{flex:1;min-width:0}
.finv-ready-banner-title{font-size:13px;font-weight:700;color:#93c5fd}
.finv-ready-banner-sub{font-size:11px;color:var(--finv-t3);margin-top:2px}
.finv-ready-banner-cta{padding:8px 16px;border-radius:12px;border:none;background:var(--finv-status-blue);color:#fff;
  font-size:12px;font-weight:700;cursor:pointer;display:flex;align-items:center;gap:4px;flex-shrink:0;transition:transform .15s;text-decoration:none}
.finv-ready-banner-cta:active{transform:scale(.95)}

/* Item list */
.finv-item-list{padding:8px 16px;display:flex;flex-direction:column;gap:10px}

/* Item card */
.finv-item-card{display:flex;gap:14px;padding:14px;border-radius:18px;background:var(--finv-card);
  border:1.5px solid rgba(255,255,255,.04);cursor:pointer;transition:all .3s ease;position:relative;overflow:hidden;
  -webkit-tap-highlight-color:transparent;opacity:0;transform:translateY(20px)}
.finv-item-card.visible{opacity:1;transform:translateY(0)}
.finv-item-card:active{transform:scale(.98)!important}
.finv-item-card[data-status="pending"].visible{opacity:.75}
.finv-item-card[data-status="pending"] .finv-item-svg-wrap{filter:saturate(.5) brightness(.7)}
.finv-item-card[data-status="ready"]{border-color:rgba(240,200,80,.25);
  background:linear-gradient(135deg,rgba(240,200,80,.06),var(--finv-card));animation:finv-readyGlow 3s ease-in-out infinite}
@keyframes finv-readyGlow{0%,100%{box-shadow:0 0 0 0 rgba(240,200,80,0),0 4px 15px rgba(0,0,0,.2)}
  50%{box-shadow:0 0 20px 3px rgba(240,200,80,.12),0 4px 15px rgba(0,0,0,.2)}}
.finv-item-card[data-status="delivered"]{border-color:rgba(34,197,94,.1)}

/* SVG wrap */
.finv-item-svg-wrap{width:80px;height:80px;flex-shrink:0;border-radius:16px;display:flex;align-items:center;justify-content:center;position:relative;overflow:visible}
.finv-item-svg-glow{position:absolute;inset:-8px;border-radius:20px;filter:blur(12px);opacity:.3;z-index:0}
.finv-item-card[data-status="ready"] .finv-item-svg-glow{background:radial-gradient(circle,var(--finv-gold),transparent);opacity:.4;animation:finv-svgGlowPulse 3s ease-in-out infinite}
@keyframes finv-svgGlowPulse{0%,100%{opacity:.3}50%{opacity:.5}}
.finv-item-card[data-status="pending"] .finv-item-svg-glow{background:radial-gradient(circle,rgba(107,114,128,.4),transparent);opacity:.15}
.finv-item-card[data-status="delivered"] .finv-item-svg-glow{background:radial-gradient(circle,rgba(34,197,94,.3),transparent);opacity:.2}

/* Item info */
.finv-item-info{flex:1;min-width:0;display:flex;flex-direction:column;gap:4px}
.finv-item-name{font-size:15px;font-weight:700;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.finv-item-status-badge{display:inline-flex;align-items:center;gap:4px;padding:3px 10px;border-radius:8px;font-size:11px;font-weight:700;width:fit-content}
.finv-item-status-badge.pending{background:rgba(107,114,128,.12);color:#9ca3af}
.finv-item-status-badge.ready{background:rgba(59,130,246,.12);color:#60a5fa;animation:finv-badgePulseBlue 2s ease-in-out infinite}
@keyframes finv-badgePulseBlue{0%,100%{box-shadow:0 0 0 0 rgba(59,130,246,0)}50%{box-shadow:0 0 8px 1px rgba(59,130,246,.2)}}
.finv-item-status-badge.delivered{background:rgba(34,197,94,.12);color:#4ade80}
.finv-item-sub{font-size:11px;color:var(--finv-t3);line-height:1.3}
.finv-item-pm-row{display:flex;align-items:center;gap:6px;font-size:11px;color:var(--finv-t2)}
.finv-item-pm-call{width:28px;height:28px;border-radius:50%;background:rgba(59,130,246,.15);border:1px solid rgba(59,130,246,.3);
  display:flex;align-items:center;justify-content:center;cursor:pointer;text-decoration:none;transition:all .2s;flex-shrink:0}
.finv-item-pm-call:active{background:rgba(59,130,246,.3);transform:scale(.9)}
.finv-item-card[data-status="ready"] .finv-item-pm-call{animation:finv-phoneRing 3s ease-in-out infinite 1.5s}
@keyframes finv-phoneRing{0%,8%,16%,100%{transform:rotate(0)}2%{transform:rotate(12deg)}4%{transform:rotate(-12deg)}6%{transform:rotate(10deg)}10%{transform:rotate(-8deg)}12%{transform:rotate(6deg)}14%{transform:rotate(-4deg)}}
.finv-item-source{display:flex;align-items:center;gap:4px;font-size:11px;color:var(--finv-t3)}
.finv-item-source-icon{font-size:13px}
.finv-item-date{font-size:10px;color:var(--finv-t3)}
.finv-item-more{font-size:11px;font-weight:700;color:var(--finv-gold-warm);cursor:pointer;display:inline-flex;align-items:center;gap:2px;margin-top:2px}

/* Modal overlay */
.finv-modal-overlay{position:fixed;inset:0;z-index:200;background:rgba(0,0,0,0);pointer-events:none;transition:background .35s}
.finv-modal-overlay.on{background:rgba(0,0,0,.7);pointer-events:auto;backdrop-filter:blur(8px);-webkit-backdrop-filter:blur(8px)}
.finv-modal-sheet{position:fixed;left:50%;bottom:0;width:100%;max-width:430px;transform:translate(-50%,110%);z-index:201;
  transition:transform .5s cubic-bezier(.34,1.56,.64,1);max-height:92dvh;overflow-y:auto}
.finv-modal-sheet.on{transform:translate(-50%,0)}
.finv-modal-card{background:linear-gradient(180deg,var(--finv-card2),var(--finv-card));border-radius:28px 28px 0 0;
  border:1px solid rgba(255,255,255,.06);border-bottom:none;padding:20px;
  padding-bottom:max(env(safe-area-inset-bottom),28px);box-shadow:0 -10px 50px rgba(0,0,0,.5);position:relative}
.finv-modal-handle{width:40px;height:4px;border-radius:2px;background:rgba(255,255,255,.12);margin:0 auto 16px}
.finv-modal-close{position:absolute;top:20px;right:20px;width:32px;height:32px;border-radius:50%;
  background:rgba(255,255,255,.06);border:none;cursor:pointer;display:flex;align-items:center;justify-content:center;transition:background .2s;z-index:5}
.finv-modal-close:active{background:rgba(255,255,255,.15)}

/* Modal SVG */
.finv-modal-svg-area{text-align:center;position:relative;height:200px;margin-bottom:12px;display:flex;align-items:center;justify-content:center}
.finv-modal-svg-glow{position:absolute;top:50%;left:50%;transform:translate(-50%,-50%);width:180px;height:180px;border-radius:50%;
  background:radial-gradient(circle,rgba(240,200,80,.2),rgba(180,83,9,.1),transparent);filter:blur(20px);animation:finv-modalGlow 3s ease-in-out infinite alternate}
@keyframes finv-modalGlow{0%{opacity:.5;transform:translate(-50%,-50%) scale(.9)}100%{opacity:.8;transform:translate(-50%,-50%) scale(1.1)}}
.finv-modal-rune-ring{position:absolute;top:50%;left:50%;transform:translate(-50%,-50%);width:190px;height:190px;border-radius:50%;
  border:1px solid rgba(180,83,9,.15);z-index:1;animation:finv-runeRingSpin 30s linear infinite}
@keyframes finv-runeRingSpin{0%{transform:translate(-50%,-50%) rotate(0deg)}100%{transform:translate(-50%,-50%) rotate(360deg)}}

.finv-modal-name{font-family:'Cinzel',serif;font-size:22px;font-weight:900;text-align:center;color:var(--finv-t1);margin-bottom:4px}
.finv-modal-desc{font-size:13px;color:var(--finv-t2);text-align:center;margin-bottom:16px;line-height:1.4}

/* Modal grid */
.finv-modal-grid{display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-bottom:16px}
.finv-modal-grid-item{padding:10px 12px;border-radius:12px;background:rgba(255,255,255,.03);border:1px solid rgba(255,255,255,.04)}
.finv-modal-grid-item.full{grid-column:1/-1}
.finv-modal-grid-label{font-size:10px;color:var(--finv-t3);text-transform:uppercase;letter-spacing:.05em;margin-bottom:3px}
.finv-modal-grid-value{font-size:13px;font-weight:600;color:var(--finv-t1)}

/* Timeline */
.finv-modal-timeline{display:flex;align-items:center;justify-content:center;gap:0;margin:20px 0;padding:0 20px}
.finv-tl-dot{width:28px;height:28px;border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:12px;font-weight:800;position:relative;flex-shrink:0}
.finv-tl-dot.filled{background:linear-gradient(135deg,var(--finv-gold-d),var(--finv-gold));color:#1a1000;box-shadow:0 2px 8px rgba(240,200,80,.25)}
.finv-tl-dot.empty{background:rgba(255,255,255,.06);border:2px solid rgba(255,255,255,.12);color:var(--finv-t3)}
.finv-tl-dot.current{background:linear-gradient(135deg,var(--finv-gold-d),var(--finv-gold));color:#1a1000;animation:finv-tlPulse 2s ease-in-out infinite}
@keyframes finv-tlPulse{0%,100%{box-shadow:0 0 0 0 rgba(240,200,80,0)}50%{box-shadow:0 0 12px 4px rgba(240,200,80,.3)}}
.finv-tl-line{flex:1;height:3px;border-radius:2px;min-width:30px}
.finv-tl-line.filled{background:linear-gradient(90deg,var(--finv-gold-d),var(--finv-gold))}
.finv-tl-line.empty{background:rgba(255,255,255,.08)}
.finv-tl-labels{display:flex;justify-content:space-between;padding:0 10px;margin-top:6px}
.finv-tl-label{font-size:10px;color:var(--finv-t3);text-align:center;width:70px}
.finv-tl-label.active{color:var(--finv-gold);font-weight:600}

/* CTA */
.finv-modal-cta{display:none;align-items:center;justify-content:center;gap:8px;width:100%;padding:16px;border-radius:16px;border:none;
  font-size:15px;font-weight:800;color:#fff;cursor:pointer;background:linear-gradient(135deg,var(--finv-status-blue),#2563eb);
  box-shadow:0 5px 0 #1d4ed8,0 8px 20px rgba(59,130,246,.2);margin-top:16px;transition:transform .1s;text-decoration:none}
.finv-modal-cta:active{transform:translateY(3px);box-shadow:0 2px 0 #1d4ed8}
.finv-modal-cta.show{display:flex}

/* Empty state */
.finv-empty-state{display:none;flex-direction:column;align-items:center;justify-content:center;padding:60px 32px;text-align:center}
.finv-empty-state.show{display:flex}
.finv-empty-rune{font-size:80px;color:rgba(107,114,128,.2);font-family:'Cinzel',serif;margin-bottom:16px;text-shadow:0 0 30px rgba(107,114,128,.1)}
.finv-empty-title{font-family:'Cinzel',serif;font-size:20px;font-weight:700;color:var(--finv-t2);margin-bottom:8px}
.finv-empty-sub{font-size:13px;color:var(--finv-t3);margin-bottom:24px;line-height:1.4}
.finv-empty-btn{display:inline-flex;align-items:center;gap:8px;padding:14px 28px;border-radius:16px;border:none;
  font-size:15px;font-weight:800;color:#fff;cursor:pointer;
  background:linear-gradient(135deg,var(--finv-red),#c0243a,var(--finv-gold-d));
  box-shadow:0 5px 0 #7a1a28,0 8px 20px rgba(232,64,87,.2);transition:transform .1s}
.finv-empty-btn:active{transform:translateY(3px);box-shadow:0 2px 0 #7a1a28}

.finv ::-webkit-scrollbar{width:3px}
.finv ::-webkit-scrollbar-track{background:transparent}
.finv ::-webkit-scrollbar-thumb{background:rgba(255,255,255,.1);border-radius:2px}
`;
