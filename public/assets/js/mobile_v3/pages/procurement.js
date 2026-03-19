(function(){
  Router.register('/procurement', async()=>{
    var page=M.Page({title:'Закупки',back:true});
    var roles=['PM','HEAD_PM','PROC','ADMIN','DIRECTOR_GEN','DIRECTOR_COMM','DIRECTOR_DEV','BUH'];
    if(window._user && !roles.includes(window._user.role)){
      page.innerHTML='<div style="padding:40px 20px;text-align:center;color:var(--t2)">' +
        '<div style="font-size:48px;margin-bottom:12px">🔒</div>' +
        '<div style="font-size:15px;font-weight:600;margin-bottom:6px">Доступ ограничен</div>' +
        '<div style="font-size:13px">Модуль закупок доступен руководителям проектов, закупщикам и бухгалтерии.</div></div>';
      return page;
    }
    // Загрузить краткую сводку заявок для текущего пользователя
    var html='<div style="padding:24px 20px;text-align:center">' +
      '<div style="font-size:48px;margin-bottom:12px">📋</div>' +
      '<div style="font-size:17px;font-weight:700;color:var(--t1);margin-bottom:8px">Закупки</div>' +
      '<div style="font-size:13px;color:var(--t2);margin-bottom:20px;line-height:1.5">' +
        'Создание и согласование заявок на закупку оборудования и материалов. ' +
        'Полная версия доступна на десктопе.</div>' +
      '<div id="proc-mob-stats" style="margin-bottom:20px"></div>' +
      '<a href="/#/procurement" style="display:inline-block;padding:12px 24px;' +
        'background:var(--accent,#2196F3);color:#fff;border-radius:12px;font-size:14px;' +
        'font-weight:600;text-decoration:none">Открыть на десктопе →</a></div>';
    page.innerHTML=html;
    // Мини-статистика
    M.api('GET','/api/procurement?limit=1&offset=0').then(function(r){
      var el=document.getElementById('proc-mob-stats');
      if(!el||!r.ok) return;
      var total=r.data.total||0;
      el.innerHTML='<div style="display:flex;justify-content:center;gap:16px;margin:8px 0">' +
        '<div style="padding:8px 16px;background:var(--bg2);border-radius:10px">' +
          '<div style="font-size:20px;font-weight:700;color:var(--t1)">'+total+'</div>' +
          '<div style="font-size:11px;color:var(--t2)">Заявок</div></div></div>';
    }).catch(function(){});
    return page;
  });
})();
