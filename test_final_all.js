const jwt = require("jsonwebtoken");
const token = jwt.sign({id:1,role:"ADMIN",name:"Admin"}, "asgard-jwt-secret-2026", {expiresIn:"1h"});
const h = {"Content-Type":"application/json","Authorization":"Bearer "+token};
let pass=0, fail=0;

async function t(label, method, url, body, expectFail) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 5000);
  const opts = {method, headers:{...h}, signal: ctrl.signal};
  if (body) opts.body = JSON.stringify(body);
  try {
    const r = await fetch("http://127.0.0.1:3000"+url, opts);
    clearTimeout(timer);
    const d = await r.json().catch(()=>({}));
    const ok = expectFail ? r.status >= 400 : r.status < 400;
    console.log((ok?"✅":"❌")+" "+label+": "+r.status);
    if (!ok) console.log("   "+JSON.stringify(d).substring(0,120));
    ok ? pass++ : fail++;
    return d;
  } catch(e) { clearTimeout(timer); console.log("❌ "+label+": "+e.message); fail++; return {}; }
}

(async () => {
  console.log("=== CORE (7) ===");
  await t("GET list", "GET", "/api/equipment?limit=2");
  await t("GET detail", "GET", "/api/equipment/1");
  await t("GET categories", "GET", "/api/equipment/categories");
  await t("GET warehouses", "GET", "/api/equipment/warehouses");
  await t("GET objects", "GET", "/api/equipment/objects");
  await t("GET stats", "GET", "/api/equipment/stats/summary");
  await t("GET available", "GET", "/api/equipment/available");

  console.log("\n=== PREMIUM (3) ===");
  await t("GET kits", "GET", "/api/equipment/kits");
  await t("GET dashboard", "GET", "/api/equipment/stats/dashboard");
  await t("GET recommend", "GET", "/api/equipment/recommend?work_type=test");

  console.log("\n=== PHOTO/ICON (4) ===");
  await t("Set icon", "POST", "/api/equipment/1/photo", {custom_icon:"🔧"});
  await t("Set photo", "POST", "/api/equipment/1/photo", {photo_url:"/t.jpg"});
  await t("Del photo", "DELETE", "/api/equipment/1/photo");
  await t("Empty 400", "POST", "/api/equipment/1/photo", {}, true);

  console.log("\n=== KIT CRUD (4) ===");
  const nk = await t("Create kit", "POST", "/api/equipment/kits", {name:"TK"+Date.now(),work_type:"T",icon:"🧪",items:[{item_name:"x",quantity:1,is_required:true}]});
  if (nk?.kit?.id) {
    await t("Get kit", "GET", "/api/equipment/kits/"+nk.kit.id);
    await t("Update kit", "PUT", "/api/equipment/kits/"+nk.kit.id, {name:"UPD"});
    await t("Delete kit", "DELETE", "/api/equipment/kits/"+nk.kit.id);
  } else { console.log("⚠️ Kit create failed"); }

  console.log("\n✅ "+pass+" passed | ❌ "+fail+" failed");
  process.exit(fail > 0 ? 1 : 0);
})();
