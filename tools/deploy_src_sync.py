#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Заливка серверных файлов (src/) на прод — только то, что разошлось.

ЗАЧЕМ. `restore_asset_sync.py` везёт ТОЛЬКО `public/`. Когда в коммите
появляется новый файл в `src/` (например `src/services/invoice-items-check.js`,
11.11.2026), он остаётся дома, а код, который его требует, на проде уже
есть — приложение падает на старте с Cannot find module.

Порядок безопасной выкатки:
    1. python tools/verify_src_sync.py        # увидеть, чего не хватает
    2. python tools/deploy_src_sync.py --dry  # показать план
    3. python tools/deploy_src_sync.py        # залить (снапшот снимается сам)
    4. systemctl restart asgard-crm           # на сервере

Запуск:
    python tools/deploy_src_sync.py --dry     # только план
    python tools/deploy_src_sync.py           # залить

Выход: 0 — ок, 1 — ошибка.
"""
from __future__ import annotations

import argparse
import hashlib
import subprocess
import sys
import tarfile
import tempfile
import time
from datetime import datetime
from pathlib import Path

sys.stdout.reconfigure(encoding="utf-8", errors="replace")

ROOT = Path(__file__).resolve().parents[1]
SRC = ROOT / "src"
REMOTE = "/var/www/asgard-crm"
WORK = "/tmp/src-sync-deploy"

SSH_KEY = str(Path.home() / ".ssh" / "asgard_crm_deploy")
SSH_HOST = "root@92.242.61.184"
STAMP = datetime.now().strftime("%Y%m%d-%H%M%S")

# Скрипт считает md5 файлов из списка. Файлом, а не argv: 533 пути не влезают.
REMOTE_MD5_SCRIPT = r"""#!/bin/sh
set -u
LIST="${1:?list}"
cd /var/www/asgard-crm || { echo "REMOTE_FAIL cd"; exit 1; }
while IFS= read -r f; do
  [ -n "$f" ] || continue
  [ -f "$f" ] || continue
  printf '%s  %s\n' "$(md5sum "$f" | cut -d' ' -f1)" "$f"
