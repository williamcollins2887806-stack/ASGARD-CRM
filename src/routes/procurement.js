'use strict';

const { randomUUID } = require('crypto');

const PM_ROLES = ['PM', 'HEAD_PM'];
const PROC_ROLES = ['PROC', 'ADMIN'];
const DIR_ROLES = ['ADMIN', 'DIRECTOR_GEN', 'DIRECTOR_COMM', 'DIRECTOR_DEV'];
const BUH_ROLES = ['BUH', 'ADMIN'];
const WH_ROLES = ['WAREHOUSE', 'ADMIN'];
const READ_ALL_ROLES = [...new Set([...DIR_ROLES, ...PROC_ROLES, ...BUH_ROLES, 'HEAD_PM', 'WAREHOUSE'])];

async function routes(fastify) {
  const db = fastify.db;
  const { createNotification } = require('../services/notify');

  // ═══ HELPERS ═══

  async function logHistory(c, procId, actorId, action, oldSt, newSt, comment, changes) {
    await c.query(`INSERT INTO procurement_history (procurement_id,actor_id,action,old_status,new_status,comment,changes_json)
      VALUES ($1,$2,$3,$4,$5,$6,$7)`, [procId, actorId, action, oldSt, newSt, comment||null, changes?JSON.stringify(changes):null]);
  }

  async function recalcTotal(c, procId) {
    await c.query(`UPDATE procurement_requests SET total_sum=(SELECT COALESCE(SUM(total_price),0) FROM procurement_items WHERE procurement_id=$1), updated_at=NOW() WHERE id=$1`, [procId]);
  }

  async function checkNotLocked(c, procId) {
    const {rows} = await c.query('SELECT locked,pm_id,status FROM procurement_requests WHERE id=$1', [procId]);
    if (!rows[0]) return {error:'Заявка не найдена',code:404};
    if (rows[0].locked) return {error:'Заблокирована после согласования директором',code:409};
    return {row:rows[0]};
  }

  function canViewAll(role) { return READ_ALL_ROLES.includes(role); }

  async function getProcCheck(c, id, statuses) {
    const {rows} = await c.query('SELECT * FROM procurement_requests WHERE id=$1', [id]);
    if (!rows[0]) return {error:'Не найдена',code:404};
    if (!statuses.includes(rows[0].status)) return {error:`Недопустимый переход из "${rows[0].status}"`,code:409};
    return {row:rows[0]};
  }

  function valNum(v, name) {
    if (v===undefined||v===null||v==='') return null;
    const n=parseFloat(v); if(isNaN(n)) return `${name} должен быть числом`;
    if(n<0) return `${name} не может быть отрицательным`; return null;
  }

  async function transitionStatus(req, reply, opts) {
    const {allowedRoles,fromStatuses,toStatus,extraUpdates,afterTransition} = opts;
    const id = parseInt(req.params.id);
    if (isNaN(id)) return reply.code(400).send({error:'Неверный ID'});
    const user = req.user;
    if (!allowedRoles.includes(user.role)) return reply.code(403).send({error:'Нет прав'});
    const client = await db.pool.connect();
    try {
      await client.query('BEGIN');
      const proc = await getProcCheck(client, id, fromStatuses);
      if (proc.error) { await client.query('ROLLBACK'); return reply.code(proc.code).send({error:proc.error}); }
      const oldSt = proc.row.status;
      const upd = {status:toStatus};
      if (extraUpdates) Object.assign(upd, extraUpdates(user, proc.row, req));
      const sets = Object.entries(upd).map(([k],i)=>`${k}=$${i+1}`);
      sets.push('updated_at=NOW()');
      const vals = Object.values(upd); vals.push(id);
      const {rows} = await client.query(`UPDATE procurement_requests SET ${sets.join(',')} WHERE id=$${vals.length} RETURNING *`, vals);
      await logHistory(client, id, user.id, `status_${toStatus}`, oldSt, toStatus, req.body?.comment||null, null);
      if (afterTransition) await afterTransition(client, rows[0], user);
      await client.query('COMMIT');
      return {item:rows[0]};
    } catch(e) { await client.query('ROLLBACK'); throw e; }
    finally { client.release(); }
  }

  // ═══ СТАТИЧЕСКИЕ РОУТЫ (ДО /:id) ═══

  fastify.get('/dashboard', {preHandler:[fastify.requireRoles([...PROC_ROLES,...DIR_ROLES])]}, async()=>{
    const counts = await db.query(`SELECT status,COUNT(*) as cnt FROM procurement_requests WHERE status NOT IN('closed','dir_rejected') GROUP BY status`);
    const overdue = await db.query(`SELECT pr.id,pr.title,pr.delivery_deadline,pr.work_id,w.work_title,pr.pm_id,u.name as pm_name,
      CURRENT_DATE-pr.delivery_deadline as days_overdue FROM procurement_requests pr LEFT JOIN works w ON pr.work_id=w.id
      LEFT JOIN users u ON pr.pm_id=u.id WHERE pr.status IN('paid','partially_delivered') AND pr.delivery_deadline IS NOT NULL
      AND pr.delivery_deadline<CURRENT_DATE AND pr.delivered_at IS NULL ORDER BY pr.delivery_deadline`);
    const upcoming = await db.query(`SELECT pr.id,pr.title,pr.delivery_deadline,w.work_title,u.name as pm_name,
      pr.delivery_deadline-CURRENT_DATE as days_left FROM procurement_requests pr LEFT JOIN works w ON pr.work_id=w.id
      LEFT JOIN users u ON pr.pm_id=u.id WHERE pr.status IN('paid','partially_delivered') AND pr.delivery_deadline IS NOT NULL
      AND pr.delivery_deadline>=CURRENT_DATE AND pr.delivery_deadline<=CURRENT_DATE+INTERVAL '7 days' AND pr.delivered_at IS NULL ORDER BY pr.delivery_deadline`);
    const pending = await db.query(`SELECT pr.id,pr.title,pr.created_at,pr.work_id,w.work_title,u.name as pm_name,
      (SELECT COUNT(*) FROM procurement_items pi WHERE pi.procurement_id=pr.id) as items_count FROM procurement_requests pr
      LEFT JOIN works w ON pr.work_id=w.id LEFT JOIN users u ON pr.pm_id=u.id WHERE pr.status='sent_to_proc' ORDER BY pr.created_at`);
    return {counts:counts.rows,overdue:overdue.rows,upcoming:upcoming.rows,pending_proc:pending.rows};
  });

  fastify.get('/export/excel', {preHandler:[fastify.requireRoles([...PM_ROLES,...PROC_ROLES,...DIR_ROLES,...BUH_ROLES])]}, async(req,reply)=>{
    const ExcelJS=require('exceljs'); const user=req.user; const{status,pm_id,work_id}=req.query;
    let sql=`SELECT pr.*,u.name as pm_name,w.work_title,pc.name as proc_name,
      (SELECT COUNT(*) FROM procurement_items pi WHERE pi.procurement_id=pr.id) as items_count,
      (SELECT COALESCE(SUM(pi.total_price),0) FROM procurement_items pi WHERE pi.procurement_id=pr.id) as items_total
      FROM procurement_requests pr LEFT JOIN users u ON pr.pm_id=u.id LEFT JOIN works w ON pr.work_id=w.id
      LEFT JOIN users pc ON pr.proc_id=pc.id WHERE 1=1`;
    const p=[]; let i=1;
    if(!canViewAll(user.role)){sql+=` AND pr.pm_id=$${i++}`;p.push(user.id);}
    if(status){sql+=` AND pr.status=$${i++}`;p.push(status);}
    if(pm_id){sql+=` AND pr.pm_id=$${i++}`;p.push(pm_id);}
    if(work_id){sql+=` AND pr.work_id=$${i++}`;p.push(work_id);}
    sql+=` ORDER BY pr.id DESC LIMIT 1000`;
    const{rows}=await db.query(sql,p);
    const wb=new ExcelJS.Workbook();const ws=wb.addWorksheet('Реестр');
    ws.columns=[{header:'№',key:'id',width:8},{header:'Дата',key:'created_at',width:12},{header:'Заявка',key:'title',width:30},
      {header:'РП',key:'pm_name',width:20},{header:'Работа',key:'work_title',width:25},{header:'Закупщик',key:'proc_name',width:20},
      {header:'Поз.',key:'items_count',width:8},{header:'Сумма',key:'items_total',width:15},{header:'Статус',key:'status',width:18}];
    rows.forEach(r=>ws.addRow({...r,created_at:r.created_at?new Date(r.created_at).toLocaleDateString('ru-RU'):''}));
    const buf=await wb.xlsx.writeBuffer();
    reply.header('Content-Type','application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    reply.header('Content-Disposition','attachment; filename="procurement_registry.xlsx"');
    return reply.send(Buffer.from(buf));
  });

  fastify.get('/template/excel', {preHandler:[fastify.requireRoles([...PM_ROLES,...PROC_ROLES])]}, async(req,reply)=>{
    const ExcelJS=require('exceljs');const wb=new ExcelJS.Workbook();const ws=wb.addWorksheet('Позиции');
    ws.mergeCells('A1:F1');ws.getCell('A1').value='ООО «АСГАРД СЕРВИС» — Шаблон заявки на закупку';ws.getCell('A1').font={bold:true,size:14};
    ws.getRow(3).values=['№','Наименование','Артикул','Ед.изм.','Количество','Примечание'];ws.getRow(3).font={bold:true};
    ws.columns=[{width:6},{width:40},{width:20},{width:10},{width:12},{width:30}];
    for(let n=1;n<=20;n++) ws.addRow([n,'','','шт','','']);
    const buf=await wb.xlsx.writeBuffer();
    reply.header('Content-Type','application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    reply.header('Content-Disposition','attachment; filename="procurement_template.xlsx"');
    return reply.send(Buffer.from(buf));
  });

  // ═══ CRUD ЗАЯВОК ═══

  fastify.get('/', {preHandler:[fastify.authenticate]}, async(req)=>{
    const{status,pm_id,work_id,proc_id,date_from,date_to,search,limit=50,offset=0}=req.query;
    const user=req.user;
    let sql=`SELECT pr.*,u.name as pm_name,w.work_title,pc.name as proc_name,
      (SELECT COUNT(*) FROM procurement_items pi WHERE pi.procurement_id=pr.id) as items_count,
      (SELECT COALESCE(SUM(pi.total_price),0) FROM procurement_items pi WHERE pi.procurement_id=pr.id) as items_total
      FROM procurement_requests pr LEFT JOIN users u ON pr.pm_id=u.id LEFT JOIN works w ON pr.work_id=w.id
      LEFT JOIN users pc ON pr.proc_id=pc.id WHERE 1=1`;
    const p=[];let i=1;
    if(!canViewAll(user.role)){sql+=` AND pr.pm_id=$${i++}`;p.push(user.id);}
    if(status){sql+=` AND pr.status=$${i++}`;p.push(status);}
    if(pm_id){sql+=` AND pr.pm_id=$${i++}`;p.push(pm_id);}
    if(work_id){sql+=` AND pr.work_id=$${i++}`;p.push(work_id);}
    if(proc_id){sql+=` AND pr.proc_id=$${i++}`;p.push(proc_id);}
    if(date_from){sql+=` AND pr.created_at>=$${i++}`;p.push(date_from);}
    if(date_to){sql+=` AND pr.created_at<=$${i++}`;p.push(date_to+'T23:59:59');}
    if(search){sql+=` AND (pr.title ILIKE $${i} OR pr.notes ILIKE $${i} OR w.work_title ILIKE $${i})`;p.push(`%${search}%`);i++;}
    sql+=` ORDER BY pr.id DESC LIMIT $${i++} OFFSET $${i++}`;p.push(Math.min(parseInt(limit),200),parseInt(offset));
    const{rows}=await db.query(sql,p); return {items:rows};
  });

  fastify.get('/:id', {preHandler:[fastify.authenticate]}, async(req,reply)=>{
    const id=parseInt(req.params.id); if(isNaN(id)) return reply.code(400).send({error:'Неверный ID'});
    const user=req.user;
    const{rows}=await db.query(`SELECT pr.*,u.name as pm_name,w.work_title,w.customer_name,pc.name as proc_name,da.name as dir_approver_name
      FROM procurement_requests pr LEFT JOIN users u ON pr.pm_id=u.id LEFT JOIN works w ON pr.work_id=w.id
      LEFT JOIN users pc ON pr.proc_id=pc.id LEFT JOIN users da ON pr.dir_approved_by=da.id WHERE pr.id=$1`,[id]);
    if(!rows[0]) return reply.code(404).send({error:'Не найдена'});
    if(!canViewAll(user.role)&&rows[0].pm_id!==user.id) return reply.code(403).send({error:'Нет доступа'});
    const items=await db.query(`SELECT pi.*,d.download_url as invoice_file_path,d.original_name as invoice_file_name
      FROM procurement_items pi LEFT JOIN documents d ON pi.invoice_doc_id=d.id WHERE pi.procurement_id=$1 ORDER BY pi.sort_order,pi.id`,[id]);
    const payments=await db.query(`SELECT pp.*,d.download_url,d.original_name,u.name as uploader_name
      FROM procurement_payments pp LEFT JOIN documents d ON pp.document_id=d.id LEFT JOIN users u ON pp.uploaded_by=u.id
      WHERE pp.procurement_id=$1 ORDER BY pp.created_at DESC`,[id]);
    const hLim=parseInt(req.query.history_limit)||100, hOff=parseInt(req.query.history_offset)||0;
    const history=await db.query(`SELECT ph.*,u.name as actor_name FROM procurement_history ph LEFT JOIN users u ON ph.actor_id=u.id
      WHERE ph.procurement_id=$1 ORDER BY ph.created_at DESC LIMIT $2 OFFSET $3`,[id,hLim,hOff]);
    return {item:rows[0],items:items.rows,payments:payments.rows,history:history.rows};
  });

  fastify.post('/', {preHandler:[fastify.requireRoles([...PM_ROLES,...PROC_ROLES,...DIR_ROLES])]}, async(req)=>{
    const{work_id,title,notes,priority,needed_by,delivery_address}=req.body;
    const{rows}=await db.query(`INSERT INTO procurement_requests(work_id,title,notes,priority,needed_by,delivery_address,author_id,pm_id,status)
      VALUES($1,$2,$3,$4,$5,$6,$7,$7,'draft') RETURNING *`,
      [work_id||null,(title||'Заявка на закупку').trim(),notes||null,priority||'normal',needed_by||null,delivery_address||null,req.user.id]);
    await logHistory(db,rows[0].id,req.user.id,'created',null,'draft',null,null);
    return {item:rows[0]};
  });

  fastify.put('/:id', {preHandler:[fastify.requireRoles([...PM_ROLES,...PROC_ROLES,...DIR_ROLES])]}, async(req,reply)=>{
    const id=parseInt(req.params.id); if(isNaN(id)) return reply.code(400).send({error:'Неверный ID'});
    const ck=await checkNotLocked(db,id); if(ck.error) return reply.code(ck.code).send({error:ck.error});
    const allowed=['title','notes','priority','needed_by','delivery_address','delivery_deadline','deadline_type','deadline_days','proc_comment','pm_comment'];
    const upd=[],vals=[];let i=1;
    for(const k of allowed){if(req.body[k]!==undefined){upd.push(`${k}=$${i++}`);vals.push(req.body[k]);}}
    if(!upd.length) return reply.code(400).send({error:'Нет данных'});
    upd.push('updated_at=NOW()');vals.push(id);
    const{rows}=await db.query(`UPDATE procurement_requests SET ${upd.join(',')} WHERE id=$${i} RETURNING *`,vals);
    return {item:rows[0]};
  });

  fastify.delete('/:id', {preHandler:[fastify.requireRoles(['ADMIN'])]}, async(req,reply)=>{
    const{rows}=await db.query(`DELETE FROM procurement_requests WHERE id=$1 AND status='draft' RETURNING id`,[req.params.id]);
    if(!rows[0]) return reply.code(404).send({error:'Не найдена или не черновик'}); return {success:true};
  });

  // ═══ ПОЗИЦИИ ═══

  fastify.get('/:id/items', {preHandler:[fastify.authenticate]}, async(req)=>{
    const{rows}=await db.query('SELECT * FROM procurement_items WHERE procurement_id=$1 ORDER BY sort_order,id',[req.params.id]);
    return {items:rows};
  });

  fastify.post('/:id/items', {preHandler:[fastify.requireRoles([...PM_ROLES,...PROC_ROLES,...DIR_ROLES])]}, async(req,reply)=>{
    const procId=parseInt(req.params.id);
    const ck=await checkNotLocked(db,procId); if(ck.error) return reply.code(ck.code).send({error:ck.error});
    const{name,article,unit,quantity,supplier,supplier_link,unit_price,delivery_target,delivery_address,warehouse_id,estimated_delivery,notes,sort_order}=req.body;
    if(!name||!name.trim()) return reply.code(400).send({error:'Наименование обязательно'});
    const tgt=delivery_target||'warehouse';
    if(!['warehouse','object'].includes(tgt)) return reply.code(400).send({error:'delivery_target: warehouse или object'});
    let e=valNum(quantity,'quantity'); if(e) return reply.code(400).send({error:e});
    e=valNum(unit_price,'unit_price'); if(e) return reply.code(400).send({error:e});
    const q=parseFloat(quantity)||0, p=parseFloat(unit_price)||0;
    const{rows}=await db.query(`INSERT INTO procurement_items(procurement_id,name,article,unit,quantity,supplier,supplier_link,unit_price,total_price,
      delivery_target,delivery_address,warehouse_id,estimated_delivery,notes,sort_order)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15) RETURNING *`,
      [procId,name.trim(),article||null,unit||'шт',q,supplier||null,supplier_link||null,p||null,q*p||null,
       tgt,delivery_address||null,warehouse_id||null,estimated_delivery||null,notes||null,sort_order||0]);
    await recalcTotal(db,procId);
    await logHistory(db,procId,req.user.id,'item_added',null,null,`Позиция: ${name}`,{item_id:rows[0].id});
    return {item:rows[0]};
  });

  fastify.put('/:id/items/:itemId', {preHandler:[fastify.requireRoles([...PM_ROLES,...PROC_ROLES,...DIR_ROLES])]}, async(req,reply)=>{
    const procId=parseInt(req.params.id),itemId=parseInt(req.params.itemId);
    const ck=await checkNotLocked(db,procId); if(ck.error) return reply.code(ck.code).send({error:ck.error});
    if(req.body.delivery_target!==undefined&&!['warehouse','object'].includes(req.body.delivery_target))
      return reply.code(400).send({error:'delivery_target: warehouse/object'});
    let e=valNum(req.body.quantity,'quantity'); if(e) return reply.code(400).send({error:e});
    e=valNum(req.body.unit_price,'unit_price'); if(e) return reply.code(400).send({error:e});
    const allowed=['name','article','unit','quantity','supplier','supplier_link','unit_price','delivery_target','delivery_address',
      'warehouse_id','estimated_delivery','notes','sort_order','invoice_doc_id','item_status'];
    const upd=[],vals=[];let i=1;
    for(const k of allowed){if(req.body[k]!==undefined){upd.push(`${k}=$${i++}`);vals.push(req.body[k]);}}
    if(req.body.quantity!==undefined||req.body.unit_price!==undefined){
      const cur=await db.query('SELECT quantity,unit_price FROM procurement_items WHERE id=$1',[itemId]);
      if(cur.rows[0]){
        const q=req.body.quantity!==undefined?parseFloat(req.body.quantity):parseFloat(cur.rows[0].quantity)||0;
        const p=req.body.unit_price!==undefined?parseFloat(req.body.unit_price):parseFloat(cur.rows[0].unit_price)||0;
        upd.push(`total_price=$${i++}`);vals.push(q*p);
      }
    }
    if(!upd.length) return reply.code(400).send({error:'Нет данных'});
    upd.push('updated_at=NOW()');vals.push(itemId,procId);
    const{rows}=await db.query(`UPDATE procurement_items SET ${upd.join(',')} WHERE id=$${i} AND procurement_id=$${i+1} RETURNING *`,vals);
    if(!rows[0]) return reply.code(404).send({error:'Позиция не найдена'});
    await recalcTotal(db,procId); return {item:rows[0]};
  });

  fastify.delete('/:id/items/:itemId', {preHandler:[fastify.requireRoles([...PM_ROLES,...PROC_ROLES,...DIR_ROLES])]}, async(req,reply)=>{
    const procId=parseInt(req.params.id);
    const ck=await checkNotLocked(db,procId); if(ck.error) return reply.code(ck.code).send({error:ck.error});
    const{rows}=await db.query('DELETE FROM procurement_items WHERE id=$1 AND procurement_id=$2 RETURNING id',[req.params.itemId,procId]);
    if(!rows[0]) return reply.code(404).send({error:'Не найдена'});
    await recalcTotal(db,procId); return {success:true};
  });

  fastify.post('/:id/items/bulk', {preHandler:[fastify.requireRoles([...PM_ROLES,...PROC_ROLES])]}, async(req,reply)=>{
    const procId=parseInt(req.params.id);
    const ck=await checkNotLocked(db,procId); if(ck.error) return reply.code(ck.code).send({error:ck.error});
    const items=req.body.items;
    if(!Array.isArray(items)||!items.length) return reply.code(400).send({error:'items обязателен'});
    const client=await db.pool.connect();
    try{
      await client.query('BEGIN');
      const valid=items.filter(it=>it.name&&it.name.trim());
      if(!valid.length){await client.query('ROLLBACK');return reply.code(400).send({error:'Нет валидных позиций'});}
      const n=[],a=[],u=[],q=[],pr=[],t=[],no=[],o=[];
      valid.forEach((it,idx)=>{const qq=parseFloat(it.quantity)||0,pp=parseFloat(it.unit_price)||0;
        n.push(it.name.trim());a.push(it.article||null);u.push(it.unit||'шт');q.push(qq);pr.push(pp||null);t.push(qq*pp||null);no.push(it.notes||null);o.push(idx);});
      const{rows}=await client.query(`INSERT INTO procurement_items(procurement_id,name,article,unit,quantity,unit_price,total_price,notes,sort_order)
        SELECT $1,unnest($2::text[]),unnest($3::text[]),unnest($4::text[]),unnest($5::numeric[]),unnest($6::numeric[]),unnest($7::numeric[]),unnest($8::text[]),unnest($9::int[]) RETURNING *`,
        [procId,n,a,u,q,pr,t,no,o]);
      await recalcTotal(client,procId);
      await logHistory(client,procId,req.user.id,'items_bulk_added',null,null,`Добавлено: ${rows.length}`,null);
      await client.query('COMMIT');return{items:rows,count:rows.length};
    }catch(e){await client.query('ROLLBACK');throw e;}finally{client.release();}
  });

  fastify.post('/:id/items/import-excel', {preHandler:[fastify.requireRoles([...PM_ROLES,...PROC_ROLES])]}, async(req,reply)=>{
    const procId=parseInt(req.params.id);
    const ck=await checkNotLocked(db,procId); if(ck.error) return reply.code(ck.code).send({error:ck.error});
    const data=await req.file(); if(!data) return reply.code(400).send({error:'Файл не загружен'});
    const ExcelJS=require('exceljs');const wb=new ExcelJS.Workbook();await wb.xlsx.read(data.file);
    const ws=wb.worksheets[0]; if(!ws) return reply.code(400).send({error:'Пустой файл'});
    const items=[];
    ws.eachRow((row,num)=>{if(num<=3)return;const nm=(row.getCell(2).value||'').toString().trim();if(!nm)return;
      items.push({name:nm,article:(row.getCell(3).value||'').toString().trim()||null,unit:(row.getCell(4).value||'шт').toString().trim(),
        quantity:parseFloat(row.getCell(5).value)||0,notes:(row.getCell(6).value||'').toString().trim()||null});});
    if(!items.length) return reply.code(400).send({error:'Нет данных'});
    const client=await db.pool.connect();
    try{await client.query('BEGIN');const ins=[];
      for(let idx=0;idx<items.length;idx++){const it=items[idx];
        const{rows}=await client.query(`INSERT INTO procurement_items(procurement_id,name,article,unit,quantity,notes,sort_order)VALUES($1,$2,$3,$4,$5,$6,$7)RETURNING *`,
          [procId,it.name,it.article,it.unit,it.quantity,it.notes,idx]);ins.push(rows[0]);}
      await recalcTotal(client,procId);
      await logHistory(client,procId,req.user.id,'items_imported_excel',null,null,`Импорт: ${ins.length} поз.`,null);
      await client.query('COMMIT');return{items:ins,count:ins.length};
    }catch(e){await client.query('ROLLBACK');throw e;}finally{client.release();}
  });

  fastify.get('/:id/export/excel', {preHandler:[fastify.authenticate]}, async(req,reply)=>{
    const id=parseInt(req.params.id);const ExcelJS=require('exceljs');
    const proc=await db.query('SELECT pr.*,w.work_title FROM procurement_requests pr LEFT JOIN works w ON pr.work_id=w.id WHERE pr.id=$1',[id]);
    if(!proc.rows[0]) return reply.code(404).send({error:'Не найдена'});
    const items=await db.query('SELECT * FROM procurement_items WHERE procurement_id=$1 ORDER BY sort_order,id',[id]);
    const wb=new ExcelJS.Workbook();const ws=wb.addWorksheet('Заявка #'+id);
    ws.mergeCells('A1:H1');ws.getCell('A1').value=`ООО «АСГАРД СЕРВИС» — Заявка #${id}`;ws.getCell('A1').font={bold:true,size:14};
    ws.getCell('A3').value='Работа:';ws.getCell('B3').value=proc.rows[0].work_title||'—';
    ws.getRow(5).values=['№','Наименование','Артикул','Ед.','Кол-во','Поставщик','Цена','Сумма'];ws.getRow(5).font={bold:true};
    items.rows.forEach((it,idx)=>ws.addRow([idx+1,it.name,it.article,it.unit,it.quantity,it.supplier,it.unit_price,it.total_price]));
    const buf=await wb.xlsx.writeBuffer();
    reply.header('Content-Type','application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    reply.header('Content-Disposition',`attachment; filename="procurement_${id}.xlsx"`);
    return reply.send(Buffer.from(buf));
  });

  // ═══ ЦЕПОЧКА СОГЛАСОВАНИЯ ═══

  fastify.put('/:id/send-to-proc', {preHandler:[fastify.authenticate]}, async(req,reply)=>{
    return transitionStatus(req,reply,{allowedRoles:[...PM_ROLES,...DIR_ROLES],fromStatuses:['draft','dir_rework'],toStatus:'sent_to_proc',
      afterTransition:async(c,proc,user)=>{
        if(!proc.proc_id){const pu=await c.query("SELECT id FROM users WHERE role='PROC' AND is_active=true ORDER BY id LIMIT 1");
          if(pu.rows[0]) await c.query('UPDATE procurement_requests SET proc_id=$1 WHERE id=$2',[req.body?.proc_id||pu.rows[0].id,proc.id]);}
        const pus=await c.query("SELECT id FROM users WHERE role='PROC' AND is_active=true");
        const ic=await c.query('SELECT COUNT(*) as cnt FROM procurement_items WHERE procurement_id=$1',[proc.id]);
        for(const p of pus.rows) createNotification(db,{user_id:p.id,title:`🛒 Заявка #${proc.id}`,
          message:`РП ${user.name||''}: «${proc.title}» (${ic.rows[0].cnt} поз.)`,type:'procurement',link:`#/procurement?id=${proc.id}`});
      }});
  });

  fastify.put('/:id/proc-respond', {preHandler:[fastify.authenticate]}, async(req,reply)=>{
    return transitionStatus(req,reply,{allowedRoles:PROC_ROLES,fromStatuses:['sent_to_proc'],toStatus:'proc_responded',
      extraUpdates:()=>({proc_comment:req.body?.comment||null}),
      afterTransition:async(c,proc)=>{
        const t=await c.query('SELECT COALESCE(SUM(total_price),0) as s,COUNT(*) as cnt FROM procurement_items WHERE procurement_id=$1',[proc.id]);
        if(proc.pm_id) createNotification(db,{user_id:proc.pm_id,title:`🛒 Заявка #${proc.id} обработана`,
          message:`${t.rows[0].s} ₽, ${t.rows[0].cnt} поз.`,type:'procurement',link:`#/procurement?id=${proc.id}`});
      }});
  });

  fastify.put('/:id/return-to-proc', {preHandler:[fastify.authenticate]}, async(req,reply)=>{
    return transitionStatus(req,reply,{allowedRoles:[...PM_ROLES,...DIR_ROLES],fromStatuses:['proc_responded'],toStatus:'sent_to_proc',
      extraUpdates:()=>({pm_comment:req.body?.comment||null})});
  });

  fastify.put('/:id/pm-approve', {preHandler:[fastify.authenticate]}, async(req,reply)=>{
    return transitionStatus(req,reply,{allowedRoles:[...PM_ROLES,...DIR_ROLES],fromStatuses:['proc_responded','dir_question'],toStatus:'pm_approved',
      extraUpdates:()=>({pm_approved_at:new Date().toISOString()}),
      afterTransition:async(c,proc)=>{
        const t=await c.query('SELECT COALESCE(SUM(total_price),0) as s FROM procurement_items WHERE procurement_id=$1',[proc.id]);
        const dirs=await c.query("SELECT id FROM users WHERE role IN('DIRECTOR_GEN','DIRECTOR_COMM','DIRECTOR_DEV') AND is_active=true");
        for(const d of dirs.rows) createNotification(db,{user_id:d.id,title:`🛒 #${proc.id} на согласование`,
          message:`«${proc.title}» — ${t.rows[0].s} ₽`,type:'procurement',link:`#/procurement?id=${proc.id}`});
      }});
  });

  fastify.put('/:id/dir-approve', {preHandler:[fastify.authenticate]}, async(req,reply)=>{
    return transitionStatus(req,reply,{allowedRoles:DIR_ROLES,fromStatuses:['pm_approved'],toStatus:'dir_approved',
      extraUpdates:(user)=>({locked:true,dir_approved_at:new Date().toISOString(),dir_approved_by:user.id}),
      afterTransition:async(c,proc)=>{
        const t=await c.query('SELECT COALESCE(SUM(total_price),0) as s,COUNT(*) as cnt FROM procurement_items WHERE procurement_id=$1',[proc.id]);
        const sup=await c.query('SELECT DISTINCT supplier FROM procurement_items WHERE procurement_id=$1 AND supplier IS NOT NULL',[proc.id]);
        const sl=sup.rows.map(s=>s.supplier).join(', ')||'не указан';
        const buhs=await c.query("SELECT id FROM users WHERE role='BUH' AND is_active=true");
        for(const b of buhs.rows) createNotification(db,{user_id:b.id,title:`💰 #${proc.id} к оплате`,
          message:`${t.rows[0].s} ₽ (${t.rows[0].cnt} поз., ${sl})`,type:'procurement',link:`#/procurement?id=${proc.id}`});
      }});
  });

  fastify.put('/:id/dir-rework', {preHandler:[fastify.authenticate]}, async(req,reply)=>{
    return transitionStatus(req,reply,{allowedRoles:DIR_ROLES,fromStatuses:['pm_approved'],toStatus:'dir_rework',
      extraUpdates:()=>({locked:false}),
      afterTransition:async(c,proc)=>{if(proc.pm_id) createNotification(db,{user_id:proc.pm_id,title:`🛒 #${proc.id} на доработку`,
        message:req.body?.comment||'без комментария',type:'procurement',link:`#/procurement?id=${proc.id}`});}});
  });

  fastify.put('/:id/dir-question', {preHandler:[fastify.authenticate]}, async(req,reply)=>{
    return transitionStatus(req,reply,{allowedRoles:DIR_ROLES,fromStatuses:['pm_approved'],toStatus:'dir_question',
      afterTransition:async(c,proc)=>{if(proc.pm_id) createNotification(db,{user_id:proc.pm_id,title:`❓ Вопрос по #${proc.id}`,
        message:req.body?.comment||'Вопрос',type:'procurement',link:`#/procurement?id=${proc.id}`});}});
  });

  fastify.put('/:id/dir-reject', {preHandler:[fastify.authenticate]}, async(req,reply)=>{
    return transitionStatus(req,reply,{allowedRoles:DIR_ROLES,fromStatuses:['pm_approved'],toStatus:'dir_rejected',
      afterTransition:async(c,proc)=>{if(proc.pm_id) createNotification(db,{user_id:proc.pm_id,title:`❌ #${proc.id} отклонена`,
        message:req.body?.comment||'Отклонено',type:'procurement',link:`#/procurement?id=${proc.id}`});}});
  });

  // ═══ ОПЛАТА + ДОСТАВКА ═══

  fastify.post('/:id/payments', {preHandler:[fastify.requireRoles(BUH_ROLES)]}, async(req,reply)=>{
    const procId=parseInt(req.params.id);
    const{document_id,amount,payment_date,payment_number,bank_name,comment}=req.body;
    if(!document_id) return reply.code(400).send({error:'document_id обязателен'});
    const{rows}=await db.query(`INSERT INTO procurement_payments(procurement_id,document_id,amount,payment_date,payment_number,bank_name,comment,uploaded_by)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8)RETURNING *`,[procId,document_id,amount||null,payment_date||null,payment_number||null,bank_name||null,comment||null,req.user.id]);
    await logHistory(db,procId,req.user.id,'payment_added',null,null,`Платёжка: ${amount||'?'} ₽`,{payment_id:rows[0].id});
    return {payment:rows[0]};
  });

  fastify.put('/:id/mark-paid', {preHandler:[fastify.authenticate]}, async(req,reply)=>{
    return transitionStatus(req,reply,{allowedRoles:BUH_ROLES,fromStatuses:['dir_approved'],toStatus:'paid',
      extraUpdates:()=>({paid_at:new Date().toISOString()}),
      afterTransition:async(c,proc)=>{
        if(proc.deadline_type==='from_payment'&&proc.deadline_days){
          const dl=new Date();dl.setDate(dl.getDate()+proc.deadline_days);
          await c.query('UPDATE procurement_requests SET delivery_deadline=$1 WHERE id=$2',[dl.toISOString().slice(0,10),proc.id]);}
        const items=await c.query('SELECT name,quantity,unit FROM procurement_items WHERE procurement_id=$1 LIMIT 5',[proc.id]);
        const names=items.rows.map(i=>`${i.name} (${i.quantity} ${i.unit})`).join(', ');
        const dlStr=proc.delivery_deadline?new Date(proc.delivery_deadline).toLocaleDateString('ru-RU'):'не указан';
        if(proc.proc_id) createNotification(db,{user_id:proc.proc_id,title:`✅ #${proc.id} оплачена`,message:`Доставка: ${dlStr}`,type:'procurement',link:`#/procurement?id=${proc.id}`});
        if(proc.pm_id) createNotification(db,{user_id:proc.pm_id,title:`✅ #${proc.id} оплачена`,message:`Доставка: ${dlStr}`,type:'procurement',link:`#/procurement?id=${proc.id}`});
        const whs=await c.query("SELECT id FROM users WHERE role='WAREHOUSE' AND is_active=true");
        for(const w of whs.rows) createNotification(db,{user_id:w.id,title:`✅ Закуплено`,message:`${names}. Доставка: ${dlStr}`,type:'procurement',link:`#/procurement?id=${proc.id}`});
      }});
  });

  fastify.put('/:id/items/:itemId/deliver', {preHandler:[fastify.requireRoles([...WH_ROLES,...PM_ROLES])]}, async(req,reply)=>{
    const procId=parseInt(req.params.id),itemId=parseInt(req.params.itemId);const user=req.user;
    const pc=await getProcCheck(db,procId,['paid','partially_delivered']); if(pc.error) return reply.code(pc.code).send({error:pc.error});
    const client=await db.pool.connect();
    try{
      await client.query('BEGIN');
      const ic=await client.query('SELECT * FROM procurement_items WHERE id=$1 AND procurement_id=$2',[itemId,procId]);
      if(!ic.rows[0]){await client.query('ROLLBACK');return reply.code(404).send({error:'Позиция не найдена'});}
      if(ic.rows[0].item_status==='delivered'){await client.query('ROLLBACK');return reply.code(409).send({error:'Уже доставлена'});}
      const item=ic.rows[0];
      await client.query(`UPDATE procurement_items SET item_status='delivered',received_by=$1,received_at=NOW(),actual_delivery=CURRENT_DATE,updated_at=NOW() WHERE id=$2`,[user.id,itemId]);
      if(item.delivery_target==='warehouse'){
        const wh=await client.query("SELECT id FROM warehouses WHERE is_main=true LIMIT 1");
        const whId=item.warehouse_id||(wh.rows[0]&&wh.rows[0].id)||null;
        const qr=randomUUID();
        const invNum='INV-'+Date.now().toString(36).toUpperCase();
        const eq=await client.query(`INSERT INTO equipment(name,inventory_number,category_id,quantity,unit,purchase_price,status,warehouse_id,qr_uuid,qr_code,notes)
          VALUES($1,$2,NULL,$3,$4,$5,'on_warehouse',$6,$7,$8,$9) RETURNING id`,
          [item.name,invNum,item.quantity,item.unit,item.unit_price,whId,qr,qr,'Из закупки #'+procId]);
        await client.query('UPDATE procurement_items SET equipment_id=$1 WHERE id=$2',[eq.rows[0].id,itemId]);
        await client.query(`INSERT INTO equipment_movements(equipment_id,movement_type,to_warehouse_id,notes,created_by)VALUES($1,'procurement_receipt',$2,$3,$4)`,
          [eq.rows[0].id,whId,'Приёмка из закупки #'+procId,user.id]);
        if(pc.row.work_id) await client.query(`INSERT INTO equipment_reservations(equipment_id,work_id,reserved_by,reserved_from,reserved_to,status,notes)
          VALUES($1,$2,$3,CURRENT_DATE,CURRENT_DATE+INTERVAL '30 days','active',$4)`,[eq.rows[0].id,pc.row.work_id,pc.row.pm_id||user.id,'Автобронь #'+procId]);
      }
      const all=await client.query('SELECT item_status FROM procurement_items WHERE procurement_id=$1',[procId]);
      const dCnt=all.rows.filter(i=>i.item_status==='delivered').length;
      const cCnt=all.rows.filter(i=>i.item_status==='cancelled').length;
      let ns=null;
      if(dCnt+cCnt>=all.rows.length) ns='delivered'; else if(dCnt>0) ns='partially_delivered';
      if(ns) await client.query(`UPDATE procurement_requests SET status=$1,delivered_at=CASE WHEN $1='delivered' THEN NOW() ELSE delivered_at END,updated_at=NOW() WHERE id=$2`,[ns,procId]);
      await logHistory(client,procId,user.id,'item_delivered',null,null,`Принято: ${item.name}`,{item_id:itemId});
      if(pc.row.pm_id&&pc.row.pm_id!==user.id) createNotification(db,{user_id:pc.row.pm_id,title:`📦 Принято`,message:`${item.name} (${item.quantity} ${item.unit}) #${procId}`,type:'procurement',link:`#/procurement?id=${procId}`});
      await client.query('COMMIT');
      const upd=await db.query('SELECT * FROM procurement_items WHERE id=$1',[itemId]);
      return{item:upd.rows[0]};
    }catch(e){await client.query('ROLLBACK');throw e;}finally{client.release();}
  });

  fastify.put('/:id/close', {preHandler:[fastify.authenticate]}, async(req,reply)=>{
    return transitionStatus(req,reply,{allowedRoles:[...PM_ROLES,...DIR_ROLES,'ADMIN'],fromStatuses:['delivered'],toStatus:'closed'});
  });
}

module.exports = routes;
