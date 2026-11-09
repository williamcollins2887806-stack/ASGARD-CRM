import sys, zipfile, struct
sys.stdout.reconfigure(encoding='utf-8', errors='replace')

p = 'ting-android/android/app/build/outputs/apk/debug/app-debug.apk'
z = zipfile.ZipFile(p)
print('bad:', z.testzip(), 'entries:', len(z.namelist()))

print('\n--- ic_launcher ресурсы в APK ---')
for n in sorted(x for x in z.namelist() if 'ic_launcher' in x.lower() or 'ic_ting' in x.lower()):
    print(f'  {n:55s} {z.getinfo(n).file_size:>8d}')

print('\n--- есть ли старая мордочка (белый путь #FFFFFF)? ---')
found_old = False
for n in z.namelist():
    if n.endswith('.xml') and 'foreground' in n:
        raw = z.read(n)
        if b'\xff\xff\xff' in raw or b'\xff\xff\xff\xff' in raw:
            print('  WARN возможен белый fill:', n)
            found_old = True
print('  старая белая мордочка:', 'НЕТ' if not found_old else 'возможно осталась')

print('\n--- adaptive icon ссылки (строки) ---')


def axml_strings(data):
    try:
        typ, hsize, size = struct.unpack('<HHI', data[:8])
        off = hsize
        styp, shsize, ssize, scount, stycount, sflags, sstart, stystart = struct.unpack('<HHIIIIII', data[off:off + 28])
        utf8 = (sflags & (1 << 8)) != 0
        base = off + shsize
        pool_base = off + sstart
        out = []
        for i in range(scount):
            (o,) = struct.unpack('<I', data[base + i * 4:base + i * 4 + 4])
            pp = pool_base + o
            if utf8:
                n = data[pp]
                pp += 1
                if n & 0x80:
                    pp += 1
                n = data[pp]
                pp += 1
                if n & 0x80:
                    n = ((n & 0x7f) << 8) | data[pp]
                    pp += 1
                out.append(data[pp:pp + n].decode('utf-8', 'replace'))
            else:
                (n,) = struct.unpack('<H', data[pp:pp + 2])
                pp += 2
                out.append(data[pp:pp + n * 2].decode('utf-16-le', 'replace'))
        return out
    except Exception as e:
        return ['<<err %s>>' % e]


for n in ['res/mipmap-anydpi-v26/ic_launcher.xml']:
    if n in z.namelist():
        print(f'  {n}:', [s for s in axml_strings(z.read(n)) if s][:8])
