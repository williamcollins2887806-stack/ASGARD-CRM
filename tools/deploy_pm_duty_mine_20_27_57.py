#!/usr/bin/env python3
"""Deploy PM Duty «Мои» tab. Shell 20.27.57. Snapshot + scp, no git reset."""
import hashlib
import io
import json
import subprocess
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
VER = "20.27.57"
TAG = datetime.now().strftime("%Y%m%d-%H%M%S")
SNAP = f"/root/snapshots/asgard-crm-pre-deploy-pm-duty-mine-{TAG}"

FILES = [
    "src/routes/pm-duty.js",
    "public/assets/js/pm_duty.js",
    "public/mobile-app/src/pages/pm/PmDuty.jsx",
    "public/desktop-v2-src/src/pages/PmDuty/index.jsx",
    "public/sw.js",
    "public/index.html",
]

MARKERS = [
    ("src/routes/pm-duty.js", "isReviewParticipant"),
    ("src/routes/pm-duty.js", "tab === 'mine'"),
    ("src/routes/pm-duty.js", "canSharedAnalysisEdit"),
    ("src/routes/pm-duty.js", "assertFinalFileUploadAccess"),
    ("public/assets/js/pm_duty.js", "id: 'mine'"),
    ("public/assets/js/pm_duty.js", "можно править вместе с дежурным"),
    ("public/desktop-v2-src/src/pages/PmDuty/index.jsx", "id: 'mine'"),
    ("public/mobile-app/src/pages/pm/PmDuty.jsx", "id: 'mine'"),
    ("public/sw.js", VER),
    ("public/index.html", VER),
    ("public/index.html", f"pm_duty.js?v={VER}"),
]


