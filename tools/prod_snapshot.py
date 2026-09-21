#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
ASGARD CRM — prod snapshot (точка отката; D-169: снапшот ВСЕГДА со src/).

Зачем: перед любыми правками нужна точка отката, из которой можно вернуть
И фронт (public/), И бэкенд (src/). Снапшоты `pre-big` от 15–16.09 не содержали
src/ — откатить бэкенд из них было нельзя. Здесь src/ обязателен и проверяется.

Прод НЕ пишется: только чтение (ssh + tar в stdout, стрим на локальную машину).
Прод-бэкапы (*.bak-*), public/mobile-app и node_modules в архив не берём —
это 1,2 ГБ мусора, к откату кода отношения не имеют.

Пишет:
  _snapshots/<label>-<ts>.tar.gz   — архив public/ src/ migrations/ + package.json
  _snapshots/<label>-<ts>.json     — метаданные (git HEAD/status, md5 оболочки, инвентарь)

Использование:
  python tools/prod_snapshot.py                # снять снапшот
  python tools/prod_snapshot.py --list         # список существующих
  python tools/prod_snapshot.py --keep 5       # удалить всё, кроме 5 последних
  python tools/prod_snapshot.py --inventory    # только инвентарь прода, без архива
  python tools/prod_snapshot.py --label before-G
