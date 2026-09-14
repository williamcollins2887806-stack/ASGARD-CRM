# -*- coding: utf-8 -*-
import io
import sys
import tarfile
import tempfile
from datetime import datetime
from pathlib import Path

import paramiko

sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8", errors="replace")

KEY = Path.home() / ".ssh" / "asgard_crm_deploy"
HOST = "92.242.61.184"
PROJECT = "/var/www/asgard-crm"
ROOT = Path(__file__).resolve().parents[1]
TAG = datetime.now().strftime("%Y%m%d-%H%M%S")
FILE = "src/routes/timesheet-v2.js"


def run(c, cmd, timeout=120):
    print("====", cmd[:200])
    _, o, e = c.exec_command(cmd, timeout=timeout)
    out = o.read().decode("utf-8", errors="replace")
    err = e.read().decode("utf-8", errors="replace")
    code = o.channel.recv_exit_status()
    if out:
        print(out[-4000:])
    if err.strip():
        print("STDERR:", err[:1000])
    if code != 0:
        raise SystemExit(f"fail {code}")
    return out


def main():
    text = (ROOT / FILE).read_text(encoding="utf-8")
    for m in ["08.08.2026: в табеле ТОЛЬКО", "без ячеек за месяц — не показываем"]:
        if m not in text:
            raise SystemExit(f"marker missing: {m}")

    key = paramiko.Ed25519Key.from_private_key_file(str(KEY))
    c = paramiko.SSHClient()
    c.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    c.connect(HOST, username="root", pkey=key, timeout=30)
    sftp = c.open_sftp()
    snap = f"/root/snapshots/asgard-ts-marks-only-{TAG}.tgz"
    run(c, f"tar -C {PROJECT} -czf {snap} {FILE} && ls -lh {snap}")
    sftp.put(str(ROOT / FILE), f"{PROJECT}/{FILE}")
    run(c, "systemctl restart asgard-crm && sleep 2 && systemctl is-active asgard-crm")
    # verify via python
    sftp.put(str(ROOT / "tools/_diff_86_87.py"), "/tmp/_diff8687.py")
    # patch expected: api should equal db marks
    run(c, "python3 /tmp/_diff8687.py")
    sftp.close()
    c.close()
    print("OK")


if __name__ == "__main__":
    main()