def md5_file(path: Path) -> str:
    h = hashlib.md5()
    with path.open("rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def run(c, cmd, timeout=300):
    print("====", cmd[:240].replace("\n", " "))
    _, o, e = c.exec_command(cmd, timeout=timeout)
    out = o.read().decode("utf-8", errors="replace")
    err = e.read().decode("utf-8", errors="replace")
    code = o.channel.recv_exit_status()
    if out:
        print(out[-15000:] if len(out) > 15000 else out)
    if err.strip():
        print("STDERR:", err[:3000])
    if code != 0:
        raise SystemExit(f"FAILED ({code}): {cmd[:160]}")
    return out


def local_run(cmd, cwd=None, timeout=600):
    print("==== LOCAL:", cmd if isinstance(cmd, str) else " ".join(cmd), "cwd=", cwd or ".")
    p = subprocess.run(
        cmd,
        cwd=cwd,
        capture_output=True,
        text=True,
        encoding="utf-8",
        errors="replace",
        timeout=timeout,
        shell=isinstance(cmd, str) or True,
    )
    if p.stdout:
        print(p.stdout[-8000:] if len(p.stdout) > 8000 else p.stdout)
    if p.stderr.strip():
        print("STDERR:", p.stderr[-4000:])
    if p.returncode != 0:
        raise SystemExit(f"LOCAL FAIL ({p.returncode}): {cmd}")


def put_file(sftp, local: Path, remote: str):
    digest = md5_file(local)
    sftp.put(str(local), remote)
    with sftp.file(remote, "rb") as rf:
        remote_md5 = hashlib.md5(rf.read()).hexdigest()
    ok = remote_md5 == digest
    print(f"  {'OK' if ok else 'FAIL'} {local.as_posix().split('ASGARD-CRM/')[-1]} {digest}")
    if not ok:
        raise SystemExit(f"md5 fail: {remote}")


def main():
    for rel, needle in MARKERS:
        text = (ROOT / rel).read_text(encoding="utf-8")
        if needle not in text:
            raise SystemExit(f"marker missing in {rel}: {needle}")

    for rel in FILES:
        if not (ROOT / rel).exists():
            raise SystemExit(f"missing {rel}")

    skip_build = "--skip-build" in sys.argv

    if not skip_build:
        print("=== BUILD desktop-v2 ===")
        local_run("npm run build", cwd=str(ROOT / "public" / "desktop-v2-src"), timeout=300)

        print("=== BUILD mobile ===")
        local_run("npm run build", cwd=str(ROOT / "public" / "mobile-app"), timeout=300)
        dist = ROOT / "public" / "mobile-app" / "dist"
        mdir = ROOT / "public" / "m"
        if not dist.exists():
            raise SystemExit("mobile dist missing after build")
        local_run(
            f"Copy-Item -Recurse -Force '{dist}\\*' '{mdir}\\'",
            timeout=120,
        )
    else:
        print("=== SKIP BUILD (--skip-build) ===")
        if not (ROOT / "public" / "v2").exists():
            raise SystemExit("public/v2 missing")
        if not (ROOT / "public" / "m" / "index.html").exists():
            raise SystemExit("public/m/index.html missing")

    key = paramiko.Ed25519Key.from_private_key_file(str(KEY))
    c = paramiko.SSHClient()
    c.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    c.connect(HOST, username="root", pkey=key, timeout=30)
    sftp = c.open_sftp()

    print("=== SNAPSHOT ===")
    run(
        c,
        f"mkdir -p /root/snapshots && tar -C {PROJECT} -czf {SNAP}.tgz "
        f"src/routes/pm-duty.js public/assets/js/pm_duty.js public/sw.js public/index.html "
        f"public/v2 public/m 2>/dev/null; ls -lh {SNAP}.tgz",
        timeout=180,
    )

    print("=== UPLOAD core files ===")
    for rel in (
        "src/routes/pm-duty.js",
        "public/assets/js/pm_duty.js",
        "public/sw.js",
        "public/index.html",
    ):
        put_file(sftp, ROOT / rel, f"{PROJECT}/{rel}")

    print("=== UPLOAD v2 tar ===")
    with tempfile.NamedTemporaryFile(suffix=".tgz", delete=False) as tmp:
        tar_path = Path(tmp.name)
    with tarfile.open(tar_path, "w:gz") as tar:
        tar.add(ROOT / "public" / "v2", arcname="v2")
    remote_tar = f"/tmp/asgard-v2-mine-{TAG}.tgz"
    put_file(sftp, tar_path, remote_tar)
    run(c, f"tar -C {PROJECT}/public -xzf {remote_tar} && rm -f {remote_tar} && ls {PROJECT}/public/v2 | head")
    tar_path.unlink(missing_ok=True)

    print("=== UPLOAD mobile assets ===")
    m_index = ROOT / "public" / "m" / "index.html"
    put_file(sftp, m_index, f"{PROJECT}/public/m/index.html")
    # Upload hashed JS/CSS referenced by index.html
    html = m_index.read_text(encoding="utf-8")
    import re
    refs = re.findall(r"/m/assets/([^\"']+)", html)
    for name in refs:
        local = ROOT / "public" / "m" / "assets" / name
        if not local.exists():
            raise SystemExit(f"mobile asset missing: {name}")
        put_file(sftp, local, f"{PROJECT}/public/m/assets/{name}")
    print(f"  mobile refs: {refs}")

    sftp.close()

    print("=== RESTART ===")
    run(c, "systemctl restart asgard-crm && sleep 4 && systemctl is-active asgard-crm")

    print("=== BANNER ===")
    changes = [
        "Просчёты РП: вкладка «Мои» — тендеры, которые вы начинали/считали",
        "Пока анализ не закрыт — можно править вместе с текущим дежурным",
        "Смотреть и скачивать ТКП/смету/отчёт всегда",
        f"Shell {VER}",
    ]
    body = "\\n".join(changes).replace("'", "''")
    sql = (
        f"INSERT INTO app_updates (version, changes, created_at) "
        f"VALUES ('v{VER}', '{body}', NOW());\n"
    )
    remote_sql = f"/tmp/_banner_v{VER.replace('.', '_')}.sql"
    sftp2 = c.open_sftp()
    with sftp2.file(remote_sql, "w") as f:
        f.write(sql)
    sftp2.close()
    run(c, f"PGPASSWORD=123456789 psql -U asgard -d asgard_crm -v ON_ERROR_STOP=1 -f {remote_sql}", timeout=60)

    print("=== SMOKE ===")
    run(
        c,
        "curl -s -o /dev/null -w 'home:%{http_code}\\n' https://asgard-crm.ru/; "
        "curl -s -o /dev/null -w 'api:%{http_code}\\n' http://127.0.0.1:3000/api/version; "
        f"curl -s http://127.0.0.1:3000/api/version; echo; "
        f"grep -oP \"ASGARD_SHELL_VERSION = '\\K[^']+\" {PROJECT}/public/index.html | head -1; "
        f"grep -c isReviewParticipant {PROJECT}/src/routes/pm-duty.js; "
        f"grep -c \"id: 'mine'\" {PROJECT}/public/assets/js/pm_duty.js; "
        f"grep -n \"pm_duty.js\" {PROJECT}/public/index.html | head -2; "
        "journalctl -u asgard-crm -n 30 --no-pager | tail -30",
        timeout=90,
    )

    c.close()
    print("=== DEPLOY DONE", VER, "===")


if __name__ == "__main__":
    main()
