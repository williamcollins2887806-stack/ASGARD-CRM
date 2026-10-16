import{a as e}from"./rolldown-runtime-COnpUsM8.js";import{t}from"./vendor-react-CyKapX96.js";import{$r as n}from"./vendor-icons-CL6bEzl_.js";import{s as r}from"./vendor-router-SEy1nPsj.js";var i=e(n(),1),a=t(),o=[`◆`,`◇`,`✦`,`✧`,`⊹`,`⋄`,`✺`,`✦`,`◈`,`⬩`,`⬥`,`✶`],s=Array.from({length:24},(e,t)=>({char:o[t%o.length],x:Math.random()*94+3,delay:Math.random()*10,dur:6+Math.random()*14,size:14+Math.random()*10}));function c(){let[e,t]=(0,i.useState)(!1),n=r();return(0,i.useEffect)(()=>{let e=setTimeout(()=>t(!0),80);return()=>clearTimeout(e)},[]),(0,a.jsxs)(`div`,{className:`relative flex flex-col items-center justify-between min-h-screen overflow-hidden`,style:{backgroundColor:`#050508`,paddingTop:`var(--safe-top)`,paddingBottom:`calc(var(--safe-bottom) + 24px)`},children:[(0,a.jsx)(`div`,{className:`absolute inset-0 welcome-aurora`}),(0,a.jsxs)(`div`,{className:`absolute inset-0 pointer-events-none`,children:[(0,a.jsx)(`div`,{className:`welcome-orb welcome-orb-blue`}),(0,a.jsx)(`div`,{className:`welcome-orb welcome-orb-red`}),(0,a.jsx)(`div`,{className:`welcome-orb welcome-orb-gold`})]}),(0,a.jsx)(`div`,{className:`absolute inset-0 pointer-events-none overflow-hidden`,"aria-hidden":`true`,children:s.map((e,t)=>(0,a.jsx)(`span`,{className:`absolute c-gold`,style:{left:`${e.x}%`,bottom:`-24px`,fontSize:e.size,opacity:0,animation:`welcomeRuneDrift ${e.dur}s ease-in-out ${e.delay}s infinite`},children:e.char},t))}),(0,a.jsx)(`div`,{className:`flex-1`}),(0,a.jsxs)(`div`,{className:`flex flex-col items-center relative z-10`,children:[(0,a.jsxs)(`div`,{className:`relative`,style:{opacity:e?1:0,transform:e?`translateY(0) scale(1)`:`translateY(30px) scale(0.8)`,transition:`all 1s cubic-bezier(0.34, 1.56, 0.64, 1)`},children:[(0,a.jsx)(`div`,{className:`absolute rounded-full`,style:{inset:-32,border:`1px solid rgba(200,41,59,0.06)`,animation:`loginRingPulse 4s ease-in-out infinite`}}),(0,a.jsx)(`div`,{className:`absolute rounded-full`,style:{inset:-18,border:`1px solid rgba(30,77,140,0.1)`,animation:`loginRingPulse 4s ease-in-out 0.8s infinite`}}),(0,a.jsxs)(`div`,{className:`relative`,style:{animation:`breatheGlow 4s ease-in-out infinite`},children:[(0,a.jsx)(`img`,{src:`/m/asgard-logo.png`,alt:`ASGARD`,draggable:!1,style:{width:120,height:`auto`,userSelect:`none`},onError:e=>{e.currentTarget.dataset.fallback||(e.currentTarget.dataset.fallback=`1`,e.currentTarget.src=`/m/asgard-emblem.png`)}}),(0,a.jsx)(`div`,{className:`absolute inset-0 pointer-events-none overflow-hidden rounded-full`,style:{mixBlendMode:`overlay`},children:(0,a.jsx)(`div`,{style:{position:`absolute`,inset:0,background:`linear-gradient(105deg, transparent 40%, rgba(255,255,255,0.15) 50%, transparent 60%)`,animation:`welcomeShimmer 4s ease-in-out 1s infinite`}})})]})]}),(0,a.jsx)(`h1`,{className:`mt-6`,style:{fontSize:32,fontWeight:800,letterSpacing:8,color:`#fff`,opacity:e?1:0,transform:e?`translateY(0)`:`translateY(16px)`,transition:`all 0.7s ease 0.15s`},children:`АСГАРД`}),(0,a.jsx)(`p`,{className:`mt-2`,style:{fontSize:11,letterSpacing:4,fontWeight:500,color:`rgba(255,255,255,0.45)`,textTransform:`uppercase`,opacity:e?1:0,transform:e?`translateY(0)`:`translateY(12px)`,transition:`all 0.6s ease 0.3s`},children:`СИСТЕМА УПРАВЛЕНИЯ`}),(0,a.jsx)(`div`,{className:`mt-5`,style:{height:1,background:`var(--gold-gradient)`,borderRadius:1,animation:e?`goldLineReveal 0.8s ease 0.5s both`:`none`}})]}),(0,a.jsx)(`div`,{className:`flex-1`}),(0,a.jsxs)(`div`,{className:`flex flex-col items-center gap-3 relative z-10 w-full px-8`,style:{opacity:e?1:0,transform:e?`translateY(0)`:`translateY(12px)`,transition:`all 0.35s ease 0.08s`},children:[(0,a.jsxs)(`button`,{onClick:()=>n(`/login`),className:`w-full max-w-xs h-[52px] rounded-2xl text-[15px] font-bold spring-tap relative overflow-hidden`,style:{background:`linear-gradient(135deg, #C8293B 0%, #1E4D8C 100%)`,color:`#fff`,border:`none`,letterSpacing:`0.04em`,boxShadow:`0 4px 24px rgba(30,77,140,0.4), 0 0 40px rgba(200,41,59,0.15)`},children:[(0,a.jsx)(`div`,{className:`absolute inset-0 pointer-events-none`,style:{background:`linear-gradient(105deg, transparent 40%, rgba(255,255,255,0.1) 50%, transparent 60%)`,animation:`welcomeShimmer 3s ease-in-out infinite`}}),(0,a.jsx)(`span`,{className:`relative z-10`,children:`Войти в офис`})]}),(0,a.jsx)(`button`,{onClick:()=>n(`/field-login`),className:`w-full max-w-xs h-[52px] rounded-2xl text-[15px] font-semibold spring-tap`,style:{background:`rgba(255,255,255,0.06)`,color:`rgba(255,255,255,0.92)`,border:`1px solid rgba(212,168,67,0.45)`,letterSpacing:`0.02em`},children:`Я рабочий — Зал Рабочих`}),(0,a.jsx)(`p`,{className:`text-[10px] font-medium tracking-wider uppercase mt-2`,style:{color:`rgba(255,255,255,0.15)`},children:`ASGARD Mobile v2.0.0`})]}),(0,a.jsx)(`style`,{children:`
        .welcome-aurora {
          background: linear-gradient(-45deg,
            #050510, #0a1628, #0d0a1e, #08121f,
            #120a18, #050510, #0a1525, #0d0a20
          );
          background-size: 400% 400%;
          animation: welcomeAuroraShift 25s ease infinite;
        }
        @keyframes welcomeAuroraShift {
          0%   { background-position: 0% 50%; }
          25%  { background-position: 50% 25%; }
          50%  { background-position: 100% 50%; }
          75%  { background-position: 50% 75%; }
          100% { background-position: 0% 50%; }
        }
        .welcome-orb {
          position: absolute;
          border-radius: 50%;
          filter: blur(80px);
          animation: welcomeOrbDrift 14s ease-in-out infinite;
        }
        .welcome-orb-blue {
          width: 320px; height: 320px;
          top: 8%; left: -12%;
          background: radial-gradient(circle, rgba(30,77,140,0.22), transparent 70%);
        }
        .welcome-orb-red {
          width: 260px; height: 260px;
          bottom: 12%; right: -8%;
          background: radial-gradient(circle, rgba(200,41,59,0.16), transparent 70%);
          animation-delay: -5s;
        }
        .welcome-orb-gold {
          width: 200px; height: 200px;
          top: 40%; left: 25%;
          background: radial-gradient(circle, rgba(212,168,67,0.08), transparent 70%);
          animation-delay: -9s;
        }
        @keyframes welcomeOrbDrift {
          0%, 100% { transform: translate(0, 0) scale(1); }
          33%      { transform: translate(25px, -15px) scale(1.08); }
          66%      { transform: translate(-15px, 12px) scale(0.94); }
        }
        @keyframes loginRingPulse {
          0%, 100% { transform: scale(1); opacity: 0.5; }
          50%      { transform: scale(1.15); opacity: 0; }
        }
        .light .welcome-aurora {
          background: linear-gradient(-45deg,
            #e8eaf6, #c5cae9, #e1bee7, #bbdefb,
            #d1c4e9, #e8eaf6, #c5cae9, #e1bee7
          );
          background-size: 400% 400%;
          animation: welcomeAuroraShift 25s ease infinite;
        }
        .light .welcome-orb-blue {
          background: radial-gradient(circle, rgba(30,77,140,0.1), transparent 70%);
        }
        .light .welcome-orb-red {
          background: radial-gradient(circle, rgba(200,41,59,0.07), transparent 70%);
        }
        .light .welcome-orb-gold {
          background: radial-gradient(circle, rgba(212,168,67,0.1), transparent 70%);
        }
      `})]})}export{c as default};