import json, hashlib, psycopg2
from datetime import datetime

conn = psycopg2.connect(host='localhost', user='asgard', password='123456789', database='asgard_crm')
cur = conn.cursor()

data = json.load(open('/var/www/asgard-crm/reestr_new.json', 'r', encoding='utf-8'))
sheets = data['sheets']
sheet_key = None
for k in sheets:
    if chr(1056)+chr(1077)+chr(1077)+chr(1089)+chr(1090)+chr(1088) in k:
        sheet_key = k
        break
if not sheet_key:
    sheet_key = list(sheets.keys())[0]
print('Sheet:', sheet_key)
rows = sheets[sheet_key]['data']
data_rows = rows[3:]
print('Total rows:', len(data_rows))

def categorize(obj, desc, sup):
    o = (obj or '').lower()
    d = (desc or '').lower()
    s = (sup or '').lower()
    arenda = chr(1072)+chr(1088)+chr(1077)+chr(1085)+chr(1076)+chr(1072)
    if arenda in o or arenda in d: return 'rent'
    transport = chr(1090)+chr(1088)+chr(1072)+chr(1085)+chr(1089)+chr(1087)+chr(1086)+chr(1088)+chr(1090)
    topliv = chr(1090)+chr(1086)+chr(1087)+chr(1083)+chr(1080)+chr(1074)
    benzin = chr(1073)+chr(1077)+chr(1085)+chr(1079)+chr(1080)+chr(1085)
    dizel = chr(1076)+chr(1080)+chr(1079)+chr(1077)+chr(1083)+chr(1100)
    lukoyl = chr(1083)+chr(1091)+chr(1082)+chr(1086)+chr(1081)+chr(1083)
    rosneft = chr(1088)+chr(1086)+chr(1089)+chr(1085)+chr(1077)+chr(1092)+chr(1090)+chr(1100)
    avtomobil = chr(1072)+chr(1074)+chr(1090)+chr(1086)+chr(1084)+chr(1086)+chr(1073)+chr(1080)+chr(1083)
    gruzoperevoz = chr(1075)+chr(1088)+chr(1091)+chr(1079)+chr(1086)+chr(1087)+chr(1077)+chr(1088)+chr(1077)+chr(1074)+chr(1086)+chr(1079)
    if transport in o or topliv in d or benzin in d or dizel in d or lukoyl in s or rosneft in s or avtomobil in d or gruzoperevoz in d: return 'transport'
    svyaz = chr(1089)+chr(1074)+chr(1103)+chr(1079)+chr(1100)
    telefon = chr(1090)+chr(1077)+chr(1083)+chr(1077)+chr(1092)+chr(1086)+chr(1085)
    internet_kw = chr(1080)+chr(1085)+chr(1090)+chr(1077)+chr(1088)+chr(1085)+chr(1077)+chr(1090)
    mts = chr(1084)+chr(1090)+chr(1089)
    bilayn = chr(1073)+chr(1080)+chr(1083)+chr(1072)+chr(1081)+chr(1085)
    megafon = chr(1084)+chr(1077)+chr(1075)+chr(1072)+chr(1092)+chr(1086)+chr(1085)
    rostelecom = chr(1088)+chr(1086)+chr(1089)+chr(1090)+chr(1077)+chr(1083)+chr(1077)+chr(1082)+chr(1086)+chr(1084)
    if svyaz in d or telefon in d or internet_kw in d or mts in s or bilayn in s or megafon in s or rostelecom in s: return 'communication'
    licenzi = chr(1083)+chr(1080)+chr(1094)+chr(1077)+chr(1085)+chr(1079)+chr(1080)
    programm = chr(1087)+chr(1088)+chr(1086)+chr(1075)+chr(1088)+chr(1072)+chr(1084)+chr(1084)
    soft = chr(1089)+chr(1086)+chr(1092)+chr(1090)
    podpisk = chr(1087)+chr(1086)+chr(1076)+chr(1087)+chr(1080)+chr(1089)+chr(1082)
    yandex = chr(1103)+chr(1085)+chr(1076)+chr(1077)+chr(1082)+chr(1089)
    edo = chr(1101)+chr(1076)+chr(1086)
    ecp = chr(1101)+chr(1094)+chr(1087)
    kontur = chr(1082)+chr(1086)+chr(1085)+chr(1090)+chr(1091)+chr(1088)
    sbis = chr(1089)+chr(1073)+chr(1080)+chr(1089)
    if licenzi in d or programm in d or soft in d or podpisk in d or '1'+chr(1089) in s or 'microsoft' in s or yandex in s or edo in d or ecp in d or kontur in s or sbis in s or 'diadoc' in s: return 'software'
    oborudovan = chr(1086)+chr(1073)+chr(1086)+chr(1088)+chr(1091)+chr(1076)+chr(1086)+chr(1074)+chr(1072)+chr(1085)
    komputer = chr(1082)+chr(1086)+chr(1084)+chr(1087)+chr(1100)+chr(1102)+chr(1090)+chr(1077)+chr(1088)
    noutbuk = chr(1085)+chr(1086)+chr(1091)+chr(1090)+chr(1073)+chr(1091)+chr(1082)
    printer_kw = chr(1087)+chr(1088)+chr(1080)+chr(1085)+chr(1090)+chr(1077)+chr(1088)
    monitor_kw = chr(1084)+chr(1086)+chr(1085)+chr(1080)+chr(1090)+chr(1086)+chr(1088)
    stol = chr(1089)+chr(1090)+chr(1086)+chr(1083)
    stul = chr(1089)+chr(1090)+chr(1091)+chr(1083)
    mebel = chr(1084)+chr(1077)+chr(1073)+chr(1077)+chr(1083)
    kondicion = chr(1082)+chr(1086)+chr(1085)+chr(1076)+chr(1080)+chr(1094)+chr(1080)+chr(1086)+chr(1085)
    server_kw = chr(1089)+chr(1077)+chr(1088)+chr(1074)+chr(1077)+chr(1088)
    if oborudovan in d or komputer in d or noutbuk in d or printer_kw in d or monitor_kw in d or stol in d or stul in d or mebel in d or kondicion in d or server_kw in d: return 'office_equipment'
    kantselyar = chr(1082)+chr(1072)+chr(1085)+chr(1094)+chr(1077)+chr(1083)+chr(1103)+chr(1088)
    bumag = chr(1073)+chr(1091)+chr(1084)+chr(1072)+chr(1075)
    kartridzh = chr(1082)+chr(1072)+chr(1088)+chr(1090)+chr(1088)+chr(1080)+chr(1076)+chr(1078)
    toner = chr(1090)+chr(1086)+chr(1085)+chr(1077)+chr(1088)
    if kantselyar in d or bumag in d or kartridzh in d or toner in d: return 'office_supplies'
    khoz = chr(1093)+chr(1086)+chr(1079)
    uborka = chr(1091)+chr(1073)+chr(1086)+chr(1088)+chr(1082)
    kuler = chr(1082)+chr(1091)+chr(1083)+chr(1077)+chr(1088)
    kofe = chr(1082)+chr(1086)+chr(1092)+chr(1077)
    chay = chr(1095)+chr(1072)+chr(1081)
    sakhar = chr(1089)+chr(1072)+chr(1093)+chr(1072)+chr(1088)
    if khoz in d or uborka in d or kuler in d or kofe in d or chay in d or sakhar in d: return 'household'
    elektrich = chr(1101)+chr(1083)+chr(1077)+chr(1082)+chr(1090)+chr(1088)+chr(1080)+chr(1095)
    otoplen = chr(1086)+chr(1090)+chr(1086)+chr(1087)+chr(1083)+chr(1077)+chr(1085)
    kommunal = chr(1082)+chr(1086)+chr(1084)+chr(1084)+chr(1091)+chr(1085)+chr(1072)+chr(1083)
    if elektrich in d or otoplen in d or kommunal in d: return 'utilities'
    predstavit = chr(1087)+chr(1088)+chr(1077)+chr(1076)+chr(1089)+chr(1090)+chr(1072)+chr(1074)+chr(1080)+chr(1090)
    podark = chr(1087)+chr(1086)+chr(1076)+chr(1072)+chr(1088)+chr(1082)
    suvenir = chr(1089)+chr(1091)+chr(1074)+chr(1077)+chr(1085)+chr(1080)+chr(1088)
    korporat = chr(1082)+chr(1086)+chr(1088)+chr(1087)+chr(1086)+chr(1088)+chr(1072)+chr(1090)
    if predstavit in d or podark in d or suvenir in d or korporat in d: return 'representation'
    instrument = chr(1080)+chr(1085)+chr(1089)+chr(1090)+chr(1088)+chr(1091)+chr(1084)+chr(1077)+chr(1085)+chr(1090)
    specodezhd = chr(1089)+chr(1087)+chr(1077)+chr(1094)+chr(1086)+chr(1076)+chr(1077)+chr(1078)+chr(1076)
    svar = chr(1089)+chr(1074)+chr(1072)+chr(1088)
    elektrod = chr(1101)+chr(1083)+chr(1077)+chr(1082)+chr(1090)+chr(1088)+chr(1086)+chr(1076)
    bolt = chr(1073)+chr(1086)+chr(1083)+chr(1090)
    gayk = chr(1075)+chr(1072)+chr(1081)+chr(1082)
    if instrument in d or specodezhd in d or svar in d or elektrod in d or bolt in d or gayk in d: return 'tools'
    ofis = chr(1086)+chr(1092)+chr(1080)+chr(1089)
    obsluzh_to = chr(1086)+chr(1073)+chr(1089)+chr(1083)+chr(1091)+chr(1078)+chr(1080)+chr(1074)+chr(1072)+chr(1085)+chr(1080)+chr(1077)+' '+chr(1090)+chr(1086)
    arend = chr(1072)+chr(1088)+chr(1077)+chr(1085)+chr(1076)
    if o and o != ofis and o != obsluzh_to and arend not in o: return 'project_expense'
    return 'other'

