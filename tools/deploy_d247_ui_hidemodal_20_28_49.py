#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""D-247 + D-248 — выкатка правки модалок и восстановления кодировки.

Что везём (shell 20.28.48 → 20.28.49), 3 файла:
  * public/assets/js/ui.js     — D-247 (hideModal принимал MouseEvent вместо overlay)
                                 + D-248 (2 байта U+FFFD в statusClass);
  * public/index.html          — бамп версии оболочки (?v= и ASGARD_SHELL_VERSION);
  * public/sw.js               — бамп SHELL_VERSION.

Почему отдельный скрипт, а не D-246-dump: набор файлов другой, миграций нет.

ПОРЯДОК:
  0) pre-flight: shell_guard(--deploy-gate) + маркеры кода на диске;
  1) снапшот 3 прод-файлов (+md5) — без него выкатка не начинается;
  2) заливка через канонический `restore_asset_sync.py apply` (везёт ровно to_upload);
  3) md5-сверка local vs prod по каждому файлу;
  4) смоук с прода: /api/version, https-главная 200, `_isOverlay` в отдаваемом ui.js,
     `?v=20.28.49` / `SHELL_VERSION` в оболочке, 0 байт U+FFFD в прод-ui.js (D-248);
  5) рестарт не требуется (меняются только статические файлы) — проверяется по факту отдачи.

