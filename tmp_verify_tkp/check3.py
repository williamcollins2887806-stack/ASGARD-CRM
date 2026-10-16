# -*- coding: utf-8 -*-
import sys, re
sys.stdout.reconfigure(encoding='utf-8')
import fitz, docx

DOCX = r"C:\Users\Nikita-ASGARD\Desktop\ТКП ЮНИКС Ильский НПЗ (Т-1301 + ПК-1301).docx"
PDF  = r"C:\Users\Nikita-ASGARD\Desktop\ТКП ЮНИКС Ильский НПЗ (Т-1301 + ПК-1301).pdf"

# text area in pt
left = 1.349375*28.3465; right = (21.00086111111111-1.349375)*28.3465
print("text area pt: left=%.2f right=%.2f width=%.2f"%(left,right,right-left))

doc=fitz.open(PDF)
maxx=0; maxy=0
for pi,p in enumerate(doc):
    for b in p.get_text("blocks"):
        if not b[4].strip(): continue
        x0,y0,x1,y1=b[:4]
        maxx=max(maxx,x1)
        if x1 > right+0.5:
            print(f"  OVERFLOW page{pi+1} x1=%.2f > right=%.2f : %r"%(x1,right,b[4][:50].replace(chr(10),' ')))
        if x0 < left-0.5:
            print(f"  LEFT-OVER page{pi+1} x0=%.2f < left=%.2f : %r"%(x0,left,b[4][:50].replace(chr(10),' ')))
print("max x1 over all blocks: %.2f"%maxx)

# vertical overlap of distinct blocks (same page) - rough
print("\n--- vertical overlaps (blocks sharing y-range on same page) ---")
for pi,p in enumerate(doc):
    blocks=[b for b in p.get_text("blocks") if b[4].strip()]
    blocks.sort(key=lambda b:(b[1],b[0]))
    for i in range(len(blocks)-1):
        a=blocks[i]; c=blocks[i+1]
        # overlap if y-ranges intersect by >3pt and x-ranges intersect
        ov=min(a[3],c[3])-max(a[1],c[1])
        xov=min(a[2],c[2])-max(a[0],c[0])
        if ov>3 and xov>3:
            print(f"  page{pi+1} overlap {ov:.1f}pt: %r | %r"%(a[4][:35].replace(chr(10),' '),c[4][:35].replace(chr(10),' ')))
