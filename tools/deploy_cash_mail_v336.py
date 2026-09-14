#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Deploy cash-mail + on-behalf + V335/V336. Surgical patches for shared files."""
import hashlib
import io
import subprocess
import sys
import tarfile
import tempfile
import time
from datetime import datetime
from pathlib import Path

import paramiko

sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8", errors="replace")

KEY = Path.home() / ".ssh" / "asgard_crm_deploy"
HOST = "92.242.61.184"
ROOT = Path(__file__).resolve().parents[1]
PROJECT = "/var/www/asgard-crm"
TAG = datetime.now().strftime("%Y%m%d-%H%M%S")
SNAP = f"/root/snapshots/asgard-crm-pre-deploy-cash-mail-{TAG}"
NEW_VER = "20.27.109"

UPLOAD = [
    "src/routes/cash.js",
    "src/routes/cash-mail.js",
    "src/services/cash-mail.js",
    "migrations/V335__cash_director_approve_perms.sql",
    "migrations/V335__cash_director_approve_perms_down.sql",
    "migrations/V336__cash_mail_onbehalf_all_roles.sql",
    "migrations/V336__cash_mail_onbehalf_all_roles_down.sql",
    "public/assets/js/cash.js",
    "public/assets/js/cash_admin.js",
]


def md5_file(path: Path) -> str:
    h = hashlib.md5()
    with path.open("rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def sftp_read(sftp, path):
    with sftp.file(path, "rb") as rf:
        return rf.read().decode("utf-8")


def sftp_write(sftp, path, text):
    with sftp.file(path, "wb") as wf:
        wf.write(text.encode("utf-8"))


def once_replace(text, old, new, label):
    n = text.count(old)
    if n != 1:
        raise SystemExit(f"PATCH FAIL {label}: count={n}\n---\n{old[:240]}")
    return text.replace(old, new)


def main():
    skip_build = "--resume" in sys.argv
    for rel in UPLOAD:
        p = ROOT / rel
        if not p.is_file():
            raise SystemExit(f"missing {rel}")
    cash = (ROOT / "src/routes/cash.js").read_text(encoding="utf-8")
    if "for_user_id" not in cash or "initiated_by" not in cash:
        raise SystemExit("cash.js missing on-behalf fields")
    mail = (ROOT / "src/services/cash-mail.js").read_text(encoding="utf-8")
    if "isLiveCashMail" not in mail or "go@asgard-service.com" not in mail:
        raise SystemExit("cash-mail.js missing live gate / director email")
    admin_js = (ROOT / "public/assets/js/cash_admin.js").read_text(encoding="utf-8")
    if "showOnBehalfModal" not in admin_js:
        raise SystemExit("cash_admin.js missing on-behalf UI")

    if not skip_build:
        print("=== BUILD v2 ===")
        r = subprocess.run(
            ["npm", "run", "build"],
            cwd=str(ROOT / "public" / "desktop-v2-src"),
            capture_output=True,
            text=True,
            shell=True,
        )
        print((r.stdout or "")[-2500:])
        if r.returncode != 0:
            print((r.stderr or "")[-4000:])
            raise SystemExit("v2 build failed")
        print("=== BUILD mobile ===")
        r = subprocess.run(
            ["npm", "run", "build"],
            cwd=str(ROOT / "public" / "mobile-app"),
            capture_output=True,
            text=True,
            shell=True,
        )
        print((r.stdout or "")[-2500:])
        if r.returncode != 0:
            print((r.stderr or "")[-4000:])
            raise SystemExit("mobile build failed")
        subprocess.run(
            [
                "robocopy",
                str(ROOT / "public" / "mobile-app" / "dist"),
                str(ROOT / "public" / "m"),
                "/E", "/NFL", "/NDL", "/NJH", "/NJS", "/nc", "/ns", "/np",
            ],
            shell=True,
            check=False,
        )
    v2_index = ROOT / "public" / "v2" / "index.html"
    if not v2_index.is_file() or "assets/" not in v2_index.read_text(encoding="utf-8"):
        raise SystemExit("v2/index.html missing assets")
    m_index = (ROOT / "public" / "m" / "index.html").read_text(encoding="utf-8")
    if "index-" not in m_index:
        raise SystemExit("m/index.html missing chunk")
    print("frontend artifacts ok")

    key = paramiko.Ed25519Key.from_private_key_file(str(KEY))
    c = paramiko.SSHClient()
    c.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    c.connect(HOST, username="root", pkey=key, timeout=30)
    sftp = c.open_sftp()

    def run(cmd, timeout=180, check=True):
        print("====", cmd[:220].replace("\n", " "))
        _, o, e = c.exec_command(cmd, timeout=timeout)
        out = o.read().decode("utf-8", "replace")
        err = e.read().decode("utf-8", "replace")
        code = o.channel.recv_exit_status()
        if out.strip():
            print(out[-12000:] if len(out) > 12000 else out)
        if err.strip():
            print("STDERR:", err[:2500])
        if check and code != 0:
            raise SystemExit(f"FAILED ({code}): {cmd[:180]}")
        return out

    print("=== SNAPSHOT ===")
    run("mkdir -p /root/snapshots")
    run(
        "tar -C {p} -czf {s}.tgz "
        "src/routes/cash.js src/index.js "
        "public/assets/js/cash.js public/assets/js/cash_admin.js public/assets/js/app.js "
        "public/sw.js public/index.html".format(p=PROJECT, s=SNAP)
    )
    run(f"cp -a {PROJECT}/public/v2 {PROJECT}/public/v2.bak-cash-{TAG} || true", check=False)
    run(f"cp -a {PROJECT}/public/m {PROJECT}/public/m.bak-cash-{TAG} || true", check=False)
    run(f"ls -lh {SNAP}.tgz")

    print("=== UPLOAD BACKEND/VANILLA ===")
    for rel in UPLOAD:
        local = ROOT / rel
        remote = f"{PROJECT}/{rel}"
        parent = str(Path(remote).as_posix().rsplit("/", 1)[0])
        run(f"mkdir -p {parent}")
        digest = md5_file(local)
        sftp.put(str(local), remote)
        with sftp.file(remote, "rb") as rf:
            rmd5 = hashlib.md5(rf.read()).hexdigest()
        print(f"  {'OK' if rmd5 == digest else 'FAIL'} {rel}")
        if rmd5 != digest:
            raise SystemExit("md5 fail " + rel)

    print("=== PATCH index.js ===")
    idx_path = f"{PROJECT}/src/index.js"
    idx = sftp_read(sftp, idx_path).replace("\r\n", "\n")
    if "routes/cash-mail" not in idx:
        idx = once_replace(
            idx,
            "fastify.register(require('./routes/cash'), { prefix: '/api/cash' });",
            "fastify.register(require('./routes/cash'), { prefix: '/api/cash' });\n"
            "fastify.register(require('./routes/cash-mail'), { prefix: '/cash-mail' });",
            "index.js cash-mail register",
        )
        sftp_write(sftp, idx_path, idx)
        print("  patched cash-mail register")
    else:
        print("  cash-mail already registered")

    print("=== PATCH app.js ===")
    app_path = f"{PROJECT}/public/assets/js/app.js"
    app = sftp_read(sftp, app_path).replace("\r\n", "\n")
    app = once_replace(
        app,
        '{r:"/cash",l:"Касса",d:"Авансовые отчёты",roles:["ADMIN","PM","HEAD_TO",...DIRECTOR_ROLES],i:"finances",p:"cash",g:"finance"},',
        '{r:"/cash",l:"Касса",d:"Авансовые отчёты",roles:[...ALL_ROLES,"FIELD_WORKER"],i:"finances",p:"cash",g:"finance"},',
        "app.js nav cash",
    )
    app = once_replace(
        app,
        'AsgardCashPage.render(document.getElementById(\'cash-page\'));\n'
        '    }, {auth:true, roles:["ADMIN","PM","HEAD_TO",...DIRECTOR_ROLES]});',
        'AsgardCashPage.render(document.getElementById(\'cash-page\'));\n'
        '    }, {auth:true, roles:[...ALL_ROLES, "FIELD_WORKER"]});',
        "app.js router cash",
    )
    app = once_replace(
        app,
        'if ((user.role === "PM" || user.role === "HEAD_TO") && window.AsgardAuth && AsgardAuth.hasPermission && AsgardAuth.hasPermission(\'cash\', \'read\')) {',
        'if (window.AsgardAuth && AsgardAuth.hasPermission && AsgardAuth.hasPermission(\'cash\', \'read\')) {',
        "app.js widget gate",
    )
    app = once_replace(
        app,
        'if ((user.role === "PM" || user.role === "HEAD_TO") && document.getElementById(\'cashBalanceData\')) {',
        'if (document.getElementById(\'cashBalanceData\')) {',
        "app.js widget load",
    )
    sftp_write(sftp, app_path, app)
    print("  app.js patched")

    print("=== BUMP SHELL ON PROD ===")
    for rel in ("public/sw.js", "public/index.html"):
        remote = f"{PROJECT}/{rel}"
        txt = sftp_read(sftp, remote)
        if NEW_VER in txt and "20.27.108" not in txt:
            print("  already", rel, NEW_VER)
            continue
        if "20.27.108" not in txt:
            raise SystemExit(f"{rel} has no 20.27.108 (got other version)")
        txt = txt.replace("20.27.108", NEW_VER)
        sftp_write(sftp, remote, txt)
        print("  bumped", rel)

    print("=== TAR v2 + m ===")
    tmp_v2 = Path(tempfile.gettempdir()) / f"asgard_v2_cash_{TAG}.tar"
    with tarfile.open(tmp_v2, "w") as tar:
        tar.add(ROOT / "public" / "v2", arcname="v2")
    print("v2 tar", tmp_v2.stat().st_size)
    sftp.put(str(tmp_v2), f"/tmp/asgard_v2_cash_{TAG}.tar")
    run(
        f"cd {PROJECT}/public && test -d v2 && "
        f"tar xf /tmp/asgard_v2_cash_{TAG}.tar && test -f v2/index.html && "
        f"grep -oE 'assets/[^\" ]+' v2/index.html | head -5"
    )

    tmp_m = Path(tempfile.gettempdir()) / f"asgard_m_cash_{TAG}.tar"
    with tarfile.open(tmp_m, "w") as tar:
        tar.add(ROOT / "public" / "m", arcname="m")
    print("m tar", tmp_m.stat().st_size)
    sftp.put(str(tmp_m), f"/tmp/asgard_m_cash_{TAG}.tar")
    run(
        f"cd {PROJECT}/public && "
        f"tar xf /tmp/asgard_m_cash_{TAG}.tar && test -f m/index.html && "
        f"grep -oE 'assets/index-[^\" ]+' m/index.html | head -3"
    )

    print("=== MIGRATE V335 then V336 ===")
    run(
        f"PGPASSWORD=123456789 psql -U asgard -d asgard_crm -v ON_ERROR_STOP=1 "
        f"-f {PROJECT}/migrations/V335__cash_director_approve_perms.sql"
    )
    run(
        f"PGPASSWORD=123456789 psql -U asgard -d asgard_crm -v ON_ERROR_STOP=1 "
        f"-f {PROJECT}/migrations/V336__cash_mail_onbehalf_all_roles.sql"
    )
    run(
        "PGPASSWORD=123456789 psql -U asgard -d asgard_crm -c "
        "\"SELECT column_name FROM information_schema.columns "
        "WHERE table_name='cash_requests' AND column_name='initiated_by';\""
    )
    run(
        "PGPASSWORD=123456789 psql -U asgard -d asgard_crm -c "
        "\"SELECT to_regclass('public.cash_email_tokens') AS tokens;\""
    )
    run(
        "PGPASSWORD=123456789 psql -U asgard -d asgard_crm -c "
        "\"SELECT role, can_read, can_write FROM role_presets "
        "WHERE module_key IN ('cash','cash_admin') ORDER BY module_key, role;\""
    )

    print("=== RESTART ===")
    run("systemctl restart asgard-crm")
    ok = False
    health = ""
    for i in range(1, 10):
        time.sleep(2)
        health = run(
            "systemctl is-active asgard-crm; "
            "curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:3000/api/health || echo fail",
            check=False,
        )
        if "active" in health and "200" in health:
            ok = True
            print(f"HEALTH OK on try {i}")
            break
    if not ok:
        run("journalctl -u asgard-crm -n 80 --no-pager", check=False)
        raise SystemExit("health failed after restart")

    print("=== SMOKE ===")
    run("curl -s -o /dev/null -w 'version:%{http_code} ' http://127.0.0.1:3000/api/version; echo")
    run("curl -s http://127.0.0.1:3000/api/version")
    run(
        "curl -s -o /tmp/cashmail.html -w 'cashmail:%{http_code}\\n' "
        "http://127.0.0.1:3000/cash-mail/not-a-valid-token; "
        "head -c 200 /tmp/cashmail.html; echo"
    )
    run(f"grep -n \"cash-mail\" {PROJECT}/src/index.js")
    run(f"grep -n 'ALL_ROLES,\"FIELD_WORKER\"' {PROJECT}/public/assets/js/app.js | head")
    run(f"grep -c showOnBehalfModal {PROJECT}/public/assets/js/cash_admin.js")
    run("journalctl -u asgard-crm -n 40 --no-pager | tail -40")
    run("grep NODE_ENV= /etc/systemd/system/asgard-crm.service /etc/asgard* 2>/dev/null | head; "
        "systemctl show asgard-crm -p Environment --no-pager | head -5", check=False)

    sftp.close()
    c.close()
    print("DEPLOYED cash-mail", TAG, "shell", NEW_VER, "snap", SNAP + ".tgz")


if __name__ == "__main__":
    main()
