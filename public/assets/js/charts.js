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
      const bg = themeVar("--paper2", "rgba(13,20,40,.25)");
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

    const rowH = opts.rowH || 22;
    const pad = opts.pad || 12;
    const left = opts.left || 210;
    const gap = opts.gap || 10;

    const h = pad*2 + norm.length*(rowH+gap) - gap + (opts.footerH||0);
    canvas.style.height = `${h}px`;

    const ctx = hiDpi(canvas);
    clear(ctx, canvas.clientWidth, canvas.clientHeight);

    const max = Math.max(1, ...norm.map(r=>r.total||0));
    const barW = Math.max(80, (canvas.clientWidth - left - pad - 70));

    // grid
    ctx.save();
    ctx.strokeStyle = 'rgba(42,59,102,.18)';
    ctx.lineWidth = 1;
    const ticks = 4;
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
      text(ctx, r.label||'', pad, y+rowH*0.72, {font:'12px system-ui', fill:ink});

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
        ctx.fillStyle = p.color || 'rgba(242,208,138,.95)';
        roundRect(ctx, x0, y, w, rowH, 999); ctx.fill();
        ctx.restore();
        x0 += w;
      }
      text(ctx, valueFmt(r.total||0), left+barW+10, y+rowH*0.72, {font:'12px system-ui', fill:muted});
    });

    // legend (support both array and map)
    const legendItems = [];
    if(Array.isArray(opts.legend)){
      legendItems.push(...opts.legend.map(it=>({label:it.label, color:it.color})));
    }else if(opts.legend && typeof opts.legend==='object'){
      const colors = opts.colors || {};
      for(const [k,lbl] of Object.entries(opts.legend)){
        legendItems.push({label: lbl, color: colors[k] || 'rgba(242,208,138,.95)'});
      }
    }else if(opts.colorMap && typeof opts.colorMap==='object' && norm.length){
      const keys = (norm[0].parts||[]).map(p=>p.key);
      for(const k of keys){ legendItems.push({label:k, color: opts.colorMap[k] || 'rgba(242,208,138,.95)'}); }
    }

    if(legendItems.length){
      const ly = h - pad + 6;
      let lx = pad;
      for(const it of legendItems){
        ctx.save();
        ctx.fillStyle = it.color || 'rgba(242,208,138,.95)';
        ctx.fillRect(lx, ly, 10, 10);
        ctx.restore();
        text(ctx, it.label, lx+14, ly+10, {font:'11px system-ui', fill:muted, base:'alphabetic'});
        lx += 14 + (String(it.label).length*6.2) + 14;
        if(lx > canvas.clientWidth - 120){ lx = pad; }
      }
    }
  }


  // rows: [{label, a, b}] where a=deltaDays, b=deltaCost
  function divergent(canvas, rows, opts={}){
    const ink = themeVar("--text", "#e8eefc");
    const muted = themeVar("--muted", "#a9b7d0");
    const pad = opts.pad || 12;
    const left = opts.left || 210;
    const rowH = opts.rowH || 28;
    const gap = opts.gap || 10;
    const h = pad*2 + rows.length*(rowH+gap) - gap + 18;
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
      text(ctx, r.label||'', pad, y+rowH*0.70, {font:'12px system-ui', fill:ink});

      // two lanes within row
      const laneH = (rowH-6)/2;
      const y1 = y;
      const y2 = y + laneH + 6;

      drawDBar(ctx, mid, y1, barW/2, laneH, Number(r.a||0), maxA, 'Δ срок (дн)', opts);
      drawDBar(ctx, mid, y2, barW/2, laneH, Number(r.b||0), maxB, 'Δ себест (₽)', opts);
    });

    // legend labels
    text(ctx, 'Δ срок (дн)', left, h-pad+14, {font:'11px system-ui', fill:muted});
    text(ctx, 'Δ себест (₽)', left+120, h-pad+14, {font:'11px system-ui', fill:muted});
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


  return { stackedBar, divergent, dial };
})();
