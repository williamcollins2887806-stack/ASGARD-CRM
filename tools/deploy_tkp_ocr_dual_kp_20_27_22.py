#!/usr/bin/env python3
"""Deploy TKP OCR + dual KP modals (shell 20.27.22). No git reset on prod."""
import io
import os
import sys
import tarfile
import tempfile
import time
from pathlib import Path

import paramiko

sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8", errors="replace")

KEY = Path.home() / ".ssh" / "asgard_crm_deploy"
HOST = "92.242.61.184"
PROJECT = "/var/www/asgard-crm"
ROOT = Path(__file__).resolve().parents[1]
VER = "20.27.22"

FILES = [
    "public/index.html",
    "public/sw.js",
    "public/assets/js/tkp-page.js",
    "public/assets/js/tkp-full-form.js",
    "src/routes/tkp.js",
    "src/services/tkp-parser.js",
    "src/services/pdf-ocr.js",
    "src/services/pdf-generator.js",
    "src/services/tkp-full-kp.js",
    "src/services/mimir-conductor/agents/document_parser.js",
    "migrations/V298__tkp_kp_variant.sql",
    "public/desktop-v2-src/src/pages/Tkp/api.js",
    "public/desktop-v2-src/src/pages/Tkp/index.jsx",
    "public/desktop-v2-src/src/pages/Tkp/modals/UploadTkpModal.jsx",
    "public/desktop-v2-src/src/pages/Tkp/modals/TkpForm.jsx",
    "public/desktop-v2-src/src/pages/Tkp/modals/PdfDialogModal.jsx",
    "public/desktop-v2-src/src/pages/Tkp/modals/CreateTkpChooser.jsx",
    "public/desktop-v2-src/src/pages/Tkp/modals/FullKpFormModal.jsx",
    "public/desktop-v2-src/src/pages/Tkp/modals/PolishTextSheet.jsx",
]


def ensure_dir(sftp, remote_dir):
    parts = remote_dir.strip("/").split("/")
    cur = ""
    for p in parts:
        cur += "/" + p
        try:
            sftp.stat(cur)
        except OSError:
            sftp.mkdir(cur)


def run(client, cmd, timeout=180):
    _, stdout, stderr = client.exec_command(cmd, timeout=timeout)
    out = stdout.read().decode("utf-8", errors="replace").strip()
    err = stderr.read().decode("utf-8", errors="replace").strip()
    code = stdout.channel.recv_exit_status()
    return code, out, err


