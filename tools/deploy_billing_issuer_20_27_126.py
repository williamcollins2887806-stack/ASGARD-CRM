# -*- coding: utf-8 -*-
"""Deploy billing issuer_json constructor (20.27.126 / V343). No git reset --hard."""
import io
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
VER = "20.27.126"  # исторический номер этой выкатки; НЕ используется для правок
# прод-файлов (14.09, D-145): версия оболочки берётся из локальных index.html/sw.js
TAG = datetime.now().strftime("%Y%m%d-%H%M%S")
SNAP = f"/root/snapshots/asgard-crm-pre-deploy-billing-issuer-{TAG}"

FILES = [
    "migrations/V343__billing_issuer_json.sql",
    "src/services/billing-docs.js",
    "src/routes/invoices.js",
    "src/routes/acts.js",
    "public/assets/js/billing.js",
    "public/assets/css/billing.css",
    "public/assets/js/invoices.js",
    "public/assets/js/acts.js",
    # D-145: оболочка везётся из рабочего дерева, а не патчится на проде.
    # Без этих двух файлов в FILES теги billing/nd-permits жили только на проде
    # и стирались любым следующим деплоем.
    "public/index.html",
    "public/sw.js",
]

MARKERS = {
    "public/assets/js/billing.js": ["AsgardBillingPage", "Наши реквизиты", "Из настроек", "issuer_json"],
    "public/assets/css/billing.css": [".bill-kpi .k"],
    "public/assets/js/invoices.js": ["AsgardBillingPage"],
    "public/assets/js/acts.js": ["AsgardBillingPage"],
    "public/index.html": ["assets/js/billing.js", "assets/js/nd-permits.js", "ASGARD_SHELL_VERSION"],
    "public/sw.js": ["SHELL_VERSION"],
    "src/services/billing-docs.js": ["issuer_json", "hasCustomIssuer", "mergeIssuer"],
    "src/routes/invoices.js": ["hasCustomIssuer", "preview-pdf"],
    "src/routes/acts.js": ["billing-docs", "preview-pdf"],
    "migrations/V343__billing_issuer_json.sql": ["issuer_json JSONB"],
}


def run(c, cmd, timeout=300):
    print("====", cmd[:240].replace("\n", " "))
    _, o, e = c.exec_command(cmd, timeout=timeout)
    out = o.read().decode("utf-8", errors="replace")
    err = e.read().decode("utf-8", errors="replace")
    code = o.channel.recv_exit_status()
    if out:
        print(out[-9000:] if len(out) > 9000 else out)
    if err.strip():
        print("STDERR:", err[:2000])
    if code != 0:
        raise SystemExit(f"FAILED ({code}): {cmd[:180]}")
    return out


def pack_v2() -> Path:
    v2 = ROOT / "public" / "v2"
    if not (v2 / "assets").exists():
        raise SystemExit("public/v2/assets missing — npm run build first")
    chunk = None
    for p in (v2 / "assets").glob("*.js"):
        try:
            if "Наши реквизиты" in p.read_text(encoding="utf-8", errors="ignore"):
                chunk = p.name
                break
        except Exception:
            continue
    if not chunk:
        raise SystemExit("v2 bundle missing «Наши реквизиты» — rebuild first")
    tmp = Path(tempfile.gettempdir()) / f"asgard-v2-billing-{TAG}.tar.gz"
    with tarfile.open(tmp, "w:gz") as tar:
        tar.add(v2, arcname="v2")
    print(f"packed v2 {tmp.stat().st_size} chunk={chunk}")
    return tmp, chunk


