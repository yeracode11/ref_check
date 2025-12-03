#!/usr/bin/env python3
"""
Скрипт для создания админа напрямую в MongoDB Atlas
"""

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

# Данные админа
admin_username = "admin"
admin_email = "ersul143@gmail.com"
admin_password = "Admin123!"  # Измени на свой пароль
admin_role = "admin"
admin_fullName = "Главный админ"

# Проверяем, существует ли уже админ
existing_admin = users_collection.find_one({"username": admin_username})

if existing_admin:
    print(f"❌ Пользователь '{admin_username}' уже существует")
    print(f"   ID: {existing_admin['_id']}")
    print(f"   Email: {existing_admin.get('email', 'N/A')}")
    print(f"   Роль: {existing_admin.get('role', 'N/A')}")
    print("\n💡 Используй reset_password.py для смены пароля:")
    print(f"   python3 reset_password.py reset {admin_username} НовыйПароль")
else:
    # Хешируем пароль
    salt = bcrypt.gensalt()
    hashed_password = bcrypt.hashpw(admin_password.encode('utf-8'), salt)
    
    # Создаем админа
    admin_user = {
        "username": admin_username,
        "email": admin_email,
        "password": hashed_password.decode('utf-8'),
        "role": admin_role,
        "fullName": admin_fullName,
        "active": True
    }
    
    result = users_collection.insert_one(admin_user)
    
    print(f"✅ Админ успешно создан!")
    print(f"   ID: {result.inserted_id}")
    print(f"   Username: {admin_username}")
    print(f"   Email: {admin_email}")
    print(f"   Роль: {admin_role}")
    print(f"   Пароль: {admin_password}")
    print(f"\n🔐 Теперь можешь войти на фронтенде:")
    print(f"   Логин: {admin_username}")
    print(f"   Пароль: {admin_password}")

client.close()

