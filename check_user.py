#!/usr/bin/env python3
"""
Скрипт для проверки пользователя и пароля в базе данных.
"""

import os
from pymongo import MongoClient
import bcrypt
import certifi

MONGODB_URI = os.environ.get(
    "MONGODB_URI"
)

def check_user(username, password):
    if not MONGODB_URI:
        print("❌ Не задана переменная окружения MONGODB_URI")
        print("   Пример:")
        print("   export MONGODB_URI='mongodb+srv://<user>:<password>@cluster.../fridge_manager?retryWrites=true&w=majority&appName=Cluster0'")
        return
    print("Подключение к MongoDB...")
    client = MongoClient(MONGODB_URI, tlsCAFile=certifi.where())
    db = client["fridge_manager"]
    users = db["users"]
    
    print(f"\nПоиск пользователя: {username}")
    user = users.find_one({"username": username})
    
    if not user:
        print(f"❌ Пользователь '{username}' не найден в базе данных")
        client.close()
        return
    
    print(f"✅ Пользователь найден:")
    print(f"   ID: {user['_id']}")
    print(f"   Username: {user.get('username', 'N/A')}")
    print(f"   Role: {user.get('role', 'N/A')}")
    print(f"   Full Name: {user.get('fullName', 'N/A')}")
    print(f"   Active: {user.get('active', True)}")
    print(f"   City ID: {user.get('cityId', 'N/A')}")
    
    if not user.get('active', True):
        print(f"\n⚠️  ВНИМАНИЕ: Пользователь неактивен!")
    
    # Проверка пароля
    stored_password = user.get('password', '')
    if not stored_password:
        print(f"\n❌ Пароль не найден в базе данных")
        client.close()
        return
    
    print(f"\nПроверка пароля...")
    try:
        # Проверяем, захеширован ли пароль
        if stored_password.startswith('$2b$') or stored_password.startswith('$2a$') or stored_password.startswith('$2y$'):
            # Это bcrypt hash
            is_valid = bcrypt.checkpw(password.encode('utf-8'), stored_password.encode('utf-8'))
            if is_valid:
                print(f"✅ Пароль правильный!")
            else:
                print(f"❌ Пароль неправильный!")
                print(f"\n💡 Попробуйте сбросить пароль или создать нового пользователя")
        else:
            print(f"⚠️  Пароль не захеширован (хранится в открытом виде)")
            if stored_password == password:
                print(f"✅ Пароль совпадает (но не захеширован!)")
            else:
                print(f"❌ Пароль не совпадает")
    except Exception as e:
        print(f"❌ Ошибка при проверке пароля: {e}")
    
    client.close()

if __name__ == "__main__":
    import sys
    
    if len(sys.argv) < 3:
        print("Использование: python3 check_user.py <username> <password>")
        print("\nПример:")
        print("  python3 check_user.py admin admin123")
        sys.exit(1)
    
    username = sys.argv[1]
    password = sys.argv[2]
    
    check_user(username, password)

