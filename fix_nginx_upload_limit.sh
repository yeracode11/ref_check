#!/bin/bash
# Скрипт для увеличения лимита загрузки файлов в nginx

echo "=== Увеличение лимита загрузки файлов в nginx ==="
echo ""

# 1. Находим конфигурацию nginx для вашего сайта
echo "1. Ищем конфигурацию nginx..."
NGINX_CONF=$(find /etc/nginx -name "*stellref*" -o -name "*ref_check*" 2>/dev/null | head -1)

if [ -z "$NGINX_CONF" ]; then
  echo "Конфигурация не найдена автоматически."
  echo "Проверяем основные файлы конфигурации..."
  NGINX_CONF="/etc/nginx/sites-available/default"
fi

echo "Найден файл конфигурации: $NGINX_CONF"
echo ""

# 2. Создаем резервную копию
echo "2. Создаем резервную копию конфигурации..."
sudo cp "$NGINX_CONF" "${NGINX_CONF}.backup.$(date +%Y%m%d_%H%M%S)"
echo "Резервная копия создана"
echo ""

# 3. Добавляем/обновляем client_max_body_size
echo "3. Обновляем client_max_body_size до 100M..."
echo ""
echo "Добавьте следующую строку в блок server { } вашей конфигурации nginx:"
echo ""
echo "    client_max_body_size 100M;"
echo ""
echo "Пример конфигурации:"
echo ""
cat << 'EOF'
server {
    listen 80;
    server_name ваш_домен;

    # Увеличиваем лимит загрузки файлов до 100MB
    client_max_body_size 100M;

    location / {
        proxy_pass http://localhost:5173;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_cache_bypass $http_upgrade;
    }

    location /api {
        proxy_pass http://localhost:5000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_cache_bypass $http_upgrade;
        
        # Таймауты для загрузки больших файлов
        proxy_connect_timeout 300s;
        proxy_send_timeout 300s;
        proxy_read_timeout 300s;
    }
}
EOF
echo ""

# 4. Также добавляем в блок http если нужно
echo "4. Также можно добавить в /etc/nginx/nginx.conf в блок http { }:"
echo ""
echo "    client_max_body_size 100M;"
echo ""

# 5. Инструкции по применению
echo "5. После редактирования конфигурации:"
echo ""
echo "   # Проверьте конфигурацию nginx"
echo "   sudo nginx -t"
echo ""
echo "   # Если всё ОК, перезагрузите nginx"
echo "   sudo systemctl reload nginx"
echo ""
echo "   # Или перезапустите nginx"
echo "   sudo systemctl restart nginx"
echo ""

echo "=== Готово! ==="

