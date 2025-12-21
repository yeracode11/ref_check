#!/usr/bin/env python3
"""
Скрипт для создания пользователей в базе данных refcheck.
Использует ту же строку подключения, что и сервер.
"""

import os
from pymongo import MongoClient
import bcrypt
import certifi
from datetime import datetime

# Используем ту же переменную окружения, что и сервер
MONGODB_URI = os.environ.get(
    "MONGODB_URI",
    "mongodb+srv://eracode11:Erasoft04@cluster0.jncxfdw.mongodb.net/refcheck?retryWrites=true&w=majority&appName=Cluster0"
)

# Пароль по умолчанию для всех пользователей
DEFAULT_PASSWORD = "12345678"

def hash_password(password):
    """Хеширует пароль с помощью bcrypt"""
    salt = bcrypt.gensalt(10)
    hashed = bcrypt.hashpw(password.encode('utf-8'), salt)
    return hashed.decode('utf-8')

def create_users():
    print("Подключение к MongoDB...")
    print(f"MongoDB URI: {MONGODB_URI.replace('//', '//***:***@' if '@' in MONGODB_URI else '//')}")
    
    client = MongoClient(MONGODB_URI, tlsCAFile=certifi.where())
    db = client.get_database()
    
    print(f"База данных: {db.name}")
    
    users = db["users"]
    cities = db["cities"]
    
    # Проверяем, есть ли города
    city_count = cities.count_documents({})
    print(f"Найдено городов: {city_count}")
    
    # Хешируем пароль по умолчанию
    hashed_password = hash_password(DEFAULT_PASSWORD)
    print(f"\nПароль по умолчанию: {DEFAULT_PASSWORD}")
    
    print("\n" + "=" * 80)
    print("СОЗДАНИЕ ПОЛЬЗОВАТЕЛЕЙ")
    print("=" * 80)
    
    # Получаем все города для маппинга
    city_map = {}
    for city in cities.find({}):
        city_map[city.get("code")] = city["_id"]
    
    # Список пользователей для создания
    users_to_create = [
        {
            "username": "admin",
            "role": "admin",
            "fullName": "Главный админ",
            "active": True,
            "cityId": None
        }
    ]
    
    # Добавляем менеджеров и бухгалтеров для всех городов
    for code, city_id in city_map.items():
        city_doc = cities.find_one({"_id": city_id})
        city_name = city_doc.get("name", "Unknown") if city_doc else "Unknown"
        
        users_to_create.append({
            "username": code,
            "role": "manager",
            "fullName": f"ТП {city_name}",
            "active": True,
            "cityId": city_id
        })
        
        users_to_create.append({
            "username": f"{code}-b",
            "role": "accountant",
            "fullName": f"Бухгалтер {city_name}",
            "active": True,
            "cityId": city_id
        })
    
    created_count = 0
    updated_count = 0
    skipped_count = 0
    errors = []
    
    print(f"\nОбработка {len(users_to_create)} пользователей...\n")
    
    for user_data in users_to_create:
        username = user_data["username"]
        
        try:
            existing_user = users.find_one({"username": username})
            
            if existing_user:
                # Пользователь существует - обновляем пароль и данные
                update_data = {
                    "$set": {
                        "password": hashed_password,
                        "active": user_data["active"],
                        "role": user_data["role"],
                        "fullName": user_data["fullName"],
                        "updatedAt": datetime.now(datetime.UTC) if hasattr(datetime, 'UTC') else datetime.utcnow()
                    }
                }
                
                if user_data.get("cityId"):
                    update_data["$set"]["cityId"] = user_data["cityId"]
                
                result = users.update_one(
                    {"username": username},
                    update_data
                )
                
                if result.modified_count > 0:
                    print(f"✅ Обновлен: {username} ({user_data['role']})")
                    updated_count += 1
                else:
                    print(f"⏭️  Без изменений: {username} ({user_data['role']})")
                    skipped_count += 1
            else:
                # Пользователь не существует - создаем нового
                new_user = {
                    "username": username,
                    "password": hashed_password,
                    "role": user_data["role"],
                    "fullName": user_data["fullName"],
                    "active": user_data["active"],
                    "createdAt": datetime.now(datetime.UTC) if hasattr(datetime, 'UTC') else datetime.utcnow(),
                    "updatedAt": datetime.now(datetime.UTC) if hasattr(datetime, 'UTC') else datetime.utcnow()
                }
                
                if user_data.get("cityId"):
                    new_user["cityId"] = user_data["cityId"]
                
                result = users.insert_one(new_user)
                print(f"✅ Создан: {username} ({user_data['role']}) - ID: {result.inserted_id}")
                created_count += 1
                
        except Exception as e:
            error_msg = f"Ошибка при обработке {username}: {e}"
            print(f"❌ {error_msg}")
            errors.append(error_msg)
    
    print("\n" + "=" * 80)
    print("ИТОГИ")
    print("=" * 80)
    print(f"✅ Создано: {created_count} пользователей")
    print(f"🔄 Обновлено: {updated_count} пользователей")
    print(f"⏭️  Пропущено: {skipped_count} пользователей")
    if errors:
        print(f"\n❌ Ошибок: {len(errors)}")
        for err in errors:
            print(f"   - {err}")
    
    # Проверяем результат
    total_users = users.count_documents({})
    print(f"\n📊 Всего пользователей в базе: {total_users}")
    
    print("\n📝 Учетные данные:")
    print(f"   Пароль для всех: {DEFAULT_PASSWORD}")
    print("\n   Основные пользователи:")
    print(f"      Логин: admin | Пароль: {DEFAULT_PASSWORD} | Роль: admin")
    if city_map:
        first_city_code = list(city_map.keys())[0]
        print(f"      Логин: {first_city_code} | Пароль: {DEFAULT_PASSWORD} | Роль: manager")
        print(f"      Логин: {first_city_code}-b | Пароль: {DEFAULT_PASSWORD} | Роль: accountant")
    print("=" * 80)
    
    client.close()

if __name__ == "__main__":
    create_users()

