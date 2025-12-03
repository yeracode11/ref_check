#!/usr/bin/env python3
"""
Скрипт для создания пользователей (менеджеров или админов) в MongoDB Atlas
"""

import sys
from pymongo import MongoClient
import bcrypt
import certifi

# Подключение к MongoDB (Atlas)
client = MongoClient(
    "mongodb+srv://eracode11:Erasoft04@cluster0.jncxfdw.mongodb.net/fridge_manager?retryWrites=true&w=majority&appName=Cluster0",
    tlsCAFile=certifi.where(),
)
db = client["fridge_manager"]
users_collection = db["users"]

def create_user(username, email, password, role="manager", fullName=None):
    """Создать пользователя"""
    # Проверяем, существует ли уже пользователь
    existing_user = users_collection.find_one({"username": username})
    
    if existing_user:
        print(f"❌ Пользователь '{username}' уже существует")
        print(f"   ID: {existing_user['_id']}")
        print(f"   Email: {existing_user.get('email', 'N/A')}")
        print(f"   Роль: {existing_user.get('role', 'N/A')}")
        return False
    
    # Хешируем пароль
    salt = bcrypt.gensalt()
    hashed_password = bcrypt.hashpw(password.encode('utf-8'), salt)
    
    # Создаем пользователя
    user = {
        "username": username,
        "email": email,
        "password": hashed_password.decode('utf-8'),
        "role": role,
        "fullName": fullName or username,
        "active": True
    }
    
    result = users_collection.insert_one(user)
    
    print(f"✅ Пользователь успешно создан!")
    print(f"   ID: {result.inserted_id}")
    print(f"   Username: {username}")
    print(f"   Email: {email}")
    print(f"   Роль: {role}")
    print(f"   Полное имя: {fullName or username}")
    print(f"   Пароль: {password}")
    print(f"\n🔐 Данные для входа:")
    print(f"   Логин: {username}")
    print(f"   Пароль: {password}")
    return True

if __name__ == "__main__":
    if len(sys.argv) < 4:
        print("Использование:")
        print("  python3 create_user.py <username> <email> <password> [role] [fullName]")
        print("\nПримеры:")
        print("  python3 create_user.py manager1 manager1@example.com Password123")
        print("  python3 create_user.py manager1 manager1@example.com Password123 manager 'Иван Иванов'")
        print("  python3 create_user.py admin2 admin2@example.com Admin123! admin 'Второй админ'")
        print("\nРоли: manager (по умолчанию) или admin")
        sys.exit(1)
    
    username = sys.argv[1]
    email = sys.argv[2]
    password = sys.argv[3]
    role = sys.argv[4] if len(sys.argv) > 4 else "manager"
    fullName = sys.argv[5] if len(sys.argv) > 5 else None
    
    if role not in ["manager", "admin"]:
        print(f"❌ Неверная роль: {role}. Используй 'manager' или 'admin'")
        sys.exit(1)
    
    create_user(username, email, password, role, fullName)
    client.close()