def main():
    for rel in FILES:
        p = ROOT / rel
        if not p.exists():
            raise SystemExit(f"missing file {rel}")
        text = p.read_text(encoding="utf-8")
        for m in MARKERS.get(rel, []):
            if m not in text:
                raise SystemExit(f"marker missing in {rel}: {m}")

    v2_tar, v2_chunk = pack_v2()
    key = paramiko.Ed25519Key.from_private_key_file(str(KEY))
    c = paramiko.SSHClient()
    c.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    c.connect(HOST, username="root", pkey=key, timeout=30)
    sftp = c.open_sftp()

    snap_paths = " ".join(FILES + ["public/index.html", "public/sw.js", "public/v2"])
    run(
        c,
        f"mkdir -p /root/snapshots && tar -C {PROJECT} -czf {SNAP}.tgz --ignore-failed-read {snap_paths}; "
        f"ls -lh {SNAP}.tgz",
    )

    print("=== PROD BEFORE ===")
    run(
        c,
        f"grep -n \"ASGARD_SHELL_VERSION\\|billing.js?v=\\|billing.css?v=\" {PROJECT}/public/index.html | head -20; "
        f"grep -n \"SHELL_VERSION =\" {PROJECT}/public/sw.js | head -5; "
        f"test -f {PROJECT}/src/services/billing-docs.js && echo HAS_BILLING_DOCS || echo NO_BILLING_DOCS; "
        f"grep -n AsgardBillingPage {PROJECT}/public/assets/js/app.js | head -5; "
        f"PGPASSWORD=123456789 psql -U asgard -d asgard_crm -c \"SELECT column_name, table_name FROM information_schema.columns WHERE column_name='issuer_json' AND table_name IN ('invoices','acts') ORDER BY 2;\"",
    )

    remote_tar = f"/tmp/asgard-billing-issuer-{TAG}.tar.gz"
    with tempfile.NamedTemporaryFile(suffix=".tar.gz", delete=False) as tmp:
        tar_path = Path(tmp.name)
    with tarfile.open(tar_path, "w:gz") as tar:
        for rel in FILES:
            tar.add(ROOT / rel, arcname=rel)
    sftp.put(str(tar_path), remote_tar)
    tar_path.unlink(missing_ok=True)
    run(c, f"tar -xzf {remote_tar} -C {PROJECT}")

    remote_v2 = f"/tmp/asgard-v2-billing-{TAG}.tar.gz"
    sftp.put(str(v2_tar), remote_v2)
    v2_tar.unlink(missing_ok=True)
    run(c, f"tar -xzf {remote_v2} -C {PROJECT}/public")

    # 14.09 (D-145): здесь был «surgical patch» index.html/sw.js ПРЯМО НА ПРОДЕ.
    # Из-за него теги billing/nd-permits существовали только на сервере, и любой
    # следующий деплой, везущий локальный index.html, их стирал. Прод больше не
    # патчим: файлы оболочки лежат в FILES и везутся из рабочего дерева как есть,
    # а версия берётся та, что уже проставлена в файлах (бамп — отдельным шагом).
    print("=== PRE-FLIGHT verify_index_tags ===")
    chk = subprocess.run(
        ["node", str(ROOT / "tools" / "verify_index_tags.js")],
        cwd=str(ROOT), capture_output=True, text=True,
        encoding="utf-8", errors="replace", shell=(sys.platform == "win32"),
    )
    print((chk.stdout or "")[-1500:])
    if chk.returncode != 0:
        raise SystemExit("verify_index_tags FAIL — index.html без подключений, деплой остановлен")

    print("=== APPLY V343 ===")
    run(
        c,
        f"PGPASSWORD=123456789 psql -U asgard -d asgard_crm -v ON_ERROR_STOP=1 "
        f"-f {PROJECT}/migrations/V343__billing_issuer_json.sql",
    )
    run(
        c,
        """PGPASSWORD=123456789 psql -U asgard -d asgard_crm -c "SELECT table_name, column_name, data_type FROM information_schema.columns WHERE column_name='issuer_json' AND table_name IN ('invoices','acts') ORDER BY 1;" """,
    )

    run(
        c,
        f"grep -n \"hasCustomIssuer\\|issuer_json\\|Наши реквизиты\\|ASGARD_SHELL_VERSION\\|billing.js?v=\\|nd-permits.js?v=\" "
        f"{PROJECT}/src/services/billing-docs.js {PROJECT}/src/routes/invoices.js "
        f"{PROJECT}/public/assets/js/billing.js {PROJECT}/public/index.html {PROJECT}/public/sw.js | head -40",
    )
    run(
        c,
        f"grep -l \"Наши реквизиты\" {PROJECT}/public/v2/assets/*.js | head -5; "
        f"test -f {PROJECT}/public/v2/assets/{v2_chunk} && echo HAS_V2_CHUNK={v2_chunk}",
    )

    run(c, "systemctl restart asgard-crm")
    run(
        c,
        """bash -lc 'systemctl is-active asgard-crm; for i in 1 2 3 4 5 6 7 8 9 10; do
  code=$(curl -s -o /dev/null -w "%{http_code}" http://127.0.0.1:3000/api/health || true)
  echo try=$i code=$code
  [ "$code" = "200" ] && break
  sleep 2
done
curl -s http://127.0.0.1:3000/api/health; echo
curl -s http://127.0.0.1:3000/api/version; echo
curl -s -o /dev/null -w "billing.js=%{http_code}\\n" http://127.0.0.1:3000/assets/js/billing.js
curl -s -o /dev/null -w "billing.css=%{http_code}\\n" http://127.0.0.1:3000/assets/css/billing.css
curl -s http://127.0.0.1:3000/ | grep -E "ASGARD_SHELL_VERSION|billing.js\\?v=" | head -6
'""",
    )
    run(c, "journalctl -u asgard-crm -n 50 --no-pager | tail -50")
    print("SNAP", SNAP + ".tgz")
    print("V2_CHUNK", v2_chunk)
    sftp.close()
    c.close()


if __name__ == "__main__":
    main()
