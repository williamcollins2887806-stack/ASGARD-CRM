#!/bin/bash
# Генерация PNG/JPEG-вариантов счетов из PDF тем же путём, что использует OCR
# в проде: pdftoppm (poppler) + ImageMagick convert (повороты/качество/шум/блюр).
set -e
DIR="/tmp/inv-src"
OUT="/tmp/inv-out"
mkdir -p "$OUT"
rm -f "$OUT"/*

rotate_ext() {
  local src="$1" dst="$2" deg="$3" q="$4" scale="$5" noise="$6" blur="$7"
  local args=()
  # масштаб
  if [ -n "$scale" ]; then args+=(-resize "${scale}%"); fi
  # поворот (для 45 — с заливкой фона как при сканировании со сдвигом)
  if [ "$deg" = "45" ]; then
    args+=(-background white -rotate 45)
  elif [ "$deg" != "0" ]; then
    args+=(-rotate "$deg")
  fi
  if [ -n "$blur" ]; then args+=(-blur "0x${blur}"); fi
  if [ "$noise" = "1" ]; then args+=(-attenuate 0.25 +noise Gaussian); fi
  if [ -n "$q" ]; then
    convert "$src" "${args[@]}" -quality "$q" "$dst"
  else
    convert "$src" "${args[@]}" "$dst"
  fi
}

# 1) PDF → PNG (150 dpi), как в OCR
for f in "$DIR"/inv-*.pdf; do
  base=$(basename "$f" .pdf)
  pdftoppm -png -r 150 -singlefile "$f" "$OUT/${base}__pdfpng" 2>/dev/null || true
done

# 2) варианты искажений
for f in "$DIR"/inv-*.pdf; do
  base=$(basename "$f" .pdf)
  png="$OUT/${base}__pdfpng.png"
  [ -f "$png" ] || continue
  rotate_ext "$png" "$OUT/${base}__png-clean.png"       0   ""   200 0 0
  rotate_ext "$png" "$OUT/${base}__png-rot90.png"       90  ""   180 0 0
  rotate_ext "$png" "$OUT/${base}__png-rot180.png"      180 ""   180 0 0
  rotate_ext "$png" "$OUT/${base}__png-rot45.png"       45  ""   180 0 0
  rotate_ext "$png" "$OUT/${base}__jpg-lowq.jpg"        0   30   120 0 0
  rotate_ext "$png" "$OUT/${base}__jpg-noisy.jpg"       0   45   120 1 0
  rotate_ext "$png" "$OUT/${base}__png-small.png"       0   ""   55  0 0
  rotate_ext "$png" "$OUT/${base}__jpg-rot90-lowq.jpg"  90  35   120 0 0
  rotate_ext "$png" "$OUT/${base}__png-blur.png"        0   ""   120 0 1.5
done

echo "=== варианты ==="
ls -1 "$OUT" | wc -l
ls -1 "$OUT" | head -20
du -sh "$OUT"
