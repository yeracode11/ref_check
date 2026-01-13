#!/bin/bash
# Скрипт для увеличения таймаутов nginx для экспорта больших файлов

echo "=== Увеличение таймаутов nginx для экспорта ==="
echo ""

# Находим конфигурацию nginx
NGINX_CONF=""
if [ -f "/etc/nginx/sites-available/stellref.kz" ]; then
    NGINX_CONF="/etc/nginx/sites-available/stellref.kz"
elif [ -f "/etc/nginx/sites-available/default" ]; then
    NGINX_CONF="/etc/nginx/sites-available/default"
elif [ -f "/etc/nginx/nginx.conf" ]; then
    NGINX_CONF="/etc/nginx/nginx.conf"
else
    echo "❌ Конфигурация nginx не найдена автоматически"
    echo "Пожалуйста, укажите путь к файлу вручную"
    exit 1
fi

echo "📄 Найден файл конфигурации: $NGINX_CONF"
echo ""

# Создаем резервную копию
BACKUP_FILE="${NGINX_CONF}.backup.$(date +%Y%m%d_%H%M%S)"
sudo cp "$NGINX_CONF" "$BACKUP_FILE"
echo "💾 Создана резервная копия: $BACKUP_FILE"
echo ""

# Проверяем, есть ли блок location /api
if grep -q "location.*/api" "$NGINX_CONF"; then
    echo "✅ Найден блок location /api"
    
    # Проверяем, есть ли уже таймауты
    if grep -A 10 "location.*/api" "$NGINX_CONF" | grep -q "proxy_read_timeout"; then
        echo "⚠️  Таймауты уже настроены, обновляем значения..."
        # Обновляем существующие значения в блоке location /api
        sudo sed -i '/location.*\/api/,/}/ s/proxy_read_timeout.*/proxy_read_timeout 600s;/' "$NGINX_CONF"
        sudo sed -i '/location.*\/api/,/}/ s/proxy_connect_timeout.*/proxy_connect_timeout 600s;/' "$NGINX_CONF"
        sudo sed -i '/location.*\/api/,/}/ s/proxy_send_timeout.*/proxy_send_timeout 600s;/' "$NGINX_CONF"
    else
        echo "➕ Добавляем таймауты в блок location /api..."
        # Добавляем таймауты после proxy_pass в блоке location /api
        sudo sed -i '/location.*\/api/,/}/ {
            /proxy_pass/a\
        proxy_read_timeout 600s;\
        proxy_connect_timeout 600s;\
        proxy_send_timeout 600s;
        }' "$NGINX_CONF"
    fi
else
    echo "⚠️  Блок location /api не найден, добавляем в секцию server..."
    # Добавляем в секцию server
    if grep -q "proxy_read_timeout" "$NGINX_CONF"; then
        sudo sed -i 's/proxy_read_timeout.*/proxy_read_timeout 600s;/' "$NGINX_CONF"
        sudo sed -i 's/proxy_connect_timeout.*/proxy_connect_timeout 600s;/' "$NGINX_CONF"
        sudo sed -i 's/proxy_send_timeout.*/proxy_send_timeout 600s;/' "$NGINX_CONF"
    else
        sudo sed -i '/server {/a\    proxy_read_timeout 600s;\n    proxy_connect_timeout 600s;\n    proxy_send_timeout 600s;' "$NGINX_CONF"
    fi
fi

echo ""
echo "✅ Конфигурация обновлена"
echo ""
echo "📋 Проверьте конфигурацию:"
echo "   sudo nginx -t"
echo ""
echo "🔄 Если проверка прошла успешно, перезагрузите nginx:"
echo "   sudo systemctl reload nginx"
echo ""
echo "📝 Текущие настройки таймаутов:"
grep -A 5 "proxy_read_timeout\|proxy_connect_timeout\|proxy_send_timeout" "$NGINX_CONF" || echo "Настройки не найдены"

