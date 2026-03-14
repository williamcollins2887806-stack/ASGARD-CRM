const { chromium } = require("playwright");
const https = require("https");
async function run() {
  const browser = await chromium.launch({ headless: true, args: ["--no-sandbox","--ignore-certificate-errors"] });
  const ctx = await browser.newContext({ viewport: {width:1280,height:720}, ignoreHTTPSErrors: true });
  const page = await ctx.newPage();
  const failed = [];
  page.on("response", r => { if (r.status() >= 400) failed.push(r.url() + " => " + r.status()); });

  // Login via API
  const loginRes = await new Promise((resolve,reject) => {
    const d = JSON.stringify({login:"test_admin",password:"Test123!"});
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
  console.log("Token obtained: " + token.slice(0,20) + "...");

  // Step 1: go to a blank page first, set localStorage BEFORE loading the app
  await page.goto("https://127.0.0.1/blank-page-that-wont-load-app", {waitUntil:"domcontentloaded",timeout:5000}).catch(()=>{});
  // Actually just go to the base, but intercept
  await page.goto("https://127.0.0.1", {waitUntil:"domcontentloaded",timeout:10000}).catch(()=>{});
  
  // Set token BEFORE any app JS runs
  await page.evaluate(t=>{
    localStorage.setItem("token",t);
    localStorage.setItem("asgard_token",t);
  }, token);
  
  // Now navigate to home - app will read token from localStorage
  failed.length = 0;
  await page.evaluate(()=>{ location.hash = "#/home"; });
  await new Promise(r=>setTimeout(r,5000));

  console.log("=== " + failed.length + " FAILED REQUESTS (method 2) ===");
  failed.forEach((e,i)=>console.log((i+1)+": "+e));
  
  // Check current URL to verify were logged in
