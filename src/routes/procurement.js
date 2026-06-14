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

  // Авто-наполнение каталога: позиция закупки → запись в products (если ещё нет).
  // Возвращает product_id для проставления в procurement_items. Каталог растёт сам.
  // Возвращает {id, category_id} каталожного продукта (найденного или созданного).
  // category_id берётся из существующего продукта — чтобы автопроставить категорию позиции.
  async function ensureCatalogProduct(c, { name, unit, article, category_id, userId }) {
    const nm = (name||'').trim(); if (!nm) return { id: null, category_id: null };
    let r = await c.query('SELECT id, category_id FROM products WHERE lower(name)=lower($1) AND deleted_at IS NULL LIMIT 1', [nm]);
    if (r.rows[0]) return { id: r.rows[0].id, category_id: r.rows[0].category_id || null };
    try {
      const ins = await c.query(
        `INSERT INTO products(name,article,unit,category_id,created_from,created_by) VALUES($1,$2,$3,$4,'procurement',$5) RETURNING id, category_id`,
        [nm, article||null, unit||'шт', category_id||null, userId||null]);
      return { id: ins.rows[0].id, category_id: ins.rows[0].category_id || null };
    } catch (e) {
      if (e.code === '23505') { const x = await c.query('SELECT id, category_id FROM products WHERE lower(name)=lower($1) AND deleted_at IS NULL LIMIT 1', [nm]); return { id: x.rows[0]?.id || null, category_id: x.rows[0]?.category_id || null }; }
      throw e;
    }
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

  fastify.get('/export/excel', {preHandler:[
    async (request, reply) => {
      if (!request.headers.authorization && request.query.token) {
        request.headers.authorization = 'Bearer ' + request.query.token;
      }
    },
    fastify.requireRoles([...PM_ROLES,...PROC_ROLES,...DIR_ROLES,...BUH_ROLES])
  ]}, async(req,reply)=>{
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

  fastify.get('/template/excel', {preHandler:[
    async (request, reply) => {
      if (!request.headers.authorization && request.query.token) {
        request.headers.authorization = 'Bearer ' + request.query.token;
      }
    },
    fastify.requireRoles([...PM_ROLES,...PROC_ROLES,...DIR_ROLES,'BUH','HEAD_TO'])
  ]}, async(req,reply)=>{
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
      (SELECT COUNT(*) FROM procurement_items pi WHERE pi.procurement_id=pr.id AND pi.parent_item_id IS NULL) as items_count,
      (SELECT COALESCE(SUM(pi.total_price),0) FROM procurement_items pi WHERE pi.procurement_id=pr.id) as items_total,
      (SELECT COUNT(*) FROM procurement_items pi WHERE pi.procurement_id=pr.id AND pi.parent_item_id IS NULL
         AND (pi.unit_price IS NULL OR pi.unit_price=0)
         AND NOT EXISTS(SELECT 1 FROM procurement_items ch WHERE ch.parent_item_id=pi.id)) as unpriced_count
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
    sql+=` ORDER BY pr.id DESC LIMIT $${i++} OFFSET $${i++}`;p.push(Math.min(parseInt(limit),400),parseInt(offset));
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
    const items=await db.query(`SELECT pi.*,d.download_url as invoice_file_path,d.original_name as invoice_file_name,pc.name as category_name
      FROM procurement_items pi LEFT JOIN documents d ON pi.invoice_doc_id=d.id LEFT JOIN product_categories pc ON pi.product_category_id=pc.id
      WHERE pi.procurement_id=$1 ORDER BY pi.sort_order,pi.id`,[id]);
    const payments=await db.query(`SELECT pp.*,d.download_url,d.original_name,u.name as uploader_name
      FROM procurement_payments pp LEFT JOIN documents d ON pp.document_id=d.id LEFT JOIN users u ON pp.uploaded_by=u.id
      WHERE pp.procurement_id=$1 ORDER BY pp.created_at DESC`,[id]);
    const hLim=parseInt(req.query.history_limit)||100, hOff=parseInt(req.query.history_offset)||0;
    const history=await db.query(`SELECT ph.*,u.name as actor_name FROM procurement_history ph LEFT JOIN users u ON ph.actor_id=u.id
      WHERE ph.procurement_id=$1 ORDER BY ph.created_at DESC LIMIT $2 OFFSET $3`,[id,hLim,hOff]);
    // Загруженные счета поставщиков (для бухгалтера на этапе оплаты + трассировки)
    const invoices=await db.query(`SELECT ii.id,ii.supplier_id,ii.supplier_name,ii.delivery_days,ii.file_path,ii.file_name,
      ii.total_sum,ii.matched_count,ii.created_at,u.name as uploaded_by_name
      FROM procurement_invoice_imports ii LEFT JOIN users u ON ii.created_by=u.id
      WHERE ii.procurement_id=$1 ORDER BY ii.created_at DESC`,[id]);
    return {item:rows[0],items:items.rows,payments:payments.rows,history:history.rows,invoice_imports:invoices.rows};
  });

  fastify.post('/', {preHandler:[fastify.requireRoles([...PM_ROLES,...PROC_ROLES,...DIR_ROLES])]}, async(req)=>{
    const{work_id,title,notes,priority,needed_by,delivery_address,price_segment,budget_limit}=req.body;
    const seg=['cheap','medium','premium'].includes(price_segment)?price_segment:null;
    const{rows}=await db.query(`INSERT INTO procurement_requests(work_id,title,notes,priority,needed_by,delivery_address,price_segment,budget_limit,author_id,pm_id,status)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$9,'draft') RETURNING *`,
      [work_id||null,(title||'Заявка на закупку').trim(),notes||null,priority||'normal',needed_by||null,delivery_address||null,seg,budget_limit||null,req.user.id]);
    await logHistory(db,rows[0].id,req.user.id,'created',null,'draft',null,null);
    return {item:rows[0]};
  });

  fastify.put('/:id', {preHandler:[fastify.requireRoles([...PM_ROLES,...PROC_ROLES,...DIR_ROLES])]}, async(req,reply)=>{
    const id=parseInt(req.params.id); if(isNaN(id)) return reply.code(400).send({error:'Неверный ID'});
    const ck=await checkNotLocked(db,id); if(ck.error) return reply.code(ck.code).send({error:ck.error});
    const allowed=['title','notes','priority','needed_by','delivery_address','delivery_deadline','deadline_type','deadline_days','proc_comment','pm_comment','price_segment','budget_limit'];
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
    const{name,article,unit,quantity,supplier,supplier_link,unit_price,delivery_target,delivery_address,warehouse_id,estimated_delivery,notes,sort_order,product_id,supplier_id,product_category_id}=req.body;
    if(!name||!name.trim()) return reply.code(400).send({error:'Наименование обязательно'});
    const tgt=delivery_target||'warehouse';
    if(!['warehouse','object'].includes(tgt)) return reply.code(400).send({error:'delivery_target: warehouse или object'});
    let e=valNum(quantity,'quantity'); if(e) return reply.code(400).send({error:e});
    e=valNum(unit_price,'unit_price'); if(e) return reply.code(400).send({error:e});
    const q=parseFloat(quantity)||0, p=parseFloat(unit_price)||0;
    // Авто-привязка к каталогу: если product_id не передан — найдём/создадим в products.
    let pid = product_id || null;
    let catId = product_category_id || null;
    if (!pid) { try { const cp = await ensureCatalogProduct(db, { name, unit, article, category_id: product_category_id, userId: req.user.id }); pid = cp.id; if (!catId) catId = cp.category_id; } catch(_) { pid = null; } }
    // Автопроставление категории из каталога, если у позиции своя не задана
    if (!catId && pid) { try { const pc = await db.query('SELECT category_id FROM products WHERE id=$1', [pid]); catId = pc.rows[0]?.category_id || null; } catch(_) {} }
    const{rows}=await db.query(`INSERT INTO procurement_items(procurement_id,name,article,unit,quantity,supplier,supplier_link,unit_price,total_price,
      delivery_target,delivery_address,warehouse_id,estimated_delivery,notes,sort_order,product_id,supplier_id,product_category_id)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18) RETURNING *`,
      [procId,name.trim(),article||null,unit||'шт',q,supplier||null,supplier_link||null,p||null,q*p||null,
       tgt,delivery_address||null,warehouse_id||null,estimated_delivery||null,notes||null,sort_order||0,
       pid,supplier_id||null,catId]);
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
      'warehouse_id','estimated_delivery','notes','sort_order','invoice_doc_id','item_status',
      'product_id','supplier_id','product_category_id'];
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
      const n=[],a=[],u=[],q=[],pr=[],t=[],no=[],o=[],pid=[],dt=[],cat=[];
      for(let idx=0;idx<valid.length;idx++){const it=valid[idx];const qq=parseFloat(it.quantity)||0,pp=parseFloat(it.unit_price)||0;
        n.push(it.name.trim());a.push(it.article||null);u.push(it.unit||'шт');q.push(qq);pr.push(pp||null);t.push(qq*pp||null);no.push(it.notes||null);o.push(idx);
        dt.push(['warehouse','object'].includes(it.delivery_target)?it.delivery_target:'warehouse');
        // product_id из витрины, либо авто-создание в каталоге; категория — из каталога, если своя не задана
        let p2=it.product_id||null,c2=it.product_category_id||null;
        if(!p2){try{const cp=await ensureCatalogProduct(client,{name:it.name,unit:it.unit,article:it.article,category_id:it.product_category_id,userId:req.user.id});p2=cp.id;if(!c2)c2=cp.category_id;}catch(_){p2=null;}}
        if(!c2&&p2){try{const pc=await client.query('SELECT category_id FROM products WHERE id=$1',[p2]);c2=pc.rows[0]?.category_id||null;}catch(_){}}
        pid.push(p2);cat.push(c2);}
      const{rows}=await client.query(`INSERT INTO procurement_items(procurement_id,name,article,unit,quantity,unit_price,total_price,notes,sort_order,product_id,delivery_target,product_category_id)
        SELECT $1,unnest($2::text[]),unnest($3::text[]),unnest($4::text[]),unnest($5::numeric[]),unnest($6::numeric[]),unnest($7::numeric[]),unnest($8::text[]),unnest($9::int[]),unnest($10::int[]),unnest($11::text[]),unnest($12::int[]) RETURNING *`,
        [procId,n,a,u,q,pr,t,no,o,pid,dt,cat]);
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

  // Экспорт заявки в Excel. group=category|supplier|none — разбивка с подытогами.
  fastify.get('/:id/export/excel', {preHandler:[fastify.authenticate]}, async(req,reply)=>{
    const id=parseInt(req.params.id);const ExcelJS=require('exceljs');
    const group=['category','supplier'].includes(req.query.group)?req.query.group:null;
    const proc=await db.query('SELECT pr.*,w.work_title FROM procurement_requests pr LEFT JOIN works w ON pr.work_id=w.id WHERE pr.id=$1',[id]);
    if(!proc.rows[0]) return reply.code(404).send({error:'Не найдена'});
    const items=await db.query(`SELECT pi.*,c.name as category_name FROM procurement_items pi
      LEFT JOIN product_categories c ON pi.product_category_id=c.id WHERE pi.procurement_id=$1 ORDER BY pi.sort_order,pi.id`,[id]);
    const wb=new ExcelJS.Workbook();const ws=wb.addWorksheet('Заявка #'+id);
    ws.mergeCells('A1:H1');ws.getCell('A1').value=`ООО «АСГАРД СЕРВИС» — Заявка #${id}`;ws.getCell('A1').font={bold:true,size:14};
    ws.getCell('A3').value='Работа:';ws.getCell('B3').value=proc.rows[0].work_title||'—';
    const hdr=['№','Наименование','Артикул','Ед.','Кол-во','Поставщик','Цена','Сумма'];
    let row=5;
    const writeRows=(rows)=>{rows.forEach((it,idx)=>{ws.getRow(row++).values=[idx+1,it.name,it.article,it.unit,it.quantity,it.supplier,it.unit_price,it.total_price];});};
    if(group){
      ws.getRow(row).values=hdr;ws.getRow(row).font={bold:true};row++;
      const key=group==='category'?'category_name':'supplier';
      const groups={};items.rows.forEach(it=>{const g=it[key]||(group==='category'?'Без категории':'Без поставщика');(groups[g]=groups[g]||[]).push(it);});
      for(const g of Object.keys(groups).sort()){
        const gr=ws.getRow(row++);gr.getCell(2).value='▸ '+g;gr.getCell(2).font={bold:true,color:{argb:'FFD4A843'}};
        writeRows(groups[g]);
        const sum=groups[g].reduce((s,x)=>s+(parseFloat(x.total_price)||0),0);
        const sr=ws.getRow(row++);sr.getCell(7).value='Итого:';sr.getCell(8).value=sum;sr.font={bold:true};row++;
      }
    } else {
      ws.getRow(row).values=hdr;ws.getRow(row).font={bold:true};row++;
      writeRows(items.rows);
    }
    const buf=await wb.xlsx.writeBuffer();
    reply.header('Content-Type','application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    reply.header('Content-Disposition',`attachment; filename="procurement_${id}${group?'_'+group:''}.xlsx"`);
    return reply.send(Buffer.from(buf));
  });

  // ═══ ЗАКУПЩИК: СЧЁТ → АВТО-ЦЕНЫ, СПЛИТ, ПОДСКАЗКИ ═══

  // POST /:id/invoice/parse — распарсить счёт (Excel — сразу; PDF/фото — текст с клиента) и
  // авто-сопоставить строки с позициями заявки БЕЗ цены (article → точное имя → trigram-похожесть).
  fastify.post('/:id/invoice/parse', {preHandler:[fastify.requireRoles([...PROC_ROLES,...PM_ROLES])]}, async(req,reply)=>{
    const id=parseInt(req.params.id); if(isNaN(id)) return reply.code(400).send({error:'Неверный ID'});
    const ck=await checkNotLocked(db,id); if(ck.error) return reply.code(ck.code).send({error:ck.error});
    // multipart (Excel) ИЛИ json {text, supplier_id, supplier_name, delivery_days} (PDF/фото→AI)
    let parsedItems=[], supplierName=null, supplierId=null, deliveryDays=null, filePath=null, fileName=null;
    const ct=req.headers['content-type']||'';
    if(ct.includes('multipart')){
      const data=await req.file(); if(!data) return reply.code(400).send({error:'Файл не загружен'});
      const fields=data.fields||{};
      supplierId=fields.supplier_id?.value?parseInt(fields.supplier_id.value):null;
      supplierName=fields.supplier_name?.value||null;
      deliveryDays=fields.delivery_days?.value?parseInt(fields.delivery_days.value):null;
      let buf; try{buf=await data.toBuffer();}catch(_){return reply.code(400).send({error:'Не удалось прочитать файл'});}
      const {parseProcurementExcel}=require('../utils/excel-parser');
      try{parsedItems=await parseProcurementExcel(buf);}catch(_){return reply.code(400).send({error:'Не удалось прочитать Excel'});}
      // сохраним файл
      try{const path=require('path');const fsp=require('fs').promises;const {randomUUID}=require('crypto');
        const dir=path.join(process.env.UPLOAD_DIR||'./uploads','proc-invoices');await fsp.mkdir(dir,{recursive:true});
        fileName=(data.filename||'invoice.xlsx');const fn='inv_'+randomUUID()+'_'+fileName.replace(/[^\w.-]/g,'_');
        await fsp.writeFile(path.join(dir,fn),buf);filePath='/uploads/proc-invoices/'+fn;
      }catch(_){}
    } else {
      const b=req.body||{};
      supplierId=b.supplier_id||null;supplierName=b.supplier_name||null;deliveryDays=b.delivery_days||null;
      if(b.items&&Array.isArray(b.items)){ parsedItems=b.items; }       // клиент уже распарсил (AI на фронте)
      else if(b.text){
        const aiProvider=require('../services/ai-provider');
        try{const r=await aiProvider.complete({system:'Извлеки из текста счёта список позиций. Верни СТРОГО JSON {"supplier":"","items":[{"name":"","article":"","quantity":1,"unit":"шт","unit_price":0}]} без markdown.',
          messages:[{role:'user',content:'Счёт:\n\n'+String(b.text).slice(0,14000)}],maxTokens:4000,temperature:0.1});
          const m=(r&&r.text||'').match(/\{[\s\S]*\}/); const j=m?JSON.parse(m[0]):null;
          parsedItems=j&&Array.isArray(j.items)?j.items:[]; if(!supplierName&&j&&j.supplier)supplierName=j.supplier;
        }catch(e){ return reply.send({matches:[],unmatched:[],ai_unavailable:true,message:'AI временно недоступен'}); }
      } else return reply.code(400).send({error:'Нужен файл, items или text'});
    }
    parsedItems=(parsedItems||[]).filter(x=>x&&x.name&&String(x.name).trim());
    if(!parsedItems.length) return reply.send({matches:[],unmatched:[],message:'В счёте не найдено позиций'});
    // позиции заявки (не сплит-родители; приоритет тем, у кого ещё нет цены)
    const reqItems=(await db.query(`SELECT id,name,article,unit_price,quantity FROM procurement_items
      WHERE procurement_id=$1 AND parent_item_id IS NULL ORDER BY id`,[id])).rows;
    const used=new Set();
    const matches=[], unmatched=[];
    for(const inv of parsedItems){
      const nm=String(inv.name).trim(), art=(inv.article||'').toString().trim();
      let best=null, conf=0;
      // 1) точный артикул
      if(art){ const e=reqItems.find(r=>r.article&&r.article.toLowerCase()===art.toLowerCase()&&!used.has(r.id)); if(e){best=e;conf=1;} }
      // 2) точное имя
      if(!best){ const e=reqItems.find(r=>r.name.toLowerCase()===nm.toLowerCase()&&!used.has(r.id)); if(e){best=e;conf=0.95;} }
      // 3) trigram-похожесть в БД
      if(!best){
        const sim=await db.query(`SELECT id,similarity(lower(name),lower($2)) AS s FROM procurement_items
          WHERE procurement_id=$1 AND parent_item_id IS NULL ORDER BY s DESC LIMIT 1`,[id,nm]);
        if(sim.rows[0]&&sim.rows[0].s>=0.4&&!used.has(sim.rows[0].id)){ best=reqItems.find(r=>r.id===sim.rows[0].id); conf=parseFloat(sim.rows[0].s.toFixed(2)); }
      }
      const price=parseFloat(inv.unit_price)||null;
      if(best){ used.add(best.id); matches.push({item_id:best.id,item_name:best.name,invoice_name:nm,article:art,quantity:inv.quantity||best.quantity,unit_price:price,confidence:conf}); }
      else unmatched.push({invoice_name:nm,article:art,quantity:inv.quantity||1,unit_price:price});
    }
    // сохраним import-лог
    let importId=null;
    try{ const ins=await db.query(`INSERT INTO procurement_invoice_imports(procurement_id,supplier_id,supplier_name,delivery_days,file_path,file_name,parsed_json,created_by)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id`,[id,supplierId,supplierName,deliveryDays,filePath,fileName,JSON.stringify(parsedItems),req.user.id]);
      importId=ins.rows[0].id; }catch(e){ fastify.log.warn('[procurement] invoice import log: '+e.message); }
    return { import_id:importId, supplier_id:supplierId, supplier_name:supplierName, delivery_days:deliveryDays,
      matches, unmatched, items_for_match:reqItems.map(r=>({id:r.id,name:r.name,article:r.article,has_price:r.unit_price!=null})) };
  });

  // POST /:id/invoice/:importId/apply — массово проставить цены/поставщика/срок по сматченным строкам.
  fastify.post('/:id/invoice/:importId/apply', {preHandler:[fastify.requireRoles([...PROC_ROLES,...PM_ROLES])]}, async(req,reply)=>{
    const id=parseInt(req.params.id), importId=parseInt(req.params.importId);
    const ck=await checkNotLocked(db,id); if(ck.error) return reply.code(ck.code).send({error:ck.error});
    const rows=(req.body&&req.body.rows)||[];
    if(!Array.isArray(rows)||!rows.length) return reply.code(400).send({error:'Нет строк для применения'});
    const imp=(await db.query('SELECT * FROM procurement_invoice_imports WHERE id=$1 AND procurement_id=$2',[importId,id])).rows[0];
    const supId=req.body.supplier_id||imp?.supplier_id||null;
    const supName=req.body.supplier_name||imp?.supplier_name||null;
    const delDays=req.body.delivery_days!=null?req.body.delivery_days:(imp?.delivery_days||null);
    const client=await db.pool.connect();
    let applied=0, totalSum=0;
    try{
      await client.query('BEGIN');
      for(const r of rows){
        const itemId=parseInt(r.item_id); const price=parseFloat(r.unit_price); if(isNaN(itemId)||isNaN(price)||price<=0) continue;
        // позиция принадлежит этой заявке
        const it=(await client.query('SELECT id,quantity,product_id,product_category_id FROM procurement_items WHERE id=$1 AND procurement_id=$2',[itemId,id])).rows[0];
        if(!it) continue;
        const qty=parseFloat(it.quantity)||0; const total=price*qty;
        // Автопроставление категории из каталога, если у позиции её ещё нет
        let catId=it.product_category_id||null;
        if(!catId&&it.product_id){try{const pc=await client.query('SELECT category_id FROM products WHERE id=$1',[it.product_id]);catId=pc.rows[0]?.category_id||null;}catch(_){}}
        await client.query(`UPDATE procurement_items SET unit_price=$1,total_price=$2,supplier=COALESCE($3,supplier),supplier_id=COALESCE($4,supplier_id),
          supplier_delivery_days=COALESCE($5,supplier_delivery_days),invoice_import_id=$6,product_category_id=COALESCE(product_category_id,$8),updated_at=NOW() WHERE id=$7`,
          [price,total,supName,supId,delDays,importId||null,itemId,catId]);
        applied++; totalSum+=total;
      }
      if(importId) await client.query('UPDATE procurement_invoice_imports SET matched_count=$1,total_sum=$2 WHERE id=$3',[applied,totalSum,importId]);
      await recalcTotal(client,id);
      await logHistory(client,id,req.user.id,'invoice_applied',null,null,`Счёт${supName?' '+supName:''}: цены проставлены (${applied} поз.)`,null);
      await client.query('COMMIT');
      return { success:true, applied, total_sum:totalSum };
    }catch(e){await client.query('ROLLBACK');throw e;}finally{client.release();}
  });

  // POST /:id/items/:itemId/split — разбить позицию на части по поставщикам.
  // body: { parts:[{quantity, supplier_id?, supplier_name?, unit_price?, delivery_days?}] }
  fastify.post('/:id/items/:itemId/split', {preHandler:[fastify.requireRoles([...PROC_ROLES,...PM_ROLES])]}, async(req,reply)=>{
    const id=parseInt(req.params.id), itemId=parseInt(req.params.itemId);
    if(isNaN(id)||isNaN(itemId)) return reply.code(400).send({error:'Неверный ID'});
    const ck=await checkNotLocked(db,id); if(ck.error) return reply.code(ck.code).send({error:ck.error});
    const parts=(req.body&&req.body.parts)||[];
    if(!Array.isArray(parts)||parts.length<2) return reply.code(400).send({error:'Нужно минимум 2 части'});
    const client=await db.pool.connect();
    try{
      await client.query('BEGIN');
      const parent=(await client.query('SELECT * FROM procurement_items WHERE id=$1 AND procurement_id=$2 FOR UPDATE',[itemId,id])).rows[0];
      if(!parent){await client.query('ROLLBACK');return reply.code(404).send({error:'Позиция не найдена'});}
      if(parent.parent_item_id){await client.query('ROLLBACK');return reply.code(400).send({error:'Это уже дочерняя позиция'});}
      const already=(await client.query('SELECT COUNT(*)::int n FROM procurement_items WHERE parent_item_id=$1',[itemId])).rows[0].n;
      if(already>0){await client.query('ROLLBACK');return reply.code(400).send({error:'Позиция уже разбита'});}
      const sumQty=parts.reduce((s,p)=>s+(parseFloat(p.quantity)||0),0);
      const pQty=parseFloat(parent.quantity)||0;
      if(Math.abs(sumQty-pQty)>0.001){await client.query('ROLLBACK');return reply.code(400).send({error:`Сумма частей (${sumQty}) ≠ количеству позиции (${pQty})`});}
      // дочерние строки
      let ord=0;
      for(const p of parts){
        const q=parseFloat(p.quantity)||0; if(q<=0) continue;
        const price=parseFloat(p.unit_price)||parent.unit_price||null;
        await client.query(`INSERT INTO procurement_items(procurement_id,parent_item_id,name,article,unit,quantity,
          supplier,supplier_id,unit_price,total_price,supplier_delivery_days,product_id,product_category_id,delivery_target,sort_order)
          VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)`,
          [id,itemId,parent.name,parent.article,parent.unit,q,
           p.supplier_name||null,p.supplier_id||null,price,price?price*q:null,p.delivery_days||null,
           parent.product_id,parent.product_category_id,parent.delivery_target,(parent.sort_order||0)*100+(ord++)]);
      }
      // родитель помечается как «контейнер» (qty/цена обнуляются для recalc — считаем по детям)
      await client.query('UPDATE procurement_items SET unit_price=NULL,total_price=NULL,updated_at=NOW() WHERE id=$1',[itemId]);
      await recalcTotal(client,id);
      await logHistory(client,id,req.user.id,'item_split',null,null,`Позиция «${parent.name}» разбита на ${parts.length} ч.`,null);
      await client.query('COMMIT');
      return {success:true,parts:parts.length};
    }catch(e){await client.query('ROLLBACK');throw e;}finally{client.release();}
  });

  // DELETE /:id/items/:itemId/split — схлопнуть сплит обратно.
  fastify.delete('/:id/items/:itemId/split', {preHandler:[fastify.requireRoles([...PROC_ROLES,...PM_ROLES])]}, async(req,reply)=>{
    const id=parseInt(req.params.id), itemId=parseInt(req.params.itemId);
    if(isNaN(id)||isNaN(itemId)) return reply.code(400).send({error:'Неверный ID'});
    const ck=await checkNotLocked(db,id); if(ck.error) return reply.code(ck.code).send({error:ck.error});
    const client=await db.pool.connect();
    try{
      await client.query('BEGIN');
      const children=(await client.query('SELECT id FROM procurement_items WHERE parent_item_id=$1',[itemId])).rows;
      if(!children.length){await client.query('ROLLBACK');return reply.code(400).send({error:'Позиция не разбита'});}
      await client.query('DELETE FROM procurement_items WHERE parent_item_id=$1',[itemId]);
      await recalcTotal(client,id);
      await logHistory(client,id,req.user.id,'item_split_undo',null,null,'Сплит позиции отменён',null);
      await client.query('COMMIT');
      return {success:true};
    }catch(e){await client.query('ROLLBACK');throw e;}finally{client.release();}
  });

  // POST /price-hints — батч-подсказки цен по позициям (last + market stats).
  fastify.post('/:id/price-hints', {preHandler:[fastify.requireRoles([...PROC_ROLES,...PM_ROLES,...DIR_ROLES])]}, async(req,reply)=>{
    const items=(req.body&&req.body.items)||[];
    if(!Array.isArray(items)||!items.length) return {hints:{}};
    const hints={};
    for(const it of items){
      const pid=it.product_id?parseInt(it.product_id):null; const name=(it.name||'').trim();
      let last=null,stats=null;
      if(pid){
        const l=await db.query('SELECT unit_price,supplier_name,recorded_at FROM v_last_price_by_product WHERE product_id=$1',[pid]);
        last=l.rows[0]||null;
        const s=await db.query(`SELECT COUNT(*)::int sample_count,ROUND(AVG(unit_price),2) avg_price,MIN(unit_price) min_price,MAX(unit_price) max_price
          FROM price_records WHERE product_id=$1 AND recorded_at>=NOW()-INTERVAL '90 days'`,[pid]);
        stats=s.rows[0]?.sample_count>0?s.rows[0]:null;
      }
      // Фолбэк по имени: если по product_id истории нет (новый каталожный товар),
      // ищем последнюю цену/статистику по похожему наименованию.
      if((!last||!stats)&&name){
        if(!last){
          const l=await db.query('SELECT item_name,unit_price,supplier_name,recorded_at FROM price_records WHERE item_name ILIKE $1 ORDER BY recorded_at DESC LIMIT 1',['%'+name+'%']);
          last=l.rows[0]||null;
        }
        if(!stats){
          const s=await db.query(`SELECT COUNT(*)::int sample_count,ROUND(AVG(unit_price),2) avg_price,MIN(unit_price) min_price,MAX(unit_price) max_price
            FROM price_records WHERE item_name ILIKE $1 AND recorded_at>=NOW()-INTERVAL '90 days'`,['%'+name+'%']);
          stats=s.rows[0]?.sample_count>0?s.rows[0]:null;
        }
      }
      hints[it.key||(pid?'p'+pid:'n:'+name.toLowerCase())]={last,stats};
    }
    return {hints};
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
      // Авто-запись в базу цен: фиксируем фактическую закупочную цену для подсказок/анализа
      if(item.unit_price&&parseFloat(item.unit_price)>0){
        try{
          let supName=item.supplier||null;
          if(item.supplier_id&&!supName){const s=await client.query('SELECT name FROM suppliers WHERE id=$1',[item.supplier_id]);supName=s.rows[0]?.name||null;}
          await client.query(`INSERT INTO price_records(product_id,product_category_id,item_name,article,unit,supplier_id,supplier_name,unit_price,source,procurement_item_id,recorded_by)
            VALUES($1,$2,$3,$4,$5,$6,$7,$8,'procurement',$9,$10)`,
            [item.product_id||null,item.product_category_id||null,item.name,item.article||null,item.unit||'шт',
             item.supplier_id||null,supName,parseFloat(item.unit_price),itemId,pc.row.proc_id||user.id]);
        }catch(prErr){fastify.log.warn('[procurement] price_record insert failed: '+prErr.message);}
      }
      if(item.delivery_target==='warehouse'){
        const wh=await client.query("SELECT id FROM warehouses WHERE is_main=true LIMIT 1");
        const whId=item.warehouse_id||(wh.rows[0]&&wh.rows[0].id)||null;
        // WMS: если позиция привязана к каталогу-расходнику — приходуем количеством в stock,
        // иначе создаём поштучную единицу equipment (как было).
        // W2: учитываем is_consumable только у НЕудалённого каталога.
        let isConsumable=false, validProduct=false;
        if(item.product_id){
          try{const pr=await client.query('SELECT is_consumable FROM products WHERE id=$1 AND deleted_at IS NULL',[item.product_id]);
            if(pr.rows[0]){validProduct=true;isConsumable=!!pr.rows[0].is_consumable;}}catch(_){}
        }
        const qty=parseFloat(item.quantity)||0;
        // Раскладка по ячейкам: кладовщик может указать ячейку приёмки (location_id).
        // Валидируем, что ячейка принадлежит этому складу; иначе кладём без ячейки (NULL).
        let locId=req.body&&req.body.location_id?parseInt(req.body.location_id):null;
        if(locId&&!isNaN(locId)){
          const lc=await client.query('SELECT id FROM warehouse_locations WHERE id=$1 AND warehouse_id=$2 AND (is_active IS NULL OR is_active=true)',[locId,whId]);
          if(!lc.rows[0]) locId=null;
        } else locId=null;
        // W3: расходник приходуем в stock только при положительном количестве и валидном каталоге.
        if(isConsumable && validProduct && qty>0){
          // Надёжный upsert: SELECT FOR UPDATE → UPDATE/INSERT (с учётом ячейки).
          const exSt=await client.query('SELECT id FROM stock WHERE product_id=$1 AND warehouse_id=$2 AND location_id IS NOT DISTINCT FROM $3 FOR UPDATE',[item.product_id,whId,locId]);
          if(exSt.rows[0]) await client.query('UPDATE stock SET quantity=quantity+$1, updated_at=NOW() WHERE id=$2',[qty,exSt.rows[0].id]);
          else await client.query('INSERT INTO stock(product_id,warehouse_id,location_id,quantity,unit) VALUES($1,$2,$3,$4,$5)',[item.product_id,whId,locId,qty,item.unit||'шт']);
          await client.query(
            `INSERT INTO stock_movements(product_id,to_warehouse_id,to_location_id,qty,unit,movement_type,ref_type,ref_id,reason,created_by)
             VALUES($1,$2,$3,$4,$5,'receipt','procurement',$6,$7,$8)`,
            [item.product_id,whId,locId,qty,item.unit||'шт',procId,'Приёмка из закупки #'+procId,user.id]);
        }else{
          const qr=randomUUID();
          const invNum='INV-'+Date.now().toString(36).toUpperCase();
          const eq=await client.query(`INSERT INTO equipment(name,inventory_number,category_id,quantity,unit,purchase_price,status,warehouse_id,location_id,qr_uuid,qr_code,product_id,notes)
            VALUES($1,$2,NULL,$3,$4,$5,'on_warehouse',$6,$7,$8,$9,$10,$11) RETURNING id`,
            [item.name,invNum,item.quantity,item.unit,item.unit_price,whId,locId,qr,qr,item.product_id||null,'Из закупки #'+procId]);
          await client.query('UPDATE procurement_items SET equipment_id=$1 WHERE id=$2',[eq.rows[0].id,itemId]);
          await client.query(`INSERT INTO equipment_movements(equipment_id,movement_type,to_warehouse_id,notes,created_by)VALUES($1,'procurement_receipt',$2,$3,$4)`,
            [eq.rows[0].id,whId,'Приёмка из закупки #'+procId,user.id]);
          // Автобронь — только если работа ещё активна (не закрыта/не завершена).
          if(pc.row.work_id){
            const wa=await client.query('SELECT 1 FROM works WHERE id=$1 AND closed_at IS NULL AND completed_at IS NULL',[pc.row.work_id]);
            if(wa.rows[0]) await client.query(`INSERT INTO equipment_reservations(equipment_id,work_id,reserved_by,reserved_from,reserved_to,status,notes)
              VALUES($1,$2,$3,CURRENT_DATE,CURRENT_DATE+INTERVAL '30 days','active',$4)`,[eq.rows[0].id,pc.row.work_id,pc.row.pm_id||user.id,'Автобронь #'+procId]);
          }
        }
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

  // ═══ ВВОД ПОЗИЦИЙ ТЕКСТОМ ═══
  // Лёгкий парсер «10 мешков цемента» / «арматура 12мм - 5 шт» → {name, quantity, unit}.
  // Не-однозначное оставляем целиком в name (qty=1). AI здесь НЕ используется.
  // Единицы измерения, отсортированы по убыванию длины (длинные альтернативы — первыми,
  // иначе короткое «м» перехватит «мешков»). \b-границу ставим после единицы.
  const PROC_UNITS = ['метров','мешков','штука','рулонов','литров','тонн','штук','мешок','рулон','метр','смены','смен','упак','компл','банка','пачка','вёдер','ведро','пара','пар','шт','кг','уп','м','т','л']
    .sort((a, b) => b.length - a.length);
  const PROC_UNIT_RE = PROC_UNITS.join('|');

  function parseTextLine(line) {
    const raw = line.trim();
    if (!raw) return null;
    let name = raw, quantity = 1, unit = 'шт';
    // "<кол-во> <ед> <название>"  напр. "10 мешков цемента"
    let m = raw.match(new RegExp('^(\\d+[.,]?\\d*)\\s*(' + PROC_UNIT_RE + ')\\.?\\s+(.+)$', 'i'));
    if (m) { return { name: m[3].trim(), quantity: parseFloat(m[1].replace(',', '.')), unit: m[2].toLowerCase() }; }
    // "<название> <разделитель> <кол-во> <ед>"  напр. "арматура 12мм - 5 шт", "кран - 2 смены"
    m = raw.match(new RegExp('^(.+?)\\s*[\\-–:]?\\s*(\\d+[.,]?\\d*)\\s*(' + PROC_UNIT_RE + ')\\.?$', 'i'));
    if (m && m[1].trim()) { return { name: m[1].trim().replace(/[\s\-–:]+$/, ''), quantity: parseFloat(m[2].replace(',', '.')), unit: m[3].toLowerCase() }; }
    // "<название> <разделитель> <кол-во>" (без ед.)  напр. "Цемент М400: 20"
    m = raw.match(/^(.+?)[\s\-–:]+(\d+[.,]?\d*)$/);
    if (m && m[1].trim()) { return { name: m[1].trim(), quantity: parseFloat(m[2].replace(',', '.')), unit }; }
    // "<кол-во> <название>"  напр. "30 саморезов"
    m = raw.match(/^(\d+[.,]?\d*)\s+(.+)$/);
    if (m) { return { name: m[2].trim(), quantity: parseFloat(m[1].replace(',', '.')), unit }; }
    return { name, quantity, unit };
  }

  fastify.post('/:id/items/import-text', {preHandler:[fastify.requireRoles([...PM_ROLES,...PROC_ROLES,...DIR_ROLES])]}, async(req,reply)=>{
    const procId=parseInt(req.params.id);
    const ck=await checkNotLocked(db,procId); if(ck.error) return reply.code(ck.code).send({error:ck.error});
    const text=(req.body&&req.body.text)||'';
    const lines=String(text).split(/\r?\n/).map(parseTextLine).filter(Boolean);
    if(!lines.length) return reply.code(400).send({error:'Пустой список'});
    const client=await db.pool.connect();
    try{
      await client.query('BEGIN');
      const n=[],q=[],u=[],o=[];
      lines.forEach((it,idx)=>{n.push(it.name);q.push(it.quantity);u.push(it.unit);o.push(idx);});
      const{rows}=await client.query(`INSERT INTO procurement_items(procurement_id,name,quantity,unit,sort_order)
        SELECT $1,unnest($2::text[]),unnest($3::numeric[]),unnest($4::text[]),unnest($5::int[]) RETURNING *`,
        [procId,n,q,u,o]);
      await recalcTotal(client,procId);
      await logHistory(client,procId,req.user.id,'items_import_text',null,null,`Текстом: ${rows.length} поз.`,null);
      await client.query('COMMIT');
      return{items:rows,count:rows.length};
    }catch(e){await client.query('ROLLBACK');throw e;}finally{client.release();}
  });

  // ═══ AI-РАЗБОР ТЗ В ПОЗИЦИИ ═══
  // РП вставляет ТЗ/описание работ → AI выделяет номенклатуру (name/quantity/unit).
  // Цены AI НЕ ищет (их подбирает закупщик). Stub/demo-safe: при невалидном ответе
  // возвращаем пустой список с пометкой, НЕ падаем.
  const AI_PARSE_PROMPT = `Ты — помощник по закупкам строительной компании «Асгард Сервис».
Из текста техзадания/описания работ выдели СПИСОК материалов и оборудования для закупки.
Для каждой позиции определи: наименование, количество (число), единицу измерения.
НЕ придумывай цены и поставщиков. Если количество не указано — ставь 1.
Аренда техники (краны, погрузчики, манипуляторы) — тоже позиция, единица «смена».

Верни СТРОГО валидный JSON без markdown-обёртки и без текста до/после:
{"items":[{"name":"...","quantity":1,"unit":"шт"}]}`;

  function parseAIItemsResponse(text) {
    if (!text) return null;
    const codeMatch = text.match(/```(?:json)?\s*([\s\S]*?)```/);
    let raw = codeMatch ? codeMatch[1] : text;
    const first = raw.indexOf('{'), last = raw.lastIndexOf('}');
    if (first < 0 || last < 0) return null;
    raw = raw.substring(first, last + 1);
    try { return JSON.parse(raw); } catch (_) { return null; }
  }

  fastify.post('/:id/items/ai-parse', {preHandler:[fastify.requireRoles([...PM_ROLES,...PROC_ROLES,...DIR_ROLES])]}, async(req,reply)=>{
    const procId=parseInt(req.params.id);
    const ck=await checkNotLocked(db,procId); if(ck.error) return reply.code(ck.code).send({error:ck.error});
    const tz=(req.body&&req.body.text)||'';
    if(!tz.trim()) return reply.code(400).send({error:'Пустое ТЗ'});
    const aiProvider=require('../services/ai-provider');
    let aiResult;
    try{
      aiResult=await aiProvider.complete({
        system:AI_PARSE_PROMPT,
        messages:[{role:'user',content:'Техзадание:\n\n'+tz.slice(0,12000)}],
        maxTokens:4000, temperature:0.1
      });
    }catch(e){
      fastify.log.warn('[procurement] ai-parse failed: '+e.message);
      return reply.send({items:[],count:0,ai_unavailable:true,message:'AI временно недоступен — добавьте позиции вручную или текстом'});
    }
    const parsed=parseAIItemsResponse(aiResult&&aiResult.text);
    const aiItems=parsed&&Array.isArray(parsed.items)?parsed.items.filter(it=>it&&it.name&&String(it.name).trim()):[];
    if(!aiItems.length){
      return reply.send({items:[],count:0,ai_unavailable:!parsed,message:parsed?'AI не нашёл позиций в тексте':'AI вернул неожиданный ответ — попробуйте ввод текстом'});
    }
    // Вставляем распознанные позиции
    const client=await db.pool.connect();
    try{
      await client.query('BEGIN');
      const n=[],q=[],u=[],o=[];
      aiItems.forEach((it,idx)=>{n.push(String(it.name).trim());q.push(parseFloat(it.quantity)||1);u.push((it.unit&&String(it.unit).trim())||'шт');o.push(idx);});
      const{rows}=await client.query(`INSERT INTO procurement_items(procurement_id,name,quantity,unit,sort_order)
        SELECT $1,unnest($2::text[]),unnest($3::numeric[]),unnest($4::text[]),unnest($5::int[]) RETURNING *`,
        [procId,n,q,u,o]);
      await recalcTotal(client,procId);
      await logHistory(client,procId,req.user.id,'items_ai_parsed',null,null,`AI разобрал ТЗ: ${rows.length} поз.`,null);
      await client.query('COMMIT');
      return{items:rows,count:rows.length};
    }catch(e){await client.query('ROLLBACK');throw e;}finally{client.release();}
  });

  // ═══ КЛОН ЗАЯВКИ (повторить) ═══
  fastify.post('/:id/clone', {preHandler:[fastify.requireRoles([...PM_ROLES,...PROC_ROLES,...DIR_ROLES])]}, async(req,reply)=>{
    const srcId=parseInt(req.params.id); if(isNaN(srcId)) return reply.code(400).send({error:'Неверный ID'});
    const src=await db.query('SELECT * FROM procurement_requests WHERE id=$1',[srcId]);
    if(!src.rows[0]) return reply.code(404).send({error:'Заявка-источник не найдена'});
    const s=src.rows[0];
    const workId=req.body?.work_id!==undefined?req.body.work_id:s.work_id;
    const title=(req.body?.title||(s.title?s.title+' (копия)':'Заявка на закупку')).trim();
    const client=await db.pool.connect();
    try{
      await client.query('BEGIN');
      const{rows:nr}=await client.query(`INSERT INTO procurement_requests(work_id,title,notes,priority,author_id,pm_id,status)
        VALUES($1,$2,$3,$4,$5,$5,'draft') RETURNING *`,
        [workId||null,title,s.notes||null,s.priority||'normal',req.user.id]);
      const newId=nr[0].id;
      await client.query(`INSERT INTO procurement_items(procurement_id,name,article,unit,quantity,supplier,supplier_link,unit_price,total_price,
          product_id,product_category_id,supplier_id,delivery_target,notes,sort_order)
        SELECT $1,name,article,unit,quantity,supplier,supplier_link,unit_price,
          CASE WHEN unit_price IS NOT NULL THEN quantity*unit_price ELSE NULL END,
          product_id,product_category_id,supplier_id,delivery_target,notes,sort_order
        FROM procurement_items WHERE procurement_id=$2`,[newId,srcId]);
      await recalcTotal(client,newId);
      await logHistory(client,newId,req.user.id,'cloned',null,'draft',`Клон заявки #${srcId}`,{source_id:srcId});
      await client.query('COMMIT');
      return{item:nr[0]};
    }catch(e){await client.query('ROLLBACK');throw e;}finally{client.release();}
  });

  // ═══ ШАБЛОНЫ ЗАЯВОК ═══
  fastify.get('/templates', {preHandler:[fastify.requireRoles([...PM_ROLES,...PROC_ROLES,...DIR_ROLES])]}, async()=>{
    const{rows}=await db.query(`SELECT t.*,u.name as created_by_name,w.work_title as default_work_title,
      (SELECT COUNT(*) FROM procurement_template_items ti WHERE ti.template_id=t.id) as items_count
      FROM procurement_templates t LEFT JOIN users u ON t.created_by=u.id LEFT JOIN works w ON t.default_work_id=w.id
      WHERE t.is_active=true ORDER BY t.usage_count DESC, t.name`);
    return{items:rows};
  });

  fastify.get('/templates/:id', {preHandler:[fastify.requireRoles([...PM_ROLES,...PROC_ROLES,...DIR_ROLES])]}, async(req,reply)=>{
    const{rows}=await db.query('SELECT * FROM procurement_templates WHERE id=$1',[req.params.id]);
    if(!rows[0]) return reply.code(404).send({error:'Шаблон не найден'});
    const items=await db.query('SELECT * FROM procurement_template_items WHERE template_id=$1 ORDER BY sort_order,id',[req.params.id]);
    return{item:rows[0],items:items.rows};
  });

  fastify.post('/templates', {preHandler:[fastify.requireRoles([...PM_ROLES,...PROC_ROLES,...DIR_ROLES])]}, async(req,reply)=>{
    const{name,description,default_work_id,items}=req.body;
    if(!name||!name.trim()) return reply.code(400).send({error:'Название обязательно'});
    const client=await db.pool.connect();
    try{
      await client.query('BEGIN');
      const{rows:tr}=await client.query(`INSERT INTO procurement_templates(name,description,default_work_id,created_by)
        VALUES($1,$2,$3,$4) RETURNING *`,[name.trim(),description||null,default_work_id||null,req.user.id]);
      const tid=tr[0].id;
      if(Array.isArray(items)&&items.length){
        for(let idx=0;idx<items.length;idx++){const it=items[idx];if(!it.name||!it.name.trim())continue;
          await client.query(`INSERT INTO procurement_template_items(template_id,name,article,unit,default_quantity,typical_supplier,notes,sort_order)
            VALUES($1,$2,$3,$4,$5,$6,$7,$8)`,[tid,it.name.trim(),it.article||null,it.unit||'шт',it.default_quantity||null,it.typical_supplier||null,it.notes||null,idx]);}
      }
      await client.query('COMMIT');
      return{item:tr[0]};
    }catch(e){await client.query('ROLLBACK');throw e;}finally{client.release();}
  });

  // Сохранить существующую заявку как шаблон
  fastify.post('/templates/from-request/:reqId', {preHandler:[fastify.requireRoles([...PM_ROLES,...PROC_ROLES,...DIR_ROLES])]}, async(req,reply)=>{
    const reqId=parseInt(req.params.reqId);
    const src=await db.query('SELECT * FROM procurement_requests WHERE id=$1',[reqId]);
    if(!src.rows[0]) return reply.code(404).send({error:'Заявка не найдена'});
    const name=(req.body?.name||src.rows[0].title||'Шаблон закупки').trim();
    const client=await db.pool.connect();
    try{
      await client.query('BEGIN');
      const{rows:tr}=await client.query(`INSERT INTO procurement_templates(name,description,default_work_id,created_by)
        VALUES($1,$2,$3,$4) RETURNING *`,[name,req.body?.description||null,src.rows[0].work_id||null,req.user.id]);
      await client.query(`INSERT INTO procurement_template_items(template_id,name,article,unit,default_quantity,product_id,product_category_id,typical_supplier_id,typical_supplier,notes,sort_order)
        SELECT $1,name,article,unit,quantity,product_id,product_category_id,supplier_id,supplier,notes,sort_order
        FROM procurement_items WHERE procurement_id=$2`,[tr[0].id,reqId]);
      await client.query('COMMIT');
      return{item:tr[0]};
    }catch(e){await client.query('ROLLBACK');throw e;}finally{client.release();}
  });

  fastify.put('/templates/:id', {preHandler:[fastify.requireRoles([...PM_ROLES,...PROC_ROLES,...DIR_ROLES])]}, async(req,reply)=>{
    const allowed=['name','description','default_work_id','is_active'];
    const upd=[],vals=[];let i=1;
    for(const k of allowed) if(req.body[k]!==undefined){upd.push(`${k}=$${i++}`);vals.push(req.body[k]);}
    if(!upd.length) return reply.code(400).send({error:'Нет данных'});
    upd.push('updated_by=$'+(i++));vals.push(req.user.id);upd.push('updated_at=NOW()');vals.push(req.params.id);
    const{rows}=await db.query(`UPDATE procurement_templates SET ${upd.join(',')} WHERE id=$${i} RETURNING *`,vals);
    if(!rows[0]) return reply.code(404).send({error:'Не найден'});
    return{item:rows[0]};
  });

  fastify.delete('/templates/:id', {preHandler:[fastify.requireRoles([...PM_ROLES,...PROC_ROLES,...DIR_ROLES])]}, async(req,reply)=>{
    const{rows}=await db.query('UPDATE procurement_templates SET is_active=false WHERE id=$1 RETURNING id',[req.params.id]);
    if(!rows[0]) return reply.code(404).send({error:'Не найден'});
    return{success:true};
  });

  // Создать заявку из шаблона
  fastify.post('/from-template/:tplId', {preHandler:[fastify.requireRoles([...PM_ROLES,...PROC_ROLES,...DIR_ROLES])]}, async(req,reply)=>{
    const tplId=parseInt(req.params.tplId);
    const tpl=await db.query('SELECT * FROM procurement_templates WHERE id=$1 AND is_active=true',[tplId]);
    if(!tpl.rows[0]) return reply.code(404).send({error:'Шаблон не найден'});
    const t=tpl.rows[0];
    const workId=req.body?.work_id!==undefined?req.body.work_id:t.default_work_id;
    const mult=parseFloat(req.body?.quantity_multiplier)||1;
    const client=await db.pool.connect();
    try{
      await client.query('BEGIN');
      const{rows:nr}=await client.query(`INSERT INTO procurement_requests(work_id,title,priority,needed_by,author_id,pm_id,status)
        VALUES($1,$2,$3,$4,$5,$5,'draft') RETURNING *`,
        [workId||null,t.name,req.body?.priority||'normal',req.body?.needed_by||null,req.user.id]);
      const newId=nr[0].id;
      await client.query(`INSERT INTO procurement_items(procurement_id,name,article,unit,quantity,product_id,product_category_id,supplier_id,supplier,notes,sort_order)
        SELECT $1,name,article,unit,COALESCE(default_quantity,1)*$3,product_id,product_category_id,typical_supplier_id,typical_supplier,notes,sort_order
        FROM procurement_template_items WHERE template_id=$2`,[newId,tplId,mult]);
      await recalcTotal(client,newId);
      await client.query('UPDATE procurement_templates SET usage_count=usage_count+1 WHERE id=$1',[tplId]);
      await logHistory(client,newId,req.user.id,'created_from_template',null,'draft',`Из шаблона «${t.name}»`,{template_id:tplId});
      await client.query('COMMIT');
      return{item:nr[0]};
    }catch(e){await client.query('ROLLBACK');throw e;}finally{client.release();}
  });
}

module.exports = routes;
