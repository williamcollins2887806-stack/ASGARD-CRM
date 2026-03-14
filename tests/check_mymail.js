const { chromium } = require("playwright");
const https = require("https");
async function run() {
  const browser = await chromium.launch({ headless: true, args: ["--no-sandbox","--ignore-certificate-errors"] });
  const ctx = await browser.newContext({ viewport: {width:1280,height:720}, ignoreHTTPSErrors: true });
  const page = await ctx.newPage();
  const failed = [];
  page.on("response", r => { if (r.status() >= 400) failed.push(r.url() + " => " + r.status()); });
  page.on("console", m => { if (m.type() === "error") failed.push("CONSOLE: " + m.text().slice(0,200)); });
  const loginRes = await new Promise((resolve,reject) => {
    const d = JSON.stringify({login:"test_admin",password:"Test123\!"});
    const req = https.request({hostname:"127.0.0.1",port:443,path:"/api/auth/login",method:"POST",headers:{"Content-Type":"application/json","Content-Length":Buffer.byteLength(d)},rejectUnauthorized:false},(res)=>{
      let b=""; res.on("data",c=>b+=c); res.on("end",()=>resolve(JSON.parse(b)));
    }); req.on("error",reject); req.write(d); req.end();
  });
  let token = loginRes.token;
  if (loginRes.status === "need_pin" && token) {
    const pinRes = await new Promise((resolve,reject) => {
      const d = JSON.stringify({pin:"0000"});
      const req = https.request({hostname:"127.0.0.1",port:443,path:"/api/auth/verify-pin",method:"POST",headers:{"Content-Type":"application/json","Authorization":"Bearer "+token,"Content-Length":Buffer.byteLength(d)},rejectUnauthorized:false},(res)=>{
        let b=""; res.on("data",c=>b+=c); res.on("end",()=>resolve(JSON.parse(b)));
      }); req.on("error",reject); req.write(d); req.end();
    });
    if (pinRes.token) token = pinRes.token;
  }
  const userData = await new Promise((resolve,reject) => {
    const req = https.request({hostname:"127.0.0.1",port:443,path:"/api/auth/me",method:"GET",headers:{"Authorization":"Bearer "+token},rejectUnauthorized:false},(res)=>{
      let b=""; res.on("data",c=>b+=c); res.on("end",()=>resolve(JSON.parse(b)));
    }); req.on("error",reject); req.end();
  });
  const user = userData.user || userData;
  await page.goto("https://127.0.0.1/#/welcome", {waitUntil:"domcontentloaded",timeout:15000}).catch(()=>{});
  await new Promise(r=>setTimeout(r,500));
  await page.evaluate(({t,u})=>{localStorage.setItem("token",t);localStorage.setItem("asgard_token",t);localStorage.setItem("asgard_user",JSON.stringify(u));},{t:token,u:user});
  await page.goto("https://127.0.0.1/#/home", {waitUntil:"networkidle",timeout:20000}).catch(()=>{});
  await new Promise(r=>setTimeout(r,2000));
  // Clear errors from home
  failed.length = 0;
  // Navigate to my-mail
  await page.evaluate(()=>{location.hash="#/my-mail";});
  await new Promise(r=>setTimeout(r,5000));
  console.log("URL:", page.url());
  console.log("=== my-mail: " + failed.length + " errors ===");
  failed.forEach((e,i)=>console.log((i+1)+": "+e));
  // Also check cash-admin
  failed.length = 0;
  await page.evaluate(()=>{location.hash="#/cash-admin";});
  await new Promise(r=>setTimeout(r,5000));
  console.log("=== cash-admin: " + failed.length + " errors ===");
  failed.forEach((e,i)=>console.log((i+1)+": "+e));
  await browser.close();
}
run().catch(e=>console.error(e));
