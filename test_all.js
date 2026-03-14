const jwt = require("jsonwebtoken");
const token = jwt.sign({id:1,role:"ADMIN",name:"Admin"}, "asgard-jwt-secret-2026", {expiresIn:"1h"});
const h = {"Content-Type":"application/json","Authorization":"Bearer "+token};
let pass=0, fail=0;

async function t(label, method, url, body, expectFail) {
  const opts = {method, headers:{...h}};
  if (body) opts.body = JSON.stringify(body);
  try {
    const r = await fetch("http://127.0.0.1:3000"+url, opts);
    const d = await r.json().catch(()=>({}));
    const ok = expectFail ? r.status >= 400 : r.status < 400;
    console.log((ok?"✅":"❌")+" "+label+": HTTP "+r.status);
    if (!ok) console.log("   "+JSON.stringify(d).substring(0,150));
    ok ? pass++ : fail++;
    return d;
  } catch(e) { console.log("❌ "+label+": "+e.message); fail++; return {}; }
}

(async () => {
  console.log("=== CORE ENDPOINTS ===");
  await t("GET /equipment", "GET", "/api/equipment?limit=2");
  await t("GET /equipment/1", "GET", "/api/equipment/1");
  await t("GET /categories", "GET", "/api/equipment/categories");
  await t("GET /warehouses", "GET", "/api/equipment/warehouses");
  await t("GET /objects", "GET", "/api/equipment/objects");
  await t("GET /stats/summary", "GET", "/api/equipment/stats/summary");
  await t("GET /available", "GET", "/api/equipment/available");

  console.log("\n=== PREMIUM ENDPOINTS ===");
  await t("GET /kits", "GET", "/api/equipment/kits");
  await t("GET /stats/dashboard", "GET", "/api/equipment/stats/dashboard");
  await t("GET /recommend", "GET", "/api/equipment/recommend?work_type=test");

  console.log("\n=== PHOTO/ICON ENDPOINTS ===");
  await t("POST icon", "POST", "/api/equipment/1/photo", {custom_icon: "🔧"});
  await t("POST photo_url", "POST", "/api/equipment/1/photo", {photo_url: "/test.jpg"});
  await t("DELETE photo", "DELETE", "/api/equipment/1/photo");
  await t("POST empty (400 expected)", "POST", "/api/equipment/1/photo", {}, true);

  console.log("\n=== KIT CRUD ===");
  const newKit = await t("POST /kits (create)", "POST", "/api/equipment/kits", {
    name: "TEST_KIT_"+Date.now(), work_type: "Тест", icon: "🧪",
    items: [{ item_name: "Test item", quantity: 1, is_required: true }]
  });
  const kitId = newKit?.kit?.id;
  if (kitId) {
    await t("GET /kits/"+kitId, "GET", "/api/equipment/kits/"+kitId);
    await t("PUT /kits/"+kitId, "PUT", "/api/equipment/kits/"+kitId, {name:"UPDATED_KIT"});
    await t("DELETE /kits/"+kitId, "DELETE", "/api/equipment/kits/"+kitId);
  } else {
    console.log("   ⚠️ Kit not created, skipping CRUD tests");
  }

  console.log("\n=== RESULT: ✅ "+pass+" | ❌ "+fail+" ===");
  process.exit(fail > 0 ? 1 : 0);
})();
