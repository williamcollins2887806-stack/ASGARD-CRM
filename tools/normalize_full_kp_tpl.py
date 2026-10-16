# -*- coding: utf-8 -*-
"""Нормализует шаблон полного КП: чистит метаданные документа и снимает автосписки.

Зачем (D-191, 18.09.2026):

1. МЕТАДАННЫЕ. В templates/full-kp-nika-tpl.docx в docProps/core.xml остались
   свойства документа-донора («ТКП: очистка выпарной станции и подогревателей
   ООО «Ника сахарный завод»»). docxtemplater их не трогает, а PDF собирается
   DOCX -> LibreOffice, и LibreOffice переносит dc:title в PDF /Title. Встроенный
   просмотрщик браузера показывает это как имя файла — в предпросмотре ТКП
   «Завидово Гольф» всплывало чужое название. Лечится удалением элементов
   dc:title / dc:subject / cp:keywords / dc:description (dc:creator оставляем).

2. АВТОСПИСКИ. Три цикла-плейсхолдера в word/document.xml
   ({#scope_paras}/{.}/{/scope_paras} и такие же для acceptance_paras и
   risks_paras) висят на стиле абзаца List Number (w:pStyle w:val="a",
   numId=5). Word/LibreOffice нумеруют их ОДНИМ сквозным списком 1..42 через
   границы разделов: номер появляется у каждого абзаца, а в приёмке и условиях
   ещё и дублируется с уже вписанными «1. … 7.» / «1. … 10.». Убираем pStyle
   и висячий отступ (hanging) у этих абзацев; w:ind w:left остаётся, чтобы
   перенос строки выравнивался. Буллеты List Bullet (pStyle "a0") у cost_notes /
   duties / deliverables НЕ трогаем.

Запуск:
  python tools/normalize_full_kp_tpl.py           # применить
  python tools/normalize_full_kp_tpl.py --check    # только проверить (гейт)

Идемпотентно: повторный прогон ничего не меняет, --check зелёный.
"""
import re
import sys
import zipfile

SRC = 'templates/full-kp-nika-tpl.docx'
CORE = 'docProps/core.xml'
DOC = 'word/document.xml'

# тексты абзацев-циклов, у которых нужно снять стиль List Number
LOOP_TEXTS = {
    '{#scope_paras}', '{.}', '{/scope_paras}',
    '{#acceptance_paras}', '{.}', '{/acceptance_paras}',
    '{#risks_paras}', '{.}', '{/risks_paras}',
}
EXPECTED_LOOP_PARAS = 9

# метаданные донора, которые надо убрать
META_DROP = ['dc:title', 'dc:subject', 'cp:keywords', 'dc:description']
# маркеры чужого документа, которых быть не должно
FOREIGN = ['Ника', 'выпарн', 'сахарный завод', 'подогревателей']


def para_text(block):
    return ''.join(re.findall(r'<w:t[^>]*>([\s\S]*?)</w:t>', block))


def strip_metadata(core_xml):
    """Удаляет элементы META_DROP, оставляя dc:creator и остальное."""
    out = core_xml
    for tag in META_DROP:
        out = re.sub(r'<' + tag + r'(?:\s[^>]*)?>[\s\S]*?</' + tag + r'>', '', out)
        # на случай самозакрытой формы
        out = re.sub(r'<' + tag + r'(?:\s[^>]*)?/>', '', out)
    return out


def strip_list_style(doc_xml):
    """Снимает pStyle 'a' и hanging у абзацев-циклов. Возвращает (xml, счётчик)."""
    hits = [0]

    def fix(match):
        block = match.group(0)
        if para_text(block).strip() not in LOOP_TEXTS:
            return block
        if '<w:pStyle w:val="a"/>' not in block:
            return block
        hits[0] += 1
        fixed = block.replace('<w:pStyle w:val="a"/>', '')
        # висячий отступ убираем, левый оставляем
        fixed = re.sub(r'(<w:ind\b[^>]*?)\s+w:hanging="\d+"', r'\1', fixed)
        return fixed

    return re.sub(r'<w:p[ >][\s\S]*?</w:p>', fix, doc_xml), hits[0]


def check_mode():
    z = zipfile.ZipFile(SRC)
    core = z.read(CORE).decode('utf-8')
    doc = z.read(DOC).decode('utf-8')
    problems = []

    for tag in META_DROP:
        if re.search(r'<' + tag + r'(?:\s[^>]*)?>', core):
            problems.append(f'в {CORE} остался элемент <{tag}>')
    for word in FOREIGN:
        if word in core:
            problems.append(f'в {CORE} осталось чужое «{word}»')

    title = re.search(r'<dc:title(?:\s[^>]*)?>([\s\S]*?)</dc:title>', core)
    if title and title.group(1).strip():
        problems.append('dc:title не пуст')

    n_style = doc.count('<w:pStyle w:val="a"/>')
    if n_style:
        problems.append(f'в {DOC} остался w:pStyle w:val="a" ({n_style} шт.)')

    # буллеты должны остаться на месте
    if doc.count('<w:pStyle w:val="a0"/>') == 0:
        problems.append('пропали буллеты List Bullet (pStyle "a0")')

    if problems:
        print('FAIL: шаблон не нормализован:')
        for p in problems:
            print('  - ' + p)
        return 1
    print('OK: шаблон нормализован (метаданные чисты, автосписков нет, буллеты на месте)')
    return 0


def apply_mode():
    src = zipfile.ZipFile(SRC)
    core = src.read(CORE).decode('utf-8')
    doc = src.read(DOC).decode('utf-8')

    already = ('<dc:title>' not in core) and ('<w:pStyle w:val="a"/>' not in doc)
    if already:
        print('OK: шаблон уже нормализован, правок не требуется')
        return 0

    new_core = strip_metadata(core)
    new_doc, n_paras = strip_list_style(doc)

    if n_paras != EXPECTED_LOOP_PARAS:
        raise SystemExit(
            f'ожидалось {EXPECTED_LOOP_PARAS} абзацев-циклов со стилем List Number, '
            f'найдено {n_paras} — шаблон изменился, проверить вручную')

    # контроль: текстовые плейсхолдеры не должны пострадать
    for ph in sorted(LOOP_TEXTS):
        if ph not in new_doc:
            raise SystemExit(f'плейсхолдер {ph} пропал из документа')

    tmp = SRC + '.tmp'
    with zipfile.ZipFile(tmp, 'w', zipfile.ZIP_DEFLATED) as dst:
        for item in src.infolist():
            data = src.read(item.filename)
            if item.filename == CORE:
                data = new_core.encode('utf-8')
            elif item.filename == DOC:
                data = new_doc.encode('utf-8')
            dst.writestr(item, data)
    src.close()

    import os
    os.replace(tmp, SRC)
    print(f'OK: {SRC} обновлён (снят List Number с {n_paras} абзацев, метаданные очищены)')
    return 0


def main():
    if '--check' in sys.argv:
        return check_mode()
    return apply_mode()


if __name__ == '__main__':
    sys.exit(main())
