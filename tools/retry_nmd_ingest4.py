#!/usr/bin/env python3
import io
import sys
from pathlib import Path

import paramiko

sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8", errors="replace")
KEY = Path.home() / ".ssh" / "asgard_crm_deploy"
key = paramiko.Ed25519Key.from_private_key_file(str(KEY))
c = paramiko.SSHClient()
c.set_missing_host_key_policy(paramiko.AutoAddPolicy())
c.connect("92.242.61.184", username="root", pkey=key, timeout=30)

INGEST = r"""
require('dotenv').config({ path: '/var/www/asgard-crm/.env' });
const fs = require('fs');
const db = require('../src/services/db');
const nmd = require('../src/services/academy-nmd');
async function main() {
  const manifest = JSON.parse(fs.readFileSync('/tmp/nmd_manifest.json', 'utf8'));
  console.log('manifest', manifest.length);
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
  const { rows: ch } = await db.query('SELECT count(*)::int AS n FROM academy_nmd_chunks');
  console.log('TOTAL_CHUNKS', ch[0].n);
  process.exit(0);
}
main().catch((e) => { console.error(e); process.exit(1); });
"""

REGEN = r"""
require('dotenv').config({ path: '/var/www/asgard-crm/.env' });
async function main() {
  const cron = require('../src/services/academy-cron');
  const db = require('../src/services/db');
  const { rows: [{ n }] } = await db.query("SELECT count(*)::int AS n FROM academy_nmd_docs WHERE object_tag='mlsp'");
  console.log('NMD_DOCS', n);
  if (!n) process.exit(2);
  console.log('Starting regenerate...');
  const result = await cron.regenerateMlspWithNmd();
  console.log('REGEN_RESULT', JSON.stringify(result));
  process.exit(0);
}
main().catch((e) => { console.error(e); process.exit(1); });
"""

sftp = c.open_sftp()
try:
    sftp.stat("/var/www/asgard-crm/scripts")
except FileNotFoundError:
    sftp.mkdir("/var/www/asgard-crm/scripts")
with sftp.file("/var/www/asgard-crm/scripts/_nmd_ingest.js", "w") as f:
    f.write(INGEST)
with sftp.file("/var/www/asgard-crm/scripts/_nmd_regen.js", "w") as f:
    f.write(REGEN)
sftp.close()

_, o, _ = c.exec_command("pkill -f '_nmd_regen' || true; pkill -f nmd_regen || true; echo ok", timeout=15)
print(o.read().decode())

print("=== INGEST ===")
_, o, e = c.exec_command("cd /var/www/asgard-crm && node scripts/_nmd_ingest.js", timeout=900)
print(o.read().decode())
err = e.read().decode()
if err:
    print("STDERR", err[:8000])

print("=== REGEN BG ===")
_, o, e = c.exec_command(
    "cd /var/www/asgard-crm && nohup node scripts/_nmd_regen.js > /tmp/nmd_regen.log 2>&1 & echo PID:$!; sleep 2; head -20 /tmp/nmd_regen.log",
    timeout=30,
)
print(o.read().decode())
print(e.read().decode())
c.close()
print("DONE")
