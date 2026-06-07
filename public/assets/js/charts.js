// Lightweight canvas charts (no external deps). Used in KPI pages (stage 4).
// API: AsgardCharts.stackedBar(canvas, rows, opts), AsgardCharts.divergent(canvas, rows, opts)

window.AsgardCharts = (function(){
  function clamp(n,a,b){ return Math.max(a, Math.min(b,n)); }

  function themeVar(name, fallback){
    try{
      const v = getComputedStyle(document.documentElement).getPropertyValue(name);
      return (v||'').trim() || fallback;
    }catch(e){ return fallback; }
  }

  function resolveColor(c){
    if(!c || typeof c !== 'string') return c;
    var m = c.match(/^var\(--([^)]+)\)$/);
    if(m) return themeVar('--' + m[1], c);
    return c;
  }

  function hiDpi(canvas){
    const dpr = window.devicePixelRatio || 1;
    const rect = canvas.getBoundingClientRect();
    const w = Math.max(1, Math.round(rect.width * dpr));
    const h = Math.max(1, Math.round(rect.height * dpr));
    if(canvas.width!==w) canvas.width=w;
    if(canvas.height!==h) canvas.height=h;
    const ctx = canvas.getContext('2d');
    ctx.setTransform(dpr,0,0,dpr,0,0);
    return ctx;
  }

  function clear(ctx, w, h){
    // Always paint a subtle dark backdrop so charts are readable in dark UI
    ctx.clearRect(0,0,w,h);
    try{
      const bg = themeVar("--paper2", themeVar("--bg2", "rgba(13,20,40,.25)"));
      ctx.save();
      ctx.fillStyle = bg;
      ctx.globalAlpha = 0.55;
      ctx.fillRect(0,0,w,h);
      ctx.restore();
    }catch(e){ /* ignore */ }
  }

  function text(ctx, s, x, y, opts={}){
    ctx.save();
    if(opts.font) ctx.font = opts.font;
    if(opts.fill) ctx.fillStyle = opts.fill;
    ctx.textBaseline = opts.base || 'alphabetic';
    ctx.textAlign = opts.align || 'left';
    ctx.fillText(String(s), x, y);
    ctx.restore();
  }

  // rows: [{label, total, parts:[{key, value, color, label}]}]

  // stackedBar supports 3 historical row shapes:
  //  A) rows: [{label, total, parts:[{key,value,color,label}]}] (native)
  //  B) rows: [{label, segments:[{key,value}]}], opts: {colorMap}
  //  C) rows: [{label, series:[{key,value}]}], opts: {seriesOrder, colors, legend, valueFmt}
  function stackedBar(canvas, rows, opts={}){
    const ink = themeVar("--text", "#e8eefc");
    const muted = themeVar("--muted", "#a9b7d0");

    // Normalize rows to native format
    const norm = (rows||[]).map(r=>{
      if(r && Array.isArray(r.parts)){
        const total = (r.total!=null) ? Number(r.total||0) : (r.parts||[]).reduce((s,p)=>s+Number(p.value||0),0);
        return { label: r.label||"", total, parts: (r.parts||[]).map(p=>({key:p.key, value:Number(p.value||0), color:p.color, label:p.label||p.key})) };
      }
      if(r && Array.isArray(r.segments)){
        const total = r.segments.reduce((s,p)=>s+Number(p.value||0),0);
        const colorMap = opts.colorMap || {};
        const parts = r.segments.map(p=>({key:p.key, value:Number(p.value||0), color: colorMap[p.key], label: p.key}));
        return { label: r.label||"", total, parts };
      }
      if(r && Array.isArray(r.series)){
        const order = opts.seriesOrder || (r.series||[]).map(x=>x.key);
        const colors = opts.colors || {};
        const legend = opts.legend || {};
        const byKey = new Map((r.series||[]).map(x=>[x.key, Number(x.value||0)]));
        const parts = order.map(k=>({key:k, value:Number(byKey.get(k)||0), color: colors[k], label: legend[k]||k}));
        const total = parts.reduce((s,p)=>s+p.value,0);
        return { label: r.label||"", total, parts };
      }
      return { label: (r&&r.label)||"", total: Number(r&&r.total||0), parts: [] };
    });

    // Mobile-responsive parameters
    const _isMob = window.innerWidth <= 768;
    const rowH = opts.rowH || (_isMob ? 20 : 22);
    const pad = opts.pad || (_isMob ? 8 : 12);
    const left = opts.left || (_isMob ? 90 : 210);
    const gap = opts.gap || (_isMob ? 8 : 10);

    const h = pad*2 + norm.length*(rowH+gap) - gap + (opts.footerH||28);
    canvas.style.width = '100%';
    canvas.style.height = `${h}px`;

    const ctx = hiDpi(canvas);
    clear(ctx, canvas.clientWidth, canvas.clientHeight);

    const max = Math.max(1, ...norm.map(r=>r.total||0));
    const barW = Math.max(80, (canvas.clientWidth - left - pad - 70));

    // grid
    ctx.save();
    ctx.strokeStyle = 'rgba(42,59,102,.18)';
    ctx.lineWidth = 1;
    const ticks = _isMob ? 3 : 4;
    for(let i=0;i<=ticks;i++){
      const x = left + (barW/ticks)*i;
      ctx.beginPath();
      ctx.moveTo(x, pad-6);
      ctx.lineTo(x, h-pad+6);
      ctx.stroke();
    }
    ctx.restore();

    const valueFmt = (typeof opts.valueFmt === 'function') ? opts.valueFmt : (v)=>String(v);

    norm.forEach((r, idx)=>{
      const y = pad + idx*(rowH+gap);
      var _labelFont = _isMob ? '10px system-ui' : '12px system-ui';
      var _labelStr = r.label || '';
      if (_isMob && _labelStr.length > 12) _labelStr = _labelStr.substring(0, 11) + '…';
      text(ctx, _labelStr, pad, y+rowH*0.72, {font:_labelFont, fill:ink});

      const bw = (r.total/max)*barW;
      // background track
      ctx.save();
      ctx.fillStyle='rgba(42,59,102,.12)';
      roundRect(ctx, left, y, barW, rowH, 999); ctx.fill();
      ctx.restore();

      let x0 = left;
      const denom = Math.max(1, r.total||0);
      for(const p of (r.parts||[])){
        const w = (p.value/denom)*bw;
        if(w<=0) continue;
        ctx.save();
        ctx.fillStyle = resolveColor(p.color) || 'rgba(242,208,138,.95)';
        roundRect(ctx, x0, y, w, rowH, 999); ctx.fill();
        ctx.restore();
        x0 += w;
      }
      text(ctx, valueFmt(r.total||0), left+barW+(_isMob?4:10), y+rowH*0.72, {font:(_isMob?'9px system-ui':'12px system-ui'), fill:muted});
    });

    // legend (support both array and map)
    const legendItems = [];
    if(Array.isArray(opts.legend)){
      legendItems.push(...opts.legend.map(it=>({label:it.label, color:it.color})));
    }else if(opts.legend && typeof opts.legend==='object'){
      const colors = opts.colors || {};
      for(const [k,lbl] of Object.entries(opts.legend)){
        legendItems.push({label: lbl, color: resolveColor(colors[k]) || 'rgba(242,208,138,.95)'});
      }
    }else if(opts.colorMap && typeof opts.colorMap==='object' && norm.length){
      const keys = (norm[0].parts||[]).map(p=>p.key);
      for(const k of keys){ legendItems.push({label:k, color: resolveColor(opts.colorMap[k]) || 'rgba(242,208,138,.95)'}); }
    }

    if(legendItems.length){
      const ly = h - 22;
      let lx = pad;
      for(const it of legendItems){
        ctx.save();
        ctx.fillStyle = resolveColor(it.color) || 'rgba(242,208,138,.95)';
        ctx.fillRect(lx, ly, 10, 10);
        ctx.restore();
        text(ctx, it.label, lx+14, ly+10, {font:(_isMob?'9px system-ui':'11px system-ui'), fill:muted, base:'alphabetic'});
        var _charW = _isMob ? 5 : 6.2;
        lx += 14 + (String(it.label).length * _charW) + (_isMob ? 8 : 14);
        if(lx > canvas.clientWidth - (_isMob ? 60 : 120)){ lx = pad; ly += 16; }
      }
    }
  }


  // rows: [{label, a, b}] where a=deltaDays, b=deltaCost
  function divergent(canvas, rows, opts={}){
    const ink = themeVar("--text", "#e8eefc");
    const muted = themeVar("--muted", "#a9b7d0");
    const _isMobD = window.innerWidth <= 768;
    const pad = opts.pad || (_isMobD ? 8 : 12);
    const left = opts.left || (_isMobD ? 90 : 210);
    const rowH = opts.rowH || (_isMobD ? 24 : 28);
    const gap = opts.gap || (_isMobD ? 8 : 10);
    const h = pad*2 + rows.length*(rowH+gap) - gap + 36;
    canvas.style.width = '100%';
    canvas.style.height = `${h}px`;
    const ctx = hiDpi(canvas);
    clear(ctx, canvas.clientWidth, canvas.clientHeight);

    const w = canvas.clientWidth;
    const barW = Math.max(120, w - left - pad - 18);
    const mid = left + barW/2;

    const maxA = Math.max(1, ...rows.map(r=>Math.abs(Number(r.a||0))));
    const maxB = Math.max(1, ...rows.map(r=>Math.abs(Number(r.b||0))));

    // center line
    ctx.save();
    ctx.strokeStyle='rgba(42,59,102,.35)';
    ctx.lineWidth=1;
    ctx.beginPath(); ctx.moveTo(mid, pad-6); ctx.lineTo(mid, h-pad+6); ctx.stroke();
    ctx.restore();

    rows.forEach((r, idx)=>{
      const y = pad + idx*(rowH+gap);
      var _dlFont = _isMobD ? '10px system-ui' : '12px system-ui';
      var _dlStr = r.label || '';
      if (_isMobD && _dlStr.length > 12) _dlStr = _dlStr.substring(0, 11) + '…';
      text(ctx, _dlStr, pad, y+rowH*0.70, {font:_dlFont, fill:ink});

      // two lanes within row
      const laneH = (rowH-6)/2;
      const y1 = y;
      const y2 = y + laneH + 6;

      drawDBar(ctx, mid, y1, barW/2, laneH, Number(r.a||0), maxA, 'Δ срок (дн)', opts);
      drawDBar(ctx, mid, y2, barW/2, laneH, Number(r.b||0), maxB, 'Δ себест (₽)', opts);
    });

    // legend labels
    text(ctx, 'Δ срок (дн)', left, h-16, {font:'11px system-ui', fill:muted});
    text(ctx, 'Δ себест (₽)', left+120, h-16, {font:'11px system-ui', fill:muted});
  }

  function drawDBar(ctx, mid, y, halfW, h, val, maxAbs, _lbl, _opts){
    const good = val<=0;
    const color = good ? 'rgba(34,197,94,.85)' : 'rgba(224,58,74,.85)';
    const w = clamp(Math.abs(val)/Math.max(1,maxAbs), 0, 1) * (halfW-6);
    const x = good ? (mid - w) : mid;
    ctx.save();
    ctx.fillStyle='rgba(42,59,102,.10)';
    roundRect(ctx, mid-halfW, y, halfW*2, h, 999); ctx.fill();
    ctx.fillStyle=color;
    roundRect(ctx, x, y, w, h, 999); ctx.fill();
    ctx.restore();
  }

  function roundRect(ctx, x, y, w, h, r){
    const rr = Math.min(r, h/2, w/2);
    ctx.beginPath();
    ctx.moveTo(x+rr, y);
    ctx.arcTo(x+w, y, x+w, y+h, rr);
    ctx.arcTo(x+w, y+h, x, y+h, rr);
    ctx.arcTo(x, y+h, x, y, rr);
    ctx.arcTo(x, y, x+w, y, rr);
    ctx.closePath();
  }

  // dial gauge: 0% at top, negative (better) to the right (green), positive (worse) to the left (red)
  function dial(canvas, valuePct, opts={}){
    const ink = themeVar("--text", "#e8eefc");
    const muted = themeVar("--muted", "#a9b7d0");
    const pad = opts.pad || 10;
    const W = canvas.clientWidth || 220;
    const H = canvas.clientHeight || 140;
    // keep a stable aspect in CSS
    if(!canvas.style.height) canvas.style.height = (opts.height||140) + 'px';
    const ctx = hiDpi(canvas);
    clear(ctx, canvas.clientWidth, canvas.clientHeight);

    const w = canvas.clientWidth;
    const h = canvas.clientHeight;
    const cx = w/2;
    const cy = h*0.70;
    const r = Math.min(w, h)*0.42;

    const maxAbs = Number.isFinite(opts.maxAbs) ? Math.max(1, Math.abs(opts.maxAbs)) : 100;
    const v = Number(valuePct||0);
    const vv = clamp(v, -maxAbs, maxAbs);

    // arcs
    ctx.save();
    ctx.lineWidth = 10;
    ctx.lineCap = 'round';
    // right (green): 0 -> +90deg clockwise for negative values
    ctx.strokeStyle = 'rgba(34,197,94,.70)';
    ctx.beginPath();
    ctx.arc(cx, cy, r, -Math.PI/2, 0, false);
    ctx.stroke();
    // left (red): 0 -> -90deg counterclockwise for positive values
    ctx.strokeStyle = 'rgba(220,38,38,.70)';
    ctx.beginPath();
    ctx.arc(cx, cy, r, -Math.PI, -Math.PI/2, false);
    ctx.stroke();

    // ticks
    ctx.strokeStyle = 'rgba(42,59,102,.35)';
    ctx.lineWidth = 1;
    for(let i=-90;i<=90;i+=30){
      const a = (-Math.PI/2) + (i*Math.PI/180);
      const x1 = cx + Math.cos(a)*(r-8);
      const y1 = cy + Math.sin(a)*(r-8);
      const x2 = cx + Math.cos(a)*(r+6);
      const y2 = cy + Math.sin(a)*(r+6);
      ctx.beginPath(); ctx.moveTo(x1,y1); ctx.lineTo(x2,y2); ctx.stroke();
    }
    ctx.restore();

    // pointer: map [-maxAbs..maxAbs] to [+90..-90] degrees
    const frac = vv / maxAbs;
    const ang = (-Math.PI/2) + (-frac)*(Math.PI/2); // positive -> left

    ctx.save();
    ctx.strokeStyle = (vv<=0) ? 'rgba(34,197,94,.95)' : 'rgba(220,38,38,.95)';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(cx, cy);
    ctx.lineTo(cx + Math.cos(ang)*(r-14), cy + Math.sin(ang)*(r-14));
    ctx.stroke();
    ctx.fillStyle = ctx.strokeStyle;
    ctx.beginPath(); ctx.arc(cx, cy, 4, 0, Math.PI*2); ctx.fill();
    ctx.restore();

    // labels
    const title = opts.title || '';
    const valStr = (typeof opts.valueFmt==='function') ? opts.valueFmt(v) : `${Math.round(v)}%`;
    text(ctx, title, cx, pad+10, {font:'12px system-ui', fill:muted, align:'center'});
    text(ctx, valStr, cx, cy+22, {font:'18px system-ui', fill:ink, align:'center'});
    const hint = opts.hint || (vv<=0 ? 'факт лучше плана' : 'факт хуже плана');
    text(ctx, hint, cx, cy+40, {font:'11px system-ui', fill:muted, align:'center'});
  }



  // Score ring: circular progress indicator 0-100
  function scoreRing(canvas, score, opts={}){
    const ink = themeVar("--text", "#e8eefc");
    const muted = themeVar("--muted", "#a9b7d0");
    const W = canvas.clientWidth || 160;
    const H = canvas.clientHeight || 160;
    if(!canvas.style.height) canvas.style.height = (opts.height||160) + 'px';
    const ctx = hiDpi(canvas);
    clear(ctx, canvas.clientWidth, canvas.clientHeight);
    const w = canvas.clientWidth;
    const h = canvas.clientHeight;
    const cx = w/2;
    const cy = h/2;
    const r = Math.min(w, h)*0.38;
    const lw = opts.lineWidth || 12;
    const s = clamp(Number(score)||0, 0, 100);
    ctx.save();
    ctx.lineWidth = lw;
    ctx.lineCap = 'round';
    ctx.strokeStyle = 'rgba(42,59,102,.25)';
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI*2);
    ctx.stroke();
    const color = s >= 75 ? 'rgba(34,197,94,.90)' : s >= 50 ? 'rgba(245,158,11,.90)' : s >= 25 ? 'rgba(249,115,22,.90)' : 'rgba(220,38,38,.90)';
    ctx.strokeStyle = color;
    ctx.beginPath();
    ctx.arc(cx, cy, r, -Math.PI/2, -Math.PI/2 + (s/100)*Math.PI*2, false);
    ctx.stroke();
    ctx.restore();
    text(ctx, Math.round(s).toString(), cx, cy+8, {font:'bold 28px system-ui', fill:ink, align:'center'});
    const _lbl = (opts.label != null) ? opts.label : '\u0431\u0430\u043b\u043b';
    if(_lbl) text(ctx, _lbl, cx, cy+26, {font:'11px system-ui', fill:muted, align:'center'});
    if(opts.subtitle){
      text(ctx, opts.subtitle, cx, cy-r-8, {font:'11px system-ui', fill:muted, align:'center'});
    }
  }

  // lineArea: линейный график с заливкой под линией. Для динамики (готовность,
  // выручка, победы по месяцам). Поддерживает несколько серий.
  //  series: [{ name, color, points:[{x:label, y:number}] }]  (x — подписи общие по первой серии)
  //  opts: { yMax, yFmt(v), height, legend:true, area:true }
  function lineArea(canvas, series, opts={}){
    const ink = themeVar("--text", "#e8eefc");
    const muted = themeVar("--muted", "#a9b7d0");
    if(!canvas.style.height) canvas.style.height = (opts.height||220) + 'px';
    const ctx = hiDpi(canvas);
    const W = canvas.clientWidth, H = canvas.clientHeight;
    clear(ctx, W, H);
    const list = (series||[]).filter(s => s && Array.isArray(s.points) && s.points.length);
    if(!list.length){ text(ctx, 'Нет данных', W/2, H/2, {font:'13px system-ui', fill:muted, align:'center'}); return; }

    const padL = 44, padR = 14, padT = 14, padB = 26;
    const plotW = Math.max(1, W - padL - padR);
    const plotH = Math.max(1, H - padT - padB);
    const labels = list[0].points.map(p => p.x);
    const n = labels.length;
    let yMax = opts.yMax;
    if(yMax == null){
      yMax = 0;
      list.forEach(s => s.points.forEach(p => { yMax = Math.max(yMax, Number(p.y)||0); }));
      yMax = yMax > 0 ? yMax * 1.1 : 1;
    }
    const yFmt = opts.yFmt || (v => Math.round(v));
    const xAt = i => padL + (n <= 1 ? plotW/2 : (i/(n-1))*plotW);
    const yAt = v => padT + plotH - (clamp(Number(v)||0, 0, yMax)/yMax)*plotH;

    // Сетка + ось Y (4 деления)
    ctx.save();
    ctx.strokeStyle = 'rgba(120,140,180,.18)';
    ctx.lineWidth = 1;
    ctx.fillStyle = muted; ctx.font = '10px system-ui'; ctx.textAlign = 'right'; ctx.textBaseline = 'middle';
    for(let g=0; g<=4; g++){
      const val = yMax * (g/4);
      const yy = yAt(val);
      ctx.beginPath(); ctx.moveTo(padL, yy); ctx.lineTo(W-padR, yy); ctx.stroke();
      ctx.fillText(yFmt(val), padL-6, yy);
    }
    // Подписи X (прорежаем если много)
    ctx.textAlign = 'center'; ctx.textBaseline = 'top';
    const step = Math.ceil(n/8);
    labels.forEach((lb, i) => {
      if(i % step !== 0 && i !== n-1) return;
      ctx.fillText(String(lb), xAt(i), H - padB + 6);
    });
    ctx.restore();

    // Серии
    list.forEach((s, si) => {
      const color = resolveColor(s.color) || ['#3b82f6','#22c55e','#e0a500','#a855f7','#ef4444'][si % 5];
      const pts = s.points.map((p,i) => ({ x: xAt(i), y: yAt(p.y) }));
      if(opts.area !== false){
        ctx.save();
        const grad = ctx.createLinearGradient(0, padT, 0, padT+plotH);
        grad.addColorStop(0, hexA(color, .28));
        grad.addColorStop(1, hexA(color, .02));
        ctx.fillStyle = grad;
        ctx.beginPath();
        ctx.moveTo(pts[0].x, padT+plotH);
        pts.forEach(p => ctx.lineTo(p.x, p.y));
        ctx.lineTo(pts[pts.length-1].x, padT+plotH);
        ctx.closePath(); ctx.fill();
        ctx.restore();
      }
      ctx.save();
      ctx.strokeStyle = color; ctx.lineWidth = 2.5; ctx.lineJoin = 'round'; ctx.lineCap = 'round';
      ctx.beginPath();
      pts.forEach((p,i) => i ? ctx.lineTo(p.x,p.y) : ctx.moveTo(p.x,p.y));
      ctx.stroke();
      ctx.fillStyle = color;
      pts.forEach(p => { ctx.beginPath(); ctx.arc(p.x, p.y, 2.5, 0, Math.PI*2); ctx.fill(); });
      ctx.restore();
    });

    // Легенда
    if(opts.legend && list.length > 1){
      let lx = padL;
      ctx.save(); ctx.font = '11px system-ui'; ctx.textBaseline = 'middle'; ctx.textAlign = 'left';
      list.forEach((s, si) => {
        const color = resolveColor(s.color) || ['#3b82f6','#22c55e','#e0a500','#a855f7','#ef4444'][si % 5];
        ctx.fillStyle = color; ctx.fillRect(lx, padT-8, 10, 10);
        ctx.fillStyle = ink; ctx.fillText(s.name || ('Серия '+(si+1)), lx+14, padT-3);
        lx += 14 + ctx.measureText(s.name || '').width + 24;
      });
      ctx.restore();
    }
  }

  // hex/rgb + alpha → rgba-строка (для градиентной заливки lineArea)
  function hexA(c, a){
    c = resolveColor(c) || '#3b82f6';
    if(/^#([0-9a-f]{6})$/i.test(c)){
      const r=parseInt(c.slice(1,3),16), g=parseInt(c.slice(3,5),16), b=parseInt(c.slice(5,7),16);
      return `rgba(${r},${g},${b},${a})`;
    }
    const m = c.match(/^rgba?\(([^)]+)\)$/);
    if(m){ const p=m[1].split(',').map(s=>s.trim()); return `rgba(${p[0]},${p[1]},${p[2]},${a})`; }
    return `rgba(59,130,246,${a})`;
  }

  return { stackedBar, divergent, dial, scoreRing, lineArea };
})();
