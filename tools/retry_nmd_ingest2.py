#!/usr/bin/env python3
import io, sys
from pathlib import Path
import paramiko

sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8", errors="replace")
KEY = Path.home() / ".ssh" / "asgard_crm_deploy"
key = paramiko.Ed25519Key.from_private_key_file(str(KEY))
c = paramiko.SSHClient()
c.set_missing_host_key_policy(paramiko.AutoAddPolicy())
c.connect("92.242.61.184", username="root", pkey=key, timeout=30)

INGEST = r'''
const fs = require('fs');
const db = require('/var/www/asgard-crm/src/services/db');
const nmd = require('/var/www/asgard-crm/src/services/academy-nmd');
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
'''

REGEN = r'''
async function main() {
  const cron = require('/var/www/asgard-crm/src/services/academy-cron');
  const db = require('/var/www/asgard-crm/src/services/db');
  const { rows: [{ n }] } = await db.query("SELECT count(*)::int AS n FROM academy_nmd_docs WHERE object_tag='mlsp'");
  console.log('NMD_DOCS', n);
  if (!n) process.exit(2);
  const result = await cron.regenerateMlspWithNmd();
  console.log('REGEN_RESULT', JSON.stringify(result));
  process.exit(0);
}
main().catch((e) => { console.error(e); process.exit(1); });
'''

sftp = c.open_sftp()
_, o, e = c.exec_command(
    "ls -la /var/www/asgard-crm/src/services/db.js; ls /tmp/nmd_manifest.json; pkill -f _nmd_regen || true; pkill -f nmd_regen || true",
    timeout=20,
)
print(o.read().decode())
print(e.read().decode())

with sftp.file("/tmp/nmd_ingest2.js", "w") as f:
    f.write(INGEST)
with sftp.file("/tmp/nmd_regen2.js", "w") as f:
    f.write(REGEN)
sftp.close()

print("=== INGEST ===")
_, o, e = c.exec_command("cd /var/www/asgard-crm && node /tmp/nmd_ingest2.js", timeout=900)
print(o.read().decode())
err = e.read().decode()
if err:
    print("STDERR", err[:5000])

print("=== REGEN BG ===")
_, o, e = c.exec_command(
    "cd /var/www/asgard-crm && nohup node /tmp/nmd_regen2.js > /tmp/nmd_regen.log 2>&1 & echo PID:$!",
    timeout=20,
)
print(o.read().decode())
c.close()
