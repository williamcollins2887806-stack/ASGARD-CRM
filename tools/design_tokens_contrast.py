def srgb(c):
    c = c / 255.0
    return c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4

def lum(h):
    h = h.lstrip('#')
    return 0.2126*srgb(int(h[0:2],16)) + 0.7152*srgb(int(h[2:4],16)) + 0.0722*srgb(int(h[4:6],16))

def ratio(a,b):
    la,lb=lum(a),lum(b); hi,lo=max(la,lb),min(la,lb); return (hi+0.05)/(lo+0.05)

print("="*72)
print("DARK THEME  (bg0 #0C0F13 / bg1 #0F1217 / bg2 #141922 / bg3 #1A2029 / bg4 #232B36)")
print("="*72)
dark = [
 ("text-1 #E8EDF4 on bg1", "#E8EDF4", "#0F1217"),
 ("text-1 #E8EDF4 on bg2", "#E8EDF4", "#141922"),
 ("text-2 #A3AEBF on bg1", "#A3AEBF", "#0F1217"),
 ("text-2 #A3AEBF on bg2", "#A3AEBF", "#141922"),
 ("text-2 #A3AEBF on bg3", "#A3AEBF", "#1A2029"),
 ("text-3 #7C889B on bg1", "#7C889B", "#0F1217"),
 ("text-3 #7C889B on bg2", "#7C889B", "#141922"),
 ("text-3 #7C889B on bg3", "#7C889B", "#1A2029"),
 ("blue-400 #5590E0 on bg2", "#5590E0", "#141922"),
 ("red-400 #E8697C on bg2", "#E8697C", "#141922"),
 ("gold-400 #E3BC63 on bg2", "#E3BC63", "#141922"),
 ("ok-400 #5DDF97 on bg2", "#5DDF97", "#141922"),
 ("warn-400 #F0C24A on bg2", "#F0C24A", "#141922"),
 ("err-400 #F0808F on bg2", "#F0808F", "#141922"),
 ("info-400 #6BA3E8 on bg2", "#6BA3E8", "#141922"),
 ("on-blue #0B1220 on blue-500 #5590E0", "#0B1220", "#5590E0"),
 ("white on blue-solid #2E64A8", "#FFFFFF", "#2E64A8"),
 ("white on red-solid #BE2135", "#FFFFFF", "#BE2135"),
 ("white on ok-solid #1E8A5F", "#FFFFFF", "#1E8A5F"),
 ("bg0 #0B1220 on gold #D4A843 (VIP)", "#0B1220", "#D4A843"),
]
for l,a,b in dark:
    r=ratio(a,b); v="AA-body 4.5" if r>=4.5 else ("AA-large 3.0" if r>=3.0 else "FAIL")
    print(f"  {l:38s} {r:6.2f}:1  {v}")

print()
print("="*72)
print("LIGHT THEME (bg0 #EDEFF3 / bg1 #F4F5F7 / bg2 #FFFFFF / bg3 #F0F1F4)")
print("="*72)
light = [
 ("text-1 #111827 on bg1", "#111827", "#F4F5F7"),
 ("text-1 #111827 on card #FFF", "#111827", "#FFFFFF"),
 ("text-2 #4B5563 on bg1", "#4B5563", "#F4F5F7"),
 ("text-2 #4B5563 on card #FFF", "#4B5563", "#FFFFFF"),
 ("text-2 #4B5563 on bg3", "#4B5563", "#F0F1F4"),
 ("text-3 #616C7E on bg1", "#616C7E", "#F4F5F7"),
 ("text-3 #616C7E on card #FFF", "#616C7E", "#FFFFFF"),
 ("text-3 #616C7E on bg3", "#616C7E", "#F0F1F4"),
 ("blue-text #1C4E90 on bg1", "#1C4E90", "#F4F5F7"),
 ("blue-text #1C4E90 on card #FFF", "#1C4E90", "#FFFFFF"),
 ("red-text #BE2135 on bg1", "#BE2135", "#F4F5F7"),
 ("red-text #BE2135 on card #FFF", "#BE2135", "#FFFFFF"),
 ("gold-text #7F6119 on bg1", "#7F6119", "#F4F5F7"),
 ("gold-text #7F6119 on card #FFF", "#7F6119", "#FFFFFF"),
 ("ok-text #157F44 on card #FFF", "#157F44", "#FFFFFF"),
 ("warn-text #8A5D0A on card #FFF", "#8A5D0A", "#FFFFFF"),
 ("info-text #1C64C4 on card #FFF", "#1C64C4", "#FFFFFF"),
 ("white on blue-solid #1E4D8C", "#FFFFFF", "#1E4D8C"),
 ("white on blue-solid #1C4E90", "#FFFFFF", "#1C4E90"),
 ("white on red-solid #BE2135", "#FFFFFF", "#BE2135"),
 ("white on ok-solid #157F44", "#FFFFFF", "#157F44"),
 ("white on gold #D4A843 (FAILS)", "#FFFFFF", "#D4A843"),
 ("#0B1220 on gold #D4A843", "#0B1220", "#D4A843"),
 ("hairline #DDE1E8 on card #FFF", "#DDE1E8", "#FFFFFF"),
]
for l,a,b in light:
    r=ratio(a,b); v="AA-body 4.5" if r>=4.5 else ("AA-large 3.0" if r>=3.0 else "FAIL")
    print(f"  {l:38s} {r:6.2f}:1  {v}")
