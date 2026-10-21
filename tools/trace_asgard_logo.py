"""Векторизация логотипа ASGARD v6 — по РЕАЛЬНОМУ градиенту.

Главная находка (замер медианного цвета по полосам, tools/_tmp_sample_gradient.py):
  • градиент знака ЧИСТО ВЕРТИКАЛЬНЫЙ — левая половина совпадает с правой
    (напр. на 50%: лево #642A7B, право #632674);
  • он сквозной: алый #FB262B сверху → пурпур #642878 → синий #035DB8 книзу.

Значит знак — ОДИН силуэт с одним вертикальным градиентом, а не два разных
цвета. Раздельные «пламя/крылья» (v4–v5) были моей ошибкой: они давали швы
и расхождение цветов. Здесь — единый путь и 12 остановок прямо из замеров.
"""
import numpy as np
import cv2
import potrace
import json
import os
from PIL import Image

SRC = r'C:\Users\Nikita-ASGARD\ASGARD-CRM\public\assets\img\asgard_logo.png'
OUT = r'C:\Users\Nikita-ASGARD\ASGARD-CRM\public\mobile-app\src\assets\asgard-logo.svg'
GRAD = r'C:\Users\Nikita-ASGARD\ASGARD-CRM\tests\reports\logo-gradient.json'

im = Image.open(SRC).convert('RGBA')
bb = im.getchannel('A').getbbox()
arr = np.array(im.crop(bb))
h, w = arr.shape[:2]
a = arr[:, :, 3]
print('контент:', w, 'x', h)

# Градиент из замеров
stops = json.load(open(GRAD, encoding='utf-8'))
print('остановок градиента:', len(stops))

ALPHA = a > 80


def clean(mask, k=3, it=1):
    m = (mask.astype(np.uint8)) * 255
    kern = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (k, k))
    m = cv2.morphologyEx(m, cv2.MORPH_CLOSE, kern, iterations=it)
    m = cv2.morphologyEx(m, cv2.MORPH_OPEN, kern, iterations=1)
    return m > 127


# turdsize=25: убирает шум сжатия, но оставляет ВНУТРЕННИЕ вырезы знака
sil = clean(ALPHA, k=3, it=1)


def to_path(mask, turd=25):
    bmp = potrace.Bitmap(np.ascontiguousarray(mask.astype(bool)))
    path = bmp.trace(turdsize=turd, alphamax=1.0, opttolerance=0.25)
    parts = []
    for curve in path:
        p = curve.start_point
        parts.append(f'M{p.x:.1f},{p.y:.1f}')
        for seg in curve:
            if seg.is_corner:
                c = seg.c; e = seg.end_point
                parts.append(f'L{c.x:.1f},{c.y:.1f}L{e.x:.1f},{e.y:.1f}')
            else:
                c1, c2, e = seg.c1, seg.c2, seg.end_point
                parts.append(f'C{c1.x:.1f},{c1.y:.1f} {c2.x:.1f},{c2.y:.1f} {e.x:.1f},{e.y:.1f}')
        parts.append('Z')
    return ''.join(parts)


sil_d = to_path(sil, turd=25)
print('силуэт: %d симв.' % len(sil_d))

grad_stops = '\n'.join(
    f'      <stop offset="{s["offset"]}%" stop-color="#{s["rgb"][0]:02X}{s["rgb"][1]:02X}{s["rgb"][2]:02X}"/>'
    for s in stops
)

svg = f'''<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {w} {h}"
     preserveAspectRatio="xMidYMid meet" fill="none" class="asgard-logo-svg" role="img" aria-label="ASGARD">
  <defs>
    <!-- Градиент снят С РАСТРА (медиана по полосам): алый сверху → пурпур → синий.
         Горизонталь однородна, поэтому одна вертикальная ось — это и есть объём. -->
    <linearGradient id="asgBody" x1="50%" y1="0%" x2="50%" y2="100%">
{grad_stops}
    </linearGradient>
    <!-- Тонкая внутренняя тень снизу: добавляет «толщину» без искажения цвета -->
    <linearGradient id="asgShade" x1="50%" y1="100%" x2="50%" y2="45%">
      <stop offset="0%"   stop-color="rgba(0,6,26,0.38)"/>
      <stop offset="55%"  stop-color="rgba(0,6,26,0.10)"/>
      <stop offset="100%" stop-color="rgba(0,6,26,0)"/>
    </linearGradient>
    <!-- Верхний свет — знак читается объёмным -->
    <linearGradient id="asgLight" x1="50%" y1="0%" x2="50%" y2="52%">
      <stop offset="0%"   stop-color="rgba(255,255,255,0.30)"/>
      <stop offset="60%"  stop-color="rgba(255,255,255,0.04)"/>
      <stop offset="100%" stop-color="rgba(255,255,255,0)"/>
    </linearGradient>
    <linearGradient id="asgSheen" x1="0%" y1="0%" x2="100%" y2="0%">
      <stop offset="0%"   stop-color="rgba(255,255,255,0)"/>
      <stop offset="48%"  stop-color="rgba(255,250,232,0.62)"/>
      <stop offset="100%" stop-color="rgba(255,255,255,0)"/>
    </linearGradient>
    <clipPath id="asgClip">
      <path d="{sil_d}" fill-rule="evenodd"/>
    </clipPath>
  </defs>

  <!-- Тело: единый силуэт с вертикальным градиентом объёма -->
  <path d="{sil_d}" fill="url(#asgBody)" fill-rule="evenodd"/>

  <g clip-path="url(#asgClip)">
    <!-- Тень снизу и свет сверху: объём -->
    <rect x="0" y="0" width="{w}" height="{h}" fill="url(#asgShade)"/>
    <rect x="0" y="0" width="{w}" height="{h}" fill="url(#asgLight)"/>
    <!-- «Живое золото»: блик проходит по силуэту -->
    <rect class="asgard-logo-sheen" x="{-w}" y="0" width="{w}" height="{h}" fill="url(#asgSheen)">
      <animate attributeName="x" from="{-w}" to="{w}" dur="3.6s" begin="1s" repeatCount="indefinite"/>
    </rect>
  </g>
</svg>
'''

os.makedirs(os.path.dirname(OUT), exist_ok=True)
open(OUT, 'w', encoding='utf-8').write(svg)
print('SVG v6:', OUT, len(svg), 'байт')
