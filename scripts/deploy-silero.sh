#!/bin/bash
# Установка Silero TTS на сервере ASGARD
# Запуск: bash scripts/deploy-silero.sh

set -e
echo "═══ ASGARD Silero TTS Setup ═══"

# 1. Установить зависимости Python
echo "Устанавливаем Python зависимости..."
pip3 install torch --index-url https://download.pytorch.org/whl/cpu \
    --break-system-packages 2>/dev/null || \
pip3 install torch --break-system-packages

pip3 install scipy numpy --break-system-packages

# Проверяем что torch установился
python3 -c "import torch; print(f'PyTorch {torch.__version__} OK')"

# 2. Директория для модели
mkdir -p /var/www/asgard-crm/models
chown www-data:www-data /var/www/asgard-crm/models

# 3. Установить systemd сервис
echo "Устанавливаем systemd сервис..."
cp /var/www/asgard-crm/scripts/silero-tts.service /etc/systemd/system/asgard-silero.service
systemctl daemon-reload
systemctl enable asgard-silero
systemctl start asgard-silero

# 4. Ждём загрузки модели (первый раз скачивает ~100MB)
echo "Ожидаем загрузки модели (первый запуск скачивает ~100MB)..."
for i in $(seq 1 60); do
    STATUS=$(curl -s http://127.0.0.1:8765/health 2>/dev/null || echo '{"status":"loading"}')
    if echo "$STATUS" | grep -q '"ready"'; then
        echo "Silero TTS готов!"
        break
    fi
    echo "  $i/60 ожидаем... $STATUS"
    sleep 3
done

# 5. Тест синтеза
echo "Тест синтеза..."
curl -s -X POST http://127.0.0.1:8765/tts \
    -H 'Content-Type: application/json' \
    -d '{"text":"Асгард на связи, тест синтеза прошел успешно!","speaker":"xenia"}' \
    -o /tmp/silero_test.pcm \
    -w "HTTP %{http_code}, %{size_download} bytes, %{time_total}s\n"

echo "═══ Готово! ═══"
echo ""
echo "Доступные голоса Silero v5_ru:"
echo "  xenia   — женский, тёплый, живой (рекомендуется для Фрейи)"
echo "  aidar   — мужской"
echo "  baya    — женский, чёткий"
echo "  kseniya — женский, нейтральный"
echo "  eugene  — мужской, молодой"
