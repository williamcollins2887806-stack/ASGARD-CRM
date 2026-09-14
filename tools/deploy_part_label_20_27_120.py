# -*- coding: utf-8 -*-
"""Hotfix: participation column label UX (shell 20.27.120)."""
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
VER = "20.27.120"
TAG = datetime.now().strftime("%Y%m%d-%H%M%S")
SNAP = f"/root/snapshots/asgard-crm-pre-deploy-part-label-{TAG}"

FILES = [
    "public/assets/js/registry_tab.js",
    "public/assets/css/app.css",
    "public/index.html",
    "public/sw.js",
]

MARKERS = {
    "public/assets/js/registry_tab.js": ["бесплатно", "label: 'Сбор'", "reg-participation-free"],
    "public/assets/css/app.css": ["reg-col-participation", "white-space: nowrap"],
    "public/sw.js": [f"SHELL_VERSION = '{VER}'"],
    "public/index.html": [f"ASGARD_SHELL_VERSION = '{VER}'", f"registry_tab.js?v={VER}"],
}


def run(c, cmd, timeout=300):
    print("====", cmd[:220].replace("\n", " "))
    _, o, e = c.exec_command(cmd, timeout=timeout)
    out = o.read().decode("utf-8", errors="replace")
    err = e.read().decode("utf-8", errors="replace")
    code = o.channel.recv_exit_status()
    if out:
        print(out[-6000:] if len(out) > 6000 else out)
    if err.strip():
        print("STDERR:", err[:1500])
    if code != 0:
        raise SystemExit(f"FAILED ({code}): {cmd[:160]}")
    return out


def pack_v2() -> Path:
    v2 = ROOT / "public" / "v2"
    found = False
    for p in (v2 / "assets").glob("*.js"):
        txt = p.read_text(encoding="utf-8", errors="ignore")
        if "бесплатно" in txt and "participation" in txt:
            found = True
            print("v2 ok", p.name)
            break
    if not found:
        raise SystemExit("v2 missing бесплатно marker")
    tmp = Path(tempfile.gettempdir()) / f"asgard-v2-part-label-{TAG}.tar.gz"
    with tarfile.open(tmp, "w:gz") as tar:
        tar.add(v2, arcname="v2")
    return tmp


def main():
    for rel in FILES:
        text = (ROOT / rel).read_text(encoding="utf-8")
        for m in MARKERS[rel]:
            if m not in text:
                raise SystemExit(f"marker missing in {rel}: {m}")

    v2_tar = pack_v2()
    key = paramiko.Ed25519Key.from_private_key_file(str(KEY))
    c = paramiko.SSHClient()
    c.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    c.connect(HOST, username="root", pkey=key, timeout=30)
    sftp = c.open_sftp()

    run(
        c,
        f"mkdir -p /root/snapshots && tar -C {PROJECT} -czf {SNAP}.tgz --ignore-failed-read "
        f"public/assets/js/registry_tab.js public/assets/css/app.css public/index.html public/sw.js public/v2; ls -lh {SNAP}.tgz",
    )

    remote_tar = f"/tmp/asgard-part-label-{TAG}.tar.gz"
    with tempfile.NamedTemporaryFile(suffix=".tar.gz", delete=False) as tmp:
        tar_path = Path(tmp.name)
    with tarfile.open(tar_path, "w:gz") as tar:
        for rel in FILES:
            tar.add(ROOT / rel, arcname=rel)
    sftp.put(str(tar_path), remote_tar)
    tar_path.unlink(missing_ok=True)
    run(c, f"tar -xzf {remote_tar} -C {PROJECT}")

    remote_v2 = f"/tmp/asgard-v2-part-label-{TAG}.tar.gz"
    sftp.put(str(v2_tar), remote_v2)
    v2_tar.unlink(missing_ok=True)
    run(c, f"tar -xzf {remote_v2} -C {PROJECT}/public")

    run(c, f"grep -n \"бесплатно\\|label: 'Сбор'\\|reg-col-participation\" "
        f"{PROJECT}/public/assets/js/registry_tab.js {PROJECT}/public/assets/css/app.css | head -20")
    run(c, f"grep -n \"SHELL_VERSION = '{VER}'\" {PROJECT}/public/sw.js")

    run(c, "systemctl restart asgard-crm")
    run(
        c,
        """bash -lc 'for i in 1 2 3 4 5 6; do
  code=$(curl -s -o /dev/null -w "%{http_code}" http://127.0.0.1:3000/api/health || true)
  echo try=$i code=$code
  [ "$code" = "200" ] && break
  sleep 2
done
curl -s http://127.0.0.1:3000/api/version; echo'""",
    )

    run(
        c,
        """PGPASSWORD=123456789 psql -U asgard -d asgard_crm -c \"
INSERT INTO app_updates (version, changes, created_at)
VALUES ('v20.27.120', 'Реестр: колонка Сбор — «бесплатно» / сумма вместо непонятного «нет», фикс узкой ячейки.', NOW());
\" 2>/dev/null || true""",
    )

    sftp.close()
    c.close()
    print("DEPLOY OK", VER)


if __name__ == "__main__":
    main()
