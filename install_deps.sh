#!/bin/bash
# Скрипт для установки зависимостей Python на сервере

echo "Проверка системы..."

# Проверяем, какая система
if [ -f /etc/os-release ]; then
    . /etc/os-release
    OS=$ID
else
    echo "Не удалось определить систему"
    exit 1
fi

echo "Обнаружена система: $OS"

# Установка pip3 в зависимости от системы
if [ "$OS" = "ubuntu" ] || [ "$OS" = "debian" ]; then
    echo "Установка pip3 для Ubuntu/Debian..."
    sudo apt-get update
    sudo apt-get install -y python3-pip
elif [ "$OS" = "centos" ] || [ "$OS" = "rhel" ] || [ "$OS" = "fedora" ]; then
    echo "Установка pip3 для CentOS/RHEL/Fedora..."
    sudo yum install -y python3-pip
    # Или для новых версий:
    # sudo dnf install -y python3-pip
else
    echo "Попытка установки через python3 -m ensurepip..."
    python3 -m ensurepip --upgrade
fi

# Проверка установки
if command -v pip3 &> /dev/null; then
    echo "✅ pip3 установлен"
    pip3 --version
elif python3 -m pip --version &> /dev/null; then
    echo "✅ pip доступен через python3 -m pip"
    python3 -m pip --version
else
    echo "❌ pip3 не установлен. Попробуйте установить вручную."
    exit 1
fi

# Установка зависимостей
echo ""
echo "Установка зависимостей из requirements.txt..."

# Проверяем, есть ли виртуальное окружение
if [ -d "venv" ]; then
    echo "Использование существующего виртуального окружения..."
    source venv/bin/activate
elif [ -d ".venv" ]; then
    echo "Использование существующего виртуального окружения (.venv)..."
    source .venv/bin/activate
else
    echo "Создание виртуального окружения..."
    python3 -m venv venv
    source venv/bin/activate
fi

# Установка зависимостей
if command -v pip3 &> /dev/null; then
    pip3 install -r requirements.txt
elif python3 -m pip &> /dev/null; then
    python3 -m pip install -r requirements.txt
else
    echo "❌ Не удалось найти pip"
    exit 1
fi

echo ""
echo "✅ Зависимости установлены!"
echo ""
echo "Проверка установки:"
python3 -c "import pymongo; import bcrypt; import certifi; print('✅ Все зависимости установлены')"
echo ""
echo "📝 Для использования скриптов активируйте виртуальное окружение:"
echo "   source venv/bin/activate"
echo "   python3 reset_password.py admin Admin123!"

