import{a as e}from"./rolldown-runtime-COnpUsM8.js";import{t}from"./vendor-react-MND8CZ4K.js";import{In as n,Ln as r,ei as i}from"./vendor-icons-177gZrnq.js";import{o as a,s as o}from"./vendor-router-BiJFzTT3.js";import"./client-K8YhpJD6.js";import{t as s}from"./authStore-BFZzVObs.js";import{v as c}from"./index-BlIjdFDq.js";var l=e(i(),1),u=t(),d=[{char:`ᚱ`,x:8,delay:0,dur:7,size:18},{char:`ᚨ`,x:22,delay:1.2,dur:9,size:14},{char:`ᚷ`,x:45,delay:2.5,dur:8,size:20},{char:`ᚾ`,x:65,delay:.8,dur:10,size:16},{char:`ᛟ`,x:80,delay:3,dur:7.5,size:15},{char:`ᚲ`,x:35,delay:4,dur:8.5,size:13},{char:`ᛏ`,x:55,delay:1.5,dur:9.5,size:17},{char:`ᛒ`,x:90,delay:2,dur:6.5,size:14}];function f(){let[e,t]=(0,l.useState)(``),[i,f]=(0,l.useState)(``),[p,m]=(0,l.useState)(!1),[h,g]=(0,l.useState)(``),[_,v]=(0,l.useState)(!1),[y,b]=(0,l.useState)(!1),[x,S]=(0,l.useState)(!1),C=s(e=>e.login),w=o(),T=a(),E=c(),D=T.state?.from?.pathname||`/`;(0,l.useEffect)(()=>{setTimeout(()=>S(!0),100)},[]);let O=async t=>{if(t.preventDefault(),!(!e.trim()||!i.trim())){v(!0),g(``),E.light();try{let t=await C(e.trim(),i);b(!0),E.success(),setTimeout(()=>{t.status===`need_pin`||t.status===`need_setup`?w(`/pin`,{replace:!0}):w(D,{replace:!0})},800)}catch{g(`Неверный логин или пароль`),E.error()}finally{v(!1)}}};return(0,u.jsxs)(`div`,{className:`relative flex flex-col items-center justify-center min-h-screen px-6 overflow-hidden`,style:{backgroundColor:`#050508`,paddingTop:`var(--safe-top)`,paddingBottom:`var(--safe-bottom)`},children:[(0,u.jsx)(`div`,{className:`absolute inset-0 login-aurora`}),(0,u.jsxs)(`div`,{className:`absolute inset-0 pointer-events-none`,children:[(0,u.jsx)(`div`,{className:`login-orb login-orb-blue`}),(0,u.jsx)(`div`,{className:`login-orb login-orb-red`}),(0,u.jsx)(`div`,{className:`login-orb login-orb-gold`})]}),(0,u.jsx)(`div`,{className:`absolute inset-0 pointer-events-none overflow-hidden`,"aria-hidden":`true`,children:d.map((e,t)=>(0,u.jsx)(`span`,{className:`absolute c-gold`,style:{left:`${e.x}%`,bottom:`-20px`,fontSize:e.size,opacity:0,animation:`loginRuneFloat ${e.dur}s ease-in-out ${e.delay}s infinite`},children:e.char},t))}),(0,u.jsxs)(`div`,{className:`flex flex-col items-center mb-10 relative z-10`,style:{opacity:x?1:0,transform:x?y?`translateY(0) scale(1.05)`:`translateY(0) scale(1)`:`translateY(24px) scale(0.85)`,transition:`all 0.9s cubic-bezier(0.34, 1.56, 0.64, 1)`},children:[(0,u.jsxs)(`div`,{className:`relative`,children:[(0,u.jsx)(`div`,{className:`absolute rounded-full`,style:{inset:-28,border:`1px solid rgba(200, 41, 59, 0.06)`,animation:`loginRingPulse 4s ease-in-out infinite`}}),(0,u.jsx)(`div`,{className:`absolute rounded-full`,style:{inset:-14,border:`1px solid rgba(30, 77, 140, 0.1)`,animation:`loginRingPulse 4s ease-in-out 0.6s infinite`}}),(0,u.jsx)(`div`,{className:`relative`,style:{filter:y?`drop-shadow(0 0 40px rgba(200, 41, 59, 0.6)) drop-shadow(0 0 80px rgba(30, 77, 140, 0.4))`:`drop-shadow(0 0 20px rgba(200, 41, 59, 0.25)) drop-shadow(0 0 40px rgba(30, 77, 140, 0.15))`,transition:`filter 0.6s ease`},children:(0,u.jsx)(`img`,{src:`/m/asgard-logo.png`,alt:`ASGARD CRM`,draggable:!1,style:{width:160,height:`auto`,userSelect:`none`}})})]}),(0,u.jsx)(`p`,{className:`text-[11px] mt-3 tracking-[0.06em] c-tertiary`,children:`Управление бизнесом`})]}),(0,u.jsxs)(`form`,{onSubmit:O,className:`w-full max-w-sm space-y-4 relative z-10`,children:[(0,u.jsxs)(`div`,{className:`space-y-2`,style:{opacity:x?1:0,transform:x?`translateY(0)`:`translateY(16px)`,transition:`all 0.6s ease 0.3s`},children:[(0,u.jsx)(`label`,{className:`text-[10px] font-semibold uppercase tracking-[0.1em] pl-1`,style:{color:`rgba(212, 168, 67, 0.5)`},children:`Логин`}),(0,u.jsxs)(`div`,{className:`relative`,children:[(0,u.jsx)(`input`,{type:`text`,placeholder:`Введите логин`,value:e,onChange:e=>t(e.target.value),autoCapitalize:`none`,autoCorrect:`off`,autoComplete:`username`,className:`w-full h-[52px] rounded-2xl px-4 text-[15px] border-0 outline-none login-input c-primary`,style:{backgroundColor:`rgba(255,255,255,0.05)`,caretColor:`var(--gold)`,border:`1px solid rgba(255,255,255,0.06)`}}),(0,u.jsx)(`div`,{className:`absolute bottom-0 left-3 right-3 h-[2px] rounded-full`,style:{background:e?`var(--gold-gradient)`:`transparent`,boxShadow:e?`0 0 12px rgba(212, 168, 67, 0.4)`:`none`,opacity:e?1:0,transition:`all 0.3s ease`}})]})]}),(0,u.jsxs)(`div`,{className:`space-y-2`,style:{opacity:x?1:0,transform:x?`translateY(0)`:`translateY(16px)`,transition:`all 0.6s ease 0.45s`},children:[(0,u.jsx)(`label`,{className:`text-[10px] font-semibold uppercase tracking-[0.1em] pl-1`,style:{color:`rgba(212, 168, 67, 0.5)`},children:`Пароль`}),(0,u.jsxs)(`div`,{className:`relative`,children:[(0,u.jsx)(`input`,{type:p?`text`:`password`,placeholder:`Введите пароль`,value:i,onChange:e=>f(e.target.value),autoComplete:`current-password`,className:`w-full h-[52px] rounded-2xl px-4 pr-12 text-[15px] border-0 outline-none login-input c-primary`,style:{backgroundColor:`rgba(255,255,255,0.05)`,caretColor:`var(--gold)`,border:`1px solid rgba(255,255,255,0.06)`}}),(0,u.jsx)(`button`,{type:`button`,onClick:()=>m(!p),className:`absolute right-3 top-1/2 -translate-y-1/2 p-2 rounded-full c-tertiary`,children:p?(0,u.jsx)(r,{size:20}):(0,u.jsx)(n,{size:20})}),(0,u.jsx)(`div`,{className:`absolute bottom-0 left-3 right-3 h-[2px] rounded-full`,style:{background:i?`var(--gold-gradient)`:`transparent`,boxShadow:i?`0 0 12px rgba(212, 168, 67, 0.4)`:`none`,opacity:i?1:0,transition:`all 0.3s ease`}})]})]}),h&&(0,u.jsx)(`div`,{className:`flex items-center justify-center gap-2 py-2.5 px-3 rounded-xl text-sm c-red`,style:{backgroundColor:`rgba(198, 40, 40, 0.12)`,border:`1px solid rgba(198, 40, 40, 0.15)`,animation:`fadeInUp 0.2s ease forwards`},children:h}),(0,u.jsx)(`div`,{style:{opacity:x?1:0,transform:x?`translateY(0)`:`translateY(16px)`,transition:`all 0.6s ease 0.6s`},children:(0,u.jsxs)(`button`,{type:`submit`,disabled:_||!e.trim()||!i.trim(),className:`w-full h-[52px] rounded-2xl text-[15px] font-bold border-0 spring-tap relative overflow-hidden`,style:{background:y?`linear-gradient(135deg, #D4A843, #c8a040)`:`linear-gradient(135deg, #C8293B 0%, #1E4D8C 100%)`,color:`#fff`,boxShadow:y?`0 4px 24px rgba(212, 168, 67, 0.5)`:`0 4px 24px rgba(30, 77, 140, 0.4), 0 0 40px rgba(200, 41, 59, 0.15)`,transition:`all 0.4s ease`,opacity:(!e.trim()||!i.trim())&&!_?.4:1,letterSpacing:`0.03em`},children:[(0,u.jsx)(`div`,{className:`absolute inset-0 pointer-events-none`,style:{background:`linear-gradient(105deg, transparent 40%, rgba(255,255,255,0.1) 50%, transparent 60%)`,animation:`loginBtnShimmer 3s ease-in-out infinite`}}),(0,u.jsx)(`span`,{className:`relative z-10`,children:_?(0,u.jsxs)(`span`,{className:`flex items-center justify-center gap-2`,children:[(0,u.jsx)(`span`,{className:`inline-block h-4 w-4 rounded-full animate-spin`,style:{border:`2px solid rgba(255,255,255,0.3)`,borderTopColor:`#fff`}}),`Вход...`]}):y?`✓ Добро пожаловать`:`Войти`})]})})]}),(0,u.jsx)(`div`,{className:`mt-8 relative z-10`,style:{textAlign:`center`},children:(0,u.jsxs)(`button`,{type:`button`,onClick:()=>w(`/field-login`),style:{background:`rgba(255,255,255,0.04)`,border:`1px solid rgba(255,255,255,0.08)`,borderRadius:12,padding:`10px 20px`,color:`rgba(255,255,255,0.4)`,fontSize:12,cursor:`pointer`,display:`inline-flex`,alignItems:`center`,gap:8},children:[(0,u.jsx)(`span`,{children:`⛏️`}),(0,u.jsx)(`span`,{children:`Вы рабочий? Войти в Зал Рабочих`}),(0,u.jsx)(`span`,{style:{opacity:.5},children:`→`})]})}),(0,u.jsx)(`p`,{className:`mt-6 text-[10px] font-medium relative z-10 tracking-wider uppercase`,style:{color:`rgba(255,255,255,0.15)`},children:`Асгард Сервис © 2026`}),(0,u.jsx)(`style`,{children:`
        .login-aurora {
          background: linear-gradient(-45deg,
            #050510, #0a1628, #0d0a1e, #08121f,
            #120a18, #050510, #0a1525, #0d0a20
          );
          background-size: 400% 400%;
          animation: loginAuroraShift 25s ease infinite;
        }
        @keyframes loginAuroraShift {
          0%   { background-position: 0% 50%; }
          25%  { background-position: 50% 25%; }
          50%  { background-position: 100% 50%; }
          75%  { background-position: 50% 75%; }
          100% { background-position: 0% 50%; }
        }

        .login-orb {
          position: absolute;
          border-radius: 50%;
          filter: blur(80px);
          animation: loginOrbDrift 12s ease-in-out infinite;
        }
        .login-orb-blue {
          width: 300px; height: 300px;
          top: 5%; left: -10%;
          background: radial-gradient(circle, rgba(30,77,140,0.25), transparent 70%);
        }
        .login-orb-red {
          width: 250px; height: 250px;
          bottom: 15%; right: -10%;
          background: radial-gradient(circle, rgba(200,41,59,0.18), transparent 70%);
          animation-delay: -4s;
        }
        .login-orb-gold {
          width: 200px; height: 200px;
          top: 35%; left: 30%;
          background: radial-gradient(circle, rgba(212,168,67,0.08), transparent 70%);
          animation-delay: -8s;
        }
        @keyframes loginOrbDrift {
          0%, 100% { transform: translate(0, 0) scale(1); }
          33%      { transform: translate(30px, -20px) scale(1.1); }
          66%      { transform: translate(-20px, 15px) scale(0.95); }
        }

        @keyframes loginRuneFloat {
          0%   { transform: translateY(0) rotate(0deg); opacity: 0; }
          10%  { opacity: 0.07; }
          70%  { opacity: 0.04; }
          100% { transform: translateY(-100vh) rotate(35deg); opacity: 0; }
        }

        @keyframes loginRingPulse {
          0%, 100% { transform: scale(1); opacity: 0.5; }
          50%      { transform: scale(1.15); opacity: 0; }
        }

        @keyframes loginBtnShimmer {
          0%, 100% { transform: translateX(-150%); }
          50%      { transform: translateX(150%); }
        }

        .login-input:focus {
          border-color: rgba(212, 168, 67, 0.25) !important;
          box-shadow: 0 0 0 1px rgba(212, 168, 67, 0.1), 0 0 20px rgba(212, 168, 67, 0.05);
        }
        .login-input::placeholder {
          color: rgba(255,255,255,0.2);
        }

        .light .login-aurora {
          background: linear-gradient(-45deg,
            #e8eaf6, #c5cae9, #e1bee7, #bbdefb,
            #d1c4e9, #e8eaf6, #c5cae9, #e1bee7
          );
          background-size: 400% 400%;
          animation: loginAuroraShift 25s ease infinite;
        }
        .light .login-orb-blue {
          background: radial-gradient(circle, rgba(30,77,140,0.12), transparent 70%);
        }
        .light .login-orb-red {
          background: radial-gradient(circle, rgba(200,41,59,0.08), transparent 70%);
        }
        .light .login-orb-gold {
          background: radial-gradient(circle, rgba(212,168,67,0.1), transparent 70%);
        }
        .light .login-input {
          background-color: rgba(0,0,0,0.04) !important;
          border-color: rgba(0,0,0,0.08) !important;
        }
        .light .login-input::placeholder {
          color: rgba(0,0,0,0.25);
        }
      `})]})}export{f as default};