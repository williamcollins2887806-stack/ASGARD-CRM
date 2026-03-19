(function(){
  Router.register('/assembly', async()=>{
    var page=M.Page({title:'Сборка',back:true});
    var roles=['PM','HEAD_PM','WAREHOUSE','ADMIN','DIRECTOR_GEN','DIRECTOR_COMM','DIRECTOR_DEV'];
    if(window._user && !roles.includes(window._user.role)){
      page.innerHTML='<div style="padding:40px 20px;text-align:center;color:var(--t2)">' +
        '<div style="font-size:48px;margin-bottom:12px">🔒</div>' +
        '<div style="font-size:15px;font-weight:600;margin-bottom:6px">Доступ ограничен</div>' +
        '<div style="font-size:13px">Модуль сборки доступен руководителям проектов и кладовщикам.</div></div>';
      return page;
    }
    var html='<div style="padding:24px 20px;text-align:center">' +
      '<div style="font-size:48px;margin-bottom:12px">🏗️</div>' +
      '<div style="font-size:17px;font-weight:700;color:var(--t1);margin-bottom:8px">Сборка</div>' +
      '<div style="font-size:13px;color:var(--t2);margin-bottom:20px;line-height:1.5">' +
        'Ведомости мобилизации и демобилизации. Визуальная сборка паллетов, ' +
        'отправка, приёмка. Полная версия с перетаскиванием — на десктопе.</div>' +
      '<div id="asm-mob-stats" style="margin-bottom:20px"></div>' +
      '<a href="/#/assembly" style="display:inline-block;padding:12px 24px;' +
        'background:linear-gradient(135deg,#e53935,#1e88e5);color:#fff;border-radius:12px;' +
        'font-size:14px;font-weight:600;text-decoration:none">Открыть на десктопе →</a></div>';
    page.innerHTML=html;
    M.api('GET','/api/assembly?limit=3').then(function(r){
      var el=document.getElementById('asm-mob-stats');
      if(!el||!r.ok) return;
      var list=r.data.items||[];
      if(!list.length){ el.innerHTML='<div style="font-size:13px;color:var(--t2)">Нет активных ведомостей</div>'; return; }
      var h='<div style="text-align:left">';
      list.forEach(function(a){
        var st={'draft':'⚪','confirmed':'🟡','packing':'🟠','packed':'🟢','in_transit':'🚛','delivered':'📦','received':'✅'}[a.status]||'⚪';
        h+='<div style="padding:8px 12px;margin:4px 0;background:var(--bg2);border-radius:10px;font-size:13px">' +
          st+' <b>'+((a.work_title||'').substring(0,30))+'</b> — '+(a.type==='mobilization'?'Моб':'Демоб') +
          '<span style="float:right;color:var(--t2);font-size:11px">'+a.status+'</span></div>';
      });
      h+='</div>';
      el.innerHTML=h;
    }).catch(function(){});
    return page;
  });
})();
