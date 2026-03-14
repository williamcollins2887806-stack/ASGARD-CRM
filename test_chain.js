const jwt = require("jsonwebtoken");
const token = jwt.sign({id:1,role:"ADMIN"}, "asgard-jwt-secret-2026", {expiresIn:"1h"});
const h = {"Content-Type":"application/json","Authorization":"Bearer "+token};

(async () => {
  // Set icon
  const r1 = await fetch("http://127.0.0.1:3000/api/equipment/1/photo", {method:"POST",headers:h,body:JSON.stringify({custom_icon:"🔧"})});
  console.log("1. Set:", (await r1.json()));

  // Get detail
  const r2 = await fetch("http://127.0.0.1:3000/api/equipment/1", {headers:h});
  const d2 = await r2.json();
  console.log("2. Detail custom_icon:", d2.equipment?.custom_icon);
  console.log("   Detail photo_url:", d2.equipment?.photo_url);

  // Clean up
  await fetch("http://127.0.0.1:3000/api/equipment/1/photo", {method:"DELETE",headers:h});
  console.log("3. Cleaned up");
})();
