#!/bin/bash

# Скрипт для запуска MongoDB в Docker

echo "🐳 Запуск MongoDB в Docker..."

# Проверяем, запущен ли уже контейнер
if docker ps | grep -q mongodb; then
    echo "✅ MongoDB уже запущен"
    docker ps | grep mongodb
    exit 0
fi

# Проверяем, существует ли контейнер
if docker ps -a | grep -q mongodb; then
    echo "🔄 Запускаем существующий контейнер..."
    docker start mongodb
else
    echo "🆕 Создаем новый контейнер MongoDB..."
    docker run -d \
      --name mongodb \
      -p 27017:27017 \
      -v ~/mongo-data:/data/db \
      mongo:latest
fi

# Ждем запуска
sleep 2

# Проверяем статус
if docker ps | grep -q mongodb; then
    echo "✅ MongoDB успешно запущен!"
    echo "📍 Подключение: mongodb://localhost:27017"
    echo "📊 База данных: fridge_manager"
else
    echo "❌ Ошибка при запуске MongoDB"
    exit 1
fi

