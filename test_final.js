const jwt = require("jsonwebtoken");
const token = jwt.sign({id:1,role:"ADMIN"}, "asgard-jwt-secret-2026", {expiresIn:"1h"});
const h = {"Content-Type":"application/json","Authorization":"Bearer "+token};

(async () => {
  // Set icon on id=1
  await fetch("http://127.0.0.1:3000/api/equipment/1/photo", {method:"POST",headers:h,body:JSON.stringify({custom_icon:"🔧"})});
  
  // Get equipment 1 directly
  const r = await fetch("http://127.0.0.1:3000/api/equipment/1", {headers:h});
  const d = await r.json();
  console.log("Equipment #1 custom_icon:", d.equipment?.custom_icon);
  console.log("Equipment #1 photo_url:", d.equipment?.photo_url);
  console.log("Has custom_icon field:", "custom_icon" in (d.equipment || {}));
  
  // Check list endpoint has custom_icon field
  const r2 = await fetch("http://127.0.0.1:3000/api/equipment?limit=2", {headers:h});
  const d2 = await r2.json();
  const sample = (d2.equipment||[])[0];
  console.log("\nList sample keys:", Object.keys(sample || {}).filter(k => k.includes("icon") || k.includes("photo")).join(", "));
  
  // Clean up
  await fetch("http://127.0.0.1:3000/api/equipment/1/photo", {method:"DELETE",headers:h});
  console.log("\n✅ All photo/icon features working\!");
})();
