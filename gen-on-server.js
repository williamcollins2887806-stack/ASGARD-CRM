const fs = require("fs");
const ex = fs.readFileSync("/var/www/asgard-crm/full-reimport.js", "utf8");

function extractConst(name) {
  const start = ex.indexOf("const " + name + " = {");
  const end = ex.indexOf("};", start) + 2;
  return ex.substring(start, end);
}

function extractFunc(name) {
  const start = ex.indexOf("function " + name + "(");
  let depth = 0;
  let i = ex.indexOf("{", start);
  for (; i < ex.length; i++) {
    if (ex[i] === "{") depth++;
    if (ex[i] === "}") { depth--; if (depth === 0) break; }
  }
  return ex.substring(start, i + 1);
}

const pmMap = extractConst("PM_MAP");
const tsMap = extractConst("TENDER_STATUS_MAP");
const wsMap = extractConst("WORK_STATUS_MAP");
const parseNum = extractFunc("parseNumber");
const parseInn = extractFunc("parseINN");

const mainCode = fs.readFileSync("/var/www/asgard-crm/update-import-logic.js", "utf8");

const header = [
  "// UPDATE IMPORT: Upsert 551 tenders from new Excel into DB",
  "const { Client } = require(\"pg\");",
  "const fs = require(\"fs\");",
  "",
  "const DB = { host: \"localhost\", port: 5432, database: \"asgard_crm\", user: \"asgard\", password: \"123456789\" };",
].join("
");

const script = header + "

" + pmMap + "

" + tsMap + "

" + wsMap + "

" + parseNum + "

" + parseInn + "

" + mainCode;
fs.writeFileSync("/var/www/asgard-crm/update-import.js", script, "utf8");
console.log("Script written, length: " + script.length);