"""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import shutil
import subprocess
import sys
import tarfile
from datetime import datetime

try:
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    sys.stderr.reconfigure(encoding="utf-8", errors="replace")
except Exception:
    pass

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SNAP_DIR = os.path.join(ROOT, "_snapshots")

SSH_KEY = os.path.expanduser("~/.ssh/asgard_crm_deploy")
SSH_HOST = "root@92.242.61.184"
REMOTE_ROOT = "/var/www/asgard-crm"

# Что кладём в архив (относительно REMOTE_ROOT)
INCLUDE = ["public", "src", "migrations", "package.json", "package-lock.json"]

# Что из public/ НЕ нужно: бэкапы чужого веса, APK-сборки и node_modules
EXCLUDE = [
    "public/mobile-app",
    "public/desktop-v2-src/node_modules",
    "public/desktop-v2-src/dist",
    "public/*.bak-*",
    "public/m.bak-*",
    "public/v2.bak-*",
    "public/temp_*",
]

SSH_OPTS = [
    "-i", SSH_KEY,
    "-o", "StrictHostKeyChecking=no",
    "-o", "ConnectTimeout=20",
    "-o", "BatchMode=yes",
]

# Скрипт инвентаря — только чтение, ничего не пишет
INVENTORY_SCRIPT = r"""
cd {root} || exit 9
echo "GIT_HEAD=$(git rev-parse HEAD 2>/dev/null)"
echo "GIT_BRANCH=$(git rev-parse --abbrev-ref HEAD 2>/dev/null)"
echo "GIT_DIRTY=$(git status --porcelain 2>/dev/null | wc -l)"
echo "MD5_INDEX=$(md5sum public/index.html 2>/dev/null | awk '{{print $1}}')"
echo "MD5_SW=$(md5sum public/sw.js 2>/dev/null | awk '{{print $1}}')"
echo "SIZE_INDEX=$(stat -c %s public/index.html 2>/dev/null)"
echo "SIZE_SW=$(stat -c %s public/sw.js 2>/dev/null)"
echo "SHELL_VERSION=$(grep -oE 'SHELL_VERSION *= *.[0-9]+' public/sw.js 2>/dev/null | head -1 | grep -oE '[0-9]+')"
echo "ASGARD_SHELL_VERSION=$(grep -oE 'ASGARD_SHELL_VERSION *= *.[0-9]+' public/index.html 2>/dev/null | head -1 | grep -oE '[0-9]+')"
echo "SERVICE=$(systemctl is-active asgard-crm 2>/dev/null)"
echo "---DU---"
du -sh public src migrations public/assets public/m public/v2 2>/dev/null
echo "---PUBLIC_ROOT---"
ls -1 public 2>/dev/null
""".format(root=REMOTE_ROOT)


def run(cmd, **kw):
    return subprocess.run(cmd, capture_output=True, text=True,
                          encoding="utf-8", errors="replace", **kw)


def ssh_read(script: str) -> str:
    proc = run(["ssh"] + SSH_OPTS + [SSH_HOST, script])
    if proc.returncode != 0:
        raise SystemExit(f"ssh failed (rc={proc.returncode}):\n{proc.stderr[-3000:]}")
    return proc.stdout


def collect_inventory() -> dict:
    raw = ssh_read(INVENTORY_SCRIPT)
    inv: dict = {"raw": raw, "sections": {}}

    for line in raw.splitlines():
        if "=" in line and not line.startswith("---"):
            k, _, v = line.partition("=")
            if k and all(ch.isalnum() or ch == "_" for ch in k):
                inv[k] = v.strip()

    du: dict = {}
    public_root: list = []
    section = None
    for line in raw.splitlines():
        if line.strip() == "---DU---":
            section = "du"
            continue
        if line.strip() == "---PUBLIC_ROOT---":
            section = "public_root"
            continue
        if section == "du" and line.strip():
            parts = line.split("\t")
            if len(parts) == 2:
                du[parts[1]] = parts[0]
        elif section == "public_root" and line.strip():
            public_root.append(line.strip())

    inv["du"] = du
    inv["public_root"] = public_root
    return inv


def local_git() -> dict:
    out = {}
    for key, args in (
        ("head", ["git", "rev-parse", "HEAD"]),
        ("branch", ["git", "rev-parse", "--abbrev-ref", "HEAD"]),
    ):
        p = run(args, cwd=ROOT)
        out[key] = p.stdout.strip() if p.returncode == 0 else None
    p = run(["git", "status", "--porcelain"], cwd=ROOT)
    out["dirty_count"] = len([x for x in p.stdout.splitlines() if x.strip()])
    lv = os.path.join(ROOT, "tests", "reports", ".last-verified")
    if os.path.isfile(lv):
        with open(lv, encoding="utf-8", errors="replace") as fh:
            out["last_verified"] = fh.read().strip()
    return out


def build_archive(dest: str) -> dict:
    """tar czf - ... на проде, стрим локально. Возвращает статистику."""
    cmd = ["ssh"] + SSH_OPTS + [SSH_HOST]
    tar_cmd = "cd {} && tar czf - {}".format(
        REMOTE_ROOT,
        " ".join(f"--exclude='{e}'" for e in EXCLUDE) + " " + " ".join(INCLUDE),
    )
    cmd.append(tar_cmd)

    proc = subprocess.Popen(cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
    written = 0
    sha = hashlib.sha256()
    tmp = dest + ".part"
    with open(tmp, "wb") as fh:
        while True:
            chunk = proc.stdout.read(1 << 20)
            if not chunk:
                break
            fh.write(chunk)
            sha.update(chunk)
            written += len(chunk)
    stderr = proc.stderr.read().decode("utf-8", "replace")
    rc = proc.wait()
    if rc != 0:
        os.path.exists(tmp) and os.remove(tmp)
        raise SystemExit(f"remote tar failed (rc={rc}):\n{stderr[-3000:]}")
    os.replace(tmp, dest)
    return {"bytes": written, "sha256": sha.hexdigest(), "stderr": stderr[-2000:]}


def verify_archive(path: str) -> dict:
    """D-169: архив обязан содержать src/ и public/index.html."""
    names: list = []
    with tarfile.open(path, "r:gz") as tf:
        for member in tf:
            names.append(member.name)

    src_files = [n for n in names if n.startswith("src/") and n.endswith(".js")]
    has_index = any(n.endswith("public/index.html") for n in names)
    has_sw = any(n.endswith("public/sw.js") for n in names)
    return {
        "members": len(names),
        "src_js": len(src_files),
        "has_index": has_index,
        "has_sw": has_sw,
        "ok": bool(src_files) and has_index and has_sw,
    }


def list_snapshots() -> list:
    if not os.path.isdir(SNAP_DIR):
        return []
    items = []
    for name in os.listdir(SNAP_DIR):
        if name.endswith(".tar.gz"):
            p = os.path.join(SNAP_DIR, name)
            items.append({
                "name": name,
                "bytes": os.path.getsize(p),
                "mtime": os.path.getmtime(p),
            })
    items.sort(key=lambda x: x["mtime"], reverse=True)
    return items


def prune(keep: int) -> list:
    removed = []
    for item in list_snapshots()[keep:]:
        base = item["name"][: -len(".tar.gz")]
        for suffix in (".tar.gz", ".json"):
            p = os.path.join(SNAP_DIR, base + suffix)
            if os.path.isfile(p):
                os.remove(p)
                removed.append(os.path.basename(p))
    return removed


def main() -> int:
    ap = argparse.ArgumentParser(description="Prod snapshot (read-only) с обязательным src/")
    ap.add_argument("--label", default="manual", help="метка снапшота (по умолчанию manual)")
    ap.add_argument("--keep", type=int, default=0, help="оставить N последних (остальные удалить)")
    ap.add_argument("--list", action="store_true", help="показать существующие снапшоты")
    ap.add_argument("--inventory", action="store_true", help="только инвентарь прода, без архива")
    args = ap.parse_args()

    if args.list:
        items = list_snapshots()
        if not items:
            print("снапшотов нет")
            return 0
        print(f"{'дата':<17} {'размер':>9}  имя")
        for it in items:
            dt = datetime.fromtimestamp(it["mtime"]).strftime("%Y-%m-%d %H:%M")
            print(f"{dt:<17} {it['bytes'] / 1048576:>7.1f}M  {it['name']}")
        return 0

    print("[1/4] инвентарь прода (только чтение)...")
    inv = collect_inventory()
    print(f"      git HEAD   : {inv.get('GIT_HEAD')}")
    print(f"      git dirty  : {inv.get('GIT_DIRTY')}")
    print(f"      branch     : {inv.get('GIT_BRANCH')}")
    print(f"      service    : {inv.get('SERVICE')}")
    print(f"      md5 index  : {inv.get('MD5_INDEX')}")
    print(f"      md5 sw     : {inv.get('MD5_SW')}")
    print(f"      shell ver  : {inv.get('SHELL_VERSION')} / {inv.get('ASGARD_SHELL_VERSION')}")

    if args.inventory:
        return 0

    os.makedirs(SNAP_DIR, exist_ok=True)
    ts = datetime.now().strftime("%Y%m%d-%H%M%S")
    base = f"{args.label}-{ts}"
    tar_path = os.path.join(SNAP_DIR, base + ".tar.gz")
    json_path = os.path.join(SNAP_DIR, base + ".json")

    if shutil.which("ssh") is None:
        raise SystemExit("ssh не найден в PATH")

    print("[2/4] снимаю архив с прода (public без bak/mobile-app/node_modules, + src, migrations)...")
    stats = build_archive(tar_path)
    print(f"      получено {stats['bytes'] / 1048576:.1f} МБ")

    print("[3/4] проверяю архив (src/ и оболочка обязательны)...")
    ver = verify_archive(tar_path)
    print(f"      файлов в архиве : {ver['members']}")
    print(f"      src/**/*.js     : {ver['src_js']}")
    print(f"      public/index.html: {'да' if ver['has_index'] else 'НЕТ'}")
    print(f"      public/sw.js     : {'да' if ver['has_sw'] else 'НЕТ'}")

    meta = {
        "label": args.label,
        "taken_at": datetime.now().isoformat(timespec="seconds"),
        "host": SSH_HOST,
        "remote_root": REMOTE_ROOT,
        "include": INCLUDE,
        "exclude": EXCLUDE,
        "prod": inv,
        "local": local_git(),
        "archive": {"path": os.path.relpath(tar_path, ROOT), **stats},
        "verify": ver,
    }
    with open(json_path, "w", encoding="utf-8") as fh:
        json.dump(meta, fh, ensure_ascii=False, indent=2)

    if not ver["ok"]:
        print("\n[FAIL] архив НЕ содержит src/ или оболочку — точка отката негодна.")
        print(f"       файл оставлен для разбора: {tar_path}")
        return 1

    print(f"[4/4] готово:\n      {os.path.relpath(tar_path, ROOT)}\n      {os.path.relpath(json_path, ROOT)}")

    if args.keep > 0:
        removed = prune(args.keep)
        if removed:
            print(f"      удалено старых: {len(removed)}")

    # Сверка: md5 оболочки в прод-инвентаре против локальных файлов (для деплой-гейта)
    for remote_key, local_rel in (("MD5_INDEX", "public/index.html"), ("MD5_SW", "public/sw.js")):
        rv = inv.get(remote_key)
        lp = os.path.join(ROOT, local_rel.replace("/", os.sep))
        if rv and os.path.isfile(lp):
            lv = hashlib.md5(open(lp, "rb").read()).hexdigest()
            mark = "СОВПАДАЕТ" if lv == rv else "РАЗЛИЧАЕТСЯ"
            print(f"      {local_rel}: локально vs прод -> {mark}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
