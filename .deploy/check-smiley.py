import sys, zipfile
sys.stdout.reconfigure(encoding='utf-8', errors='replace')

z = zipfile.ZipFile('ting-android/android/app/build/outputs/apk/debug/app-debug.apk')

# Отличительный pathData дефолтной Material-мордочки Capacitor
SMILEY = b'M66.94,46.02'

hits = []
for n in z.namelist():
    if n.endswith('.xml'):
        if SMILEY in z.read(n):
            hits.append(n)

print('старая мордочка (M66.94,46.02) в APK:', hits if hits else 'НЕ НАЙДЕНА — удалена')

print('\n--- adaptive icon: есть ли ic_launcher_foreground.xml в drawable? ---')
print('  ', [n for n in z.namelist() if n.endswith('drawable-anydpi-v24/ic_launcher_foreground.xml')] or 'нет (хорошо)')

print('\n--- где используется ic_launcher_legacy ---')
import re
for n in z.namelist():
    if n.endswith('.xml') and 'legacy' not in n:
        d = z.read(n)
        if b'legacy' in d:
            print('  ', n)
