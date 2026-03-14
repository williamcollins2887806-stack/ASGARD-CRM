#!/bin/bash

# ASGARD CRM - Скрипт проверки ошибок
# Запуск: bash scripts/check_errors.sh

echo "=============================================="
echo "  ASGARD CRM - ПРОВЕРКА ОШИБОК"
echo "  $(date)"
echo "=============================================="
echo ""

ERRORS_FOUND=0
WARNINGS_FOUND=0

# Цвета для вывода
RED='\033[0;31m'
YELLOW='\033[1;33m'
GREEN='\033[0;32m'
NC='\033[0m' # No Color

check_error() {
    if [ $? -eq 0 ]; then
        echo -e "${RED}[ОШИБКА]${NC} $1"
        ((ERRORS_FOUND++))
    else
        echo -e "${GREEN}[OK]${NC} $1 - не найдено"
    fi
}

check_warning() {
    if [ $? -eq 0 ]; then
        echo -e "${YELLOW}[ВНИМАНИЕ]${NC} $1"
        ((WARNINGS_FOUND++))
    else
        echo -e "${GREEN}[OK]${NC} $1 - не найдено"
    fi
}

echo "========== КРИТИЧЕСКИЕ ОШИБКИ =========="
echo ""

# 1. Проверка telegram.sendMessage в users.js
echo "1. Проверка несуществующего метода telegram.sendMessage..."
grep -n "telegram\.sendMessage" src/routes/users.js 2>/dev/null
check_error "src/routes/users.js: telegram.sendMessage() (метод не существует)"

echo ""

# 2. Проверка LIMIT/OFFSET параметризации
echo "2. Проверка LIMIT/OFFSET параметризации..."

echo "   2a. src/routes/users.js:"
grep -n 'LIMIT \$.*OFFSET \$' src/routes/users.js 2>/dev/null
check_error "   Потенциальная проблема LIMIT/OFFSET"

echo "   2b. src/routes/staff.js:"
grep -n 'LIMIT \$.*OFFSET \$' src/routes/staff.js 2>/dev/null
check_error "   Потенциальная проблема LIMIT/OFFSET"

echo "   2c. src/routes/estimates.js:"
grep -n 'LIMIT \$.*OFFSET \$' src/routes/estimates.js 2>/dev/null
check_error "   Потенциальная проблема LIMIT/OFFSET"

echo "   2d. src/routes/incomes.js:"
grep -n 'LIMIT \$.*OFFSET \$' src/routes/incomes.js 2>/dev/null
check_error "   Потенциальная проблема LIMIT/OFFSET"

echo ""

# 3. Проверка COUNT без WHERE в data.js
echo "3. Проверка COUNT без фильтров в data.js..."
grep -n "SELECT COUNT.*FROM.*\${table}" src/routes/data.js 2>/dev/null | grep -v "WHERE"
check_error "src/routes/data.js: COUNT без WHERE условий"

echo ""

echo "========== ПРОБЛЕМЫ БЕЗОПАСНОСТИ =========="
echo ""

# 4. Docker-compose пароли по умолчанию
echo "4. Проверка паролей по умолчанию в docker-compose.yml..."

echo "   4a. PostgreSQL password:"
grep -n "changeme" docker-compose.yml 2>/dev/null
check_warning "   docker-compose.yml: Default пароль 'changeme'"

echo "   4b. JWT Secret:"
grep -n "change-this-secret-in-production" docker-compose.yml 2>/dev/null
check_warning "   docker-compose.yml: Default JWT secret"

echo "   4c. CORS wildcard:"
grep -n "CORS_ORIGIN.*\*" docker-compose.yml 2>/dev/null
check_warning "   docker-compose.yml: CORS открыт для всех (*)"

echo ""

# 5. Math.random для паролей
echo "5. Проверка небезопасной генерации паролей..."
grep -n "Math\.random" src/routes/auth.js 2>/dev/null
check_warning "src/routes/auth.js: Math.random() для генерации паролей"

echo ""

echo "========== ЛОГИЧЕСКИЕ ОШИБКИ =========="
echo ""

# 6. Условие которое всегда true
echo "6. Проверка бессмысленных условий (x || !x)..."

echo "   6a. mimir_ai.js:"
grep -n "|| \!perms\." public/assets/js/mimir_ai.js 2>/dev/null
check_error "   mimir_ai.js: Условие всегда true"

echo "   6b. notifications_helper.js:"
grep -n "|| \!perms\." public/assets/js/notifications_helper.js 2>/dev/null
check_error "   notifications_helper.js: Условие всегда true"

echo ""

# 7. Бессмысленный тернарный оператор в alerts.js
echo "7. Проверка бессмысленного тернарника в alerts.js..."
grep -n '? "pill" : "pill"' public/assets/js/alerts.js 2>/dev/null
check_error "public/assets/js/alerts.js: Одинаковые значения в тернарнике"

echo ""

# 8. Использование var вместо const/let в db.js
echo "8. Проверка использования var в db.js..."
grep -n "^[[:space:]]*var " public/assets/js/db.js 2>/dev/null
check_warning "public/assets/js/db.js: Использование var вместо const/let"

echo ""

# 9. Проверка shutdown в index.js (telegram не закрывается)
echo "9. Проверка graceful shutdown..."
grep -n "telegram.*stop\|telegram.*close\|bot.*stop" src/index.js 2>/dev/null
if [ $? -ne 0 ]; then
    echo -e "${YELLOW}[ВНИМАНИЕ]${NC} src/index.js: Telegram bot не закрывается при shutdown"
    ((WARNINGS_FOUND++))
else
    echo -e "${GREEN}[OK]${NC} Telegram bot закрывается корректно"
fi

echo ""

# 10. Проверка пустого массива updates в calendar.js
echo "10. Проверка валидации updates в calendar.js..."
grep -n "if.*updates\.length.*==.*0\|if.*\!updates\.length" src/routes/calendar.js 2>/dev/null
if [ $? -ne 0 ]; then
    echo -e "${YELLOW}[ВНИМАНИЕ]${NC} src/routes/calendar.js: Нет проверки пустого массива updates"
    ((WARNINGS_FOUND++))
else
    echo -e "${GREEN}[OK]${NC} Проверка updates присутствует"
fi

echo ""

echo "=============================================="
echo "  ИТОГО"
echo "=============================================="
echo ""
echo -e "Критических ошибок: ${RED}${ERRORS_FOUND}${NC}"
echo -e "Предупреждений:     ${YELLOW}${WARNINGS_FOUND}${NC}"
echo ""

if [ $ERRORS_FOUND -gt 0 ]; then
    echo -e "${RED}Требуется исправление критических ошибок!${NC}"
    exit 1
elif [ $WARNINGS_FOUND -gt 0 ]; then
    echo -e "${YELLOW}Рекомендуется исправить предупреждения${NC}"
    exit 0
else
    echo -e "${GREEN}Все проверки пройдены!${NC}"
    exit 0
fi
