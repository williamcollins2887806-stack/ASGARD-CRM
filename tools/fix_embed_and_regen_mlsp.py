#!/usr/bin/env python3
"""Deploy embed fix + restore MLSP + reembed + restart regen."""
import io
import sys
import time
from pathlib import Path

import paramiko

sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8", errors="replace")

KEY = Path.home() / ".ssh" / "asgard_crm_deploy"
HOST = "92.242.61.184"
PROJECT = "/var/www/asgard-crm"
ROOT = Path(__file__).resolve().parents[1]

FILES = [
    "src/services/ai-models.js",
    "src/services/ai-provider.js",
    "src/services/embeddings-watch-cron.js",
    "src/services/academy-nmd.js",
    "src/services/academy-cron.js",
    "src/routes/academy-nmd.js",
    "src/services/mimir-conductor/rag/norms-index.js",
]

REEMBED_JS = r"""
require('dotenv').config({ path: '/var/www/asgard-crm/.env' });
async function main() {
  const db = require('../src/services/db');
  const nmd = require('../src/services/academy-nmd');
  console.log('Re-embedding NMD chunks...');
  const r = await nmd.reembedChunks(db, { force: true, batchSize: 8 });
  console.log('REEMBED_DONE', JSON.stringify(r));
  process.exit(0);
}
main().catch((e) => { console.error(e); process.exit(1); });
"""

REGEN_JS = r"""
require('dotenv').config({ path: '/var/www/asgard-crm/.env' });
async function main() {
  const cron = require('../src/services/academy-cron');
  const db = require('../src/services/db');
  const { rows: [{ n }] } = await db.query("SELECT count(*)::int AS n FROM academy_nmd_docs WHERE object_tag='mlsp'");
  console.log('NMD_DOCS', n);
  if (!n) process.exit(2);
  // Probe embed once
  const ai = require('../src/services/ai-provider');
  const vecs = await ai.embed({ texts: ['тест каркас безопасности МЛСП'] });
  const ok = Array.isArray(vecs?.[0]) && vecs[0].length > 10 && typeof vecs[0][0] === 'number';
  console.log('EMBED_OK', ok, 'dim=', vecs?.[0]?.length);
  if (!ok) { console.error('EMBED_FAIL abort regen'); process.exit(3); }
  console.log('Starting regenerateMlspWithNmd...');
  const result = await cron.regenerateMlspWithNmd();
  console.log('REGEN_RESULT', JSON.stringify(result));
  const { rows } = await db.query(
    `SELECT id, status, saga, week_number FROM academy_lessons
     WHERE (
       saga ILIKE ANY(ARRAY['%каркас%','%ИСОБР%','%риск%','%5 шаг%','%наблюден%'])
       OR EXISTS (SELECT 1 FROM unnest(COALESCE(tags, ARRAY[]::text[])) t WHERE lower(t)='млсп')
     )
     ORDER BY week_number NULLS LAST, id`
  );
  console.log('LESSONS', JSON.stringify(rows));
  process.exit(0);
}
main().catch((e) => { console.error('REGEN_FAIL', e); process.exit(1); });
"""


def main():
    key = paramiko.Ed25519Key.from_private_key_file(str(KEY))
    c = paramiko.SSHClient()
    c.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    c.connect(HOST, username="root", pkey=key, timeout=30)
    sftp = c.open_sftp()

    print("=== Upload backend ===")
    for rel in FILES:
        local = ROOT / rel
        remote = f"{PROJECT}/{rel}"
        sftp.put(str(local), remote)
        print("OK", rel)

    try:
        sftp.stat(f"{PROJECT}/scripts")
    except FileNotFoundError:
        sftp.mkdir(f"{PROJECT}/scripts")
    with sftp.file(f"{PROJECT}/scripts/_nmd_reembed.js", "w") as f:
        f.write(REEMBED_JS)
    with sftp.file(f"{PROJECT}/scripts/_nmd_regen.js", "w") as f:
        f.write(REGEN_JS)
    sftp.close()

    print("=== Restore archived MLSP NOW (users need content) ===")
    _, o, e = c.exec_command(
        """PGPASSWORD=123456789 psql -U asgard -d asgard_crm -c "
        UPDATE academy_lessons SET status='published'
        WHERE id IN (132,133,134,135,136) AND status='archived';
        SELECT id, status, saga, week_number FROM academy_lessons WHERE id IN (132,133,134,135,136) ORDER BY id;
        "
        """,
        timeout=30,
    )
    print(o.read().decode())
    print(e.read().decode())

    print("=== Restart service ===")
    _, o, e = c.exec_command(
        "systemctl restart asgard-crm && sleep 3 && systemctl is-active asgard-crm",
        timeout=60,
    )
    print(o.read().decode().strip())

    print("=== Reembed (foreground, may take a few min) ===")
    _, o, e = c.exec_command(
        f"cd {PROJECT} && node scripts/_nmd_reembed.js",
        timeout=900,
    )
    out = o.read().decode()
    print(out[-3000:])
    err = e.read().decode()
    if err:
        print("stderr:", err[-2000:])
    if "REEMBED_DONE" not in out or '"updated":0' in out.replace(" ", ""):
        # allow updated>0; if updated:0 without error still suspicious
        if "REEMBED_DONE" not in out:
            print("ABORT: reembed failed")
            c.close()
            return
        # parse updated count loosely
        import re
        m = re.search(r'"updated"\s*:\s*(\d+)', out)
        updated = int(m.group(1)) if m else -1
        if updated <= 0:
            print("ABORT: reembed updated=0")
            c.close()
            return

    print("=== Start regen in background ===")
    _, o, e = c.exec_command(
        "pkill -f '_nmd_regen' || true; "
        f"cd {PROJECT} && nohup node scripts/_nmd_regen.js > /tmp/nmd_regen.log 2>&1 & echo PID:$!",
        timeout=20,
    )
    print(o.read().decode())
    time.sleep(12)
    _, o, e = c.exec_command(
        "head -n 50 /tmp/nmd_regen.log; echo '---'; "
        "ps -ef | grep _nmd_regen | grep -v grep || echo not_running; "
        "PGPASSWORD=123456789 psql -U asgard -d asgard_crm -tAc "
        "\"SELECT count(*) FROM academy_lessons WHERE status='published' AND ("
        "EXISTS (SELECT 1 FROM unnest(COALESCE(tags, ARRAY[]::text[])) t WHERE lower(t)='млсп')"
        " OR saga ILIKE '%каркас%' OR saga ILIKE '%ИСОБР%');\"",
        timeout=20,
    )
    print(o.read().decode())

    c.close()
    print("DONE")


if __name__ == "__main__":
    main()
