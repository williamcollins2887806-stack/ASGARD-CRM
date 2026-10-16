# -*- coding: utf-8 -*-
import sys
sys.stdout.reconfigure(encoding='utf-8')
import fitz
PATH = r"C:\Users\Nikita-ASGARD\Desktop\ТКП ЮНИКС Ильский НПЗ (Т-1301 + ПК-1301).pdf"
doc = fitz.open(PATH)
with open(r"C:\Users\Nikita-ASGARD\ASGARD-CRM\tmp_verify_tkp\pdf_text.txt","w",encoding="utf-8") as f:
    for i,p in enumerate(doc):
        f.write(f"\n===== PAGE {i+1} =====\n")
        f.write(p.get_text("text"))
        f.write("\n----- WORDS (blocks) -----\n")
print("pages:", doc.page_count)
