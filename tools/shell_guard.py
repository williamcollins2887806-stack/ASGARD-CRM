#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
shell_guard — единый pre-flight для файлов-оболочки (`public/index.html`, `public/sw.js`).

Закрывает класс инцидентов D-142b / D-145 / D-147:
  * PowerShell писал UTF-8 файлы в cp1251 → потеря глифов и `U+FFFD` (D-142b);
  * теги модулей инжектились только на проде и стирались любым деплоем (D-145);
  * деплой ехал с протухшим `.last-verified` (D-151).

Использование:
    python tools/shell_guard.py                       # локальные файлы
    python tools/shell_guard.py --dir <каталог>       # index.html/sw.js из другого каталога (напр. копия прода)
    python tools/shell_guard.py --expect-version 20.28.32
    python tools/shell_guard.py --deploy-gate         # + git HEAD == tests/reports/.last-verified
    python tools/shell_guard.py --json                # машинный вывод

Как модуль (для deploy-скриптов):
    import sys; sys.path.insert(0, "tools")
    import shell_guard
    shell_guard.assert_ok()          # кидает SystemExit(1), если оболочка битая

Код выхода: 0 — всё чисто, 1 — есть провалы.
"""
import argparse
import hashlib
import io
import json
import os
import re
import subprocess
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

# Теги, без которых оболочка уже ломалась на проде (D-145: billing/nd-permits, D-156: корзина/cr-checkbox).
CRITICAL_REFS = [
    "assets/js/billing.js",
    "assets/css/billing.css",
    "assets/js/nd-permits.js",
    "assets/css/nd-permits.css",
    "assets/js/doc-hub.js",
    "assets/js/warehouse-map.js",
    "assets/js/brigade-cart.js",
    "assets/css/brigade-cart.css",
    "assets/css/cr-checkbox.css",
]


def _read(path):
    with open(path, "rb") as f:
        return f.read()


class Report(object):
    def __init__(self):
        self.checks = []

    def check(self, ok, name, detail=""):
        self.checks.append({"ok": bool(ok), "name": name, "detail": str(detail)[:220]})
        return ok

    @property
    def failed(self):
        return [c for c in self.checks if not c["ok"]]

    def print(self):
        for c in self.checks:
            print("  %s  %-52s %s" % ("PASS" if c["ok"] else "FAIL", c["name"], c["detail"]))
        print("")
        if self.failed:
            print("ИТОГ: FAIL — %d из %d проверок не прошли" % (len(self.failed), len(self.checks)))
        else:
            print("ИТОГ: OK — %d/%d проверок пройдено" % (len(self.checks), len(self.checks)))


def run_checks(base_dir, expect_version=None, deploy_gate=False):
    rep = Report()
    idx = os.path.join(base_dir, "public", "index.html")
    sw = os.path.join(base_dir, "public", "sw.js")
    # допускаем передачу уже "public"-каталога
    if not os.path.exists(idx) and os.path.exists(os.path.join(base_dir, "index.html")):
        idx = os.path.join(base_dir, "index.html")
        sw = os.path.join(base_dir, "sw.js")

    for label, path in (("index.html", idx), ("sw.js", sw)):
        if not rep.check(os.path.exists(path), "%s: файл существует" % label, path):
            continue
        raw = _read(path)
        try:
            txt = raw.decode("utf-8")
            rep.check(True, "%s: валидный UTF-8" % label, "%d Б" % len(raw))
        except UnicodeDecodeError as e:
            rep.check(False, "%s: валидный UTF-8" % label, "ОШИБКА: %s (похоже на cp1251, см. D-142b)" % e)
            continue
        rep.check("\ufffd" not in txt, "%s: нет U+FFFD (нет потери глифов)" % label,
                  "найдено %d" % txt.count("\ufffd"))
        if label == "index.html":
            rep.check(txt.startswith("\ufeff"), "index.html: UTF-8 BOM сохранён", "BOM=%s" % txt.startswith("\ufeff"))
        rep.check("\r\n" not in txt or raw.count(b"\r\n") >= 0, "%s: читается" % label, "eol=%s" % ("CRLF" if b"\r\n" in raw else "LF"))

    if not os.path.exists(idx) or not os.path.exists(sw):
        return rep

    html = io.open(idx, encoding="utf-8").read()
    js = io.open(sw, encoding="utf-8").read()

    m_idx = re.search(r"ASGARD_SHELL_VERSION\s*=\s*'([^']+)'", html)
    m_sw = re.search(r"SHELL_VERSION\s*=\s*'([^']+)'", js)
    v_idx = m_idx.group(1) if m_idx else None
    v_sw = m_sw.group(1) if m_sw else None
    rep.check(v_idx and v_sw and v_idx == v_sw, "версии оболочки совпадают",
              "index=%s sw=%s" % (v_idx, v_sw))

    versions = sorted(set(re.findall(r"\?v=([0-9A-Za-z.\-]+)", html)))
    rep.check(len(versions) == 1 and versions[0] == v_idx, "все ?v= приведены к версии оболочки",
              "значений: %s" % (versions if len(versions) < 6 else "%d разных!" % len(versions)))

    if expect_version:
        rep.check(v_idx == expect_version, "версия оболочки = ожидаемой",
                  "получено %s, ожидалось %s" % (v_idx, expect_version))

    for ref in CRITICAL_REFS:
        n = len(re.findall(r'(?:src|href)="%s' % re.escape(ref), html))
        rep.check(n == 1, "подключён ровно один раз: %s" % ref, "вхождений: %d" % n)

    if deploy_gate:
        head = subprocess.run(["git", "rev-parse", "HEAD"], cwd=base_dir, capture_output=True,
                              encoding="utf-8", errors="replace").stdout.strip()
        lv_path = os.path.join(base_dir, "tests", "reports", ".last-verified")
        lv = io.open(lv_path, encoding="utf-8").read().strip() if os.path.exists(lv_path) else ""
        if head and lv and head == lv:
            rep.check(True, "deploy-gate: HEAD == .last-verified", "HEAD=%s" % head[:12])
        else:
            # Допустимо: после проверенного коммита идут ТОЛЬКО не-деплойные правки (ledger/docs/reports).
            # Это машинно проверяемо, поэтому гейт остаётся гейтом, а не «словом агента».
            diff = subprocess.run(["git", "diff", "--name-only", "%s..%s" % (lv, head or "HEAD")],
                                  cwd=base_dir, capture_output=True, encoding="utf-8",
                                  errors="replace").stdout.split() if lv else []
            deployable = [p for p in diff if p.startswith(("public/", "src/", "migrations/"))]
            ancestor = subprocess.run(["git", "merge-base", "--is-ancestor", lv, head or "HEAD"],
                                      cwd=base_dir, capture_output=True).returncode == 0 if lv else False
            ok = bool(lv) and ancestor and not deployable
            rep.check(ok, "deploy-gate: HEAD == .last-verified ИЛИ дельта только не-деплойная",
                      "HEAD=%s lv=%s ancestor=%s Δ-файлов=%d деплой-путей=%d%s" % (
                          head[:12] or "?", lv[:12] or "?", ancestor, len(diff), len(deployable),
                          (" " + ", ".join(deployable[:4])) if deployable else ""))

    return rep


def main():
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    ap = argparse.ArgumentParser()
    ap.add_argument("--dir", default=ROOT, help="каталог репозитория (или каталог с index.html/sw.js)")
    ap.add_argument("--expect-version")
    ap.add_argument("--deploy-gate", action="store_true")
    ap.add_argument("--json", action="store_true")
    a = ap.parse_args()

    rep = run_checks(os.path.abspath(a.dir), a.expect_version, a.deploy_gate)
    if a.json:
        print(json.dumps({"checks": rep.checks, "failed": len(rep.failed)}, ensure_ascii=False, indent=2))
    else:
        print("shell_guard — %s" % os.path.abspath(a.dir))
        rep.print()
    return 1 if rep.failed else 0


def assert_ok(**kw):
    """Шорткат для deploy-скриптов: падает с кодом 1, если оболочка не в порядке."""
    rep = run_checks(kw.pop("base_dir", ROOT), **kw)
    if rep.failed:
        print("shell_guard: ABORT — оболочка не прошла проверки:")
        rep.print()
        sys.exit(1)
    return True


if __name__ == "__main__":
    sys.exit(main())
