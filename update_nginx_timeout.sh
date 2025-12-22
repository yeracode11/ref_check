#!/bin/bash

# Скрипт для обновления таймаутов nginx
# Выполните этот скрипт на сервере с правами root или через sudo

echo "🔧 Обновление таймаутов nginx..."

# Находим конфигурационный файл nginx
NGINX_CONFIG=""
if [ -f "/etc/nginx/sites-available/default" ]; then
    NGINX_CONFIG="/etc/nginx/sites-available/default"
elif [ -f "/etc/nginx/nginx.conf" ]; then
    NGINX_CONFIG="/etc/nginx/nginx.conf"
else
    # Ищем файл с proxy_pass
    NGINX_CONFIG=$(grep -r "proxy_pass" /etc/nginx/sites-available/*.conf 2>/dev/null | head -1 | cut -d: -f1)
    if [ -z "$NGINX_CONFIG" ]; then
        NGINX_CONFIG=$(grep -r "proxy_pass" /etc/nginx/conf.d/*.conf 2>/dev/null | head -1 | cut -d: -f1)
    fi
fi

if [ -z "$NGINX_CONFIG" ]; then
    echo "❌ Не найден конфигурационный файл nginx"
    echo "Пожалуйста, укажите путь к файлу вручную:"
    echo "  sudo nano /etc/nginx/sites-available/stellref.kz"
    exit 1
fi

echo "📄 Найден конфигурационный файл: $NGINX_CONFIG"

# Создаем резервную копию
BACKUP_FILE="${NGINX_CONFIG}.backup.$(date +%Y%m%d_%H%M%S)"
cp "$NGINX_CONFIG" "$BACKUP_FILE"
echo "💾 Создана резервная копия: $BACKUP_FILE"

# Проверяем, есть ли уже эти настройки
if grep -q "proxy_read_timeout" "$NGINX_CONFIG"; then
    echo "⚠️  Настройки таймаутов уже существуют, обновляем..."
    # Обновляем существующие значения
    sed -i 's/proxy_read_timeout.*/proxy_read_timeout 600s;/' "$NGINX_CONFIG"
    sed -i 's/proxy_connect_timeout.*/proxy_connect_timeout 600s;/' "$NGINX_CONFIG"
    sed -i 's/proxy_send_timeout.*/proxy_send_timeout 600s;/' "$NGINX_CONFIG"
else
    echo "➕ Добавляем новые настройки таймаутов..."
    # Находим блок location с proxy_pass и добавляем таймауты
    if grep -q "location.*proxy_pass" "$NGINX_CONFIG"; then
        # Добавляем после proxy_pass
        sed -i '/proxy_pass/a\        proxy_read_timeout 600s;\n        proxy_connect_timeout 600s;\n        proxy_send_timeout 600s;' "$NGINX_CONFIG"
    else
        # Добавляем в секцию server
        sed -i '/server {/a\    proxy_read_timeout 600s;\n    proxy_connect_timeout 600s;\n    proxy_send_timeout 600s;' "$NGINX_CONFIG"
    fi
fi

echo "✅ Конфигурация обновлена"
echo ""
echo "📋 Проверьте конфигурацию:"
echo "   sudo nginx -t"
echo ""
echo "🔄 Если проверка прошла успешно, перезагрузите nginx:"
echo "   sudo systemctl reload nginx"
echo "   # или"
echo "   sudo service nginx reload"
echo ""
echo "📝 Содержимое обновленного файла:"
grep -A 3 "proxy_read_timeout\|proxy_connect_timeout\|proxy_send_timeout" "$NGINX_CONFIG" || echo "Настройки не найдены в файле"