imported = 0
skipped = 0
errors = 0
categories = {}
da_str = chr(1076)+chr(1072)
vypoln = chr(1074)+chr(1099)+chr(1087)+chr(1086)+chr(1083)+chr(1085)+chr(1077)+chr(1085)

for row in data_rows:
    try:
        responsible_doc = row[0] if len(row) > 0 and row[0] else None
        responsible_obj = row[1] if len(row) > 1 and row[1] else None
        object_name = row[2] if len(row) > 2 and row[2] else None
        invoice_number = str(row[3]) if len(row) > 3 and row[3] else None
        invoice_date = row[4] if len(row) > 4 and row[4] else None
        amount = float(row[5]) if len(row) > 5 and row[5] else None
        has_vat_val = row[6] if len(row) > 6 else None
        has_vat = str(has_vat_val or '').lower() == da_str
        supplier = row[7] if len(row) > 7 and row[7] else None
        contract_number = row[10] if len(row) > 10 and row[10] else None
        contract_date = row[11] if len(row) > 11 and row[11] else None
        state = row[14] if len(row) > 14 and row[14] else None
        delivery_comment = row[17] if len(row) > 17 and row[17] else None
        for_customer = row[18] if len(row) > 18 and row[18] else None
        for_asgard = row[19] if len(row) > 19 and row[19] else None
        is_consumable = row[20] if len(row) > 20 and row[20] else None
        closing_number = str(row[21]) if len(row) > 21 and row[21] else None
        closing_date = row[22] if len(row) > 22 and row[22] else None
        closing_amount = float(row[23]) if len(row) > 23 and row[23] else None
        closing_method = row[24] if len(row) > 24 and row[24] else None
        if not amount and not invoice_number and not supplier:
            skipped += 1
            continue
        parsed_date = None
        if invoice_date:
            try:
                parsed_date = datetime.fromisoformat(str(invoice_date).replace('Z','+00:00')).strftime('%Y-%m-%d')
            except Exception:
                try:
                    parsed_date = datetime.strptime(str(invoice_date), '%d.%m.%Y').strftime('%Y-%m-%d')
                except Exception:
                    pass
        hash_str = (invoice_number or '') + '|' + (parsed_date or '') + '|' + str(amount or '') + '|' + (supplier or '')
        import_hash = hashlib.md5(hash_str.encode()).hexdigest()
        cur.execute('SELECT id FROM office_expenses WHERE import_hash = %s', (import_hash,))
        if cur.fetchone():
            skipped += 1
            continue
        cat_desc = (invoice_number or '') + ' ' + (delivery_comment or '')
        category = categorize(object_name, cat_desc, supplier)
        categories[category] = categories.get(category, 0) + 1
        desc_parts = []
        OBJ = chr(1054)+chr(1073)+chr(1098)+chr(1077)+chr(1082)+chr(1090)
        if object_name: desc_parts.append(OBJ+': ' + str(object_name))
        NA_OBJ_ZAK = chr(1053)+chr(1072)+' '+chr(1086)+chr(1073)+chr(1098)+chr(1077)+chr(1082)+chr(1090)+' '+chr(1079)+chr(1072)+chr(1082)+chr(1072)+chr(1079)+chr(1095)+chr(1080)+chr(1082)+chr(1072)
        if for_customer: desc_parts.append(NA_OBJ_ZAK+': ' + str(for_customer))
        SOBSTV = chr(1057)+chr(1086)+chr(1073)+chr(1089)+chr(1090)+chr(1074)+chr(1077)+chr(1085)+chr(1085)+chr(1086)+chr(1089)+chr(1090)+chr(1100)+' '+chr(1040)+chr(1057)+chr(1043)+chr(1040)+chr(1056)+chr(1044)
        if for_asgard: desc_parts.append(SOBSTV)
        RASKH = chr(1056)+chr(1072)+chr(1089)+chr(1093)+chr(1086)+chr(1076)+chr(1085)+chr(1080)+chr(1082)+chr(1080)
        if is_consumable: desc_parts.append(RASKH)
        description = '; '.join(desc_parts) or str(object_name or '')
        notes_parts = []
        OTV_DOK = chr(1054)+chr(1090)+chr(1074)+'. '+chr(1079)+chr(1072)+' '+chr(1076)+chr(1086)+chr(1082)+'.'
        if responsible_doc: notes_parts.append(OTV_DOK+': ' + str(responsible_doc))
        OTV_OBJ = chr(1054)+chr(1090)+chr(1074)+'. '+chr(1079)+chr(1072)+' '+chr(1086)+chr(1073)+chr(1098)+chr(1077)+chr(1082)+chr(1090)+'.'
        if responsible_obj: notes_parts.append(OTV_OBJ+': ' + str(responsible_obj))
        DOGOVOR = chr(1044)+chr(1086)+chr(1075)+chr(1086)+chr(1074)+chr(1086)+chr(1088)
        if contract_number: notes_parts.append(DOGOVOR+': ' + str(contract_number) + ' ' + str(contract_date or ''))
        SOST = chr(1057)+chr(1086)+chr(1089)+chr(1090)+chr(1086)+chr(1103)+chr(1085)+chr(1080)+chr(1077)
        if state: notes_parts.append(SOST+': ' + str(state))
        KOMM = chr(1050)+chr(1086)+chr(1084)+chr(1084)+chr(1077)+chr(1085)+chr(1090)+chr(1072)+chr(1088)+chr(1080)+chr(1081)
        if delivery_comment: notes_parts.append(KOMM+': ' + str(delivery_comment))
        SPOSOB = chr(1057)+chr(1087)+chr(1086)+chr(1089)+chr(1086)+chr(1073)+' '+chr(1087)+chr(1086)+chr(1083)+chr(1091)+chr(1095)+chr(1077)+chr(1085)+chr(1080)+chr(1103)
        if closing_method: notes_parts.append(SPOSOB+': ' + str(closing_method))
        notes = chr(10).join(notes_parts) if notes_parts else None
        status = 'pending'
        if closing_number or closing_amount: status = 'approved'
        if state and vypoln in state.lower(): status = 'approved'
        vat_pct = 20 if has_vat else 0
        vat_amount = round(amount * 20 / 120, 2) if has_vat and amount else 0
        cur.execute('INSERT INTO office_expenses (category, amount, date, description, document_number, counterparty, status, supplier, doc_number, comment, notes, vat_pct, vat_amount, total_amount, number, import_hash, source, created_at) VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,NOW())', (category, amount or 0, parsed_date, description, invoice_number, supplier, status, supplier, closing_number, delivery_comment, notes, vat_pct, vat_amount, closing_amount or amount or 0, invoice_number, import_hash, 'excel_import'))
        imported += 1
    except Exception as e:
        errors += 1
        if errors < 5: print('Row error:', str(e))

conn.commit()
cur.close()
conn.close()
print('Imported:', imported, ', Skipped:', skipped, ', Errors:', errors)
print('Categories:')
for k, v in sorted(categories.items(), key=lambda x: -x[1]):
    print('  ' + k + ': ' + str(v))
