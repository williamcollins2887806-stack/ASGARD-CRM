#!/bin/bash
# Пересъёмка журналов: только УСПЕШНЫЕ (HTTP 200) GET-запросы.
# 1) API-эндпоинты: сколько + даты  2) рендеры страниц (page= из /api/page-view)
cd /var/log/nginx || exit 1

{
  zcat -f access.log.*.gz 2>/dev/null
  cat access.log.1 access.log 2>/dev/null
} | awk -F'"' '
BEGIN { split("Jan Feb Mar Apr May Jun Jul Aug Sep Oct Nov Dec", mn, " "); for (i in mn) M[mn[i]] = i }
{
  split($2, a, " ");
  if (a[1] != "GET") next;
  split($3, st, " ");
  if (st[1] != "200") next;               # только успешные ответы
  p = a[2]; sub(/\?.*/, "", p);
  if (p !~ /^\/api\//) next;
  if (match($0, /\[([0-9]{2})\/([A-Za-z]{3})\/([0-9]{4}):/, d)) {
    key = d[3]*10000 + M[d[2]]*100 + d[1]; lab = d[1] "." (M[d[2]]+0);
  } else { key = 0; lab = "" }
  q = p;
  gsub(/\/[0-9]{2,}/, "/:id", q);
  cnt[q]++;
  if (!(q in lo) || key < lo[q]) { lo[q] = key; loS[q] = lab }
  if (!(q in hi) || key > hi[q]) { hi[q] = key; hiS[q] = lab }
}
END { for (k in cnt) printf "%d\t%s\t%s\t%s\n", cnt[k], k, loS[k], hiS[k] }
' | sort -rn > /tmp/_api200.tsv

{
  zcat -f access.log.*.gz 2>/dev/null
  cat access.log.1 access.log 2>/dev/null
} | awk '
BEGIN { split("Jan Feb Mar Apr May Jun Jul Aug Sep Oct Nov Dec", mn, " "); for (i in mn) M[mn[i]] = i }
{
  # page-view — текущий сигнал (D-274); hints — прежний, до выкатки 16.10.2026.
  # Матчим оба, чтобы окно наблюдения не рвалось на дате перехода.
  if (match($0, /GET \/api\/(page-view|hints)\?page=[A-Za-z0-9_%-]+/)) {
    pre = substr($0, RSTART, RLENGTH);
    if ($0 !~ / HTTP\/[0-9.]+" 200 /) next;   # только успешные рендеры
    s = pre; sub(/^GET \/api\/(page-view|hints)\?page=/, "", s);
    cnt[s]++;
    if (match($0, /\[([0-9]{2})\/([A-Za-z]{3})\/([0-9]{4}):/, d)) {
      key = d[3]*10000 + M[d[2]]*100 + d[1]; lab = d[1] "." (M[d[2]]+0);
    } else { key = 0; lab = "" }
    if (!(s in lo) || key < lo[s]) { lo[s] = key; loS[s] = lab }
    if (!(s in hi) || key > hi[s]) { hi[s] = key; hiS[s] = lab }
  }
}
END { for (k in cnt) printf "%d\t%s\t%s\t%s\n", cnt[k], k, loS[k], hiS[k] }
' | sort -rn > /tmp/_hints200.tsv

wc -l /tmp/_api200.tsv /tmp/_hints200.tsv
