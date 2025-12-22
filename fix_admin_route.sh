#!/bin/bash
# Скрипт для исправления файла admin.js на сервере

echo "Проверка файла admin.js на сервере..."
echo ""

# Путь к файлу на сервере
FILE_PATH="/root/ref-check/ref_check/fridge-manager/routes/admin.js"

# Проверяем строку 67
echo "Проверка строки 67:"
sed -n '67p' "$FILE_PATH"
echo ""

# Если строка содержит TypeScript синтаксис, исправляем
if grep -q "let fridgeQuery: any = {}" "$FILE_PATH"; then
    echo "❌ Найдена ошибка: TypeScript синтаксис на строке 67"
    echo "Исправление..."
    
    # Создаем резервную копию
    cp "$FILE_PATH" "${FILE_PATH}.backup.$(date +%Y%m%d_%H%M%S)"
    
    # Исправляем строку 67
    sed -i 's/let fridgeQuery: any = {};/let fridgeQuery = {};/g' "$FILE_PATH"
    
    echo "✅ Файл исправлен!"
    echo ""
    echo "Проверка после исправления:"
    sed -n '67p' "$FILE_PATH"
    echo ""
    echo "Теперь нужно перезапустить PM2:"
    echo "  pm2 stop fridge-manager"
    echo "  pm2 delete fridge-manager"
    echo "  cd /root/ref-check/ref_check/fridge-manager"
    echo "  pm2 start server.js --name fridge-manager"
else
    echo "✅ Файл уже исправлен, строка 67 правильная"
    echo ""
    echo "Но если ошибка все еще есть, попробуйте:"
    echo "  1. pm2 stop fridge-manager"
    echo "  2. pm2 delete fridge-manager"
    echo "  3. pm2 start /root/ref-check/ref_check/fridge-manager/server.js --name fridge-manager"
fi

