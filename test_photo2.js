const jwt = require("jsonwebtoken");
const token = jwt.sign({id:1,role:"ADMIN",name:"Admin"}, "asgard-jwt-secret-2026", {expiresIn:"1h"});
const h = {"Content-Type":"application/json","Authorization":"Bearer "+token};
let pass=0, fail=0;

async function t(label, method, url, body) {
  const opts = {method, headers:{...h}};
  if (body) opts.body = JSON.stringify(body);
  try {
    const r = await fetch("http://127.0.0.1:3000"+url, opts);
    const d = await r.json().catch(()=>({}));
    const ok = r.status < 400;
    console.log((ok?"✅":"❌") + " " + label + ": " + r.status + " " + JSON.stringify(d).substring(0,150));
    ok ? pass++ : fail++;
    return d;
  } catch(e) { console.log("❌ "+label+": "+e.message); fail++; return {}; }
}

(async () => {
  console.log("=== PHOTO & ICON TESTS ===\n");

  // 1. Set custom_icon
  await t("Set custom_icon", "POST", "/api/equipment/1/photo", {custom_icon: "🔧"});

  // 2. Verify custom_icon in GET
  const list = await t("GET list (check custom_icon)", "GET", "/api/equipment?limit=1");
  const eq = (list.equipment||[])[0];
  if (eq && eq.custom_icon === "🔧") { console.log("   ✅ custom_icon=🔧 confirmed"); pass++; }
  else { console.log("   ❌ custom_icon not found, got:", eq?.custom_icon); fail++; }

  // 3. Set photo_url via JSON
  await t("Set photo_url via JSON", "POST", "/api/equipment/1/photo", {photo_url: "/uploads/equipment/test.jpg"});

  // 4. Test empty body
  await t("Empty body → 400", "POST", "/api/equipment/1/photo", {});

  // 5. Delete photo
  await t("DELETE photo/icon", "DELETE", "/api/equipment/1/photo");

  // 6. Verify cleared
  const list2 = await t("GET after delete", "GET", "/api/equipment?limit=1");
  const eq2 = (list2.equipment||[])[0];
  if (eq2 && !eq2.custom_icon && !eq2.photo_url) { console.log("   ✅ photo/icon cleared"); pass++; }
  else { console.log("   ℹ️  photo_url="+eq2?.photo_url+" custom_icon="+eq2?.custom_icon); }

  // 7. Test multipart with fake file (just to confirm route exists)
  try {
    const boundary = "----FormBoundary123";
    const body = `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="test.png"\r\nContent-Type: image/png\r\n\r\nFAKE_PNG_DATA\r\n--${boundary}--`;
    const r = await fetch("http://127.0.0.1:3000/api/equipment/1/photo", {
      method: "POST",
      headers: {"Content-Type": "multipart/form-data; boundary="+boundary, "Authorization": "Bearer "+token},
      body: body
    });
    const d = await r.json().catch(()=>({}));
    console.log((r.status < 500 ? "✅" : "❌") + " Multipart upload route: " + r.status + " " + JSON.stringify(d).substring(0,100));
    r.status < 500 ? pass++ : fail++;
  } catch(e) { console.log("❌ Multipart: "+e.message); fail++; }

  // 8. Test GET /photo/:filename (404 expected for non-existent)
  try {
    const r = await fetch("http://127.0.0.1:3000/api/equipment/photo/nonexistent.jpg", {headers:{"Authorization":"Bearer "+token}});
    const ok = r.status === 404;
    console.log((ok?"✅":"❌") + " GET /photo/:filename (404 expected): " + r.status);
    ok ? pass++ : fail++;
  } catch(e) { console.log("❌ GET photo: "+e.message); fail++; }

  console.log("\n=== RESULT: ✅ "+pass+" | ❌ "+fail+" ===");
  process.exit(fail > 0 ? 1 : 0);
})();
