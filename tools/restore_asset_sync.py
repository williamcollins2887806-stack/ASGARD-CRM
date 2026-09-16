#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
restore_asset_sync.py — сверка и синхронизация фронт-ассетов локально <-> прод.

Контекст (tests/reports/_DIFF-LEDGER.md, D-145 / D-146):
  прод-фронт 14.09.2026 потерял подключения модулей; часть файлов на проде
  физически отсутствовала или стояла на июльской версии. Нужен детерминированный
  синк с правилами, которые запрещают «починить» прод, откатив его назад.

Правила:
  * Хеш — sha256 от содержимого с нормализованными переводами строк (CRLF -> LF)
    для текстовых файлов; для бинарных — sha256 как есть. Это убирает ложные
    дельты Windows(CRLF) vs Linux(LF).
  * Заливаем ТОЛЬКО реальные дельты.
  * НИКОГДА не даунгрейдим: если на проде mtime новее локального, файл не
    перезаписывается, а попадает в отчёт как требующий решения человека.
  * Прод-only мусор (.bak.*, *_preview и т.п.) не трогаем и не удаляем.
  * Ничего на проде не удаляется.

Использование:
  python tools/restore_asset_sync.py plan     # только отчёт (ничего не менять)
  python tools/restore_asset_sync.py apply    # tar+scp+extract по плану

