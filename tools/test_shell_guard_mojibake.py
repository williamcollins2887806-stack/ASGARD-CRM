#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Тест детектора mojibake в shell_guard (класс D-142b).

Проверяем ДВЕ вещи:
  1. Чистое дерево проходит (нет ложных срабатываний на рамках ═║╔).
  2. Испорченный файл ДЕЙСТВИТЕЛЬНО ловится (негативный контроль) —
     иначе проверка бесполезна и «зелёная» ложно.

Запуск: python tools/test_shell_guard_mojibake.py
"""
import io
import os
import shutil
import sys
import tempfile

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import shell_guard  # noqa: E402

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

# Windows-консоль по умолчанию cp1251 — символы рамок в отчёте её ломают.
if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")

passed = failed = 0


def check(name, ok, detail=""):
    global passed, failed
    if ok:
        passed += 1
        print("PASS " + name)
    else:
        failed += 1
        print("FAIL " + name + (" :: " + str(detail) if detail else ""))


def count_mojibake(text):
    return len(shell_guard.MOJIBAKE_RE.findall(text))


# ── 1. Детектор на образцах ────────────────────────────────────────────────
CASES = [
    # (текст, ожидание «есть дефект»)
    ("<div>Заказ</div>", False),
    ("/* ═══════════════\n   ЗАГОЛОВОК\n   ═══════════════ */", False),   # рамки — законно
    ("/* ╔══════╗\n   ║ ТЕКСТ ║\n   ╚══════╝ */", False),
    ("/* ═══ ASGARD CRM — Пергамент ═══ */", False),                      # тире — законно
    ("<p>╨Ч╨░╨║╨░╨╖</p>", True),                                        # реальный mojibake
    ("тАФ текст", True),
    ("тАУ текст", True),
]

print("=== детектор на образцах ===")
for text, expect_bad in CASES:
    n = count_mojibake(text)
    check("mojibake=%s: %r" % ("ЕСТЬ" if expect_bad else "нет", text[:28]),
          (n > 0) == expect_bad, "найдено участков: %d" % n)

# ── 2. Живые файлы репозитория чисты ───────────────────────────────────────
print("\n=== живые shell-файлы ===")
for rel in ("public/index.html", "public/sw.js"):
    p = os.path.join(ROOT, rel)
    if os.path.exists(p):
        n = shell_guard._mojibake_in(p)
        check("%s: нет mojibake" % rel, n == 0, "найдено: %s" % n)

# ── 3. Сам гейт не должен краснеть на своих образцах ──────────────────────
print("\n=== собственный код детектора ===")
for rel in ("tools/shell_guard.py", "tools/test_shell_guard_mojibake.py"):
    p = os.path.join(ROOT, rel)
    if os.path.exists(p):
        # В файле ЕСТЬ образцы (иначе детектор нечего проверять),
        # но при этом он обязан быть в списке исключений — иначе гейт краснеет сам на себя.
        raw_n = shell_guard._mojibake_in(p)
        skipped = rel in shell_guard.MOJIBAKE_SKIP_FILES
        check("%s: содержит образец, но исключён из скана" % rel,
              (raw_n or 0) > 0 and skipped,
              "образцов=%s, в исключениях=%s" % (raw_n, skipped))

# Историческое испорченное дерево должно ловиться в общем скане.
# ── 4. Негативный контроль через реальный run_checks ───────────────────────
print("\n=== негативный контроль (копия дерева с испорченным файлом) ===")
tmp = tempfile.mkdtemp(prefix="guard-test-")
try:
    # Минимальное дерево: public/index.html + public/sw.js + один испорченный ассет.
    os.makedirs(os.path.join(tmp, "public", "assets", "css"))
    idx_src = os.path.join(ROOT, "public", "index.html")
    sw_src = os.path.join(ROOT, "public", "sw.js")
    shutil.copy2(idx_src, os.path.join(tmp, "public", "index.html"))
    shutil.copy2(sw_src, os.path.join(tmp, "public", "sw.js"))

    clean_css = os.path.join(tmp, "public", "assets", "css", "probe.css")
    with io.open(clean_css, "w", encoding="utf-8", newline="\n") as f:
        f.write("/* ═══ Проверка ═══ */\n.x { color: #fff; }\n")

    n = shell_guard._mojibake_in(clean_css)
    check("чистый файл в копии: mojibake=0", n == 0, "найдено: %s" % n)

    # Портим: пишем русский текст как cp866-артефакты.
    with io.open(clean_css, "w", encoding="utf-8", newline="\n") as f:
        f.write("/* \u2568\u0427\u2568\u0430\u2568\u043a\u2568\u0430\u2568\u0437 */\n")
    n = shell_guard._mojibake_in(clean_css)
    check("испорченный файл: mojibake>0 (детектор реально ловит)", n and n > 0, "найдено: %s" % n)

    # run_checks на испорченном дереве должен краснеть по имени проверки.
    rep = shell_guard.run_checks(tmp)
    names = [c["name"] for c in rep.failed]
    hit = any("mojibake" in nm for nm in names)
    check("run_checks падает на испорченном дереве", hit, "упавшие: %s" % names)

    # И на чистом — не краснеет по mojibake.
    with io.open(clean_css, "w", encoding="utf-8", newline="\n") as f:
        f.write("/* ═══ Проверка ═══ */\n.x { color: #fff; }\n")
    rep2 = shell_guard.run_checks(tmp)
    hit2 = any("mojibake" in nm for nm in [c["name"] for c in rep2.failed])
    check("run_checks НЕ краснеет по mojibake на чистом дереве", not hit2,
          "упавшие: %s" % [c["name"] for c in rep2.failed])
finally:
    shutil.rmtree(tmp, ignore_errors=True)

print("")
print("ИТОГ: %s — %d PASS, %d FAIL" % ("OK" if not failed else "FAIL", passed, failed))
sys.exit(1 if failed else 0)
