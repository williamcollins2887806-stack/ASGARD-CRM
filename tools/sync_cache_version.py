#!/usr/bin/env python3
"""
Синхронизирует все ?v=X.Y.Z параметры в public/index.html с текущим SHELL_VERSION.

Зачем:
  - Каждый <script src="...js?v=A.B.C"> кэшируется браузером с ключом по URL.
  - Если ?v= не меняется, браузер берёт JS из HTTP-кэша даже после деплоя нового SW.
  - Бамп SHELL_VERSION в sw.js обновляет ТОЛЬКО SW-cache, не HTTP-cache.
  - Поэтому нужно ?v= каждого файла привязать к SHELL_VERSION.

Использование:
  python tools/sync_cache_version.py            # читает SHELL_VERSION из sw.js
  python tools/sync_cache_version.py 20.13.6    # ставит указанную версию

Что делает:
  1. Меняет SHELL_VERSION в public/sw.js
  2. Меняет ASGARD_SHELL_VERSION в public/index.html
  3. Все ?v=X.Y.Z в public/index.html заменяет на ?v=<VERSION>
  4. Печатает сводку
"""
import re
import sys
import os

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SW = os.path.join(ROOT, 'public', 'sw.js')
INDEX = os.path.join(ROOT, 'public', 'index.html')

def read_current_version():
    with open(SW, 'r', encoding='utf-8') as f:
        m = re.search(r"const\s+SHELL_VERSION\s*=\s*'([^']+)'", f.read())
        return m.group(1) if m else None

def bump_patch(version):
    """20.13.5 -> 20.13.6"""
    parts = version.split('.')
    if len(parts) >= 3 and parts[-1].isdigit():
        parts[-1] = str(int(parts[-1]) + 1)
    return '.'.join(parts)

def main():
    if len(sys.argv) > 1:
        new_version = sys.argv[1]
    else:
        current = read_current_version()
        if not current:
            print('ERROR: не нашёл SHELL_VERSION в public/sw.js', file=sys.stderr)
            sys.exit(1)
        new_version = bump_patch(current)

    print(f'Bumping SHELL_VERSION → {new_version}')

    # 1. sw.js
    with open(SW, 'r', encoding='utf-8') as f:
        sw_content = f.read()
    sw_new = re.sub(
        r"(const\s+SHELL_VERSION\s*=\s*')[^']+(')",
        rf"\g<1>{new_version}\g<2>",
        sw_content,
        count=1
    )
    if sw_new == sw_content:
        print('WARN: sw.js не изменился (паттерн не найден)', file=sys.stderr)
    with open(SW, 'w', encoding='utf-8', newline='') as f:
        f.write(sw_new)
    print(f'  ✓ public/sw.js')

    # 2-3. index.html
    with open(INDEX, 'r', encoding='utf-8') as f:
        idx_content = f.read()
    idx_new = re.sub(
        r"(window\.ASGARD_SHELL_VERSION\s*=\s*')[^']+(')",
        rf"\g<1>{new_version}\g<2>",
        idx_content,
        count=1
    )
    # Все ?v=X.Y.Z → ?v=NEW (только в href/src= с assets)
    pattern = r"((?:href|src)=\"[^\"]*\?v=)[0-9a-zA-Z._-]+"
    count = len(re.findall(pattern, idx_new))
    idx_new = re.sub(pattern, rf"\g<1>{new_version}", idx_new)
    with open(INDEX, 'w', encoding='utf-8', newline='') as f:
        f.write(idx_new)
    print(f'  ✓ public/index.html — заменено {count} ссылок ?v=')

    print(f'\nDONE. Не забудь:')
    print(f'  git add public/sw.js public/index.html')
    print(f'  git commit -m "chore: bump SHELL_VERSION → {new_version}"')

if __name__ == '__main__':
    main()
