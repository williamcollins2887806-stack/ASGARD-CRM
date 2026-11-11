#!/usr/bin/env python3
# Негативный контроль: гейт «изменённые ассеты получили новый ?v=» обязан
# КРАСНЕТЬ, если файл изменили, а версию не подняли. Иначе это не гейт.
import io
import os
import re
import shutil
import subprocess
import sys
import tempfile

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
GUARD = os.path.join(ROOT, 'tools', 'shell_guard.py')

fails = []


def run(guard_path, cwd, version='1.0.0'):
    r = subprocess.run([sys.executable, guard_path, '--expect-version', version], cwd=cwd,
                       capture_output=True, text=True, encoding='utf-8', errors='replace')
    return r.returncode, (r.stdout or '') + (r.stderr or '')


def case(name, expect_fail, mutate):
    tmp = tempfile.mkdtemp(prefix='sg-')
    try:
        # Минимальное git-дерево с одним ассетом.
        os.makedirs(os.path.join(tmp, 'public', 'assets', 'js'), exist_ok=True)
        os.makedirs(os.path.join(tmp, 'tests', 'reports'), exist_ok=True)
        os.makedirs(os.path.join(tmp, 'tools'), exist_ok=True)
        shutil.copy(GUARD, os.path.join(tmp, 'tools', 'shell_guard.py'))
        ext = 'js'
        open(os.path.join(tmp, 'public', 'assets', 'js', 'm.js'), 'w', encoding='utf-8').write('// v1\n')
        html = ('<html><head></head><body>'
                '<script src="assets/js/m.js?v=1.0.0"></script>'
                '<script>window.ASGARD_SHELL_VERSION = "1.0.0";</script>'
                '</body></html>')
        open(os.path.join(tmp, 'public', 'index.html'), 'w', encoding='utf-8').write(html)
        open(os.path.join(tmp, 'public', 'sw.js'), 'w', encoding='utf-8').write("const SHELL_VERSION = '1.0.0';\n")
        g = lambda *a: subprocess.run(['git'] + list(a), cwd=tmp, capture_output=True, text=True)
        g('init', '-q')
        g('config', 'user.email', 't@t.t')
        g('config', 'user.name', 't')
        g('add', '-A')
        g('commit', '-qm', 'base')
        base = g('rev-parse', 'HEAD').stdout.strip()
        io.open(os.path.join(tmp, 'tests', 'reports', '.last-verified'), 'w', encoding='utf-8').write(base)

        mutate(tmp)

        # Ожидаемую версию берём из актуального sw.js — иначе падают ДРУГИЕ
        # проверки гейта (версии оболочки), и тест мерит не то.
        sw = io.open(os.path.join(tmp, 'public', 'sw.js'), encoding='utf-8').read()
        ver = re.search(r"SHELL_VERSION = '([0-9.]+)'", sw)
        rc, out = run(os.path.join(tmp, 'tools', 'shell_guard.py'), tmp,
                      ver.group(1) if ver else '1.0.0')
        # Нас интересует ИМЕННО наша проверка, а не весь exit code.
        m = re.search(r'(PASS|FAIL) изменённые ассеты получили новый \?v=', out)
        verdict = m.group(1) if m else 'НЕТ ПРОВЕРКИ'
        caught = (verdict == 'FAIL')
        ok = (caught == expect_fail)
        print(('  PASS ' if ok else '  FAIL ') + name + ' — ' + verdict +
              ' (ожидалось: ' + ('FAIL' if expect_fail else 'PASS') + ')')
        if not ok:
            fails.append(name)
    finally:
        shutil.rmtree(tmp, ignore_errors=True)


def mutate_asset_no_bump(t):
    open(os.path.join(t, 'public', 'assets', 'js', 'm.js'), 'w', encoding='utf-8').write('// v2 CHANGED\n')


def mutate_asset_with_bump(t):
    open(os.path.join(t, 'public', 'assets', 'js', 'm.js'), 'w', encoding='utf-8').write('// v2 CHANGED\n')
    p = os.path.join(t, 'public', 'index.html')
    s = io.open(p, encoding='utf-8').read().replace('?v=1.0.0', '?v=1.0.1')
    s = s.replace('ASGARD_SHELL_VERSION = "1.0.0"', 'ASGARD_SHELL_VERSION = "1.0.1"')
    io.open(p, 'w', encoding='utf-8').write(s)
    p2 = os.path.join(t, 'public', 'sw.js')
    io.open(p2, 'w', encoding='utf-8').write("const SHELL_VERSION = '1.0.1';\n")


def no_change(t):
    pass


print('=== негативный контроль гейта версий ===')
case('файл изменён, версия НЕ поднята -> должен КРАСНЕТЬ', True, mutate_asset_no_bump)
case('файл изменён, версия поднята -> должен быть зелёным', False, mutate_asset_with_bump)
case('ничего не менялось -> должен быть зелёным', False, no_change)

print()
if fails:
    print('ИТОГ: FAIL — ' + ', '.join(fails))
    raise SystemExit(1)
print('ИТОГ: OK — детектор ловит дефект и не даёт ложных срабатываний')
