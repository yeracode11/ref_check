#!/usr/bin/env python3
"""
Скрипт для создания бухгалтера в MongoDB Atlas.
Запуск: python create_accountant.py
"""

import os
from pymongo import MongoClient
import bcrypt
import certifi

# MongoDB Atlas URI (замените на свой)
MONGODB_URI = os.environ.get(
    "MONGODB_URI",
    "mongodb+srv://fridge_user:FridgePass123@cluster0.mongodb.net/fridge_manager?retryWrites=true&w=majority"
)

def create_accountant():
    print("Подключение к MongoDB Atlas...")
    client = MongoClient(MONGODB_URI, tlsCAFile=certifi.where())
    db = client.get_database()
    
    users = db["users"]
    cities = db["cities"]
    
    # Получаем город Тараз для привязки бухгалтера
    city = cities.find_one({"code": "taras"})
    city_id = city["_id"] if city else None
    
    print("\nСоздание нового бухгалтера...")
    print("=" * 40)
    
    username = input("Имя пользователя: ").strip()
    if not username:
        print("Ошибка: имя пользователя обязательно")
        return
    
    # Проверяем, существует ли пользователь
    existing = users.find_one({"username": username})
    if existing:
        print(f"Пользователь '{username}' уже существует!")
        return
    
    email = input("Email: ").strip()
    if not email:
        email = f"{username}@example.com"
    
    password = input("Пароль: ").strip()
    if not password:
        print("Ошибка: пароль обязателен")
        return
    
    full_name = input("Полное имя (опционально): ").strip() or username
    
    # Хешируем пароль
    salt = bcrypt.gensalt(10)
    hashed_password = bcrypt.hashpw(password.encode('utf-8'), salt)
    
    # Создаём пользователя
    user_doc = {
        "username": username,
        "email": email,
        "password": hashed_password.decode('utf-8'),
        "role": "accountant",
        "fullName": full_name,
        "active": True,
    }
    
    if city_id:
        user_doc["cityId"] = city_id
        print(f"Привязан к городу: {city['name']}")
    
    result = users.insert_one(user_doc)
    
    print("\n" + "=" * 40)
    print(f"Бухгалтер '{username}' успешно создан!")
    print(f"ID: {result.inserted_id}")
    print(f"Роль: accountant")
    if city_id:
        print(f"Город: {city['name']}")
    print("=" * 40)

if __name__ == "__main__":
    create_accountant()

