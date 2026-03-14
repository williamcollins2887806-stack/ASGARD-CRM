const { Pool } = require("pg");
const fs = require("fs");
const crypto = require("crypto");

const pool = new Pool({ host:"localhost", user:"asgard", password:"123456789", database:"asgard_crm" });

function categorize(obj, description, supplier) {
  const o = (obj||"").toLowerCase();
  const d = (description||"").toLowerCase();
  const s = (supplier||"").toLowerCase();
  if (o.includes("\u0430\u0440\u0435\u043d\u0434\u0430") || d.includes("\u0430\u0440\u0435\u043d\u0434\u0430") || o === "\u043e\u0444\u0438\u0441" && (d.includes("\u0430\u0440\u0435\u043d\u0434") || s.includes("\u043d\u0435\u0434\u0432\u0438\u0436\u0438\u043c"))) return "rent";
  if (o.includes("\u0442\u0440\u0430\u043d\u0441\u043f\u043e\u0440\u0442") || d.includes("\u0442\u043e\u043f\u043b\u0438\u0432") || d.includes("\u0431\u0435\u043d\u0437\u0438\u043d") || d.includes("\u0434\u0438\u0437\u0435\u043b\u044c") || s.includes("\u043b\u0443\u043a\u043e\u0439\u043b") || s.includes("\u0433\u0430\u0437\u043f\u0440\u043e\u043c \u043d\u0435\u0444\u0442\u044c") || s.includes("\u0440\u043e\u0441\u043d\u0435\u0444\u0442\u044c") || d.includes("\u0430\u0432\u0442\u043e\u043c\u043e\u0431\u0438\u043b") || d.includes("\u0448\u0438\u043d") || d.includes("\u0433\u0440\u0443\u0437\u043e\u043f\u0435\u0440\u0435\u0432\u043e\u0437")) return "transport";
  if (d.includes("\u0441\u0432\u044f\u0437\u044c") || d.includes("\u0442\u0435\u043b\u0435\u0444\u043e\u043d") || d.includes("\u0438\u043d\u0442\u0435\u0440\u043d\u0435\u0442") || d.includes("\u0441\u0438\u043c-") || d.includes("sim") || s.includes("\u043c\u0442\u0441") || s.includes("\u0431\u0438\u043b\u0430\u0439\u043d") || s.includes("\u043c\u0435\u0433\u0430\u0444\u043e\u043d") || s.includes("\u0440\u043e\u0441\u0442\u0435\u043b\u0435\u043a\u043e\u043c") || s.includes("tele2")) return "communication";
  if (o && o \!== "\u043e\u0444\u0438\u0441" && o \!== "\u043e\u0431\u0441\u043b\u0443\u0436\u0438\u0432\u0430\u043d\u0438\u0435 \u0442\u043e" && \!o.includes("\u0430\u0440\u0435\u043d\u0434")) return "project_expense";
  return "other";
}

async function run() {
  const data = JSON.parse(fs.readFileSync("/var/www/asgard-crm/reestr_new.json", "utf8"));
  const sheetKey = Object.keys(data.sheets).find(function(k) { return k.includes("\u0420\u0435\u0435\u0441\u0442\u0440"); }) || Object.keys(data.sheets)[0];
  console.log("Sheet: " + sheetKey);
  const rows = data.sheets[sheetKey].data;
  const dataRows = rows.slice(3);
  console.log("Total expense rows to import: " + dataRows.length);
}
run().catch(console.error);