def main():
    if not KEY.exists():
        print(f"ERROR: missing key {KEY}", file=sys.stderr)
        sys.exit(1)

    key = paramiko.Ed25519Key.from_private_key_file(str(KEY))
    client = paramiko.SSHClient()
    client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    client.connect(HOST, username="root", pkey=key, timeout=30)
    sftp = client.open_sftp()

    print(f"=== Snapshot before deploy {VER} ===")
    code, out, err = run(
        client,
        "mkdir -p /root/snapshots && "
        f"tar -czf /root/snapshots/asgard-crm-pre-deploy-tkp-{VER}-$(date +%Y%m%d%H%M%S).tgz "
        "-C /var/www asgard-crm/public/index.html asgard-crm/public/sw.js "
        "asgard-crm/public/assets/js/tkp-page.js asgard-crm/src/routes/tkp.js "
        "asgard-crm/src/services/tkp-parser.js asgard-crm/src/services/pdf-ocr.js "
        "asgard-crm/public/v2 2>/dev/null; "
        f"ls -lt /root/snapshots/asgard-crm-pre-deploy-tkp-{VER}-* | head -1",
        timeout=180,
    )
    print(out or "(snapshot done)")
    if err:
        print("stderr:", err)

    print(f"\n=== Upload files {VER} ===")
    for rel in FILES:
        local = ROOT / rel
        if not local.exists():
            print(f"  SKIP missing {rel}")
            continue
        remote = f"{PROJECT}/{rel.replace(os.sep, '/')}"
        ensure_dir(sftp, os.path.dirname(remote))
        sftp.put(str(local), remote)
        print(f"  OK {rel}")

    v2 = ROOT / "public" / "v2"
    if v2.is_dir():
        print("\n=== Upload public/v2 via tar ===")
        with tempfile.NamedTemporaryFile(suffix=".tgz", delete=False) as tmp:
            tmp_path = tmp.name
        try:
            with tarfile.open(tmp_path, "w:gz") as tar:
                tar.add(str(v2), arcname="v2")
            remote_tar = f"/tmp/asgard-v2-{VER}.tgz"
            sftp.put(tmp_path, remote_tar)
            code, out, err = run(
                client,
                f"tar -xzf {remote_tar} -C {PROJECT}/public && rm -f {remote_tar} && "
                f"ls -la {PROJECT}/public/v2/index.html && "
                f"python3 -c \"import re; t=open('{PROJECT}/public/v2/index.html').read(); "
                "print(' '.join(re.findall(r'assets/index-[^\\\"\\']+', t)[:3]))\"",
                timeout=180,
            )
            print(out)
            if err:
                print("stderr:", err)
            if code != 0:
                print(f"ERROR v2 extract exit {code}")
                sys.exit(1)
        finally:
            try:
                os.unlink(tmp_path)
            except OSError:
                pass
    else:
        print("WARN public/v2 missing")

    ts = int(time.time())
    smoke_path = f"/tmp/asgard_smoke_{VER}.sh"
    smoke = f"""#!/bin/bash
set -e
echo '-- local shell files --'
grep -o "ASGARD_SHELL_VERSION = '[^']*'" {PROJECT}/public/index.html | head -1
grep -o "SHELL_VERSION = '[^']*'" {PROJECT}/public/sw.js | head -1
grep -o 'tkp-page.js?v=[^"]*' {PROJECT}/public/index.html | head -1
grep -o 'tkp-full-form.js?v=[^"]*' {PROJECT}/public/index.html | head -1
test -f {PROJECT}/public/assets/js/tkp-full-form.js && echo 'tkp-full-form.js present'
grep -n "openCreateChooser\\|force_ocr\\|Повторное" {PROJECT}/public/assets/js/tkp-page.js | head -10
grep -n "openPolishSheet\\|Полное коммерческое" {PROJECT}/public/assets/js/tkp-full-form.js | head -10
test -f {PROJECT}/src/services/tkp-full-kp.js && echo 'tkp-full-kp.js present'
echo '-- v2 index assets --'
python3 -c "import re; t=open('{PROJECT}/public/v2/index.html').read(); print(' '.join(re.findall(r'assets/index-[^\\\"\\']+', t)[:3]))"
echo '-- HTTP shell version (cache-bust) --'
curl -sS -D /tmp/asgard_headers.txt -o /tmp/asgard_index.html "https://asgard-crm.ru/?_v={ts}" >/dev/null
head -20 /tmp/asgard_headers.txt
grep -o "ASGARD_SHELL_VERSION = '[^']*'" /tmp/asgard_index.html | head -1
grep -o 'tkp-page.js?v=[^"]*' /tmp/asgard_index.html | head -1
grep -o 'tkp-full-form.js?v=[^"]*' /tmp/asgard_index.html | head -1
echo '-- SW.js version via HTTP --'
curl -sS "https://asgard-crm.ru/sw.js?_v={ts}" | grep -o "SHELL_VERSION = '[^']*'" | head -1
echo '-- v2 HTTP assets --'
curl -sS -o /tmp/asgard_v2.html "https://asgard-crm.ru/v2/?_v={ts}"
python3 -c "import re; t=open('/tmp/asgard_v2.html').read(); print(' '.join(re.findall(r'assets/index-[^\\\"\\']+', t)[:3]))"
echo '-- API version --'
curl -sS http://127.0.0.1:3000/api/version; echo
echo '-- API health routes exist --'
TOKEN=$(curl -sS -X POST http://127.0.0.1:3000/api/auth/login -H 'Content-Type: application/json' -d '{{"login":"test_pm","password":"Test123!"}}' | python3 -c 'import sys,json; print(json.load(sys.stdin).get("token",""))')
test -n "$TOKEN" && echo login_ok
curl -sS -o /tmp/tkp_list.json -w 'GET /api/tkp HTTP=%{{http_code}}\\n' -H "Authorization: Bearer $TOKEN" http://127.0.0.1:3000/api/tkp
python3 - <<'PY'
import json
d=json.load(open('/tmp/tkp_list.json',encoding='utf-8'))
items=d.get('tkp') or d.get('items') or []
print('tkp_count', len(items))
full=[x for x in items if x.get('kp_variant')=='full']
classic=[x for x in items if (x.get('kp_variant') or 'classic')=='classic']
print('classic', len(classic), 'full', len(full))
if items:
  tid=items[0]['id']
  open('/tmp/tkp_one_id.txt','w').write(str(tid))
  print('sample_id', tid, 'kp_variant', items[0].get('kp_variant'))
PY
SAMPLE=$(cat /tmp/tkp_one_id.txt 2>/dev/null || true)
if [ -n "$SAMPLE" ]; then
  curl -sS -o /tmp/tkp_one.json -w 'GET /api/tkp/ID HTTP=%{{http_code}}\\n' -H "Authorization: Bearer $TOKEN" http://127.0.0.1:3000/api/tkp/$SAMPLE
  python3 -c "import json;d=json.load(open('/tmp/tkp_one.json'));i=d.get('item') or {{}};print('detail_ok', bool(i.get('id')), 'kp_variant', i.get('kp_variant'))"
  curl -sS -o /dev/null -w 'GET /api/tkp/ID/pdf HTTP=%{{http_code}} size=%{{size_download}}\\n' -H "Authorization: Bearer $TOKEN" "http://127.0.0.1:3000/api/tkp/$SAMPLE/pdf?signature=1&stamp=0"
  curl -sS -o /dev/null -w 'GET /api/tkp/ID/docx HTTP=%{{http_code}} size=%{{size_download}}\\n' -H "Authorization: Bearer $TOKEN" "http://127.0.0.1:3000/api/tkp/$SAMPLE/docx"
fi
curl -sS -o /tmp/polish_empty.json -w 'POST polish-text empty HTTP=%{{http_code}}\\n' -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' -d '{{"text":""}}' http://127.0.0.1:3000/api/tkp/polish-text
python3 -c "import json;d=json.load(open('/tmp/polish_empty.json'));print('polish_empty_error', d.get('error'))"
curl -sS -o /tmp/polish_ok.json -w 'POST polish-text ok HTTP=%{{http_code}}\\n' -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' -d '{{"text":"работы по очистке оборудования выполнить качественно.","field_label":"описание"}}' http://127.0.0.1:3000/api/tkp/polish-text
python3 -c "import json;d=json.load(open('/tmp/polish_ok.json'));print('polish_ok', bool(d.get('polished')), 'len', len(d.get('polished') or ''))"
curl -sS -o /tmp/parse_nofile.json -w 'POST parse-attachment nofile HTTP=%{{http_code}}\\n' -H "Authorization: Bearer $TOKEN" -F 'force_ocr=1' -F 'mode=refine' http://127.0.0.1:3000/api/tkp/parse-attachment
python3 -c "import json;d=json.load(open('/tmp/parse_nofile.json'));print('parse_nofile_error', d.get('error'))"
echo '-- shell markers on server --'
grep -n "openCreateChooser\\|force_ocr\\|Повторное" {PROJECT}/public/assets/js/tkp-page.js | head -10
grep -n "openPolishSheet\\|Полное коммерческое" {PROJECT}/public/assets/js/tkp-full-form.js | head -10
test -f {PROJECT}/src/services/tkp-full-kp.js && echo 'tkp-full-kp.js present'
echo '-- recent logs --'
journalctl -u asgard-crm -n 25 --no-pager | tail -25
"""
    smoke_path = f"/tmp/asgard_smoke_{VER}.sh"
    with sftp.file(smoke_path, "w") as fh:
        fh.write(smoke.replace("\r\n", "\n").replace("\r", "\n"))
    sftp.chmod(smoke_path, 0o755)
    sftp.close()

    print("\n=== Migration V298 ===")
    code, out, err = run(
        client,
        f"PGPASSWORD=123456789 psql -U asgard -d asgard_crm -v ON_ERROR_STOP=1 "
        f"-f {PROJECT}/migrations/V298__tkp_kp_variant.sql && "
        f"PGPASSWORD=123456789 psql -U asgard -d asgard_crm -c "
        "\"SELECT column_name, data_type, column_default FROM information_schema.columns "
        "WHERE table_name='tkp' AND column_name='kp_variant';\"",
        timeout=60,
    )
    print(out or "(no stdout)")
    if err:
        print("stderr:", err)
    if code != 0:
        print(f"ERROR migration exit {code}")
        sys.exit(1)

    print("\n=== Restart asgard-crm ===")
    code, out, err = run(
        client,
        "systemctl restart asgard-crm; sleep 4; systemctl is-active asgard-crm; "
        "curl -sS http://127.0.0.1:3000/api/version",
        timeout=90,
    )
    print(out)
    if err:
        print("stderr:", err)
    if code != 0:
        print(f"ERROR restart exit {code}")
        sys.exit(1)

    print("\n=== app_updates banner ===")
    changes = (
        "ТКП: надёжный OCR с повторным сканом; одна кнопка Создать → выбор краткое/полное КП; "
        "полная модалка по шаблону Ника; Мимир-переписка; экспорт Preview/Word/PDF±печать"
    )
    changes_sql = changes.replace("'", "''")
    sql = (
        "INSERT INTO app_updates (version, title, changes, target) "
        f"SELECT 'v{VER}', 'ТКП OCR + полное КП', '{changes_sql}', 'all' "
        f"WHERE NOT EXISTS (SELECT 1 FROM app_updates WHERE version = 'v{VER}');"
    )
    code, out, err = run(
        client,
        f"PGPASSWORD=123456789 psql -U asgard -d asgard_crm -c \"{sql}\"",
        timeout=30,
    )
    print(out or "(banner ok)")
    if err:
        print("stderr:", err)

    print("\n=== Smoke: shell/cache + endpoints (no data create) ===")
    code, out, err = run(client, f"bash {smoke_path}", timeout=180)
    print(out)
    if err:
        print("stderr:", err)
    if code != 0:
        print(f"ERROR smoke exit {code}")
        sys.exit(1)

    print("\n=== DONE deploy", VER, "===")
    client.close()


if __name__ == "__main__":
    main()
