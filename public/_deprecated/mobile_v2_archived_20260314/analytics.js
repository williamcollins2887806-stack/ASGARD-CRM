(function(){
'use strict';
const el = Utils.el;
const PERIODS = [['Месяц','month'],['Квартал','quarter'],['Год','year']];
const ANALYTICS = {
  works: {
    score: 91,
    stats: [
      { label:'Завершено', value:'38' },
      { label:'Средний срок', value:'27 дн' },
      { label:'Задержки', value:'4' },
      { label:'Выработка', value:'1.84 млн ₽' }
    ],
    pms: [
      { name:'Алексей Орлов', value:'96%', progress:96, sum:'14.2 млн ₽' },
      { name:'Роман Егоров', value:'91%', progress:91, sum:'11.8 млн ₽' },
      { name:'Марина Белова', value:'87%', progress:87, sum:'9.6 млн ₽' }
    ],
    months: [
      { label:'Янв', value:64 },{ label:'Фев', value:72 },{ label:'Мар', value:88 },{ label:'Апр', value:75 },
      { label:'Май', value:93 },{ label:'Июн', value:79 },{ label:'Июл', value:82 },{ label:'Авг', value:90 }
    ],
    trend: [58,62,66,70,75,73,79,82,86,88,91,94]
  },
  money: {
    margin: 28.9,
    stats: [
      { label:'Доход', value:'118.5 млн ₽' },
      { label:'Расход', value:'84.2 млн ₽' },
      { label:'Прибыль', value:'34.3 млн ₽' },
      { label:'ROI', value:'40.7%' }
    ],
    bars: [
      { label:'Янв', value:8.4, value2:5.1 },{ label:'Фев', value:9.2, value2:6.3 },{ label:'Мар', value:12.8, value2:8.9 },
      { label:'Апр', value:10.4, value2:6.1 },{ label:'Май', value:11.0, value2:7.2 },{ label:'Июн', value:9.9, value2:6.4 },
      { label:'Июл', value:8.7, value2:5.8 },{ label:'Авг', value:10.7, value2:7.1 },{ label:'Сен', value:9.8, value2:6.7 },
      { label:'Окт', value:11.5, value2:7.4 },{ label:'Ноя', value:10.8, value2:6.9 },{ label:'Дек', value:12.1, value2:7.5 }
    ],
    dirs: [
      { name:'Инженерные сети', share:38, color:'#0f6ad9', sum:'13.1 млн ₽' },
      { name:'Слаботочка', share:22, color:'#0b8457', sum:'7.5 млн ₽' },
      { name:'Логистика', share:16, color:'#d4a843', sum:'5.5 млн ₽' },
      { name:'Подряд', share:14, color:'#ce4d2d', sum:'4.8 млн ₽' },
      { name:'Прочее', share:10, color:'#70738a', sum:'3.4 млн ₽' }
    ],
    objects: [
      { name:'БЦ Prime', profit:'8.4 млн ₽', margin:'31%' },
      { name:'ТРК Измайлово', profit:'6.9 млн ₽', margin:'27%' },
      { name:'Лахта B2', profit:'5.8 млн ₽', margin:'24%' },
      { name:'LogiPark', profit:'4.7 млн ₽', margin:'21%' },
      { name:'X5 East', profit:'3.9 млн ₽', margin:'19%' }
    ],
    insight:'Маржинальность держится выше 28%. Наибольший резерв роста сейчас в подряде и логистике.'
  },
  tender: {
    stats: [
      { label:'Подано', value:'164' },
      { label:'Выиграно', value:'49' },
      { label:'Win Rate', value:'29.8%' },
      { label:'Средняя сумма', value:'12.4 млн ₽' }
    ],
    months: [
      { label:'Янв', value:11 },{ label:'Фев', value:14 },{ label:'Мар', value:19 },{ label:'Апр', value:13 },
      { label:'Май', value:16 },{ label:'Июн', value:18 },{ label:'Июл', value:15 },{ label:'Авг', value:17 }
    ],
    people: [
      { name:'Дарья Карпова', win:'41%', amount:'68 млн ₽' },
      { name:'Ирина Свиридова', win:'35%', amount:'54 млн ₽' },
      { name:'Данил Мельников', win:'32%', amount:'47 млн ₽' }
    ],
    sites: [
      { name:'B2B-Center', share:46 },
      { name:'Закупки.ру', share:31 },
      { name:'Email / direct', share:23 }
    ]
  },
  pm: {
    stats: [
      { label:'РП в работе', value:'12' },
      { label:'Работ', value:'37' },
      { label:'Выручка/РП', value:'9.8 млн ₽' },
      { label:'Загрузка', value:'84%' }
    ],
    months: [
      { label:'Янв', value:72 },{ label:'Фев', value:76 },{ label:'Мар', value:81 },{ label:'Апр', value:77 },
      { label:'Май', value:83 },{ label:'Июн', value:85 },{ label:'Июл', value:80 },{ label:'Авг', value:88 }
    ],
    leads: [
      { name:'Роман Егоров', load:'92%', revenue:'14.2 млн ₽' },
      { name:'Марина Белова', load:'88%', revenue:'12.1 млн ₽' },
      { name:'Алексей Орлов', load:'86%', revenue:'11.4 млн ₽' }
    ]
  },
  map: [
    { name:'БЦ Prime', customer:'MR Group', status:'Активный', sum:'31 млн ₽', x:62, y:38, tone:'#0f6ad9' },
    { name:'ТРК Измайлово', customer:'ПИК', status:'Активный', sum:'24 млн ₽', x:41, y:57, tone:'#0b8457' },
    { name:'Лахта B2', customer:'Газпром', status:'Завершён', sum:'18 млн ₽', x:73, y:22, tone:'#ce4d2d' },
    { name:'LogiPark', customer:'X5', status:'Активный', sum:'27 млн ₽', x:28, y:32, tone:'#d4a843' }
  ],
  calendar: {
    month: 'Март 2026',
    days: [
      { d:1, out:true },{ d:2, out:true },{ d:3 },{ d:4 },{ d:5, type:'meet' },{ d:6 },{ d:7 },
      { d:8 },{ d:9, type:'pay' },{ d:10 },{ d:11 },{ d:12, type:'meet' },{ d:13, type:'task' },{ d:14 },
      { d:15 },{ d:16 },{ d:17 },{ d:18 },{ d:19, type:'meet' },{ d:20 },{ d:21 },
      { d:22 },{ d:23 },{ d:24 },{ d:25, type:'task' },{ d:26 },{ d:27 },{ d:28 },
      { d:29 },{ d:30 },{ d:31, type:'pay' },{ d:1, out:true },{ d:2, out:true },{ d:3, out:true },{ d:4, out:true }
    ],
    events: {
      5:[{ time:'11:00', title:'Планёрка Prime', tone:'#0f6ad9' }],
      9:[{ time:'15:00', title:'Выплата по ведомости №114', tone:'#ce4d2d' }],
      12:[{ time:'11:00', title:'Планёрка по Prime', tone:'#0f6ad9' },{ time:'16:00', title:'Финансы / март', tone:'#0b8457' }],
      13:[{ time:'09:30', title:'Сверка по тендерам', tone:'#d4a843' }],
      19:[{ time:'12:00', title:'Статус-митинг с ПИК', tone:'#0f6ad9' }],
      25:[{ time:'10:00', title:'Согласование подрядчика', tone:'#70738a' }],
      31:[{ time:'17:30', title:'Закрытие месяца', tone:'#ce4d2d' }]
    }
  }
};
function page(){ const d=el('div'); Object.assign(d.style,{minHeight:'100dvh',paddingBottom:'112px'}); return d; }
function wrap(){ const d=el('div'); Object.assign(d.style,{display:'flex',flexDirection:'column',gap:'12px',padding:'12px var(--sp-page) 0'}); return d; }
function pills(active='month'){ return M.FilterPills({ items: PERIODS.map(([label,value])=>({label,value})), active, onChange:()=>{} }); }
function statsGrid(items){ return M.Stats({ items: items.map(it=>({ label:it.label, value:it.value })) }); }
function ring(items){ const total=items.reduce((s,it)=>s+it.share,0)||1; const conic=items.map((it,idx)=>{
  const start=items.slice(0,idx).reduce((s,x)=>s+x.share,0)/total*360;
  const end=(items.slice(0,idx+1).reduce((s,x)=>s+x.share,0)/total*360);
  return `${it.color} ${start}deg ${end}deg`;
}).join(', ');
  const row=el('div'); Object.assign(row.style,{display:'grid',gridTemplateColumns:'96px 1fr',gap:'14px',alignItems:'center'});
  const chart=el('div'); Object.assign(chart.style,{width:'96px',height:'96px',borderRadius:'50%',background:`conic-gradient(${conic})`,position:'relative',boxShadow:'inset 0 0 0 1px rgba(255,255,255,.08)'});
  chart.appendChild(el('div',{style:{position:'absolute',inset:'18px',borderRadius:'50%',background:'var(--surface)',display:'grid',placeItems:'center',...DS.font('sm'),color:'var(--text-sec)'},textContent:'100%'}));
  row.appendChild(chart);
  const list=el('div'); Object.assign(list.style,{display:'flex',flexDirection:'column',gap:'10px'});
  items.forEach((it)=>{ const item=el('div'); Object.assign(item.style,{display:'grid',gridTemplateColumns:'10px 1fr auto',gap:'10px',alignItems:'center'}); item.appendChild(el('span',{style:{width:'10px',height:'10px',borderRadius:'50%',background:it.color}})); item.appendChild(el('div',{textContent:it.name,style:{...DS.font('sm'),color:'var(--text)'}})); item.appendChild(el('div',{textContent:`${it.share}% • ${it.sum}`,style:{...DS.font('xs'),color:'var(--text-sec)'}})); list.appendChild(item); });
  row.appendChild(list);
  return row;
}
function rankCard(title, rows, kind){
  const content=el('div'); Object.assign(content.style,{display:'flex',flexDirection:'column',gap:'12px'});
  rows.forEach((row,idx)=>{
    const item=el('div'); Object.assign(item.style,{display:'flex',flexDirection:'column',gap:'8px',padding:'12px',border:'1px solid var(--border)',borderRadius:'16px',background:'var(--surface-alt)'});
    const top=el('div'); Object.assign(top.style,{display:'flex',justifyContent:'space-between',gap:'10px',alignItems:'center'});
    top.appendChild(el('div',{textContent:`${idx+1}. ${row.name}`,style:{...DS.font('md'),color:'var(--text)'}}));
    top.appendChild(M.Badge({ text: row.value || row.win || row.load, color:'info', variant:'soft' }));
    item.appendChild(top);
    if(kind==='progress') item.appendChild(M.ProgressBar({ value: row.progress || parseInt(row.value,10) || 0, color:'var(--blue)' }));
    item.appendChild(el('div',{textContent:row.sum || row.amount || row.revenue || '',style:{...DS.font('xs'),color:'var(--text-sec)'}}));
    content.appendChild(item);
  });
  return M.Section({ title, content });
}
function ObjectMapPage(){
  const root=page(); root.appendChild(M.Header({ title:'Карта объектов', subtitle:'АНАЛИТИКА', back:true, backHref:'/home' }));
  const body=wrap(); body.appendChild(M.FilterPills({ items:[{label:'Все',value:'all'},{label:'Активные',value:'active'},{label:'Завершённые',value:'done'}], active:'all', onChange:()=>{} }));
  const map=el('div'); Object.assign(map.style,{position:'relative',height:'58dvh',borderRadius:'26px',overflow:'hidden',background:'linear-gradient(180deg,#d8e8f7 0%,#cbd8e2 45%,#bfd3c3 100%)',boxShadow:'var(--shadow)',border:'1px solid rgba(15,106,217,.12)'});
  map.appendChild(el('div',{style:{position:'absolute',inset:'0',background:'radial-gradient(circle at 30% 30%, rgba(255,255,255,.65), transparent 36%), linear-gradient(90deg, rgba(255,255,255,.18) 1px, transparent 1px), linear-gradient(rgba(255,255,255,.16) 1px, transparent 1px)',backgroundSize:'auto, 56px 56px, 56px 56px'}}));
  ANALYTICS.map.forEach((it)=>{ const pin=el('button',{type:'button'}); Object.assign(pin.style,{position:'absolute',left:`${it.x}%`,top:`${it.y}%`,transform:'translate(-50%,-50%)',width:'20px',height:'20px',borderRadius:'50%',border:'3px solid rgba(255,255,255,.95)',background:it.tone,boxShadow:'0 12px 24px rgba(0,0,0,.18)',cursor:'pointer'}); pin.addEventListener('click',()=>{ const card=el('div'); card.appendChild(M.Card({ title:it.name, subtitle:it.customer, badge:it.status, badgeColor:it.status==='Активный'?'success':'warning', fields:[{label:'Сумма',value:it.sum}] })); M.BottomSheet({ title:'Объект', content:card }); }); map.appendChild(pin); });
  body.appendChild(map);
  body.appendChild(M.Section({ title:'Объекты', content:M.List({ items:ANALYTICS.map, divider:false, renderItem:(it)=>M.Card({ title:it.name, subtitle:it.customer, badge:it.status, badgeColor:it.status==='Активный'?'success':'warning', fields:[{label:'Сумма', value:it.sum}] }) }) }));
  root.appendChild(body); return root;
}
function CalendarPage(){
  const root=page(); root.appendChild(M.Header({ title:'Календарь', subtitle:'ВСТРЕЧИ', back:true, backHref:'/home' }));
  const body=wrap();
  const search=el('input',{type:'search',placeholder:'Поиск по событиям'}); Object.assign(search.style,{width:'100%',height:'44px',padding:'0 14px',borderRadius:'14px',border:'1px solid var(--border)',background:'var(--surface-alt)',color:'var(--text)',outline:'none'}); body.appendChild(search);
  const top=el('div'); Object.assign(top.style,{display:'flex',justifyContent:'space-between',alignItems:'center',gap:'12px'});
  top.appendChild(M.Badge({ text:'←', color:'info', variant:'soft' }));
  top.appendChild(el('div',{textContent:ANALYTICS.calendar.month,style:{...DS.font('lg'),color:'var(--text)',fontWeight:'700'}}));
  top.appendChild(M.Badge({ text:'→', color:'info', variant:'soft' }));
  body.appendChild(top);
  const week=el('div'); Object.assign(week.style,{display:'grid',gridTemplateColumns:'repeat(7,1fr)',gap:'8px',padding:'0 2px'}); ['Пн','Вт','Ср','Чт','Пт','Сб','Вс'].forEach((d)=>week.appendChild(el('div',{textContent:d,style:{...DS.font('xs'),color:'var(--text-sec)',textAlign:'center'}}))); body.appendChild(week);
  const grid=el('div'); Object.assign(grid.style,{display:'grid',gridTemplateColumns:'repeat(7,1fr)',gap:'8px'});
  const openDay=(day)=>{ const events=(ANALYTICS.calendar.events[day]||[]).filter((ev)=>!search.value || ev.title.toLowerCase().includes(search.value.toLowerCase())); const content=el('div'); Object.assign(content.style,{display:'flex',flexDirection:'column',gap:'10px'}); if(!events.length) content.appendChild(M.Empty({ title:'Событий нет', text:'На этот день ничего не запланировано.' })); else events.forEach((ev)=>content.appendChild(M.Card({ title:ev.title, subtitle:ev.time, badge:'Событие', badgeColor:'info' }))); M.BottomSheet({ title:`${day} марта`, content }); };
  ANALYTICS.calendar.days.forEach((it)=>{ const day=el('button',{type:'button'}); Object.assign(day.style,{aspectRatio:'1 / 1',border:'1px solid var(--border)',borderRadius:'18px',background:it.d===12&&!it.out?'rgba(214,43,62,.12)':'var(--surface)',color:it.out?'var(--text-tert)':'var(--text)',position:'relative',cursor:'pointer'}); day.appendChild(el('span',{textContent:String(it.d),style:{...DS.font('sm')}})); if(it.type&&!it.out){ day.appendChild(el('span',{style:{position:'absolute',left:'50%',bottom:'8px',transform:'translateX(-50%)',width:'6px',height:'6px',borderRadius:'50%',background:it.type==='meet'?'#0f6ad9':it.type==='pay'?'#ce4d2d':'#d4a843'}})); } if(!it.out) day.addEventListener('click',()=>openDay(it.d)); grid.appendChild(day); });
  body.appendChild(grid); root.appendChild(body); return root;
}
function chartSection(title,data,dual){ return M.Section({ title, content:M.BarChart({ data, opts: dual ? { dual:true,height:150 } : { height:150,color:'var(--blue)' } }) }); }
function trendSection(title,data){ return M.Section({ title, content:M.MiniChart({ data, opts:{ color:'var(--blue)', height:40 } }) }); }
function kpiPage(title, subtitle, hero, stats, sections){ const root=page(); root.appendChild(M.Header({ title, subtitle, back:true, backHref:'/home' })); const body=wrap(); body.appendChild(pills()); body.appendChild(hero); body.appendChild(statsGrid(stats)); sections.forEach((s)=>body.appendChild(s)); root.appendChild(body); return root; }
const KPIWorksPage = { render(){ return kpiPage('KPI Работ','АНАЛИТИКА', M.HeroCard({ label:'Производительность', value:'91%', details:[{label:'Завершение в срок', value:'96%'},{label:'Просадка', value:'4 объекта'}], tone:'blue' }), ANALYTICS.works.stats, [ rankCard('По РП', ANALYTICS.works.pms, 'progress'), chartSection('По месяцам', ANALYTICS.works.months), trendSection('Тренд', ANALYTICS.works.trend) ]); } };
const KPIMoneyPage = { render(){ return kpiPage('KPI Финансы','АНАЛИТИКА', M.HeroCard({ label:'Маржинальность', value:'28.9%', details:[{label:'Прибыль', value:'34.3 млн ₽'},{label:'ROI', value:'40.7%'}], tone:'green' }), ANALYTICS.money.stats, [ chartSection('Доходы vs расходы', ANALYTICS.money.bars, true), M.Section({ title:'По направлениям', content:ring(ANALYTICS.money.dirs) }), M.Section({ title:'Топ-5 объектов по прибыли', content:M.List({ items:ANALYTICS.money.objects, divider:false, renderItem:(it)=>M.Card({ title:it.name, badge:it.margin, badgeColor:'success', fields:[{label:'Прибыль',value:it.profit}] }) }) }), M.MimirBanner({ title:'AI-инсайт', text:ANALYTICS.money.insight }) ]); } };
const TOAnalyticsPage = { render(){ return kpiPage('Хроники','ТЕНДЕРНЫЙ ОТДЕЛ', M.HeroCard({ label:'Win Rate', value:'29.8%', details:[{label:'Выиграно', value:'49'},{label:'Средняя сумма', value:'12.4 млн ₽'}], tone:'gold' }), ANALYTICS.tender.stats, [ chartSection('Тендеры по месяцам', ANALYTICS.tender.months), rankCard('По специалистам', ANALYTICS.tender.people, 'plain'), M.Section({ title:'По площадкам', content:M.List({ items:ANALYTICS.tender.sites, divider:false, renderItem:(it)=>M.Card({ title:it.name, badge:`${it.share}%`, badgeColor:'info' }) }) }) ]); } };
const PMAnalyticsPage = { render(){ return kpiPage('Хроники РП','АНАЛИТИКА', M.HeroCard({ label:'Загрузка руководителей', value:'84%', details:[{label:'Активных РП', value:'12'},{label:'Работ', value:'37'}], tone:'blue' }), ANALYTICS.pm.stats, [ chartSection('Загрузка по месяцам', ANALYTICS.pm.months), rankCard('Лидеры по РП', ANALYTICS.pm.leads, 'plain'), trendSection('Тренд выручки', [6.8,7.4,7.9,8.6,8.3,8.9,9.1,9.8,10.2,10.7,11.1,11.6]) ]); } };
if(window.Router && Router.register){
  Router.register('/kpi-works', KPIWorksPage);
  Router.register('/kpi-money', KPIMoneyPage);
  Router.register('/to-analytics', TOAnalyticsPage);
  Router.register('/pm-analytics', PMAnalyticsPage);
  Router.register('/object-map', ObjectMapPage);
  Router.register('/calendar', CalendarPage);
}
window.KPIWorksPage = KPIWorksPage;
window.KPIMoneyPage = KPIMoneyPage;
window.TOAnalyticsPage = TOAnalyticsPage;
window.PMAnalyticsPage = PMAnalyticsPage;
window.ObjectMapPage = ObjectMapPage;
window.CalendarPage = CalendarPage;
})();