Любой провал ПОСЛЕ снапшота → возврат 3 файлов из снапшота + сверка md5.
Запуск: python tools/deploy_d247_ui_hidemodal_20_28_49.py
"""

from __future__ import annotations

import hashlib
import os
import subprocess
import sys
import time
from datetime import datetime
from pathlib import Path

sys.stdout.reconfigure(encoding="utf-8", errors="replace")  # type: ignore[attr-defined]


class DeployError(Exception):
    pass


ROOT = Path(__file__).resolve().parents[1]
TOOLS = ROOT / "tools"
sys.path.insert(0, str(TOOLS))

import shell_guard  # noqa: E402

VER = "20.28.49"
SSH_KEY = str(Path.home() / ".ssh" / "asgard_crm_deploy")
SSH_HOST = "root@92.242.61.184"
PROJECT = "/var/www/asgard-crm"
STAMP = datetime.now().strftime("%Y%m%d-%H%M%S")
SNAP = f"/root/snapshots/asgard-crm-pre-deploy-d247-{STAMP}.tgz"

FILES = [
    "public/assets/js/ui.js",
    "public/index.html",
    "public/sw.js",
]
SNAP_MD5: dict[str, str] = {}

# Если на диске не тот код, что проверяли гейтом, — падаем ДО заливки.
MARKERS = [
    ("public/assets/js/ui.js", "_isOverlay"),
    ("public/assets/js/ui.js", "closeBtn.addEventListener(\"click\", function(){ hideModal(overlay); })"),
    ("public/assets/js/ui.js", "отправлено на просчёт"),   # D-248: текст восстановлен
    ("public/index.html", VER),
    ("public/sw.js", VER),
]


def md5_file(path: Path) -> str:
    h = hashlib.md5()
    with path.open("rb") as fh:
        for chunk in iter(lambda: fh.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def child_env() -> dict:
    # Дочерний Python печатает в cp1251 (консоль Windows), а мы читаем как UTF-8 — кириллица
    # превращалась в мусор, и поиск «Залито на прод» в выводе restore_asset_sync падал (ложный
    # «залито не 3 файла» → откат после успешной заливки). Форсим UTF-8 у ребёнка.
    env = dict(os.environ)
    env["PYTHONIOENCODING"] = "utf-8"
    env["PYTHONUTF8"] = "1"
    return env


def run(cmd: list[str], cwd: Path | None = None, check: bool = True) -> subprocess.CompletedProcess:
    print(f"$ {' '.join(cmd[:6])}{' ...' if len(cmd) > 6 else ''}")
    p = subprocess.run(cmd, cwd=str(cwd) if cwd else None, capture_output=True, text=True,
                       encoding="utf-8", errors="replace", env=child_env())
    if p.stdout.strip():
        print(p.stdout[-8000:])
    if p.stderr.strip():
        print("STDERR:", p.stderr[-2000:])
    if check and p.returncode != 0:
        raise DeployError(f"FAIL ({p.returncode}): {' '.join(cmd[:4])}")
    return p


def ssh(remote: str) -> subprocess.CompletedProcess:
    for attempt in range(1, 5):
        p = run(["ssh", "-i", SSH_KEY, "-o", "StrictHostKeyChecking=no", "-o", "ConnectTimeout=25",
                 "-o", "ServerAliveInterval=15", "-o", "ServerAliveCountMax=4", SSH_HOST, remote],
                check=False)
        if p.returncode == 0:
            return p
        print(f"  [ssh] попытка {attempt}/4 не удалась (rc={p.returncode}), повтор...")
        time.sleep(5)
    raise DeployError(f"SSH не прошёл за 4 попытки: {remote[:80]}")


def ssh_soft(remote: str) -> subprocess.CompletedProcess:
    return run(["ssh", "-i", SSH_KEY, "-o", "StrictHostKeyChecking=no", "-o", "ConnectTimeout=25",
                "-o", "ServerAliveInterval=15", SSH_HOST, remote], check=False)


def make_snapshot() -> None:
    print("\n=== 1. SNAPSHOT ===")
    for rel in FILES:
        if "PRESENT" not in (ssh(f"test -f {PROJECT}/{rel} && echo PRESENT || echo MISSING").stdout or ""):
            raise DeployError(f"на проде нет файла {rel} — снапшот был бы неполным")
    ssh(f"mkdir -p /root/snapshots && tar -C {PROJECT} -czf {SNAP} " + " ".join(FILES))
    listing = ssh(f"tar -tzf {SNAP}").stdout or ""
    missing = [rel for rel in FILES if rel not in listing]
    if missing:
        raise DeployError(f"в снапшоте нет {missing} — откат был бы частичным")
    for rel in FILES:
        val = ((ssh(f"md5sum {PROJECT}/{rel}").stdout or "").split() or [""])[0]
        if len(val) != 32:
            raise DeployError(f"не снял md5 прод-файла {rel} — откат нечем подтвердить")
        SNAP_MD5[rel] = val
    print(f"снапшот: {SNAP} — {len(FILES)} файлов, md5 снят ({len(SNAP_MD5)})")
    print((ssh(f"ls -lh {SNAP}").stdout or "").strip())


def upload() -> None:
    print("\n=== 2. ЗАЛИВКА (restore_asset_sync apply) ===")
    p = run([sys.executable, str(TOOLS / "restore_asset_sync.py"), "apply"], cwd=ROOT, check=False)
    if p.returncode != 0:
        raise DeployError("restore_asset_sync apply завершился с ошибкой")
    m = None
    for line in (p.stdout or "").splitlines():
        if "Залито на прод" in line:
            m = line.strip()
    if not m or f" {len(FILES)} " not in m:
        raise DeployError(f"залито не {len(FILES)} файл(ов): {m!r}")


def verify() -> None:
    print("\n=== 3. MD5-СВЕРКА local vs prod ===")
    bad = []
    for rel in FILES:
        local = md5_file(ROOT / rel)
        remote = ((ssh(f"md5sum {PROJECT}/{rel}").stdout or "").split() or ["?"])[0]
        ok = remote == local
        print(f"  {'OK  ' if ok else 'FAIL'} {rel}  local={local} prod={remote}")
        if not ok:
            bad.append(rel)
    if bad:
        raise DeployError(f"md5 не совпал после заливки: {bad}")


def smoke() -> None:
    print("\n=== 4. SMOKE (с прода) ===")
    out = (ssh("curl -s http://127.0.0.1:3000/api/version; echo; "
               "curl -s -o /dev/null -w 'home:%{http_code}\\n' https://asgard-crm.ru/").stdout or "")
    print(out.strip())
    if VER not in out:
        raise DeployError(f"/api/version не содержит {VER}")
    if "home:200" not in out:
        raise DeployError("главная не отдаёт 200")

    # Отдаваемый ui.js реально несёт правку D-247 (не только файл на диске).
    served = ssh_soft(f"curl -s 'https://asgard-crm.ru/assets/js/ui.js?v={VER}' | grep -c '_isOverlay'")
    n = (served.stdout or "0").strip().splitlines()[-1] if (served.stdout or "").strip() else "0"
    print(f"  {'OK  ' if n not in ('', '0') else 'FAIL'} отдаваемый ui.js :: _isOverlay = {n}")
    if n in ("", "0"):
        raise DeployError("в отдаваемом ui.js нет _isOverlay")

    # D-248 на проде: 0 байт U+FFFD.
    ffd = ssh_soft(f"grep -o -a -P '\\xef\\xbf\\xbd' {PROJECT}/public/assets/js/ui.js | wc -l")
    cnt = (ffd.stdout or "?").strip().splitlines()[-1] if (ffd.stdout or "").strip() else "?"
    print(f"  {'OK  ' if cnt == '0' else 'FAIL'} прод ui.js :: U+FFFD = {cnt}")
    if cnt != "0":
        raise DeployError(f"на проде ui.js всё ещё содержит U+FFFD: {cnt}")

    # Оболочка на проде.
    for rel, needle in [("public/index.html", f"?v={VER}"),
                        ("public/index.html", f"ASGARD_SHELL_VERSION = '{VER}'"),
                        ("public/sw.js", f"SHELL_VERSION = '{VER}'")]:
        res = ssh(f"grep -c {needle!r} {PROJECT}/{rel}")
        c = (res.stdout or "0").strip().splitlines()[-1] if (res.stdout or "").strip() else "0"
        print(f"  {'OK  ' if c not in ('', '0') else 'FAIL'} {rel} :: {needle} = {c}")
        if c in ("", "0"):
            raise DeployError(f"смоук: маркер не найден на проде: {rel} :: {needle}")


def rollback(reason: str) -> None:
    print("\n" + "!" * 78)
    print(f"! ОТКАТ: {reason}")
    print("!" * 78)
    try_ssh(f"tar -C {PROJECT} -xzf {SNAP}")
    mismatch = []
    for rel, want in SNAP_MD5.items():
        got = ((try_ssh(f"md5sum {PROJECT}/{rel}").split() or ["?"])[0])
        if got != want:
            mismatch.append(f"{rel}: снапшот {want}, прод {got}")
    if mismatch:
        print("!!! ОТКАТ НЕ ПОДТВЕРЖДЁН — ручной разбор: " + SNAP)
        for m in mismatch[:20]:
            print("    · " + m)
        raise SystemExit(f"ДЕПЛОЙ ПРЕРВАН, ОТКАТ НЕ ПОДТВЕРЖДЁН: {reason}")
    print(f"ОТКАТ ПОДТВЕРЖДЁН: {len(SNAP_MD5)}/{len(SNAP_MD5)} файлов вернулись на прод.")
    raise SystemExit(f"ДЕПЛОЙ ПРЕРВАН И ОТКАЧЕН: {reason}")


def try_ssh(cmd: str) -> str:
    try:
        return ssh(cmd).stdout or ""
    except DeployError as exc:
        print(f"  [откат] ssh не прошёл: {exc}")
        return ""


def main() -> None:
    print("=" * 78)
    print(f"DEPLOY D-247/D-248 «модалки + кодировка» — shell {VER}")
    print("=" * 78)

    print("\n=== 0. PRE-FLIGHT ===")
    shell_guard.assert_ok(base_dir=str(ROOT), expect_version=VER, deploy_gate=True)
    print("shell_guard: OK (оболочка валидна, HEAD == .last-verified или дельта не-деплойная)")

    missing = [f for f in FILES if not (ROOT / f).is_file()]
    if missing:
        raise SystemExit(f"нет файлов: {missing}")
    for rel, needle in MARKERS:
        if needle not in (ROOT / rel).read_text(encoding="utf-8"):
            raise SystemExit(f"маркер отсутствует: {rel} :: {needle}")
    print(f"маркеры: OK ({len(MARKERS)}/{len(MARKERS)}); файлов к заливке: {len(FILES)}")
    for f in FILES:
        print(f"   ~ {f}")

    snapshot_done = False
    try:
        make_snapshot()
        snapshot_done = True
        upload()
        verify()
        smoke()
    except DeployError as exc:
        if snapshot_done:
            rollback(f"аварийное завершение выкатки: {exc}")
        raise
    except Exception as exc:
        if snapshot_done:
            rollback(f"непредвиденный сбой выкатки: {exc!r}")
        raise

    print("\n=== DEPLOY DONE ===")
    print(f"shell {VER}; снапшот: {SNAP}")
    print("Дальше (post-deploy, порядок D-166):")
    print("  python tools/restore_asset_sync.py plan")
    print("  node tools/audit_silent_reverts.js --post-deploy")


if __name__ == "__main__":
    main()
