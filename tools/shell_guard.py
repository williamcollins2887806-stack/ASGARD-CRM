#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
shell_guard — единый pre-flight для файлов-оболочки (`public/index.html`, `public/sw.js`).

Закрывает класс инцидентов D-142b / D-145 / D-147 / D-151 / D-156:
  * PowerShell писал UTF-8 файлы в cp1251 → потеря глифов и `U+FFFD` (D-142b);
  * теги модулей жили только на проде и стирались любым деплоем (D-145, D-156);
  * деплой ехал с протухшим `.last-verified` (D-151);
  * оболочка «всё пропало» = файл есть, но усечён/пуст (нечем доказать — этот гейт).

Использование:
    python tools/shell_guard.py                       # локальные файлы
    python tools/shell_guard.py --dir <каталог>       # index.html/sw.js из другого каталога
    python tools/shell_guard.py --expect-version 20.28.32
    python tools/shell_guard.py --deploy-gate         # + HEAD vs .last-verified
    python tools/shell_guard.py --json                # машинный вывод

Как модуль (для deploy-скриптов):
    import sys; sys.path.insert(0, "tools")
    import shell_guard
    shell_guard.assert_ok()          # SystemExit(1), если оболочка битая

Код выхода: 0 — всё чисто, 1 — есть провалы.

