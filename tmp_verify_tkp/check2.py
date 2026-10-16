# -*- coding: utf-8 -*-
import sys, re
sys.stdout.reconfigure(encoding='utf-8')
import docx, fitz, zipfile

DOCX = r"C:\Users\Nikita-ASGARD\Desktop\ТКП ЮНИКС Ильский НПЗ (Т-1301 + ПК-1301).docx"
PDF  = r"C:\Users\Nikita-ASGARD\Desktop\ТКП ЮНИКС Ильский НПЗ (Т-1301 + ПК-1301).pdf"

d = docx.Document(DOCX)
sec = d.sections[0]
print("page W x H (cm):", sec.page_width.cm, sec.page_height.cm)
print("margins L/R/T/B (cm):", sec.left_margin.cm, sec.right_margin.cm, sec.top_margin.cm, sec.bottom_margin.cm)
print("text width cm:", sec.page_width.cm - sec.left_margin.cm - sec.right_margin.cm)

# 'индивидуальн' context
def alloftxt():
    parts=[p.text for p in d.paragraphs]
    for t in d.tables:
        for r in t.rows:
            for c in r.cells: parts.append(c.text)
    return "\n".join(parts)
T = alloftxt()
for m in re.finditer("индивидуальн", T):
    print("INDIV ctx:", repr(T[max(0,m.start()-60):m.start()+60]))

# контрольный mentions: every sentence
print("\n--- 'контрольн' contexts ---")
for m in re.finditer("контрольн", T):
    seg = T[max(0,m.start()-90):m.start()+70].replace("\n"," ")
    print("*", seg)

print("\n--- 'и контрольный' / 'и контр' occurrences ---")
for pat in ["и контрольный", "и контр", "контрольный проход", "число проходов","Число проходов","Проходов","проходов"]:
    print(pat, ":", T.count(pat))

# Cyrillic Z check
print("\n--- Вид обслуживания cells ---")
for t in d.tables:
    hdr=[c.text.strip() for c in t.rows[0].cells]
    for r in t.rows:
        cells=[c.text.strip() for c in r.cells]
        if any(c=="З" or c=="Z" for c in cells):
            for c in cells:
                if c in ("З","Z"):
                    print("cell:", repr(c), "zN:", hex(ord(c)))

print("\n--- header banner tables ---")
for ti,t in enumerate(d.tables):
    txt="".join(c.text for r in t.rows for c in r.cells)
    if "asgard-service" in txt:
        print("banner table idx:", ti)

print("\n--- Приложения ---")
for p in d.paragraphs:
    if p.text.strip().startswith("Приложение"):
        print(" ", p.text.strip())

# PDF overlap / overflow check
doc=fitz.open(PDF)
print("\n--- PDF overlap detection ---")
for pi,p in enumerate(doc):
    pw,ph = p.rect.width, p.rect.height
    blocks=[b for b in p.get_text("blocks") if b[4].strip()]
    # find blocks exceeding right margin (x1 > page width - small)
    over=[b for b in blocks if b[2] > pw-2]
    if over:
        print(f" page{pi+1}: {len(over)} blocks near right edge e.g.", over[0][:4], repr(over[0][4][:40]))
    # pairwise vertical overlap of text blocks (rough)
print("page width pt:", doc[0].rect.width, "height:", doc[0].rect.height)
