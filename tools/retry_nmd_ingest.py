#!/usr/bin/env python3
"""Retry NMD ingest using project-local modules."""
import io
import json
import sys
from pathlib import Path

import paramiko

sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8", errors="replace")

KEY = Path.home() / ".ssh" / "asgard_crm_deploy"
HOST = "92.242.61.184"
PROJECT = "/var/www/asgard-crm"

INGEST_JS = r"""
const fs = require('fs');
const db = require('./src/services/db');
const nmd = require('./src/services/academy-nmd');

async function main() {
  const manifest = JSON.parse(fs.readFileSync('/tmp/nmd_manifest.json', 'utf8'));
  for (const item of manifest) {
    try {
      const buf = fs.readFileSync(item.path);
      const lower = item.name.toLowerCase();
      const mime = lower.endsWith('.pdf') ? 'application/pdf'
        : lower.endsWith('.docx')
          ? 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
          : 'application/octet-stream';
      const r = await nmd.ingestBuffer(db, {
        buffer: buf, originalName: item.name, mimeType: mime,
        title: item.title, objectTag: 'mlsp', uploadedBy: null,
      });
      console.log('OK', item.title, 'chunks=', r.chunks, 'id=', r.doc.id);
    } catch (e) {
      console.error('FAIL', item.title, e.message);
    }
  }
  const { rows } = await db.query('SELECT count(*)::int AS n FROM academy_nmd_docs');
  console.log('TOTAL_DOCS', rows[0].n);
  const { rows: c } = await db.query('SELECT count(*)::int AS n FROM academy_nmd_chunks');
  console.log('TOTAL_CHUNKS', c[0].n);
  process.exit(0);
}
main().catch((e) => { console.error(e); process.exit(1); });
"""

REGEN_JS = r"""
async function main() {
  const cron = require('./src/services/academy-cron');
  const db = require('./src/services/db');
  const { rows: [{ n }] } = await db.query("SELECT count(*)::int AS n FROM academy_nmd_docs WHERE object_tag='mlsp'");
  console.log('NMD_DOCS', n);
  if (!n) { console.error('No NMD'); process.exit(2); }
  console.log('Starting regenerateMlspWithNmd...');
  const result = await cron.regenerateMlspWithNmd();
  console.log('REGEN_RESULT', JSON.stringify(result));
  process.exit(0);
}
main().catch((e) => { console.error('REGEN_FAIL', e); process.exit(1); });
"""

key = paramiko.Ed25519Key.from_private_key_file(str(KEY))
c = paramiko.SSHClient()
c.set_missing_host_key_policy(paramiko.AutoAddPolicy())
c.connect(HOST, username="root", pkey=key, timeout=30)
sftp = c.open_sftp()
try:
    sftp.stat(f"{PROJECT}/scripts")
except FileNotFoundError:
    sftp.mkdir(f"{PROJECT}/scripts")
with sftp.file(f"{PROJECT}/scripts/_nmd_ingest.js", "w") as f:
    f.write(INGEST_JS)
with sftp.file(f"{PROJECT}/scripts/_nmd_regen.js", "w") as f:
    f.write(REGEN_JS)
sftp.close()

print("=== Kill bad regen ===")
_, o, e = c.exec_command("pkill -f nmd_regen.js || true; sleep 1; echo killed", timeout=20)
print(o.read().decode())

print("=== Ingest ===")
_, o, e = c.exec_command(
    f"cd {PROJECT} && node scripts/_nmd_ingest.js",
    timeout=900,
)
print(o.read().decode())
err = e.read().decode()
if err:
    print("stderr:", err[:4000])

print("=== Regen background ===")
_, o, e = c.exec_command(
    f"cd {PROJECT} && nohup node scripts/_nmd_regen.js > /tmp/nmd_regen.log 2>&1 & echo PID:$!",
    timeout=30,
)
print(o.read().decode(), e.read().decode())
c.close()
print("DONE")
