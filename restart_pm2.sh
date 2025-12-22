#!/bin/bash
# Скрипт для полной перезагрузки PM2 процесса с очисткой кэша

echo "=== Полная перезагрузка PM2 процесса fridge-manager ==="
echo ""

# Остановка процесса
echo "1. Остановка процесса..."
pm2 stop fridge-manager 2>/dev/null || pm2 stop fridge-m 2>/dev/null || echo "Процесс не найден или уже остановлен"
sleep 2

# Удаление процесса из PM2 (важно для очистки кэша)
echo "2. Удаление процесса из PM2 (очистка кэша)..."
pm2 delete fridge-manager 2>/dev/null || pm2 delete fridge-m 2>/dev/null || echo "Процесс не найден в PM2"
sleep 2

# Очистка кэша PM2
echo "3. Очистка логов PM2..."
pm2 flush 2>/dev/null || echo "Не удалось очистить логи"

# Проверка файла перед запуском
echo "4. Проверка файла admin.js..."
FILE_PATH="/root/ref-check/ref_check/fridge-manager/routes/admin.js"
if [ -f "$FILE_PATH" ]; then
    echo "   Проверка строки 67:"
    LINE67=$(sed -n '67p' "$FILE_PATH")
    echo "   $LINE67"
    if echo "$LINE67" | grep -q "let fridgeQuery: any"; then
        echo "   ❌ ОШИБКА: Найден TypeScript синтаксис!"
        echo "   Исправление..."
        sed -i 's/let fridgeQuery: any = {};/let fridgeQuery = {};/g' "$FILE_PATH"
        echo "   ✅ Исправлено"
    else
        echo "   ✅ Строка 67 правильная"
    fi
else
    echo "   ⚠️  Файл не найден: $FILE_PATH"
fi

# Переход в директорию проекта
echo "5. Переход в директорию проекта..."
cd /root/ref-check/ref_check/fridge-manager || {
    echo "❌ Ошибка: не удалось перейти в директорию"
    exit 1
}

# Запуск процесса заново
echo "6. Запуск процесса заново..."
if [ -f "server.js" ]; then
    pm2 start server.js --name fridge-manager
elif [ -f "ecosystem.config.js" ]; then
    pm2 start ecosystem.config.js
else
    echo "❌ Ошибка: не найден server.js или ecosystem.config.js"
    exit 1
fi

sleep 2

# Проверка статуса
echo "7. Проверка статуса..."
pm2 status

echo ""
echo "=== Готово! Проверьте логи: ==="
echo "pm2 logs fridge-manager --lines 30"

