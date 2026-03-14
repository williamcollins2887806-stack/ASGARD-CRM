const jwt = require("jsonwebtoken");
const token = jwt.sign({id:1,role:"ADMIN"}, "asgard-jwt-secret-2026", {expiresIn:"1h"});
const h = {"Content-Type":"application/json","Authorization":"Bearer "+token};

(async () => {
  // Set icon
  await fetch("http://127.0.0.1:3000/api/equipment/1/photo", {method:"POST",headers:h,body:JSON.stringify({custom_icon:"🔧"})});
  
  // Check DB directly via API
  const r = await fetch("http://127.0.0.1:3000/api/equipment/1", {headers:h});
  const d = await r.json();
  
  // Full equipment object keys
  const eq = d.equipment;
  if (eq) {
    console.log("Keys:", Object.keys(eq).join(", "));
    console.log("\nphoto_url:", JSON.stringify(eq.photo_url));
    console.log("custom_icon:", JSON.stringify(eq.custom_icon));
    console.log("name:", eq.name);
    console.log("id:", eq.id);
  } else {
    console.log("No equipment in response:", JSON.stringify(d).substring(0, 300));
  }

  await fetch("http://127.0.0.1:3000/api/equipment/1/photo", {method:"DELETE",headers:h});
})();
