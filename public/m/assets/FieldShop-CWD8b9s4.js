import{a as e}from"./rolldown-runtime-COnpUsM8.js";import{t}from"./vendor-react-MND8CZ4K.js";import{ei as n}from"./vendor-icons-177gZrnq.js";import{s as r}from"./vendor-router-BiJFzTT3.js";import{p as i}from"./index-Bv5uu42r.js";import{r as a,t as o}from"./VikingAvatar3D-B36T2W9F.js";import{n as s}from"./NornsPauseBanner-C1i6034x.js";var c=e(n(),1),l=t(),u=3,d=0,f=[];function p(){return new Promise(e=>{if(d<u){d+=1,e();return}f.push(e)})}function m(){d=Math.max(0,d-1);let e=f.shift();e&&(d+=1,e())}function h({assets:e={},cosmetics:t={},overrides:n={},level:r=1,size:i=96,fallback:s=null,onFail:u}){let d=(0,c.useRef)(null),f=(0,c.useRef)(!1),[h,g]=(0,c.useState)(!1),[_,v]=(0,c.useState)(!1),[y,b]=(0,c.useState)(!1),x=a();return(0,c.useEffect)(()=>{let e=d.current;if(!e)return;let t=new IntersectionObserver(([e])=>g(!!e?.isIntersecting),{rootMargin:`120px`,threshold:.05});return t.observe(e),()=>t.disconnect()},[]),(0,c.useEffect)(()=>{let e=!1;if(!x||!h){f.current&&=(m(),!1),v(!1);return}return p().then(()=>{if(e){m();return}f.current=!0,v(!0)}),()=>{e=!0,f.current&&=(m(),!1),v(!1)}},[h,x]),(0,l.jsx)(`div`,{ref:d,style:{width:i,height:i,display:`flex`,alignItems:`center`,justifyContent:`center`,borderRadius:14,overflow:`hidden`,background:`radial-gradient(circle at 50% 30%,rgba(240,200,80,.1),transparent 70%)`},children:y?s||(0,l.jsx)(`div`,{style:{width:i*.55,height:i*.55,borderRadius:`50%`,background:`rgba(240,200,80,.12)`,border:`1px solid rgba(240,200,80,.3)`}}):_?(0,l.jsx)(o,{assets:e,cosmetics:t,overrides:n,level:r,size:i,interactive:!1,transparentBg:!0,mood:`idle`,onFail:()=>{b(!0),u?.()}}):(0,l.jsx)(`div`,{style:{width:i*.35,height:i*.35,borderRadius:`50%`,border:`2px solid rgba(240,200,80,.35)`,borderTopColor:`transparent`,animation:`fshopSpin .8s linear infinite`}})})}var g={helmet:`Шлем`,weapon:`Оружие`,armor:`Броня`,cape:`Плащ`,boots:`Сапоги`,face_paint:`Раскраска`,avatar:`Облик`,frame:`Рамка профиля`,theme:`Тема профиля`,badge:`Бейдж профиля`};function _(e){if(!e?.asset_key||!e?.equip_slot)return{};let t={helmet:`helmet`,weapon:`weapon`,armor:`armor`,cape:`cape`,boots:`boots`,face_paint:`face_paint`,avatar:`body`}[e.equip_slot];return t?{[t]:e.asset_key}:{}}function v(e){return e?.wear_target===`avatar3d`||[`helmet`,`weapon`,`armor`,`cape`,`boots`,`face_paint`,`avatar`].includes(e?.equip_slot)}var y={legendary:`ЛЕГЕНДА`,epic:`ЭПИК`,rare:`РЕДКИЙ`,common:`ОБЫЧНЫЙ`},b={legendary:`ЛЕГЕНДАРНЫЙ`,epic:`ЭПИЧЕСКИЙ`,rare:`РЕДКИЙ`,common:`ОБЫЧНЫЙ`},x=[{key:`all`,icon:`🏪`,label:`Все`},{key:`digital`,icon:`🎨`,label:`Цифровое`},{key:`cosmetic`,icon:`✨`,label:`Косметика`}],ee={all:`Все товары`,digital:`Цифровое`,cosmetic:`Косметика`};function te(e,t){return t[e%10==1&&e%100!=11?0:e%10>=2&&e%10<=4&&(e%100<10||e%100>=20)?1:2]}var ne=class{constructor(e,t){this.x=e,this.y=t,this.w=4+Math.random()*4,this.h=8+Math.random()*6,this.vx=(Math.random()-.5)*8,this.vy=-6-Math.random()*8,this.rot=Math.random()*360,this.rv=(Math.random()-.5)*12,this.c=[`var(--value)`,`color-mix(in oklab, var(--value) 45%, var(--text-primary))`,`var(--danger)`,`var(--acc)`,`var(--acc)`,`var(--ok)`,`#FF8A8A`][Math.floor(Math.random()*7)],this.life=120+Math.random()*60,this.ml=this.life}update(){this.vy+=.15,this.vx*=.99,this.x+=this.vx,this.y+=this.vy,this.rot+=this.rv,this.life--}draw(e){let t=Math.max(0,this.life/this.ml);e.save(),e.translate(this.x,this.y),e.rotate(this.rot*Math.PI/180),e.globalAlpha=t,e.fillStyle=this.c,e.fillRect(-this.w/2,-this.h/2,this.w,this.h),e.restore()}};function S(){let e=r(),t=(0,c.useRef)(null),n=(0,c.useRef)(null),u=(0,c.useRef)([]),d=(0,c.useRef)(!1),f=(0,c.useRef)(null),[p,m]=(0,c.useState)(0),[S,w]=(0,c.useState)([]),[T,re]=(0,c.useState)(`all`),[E,D]=(0,c.useState)(null),[O,k]=(0,c.useState)(!1),[A,j]=(0,c.useState)(!1),[M,N]=(0,c.useState)(null),[P,F]=(0,c.useState)(!0),[I,ie]=(0,c.useState)({}),[L,ae]=(0,c.useState)({}),[R,z]=(0,c.useState)(1),[B,oe]=(0,c.useState)(!1),V=(0,c.useMemo)(()=>!B&&a(),[B]),H=(0,c.useCallback)(()=>oe(!0),[]);(0,c.useEffect)(()=>{Promise.all([i.get(`/gamification/wallet`).catch(()=>({runes:0,level:1})),i.get(`/gamification/shop`).catch(()=>({items:[]})),i.get(`/worker/me`).catch(()=>null)]).then(([e,t,n])=>{m(e.runes||0),z(e.level||1),w((t.items||[]).map(e=>{let t=e.unlimited===!0||e.current_stock==null||[`digital`,`cosmetic`].includes(e.category);return{...e,rarity:e.rarity||`common`,stock:t?9999:e.current_stock??e.stock??0,unlimited:t,limited:t?!1:e.is_limited||e.limited||!1}})),n&&(ie(n.assets||{}),ae({active_avatar:n.active_avatar,active_frame:n.active_frame,active_badge:n.active_badge,active_theme:n.active_theme,active_helmet:n.active_helmet,active_weapon:n.active_weapon,active_armor:n.active_armor}),n.level&&z(n.level))}).finally(()=>F(!1))},[]),(0,c.useEffect)(()=>{let e=t.current;if(!e)return;let n=()=>{e.width=innerWidth*devicePixelRatio,e.height=innerHeight*devicePixelRatio,e.getContext(`2d`).setTransform(devicePixelRatio,0,0,devicePixelRatio,0,0)};return n(),window.addEventListener(`resize`,n),()=>window.removeEventListener(`resize`,n)},[]);let U=(0,c.useCallback)(()=>{n.current||=new(window.AudioContext||window.webkitAudioContext)},[]);(0,c.useEffect)(()=>{let e=()=>U();return document.addEventListener(`touchstart`,e,{once:!0}),document.addEventListener(`click`,e,{once:!0}),()=>{document.removeEventListener(`touchstart`,e),document.removeEventListener(`click`,e)}},[U]);let W=(0,c.useCallback)(e=>{navigator.vibrate&&navigator.vibrate(e)},[]),G=(0,c.useCallback)(()=>{U();let e=n.current;e&&[523,659,784].forEach((t,n)=>{let r=e.createOscillator(),i=e.createGain();r.connect(i),i.connect(e.destination),r.frequency.value=t,r.type=`sine`,i.gain.value=.06,i.gain.exponentialRampToValueAtTime(.001,e.currentTime+.15*(n+1)+.3),r.start(e.currentTime+.12*n),r.stop(e.currentTime+.15*(n+1)+.3)})},[U]),K=(0,c.useCallback)(()=>{let e=innerWidth/2,n=innerHeight/3;for(let t=0;t<60;t++)u.current.push(new ne(e,n));if(!d.current){d.current=!0;let e=()=>{let n=t.current;if(!n){d.current=!1;return}let r=n.getContext(`2d`);r.clearRect(0,0,n.width/devicePixelRatio,n.height/devicePixelRatio),u.current=u.current.filter(e=>e.life>0),u.current.forEach(e=>{e.update(),e.draw(r)}),u.current.length?requestAnimationFrame(e):d.current=!1};e()}},[]),q=(0,c.useCallback)((e,t)=>{let n=f.current;if(!n)return;let r=performance.now(),i=a=>{let o=Math.min((a-r)/600,1),s=1-(1-o)**3;n.textContent=Math.round(e+(t-e)*s).toLocaleString(`ru`),o<1&&requestAnimationFrame(i)};requestAnimationFrame(i)},[]),J=(0,c.useCallback)(e=>{!e||e.stock<=0||(D(e),k(!0),W([20]))},[W]),Y=(0,c.useCallback)(()=>{k(!1),setTimeout(()=>D(null),300)},[]),se=(0,c.useCallback)(async()=>{if(!E||p<E.price_runes)return;let e=E,t=p,n=t-e.price_runes;m(n),w(t=>t.map(t=>t.id===e.id?{...t,stock:t.stock-1}:t)),q(t,n),Y();try{await i.post(`/gamification/shop/buy`,{item_id:e.id})}catch{m(t),w(t=>t.map(t=>t.id===e.id?{...t,stock:t.stock+1}:t));return}setTimeout(()=>{N(e),j(!0),W([30,20,50]),K(),G()},400)},[E,p,q,Y,W,K,G]),X=(0,c.useCallback)(()=>{j(!1),setTimeout(()=>N(null),300)},[]),Z=(0,c.useMemo)(()=>T===`all`?S:S.filter(e=>e.category===T),[S,T]),ce=(0,c.useMemo)(()=>{let e={all:S.length,digital:0,cosmetic:0};return S.forEach(t=>{e[t.category]!==void 0&&e[t.category]++}),e},[S]),Q=(0,c.useMemo)(()=>S.find(e=>e.limited&&e.stock>0)||S[0],[S]);if(P)return(0,l.jsxs)(l.Fragment,{children:[(0,l.jsx)(`style`,{children:C}),(0,l.jsx)(`div`,{className:`fshop`,children:(0,l.jsx)(`div`,{className:`fshop-page`,style:{padding:`60px 16px`},children:[1,2,3,4,5,6].map(e=>(0,l.jsx)(`div`,{className:`fshop-skeleton`,style:{height:180,borderRadius:16,marginBottom:10,background:`linear-gradient(90deg, var(--field-card) 25%, var(--bg-surface-alt) 50%, var(--field-card) 75%)`,backgroundSize:`200% 100%`,animation:`fshop-shimmer 1.5s infinite`}},e))})})]});let $=E?p>=E.price_runes:!1,le=E?p-E.price_runes:0;return(0,l.jsxs)(l.Fragment,{children:[(0,l.jsx)(`style`,{children:C}),(0,l.jsxs)(`div`,{className:`fshop`,children:[(0,l.jsxs)(`div`,{className:`fshop-bg`,children:[(0,l.jsx)(`div`,{className:`fshop-bg-glow g1`}),(0,l.jsx)(`div`,{className:`fshop-bg-glow g2`}),(0,l.jsx)(`div`,{className:`fshop-bg-glow g3`})]}),(0,l.jsx)(`canvas`,{ref:t,className:`fshop-confetti`}),(0,l.jsxs)(`div`,{className:`fshop-page`,children:[(0,l.jsxs)(`div`,{className:`fshop-top`,children:[(0,l.jsx)(`div`,{className:`fshop-top-back`,onClick:()=>e(-1),children:(0,l.jsx)(`svg`,{viewBox:`0 0 24 24`,width:`20`,height:`20`,fill:`none`,stroke:`color-mix(in oklab, var(--text-primary) 70%, transparent)`,strokeWidth:`2.2`,strokeLinecap:`round`,children:(0,l.jsx)(`path`,{d:`M15 18l-6-6 6-6`})})}),(0,l.jsxs)(`div`,{className:`fshop-top-center`,children:[(0,l.jsx)(`div`,{className:`fshop-top-title`,children:`МАГАЗИН АСГАРДА`}),(0,l.jsx)(`div`,{className:`fshop-top-sub`,children:`ТРАТЬ РУНЫ С УМОМ`})]}),(0,l.jsxs)(`div`,{className:`fshop-wallet`,children:[(0,l.jsx)(`div`,{className:`fshop-wallet-coin`,children:`ᚱ`}),(0,l.jsx)(`span`,{className:`fshop-wallet-num`,ref:f,children:(p||0).toLocaleString(`ru`)})]})]}),(0,l.jsx)(s,{}),Q&&(0,l.jsxs)(`div`,{className:`fshop-banner`,onClick:()=>J(Q),children:[Q.limited&&(0,l.jsx)(`div`,{className:`fshop-banner-tag`,children:`ЛИМИТКА`}),(0,l.jsxs)(`div`,{className:`fshop-banner-row`,children:[(0,l.jsx)(`div`,{className:`fshop-banner-icon`,style:{width:88,height:88,flexShrink:0},children:V&&v(Q)?(0,l.jsx)(h,{assets:I,cosmetics:L,overrides:_(Q),level:R,size:88,onFail:H,fallback:Q.icon_svg?(0,l.jsx)(`span`,{className:`fshop-svg-icon`,dangerouslySetInnerHTML:{__html:Q.icon_svg}}):(0,l.jsx)(`span`,{style:{fontSize:40},children:Q.icon})}):V?(0,l.jsx)(h,{assets:I,cosmetics:L,overrides:{},level:R,size:88,onFail:H,fallback:Q.icon_svg?(0,l.jsx)(`span`,{className:`fshop-svg-icon`,dangerouslySetInnerHTML:{__html:Q.icon_svg}}):(0,l.jsx)(`span`,{style:{fontSize:40},children:Q.icon})}):Q.icon_svg?(0,l.jsx)(`span`,{className:`fshop-svg-icon`,dangerouslySetInnerHTML:{__html:Q.icon_svg}}):Q.icon}),(0,l.jsxs)(`div`,{className:`fshop-banner-text`,children:[(0,l.jsx)(`div`,{className:`fshop-banner-title`,children:Q.name}),(0,l.jsxs)(`div`,{className:`fshop-banner-desc`,children:[Q.description,Q.stock<10&&!Q.unlimited?` Осталось ${Q.stock} шт.`:``]})]})]})]}),(0,l.jsx)(`div`,{className:`fshop-cats`,children:x.map(e=>(0,l.jsxs)(`button`,{className:`fshop-cat-btn${T===e.key?` active`:``}`,onClick:()=>{re(e.key),W([15])},children:[(0,l.jsx)(`span`,{className:`fshop-cat-icon`,children:e.icon}),e.label,(0,l.jsx)(`span`,{className:`fshop-cat-count`,children:ce[e.key]})]},e.key))}),(0,l.jsxs)(`div`,{className:`fshop-section-head`,children:[(0,l.jsx)(`div`,{className:`fshop-section-title`,children:ee[T]}),(0,l.jsxs)(`div`,{className:`fshop-section-count`,children:[Z.length,` `,te(Z.length,[`товар`,`товара`,`товаров`])]})]}),(0,l.jsx)(`div`,{className:`fshop-grid`,children:Z.length===0?(0,l.jsxs)(`div`,{className:`fshop-empty`,style:{gridColumn:`1/-1`},children:[(0,l.jsx)(`div`,{className:`fshop-empty-icon`,children:`🪶`}),(0,l.jsx)(`div`,{className:`fshop-empty-text`,children:`Пусто... пока`})]}):Z.map(e=>{let t=p>=e.price_runes,n=!e.unlimited&&e.stock<=0,r=e.price_runes-p;return(0,l.jsxs)(`div`,{className:[`fshop-card`,e.category,!t&&!n?`locked`:``,n?`soldout`:``].filter(Boolean).join(` `),onClick:()=>!n&&J(e),children:[(0,l.jsxs)(`div`,{className:`fshop-card-img`,children:[(0,l.jsx)(`div`,{className:`fshop-card-glow`}),(0,l.jsx)(`div`,{className:`fshop-card-icon fshop-card-3d`,children:V?(0,l.jsx)(h,{assets:I,cosmetics:L,overrides:v(e)?_(e):{},level:R,size:104,onFail:H,fallback:e.icon_svg?(0,l.jsx)(`span`,{className:`fshop-svg-icon`,dangerouslySetInnerHTML:{__html:e.icon_svg}}):(0,l.jsx)(`span`,{style:{fontSize:40},children:e.icon})}):e.icon_svg?(0,l.jsx)(`span`,{className:`fshop-svg-icon`,dangerouslySetInnerHTML:{__html:e.icon_svg}}):(0,l.jsx)(`span`,{style:{fontSize:40},children:e.icon})}),(0,l.jsx)(`div`,{className:`fshop-card-rarity ${e.rarity}`,children:y[e.rarity]}),e.limited&&!e.unlimited&&(0,l.jsx)(`div`,{className:`fshop-card-limited`,children:`ЛИМИТКА`})]}),n&&(0,l.jsx)(`div`,{className:`fshop-card-soldout-badge`,children:`РАСКУПЛЕНО`}),(0,l.jsxs)(`div`,{className:`fshop-card-body`,children:[(0,l.jsx)(`div`,{className:`fshop-card-name`,children:e.name}),(0,l.jsx)(`div`,{className:`fshop-card-desc`,children:e.wear_label||g[e.equip_slot]||e.description}),(0,l.jsxs)(`div`,{className:`fshop-card-price-row`,children:[(0,l.jsxs)(`div`,{className:`fshop-card-price`,children:[(0,l.jsx)(`span`,{className:`fshop-cp-coin`,children:`ᚱ`}),(0,l.jsx)(`span`,{className:`fshop-cp-num`,children:(e.price_runes||0).toLocaleString(`ru`)})]}),(0,l.jsx)(`button`,{className:`fshop-card-buy${t&&!n?` can`:``}`,children:n?`Нет`:`Купить`})]}),!t&&!n&&(0,l.jsxs)(`div`,{className:`fshop-card-deficit`,children:[(0,l.jsxs)(`svg`,{viewBox:`0 0 24 24`,width:`10`,height:`10`,fill:`none`,stroke:`var(--danger)`,strokeWidth:`2.5`,strokeLinejoin:`round`,children:[(0,l.jsx)(`path`,{d:`M12 2L2 22h20L12 2z`}),(0,l.jsx)(`path`,{d:`M12 9v4M12 17h.01`})]}),`Не хватает `,r>0?r.toLocaleString(`ru`):0,` ᚱ`]})]})]},e.id)})})]}),(0,l.jsx)(`div`,{className:`fshop-modal-ov${O?` on`:``}`,onClick:Y}),(0,l.jsx)(`div`,{className:`fshop-modal${O?` on`:``}`,children:(0,l.jsxs)(`div`,{className:`fshop-modal-card`,children:[(0,l.jsx)(`div`,{className:`fshop-modal-handle`}),E&&(0,l.jsxs)(l.Fragment,{children:[(0,l.jsxs)(`div`,{className:`fshop-modal-icon-area`,children:[(0,l.jsx)(`div`,{className:`fshop-modal-glow ${E.category}`}),(0,l.jsx)(`div`,{className:`fshop-modal-emoji`,style:{fontSize:0,minHeight:160},children:V?(0,l.jsx)(o,{assets:I,cosmetics:L,overrides:v(E)?_(E):{},level:R,size:160,interactive:!1,transparentBg:!0,mood:`idle`,onFail:H}):E.icon_svg?(0,l.jsx)(`span`,{className:`fshop-svg-icon fshop-svg-icon--lg`,dangerouslySetInnerHTML:{__html:E.icon_svg}}):(0,l.jsx)(`span`,{style:{fontSize:64},children:E.icon})},E.id)]}),(0,l.jsxs)(`div`,{style:{textAlign:`center`},children:[(0,l.jsx)(`div`,{className:`fshop-modal-rarity ${E.rarity}`,children:b[E.rarity]}),(E.wear_label||g[E.equip_slot])&&(0,l.jsx)(`div`,{style:{fontSize:11,fontWeight:700,color:`color-mix(in oklab, var(--value) 85%, transparent)`,marginBottom:4},children:E.wear_label||g[E.equip_slot]}),[`badge`,`frame`,`theme`].includes(E.equip_slot)&&(0,l.jsxs)(`div`,{style:{fontSize:12,fontWeight:600,color:`color-mix(in oklab, var(--text-primary) 65%, transparent)`,background:`color-mix(in oklab, var(--value) 8%, transparent)`,border:`1px solid color-mix(in oklab, var(--value) 25%, transparent)`,borderRadius:10,padding:`8px 12px`,margin:`0 0 10px`,lineHeight:1.35},children:[`Это оформление профиля — смотри на карточке воина в разделе «Профиль»`,E.equip_slot===`badge`?` (значок справа внизу у аватара)`:``,E.equip_slot===`frame`?` (рунный обод вокруг аватара)`:``,E.equip_slot===`theme`?` (цвета фона профиля)`:``,`.`]}),(0,l.jsx)(`div`,{className:`fshop-modal-name`,children:E.name}),(0,l.jsxs)(`div`,{className:`fshop-modal-desc`,children:[E.description,E.limited&&!E.unlimited?`\n\nОсталось: ${E.stock} шт.`:``]}),(0,l.jsxs)(`div`,{className:`fshop-modal-price-box`,children:[(0,l.jsx)(`div`,{className:`fshop-mpb-coin`,children:`ᚱ`}),(0,l.jsx)(`span`,{className:`fshop-mpb-num`,children:(E.price_runes||0).toLocaleString(`ru`)})]}),(0,l.jsx)(`div`,{className:`fshop-modal-balance`,children:$?(0,l.jsxs)(l.Fragment,{children:[`После покупки: `,(0,l.jsxs)(`b`,{children:[(le||0).toLocaleString(`ru`),` ᚱ`]})]}):(0,l.jsxs)(`span`,{style:{color:`var(--fshop-red)`},children:[`Не хватает `,((E.price_runes||0)-p).toLocaleString(`ru`),` ᚱ`]})}),(0,l.jsx)(`button`,{className:`fshop-modal-confirm`,style:{opacity:$?1:.35,pointerEvents:$?`auto`:`none`},onClick:se,children:$?`Купить за ${(E.price_runes||0).toLocaleString(`ru`)} ᚱ`:`Недостаточно рун`}),(0,l.jsx)(`button`,{className:`fshop-modal-cancel`,onClick:Y,children:`Отмена`})]})]})]})}),(0,l.jsx)(`div`,{className:`fshop-success-ov${A?` on`:``}`,onClick:X}),(0,l.jsx)(`div`,{className:`fshop-success-modal${A?` on`:``}`,children:(0,l.jsxs)(`div`,{className:`fshop-success-card`,children:[(0,l.jsx)(`div`,{className:`fshop-success-check`,children:(0,l.jsx)(`svg`,{viewBox:`0 0 24 24`,width:`36`,height:`36`,fill:`none`,stroke:`var(--text-primary)`,strokeWidth:`3`,strokeLinecap:`round`,strokeLinejoin:`round`,children:(0,l.jsx)(`path`,{d:`M20 6L9 17l-5-5`})})}),(0,l.jsx)(`div`,{className:`fshop-success-title`,children:`Добыча твоя!`}),(0,l.jsx)(`div`,{className:`fshop-success-desc`,children:M?.category===`food`?`Забери у прораба или на складе объекта!`:M?.category===`merch`?`Мерч добавлен! Забери на складе у кладовщика.`:M?.category===`digital`?`Цифровой контент активирован!`:M?.category===`privilege`?`Привилегия активирована!`:`Косметика применена к профилю!`}),M&&(0,l.jsxs)(`div`,{className:`fshop-success-item`,children:[(0,l.jsx)(`span`,{className:`fshop-success-item-icon`,children:M.icon_svg?(0,l.jsx)(`span`,{className:`fshop-svg-icon fshop-svg-icon--md`,dangerouslySetInnerHTML:{__html:M.icon_svg}}):M.icon}),(0,l.jsx)(`span`,{className:`fshop-success-item-name`,children:M.name})]}),(0,l.jsx)(`button`,{className:`fshop-success-btn`,onClick:X,children:`Отлично!`})]})})]})]})}var C=`
.fshop {
  --fshop-bg:var(--bg-primary);--fshop-card:var(--field-card);--fshop-card2:var(--bg-surface-alt);--fshop-card3:var(--bg-elevated);
  --fshop-gold:var(--value);--fshop-gold-d:var(--value);--fshop-gold-l:color-mix(in oklab, var(--value) 45%, var(--text-primary));
  --fshop-red:var(--danger);--fshop-blue:var(--acc);--fshop-purple:var(--acc);--fshop-green:var(--ok);
  --fshop-t1:var(--text-primary);--fshop-t2:color-mix(in oklab, var(--text-primary) 70%, transparent);--fshop-t3:color-mix(in oklab, var(--text-primary) 40%, transparent);
  --fshop-radius:16px;
  position:relative;min-height:100dvh;width:100%;background:var(--fshop-bg);color:var(--fshop-t1);
  font-family:-apple-system,BlinkMacSystemFont,'SF Pro Round',system-ui,sans-serif;
  -webkit-user-select:none;user-select:none;overflow-x:hidden;
}
/* Палитра берётся ТОЛЬКО из токенов темы. Свой .light-override убран:
   он инвертировал палитру (--fshop-card: var(--text-primary)) и ломал светлую тему. */
@keyframes fshop-shimmer{0%{background-position:200% 0}100%{background-position:-200% 0}}
.fshop-skeleton{display:block}

/* ═══ BG ═══ */
.fshop-bg{position:fixed;inset:0;z-index:0;overflow:hidden;pointer-events:none}
.fshop-bg-glow{position:absolute;border-radius:50%;filter:blur(80px);opacity:.2}
.fshop-bg-glow.g1{width:300px;height:300px;top:-80px;left:-60px;background:var(--fshop-gold)}
.fshop-bg-glow.g2{width:250px;height:250px;bottom:10%;right:-80px;background:var(--fshop-purple)}
.fshop-bg-glow.g3{width:200px;height:200px;top:50%;left:40%;background:var(--fshop-blue);opacity:.08}
/* .fshop-stars/.fshop-s (звёздное поле) удалены — старая система декора. */

.fshop-page{position:relative;z-index:5;display:flex;flex-direction:column;min-height:100dvh;max-width:430px;margin:0 auto;
  padding-bottom:max(env(safe-area-inset-bottom),20px)}
.fshop-confetti{position:fixed;inset:0;z-index:400;pointer-events:none}

/* ═══ TOP BAR ═══ */
.fshop-top{display:flex;align-items:center;justify-content:space-between;padding:10px 16px;
  padding-top:max(env(safe-area-inset-top),10px);position:sticky;top:0;z-index:50;
  background:linear-gradient(180deg,var(--fshop-bg) 60%,transparent);backdrop-filter:blur(12px);-webkit-backdrop-filter:blur(12px)}
.fshop-top-back{width:36px;height:36px;border-radius:12px;background:color-mix(in oklab, var(--text-primary) 6%, transparent);display:flex;align-items:center;justify-content:center;
  cursor:pointer;transition:background .2s}
.fshop-top-back:active{background:color-mix(in oklab, var(--text-primary) 12%, transparent)}
.fshop-top-center{text-align:center}
.fshop-top-title{font-size:15px;font-weight:800;letter-spacing:.08em;color:var(--fshop-gold)}
.fshop-top-sub{font-size:9px;color:var(--fshop-t3);letter-spacing:.15em;margin-top:1px}
.fshop-wallet{display:flex;align-items:center;gap:5px;padding:5px 12px 5px 8px;
  background:linear-gradient(135deg,var(--bg-surface),var(--bg-surface));border:1.5px solid color-mix(in oklab, var(--value) 30%, transparent);
  border-radius:20px;box-shadow:0 2px 10px color-mix(in oklab, var(--value) 10%, transparent);cursor:pointer;transition:all .2s}
.fshop-wallet:active{transform:scale(.96)}
.fshop-wallet-coin{width:22px;height:22px;border-radius:50%;
  background:radial-gradient(circle at 40% 35%,var(--fshop-gold-l),var(--fshop-gold),var(--fshop-gold-d));
  box-shadow:0 2px 4px color-mix(in oklab, var(--bg-primary) 40%, transparent),inset 0 -2px 3px color-mix(in oklab, var(--bg-primary) 20%, transparent);
  display:flex;align-items:center;justify-content:center;font-size:11px;font-weight:900;color:var(--value)}
.fshop-wallet-num{font-size:15px;font-weight:800;color:var(--fshop-gold);font-variant-numeric:tabular-nums}

/* ═══ BANNER ═══ */
.fshop-banner{margin:4px 16px 8px;padding:14px 16px;border-radius:var(--fshop-radius);position:relative;overflow:hidden;
  background:linear-gradient(135deg,#1a1030,#0f1828,#1a1030);cursor:pointer;
  border:1px solid color-mix(in oklab, var(--value) 12%, transparent);box-shadow:0 4px 20px color-mix(in oklab, var(--bg-primary) 30%, transparent)}
.fshop-banner::before{content:'';position:absolute;inset:0;
  background:linear-gradient(135deg,color-mix(in oklab, var(--value) 5%, transparent),transparent 50%,color-mix(in oklab, var(--acc) 4%, transparent));pointer-events:none}
.fshop-banner-row{display:flex;align-items:center;gap:12px}
.fshop-banner-icon{font-size:36px;filter:drop-shadow(0 0 10px color-mix(in oklab, var(--value) 30%, transparent))}
.fshop-banner-text{flex:1}
.fshop-banner-title{font-size:14px;font-weight:800;color:var(--fshop-gold)}
.fshop-banner-desc{font-size:11px;color:var(--fshop-t3);margin-top:2px;line-height:1.4}
.fshop-banner-tag{position:absolute;top:8px;right:10px;padding:2px 8px;border-radius:6px;font-size:8px;font-weight:800;
  letter-spacing:.12em;background:color-mix(in oklab, var(--danger) 15%, transparent);color:var(--fshop-red);border:1px solid color-mix(in oklab, var(--danger) 20%, transparent)}

/* ═══ CATEGORIES ═══ */
.fshop-cats{display:flex;gap:6px;padding:0 16px;margin:4px 0 12px;overflow-x:auto;-webkit-overflow-scrolling:touch;scrollbar-width:none}
.fshop-cats::-webkit-scrollbar{display:none}
.fshop-cat-btn{flex-shrink:0;display:flex;align-items:center;gap:6px;padding:8px 14px;border-radius:12px;border:none;
  font-size:12px;font-weight:700;color:var(--fshop-t3);background:var(--fshop-card);cursor:pointer;
  border:1.5px solid transparent;transition:all .25s;white-space:nowrap}
.fshop-cat-btn:active{transform:scale(.96)}
.fshop-cat-btn.active{color:var(--fshop-gold);background:linear-gradient(135deg,var(--bg-surface),var(--bg-surface));
  border-color:color-mix(in oklab, var(--value) 30%, transparent);box-shadow:0 2px 12px color-mix(in oklab, var(--value) 10%, transparent)}
.fshop-cat-icon{font-size:16px}
.fshop-cat-count{padding:2px 6px;border-radius:6px;font-size:9px;font-weight:800;
  background:color-mix(in oklab, var(--text-primary) 6%, transparent);color:var(--fshop-t3)}
.fshop-cat-btn.active .fshop-cat-count{background:color-mix(in oklab, var(--value) 12%, transparent);color:var(--fshop-gold)}

/* ═══ SECTION HEADER ═══ */
.fshop-section-head{display:flex;align-items:center;justify-content:space-between;padding:16px 16px 8px}
.fshop-section-title{font-size:13px;font-weight:800;color:var(--fshop-t2);letter-spacing:.06em}
.fshop-section-count{font-size:11px;color:var(--fshop-t3)}

/* ═══ GRID ═══ */
.fshop-grid{display:grid;grid-template-columns:1fr 1fr;grid-auto-rows:1fr;gap:10px;padding:0 16px}

/* ═══ CARD ═══ */
.fshop-card{position:relative;border-radius:var(--fshop-radius);overflow:hidden;
  background:color-mix(in oklab, var(--fshop-card) 80%, transparent);border:1px solid var(--field-hairline);
  -webkit-backdrop-filter:blur(12px) saturate(1.4);backdrop-filter:blur(12px) saturate(1.4);
  display:flex;flex-direction:column;box-shadow:var(--elevation-2);transition:all .3s cubic-bezier(.34,1.56,.64,1);cursor:pointer}
.fshop-card:active{transform:scale(.96)}
@media(hover:hover){.fshop-card:hover{transform:translateY(-4px) scale(1.02);
  box-shadow:0 8px 30px color-mix(in oklab, var(--bg-primary) 35%, transparent);border-color:color-mix(in oklab, var(--text-primary) 8%, transparent)}}

.fshop-card-img{position:relative;height:120px;display:flex;align-items:center;justify-content:center;overflow:hidden}
.fshop-card-img::before{content:'';position:absolute;inset:0;opacity:.9}
/* Тонирование категорий — от токенов темы (раньше тёмные литералы:
   в светлой теме карточки оставались чёрными). */
.fshop-card.food .fshop-card-img::before{background:linear-gradient(135deg,color-mix(in oklab, var(--ok) 18%, var(--fshop-card)),color-mix(in oklab, var(--ok) 6%, var(--fshop-card)))}
.fshop-card.merch .fshop-card-img::before{background:linear-gradient(135deg,color-mix(in oklab, var(--value) 18%, var(--fshop-card)),color-mix(in oklab, var(--value) 6%, var(--fshop-card)))}
.fshop-card.digital .fshop-card-img::before{background:linear-gradient(135deg,color-mix(in oklab, var(--acc) 18%, var(--fshop-card)),color-mix(in oklab, var(--acc) 6%, var(--fshop-card)))}
.fshop-card.privilege .fshop-card-img::before{background:linear-gradient(135deg,color-mix(in oklab, var(--danger) 18%, var(--fshop-card)),color-mix(in oklab, var(--danger) 6%, var(--fshop-card)))}
.fshop-card.cosmetic .fshop-card-img::before{background:linear-gradient(135deg,color-mix(in oklab, var(--acc) 14%, var(--fshop-card)),color-mix(in oklab, var(--acc) 5%, var(--fshop-card)))}
.fshop-card-icon{position:relative;z-index:2;font-size:48px;
  filter:drop-shadow(0 4px 12px color-mix(in oklab, var(--bg-primary) 40%, transparent));transition:all .4s cubic-bezier(.34,1.56,.64,1);
  display:flex;align-items:center;justify-content:center}
.fshop-card-icon.fshop-card-3d{font-size:0;height:112px;filter:none}
@media(hover:hover){.fshop-card:hover .fshop-card-icon{transform:scale(1.08)}
.fshop-card:hover .fshop-card-icon.fshop-card-3d{transform:scale(1.03)}}
@keyframes fshopSpin{to{transform:rotate(360deg)}}
.fshop-card-glow{position:absolute;width:80px;height:80px;border-radius:50%;filter:blur(25px);opacity:.3;z-index:1}
.fshop-card.food .fshop-card-glow{background:var(--ok)}
.fshop-card.merch .fshop-card-glow{background:var(--fshop-gold)}
.fshop-card.digital .fshop-card-glow{background:var(--fshop-blue)}
.fshop-card.privilege .fshop-card-glow{background:var(--fshop-purple)}
.fshop-card.cosmetic .fshop-card-glow{background:var(--fshop-green)}

.fshop-card-rarity{position:absolute;top:8px;left:8px;padding:2px 8px;border-radius:6px;font-size:8px;font-weight:800;
  letter-spacing:.1em;z-index:3;backdrop-filter:blur(6px);-webkit-backdrop-filter:blur(6px)}
.fshop-card-rarity.common{background:color-mix(in oklab, var(--ok) 12%, transparent);color:var(--fshop-green);border:1px solid color-mix(in oklab, var(--ok) 15%, transparent)}
.fshop-card-rarity.rare{background:color-mix(in oklab, var(--acc) 12%, transparent);color:var(--fshop-blue);border:1px solid color-mix(in oklab, var(--acc) 15%, transparent)}
.fshop-card-rarity.epic{background:color-mix(in oklab, var(--acc) 12%, transparent);color:var(--fshop-purple);border:1px solid color-mix(in oklab, var(--acc) 15%, transparent)}
.fshop-card-rarity.legendary{background:color-mix(in oklab, var(--value) 12%, transparent);color:var(--fshop-gold);border:1px solid color-mix(in oklab, var(--value) 20%, transparent)}

.fshop-card-limited{position:absolute;top:8px;right:8px;padding:2px 6px;border-radius:6px;font-size:8px;font-weight:800;
  background:color-mix(in oklab, var(--danger) 15%, transparent);color:var(--fshop-red);border:1px solid color-mix(in oklab, var(--danger) 20%, transparent);z-index:3}

.fshop-card-body{padding:10px 12px 12px}
.fshop-card-name{font-size:13px;font-weight:700;line-height:1.3;display:-webkit-box;-webkit-line-clamp:2;
  -webkit-box-orient:vertical;overflow:hidden}
.fshop-card-desc{font-size:10px;color:var(--fshop-t3);margin-top:3px;line-height:1.3;display:-webkit-box;-webkit-line-clamp:2;
  -webkit-box-orient:vertical;overflow:hidden}

.fshop-card-price-row{display:flex;align-items:center;justify-content:space-between;margin-top:8px}
.fshop-card-price{display:flex;align-items:center;gap:4px}
.fshop-cp-coin{width:16px;height:16px;border-radius:50%;
  background:radial-gradient(circle at 40% 35%,var(--fshop-gold-l),var(--fshop-gold),var(--fshop-gold-d));
  display:flex;align-items:center;justify-content:center;font-size:8px;font-weight:900;color:var(--value);
  box-shadow:0 1px 3px color-mix(in oklab, var(--bg-primary) 30%, transparent)}
.fshop-cp-num{font-size:15px;font-weight:800;color:var(--fshop-gold);font-variant-numeric:tabular-nums}
.fshop-card-buy{padding:6px 12px;border-radius:10px;border:none;font-size:11px;font-weight:800;color:var(--text-primary);cursor:pointer;
  position:relative;overflow:hidden;transition:all .2s;background:color-mix(in oklab, var(--text-primary) 6%, transparent);color:var(--fshop-t3);box-shadow:none}
.fshop-card-buy:active{transform:scale(.94)}
.fshop-card-buy.can{background:linear-gradient(135deg,var(--fshop-gold-d),var(--fshop-gold));color:var(--text-on-gold);
  box-shadow:0 3px 0 var(--value),0 4px 12px color-mix(in oklab, var(--value) 20%, transparent)}
.fshop-card-buy.can:active{box-shadow:0 1px 0 var(--value);transform:translateY(2px) scale(.98)}
.fshop-card-buy.can::after{content:'';position:absolute;top:0;left:-100%;width:40%;height:100%;
  background:linear-gradient(90deg,transparent,color-mix(in oklab, var(--text-primary) 20%, transparent),transparent);animation:fshop-shine 3s infinite}
@keyframes fshop-shine{0%,100%{left:-100%}50%{left:150%}}

/* ═══ LOCKED — только надпись, без затемнения ═══ */
.fshop-card.locked .fshop-card-buy{cursor:not-allowed}
.fshop-card.locked .fshop-card-buy::after{display:none}
.fshop-card-deficit{display:flex;align-items:center;gap:3px;font-size:9px;font-weight:700;color:var(--fshop-red);margin-top:3px}

/* ═══ SOLD OUT ═══ */
.fshop-card.soldout{pointer-events:none}
.fshop-card.soldout .fshop-card-img{filter:saturate(.2) brightness(.4)}
.fshop-card.soldout .fshop-card-body{opacity:.4}
.fshop-card-soldout-badge{display:none;position:absolute;top:50%;left:50%;transform:translate(-50%,-50%) rotate(-12deg);
  z-index:10;padding:6px 20px;border-radius:8px;font-size:12px;font-weight:900;letter-spacing:.15em;
  background:color-mix(in oklab, var(--danger) 15%, transparent);color:var(--fshop-red);border:2px solid color-mix(in oklab, var(--danger) 30%, transparent);
  backdrop-filter:blur(4px);-webkit-backdrop-filter:blur(4px)}
.fshop-card.soldout .fshop-card-soldout-badge{display:block}

/* ═══ MODAL OVERLAY ═══ */
.fshop-modal-ov{position:fixed;inset:0;z-index:200;background:color-mix(in oklab, var(--bg-primary) 0%, transparent);pointer-events:none;transition:background .3s}
.fshop-modal-ov.on{background:color-mix(in oklab, var(--bg-primary) 70%, transparent);pointer-events:auto;backdrop-filter:blur(6px);-webkit-backdrop-filter:blur(6px)}

/* ═══ PURCHASE MODAL ═══ */
.fshop-modal{position:fixed;left:50%;bottom:0;width:100%;max-width:430px;transform:translate(-50%,110%);z-index:201;
  transition:transform .5s cubic-bezier(.34,1.56,.64,1)}
.fshop-modal.on{transform:translate(-50%,0)}
.fshop-modal-card{background:linear-gradient(180deg,var(--fshop-card2),var(--fshop-card));border-radius:28px 28px 0 0;
  border:1px solid color-mix(in oklab, var(--text-primary) 6%, transparent);border-bottom:none;padding:20px;
  padding-bottom:max(env(safe-area-inset-bottom),28px);box-shadow:0 -10px 50px color-mix(in oklab, var(--bg-primary) 50%, transparent)}
.fshop-modal-handle{width:40px;height:4px;border-radius:2px;background:color-mix(in oklab, var(--text-primary) 12%, transparent);margin:0 auto 16px}
.fshop-modal-icon-area{text-align:center;position:relative;height:100px;margin-bottom:8px}
.fshop-modal-glow{position:absolute;top:50%;left:50%;transform:translate(-50%,-50%);width:120px;height:120px;border-radius:50%;filter:blur(25px)}
.fshop-modal-glow.food{background:color-mix(in oklab, var(--ok) 20%, transparent)}
.fshop-modal-glow.merch{background:color-mix(in oklab, var(--value) 25%, transparent)}
.fshop-modal-glow.digital{background:color-mix(in oklab, var(--acc) 20%, transparent)}
.fshop-modal-glow.privilege{background:color-mix(in oklab, var(--acc) 20%, transparent)}
.fshop-modal-glow.cosmetic{background:color-mix(in oklab, var(--ok) 20%, transparent)}
.fshop-modal-emoji{position:relative;z-index:2;font-size:56px;line-height:100px;animation:fshop-mPop .5s cubic-bezier(.34,1.56,.64,1)}
@keyframes fshop-mPop{0%{transform:scale(0) rotate(-10deg)}60%{transform:scale(1.15) rotate(3deg)}100%{transform:scale(1) rotate(0)}}
.fshop-modal-rarity{display:inline-block;padding:3px 14px;border-radius:20px;font-size:9px;font-weight:800;
  letter-spacing:.1em;text-transform:uppercase;margin-bottom:6px}
.fshop-modal-rarity.common{background:color-mix(in oklab, var(--ok) 12%, transparent);color:var(--fshop-green);border:1px solid color-mix(in oklab, var(--ok) 20%, transparent)}
.fshop-modal-rarity.rare{background:color-mix(in oklab, var(--acc) 12%, transparent);color:var(--fshop-blue);border:1px solid color-mix(in oklab, var(--acc) 20%, transparent)}
.fshop-modal-rarity.epic{background:color-mix(in oklab, var(--acc) 12%, transparent);color:var(--fshop-purple);border:1px solid color-mix(in oklab, var(--acc) 20%, transparent)}
.fshop-modal-rarity.legendary{background:color-mix(in oklab, var(--value) 12%, transparent);color:var(--fshop-gold);border:1px solid color-mix(in oklab, var(--value) 25%, transparent)}
.fshop-modal-name{font-size:20px;font-weight:800;text-align:center;margin-top:4px}
.fshop-modal-desc{font-size:12px;color:var(--fshop-t2);text-align:center;margin:4px 0 16px;line-height:1.5;white-space:pre-line}

.fshop-modal-price-box{display:flex;align-items:center;justify-content:center;gap:8px;padding:12px 24px;
  border-radius:16px;background:color-mix(in oklab, var(--value) 6%, transparent);border:1px solid color-mix(in oklab, var(--value) 10%, transparent);margin:0 auto;width:fit-content}
.fshop-mpb-coin{width:28px;height:28px;border-radius:50%;
  background:radial-gradient(circle at 40% 35%,var(--fshop-gold-l),var(--fshop-gold),var(--fshop-gold-d));
  display:flex;align-items:center;justify-content:center;font-size:14px;font-weight:900;color:var(--value);
  box-shadow:0 2px 4px color-mix(in oklab, var(--bg-primary) 30%, transparent),inset 0 -2px 3px color-mix(in oklab, var(--bg-primary) 20%, transparent)}
.fshop-mpb-num{font-size:24px;font-weight:800;color:var(--fshop-gold);font-variant-numeric:tabular-nums}

.fshop-modal-balance{text-align:center;margin-top:8px;font-size:11px;color:var(--fshop-t3)}
.fshop-modal-balance b{color:var(--fshop-t2)}

.fshop-modal-confirm{display:block;width:100%;margin-top:16px;padding:16px;border-radius:16px;border:none;
  font-size:16px;font-weight:800;cursor:pointer;position:relative;overflow:hidden;
  background:linear-gradient(135deg,var(--fshop-gold-d),var(--fshop-gold));color:var(--text-on-gold);
  box-shadow:0 5px 0 var(--value),0 6px 20px color-mix(in oklab, var(--value) 20%, transparent);transition:all .1s}
.fshop-modal-confirm:active{transform:translateY(4px);box-shadow:0 1px 0 var(--value)}
.fshop-modal-confirm::after{content:'';position:absolute;top:0;left:-100%;width:50%;height:100%;
  background:linear-gradient(90deg,transparent,color-mix(in oklab, var(--text-primary) 15%, transparent),transparent);animation:fshop-shine 3s infinite}
.fshop-modal-cancel{display:block;width:100%;margin-top:8px;padding:12px;border-radius:12px;border:none;
  font-size:13px;font-weight:700;color:var(--fshop-t3);background:color-mix(in oklab, var(--text-primary) 4%, transparent);cursor:pointer;transition:all .2s}
.fshop-modal-cancel:active{background:color-mix(in oklab, var(--text-primary) 8%, transparent)}

/* ═══ SUCCESS MODAL ═══ */
.fshop-success-ov{position:fixed;inset:0;z-index:300;background:color-mix(in oklab, var(--bg-primary) 0%, transparent);pointer-events:none;transition:background .3s}
.fshop-success-ov.on{background:color-mix(in oklab, var(--bg-primary) 70%, transparent);pointer-events:auto;backdrop-filter:blur(6px);-webkit-backdrop-filter:blur(6px)}
.fshop-success-modal{position:fixed;top:50%;left:50%;width:calc(100% - 48px);max-width:380px;
  transform:translate(-50%,-50%) scale(.7);z-index:301;opacity:0;pointer-events:none;
  transition:all .4s cubic-bezier(.34,1.56,.64,1)}
.fshop-success-modal.on{transform:translate(-50%,-50%) scale(1);opacity:1;pointer-events:auto}
.fshop-success-card{background:linear-gradient(180deg,var(--fshop-card2),var(--fshop-card));border-radius:24px;
  border:1px solid color-mix(in oklab, var(--value) 15%, transparent);padding:28px 24px;box-shadow:0 20px 60px color-mix(in oklab, var(--bg-primary) 50%, transparent);text-align:center}
.fshop-success-check{width:72px;height:72px;margin:0 auto 16px;border-radius:50%;
  background:linear-gradient(135deg,var(--fshop-green),#2a9d5e);display:flex;align-items:center;justify-content:center;
  box-shadow:0 6px 20px color-mix(in oklab, var(--ok) 30%, transparent);animation:fshop-checkBounce .6s cubic-bezier(.34,1.56,.64,1)}
@keyframes fshop-checkBounce{0%{transform:scale(0)}60%{transform:scale(1.2)}100%{transform:scale(1)}}
.fshop-success-title{font-size:20px;font-weight:800;color:var(--fshop-gold);margin-bottom:4px}
.fshop-success-desc{font-size:13px;color:var(--fshop-t2);margin-bottom:16px;line-height:1.5}
.fshop-success-item{display:inline-flex;align-items:center;gap:8px;padding:8px 20px;border-radius:12px;
  background:color-mix(in oklab, var(--value) 6%, transparent);border:1px solid color-mix(in oklab, var(--value) 10%, transparent)}
.fshop-success-item-icon{font-size:28px}
.fshop-success-item-name{font-size:14px;font-weight:700}
.fshop-success-btn{display:block;width:100%;margin-top:20px;padding:14px;border-radius:14px;border:none;
  font-size:15px;font-weight:800;color:var(--text-on-gold);cursor:pointer;
  background:linear-gradient(135deg,var(--fshop-gold-d),var(--fshop-gold));
  box-shadow:0 4px 0 var(--value),0 5px 16px color-mix(in oklab, var(--value) 20%, transparent);transition:all .1s}
.fshop-success-btn:active{transform:translateY(3px);box-shadow:0 1px 0 var(--value)}

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
`;export{S as default};