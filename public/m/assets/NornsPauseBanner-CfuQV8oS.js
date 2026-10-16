import{t as e}from"./vendor-react-CmkcTfyZ.js";var t=e(),n=`Обновление призов`,r=`Список призов обновляется: еда, мерч и выходные на паузе. Уже оформленное — выдадим. Скоро новые призы.`,i={title:`Залы Норн обновляются`,body:[`Пока собираем новый список призов, временно не разыгрываем еду, одежду, мерч, выходной и выбор смены.`,`Всё, что вы уже выиграли и оформили на выдачу — отдадим как положено. Ничего не сгорает.`,`Сейчас на Колесе — руны, облик воина, рамки и бусты. Скоро вернёмся с новыми крутыми призами.`]},a=`
.norns-pause-strip{
  margin:8px 16px 0;padding:10px 12px;border-radius:14px;
  background:linear-gradient(135deg,rgba(240,200,80,.12),rgba(165,110,255,.08));
  border:1px solid rgba(240,200,80,.28);
  display:flex;gap:10px;align-items:flex-start;
}
.norns-pause-strip-icon{font-size:18px;line-height:1.2;flex-shrink:0}
.norns-pause-strip-text{font-size:12px;line-height:1.4;color:rgba(255,255,255,.78);font-weight:600}
.norns-pause-modal-backdrop{
  position:fixed;inset:0;z-index:200;background:rgba(0,0,0,.72);
  display:flex;align-items:flex-end;justify-content:center;
  padding:16px;padding-bottom:max(env(safe-area-inset-bottom),16px);
}
.norns-pause-modal{
  width:100%;max-width:420px;border-radius:22px;padding:20px 18px 16px;
  background:linear-gradient(180deg,#1a2040,#121628);
  border:1px solid rgba(240,200,80,.3);
  box-shadow:0 20px 50px rgba(0,0,0,.55);
}
.norns-pause-modal-title{font-size:17px;font-weight:800;color:#F0C850;margin-bottom:10px}
.norns-pause-modal-body{font-size:13px;line-height:1.45;color:rgba(255,255,255,.78);margin-bottom:8px}
.norns-pause-modal-btn{
  margin-top:12px;width:100%;padding:14px;border:none;border-radius:14px;
  font-size:15px;font-weight:800;color:#1a1000;cursor:pointer;
  background:linear-gradient(135deg,#C8940A,#F0C850);
}
`;function o({text:e=r,style:n,onClick:i}){return(0,t.jsxs)(t.Fragment,{children:[(0,t.jsx)(`style`,{children:a}),(0,t.jsxs)(`div`,{className:`norns-pause-strip`,style:{cursor:i?`pointer`:void 0,...n},role:i?`button`:`status`,onClick:i,children:[(0,t.jsx)(`span`,{className:`norns-pause-strip-icon`,"aria-hidden":!0,children:`ᚱ`}),(0,t.jsx)(`div`,{className:`norns-pause-strip-text`,children:e})]})]})}function s({open:e,onClose:n,title:r=i.title,body:o=i.body}){if(!e)return null;let s=Array.isArray(o)?o:[o];return(0,t.jsxs)(t.Fragment,{children:[(0,t.jsx)(`style`,{children:a}),(0,t.jsx)(`div`,{className:`norns-pause-modal-backdrop`,onClick:n,role:`presentation`,children:(0,t.jsxs)(`div`,{className:`norns-pause-modal`,role:`dialog`,"aria-modal":`true`,"aria-labelledby":`norns-pause-title`,onClick:e=>e.stopPropagation(),children:[(0,t.jsx)(`div`,{className:`norns-pause-modal-title`,id:`norns-pause-title`,children:r}),s.map((e,n)=>(0,t.jsx)(`p`,{className:`norns-pause-modal-body`,children:e},n)),(0,t.jsx)(`button`,{type:`button`,className:`norns-pause-modal-btn`,onClick:n,children:`Понятно`})]})})]})}var c=`norns_pause_modal_seen_v1`;function l(){try{return!sessionStorage.getItem(c)}catch{return!0}}function u(){try{sessionStorage.setItem(c,`1`)}catch{}}export{u as a,i,o as n,l as o,n as r,s as t};