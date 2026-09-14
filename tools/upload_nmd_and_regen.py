#!/usr/bin/env python3
"""Upload local MLSP NMD docs to prod and start MLSP lesson regeneration."""
from __future__ import annotations

import io
import json
import sys
from pathlib import Path

import paramiko

sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8", errors="replace")

KEY = Path.home() / ".ssh" / "asgard_crm_deploy"
HOST = "92.242.61.184"
PROJECT = "/var/www/asgard-crm"
REMOTE_STAGING = "/tmp/nmd_upload"
HOME = Path.home()

CANDIDATES = [
    HOME / "Downloads" / "_permit_nmd_extract" / "Система_ИСОБР" / "Презентация для ознакомления с ИСОБР.pdf",
    HOME / "Downloads" / "_permit_nmd_extract" / "Система_ИСОБР" / "Руководство_пользователя_ИСОБР_Шельф 4.2.3.pdf",
    HOME / "Downloads" / "_permit_nmd_extract" / "положение_РПО_utf8" / "2023.10.03_Положение РПО.pdf",
    HOME / "Downloads" / "_permit_nmd_extract" / "положение_РПО_utf8" / "2023.06.07_Перечень РПО МЛСП.pdf",
    HOME / "Downloads" / "_permit_nmd_extract" / "положение_РПО_utf8" / "Перечень ГОМ - 2022.pdf",
    HOME / "Downloads" / "_permit_nmd_extract" / "положение_РПО_utf8" / "Перечень ГОР.pdf",
    HOME / "Desktop" / "Новая папка (2)" / "01_ППР_все_тома" / "08_ОР" / "01_Оценка_рисков_ГНШ_форма.docx",
    HOME / "Downloads" / "07.17-ППР-ОР Оценка рисков.pdf",
]
KARKAS_DIR = HOME / "Desktop" / "Новая папка (2)" / "01_ППР_все_тома" / "03_Том3_Каркас"

INGEST_JS = r"""
const fs = require('fs');
const { Pool } = require('pg');
async function main() {
  const db = new Pool({
    host: 'localhost', user: 'asgard', password: '123456789', database: 'asgard_crm',
  });
  const nmd = require('/var/www/asgard-crm/src/services/academy-nmd');
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
  await db.end();
}
main().catch((e) => { console.error(e); process.exit(1); });
"""

REGEN_JS = r"""
async function main() {
  const cron = require('/var/www/asgard-crm/src/services/academy-cron');
  const db = require('/var/www/asgard-crm/src/services/db');
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


def collect_files():
    out = []
    for p in CANDIDATES:
        if p.is_file() and p.stat().st_size > 100:
            out.append((p, p.stem[:80]))
    if KARKAS_DIR.is_dir():
        for p in sorted(list(KARKAS_DIR.glob("*.docx")) + list(KARKAS_DIR.glob("*.pdf"))):
            if p.stat().st_size > 100:
                out.append((p, f"Каркас: {p.stem[:60]}"))
    seen, uniq = set(), []
    for path, title in out:
        k = path.name.lower()
        if k in seen:
            continue
        seen.add(k)
        uniq.append((path, title))
    return uniq


def main():
    files = collect_files()
    print(f"Found {len(files)} NMD files")
    for p, t in files:
        print(f"  - {t} ({p.name}, {p.stat().st_size}b)")
    if not files:
        sys.exit(1)

    key = paramiko.Ed25519Key.from_private_key_file(str(KEY))
    c = paramiko.SSHClient()
    c.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    c.connect(HOST, username="root", pkey=key, timeout=30)
    sftp = c.open_sftp()
    try:
        sftp.mkdir(REMOTE_STAGING)
    except OSError:
        pass

    manifest = []
    for i, (path, title) in enumerate(files):
        remote = f"{REMOTE_STAGING}/{i:02d}_{path.name}"
        print(f"Upload {path.name}...")
        sftp.put(str(path), remote)
        manifest.append({
            "path": remote,
            "title": title.replace("'", " ")[:120],
            "name": path.name,
        })

    with sftp.file("/tmp/nmd_manifest.json", "w") as f:
        f.write(json.dumps(manifest, ensure_ascii=False))
    with sftp.file("/tmp/nmd_ingest.js", "w") as f:
        f.write(INGEST_JS)
    with sftp.file("/tmp/nmd_regen.js", "w") as f:
        f.write(REGEN_JS)

    print("=== Ingest ===")
    _, o, e = c.exec_command(
        f"mkdir -p {PROJECT}/uploads/nmd && cd {PROJECT} && PGPASSWORD=123456789 node /tmp/nmd_ingest.js",
        timeout=900,
    )
    print(o.read().decode())
    err = e.read().decode()
    if err:
        print("stderr:", err[:3000])

    print("=== Start regen in background ===")
    _, o, e = c.exec_command(
        f"cd {PROJECT} && nohup env PGPASSWORD=123456789 node /tmp/nmd_regen.js "
        f"> /tmp/nmd_regen.log 2>&1 & echo PID:$!",
        timeout=30,
    )
    print(o.read().decode(), e.read().decode())
    sftp.close()
    c.close()
    print("UPLOAD_DONE")


if __name__ == "__main__":
    main()
