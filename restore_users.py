#!/usr/bin/env python3
"""
Скрипт для восстановления пользователей и сброса паролей.
"""

import os
from pymongo import MongoClient
import bcrypt
import certifi
from datetime import datetime

MONGODB_URI = os.environ.get(
    "MONGODB_URI",
    "mongodb+srv://eracode11:Erasoft04@cluster0.jncxfdw.mongodb.net/fridge_manager?retryWrites=true&w=majority&appName=Cluster0"
)

# Пароль по умолчанию для всех пользователей
DEFAULT_PASSWORD = "12345678"

def hash_password(password):
    """Хеширует пароль с помощью bcrypt"""
    salt = bcrypt.gensalt(10)
    hashed = bcrypt.hashpw(password.encode('utf-8'), salt)
    return hashed.decode('utf-8')

def restore_users():
    print("Подключение к MongoDB...")
    client = MongoClient(MONGODB_URI, tlsCAFile=certifi.where())
    db = client["fridge_manager"]
    
    users = db["users"]
    cities = db["cities"]
    
    print("\n" + "=" * 80)
    print("ВОССТАНОВЛЕНИЕ ПОЛЬЗОВАТЕЛЕЙ")
    print("=" * 80)
    
    # Хешируем пароль по умолчанию
    hashed_password = hash_password(DEFAULT_PASSWORD)
    print(f"\nПароль по умолчанию: {DEFAULT_PASSWORD}")
    print(f"Хешированный пароль: {hashed_password[:20]}...")
    
    # Получаем все города для маппинга
    city_map = {}
    for city in cities.find({}):
        city_map[city.get("code")] = city["_id"]
    
    print(f"\nНайдено городов: {len(city_map)}")
    
    # Список пользователей для восстановления
    users_to_restore = [
        {
            "username": "admin",
            "role": "admin",
            "fullName": "Главный админ",
            "active": True,
            "cityId": None
        }
    ]
    
    # Добавляем менеджеров для всех городов
    for code, city_id in city_map.items():
        users_to_restore.append({
            "username": code,
            "role": "manager",
            "fullName": f"ТП {cities.find_one({'_id': city_id}).get('name', 'Unknown')}",
            "active": True,
            "cityId": city_id
        })
        
        users_to_restore.append({
            "username": f"{code}-b",
            "role": "accountant",
            "fullName": f"Бухгалтер {cities.find_one({'_id': city_id}).get('name', 'Unknown')}",
            "active": True,
            "cityId": city_id
        })
    
    restored_count = 0
    updated_count = 0
    skipped_count = 0
    errors = []
    
    print(f"\nОбработка {len(users_to_restore)} пользователей...\n")
    
    for user_data in users_to_restore:
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
                        "updatedAt": datetime.utcnow()
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
                    "createdAt": datetime.utcnow(),
                    "updatedAt": datetime.utcnow()
                }
                
                if user_data.get("cityId"):
                    new_user["cityId"] = user_data["cityId"]
                
                result = users.insert_one(new_user)
                print(f"✅ Создан: {username} ({user_data['role']}) - ID: {result.inserted_id}")
                restored_count += 1
                
        except Exception as e:
            error_msg = f"Ошибка при обработке {username}: {e}"
            print(f"❌ {error_msg}")
            errors.append(error_msg)
    
    print("\n" + "=" * 80)
    print("ИТОГИ")
    print("=" * 80)
    print(f"✅ Создано: {restored_count} пользователей")
    print(f"🔄 Обновлено: {updated_count} пользователей")
    print(f"⏭️  Пропущено: {skipped_count} пользователей")
    if errors:
        print(f"\n❌ Ошибок: {len(errors)}")
        for err in errors:
            print(f"   - {err}")
    
    print("\n📝 Учетные данные:")
    print(f"   Пароль для всех: {DEFAULT_PASSWORD}")
    print("\n   Основные пользователи:")
    print(f"      Логин: admin | Пароль: {DEFAULT_PASSWORD} | Роль: admin")
    print(f"      Логин: 02 | Пароль: {DEFAULT_PASSWORD} | Роль: manager (Алматы)")
    print(f"      Логин: 02-b | Пароль: {DEFAULT_PASSWORD} | Роль: accountant (Алматы)")
    print("=" * 80)
    
    client.close()

if __name__ == "__main__":
    restore_users()

