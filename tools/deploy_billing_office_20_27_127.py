# -*- coding: utf-8 -*-
"""Deploy billing Word/Excel + facsimile 20.27.127. No git reset --hard."""
import io
import re
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
VER = "20.27.127"
TAG = datetime.now().strftime("%Y%m%d-%H%M%S")
SNAP = f"/root/snapshots/asgard-crm-pre-deploy-billing-office-{TAG}"

FILES = [
    "src/services/billing-office.js",
    "src/services/billing-docs.js",
    "src/routes/invoices.js",
    "src/routes/acts.js",
    "public/assets/js/billing.js",
    "public/assets/css/billing.css",
    "templates/billing/invoice-tpl.docx",
    "templates/billing/act-tpl.docx",
]

MARKERS = {
    "src/services/billing-office.js": ["generateBillingDocx", "generateBillingXlsx", "fitBox", "total_amount"],
    "src/services/billing-docs.js": ["flagOn", "asgard_logo.png", "stamp.png"],
    "src/routes/invoices.js": ["preview-docx", "preview-xlsx", "billing-office"],
    "src/routes/acts.js": ["preview-docx", "preview-xlsx", "billing-office"],
    "public/assets/js/billing.js": ["officePreviewPath", "data-ctor=\"docx\"", "asgard_logo.png"],
    "public/assets/css/billing.css": ["bill-stamp-img", "bill-sign-img"],
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


def pack_v2() -> tuple[Path, str]:
    v2 = ROOT / "public" / "v2"
    if not (v2 / "assets").exists():
        raise SystemExit("public/v2/assets missing — npm run build first")
    chunk = None
    for p in (v2 / "assets").glob("*.js"):
        try:
            text = p.read_text(encoding="utf-8", errors="ignore")
        except Exception:
            continue
        if "/api/acts/preview-" in text and "docx" in text:
            chunk = p.name
            break
    if not chunk:
        raise SystemExit("v2 bundle missing office preview — rebuild first")
    tmp = Path(tempfile.gettempdir()) / f"asgard-v2-billing-office-{TAG}.tar.gz"
    with tarfile.open(tmp, "w:gz") as tar:
        tar.add(v2, arcname="v2")
    print(f"packed v2 {tmp.stat().st_size} chunk={chunk}")
    return tmp, chunk


def main():
    for rel in FILES:
        p = ROOT / rel
        if not p.exists():
            raise SystemExit(f"missing file {rel}")
        if p.suffix == ".docx":
            continue
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

    snap_paths = " ".join(FILES + ["public/index.html", "public/sw.js", "public/v2", "templates/billing"])
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
        f"test -f {PROJECT}/src/services/billing-office.js && echo HAS_OFFICE || echo NO_OFFICE; "
        f"test -f {PROJECT}/public/assets/img/stamp.png && echo HAS_STAMP || echo NO_STAMP; "
        f"test -f {PROJECT}/public/assets/img/asgard_logo.png && echo HAS_LOGO || echo NO_LOGO",
    )

    remote_tar = f"/tmp/asgard-billing-office-{TAG}.tar.gz"
    with tempfile.NamedTemporaryFile(suffix=".tar.gz", delete=False) as tmp:
        tar_path = Path(tmp.name)
    with tarfile.open(tar_path, "w:gz") as tar:
        for rel in FILES:
            tar.add(ROOT / rel, arcname=rel)
    sftp.put(str(tar_path), remote_tar)
    tar_path.unlink(missing_ok=True)
    run(c, f"mkdir -p {PROJECT}/templates/billing && tar -xzf {remote_tar} -C {PROJECT}")

    remote_v2 = f"/tmp/asgard-v2-billing-office-{TAG}.tar.gz"
    sftp.put(str(v2_tar), remote_v2)
    v2_tar.unlink(missing_ok=True)
    run(c, f"tar -xzf {remote_v2} -C {PROJECT}/public")

    run(
        c,
        f"""python3 - <<'PY'
from pathlib import Path
import re
ver = "{VER}"
idx = Path("{PROJECT}/public/index.html")
sw = Path("{PROJECT}/public/sw.js")
t = idx.read_text(encoding="utf-8")
t2 = t
t2 = re.sub(r"ASGARD_SHELL_VERSION = '[0-9.]+'", f"ASGARD_SHELL_VERSION = '{{ver}}'", t2)
t2 = re.sub(r"billing\\.js\\?v=[0-9.]+", f"billing.js?v={{ver}}", t2)
t2 = re.sub(r"billing\\.css\\?v=[0-9.]+", f"billing.css?v={{ver}}", t2)
if t2 == t:
    raise SystemExit("index.html not patched — markers missing")
idx.write_text(t2, encoding="utf-8")
s = sw.read_text(encoding="utf-8")
s2 = re.sub(r"SHELL_VERSION = '[0-9.]+'", f"SHELL_VERSION = '{{ver}}'", s, count=1)
if s2 == s:
    raise SystemExit("sw.js not patched")
sw.write_text(s2, encoding="utf-8")
print("patched index.html + sw.js to", ver)
PY""",
    )

    run(
        c,
        f"grep -n \"preview-docx\\|generateBillingDocx\\|SHELL_VERSION = '{VER}'\\|billing.js?v={VER}\" "
        f"{PROJECT}/src/services/billing-office.js {PROJECT}/src/routes/invoices.js "
        f"{PROJECT}/src/routes/acts.js {PROJECT}/public/assets/js/billing.js "
        f"{PROJECT}/public/index.html {PROJECT}/public/sw.js | head -40",
    )
    run(
        c,
        f"ls -lh {PROJECT}/templates/billing/*.docx; "
        f"grep -l \"/api/acts/preview-\" {PROJECT}/public/v2/assets/*.js | head -5; "
        f"test -f {PROJECT}/public/v2/assets/{v2_chunk} && echo HAS_V2_CHUNK={v2_chunk}",
    )

    print("=== SMOKE GENERATE ON PROD ===")
    run(
        c,
        f"""cd {PROJECT} && node - <<'NODE'
const office = require('./src/services/billing-office');
const billing = require('./src/services/billing-docs');
const PizZip = require('pizzip');
const doc = {{
  act_number: 'АКТ-SMOKE',
  act_date: '2026-09-08',
  customer_name: 'ООО Смоук',
  items: [{{ name: 'Работы', unit: 'усл.', qty: 1, price: 1000, total: 1000 }}],
  vat_pct: 22
}};
const company = {{ name: 'ООО «Асгард-Сервис»', inn: '7736244785', director: 'Кудряшов' }};
const view = office.buildView('act', doc, company);
if (!String(view.total).includes('1') ) throw new Error('totals ' + view.total);
const buf = office.generateBillingDocx('act', doc, company, {{}});
const zip = new PizZip(buf);
const media = Object.keys(zip.files).filter(k => k.startsWith('word/media/'));
if (media.length < 2) throw new Error('media ' + media.length);
console.log('prod-smoke docx', buf.length, 'media', media.length, 'total', view.total);
NODE""",
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
    run(c, "journalctl -u asgard-crm -n 40 --no-pager | tail -40")
    print("SNAP", SNAP + ".tgz")
    print("V2_CHUNK", v2_chunk)
    sftp.close()
    c.close()


if __name__ == "__main__":
    main()
