#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Deploy cash UI holes: mobile expense/return, office-expenses hint, shell bump."""
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
SNAP = f"/root/snapshots/asgard-crm-pre-deploy-cash-ui-{TAG}"
OLD_VER = "20.27.109"
NEW_VER = "20.27.110"

UPLOAD = [
    "public/assets/js/cash.js",
    "public/assets/js/office_expenses.js",
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

    cash = (ROOT / "public/assets/js/cash.js").read_text(encoding="utf-8")
    if "Сначала подтвердите получение" not in cash:
        raise SystemExit("cash.js missing receive hint")
    if "Возврат ожидает подтверждения кассы" not in cash:
        raise SystemExit("cash.js missing return hint")
    if "if (_isPmLike()) chips.push({ v: 'handover'" not in cash:
        raise SystemExit("cash.js handover chip still inverted")

    oexp = (ROOT / "public/assets/js/office_expenses.js").read_text(encoding="utf-8")
    if "не личная касса" not in oexp:
        raise SystemExit("office_expenses.js missing cash hint")

    detail = (ROOT / "public/desktop-v2-src/src/pages/Cash/DetailModal.jsx").read_text(encoding="utf-8")
    if "Сначала подтвердите получение" not in detail:
        raise SystemExit("v2 DetailModal missing hint")

    m_src = (ROOT / "public/mobile-app/src/pages/cash/CashDetailSheet.jsx").read_text(encoding="utf-8")
    if "Приложить чек" not in m_src:
        raise SystemExit("mobile CashDetailSheet missing expense UI")

    if not skip_build:
        print("=== BUILD v2 ===")
        r = subprocess.run(
            ["npm", "run", "build"],
            cwd=str(ROOT / "public" / "desktop-v2-src"),
            capture_output=True,
            text=True,
            shell=True,
        )
        print((r.stdout or "")[-2000:])
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
        print((r.stdout or "")[-2000:])
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

    v2_index = (ROOT / "public" / "v2" / "index.html").read_text(encoding="utf-8")
    if "assets/" not in v2_index:
        raise SystemExit("v2/index.html missing assets")
    m_index = (ROOT / "public" / "m" / "index.html").read_text(encoding="utf-8")
    if "index-" not in m_index:
        raise SystemExit("m/index.html missing chunk")

    m_js_name = None
    for part in m_index.split('"'):
        if "/m/assets/index-" in part and part.endswith(".js"):
            m_js_name = Path(part).name
            break
    if not m_js_name:
        raise SystemExit("cannot parse mobile index chunk")
    m_js = (ROOT / "public" / "m" / "assets" / m_js_name).read_text(encoding="utf-8", errors="replace")
    if "Приложить чек" not in m_js:
        raise SystemExit(f"{m_js_name} missing Приложить чек")
    print("frontend artifacts ok", "mobile", m_js_name)

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
        "public/assets/js/cash.js public/assets/js/office_expenses.js "
        "public/sw.js public/index.html public/m/index.html public/v2/index.html".format(
            p=PROJECT, s=SNAP
        )
    )
    run(f"cp -a {PROJECT}/public/v2 {PROJECT}/public/v2.bak-cash-ui-{TAG} || true", check=False)
    run(f"cp -a {PROJECT}/public/m {PROJECT}/public/m.bak-cash-ui-{TAG} || true", check=False)
    run(f"ls -lh {SNAP}.tgz")

    print("=== UPLOAD VANILLA JS ===")
    for rel in UPLOAD:
        local = ROOT / rel
        remote = f"{PROJECT}/{rel}"
        digest = md5_file(local)
        sftp.put(str(local), remote)
        with sftp.file(remote, "rb") as rf:
            rmd5 = hashlib.md5(rf.read()).hexdigest()
        print(f"  {'OK' if rmd5 == digest else 'FAIL'} {rel}")
        if rmd5 != digest:
            raise SystemExit("md5 fail " + rel)

    print("=== BUMP SHELL ON PROD (surgical) ===")
    sw = sftp_read(sftp, f"{PROJECT}/public/sw.js")
    if f"SHELL_VERSION = '{NEW_VER}'" in sw or f'SHELL_VERSION = "{NEW_VER}"' in sw:
        print("  sw.js already", NEW_VER)
    else:
        if OLD_VER not in sw:
            raise SystemExit(f"sw.js has no {OLD_VER}")
        n = sw.count(OLD_VER)
        if n < 1:
            raise SystemExit("sw.js version count 0")
        sw = sw.replace(OLD_VER, NEW_VER)
        sftp_write(sftp, f"{PROJECT}/public/sw.js", sw)
        print(f"  sw.js {OLD_VER} -> {NEW_VER} ({n} replaces)")

    idx = sftp_read(sftp, f"{PROJECT}/public/index.html")
    if f"ASGARD_SHELL_VERSION = '{NEW_VER}'" in idx or f'ASGARD_SHELL_VERSION = "{NEW_VER}"' in idx:
        print("  index.html shell already", NEW_VER)
    else:
        idx = once_replace(
            idx,
            f"window.ASGARD_SHELL_VERSION = '{OLD_VER}';",
            f"window.ASGARD_SHELL_VERSION = '{NEW_VER}';",
            "index.html ASGARD_SHELL_VERSION",
        )
        sftp_write(sftp, f"{PROJECT}/public/index.html", idx)
        print("  index.html shell bumped")
        idx = sftp_read(sftp, f"{PROJECT}/public/index.html")

    import re
    idx2, n_cash = re.subn(
        r'(assets/js/cash\.js\?v=)[^"\']+',
        rf'\g<1>{NEW_VER}',
        idx,
        count=1,
    )
    idx2, n_oe = re.subn(
        r'(assets/js/office_expenses\.js\?v=)[^"\']+',
        rf'\g<1>{NEW_VER}',
        idx2,
        count=1,
    )
    if n_cash != 1 or n_oe != 1:
        raise SystemExit(f"index.html script v= patch fail cash={n_cash} oe={n_oe}")
    sftp_write(sftp, f"{PROJECT}/public/index.html", idx2)
    print("  index.html cash.js + office_expenses.js cache-bust", NEW_VER)

    print("=== TAR v2 + m ===")
    tmp_v2 = Path(tempfile.gettempdir()) / f"asgard_v2_cash_ui_{TAG}.tar"
    with tarfile.open(tmp_v2, "w") as tar:
        tar.add(ROOT / "public" / "v2", arcname="v2")
    print("v2 tar", tmp_v2.stat().st_size)
    sftp.put(str(tmp_v2), f"/tmp/asgard_v2_cash_ui_{TAG}.tar")
    run(
        f"cd {PROJECT}/public && test -d v2 && "
        f"tar xf /tmp/asgard_v2_cash_ui_{TAG}.tar && test -f v2/index.html && "
        f"grep -oE 'assets/[^\" ]+' v2/index.html | head -5"
    )

    tmp_m = Path(tempfile.gettempdir()) / f"asgard_m_cash_ui_{TAG}.tar"
    with tarfile.open(tmp_m, "w") as tar:
        tar.add(ROOT / "public" / "m", arcname="m")
    print("m tar", tmp_m.stat().st_size)
    sftp.put(str(tmp_m), f"/tmp/asgard_m_cash_ui_{TAG}.tar")
    run(
        f"cd {PROJECT}/public && "
        f"tar xf /tmp/asgard_m_cash_ui_{TAG}.tar && test -f m/index.html && "
        f"grep -oE 'assets/index-[^\" ]+' m/index.html | head -3"
    )

    print("=== RESTART (version cache + static) ===")
    run("systemctl restart asgard-crm")
    ok = False
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
    run("curl -s http://127.0.0.1:3000/api/version")
    run(f"grep -c 'Сначала подтвердите получение' {PROJECT}/public/assets/js/cash.js")
    run(f"grep -c 'не личная касса' {PROJECT}/public/assets/js/office_expenses.js")
    run(f"grep -n \"ASGARD_SHELL_VERSION\" {PROJECT}/public/index.html | head")
    run(f"grep SHELL_VERSION {PROJECT}/public/sw.js | head -3")
    run(
        f"grep -o 'assets/js/cash.js?v=[^\"]*' {PROJECT}/public/index.html; "
        f"grep -o 'assets/js/office_expenses.js?v=[^\"]*' {PROJECT}/public/index.html"
    )
    run(f"grep -oE 'assets/index-[^\"]+' {PROJECT}/public/m/index.html | head -3")
    run(
        f"chunk=$(grep -oE 'index-[A-Za-z0-9_-]+\\.js' {PROJECT}/public/m/index.html | head -1); "
        f"echo CHUNK=$chunk; grep -c 'Приложить чек' {PROJECT}/public/m/assets/$chunk; "
        f"grep -c 'Списать с кассы' {PROJECT}/public/m/assets/$chunk"
    )
    run(
        f"grep -l 'не личная касса' {PROJECT}/public/v2/assets/*.js | head -3; "
        f"grep -l 'Сначала подтвердите получение' {PROJECT}/public/v2/assets/*.js | head -3"
    )
    run("curl -sI https://asgard-crm.ru/api/version | head -15", check=False)
    run("curl -s https://asgard-crm.ru/api/version", check=False)
    run("journalctl -u asgard-crm -n 25 --no-pager | tail -25")

    sftp.close()
    c.close()
    print("DEPLOYED cash-ui-holes", TAG, "shell", NEW_VER, "snap", SNAP + ".tgz")


if __name__ == "__main__":
    main()