Границы (проверено независимым верификатором, D-167): гейт НЕ проверяет содержимое/хеши самих
ассетов и не заменяет `verify_index_tags.js` (он проверяет полноту подключений и JS-глобалы).
Задача shell_guard — целостность двух shell-файлов и версия, а не паритет ассетов.
"""
import argparse
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

# Минимальный «разумный» размер: усечённая/пустая оболочка = инцидент «всё пропало».
MIN_SIZE = {"index.html": 20000, "sw.js": 5000}

# Класс D-142b: UTF-8, прочитанный/записанный как cp866. Файл валиден (U+FFFD нет!),
# но русский текст превращается в «╨Ч╨░╨║╨░╨╖». Одиночные ─ ═ ║ ╔ ╗ ╚ ╝ ╠ ╣ ╦ ╧ ╪ ╫ ╬
# — законные символы рамок в шапках файлов, поэтому требуем, чтобы ╨/╤/╥ стояли
# ВПЛОТНУЮ к русской букве. Плюс типографские артефакты «тАФ» / «тАУ».
MOJIBAKE_RE = re.compile(
    "[\u2568\u2564\u2565][\u0400-\u04FF]"
    "|\u0442\u0410\u0424|\u0442\u0410\u0423"
    "|\u252C\u043B|\u252C\u2557"
)
# Что вообще может попасть на прод и быть прочитано браузером/сервером.
MOJIBAKE_EXT = (".css", ".js", ".jsx", ".html", ".json", ".sql", ".svg")
# Каталоги, которые заведомо не наши (сборки/зависимости) — их не сканируем даже в --mojibake-all.
MOJIBAKE_SKIP_DIRS = {"node_modules", ".git", "vendor", "dist", "build", "coverage", "__pycache__"}

# Корневые файлы, которые тоже едут на прод: правка после подписи обязана блокировать деплой.
DEPLOY_ROOT_FILES = {
    "package.json", "package-lock.json", "Dockerfile", "nginx.conf", "_migrate.js",
    "update_server.sh", "sync-vault.js", "ecosystem.config.js", ".env", ".env.example",
}
DEPLOY_DIR_PREFIXES = ("public/", "src/", "migrations/")


def _read(path):
    with open(path, "rb") as f:
        return f.read()


class Report(object):
    def __init__(self):
        self.checks = []

    def check(self, ok, name, detail=""):
        self.checks.append({"ok": bool(ok), "name": name, "detail": str(detail)[:240]})
        return bool(ok)

    def info(self, name, detail=""):
        """Не проверка, а пояснение (не влияет на итог) — чтобы «пропущено» было видно, а не молчало."""
        self.checks.append({"ok": None, "name": name, "detail": str(detail)[:240]})

    @property
    def failed(self):
        return [c for c in self.checks if c["ok"] is False]

    @property
    def total(self):
        return len([c for c in self.checks if c["ok"] is not None])

    def print(self):
        for c in self.checks:
            mark = "PASS" if c["ok"] else ("SKIP" if c["ok"] is None else "FAIL")
            print("  %-4s %-56s %s" % (mark, c["name"], c["detail"]))
        print("")
        if self.failed:
            print("ИТОГ: FAIL — %d из %d проверок не прошли" % (len(self.failed), self.total))
        else:
            print("ИТОГ: OK — %d/%d проверок пройдено" % (self.total, self.total))


def _resolve(base_dir):
    idx = os.path.join(base_dir, "public", "index.html")
    sw = os.path.join(base_dir, "public", "sw.js")
    if not os.path.exists(idx) and os.path.exists(os.path.join(base_dir, "index.html")):
        idx = os.path.join(base_dir, "index.html")
        sw = os.path.join(base_dir, "sw.js")
    return idx, sw


def _mojibake_in(path):
    """Сколько участков двойной перекодировки в файле. None — если файл не читается."""
    try:
        with open(path, "rb") as f:
            txt = f.read().decode("utf-8", errors="replace")
    except OSError:
        return None
    return len(MOJIBAKE_RE.findall(txt))


def _deployable_files(base_dir):
    """Файлы, которые реально поедут на прод при деплое (для pre-deploy проверки кодировки).

    Берём git-декомпозицию: изменённые/добавленные в рабочем дереве + в дельте от
    .last-verified. Так гейт не сканирует весь репозиторий (29 с) и при этом ловит
    именно то, что вот-вот уедет.
    """
    paths = set()
    for args in (["diff", "--name-only", "HEAD"], ["diff", "--name-only", "--cached"],
                 ["ls-files", "--others", "--exclude-standard"]):
        r = subprocess.run(["git"] + args, cwd=base_dir, capture_output=True, encoding="utf-8",
                           errors="replace")
        if r.returncode == 0:
            paths.update(p for p in r.stdout.split() if p)
    # Не git-дерево (например, копия оболочки на сервере) — проверяем то, что рядом.
    if not paths:
        return _all_scannable_files(base_dir)
    out = []
    for p in sorted(paths):
        if not p.endswith(MOJIBAKE_EXT):
            continue
        if any(part in MOJIBAKE_SKIP_DIRS for part in p.split("/")):
            continue
        full = os.path.join(base_dir, p)
        if os.path.isfile(full):
            out.append((p, full))
    return out


def _all_scannable_files(base_dir):
    """Полный скан дерева (медленнее) — для аудита после инцидента."""
    out = []
    for top in ("public", "src", "templates"):
        root = os.path.join(base_dir, top)
        if not os.path.isdir(root):
            continue
        for dirpath, dirnames, filenames in os.walk(root):
            dirnames[:] = [d for d in dirnames if d not in MOJIBAKE_SKIP_DIRS]
            for fn in filenames:
                if not fn.endswith(MOJIBAKE_EXT):
                    continue
                full = os.path.join(dirpath, fn)
                out.append((os.path.relpath(full, base_dir).replace("\\", "/"), full))
    return out


def _check_mojibake(rep, base_dir, all_files=False, limit=8):
    """Класс D-142b: валидный UTF-8, но русский текст испорчен двойной перекодировкой.

    Обычная проверка «нет U+FFFD» этот дефект НЕ видит — поэтому нужен отдельный детектор.
    """
    label = "вся кодовая база" if all_files else "файлы к деплою"
    targets = _all_scannable_files(base_dir) if all_files else _deployable_files(base_dir)
    if not targets:
        rep.info("mojibake: нет двойной перекодировки (%s)" % label,
                 "SKIP: нечего проверять (нет изменённых файлов)")
        return
    dirty = []
    for rel, full in targets:
        n = _mojibake_in(full)
        if n:
            dirty.append((rel, n))
    sample = ", ".join("%s (%d)" % (p, n) for p, n in dirty[:limit])
    rep.check(not dirty, "mojibake: нет двойной перекодировки (%s)" % label,
              "чисто: %d файлов" % len(targets) if not dirty
              else "ИСПОРЧЕНО %d из %d: %s%s" % (
                  len(dirty), len(targets), sample, " …" if len(dirty) > limit else ""))


def _check_shell_file(rep, label, path):
    """Целостность одного shell-файла. Возвращает (текст, причина_отказа)."""
    if not rep.check(os.path.exists(path), "%s: файл существует" % label, path):
        return None, "отсутствует %s" % label
    raw = _read(path)
    try:
        txt = raw.decode("utf-8")
    except UnicodeDecodeError as e:
        rep.check(False, "%s: валидный UTF-8" % label,
                  "ОШИБКА: %s (похоже на cp1251 — класс D-142b)" % e)
        return None, "%s не читается как UTF-8" % label
    rep.check(True, "%s: валидный UTF-8" % label,
              "%d Б, переводы строк %s" % (len(raw), "CRLF" if b"\r\n" in raw else "LF"))
    rep.check("\ufffd" not in txt, "%s: нет U+FFFD (нет потери глифов)" % label,
              "найдено %d" % txt.count("\ufffd"))
    floor = MIN_SIZE.get(label, 1000)
    rep.check(len(raw) >= floor, "%s: размер >= %d Б (не усечён/не пуст)" % (label, floor),
              "%d Б" % len(raw))
    if label == "index.html":
        rep.check(txt.startswith("\ufeff"), "index.html: UTF-8 BOM сохранён",
                  "BOM=%s" % txt.startswith("\ufeff"))
        body = txt.rstrip()
        rep.check(body.endswith("</html>"), "index.html: документ не обрезан (заканчивается </html>)",
                  "хвост: %r" % body[-24:])
        rep.check('src="assets/js/app.js' in txt, "index.html: точка входа app.js подключена",
                  "вхождений: %d" % txt.count('src="assets/js/app.js'))
        rep.check("ASGARD_SHELL_VERSION" in txt, "index.html: объявлен ASGARD_SHELL_VERSION",
                  "вхождений: %d" % txt.count("ASGARD_SHELL_VERSION"))
    else:
        rep.check("addEventListener('install'" in txt or 'addEventListener("install"' in txt,
                  "sw.js: это реальный service worker (есть install-хендлер)",
                  "вхождений caches: %d" % txt.count("caches"))
        rep.check(bool(re.search(r"const\s+SHELL_VERSION\s*=\s*'[^']+'", txt)),
                  "sw.js: объявление const SHELL_VERSION = '<ver>'",
                  "вхождений SHELL_VERSION: %d" % txt.count("SHELL_VERSION"))
    return txt, None


def run_checks(base_dir, expect_version=None, deploy_gate=False, mojibake_all=False):
    rep = Report()
    idx, sw = _resolve(os.path.abspath(base_dir))

    html, idx_reason = _check_shell_file(rep, "index.html", idx)
    js, sw_reason = _check_shell_file(rep, "sw.js", sw)

    # D-142b: сам shell-файл тоже мог быть перекодирован (в нём русские title/aria).
    for _lbl, _p in (("index.html", idx), ("sw.js", sw)):
        if os.path.exists(_p):
            _n = _mojibake_in(_p) or 0
            rep.check(_n == 0, "%s: нет двойной перекодировки (mojibake)" % _lbl,
                      "ИСПОРЧЕНО участков: %d — класс D-142b" % _n if _n else "чисто")

    # То же для файлов, которые вот-вот поедут на прод.
    _check_mojibake(rep, base_dir, all_files=mojibake_all)

    # Версии проверяются даже если один из файлов отсутствует — иначе негативный контроль
    # краснеет «не по той причине» (находка L3 F-4).
    if html is None or js is None:
        why = idx_reason or sw_reason
        rep.check(False, "версии оболочки совпадают", "НЕ ПРОВЕРЕНО: %s" % why)
        rep.check(False, "все ?v= приведены к версии оболочки", "НЕ ПРОВЕРЕНО: %s" % why)
        if expect_version:
            rep.check(False, "версия оболочки = ожидаемой", "НЕ ПРОВЕРЕНО: %s" % why)
        return rep

    m_idx = re.search(r"ASGARD_SHELL_VERSION\s*=\s*'([^']+)'", html)
    m_sw = re.search(r"SHELL_VERSION\s*=\s*'([^']+)'", js)
    v_idx = m_idx.group(1) if m_idx else None
    v_sw = m_sw.group(1) if m_sw else None
    rep.check(bool(v_idx) and bool(v_sw) and v_idx == v_sw, "версии оболочки совпадают",
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
        if n == 1:
            tagged = re.search(r'(?:src|href)="%s\?v=([0-9A-Za-z.\-]+)"' % re.escape(ref), html)
            rep.check(bool(tagged) and (tagged.group(1) == v_idx),
                      "  └ ?v= у %s" % ref,
                      "v=%s" % (tagged.group(1) if tagged else "нет"))

    # Существование ассетов проверяем только там, где каталог ассетов реально есть
    # (на копии «только index.html + sw.js» это не проверить — сообщаем, а не молчим).
    assets_dir = os.path.join(os.path.dirname(idx), "assets")
    if os.path.isdir(assets_dir):
        missing_assets = [r for r in CRITICAL_REFS if not os.path.exists(os.path.join(os.path.dirname(idx), r))]
        rep.check(not missing_assets, "все критические ассеты есть на диске",
                  "отсутствуют: %s" % (", ".join(missing_assets) if missing_assets else "нет"))
    else:
        rep.info("все критические ассеты есть на диске",
                 "SKIP: нет каталога %s (проверяется только в дереве репозитория)" % assets_dir)

    if deploy_gate:
        head = subprocess.run(["git", "rev-parse", "HEAD"], cwd=base_dir, capture_output=True,
                              encoding="utf-8", errors="replace").stdout.strip()
        lv_path = os.path.join(base_dir, "tests", "reports", ".last-verified")
        lv = io.open(lv_path, encoding="utf-8").read().strip() if os.path.exists(lv_path) else ""
        if head and lv and head == lv:
            rep.check(True, "deploy-gate: HEAD == .last-verified", "HEAD=%s" % head[:12])
        else:
            # Допустимо: после проверенного коммита идут ТОЛЬКО не-деплойные правки (ledger/docs/reports).
            # Машинно проверяемо — поэтому гейт остаётся гейтом, а не «словом агента».
            diff = subprocess.run(["git", "diff", "--name-only", "%s..%s" % (lv, head or "HEAD")],
                                  cwd=base_dir, capture_output=True, encoding="utf-8",
                                  errors="replace").stdout.split() if lv else []
            deployable = [p for p in diff
                          if p.startswith(DEPLOY_DIR_PREFIXES) or os.path.basename(p) in DEPLOY_ROOT_FILES]
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
    ap.add_argument("--mojibake-all", action="store_true",
                    help="проверить кодировку во всей кодовой базе, а не только в файлах к деплою")
    ap.add_argument("--json", action="store_true")
    a = ap.parse_args()

    rep = run_checks(os.path.abspath(a.dir), a.expect_version, a.deploy_gate, a.mojibake_all)
    if a.json:
        print(json.dumps({"checks": rep.checks, "failed": len(rep.failed), "total": rep.total},
                         ensure_ascii=False, indent=2))
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