Выход: tests/reports/ASSET-SYNC-REPORT.json + человекочитаемая сводка в stdout.
"""

from __future__ import annotations

import base64
import hashlib
import json
import os
import re
import shlex
import subprocess
import sys
from datetime import datetime, timezone

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PUBLIC = os.path.join(ROOT, "public")
REPORT_DIR = os.path.join(ROOT, "tests", "reports")
REPORT_JSON = os.path.join(REPORT_DIR, "ASSET-SYNC-REPORT.json")
MANIFEST_JSON = os.path.join(REPORT_DIR, "ASSET-MANIFESTS.json")
WORK = os.path.join(ROOT, "_tmp_sync")

SSH_KEY = os.path.expanduser("~/.ssh/asgard_crm_deploy")
SSH_HOST = "root@92.242.61.184"
REMOTE_ROOT = "/var/www/asgard-crm"

# Префиксы/паттерны, которые никогда не заливаем и не удаляем (прод-only мусор).
JUNK_RE = re.compile(r"\.bak(\.|$)|\.orig$|\.save$|\.tmp$|~$", re.IGNORECASE)

# Что вообще сверяем: весь public/assets + файлы оболочки, которые тянет браузер/SW.
TARGET_FILES = [
    "public/index.html",
    "public/sw.js",
    "public/manifest.json",
    "public/offline.html",
    "public/favicon.ico",
]
TARGET_DIRS = ["public/assets"]

REMOTE_SCRIPT = r'''
import hashlib, os, sys, json

root = sys.argv[1]
targets = []
for sub in ("public/assets",):
    base = os.path.join(root, sub)
    for dirpath, dirnames, filenames in os.walk(base):
        dirnames[:] = [d for d in dirnames if d not in ("node_modules", ".git")]
        for fn in filenames:
            targets.append(os.path.join(dirpath, fn))
for f in sys.argv[2:]:
    targets.append(os.path.join(root, f))

out = []
for abs_p in targets:
    rel = os.path.relpath(abs_p, root).replace(os.sep, "/")
    try:
        with open(abs_p, "rb") as fh:
            data = fh.read()
        st = os.stat(abs_p)
    except OSError:
        continue
    kind = "bin" if b"\x00" in data[:8192] else "text"
    norm = data.replace(b"\r\n", b"\n") if kind == "text" else data
    out.append({
        "path": rel,
        "kind": kind,
        "size": len(norm),
        "raw_size": len(data),
        "mtime": int(st.st_mtime),
        "sha256": hashlib.sha256(norm).hexdigest(),
    })
json.dump(out, sys.stdout)
'''


# ─────────────────────────── утилиты ───────────────────────────

def _sha256_norm(path: str) -> tuple[str, str, int, int]:
    """(kind, sha256, size_normalized, mtime) для локального файла."""
    with open(path, "rb") as fh:
        data = fh.read()
    kind = "bin" if b"\x00" in data[:8192] else "text"
    norm = data.replace(b"\r\n", b"\n") if kind == "text" else data
    return kind, hashlib.sha256(norm).hexdigest(), len(norm), int(os.stat(path).st_mtime)


def local_manifest() -> list[dict]:
    entries: list[dict] = []
    paths: list[str] = list(TARGET_FILES)
    for sub in TARGET_DIRS:
        base = os.path.join(ROOT, sub)
        for dirpath, dirnames, filenames in os.walk(base):
            dirnames[:] = [d for d in dirnames if d not in ("node_modules", ".git")]
            for fn in filenames:
                paths.append(os.path.relpath(os.path.join(dirpath, fn), ROOT).replace(os.sep, "/"))
    for rel in sorted(set(paths)):
        abs_p = os.path.join(ROOT, rel)
        if not os.path.isfile(abs_p):
            continue
        kind, digest, size, mtime = _sha256_norm(abs_p)
        entries.append({"path": rel, "kind": kind, "size": size, "mtime": mtime, "sha256": digest})
    return entries


def remote_manifest() -> list[dict]:
    payload = base64.b64encode(REMOTE_SCRIPT.encode("utf-8")).decode("ascii")
    # Все TARGET_FILES уезжают аргументами: иначе manifest.json / offline.html /
    # favicon.ico не попадали в удалённый инвентарь и навсегда числились как
    # «нет на проде» (и перезаливались каждым синком).
    extra = " ".join(shlex.quote(f) for f in TARGET_FILES)
    remote_cmd = (
        f"echo {payload} | base64 -d > /tmp/asgard_asset_inv.py && "
        f"python3 /tmp/asgard_asset_inv.py {REMOTE_ROOT} {extra}"
    )
    proc = subprocess.run(
        ["ssh", "-i", SSH_KEY, "-o", "StrictHostKeyChecking=no", "-o", "ConnectTimeout=20", SSH_HOST, remote_cmd],
        capture_output=True, text=True,
    )
    if proc.returncode != 0:
        raise SystemExit(f"ssh/remote inventory failed (rc={proc.returncode}):\n{proc.stderr[-2000:]}")
    try:
        return json.loads(proc.stdout)
    except json.JSONDecodeError as exc:
        raise SystemExit(f"remote inventory: не JSON ({exc}). stdout[:400]={proc.stdout[:400]!r}")


def index_referenced_assets() -> tuple[list[str], list[str]]:
    """(ссылки внутри public/assets, прочие локальные ссылки) из public/index.html."""
    with open(os.path.join(PUBLIC, "index.html"), "r", encoding="utf-8") as fh:
        html = fh.read()
    inside, outside = set(), set()
    for m in re.finditer(r"""<(?:script|link|img)\b[^>]*?\b(?:src|href)\s*=\s*["']([^"']+)["']""",
                         html, re.IGNORECASE):
        url = m.group(1).split("?")[0].split("#")[0]
        if re.match(r"^(https?:)?//", url) or re.match(r"^(data|mailto|tel|blob):", url):
            continue
        if url.startswith("assets/"):
            inside.add("public/" + url)
        else:
            outside.add(url)
    return sorted(inside), sorted(outside)


# ─────────────────────────── план ───────────────────────────

def build_plan() -> dict:
    local_list = local_manifest()
    remote_list = remote_manifest()
    local = {e["path"]: e for e in local_list}
    remote = {e["path"]: e for e in remote_list}

    os.makedirs(REPORT_DIR, exist_ok=True)
    with open(MANIFEST_JSON, "w", encoding="utf-8") as fh:
        json.dump({"local": local, "remote": remote}, fh, ensure_ascii=False)

    missing_on_prod, differ_local_newer, differ_prod_newer, identical, skipped_junk = [], [], [], 0, []
    for path, lo in sorted(local.items()):
        if JUNK_RE.search(path):
            skipped_junk.append(path)
            continue
        ro = remote.get(path)
        if ro is None:
            missing_on_prod.append({"path": path, "local_size": lo["size"], "kind": lo["kind"]})
            continue
        if ro["sha256"] == lo["sha256"]:
            identical += 1
            continue
        row = {
            "path": path,
            "kind": lo["kind"],
            "local_size": lo["size"],
            "prod_size": ro["size"],
            "local_mtime": lo["mtime"],
            "prod_mtime": ro["mtime"],
            "local_newer": lo["mtime"] > ro["mtime"],
        }
        (differ_local_newer if row["local_newer"] else differ_prod_newer).append(row)

    prod_only = [
        {"path": p, "prod_size": r["size"], "prod_mtime": r["mtime"]}
        for p, r in sorted(remote.items()) if p not in local
    ]

    upload = sorted({r["path"] for r in missing_on_prod} | {r["path"] for r in differ_local_newer})

    # Гейт: каждый ассет, на который ссылается index.html, должен быть на проде
    # идентичным локальному либо стоять в очереди на заливку.
    upload_set = set(upload)
    prod_paths = set(remote)
    ref_inside, ref_outside = index_referenced_assets()
    ref_problems = []
    for ref in ref_inside:
        if ref in upload_set:
            continue
        if ref not in prod_paths:
            ref_problems.append({"path": ref, "problem": "нет на проде и не в очереди"})
            continue
        if ref in local and remote[ref]["sha256"] != local[ref]["sha256"]:
            ref_problems.append({"path": ref, "problem": "расходится и не в очереди (prod-newer?)"})

    # Ссылки вне public/assets — тем же правилом, но отдельным списком: часть из них
    # может быть отдаваемым динамически (например /api/...), поэтому это не FAIL, а обзор.
    refs_outside_report = []
    for ref in ref_outside:
        norm = ref.lstrip("/")
        candidates = [norm if norm.startswith("public/") else "public/" + norm]
        covered = any(c in remote or c in local for c in candidates)
        refs_outside_report.append({"ref": ref, "covered_by_manifest": covered})

    return {
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "totals": {
            "local_files": len(local),
            "prod_files": len(remote),
            "identical": identical,
            "missing_on_prod": len(missing_on_prod),
            "differ_local_newer": len(differ_local_newer),
            "differ_prod_newer": len(differ_prod_newer),
            "prod_only": len(prod_only),
            "skipped_junk": len(skipped_junk),
            "to_upload": len(upload),
            "index_reference_problems": len(ref_problems),
        },
        "to_upload": upload,
        "missing_on_prod": missing_on_prod,
        "differ_local_newer": differ_local_newer,
        "differ_prod_newer": differ_prod_newer,
        "prod_only": prod_only,
        "skipped_junk": skipped_junk,
        "index_reference_problems": ref_problems,
        "index_refs_outside_assets": refs_outside_report,
    }


def print_plan(plan: dict) -> None:
    t = plan["totals"]
    print("=" * 78)
    print("ASSET SYNC PLAN  (%s)" % plan["generated_at"])
    print("=" * 78)
    print(f"  локальных файлов : {t['local_files']}")
    print(f"  на проде         : {t['prod_files']}")
    print(f"  идентичны (LF-norm): {t['identical']}")
    print(f"  нет на проде      : {t['missing_on_prod']}")
    print(f"  локально новее    : {t['differ_local_newer']}")
    print(f"  ПРОД НОВЕЕ (skip) : {t['differ_prod_newer']}")
    print(f"  prod-only         : {t['prod_only']}")
    print(f"  пропущено как мусор: {t['skipped_junk']}")
    print(f"  => К ЗАЛИВКЕ      : {t['to_upload']}")
    print("")

    if plan["missing_on_prod"]:
        print("--- НЕТ НА ПРОДЕ (будет залито) ---")
        for r in plan["missing_on_prod"]:
            print(f"  + {r['path']}  ({r['local_size']} B)")
        print("")

    if plan["differ_local_newer"]:
        print("--- ЛОКАЛЬНО НОВЕЕ (будет залито) ---")
        for r in plan["differ_local_newer"]:
            print(f"  ^ {r['path']}  local {r['local_size']} B @ {r['local_mtime']} vs prod {r['prod_size']} B @ {r['prod_mtime']}")
        print("")

    if plan["differ_prod_newer"]:
        print("--- ПРОД НОВЕЕ (НЕ трогаем, нужно решение) ---")
        for r in plan["differ_prod_newer"]:
            print(f"  ! {r['path']}  local {r['local_size']} B @ {r['local_mtime']} < prod {r['prod_size']} B @ {r['prod_mtime']}")
        print("")

    if plan["prod_only"]:
        print("--- ТОЛЬКО НА ПРОДЕ (не удаляем) ---")
        for r in plan["prod_only"]:
            print(f"  = {r['path']}  ({r['prod_size']} B)")
        print("")

    if plan["index_reference_problems"]:
        print("--- ПРОБЛЕМЫ index.html ---")
        for r in plan["index_reference_problems"]:
            print(f"  X {r['path']}: {r['problem']}")
        print("")
    else:
        print(f"  index.html: все ассеты на проде идентичны либо в очереди на заливку — OK")
        print("")

    outside = plan.get("index_refs_outside_assets") or []
    if outside:
        print("--- ссылки index.html вне public/assets (обзор) ---")
        for r in outside:
            mark = "покрыт" if r["covered_by_manifest"] else "ВНЕ манифеста"
            print(f"  ~ {r['ref']}  [{mark}]")
        print("")


# ─────────────────────────── заливка ───────────────────────────

def apply_plan(plan: dict) -> None:
    upload = plan["to_upload"]
    if not upload:
        print("Нечего заливать.")
        return

    # Pre-flight (D-167): оболочка обязана быть валидной, а HEAD — совпадать с проверенным
    # коммитом (или отличаться от него только не-деплойными правками). Fail-closed:
    # нет модуля/ошибка импорта → заливка НЕ идёт (L3 finding: раньше было fail-open).
    sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
    try:
        import shell_guard  # noqa: E402
    except Exception as exc:
        raise SystemExit(f"shell_guard недоступен ({exc}) — заливка без pre-flight запрещена")
    shell_guard.assert_ok(base_dir=ROOT, deploy_gate=True)
    print("pre-flight shell_guard: OK")

    os.makedirs(WORK, exist_ok=True)
    list_path = os.path.join(WORK, "upload-list.txt")
    tar_path = os.path.join(WORK, "asset-sync.tar.gz")
    with open(list_path, "w", encoding="utf-8", newline="\n") as fh:
        fh.write("\n".join(upload) + "\n")

    print(f"tar: {len(upload)} файлов -> {tar_path}")
    subprocess.run(["tar", "-czf", tar_path, "-T", list_path], cwd=ROOT, check=True)

    stamp = datetime.now().strftime("%Y%m%d-%H%M%S")
    remote_tar = f"/root/snapshots/asset-sync-{stamp}.tar.gz"
    scp = subprocess.run(
        ["scp", "-i", SSH_KEY, "-o", "StrictHostKeyChecking=no", tar_path, f"{SSH_HOST}:{remote_tar}"],
        capture_output=True, text=True,
    )
    if scp.returncode != 0:
        raise SystemExit(f"scp failed: {scp.stderr[-2000:]}")

    extract = subprocess.run(
        ["ssh", "-i", SSH_KEY, "-o", "StrictHostKeyChecking=no", SSH_HOST,
         f"cd {REMOTE_ROOT} && tar xzf {remote_tar} && echo EXTRACT_OK && rm -f {remote_tar}"],
        capture_output=True, text=True,
    )
    print(extract.stdout.strip() or extract.stderr.strip()[-2000:])
    if extract.returncode != 0 or "EXTRACT_OK" not in extract.stdout:
        raise SystemExit("extract failed on prod")
    print(f"\nЗалито на прод: {len(upload)} файлов (архив {remote_tar} удалён).")


def main() -> None:
    mode = sys.argv[1] if len(sys.argv) > 1 else "plan"
    if mode not in ("plan", "apply"):
        raise SystemExit("usage: restore_asset_sync.py [plan|apply]")

    plan = build_plan()
    os.makedirs(REPORT_DIR, exist_ok=True)
    with open(REPORT_JSON, "w", encoding="utf-8") as fh:
        json.dump(plan, fh, ensure_ascii=False, indent=2)
    print_plan(plan)
    print(f"отчёт: {os.path.relpath(REPORT_JSON, ROOT)}")

    if mode == "apply":
        apply_plan(plan)


if __name__ == "__main__":
    main()
