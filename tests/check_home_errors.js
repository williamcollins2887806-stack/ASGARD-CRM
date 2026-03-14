const { chromium } = require("playwright");
const https = require("https");
async function run() {
  const browser = await chromium.launch({ headless: true, args: ["--no-sandbox","--ignore-certificate-errors"] });
  const ctx = await browser.newContext({ viewport: {width:1280,height:720}, ignoreHTTPSErrors: true });
  const page = await ctx.newPage();
  const errors = [];
  page.on("console", m => { if (m.type() === "error") errors.push(m.text()); });
  page.on("pageerror", e => errors.push("PAGE_ERROR: " + e.message));
  page.on("requestfailed", r => errors.push("REQ_FAIL: " + r.url() + " " + (r.failure()||{}).errorText));
  // Login via API
  const loginRes = await new Promise((resolve,reject) => {
    const d = JSON.stringify({login:"test_admin",password:"Test123\!"});
    const req = https.request({hostname:"127.0.0.1",port:443,path:"/api/auth/login",method:"POST",headers:{"Content-Type":"application/json","Content-Length":Buffer.byteLength(d)},rejectUnauthorized:false},(res)=>{
      let b=""; res.on("data",c=>b+=c); res.on("end",()=>{try{resolve(JSON.parse(b))}catch(e){reject(e)}});
    }); req.on("error",reject); req.write(d); req.end();
  });
  let token = loginRes.token;
  if (loginRes.status === "need_pin" && token) {
    const pinRes = await new Promise((resolve,reject) => {
      const d = JSON.stringify({pin:"0000"});
      const req = https.request({hostname:"127.0.0.1",port:443,path:"/api/auth/verify-pin",method:"POST",headers:{"Content-Type":"application/json","Authorization":"Bearer "+token,"Content-Length":Buffer.byteLength(d)},rejectUnauthorized:false},(res)=>{
        let b=""; res.on("data",c=>b+=c); res.on("end",()=>{try{resolve(JSON.parse(b))}catch(e){reject(e)}});
      }); req.on("error",reject); req.write(d); req.end();
    });
    if (pinRes.token) token = pinRes.token;
  }
  await page.goto("https://127.0.0.1/#/home",{waitUntil:"networkidle",timeout:15000}).catch(()=>{});
  await page.evaluate(t=>{localStorage.setItem("token",t);localStorage.setItem("asgard_token",t);},token);
  await page.reload({waitUntil:"networkidle",timeout:15000}).catch(()=>{});
  await new Promise(r=>setTimeout(r,5000));
  console.log("=== " + errors.length + " ERRORS ===");
  errors.forEach((e,i)=>console.log((i+1)+": "+e.slice(0,300)));
  await browser.close();
}
run().catch(e=>console.error(e));
