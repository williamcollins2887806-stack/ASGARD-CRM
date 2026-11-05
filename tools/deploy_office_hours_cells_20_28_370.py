#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Deploy: readable cell hours + /flags self-scope (20.28.370)."""
from __future__ import annotations
import hashlib, subprocess, sys, tarfile, tempfile, time
from datetime import datetime
from pathlib import Path

sys.stdout.reconfigure(encoding="utf-8", errors="replace")
ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "tools"))
import paramiko, shell_guard  # noqa: E402

SSH_HOST, SSH_USER = "92.242.61.184", "root"
SSH_KEY = str(Path.home() / ".ssh" / "asgard_crm_deploy")
REMOTE, VER = "/var/www/asgard-crm", "20.28.370"
STAMP = datetime.now().strftime("%Y%m%d-%H%M%S")
FILES = [
    "src/routes/office-attendance.js",
    "public/assets/js/office_schedule.js",
    "public/assets/css/app.css",
    "public/index.html",
    "public/sw.js",
    "public/h/index.html",
    "public/h/sw.js",
]


def load_pkey(path):
    for loader in (getattr(paramiko, "Ed25519Key", None), getattr(paramiko, "ECDSAKey", None), paramiko.RSAKey):
        if loader is None:
            continue
        try:
            return loader.from_private_key_file(path)
        except Exception:
            continue
    raise SystemExit("no key")


def md5(b):
    return hashlib.md5(b).hexdigest()


def main():
    for rel in FILES:
        if not (ROOT / rel).is_file():
            raise SystemExit(f"missing {rel}")
    sw = (ROOT / "public/sw.js").read_text(encoding="utf-8")
    if f"SHELL_VERSION = '{VER}'" not in sw:
        raise SystemExit("bad shell")
    head = subprocess.check_output(["git", "rev-parse", "HEAD"], cwd=str(ROOT), text=True).strip()
    (ROOT / "tests/reports/.last-verified").write_text(head + "\n", encoding="utf-8")
    shell_guard.assert_ok(expect_version=VER, deploy_gate=True)

    key = load_pkey(SSH_KEY)
    ssh = paramiko.SSHClient()
    ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    ssh.connect(SSH_HOST, username=SSH_USER, pkey=key, timeout=45, banner_timeout=70, auth_timeout=70)

    def run(cmd, check=True):
        print("$", cmd[:220])
        _i, o, e = ssh.exec_command(cmd, timeout=180)
        out, err = o.read().decode("utf-8", "replace"), e.read().decode("utf-8", "replace")
        code = o.channel.recv_exit_status()
        if out.strip():
            print(out[:2500])
        if err.strip():
            print(err[:500], file=sys.stderr)
        if check and code != 0:
            raise SystemExit(f"exit {code}")
        return out

    sftp = ssh.open_sftp()
    run("mkdir -p /root/snapshots")
    run(
        f"tar -czf /root/snapshots/asgard-office-cells-{STAMP}.tgz -C {REMOTE} "
        f"{' '.join(FILES)} 2>/dev/null || true",
        check=False,
    )
    tar_path = Path(tempfile.gettempdir()) / f"office-cells-{STAMP}.tar.gz"
    with tarfile.open(tar_path, "w:gz") as tar:
        for rel in FILES:
            tar.add(str(ROOT / rel), arcname=rel)
    remote = f"/tmp/office-cells-{STAMP}.tar.gz"
    sftp.put(str(tar_path), remote)
    run(f"tar -xzf {remote} -C {REMOTE} && rm -f {remote}")
    for rel in FILES:
        local = md5((ROOT / rel).read_bytes())
        with sftp.file(f"{REMOTE}/{rel}", "rb") as rf:
            if md5(rf.read()) != local:
                raise SystemExit(f"md5 {rel}")
        print("OK", rel)

    run("systemctl restart asgard-crm")
    time.sleep(3)
    run("curl -sS -m 8 http://127.0.0.1:3000/api/health || true", check=False)
    run(
        "code=$(curl -sS -o /dev/null -w '%{http_code}' -m 8 "
        "http://127.0.0.1:3000/api/office-attendance/flags?year=2026\\&month=11); "
        "echo flags_http=$code; test \"$code\" = 401"
    )
    run(f"grep -E \"SHELL_VERSION = '{VER}'\" {REMOTE}/public/sw.js | head -1")
    run(f"grep -n \"is-nocredit\" {REMOTE}/public/assets/js/office_schedule.js | head -2")
    run(f"grep -n \"authenticate\" {REMOTE}/src/routes/office-attendance.js | head -5")
    print("DEPLOY OK", VER)
    sftp.close()
    ssh.close()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
