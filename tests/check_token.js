const { chromium } = require("playwright");
const https = require("https");
async function run() {
  const browser = await chromium.launch({ headless: true, args: ["--no-sandbox","--ignore-certificate-errors"] });
  const ctx = await browser.newContext({ viewport: {width:1280,height:720}, ignoreHTTPSErrors: true });
  const page = await ctx.newPage();
  // Get token
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
  // Step 1: go to welcome
  await page.goto("https://127.0.0.1/#/welcome", {waitUntil:"domcontentloaded",timeout:15000}).catch(()=>{});
  await new Promise(r=>setTimeout(r,500));
  // Step 2: set localStorage
  await page.evaluate(({t,u})=>{localStorage.setItem("token",t);localStorage.setItem("asgard_token",t);localStorage.setItem("asgard_user",JSON.stringify(u));},{t:token,u:user});
  // Step 3: check localStorage
  const check1 = await page.evaluate(()=>localStorage.getItem("asgard_token"));
  console.log("Before goto - token:", check1 ? check1.slice(0,20)+"..." : "NULL");
  // Step 4: goto home
  await page.goto("https://127.0.0.1/#/home", {waitUntil:"networkidle",timeout:20000}).catch(()=>{});
  await new Promise(r=>setTimeout(r,2000));
  // Step 5: check localStorage again
  const check2 = await page.evaluate(()=>localStorage.getItem("asgard_token"));
  console.log("After goto - token:", check2 ? check2.slice(0,20)+"..." : "NULL");
  console.log("URL:", page.url());
  await browser.close();
}
run().catch(e=>console.error(e));