done < "$LIST"
echo "REMOTE_DONE"
"""


def _run(args: list[str], timeout: int = 300, attempts: int = 5) -> subprocess.CompletedProcess:
    last = None
    for i in range(attempts):
        last = subprocess.run(
            args, capture_output=True, text=True,
            encoding="utf-8", errors="replace", timeout=timeout,
        )
        if last.returncode == 0:
            return last
        if i < attempts - 1:
            time.sleep(5 + i * 5)
    return last


def _ssh(cmd: str, timeout: int = 600, attempts: int = 5) -> subprocess.CompletedProcess:
    return _run(
        ["ssh", "-i", SSH_KEY, "-o", "StrictHostKeyChecking=no",
         "-o", "ConnectTimeout=25", "-o", "ServerAliveInterval=5", SSH_HOST, cmd],
        timeout=timeout, attempts=attempts,
    )


def _scp(local: str, remote: str, timeout: int = 600,
         attempts: int = 5) -> subprocess.CompletedProcess:
    return _run(
        ["scp", "-i", SSH_KEY, "-o", "StrictHostKeyChecking=no",
         "-o", "ConnectTimeout=25", local, f"{SSH_HOST}:{remote}"],
        timeout=timeout, attempts=attempts,
    )


def md5_local(path: Path) -> str:
    return hashlib.md5(path.read_bytes()).hexdigest()


def remote_md5(rel: list[str]) -> dict[str, str]:
    with tempfile.TemporaryDirectory() as tmp:
        script_path = Path(tmp) / "md5.sh"
        script_path.write_text(REMOTE_MD5_SCRIPT, encoding="utf-8", newline="\n")
        list_path = Path(tmp) / "list.txt"
        list_path.write_text("\n".join(rel) + "\n", encoding="utf-8", newline="\n")

        mk = _ssh(f"mkdir -p {WORK}")
        if mk.returncode != 0:
            return {}
        for src, dst in ((str(script_path), f"{WORK}/md5.sh"),
                         (str(list_path), f"{WORK}/list.txt")):
            if _scp(src, dst).returncode != 0:
                return {}
        proc = _ssh(f"sh {WORK}/md5.sh {WORK}/list.txt")

    if "REMOTE_DONE" not in (proc.stdout or ""):
        print(f"  ssh: {(proc.stderr or proc.stdout or '')[:200]}")
        return {}

    out: dict[str, str] = {}
    for line in proc.stdout.splitlines():
        parts = line.split("  ", 1)
        if len(parts) != 2:
            continue
        digest, relpath = parts[0].strip(), parts[1].strip()
        if len(digest) == 32:
            out[relpath] = digest
    return out


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--dry", action="store_true", help="только показать план")
    args = ap.parse_args()

    files = sorted(SRC.rglob("*.js"))
    rel = [str(p.relative_to(ROOT)).replace("\\", "/") for p in files]
    print(f"локальных файлов src: {len(rel)}")

    prod = remote_md5(rel)
    if not prod:
        print("FAIL: не удалось получить md5 с прода.")
        print("      Канал ssh нестабилен или неверный ключ. Повторите запуск.")
        return 1

    to_upload: list[Path] = []
    missing: list[str] = []
    changed: list[str] = []
    for path, relpath in zip(files, rel):
        digest = prod.get(relpath)
        if digest is None:
            missing.append(relpath)
            to_upload.append(path)
        elif digest != md5_local(path):
            changed.append(relpath)
            to_upload.append(path)

    print(f"на проде отсутствуют: {len(missing)}")
    for item in missing[:20]:
        print(f"  + {item}")
    print(f"расходятся по содержимому: {len(changed)}")
    for item in changed[:20]:
        print(f"  ~ {item}")

    if not to_upload:
        print("\nвсё совпадает — заливать нечего")
        print("SRC_DEPLOY_OK")
        return 0

    if args.dry:
        print(f"\nDRY: залил бы {len(to_upload)} файлов")
        print("SRC_DEPLOY_DRY")
        return 0

    snapshot = f"/root/snapshots/src-sync-{STAMP}.tar.gz"
    existing = "\n".join(r for r in rel if r in prod) + "\n"
    if existing.strip():
        with tempfile.TemporaryDirectory() as tmp:
            list_path = Path(tmp) / "snap.txt"
            list_path.write_text(existing, encoding="utf-8", newline="\n")
            if _scp(str(list_path), f"{WORK}/snap.txt").returncode != 0:
                print("FAIL: не удалось передать список для снапшота")
                return 1
            proc = _ssh(
                f"cd {REMOTE} && tr -d '\\r' < {WORK}/snap.txt | tar czf {snapshot} -T - "
                f"2>/dev/null && echo SNAP_OK"
            )
        if "SNAP_OK" not in (proc.stdout or ""):
            print("FAIL: снапшот не снялся, заливка отменена")
            return 1
        print(f"снапшот: {snapshot}")
    else:
        print("снапшот не нужен: все файлы новые")

    with tempfile.TemporaryDirectory() as tmp:
        tar_path = Path(tmp) / "src.tar.gz"
        with tarfile.open(tar_path, "w:gz") as tf:
            for path in to_upload:
                tf.add(path, arcname=str(path.relative_to(ROOT)).replace("\\", "/"))
        size_kb = tar_path.stat().st_size // 1024
        print(f"архив: {len(to_upload)} файлов, {size_kb} КБ")
        if _scp(str(tar_path), f"{WORK}/src.tar.gz").returncode != 0:
            print("FAIL scp архива")
            return 1

    proc = _ssh(
        f"cd {REMOTE} && tar xzf {WORK}/src.tar.gz && rm -f {WORK}/src.tar.gz"
        " && chown -R asgard:asgard src 2>/dev/null; echo EXTRACT_OK"
    )
    if "EXTRACT_OK" not in (proc.stdout or ""):
        print(f"FAIL распаковка: {(proc.stderr or '')[:300]}")
        return 1

    print(f"\nзалито файлов: {len(to_upload)}")
    print("дальше: systemctl restart asgard-crm")
    print("SRC_DEPLOY_OK")
    return 0


if __name__ == "__main__":
    sys.exit(main())
