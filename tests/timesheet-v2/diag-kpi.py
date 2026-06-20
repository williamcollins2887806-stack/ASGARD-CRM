import sys, json
d = json.load(sys.stdin)
print("mode:", d.get("mode"))
print("columns:", d.get("columns"))
emps = d.get("employees", [])
print("emps:", len(emps))
print()
print("-- первые 5 emp --")
for e in emps[:5]:
    fio = e.get("fio","")[:40]
    print("  %-40s amt=%s pd=%s pts=%s days=%s" % (
        fio,
        e.get("total_amount"),
        e.get("per_diem_total"),
        e.get("total_points"),
        e.get("days_count"),
    ))
print()
totalAmt = sum((e.get("total_amount") or 0) for e in emps)
totalPd  = sum((e.get("per_diem_total") or 0) for e in emps)
totalPts = sum((e.get("total_points") or 0) for e in emps)
totalD   = sum((e.get("days_count") or 0) for e in emps)
print("SUM total_amount:   %.0f" % totalAmt)
print("SUM per_diem_total: %.0f" % totalPd)
print("SUM total_points:   %.0f" % totalPts)
print("SUM days_count:     %d"   % totalD)
print()
print("-- пример клетки с заполненными данными --")
for e in emps:
    for k, v in (e.get("days") or {}).items():
        if v and v.get("type"):
            print("  emp:", e["fio"], "day:", k, "→", json.dumps(v, ensure_ascii=False))
            break
    else:
        continue
    break
