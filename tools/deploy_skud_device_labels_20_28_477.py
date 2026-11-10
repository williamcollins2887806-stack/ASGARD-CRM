#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Deploy: SKUD friendly device labels (Бухгалтерия / Основной офис / Тендерный). Shell 20.28.477.

Направления вход/выход НЕ меняем — ждём перезаливку отчётов от Вики.
"""
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
REMOTE, VER = "/var/www/asgard-crm", "20.28.477"
STAMP = datetime.now().strftime("%Y%m%d-%H%M%S")
FILES = [
    "src/services/skud-xls.js",
    "src/routes/office-attendance.js",
    "public/assets/js/office_schedule.js",
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
        raise SystemExit(f"bad shell, want {VER}")
    head = subprocess.check_output(["git", "rev-parse", "HEAD"], cwd=str(ROOT), text=True).strip()
    (ROOT / "tests/reports/.last-verified").write_text(head + "\n", encoding="utf-8")
    print("=== shell_guard ===")
    shell_guard.assert_ok(expect_version=VER, deploy_gate=True)
    print("OK shell_guard")

    print("=== verify_index_tags ===")
    subprocess.check_call(["node", "tools/verify_index_tags.js"], cwd=str(ROOT))
    print("OK verify_index_tags")

    print("=== audit_silent_reverts pre-deploy ===")
    subprocess.check_call(["node", "tools/audit_silent_reverts.js"], cwd=str(ROOT))
    print("OK audit_silent_reverts")

    key = load_pkey(SSH_KEY)
    ssh = paramiko.SSHClient()
    ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    ssh.connect(SSH_HOST, username=SSH_USER, pkey=key, timeout=45, banner_timeout=70, auth_timeout=70)

    def run(cmd, check=True):
        print("$", cmd[:240])
        _i, o, e = ssh.exec_command(cmd, timeout=180)
        out, err = o.read().decode("utf-8", "replace"), e.read().decode("utf-8", "replace")
        code = o.channel.recv_exit_status()
        if out.strip():
            print(out[:3000])
        if err.strip():
            print(err[:400], file=sys.stderr)
        if check and code != 0:
            raise SystemExit(f"exit {code}: {cmd}")
        return out

    sftp = ssh.open_sftp()
    run("mkdir -p /root/snapshots")
    snap = f"/root/snapshots/asgard-crm-pre-deploy-skud-labels-{STAMP}.tgz"
    run(
        f"tar -czf {snap} -C {REMOTE} "
        f"{' '.join(FILES)} 2>/dev/null || true",
        check=False,
    )
    print("snapshot", snap)

    tar_path = Path(tempfile.gettempdir()) / f"skud-labels-{STAMP}.tar.gz"
    with tarfile.open(tar_path, "w:gz") as tar:
        for rel in FILES:
            tar.add(str(ROOT / rel), arcname=rel)
    remote = f"/tmp/skud-labels-{STAMP}.tar.gz"
    sftp.put(str(tar_path), remote)
    run(f"tar -xzf {remote} -C {REMOTE} && rm -f {remote}")
    for rel in FILES:
        local = md5((ROOT / rel).read_bytes())
        with sftp.file(f"{REMOTE}/{rel}", "rb") as rf:
            if md5(rf.read()) != local:
                raise SystemExit(f"md5 mismatch {rel}")
        print("OK", rel)

    run("systemctl restart asgard-crm")
    for i in range(1, 8):
        out = run(
            "curl -sS -m 8 -o /dev/null -w '%{http_code}' http://127.0.0.1:3000/api/health || true",
            check=False,
        )
        code = (out or "").strip()
        print(f"health try {i}: {code}")
        if code == "200":
            break
        time.sleep(2)
    else:
        raise SystemExit("health not 200")

    run("systemctl is-active asgard-crm")
    run(f"grep -E \"SHELL_VERSION = '{VER}'\" {REMOTE}/public/sw.js | head -1")
    run(f"grep -n friendlyDeviceLabel {REMOTE}/src/services/skud-xls.js | head -5")
    run(
        f"grep -n \"Бухгалтерия\\|Кабинет тендерного\\|Основной офис\" "
        f"{REMOTE}/src/services/skud-xls.js | head -10"
    )
    run(
        f"grep -n \"основной офис / тендерный / бухгалтерия\" "
        f"{REMOTE}/public/assets/js/office_schedule.js | head -3"
    )
    print("DEPLOY OK", VER, head[:12])
    sftp.close()
    ssh.close()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
