#!/usr/bin/env python3
"""Deploy MLSP stay digest: recipients filter, Mon/Fri schedule, test-user exclusion."""
import hashlib
import io
import sys
from datetime import datetime
from pathlib import Path

import paramiko

sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8", errors="replace")

KEY = Path.home() / ".ssh" / "asgard_crm_deploy"
HOST = "92.242.61.184"
PROJECT = "/var/www/asgard-crm"
ROOT = Path(__file__).resolve().parents[1]
TAG = datetime.now().strftime("%Y%m%d-%H%M%S")
SNAP = f"/root/snapshots/asgard-crm-pre-deploy-mlsp-digest-{TAG}"
FILES = [
    "src/services/mlsp-stay-cron.js",
    "src/lib/user-filters.js",
]


def md5_file(path: Path) -> str:
    h = hashlib.md5()
    with path.open("rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def run(c, cmd, timeout=180):
    print("====", cmd[:220].replace("\n", " "))
    _, o, e = c.exec_command(cmd, timeout=timeout)
    out = o.read().decode("utf-8", errors="replace")
    err = e.read().decode("utf-8", errors="replace")
    code = o.channel.recv_exit_status()
    if out:
        print(out[-8000:] if len(out) > 8000 else out)
    if err.strip():
        print("STDERR:", err[:2000])
    if code != 0:
        raise SystemExit(f"FAILED ({code}): {cmd[:160]}")
    return out


def main():
    cron = (ROOT / FILES[0]).read_text(encoding="utf-8")
    if "shouldSendDigestToday" not in cron or "filterOutTestUsers" not in cron:
        raise SystemExit("marker missing in mlsp-stay-cron.js")
    if "Данилова" not in cron:
        raise SystemExit("marker missing: Danilova recipient")

    key = paramiko.Ed25519Key.from_private_key_file(str(KEY))
    c = paramiko.SSHClient()
    c.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    c.connect(HOST, username="root", pkey=key, timeout=30)
    sftp = c.open_sftp()

    tar_list = " ".join(FILES)
    run(
        c,
        f"mkdir -p /root/snapshots && tar -C {PROJECT} -czf {SNAP}.tgz {tar_list} && ls -lh {SNAP}.tgz",
    )

    for rel in FILES:
        local = ROOT / rel
        remote = f"{PROJECT}/{rel}"
        digest = md5_file(local)
        sftp.put(str(local), remote)
        with sftp.file(remote, "rb") as rf:
            remote_md5 = hashlib.md5(rf.read()).hexdigest()
        print(f"  {'OK' if remote_md5 == digest else 'FAIL'} {rel} {digest}")
        if remote_md5 != digest:
            raise SystemExit("md5 fail")

    # Данилова в settings (3460=Хосе, 3471=Вика уже есть)
    run(
        c,
        "PGPASSWORD=123456789 psql -U asgard -d asgard_crm -c "
        "\"UPDATE settings SET value_json = '[3460, 3471, 3473]'::jsonb "
        "WHERE key = 'mlsp_stay_notify_user_ids';\"",
    )

    run(c, f"grep -c shouldSendDigestToday {PROJECT}/src/services/mlsp-stay-cron.js")
    run(
        c,
        "systemctl restart asgard-crm && sleep 3 && systemctl is-active asgard-crm "
        "&& curl -sS http://127.0.0.1:3000/api/version",
    )

    sftp.close()
    c.close()
    print("DONE snapshot=", SNAP + ".tgz")


if __name__ == "__main__":
    main()
