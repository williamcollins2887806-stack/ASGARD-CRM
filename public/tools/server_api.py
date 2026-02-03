"""
АСГАРД CRM — Пример серверного API для синхронизации
====================================================

Этот файл — пример REST API на FastAPI для синхронизации с PostgreSQL.
Разверните на своём сервере и настройте URL в CRM.

Требования:
- Python 3.9+
- pip install fastapi uvicorn psycopg2-binary sqlalchemy

Запуск:
  uvicorn server_api:app --host 0.0.0.0 --port 8000

Переменные окружения:
  DATABASE_URL=postgresql://user:pass@localhost:5432/asgard_crm
  API_KEY=your-secret-key
"""

import os
from datetime import datetime
from typing import Optional, List, Dict, Any
from fastapi import FastAPI, HTTPException, Header, Query
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
import json

# Для реального использования замените на SQLAlchemy + PostgreSQL
# Это упрощённая версия для демонстрации

app = FastAPI(
    title="АСГАРД CRM Sync API",
    description="REST API для синхронизации IndexedDB ↔ PostgreSQL",
    version="1.0.0"
)

# CORS для работы с браузером
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # В продакшене укажите конкретные домены
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Конфигурация
API_KEY = os.getenv("API_KEY", "demo-key-change-me")
DATABASE_URL = os.getenv("DATABASE_URL", "postgresql://localhost:5432/asgard")

# Модели данных
class SyncRequest(BaseModel):
    records: List[Dict[str, Any]]

class SyncResponse(BaseModel):
    records: List[Dict[str, Any]]
    total: int
    since: Optional[str] = None

# Проверка API ключа
def verify_api_key(authorization: Optional[str] = Header(None)):
    if not authorization:
        raise HTTPException(status_code=401, detail="Authorization header required")
    
    token = authorization.replace("Bearer ", "")
    if token != API_KEY:
        raise HTTPException(status_code=403, detail="Invalid API key")
    
    return True

# Health check
@app.get("/health")
async def health():
    return {
        "status": "ok",
        "timestamp": datetime.utcnow().isoformat(),
        "version": "1.0.0"
    }

# Получить записи таблицы (с фильтром по времени)
@app.get("/sync/{table}", response_model=SyncResponse)
async def get_records(
    table: str,
    since: Optional[str] = Query(None, description="ISO timestamp для инкрементальной синхронизации"),
    authorization: str = Header(None)
):
    verify_api_key(authorization)
    
    # Список разрешённых таблиц
    allowed_tables = [
        'users', 'tenders', 'estimates', 'works', 'employees',
        'employee_assignments', 'employee_reviews', 'employee_permits',
        'work_expenses', 'office_expenses', 'customers', 'contracts',
        'seals', 'seal_transfers', 'bonus_requests', 'correspondence',
        'proxies', 'calendar_events', 'notifications', 'documents', 'audit_log'
    ]
    
    if table not in allowed_tables:
        raise HTTPException(status_code=400, detail=f"Table '{table}' not allowed")
    
    # TODO: Реализовать запрос к PostgreSQL
    # Пример с SQLAlchemy:
    # 
    # from sqlalchemy import create_engine, text
    # engine = create_engine(DATABASE_URL)
    # 
    # with engine.connect() as conn:
    #     if since:
    #         query = text(f"SELECT * FROM {table} WHERE updated_at > :since ORDER BY updated_at")
    #         result = conn.execute(query, {"since": since})
    #     else:
    #         query = text(f"SELECT * FROM {table} ORDER BY updated_at")
    #         result = conn.execute(query)
    #     
    #     records = [dict(row) for row in result]
    
    # Заглушка для демо
    records = []
    
    return SyncResponse(
        records=records,
        total=len(records),
        since=since
    )

# Отправить записи в таблицу
@app.post("/sync/{table}")
async def push_records(
    table: str,
    request: SyncRequest,
    authorization: str = Header(None)
):
    verify_api_key(authorization)
    
    # TODO: Реализовать upsert в PostgreSQL
    # Пример:
    #
    # from sqlalchemy import create_engine
    # from sqlalchemy.dialects.postgresql import insert
    # 
    # engine = create_engine(DATABASE_URL)
    # 
    # with engine.connect() as conn:
    #     for record in request.records:
    #         stmt = insert(table_model).values(**record)
    #         stmt = stmt.on_conflict_do_update(
    #             index_elements=['id'],
    #             set_={k: v for k, v in record.items() if k != 'id'}
    #         )
    #         conn.execute(stmt)
    #     conn.commit()
    
    pushed = len(request.records)
    
    return {
        "pushed": pushed,
        "table": table,
        "timestamp": datetime.utcnow().isoformat()
    }

# Получить схему БД (для миграции)
@app.get("/schema")
async def get_schema(authorization: str = Header(None)):
    verify_api_key(authorization)
    
    # Возвращаем структуру таблиц для автосоздания
    schema = {
        "users": {
            "id": "SERIAL PRIMARY KEY",
            "login": "VARCHAR(100) UNIQUE NOT NULL",
            "name": "VARCHAR(255)",
            "role": "VARCHAR(50)",
            "password_hash": "VARCHAR(255)",
            "telegram_chat_id": "VARCHAR(50)",
            "created_at": "TIMESTAMP DEFAULT NOW()",
            "updated_at": "TIMESTAMP DEFAULT NOW()"
        },
        "tenders": {
            "id": "SERIAL PRIMARY KEY",
            "period": "VARCHAR(7)",
            "customer_inn": "VARCHAR(12)",
            "customer_name": "VARCHAR(255)",
            "tender_title": "TEXT",
            "tender_type": "VARCHAR(50)",
            "tender_status": "VARCHAR(50)",
            "tender_price": "DECIMAL(15,2)",
            "responsible_pm_id": "INTEGER REFERENCES users(id)",
            "work_start_plan": "DATE",
            "work_end_plan": "DATE",
            "purchase_url": "TEXT",
            "docs_deadline": "DATE",
            "handoff_at": "TIMESTAMP",
            "created_at": "TIMESTAMP DEFAULT NOW()",
            "updated_at": "TIMESTAMP DEFAULT NOW()"
        },
        # ... другие таблицы аналогично
    }
    
    return schema

# Миграция — создать таблицы
@app.post("/migrate")
async def run_migration(authorization: str = Header(None)):
    verify_api_key(authorization)
    
    # TODO: Создать таблицы в PostgreSQL
    # Используйте Alembic для миграций в продакшене
    
    return {
        "status": "ok",
        "message": "Migration completed",
        "timestamp": datetime.utcnow().isoformat()
    }

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)
