#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Deploy journey-map fan-out fix + orphan stages (backend + /m)."""
import io
import json
import subprocess
import sys
import tarfile
import tempfile
from pathlib import Path

import paramiko

sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8", errors="replace")

KEY = Path.home() / ".ssh" / "asgard_crm_deploy"
HOST = "92.242.61.184"
ROOT = Path(__file__).resolve().parents[1]
PROJECT = "/var/www/asgard-crm"
TAG = "journey-fanout-orphan-20260911"

FILES = [
    "src/routes/field-gamification.js",
]


def main():
    print("=== BUILD mobile-app ===")
    r = subprocess.run(
        ["npm", "run", "build"],
        cwd=str(ROOT / "public" / "mobile-app"),
        capture_output=True,
        text=True,
        shell=True,
    )
    if r.stdout:
        print(r.stdout[-2500:])
    if r.returncode != 0:
        print(r.stderr[-4000:] if r.stderr else "")
        raise SystemExit("build failed")

    subprocess.run(
        [
            "robocopy",
            str(ROOT / "public" / "mobile-app" / "dist"),
            str(ROOT / "public" / "m"),
            "/MIR",
            "/NFL",
            "/NDL",
            "/NJH",
            "/NJS",
            "/nc",
            "/ns",
            "/np",
        ],
        shell=True,
    )
    index_html = (ROOT / "public" / "m" / "index.html").read_text(encoding="utf-8")
    if "index-" not in index_html:
        raise SystemExit("m/index.html missing chunk")
    src_journey = (ROOT / "public/mobile-app/src/pages/field/FieldJourney.jsx").read_text(
        encoding="utf-8"
    )
    if "is_orphan" not in src_journey:
        raise SystemExit("FieldJourney missing is_orphan")
    gam = (ROOT / "src/routes/field-gamification.js").read_text(encoding="utf-8")
    if "WITH checks AS" not in gam or "is_orphan" not in gam:
        raise SystemExit("field-gamification.js missing fix markers")
    print("local markers ok")

    key = paramiko.Ed25519Key.from_private_key_file(str(KEY))
    c = paramiko.SSHClient()
    c.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    c.connect(HOST, username="root", pkey=key, timeout=30)
    sftp = c.open_sftp()

    def run(cmd, timeout=300):
        print("====", cmd[:220])
        _, o, e = c.exec_command(cmd, timeout=timeout)
        out = o.read().decode("utf-8", "replace")
        err = e.read().decode("utf-8", "replace")
        if out.strip():
            print(out[-10000:] if len(out) > 10000 else out)
        if err.strip():
            print("STDERR:", err[:3000])
        return out

    run(
        f"mkdir -p /root/snapshots && tar czf /root/snapshots/asgard-crm-pre-{TAG}-$(date +%Y%m%d-%H%M%S).tar.gz "
        f"-C {PROJECT} src/routes/field-gamification.js public/m/index.html "
        f"$(ls {PROJECT}/public/m/assets/index-*.js 2>/dev/null | head -2 | sed 's|{PROJECT}/||') "
        f"2>/dev/null; ls -lt /root/snapshots | head -3"
    )

    for rel in FILES:
        remote = f"{PROJECT}/{rel}"
        run(f"mkdir -p $(dirname {remote})")
        sftp.put(str(ROOT / rel), remote)
        print("UP", rel)

    tmp_tar = Path(tempfile.gettempdir()) / f"asgard_m_{TAG}.tar"
    with tarfile.open(tmp_tar, "w") as tar:
        tar.add(ROOT / "public" / "m", arcname="m")
    print("TAR", tmp_tar.stat().st_size)
    sftp.put(str(tmp_tar), f"/tmp/asgard_m_{TAG}.tar")
    run(
        f"cd {PROJECT}/public && cp -a m m.bak-{TAG}-$(date +%H%M%S) && "
        f"rm -rf m && tar -xf /tmp/asgard_m_{TAG}.tar && "
        "test -f m/index.html && grep -o 'index-[^\"]*\\.js' m/index.html | head -1"
    )

    run(
        "systemctl restart asgard-crm && sleep 6 && "
        "curl -sS http://127.0.0.1:3000/api/version; echo; "
        "curl -sS -o /dev/null -w 'm=%{http_code}\\n' http://127.0.0.1:3000/m/; "
        f"grep -c 'WITH checks AS' {PROJECT}/src/routes/field-gamification.js; "
        f"grep -c 'is_orphan' {PROJECT}/src/routes/field-gamification.js; "
        "chunk=$(grep -oE 'index-[A-Za-z0-9_-]+\\.js' /var/www/asgard-crm/public/m/index.html | head -1); "
        "echo CHUNK=$chunk; "
        "grep -c 'is_orphan' /var/www/asgard-crm/public/m/assets/$chunk || true; "
        "grep -c 'Вне объекта' /var/www/asgard-crm/public/m/assets/$chunk || true"
    )

    # Mint field token for Trukhin (320) and hit journey-map
    verify = r"""
cd /var/www/asgard-crm && node <<'NODE'
const crypto = require('crypto');
const db = require('./src/services/db');
(async () => {
  const eid = 320;
  const token = crypto.randomBytes(32).toString('hex');
  const hash = crypto.createHash('sha256').update(token).digest('hex');
  await db.query(
    `INSERT INTO field_sessions (employee_id, token_hash, device_info, expires_at)
     VALUES ($1, $2, $3, NOW() + interval '1 hour')`,
    [eid, hash, JSON.stringify({ deploy_verify: 'journey-fanout' })]
  );
  const http = require('http');
  const data = await new Promise((resolve, reject) => {
    const req = http.request({
      hostname: '127.0.0.1', port: 3000,
      path: '/api/field/gamification/journey-map',
      method: 'GET',
      headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
    }, (res) => {
      let b = '';
      res.on('data', (c) => b += c);
      res.on('end', () => resolve({ status: res.statusCode, body: b }));
    });
    req.on('error', reject);
    req.end();
  });
  const j = JSON.parse(data.body);
  const summary = {
    http: data.status,
    stats: j.stats,
    projects: (j.projects || []).map(p => ({
      work_id: p.work_id,
      name: p.object_name || p.work_title,
      shifts: p.total_shifts,
      earned: Number(p.total_earned),
      orphan: !!p.is_orphan,
    })),
  };
  console.log(JSON.stringify(summary, null, 2));
  const shiftsOk = summary.stats.total_shifts === 1114;
  const earnedOk = Math.abs(Number(summary.stats.total_earned) - 9110000) < 5;
  const noFanout = summary.stats.total_shifts < 2000;
  const hasOrphan = summary.projects.some(p => p.orphan);
  console.log(JSON.stringify({ httpOk: data.status === 200, shiftsOk, earnedOk, noFanout, hasOrphan }));
  if (data.status !== 200 || !shiftsOk || !earnedOk || !noFanout || !hasOrphan) process.exit(2);
  process.exit(0);
})().catch(e => { console.error(e); process.exit(1); });
NODE
"""
    out = run(verify, timeout=60)
    sftp.close()
    c.close()
    tmp_tar.unlink(missing_ok=True)
    print("DONE", TAG)


if __name__ == "__main__":
    main()
