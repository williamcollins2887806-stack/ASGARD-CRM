-- V205: Чистим company_profile от хардкода оборудования/расходников/ставок.
-- Оборудование и расходники Conductor видит ДИНАМИЧЕСКИ через SQL-запросы к
-- таблицам equipment + products + stock + employees при сборке контекста для AI.
-- В settings.company_profile оставляем ТОЛЬКО что не меняется и нельзя вывести
-- из БД: юридические реквизиты, лицензии, политики, опыт работы с заказчиками,
-- финансовые параметры (НДС, маржа-таргет, ставка кредитной линии).

UPDATE settings
SET value_json = '{
  "name": "ООО Асгард-Сервис",
  "inn": "7736244785",
  "kpp": "770101001",
  "city": "Москва (база), г. Королёв",
  "address": "105082, г. Москва, ул. Большая Почтовая, д. 55/59, стр. 1, пом. 37",
  "registration_okved": "43.29 — производство прочих строительно-монтажных работ",
  "specialization": [
    "гидромеханическая очистка теплообменников",
    "гидродинамическая очистка АВО",
    "химическая промывка",
    "монтаж/демонтаж технологического оборудования",
    "ремонт и обслуживание оборудования химических производств"
  ],
  "licenses": {
    "waste_disposal": {
      "has_own_license": true,
      "description": "Собственная лицензия на утилизацию опасных отходов. НЕ закладывать сторонних утилизаторов в смету — все отходы вывозятся и утилизируются своими силами в счёт договорной цены.",
      "covered_waste_types": ["магнетит Fe3O4", "нефтешлам", "химические остатки промывок", "отработанные растворы"]
    }
  },
  "regulatory_permits": [
    "газоопасные работы (наряд-допуск)",
    "работа на высоте",
    "ПБ-СПГ инструктаж для СПГ-объектов",
    "наряд-допуск для ОПО"
  ],
  "logistics": {
    "main_base_city": "Королёв (МО)",
    "freight_truck_owned": false,
    "freight_subcontractors": ["Деловые Линии", "ПЭК", "СДЭК"]
  },
  "financial_policy": {
    "credit_line_bank": "АО Альфа-Банк",
    "credit_line_rate_annual_pct": 18.0,
    "vat_rate_pct": 22,
    "min_margin_target_pct": 14.3,
    "preferred_margin_pct": 18.0,
    "warranty_reserve_pct_of_revenue": 2.4,
    "overheads_pct_of_direct": 19.3
  },
  "known_customers_experience": [
    {"name": "КАО Азот", "industry": "химия (аммиак)", "city": "Кемерово", "completed_projects": 1, "experience_notes": "Работали с гидромех-очисткой теплообменников 901Г. См. эталон #1."},
    {"name": "Новатэк-Пуровский ЗПК", "industry": "СПГ", "city": "Новый Уренгой", "completed_projects": 0},
    {"name": "ЛУКОЙЛ", "industry": "нефтехимия", "completed_projects": 0}
  ],
  "regional_presence": ["Кемеровская обл.", "ЯНАО", "Москва+МО", "Краснодарский край"],
  "competitive_advantages": [
    "Собственная лицензия на утилизацию опасных отходов",
    "Опыт работы в Ex-зонах химических производств",
    "Полная команда с допусками ПБ-СПГ для СПГ-объектов"
  ],
  "_dynamic_data_sources": {
    "equipment": "SELECT FROM equipment — Conductor запрашивает динамически (реальные позиции склада)",
    "consumables": "SELECT FROM products + stock — расходники с остатками",
    "employees": "SELECT FROM employees — реальный кадровый резерв с квалификациями и ставками",
    "tariff_grid": "SELECT FROM field_tariff_grid — сетка тарифов если есть"
  }
}'::jsonb,
  updated_at = NOW()
WHERE key = 'company_profile';
