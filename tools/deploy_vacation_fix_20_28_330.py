#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Deploy: фиксы графика отпусков (shell 20.28.330).

Состав:
  * src/routes/vacations.js              — t7xlsx без vacation_id; явный 404 kind
  * public/assets/js/vacation_schedule.js — день недели над каждым числом;
                                           выделение через границу месяца;
                                           блок клика по уже занятому дню
  * public/assets/css/vacation.css       — метка has-sel на свёрнутом месяце
  * templates/vacation-*-tpl.docx        — шаблоны заявления / Т-6 / Т-7 (на проде отсутствовали → 500)
  * public/index.html, public/sw.js, public/h/* — bump 20.28.330

Порядок: shell_guard(deploy-gate) → snapshot → tar+scp → restart → health → verify docs.
Откат: tar -xzf <snap> -C /var/www/asgard-crm && systemctl restart asgard-crm
"""
from __future__ import annotations

import hashlib
import sys
import tarfile
import tempfile
import time
from datetime import datetime
from pathlib import Path

sys.stdout.reconfigure(encoding="utf-8", errors="replace")

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "tools"))
import paramiko  # noqa: E402
import shell_guard  # noqa: E402

SSH_HOST = "92.242.61.184"
SSH_USER = "root"
SSH_KEY = str(Path.home() / ".ssh" / "asgard_crm_deploy")
REMOTE = "/var/www/asgard-crm"
VER = "20.28.330"
STAMP = datetime.now().strftime("%Y%m%d-%H%M%S")

TAR_PATHS = [
    "src/routes/vacations.js",
    "public/assets/js/vacation_schedule.js",
    "public/assets/css/vacation.css",
    "templates/vacation-application-tpl.docx",
    "templates/vacation-order-t6-tpl.docx",
    "templates/vacation-schedule-t7-tpl.docx",
    "public/index.html",
    "public/sw.js",
    "public/h/index.html",
    "public/h/sw.js",
]

MARKERS = [
    ("src/routes/vacations.js", "kind === 't7' || kind === 't7xlsx'", "t7xlsx без vacation_id"),
    ("public/assets/js/vacation_schedule.js", "WEEKDAYS[(dow(S.year, m, c.d) + 6) % 7]", "день недели над числом"),
    ("public/assets/js/vacation_schedule.js", "переход месяца сохраняет выделение", "cross-month sel"),
    ("public/assets/css/vacation.css", "vs-mon__mk.is-sel", "метка выделения месяца"),
]


def load_pkey(path: str):
    for loader in (getattr(paramiko, "Ed25519Key", None), getattr(paramiko, "ECDSAKey", None), paramiko.RSAKey):
        if loader is None:
            continue
        try:
            return loader.from_private_key_file(path)
        except Exception:
            continue
    raise SystemExit(f"cannot load SSH key: {path}")


def md5(b: bytes) -> str:
    return hashlib.md5(b).hexdigest()


def main() -> int:
    for rel in TAR_PATHS:
        if not (ROOT / rel).is_file():
            raise SystemExit(f"missing: {rel}")

    print("=== LOCAL MARKERS ===")
    for rel, needle, label in MARKERS:
        text = (ROOT / rel).read_text(encoding="utf-8", errors="replace")
        if needle not in text:
            raise SystemExit(f"локально нет маркера: {label}")
        print(f"  OK {label}")

    print("=== SHELL GUARD ===")
    shell_guard.assert_ok(expect_version=VER, deploy_gate=True)

    key = load_pkey(SSH_KEY)
    ssh = paramiko.SSHClient()
    ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    for attempt in range(1, 6):
        try:
            ssh.connect(SSH_HOST, username=SSH_USER, pkey=key, timeout=45,
                        banner_timeout=70, auth_timeout=70)
            print(f"ssh: connected (attempt {attempt})")
            break
        except Exception as e:
            print(f"ssh: attempt {attempt} failed: {e}")
            if attempt == 5:
                raise SystemExit("ssh: cannot connect")
            time.sleep(4)

    def run(cmd, check=True, timeout=600):
        print(f"$ {cmd[:180]}")
        _i, o, e = ssh.exec_command(cmd, timeout=timeout)
        out = o.read().decode("utf-8", "replace")
        err = e.read().decode("utf-8", "replace")
        code = o.channel.recv_exit_status()
        if out.strip():
            print(out.rstrip()[:4000])
        if err.strip():
            print(err.rstrip()[:1500], file=sys.stderr)
        if check and code != 0:
            raise SystemExit(f"remote exit {code}: {cmd[:120]}")
        return out

    sftp = ssh.open_sftp()

    print("=== 1. SNAPSHOT ===")
    snap = f"/root/snapshots/asgard-vacation-fix-{STAMP}.tgz"
    run("mkdir -p /root/snapshots")
    # templates могли отсутствовать — snapshot не валим
    existing = " ".join(TAR_PATHS)
    fallback = (
        "src/routes/vacations.js public/assets/js/vacation_schedule.js "
        "public/assets/css/vacation.css public/index.html public/sw.js "
        "public/h/index.html public/h/sw.js"
    )
    run(
        f"tar -czf {snap} -C {REMOTE} {existing} 2>/dev/null "
        f"|| tar -czf {snap} -C {REMOTE} {fallback} 2>/dev/null "
        f"|| true",
        check=False,
    )
    run(f"ls -lh {snap}", check=False)
    print(f"snapshot: {snap}")

    print("=== 2. tar + scp ===")
    tar_path = Path(tempfile.gettempdir()) / f"asgard-vacation-fix-{STAMP}.tar.gz"
    with tarfile.open(tar_path, "w:gz") as tar:
        for rel in TAR_PATHS:
            tar.add(str(ROOT / rel), arcname=rel)
    remote_tar = f"/tmp/asgard-vacation-fix-{STAMP}.tar.gz"
    sftp.put(str(tar_path), remote_tar)
    run(f"ls -lh {remote_tar}")
    run(f"mkdir -p {REMOTE}/templates && tar -xzf {remote_tar} -C {REMOTE} && rm -f {remote_tar}")

    print("=== 3. MD5 verify ===")
    for rel in TAR_PATHS:
        local_md5 = md5((ROOT / rel).read_bytes())
        with sftp.file(f"{REMOTE}/{rel}", "rb") as rf:
            remote_md5 = md5(rf.read())
        ok = local_md5 == remote_md5
        print(f"  {'OK  ' if ok else 'FAIL'} {rel}  {local_md5[:10]}")
        if not ok:
            raise SystemExit(f"md5 mismatch: {rel}")

    print("=== 4. RESTART + HEALTH ===")
    run("systemctl restart asgard-crm")
    healthy = False
    for i in range(1, 9):
        time.sleep(2)
        out = run(
            "systemctl is-active asgard-crm; "
            "curl -sS -o /dev/null -w 'http=%{http_code}\\n' http://127.0.0.1:3000/api/health || true",
            check=False,
        )
        if "active" in out and "http=200" in out:
            healthy = True
            print(f"health OK on try {i}")
            break
        print(f"health wait {i}: {out.strip()!r}")
    if not healthy:
        raise SystemExit("health failed after restart")

    print("=== 5. PROD MARKERS ===")
    run(f"grep -n \"t7xlsx\" {REMOTE}/src/routes/vacations.js | head -5")
    run(f"grep -n \"dow(S.year, m, c.d)\" {REMOTE}/public/assets/js/vacation_schedule.js | head -3")
    run(f"ls -lh {REMOTE}/templates/vacation-*.docx")
    run(
        f"grep -n \"SHELL_VERSION = '{VER}'\\|ASGARD_SHELL_VERSION = '{VER}'\" "
        f"{REMOTE}/public/sw.js {REMOTE}/public/index.html | head -5"
    )

    # Документы: без JWT ожидаем 401 (маршрут жив), не 404/500 от отсутствия шаблона.
    print("=== 6. DOCS ROUTE SMOKE (no auth → 401) ===")
    for kind in ("t7", "t7xlsx", "zayav", "prikaz"):
        out = run(
            f"curl -sS -o /dev/null -w '%{{http_code}}' "
            f"'http://127.0.0.1:3000/api/vacations/docs/{kind}?year=2027'",
            check=False,
        ).strip()
        code = out.splitlines()[-1] if out else "?"
        # 401 = authenticate сработал; 404/500 = всё ещё сломано
        ok = code in ("401", "403")
        print(f"  {'OK  ' if ok else 'FAIL'} /docs/{kind} → {code}")
        if not ok:
            raise SystemExit(f"docs/{kind} unexpected status {code}")

    print(f"\nDONE deploy vacation-fix {VER}  snap={snap}")
    sftp.close()
    ssh.close()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
