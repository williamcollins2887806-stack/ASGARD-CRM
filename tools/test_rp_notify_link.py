#!/usr/bin/env python3
"""Trigger test rp-review email on prod with fixed link."""
import io
import sys
from pathlib import Path

import paramiko

sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8", errors="replace")

KEY = Path.home() / ".ssh" / "asgard_crm_deploy"
HOST = "92.242.61.184"
PROJECT = "/var/www/asgard-crm"

NODE_SCRIPT = """
const db = require('../src/services/db');
const { notifyToOnReviewReady } = require('../src/services/rp-review-notify');
(async () => {
  await notifyToOnReviewReady(db, {
    tenderId: 1868,
    kind: 'report',
    actorName: 'Тест ссылки',
    log: console
  });
  console.log('notify sent');
  process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
"""

c = paramiko.SSHClient()
c.set_missing_host_key_policy(paramiko.AutoAddPolicy())
c.connect(HOST, username="root", pkey=paramiko.Ed25519Key.from_private_key_file(str(KEY)), timeout=30)
sftp = c.open_sftp()
remote_js = f"{PROJECT}/tools/_test_rp_notify.js"
with sftp.file(remote_js, "w") as f:
    f.write(NODE_SCRIPT)
sftp.close()

cmd = (
    f"cd {PROJECT} && set -a && [ -f .env ] && . ./.env; set +a; "
    f"node tools/_test_rp_notify.js"
)
_, o, e = c.exec_command(cmd, timeout=90)
out = o.read().decode("utf-8", errors="replace")
err = e.read().decode("utf-8", errors="replace")
print(out)
if err.strip():
    print("ERR:", err)

_, o2, _ = c.exec_command(
    "sudo -u postgres psql -d asgard_crm -t -A -F'|' -c "
    "\"SELECT id, subject, to_emails, left(body_text, 200) FROM emails "
    "WHERE direction='outbound' ORDER BY id DESC LIMIT 1\"",
    timeout=30,
)
print("last email:", o2.read().decode("utf-8", errors="replace").strip())
c.exec_command(f"rm -f {remote_js}", timeout=10)
c.close()
