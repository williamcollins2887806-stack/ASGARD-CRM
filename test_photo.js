process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0";
const jwt = require("jsonwebtoken");
const token = jwt.sign({id:1,role:"ADMIN",name:"Admin"}, "asgard-jwt-secret-2026", {expiresIn:"1h"});

async function run() {
  // Test 1: custom_icon via JSON
  let r = await fetch("http://127.0.0.1:3000/api/equipment/1/photo", {
    method: "POST",
    headers: {"Content-Type": "application/json", "Authorization": "Bearer " + token},
    body: JSON.stringify({custom_icon: "🔧"})
  });
  let d = await r.json();
  console.log("Test 1 - custom_icon:", r.status, JSON.stringify(d));

  // Test 2: photo_url via JSON
  r = await fetch("http://127.0.0.1:3000/api/equipment/1/photo", {
    method: "POST",
    headers: {"Content-Type": "application/json", "Authorization": "Bearer " + token},
    body: JSON.stringify({photo_url: "/uploads/test.jpg"})
  });
  d = await r.json();
  console.log("Test 2 - photo_url:", r.status, JSON.stringify(d));

  // Test 3: DELETE photo
  r = await fetch("http://127.0.0.1:3000/api/equipment/1/photo", {
    method: "DELETE",
    headers: {"Authorization": "Bearer " + token}
  });
  d = await r.json();
  console.log("Test 3 - DELETE:", r.status, JSON.stringify(d));

  // Test 4: check custom_icon in GET response
  r = await fetch("http://127.0.0.1:3000/api/equipment?limit=3", {
    headers: {"Authorization": "Bearer " + token}
  });
  d = await r.json();
  const eq = (d.equipment || [])[0];
  console.log("Test 4 - GET has custom_icon field:", eq ? ("custom_icon" in eq) : "no equipment");
}
run().catch(e => console.error("ERROR:", e.message));
