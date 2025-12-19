#!/usr/bin/env python3
"""
Скрипт для вывода списка всех пользователей из MongoDB.
"""

import os
from pymongo import MongoClient
import certifi
from datetime import datetime

# MongoDB Atlas URI
MONGODB_URI = os.environ.get(
    "MONGODB_URI",
    "mongodb+srv://eracode11:Erasoft04@cluster0.jncxfdw.mongodb.net/fridge_manager?retryWrites=true&w=majority&appName=Cluster0"
)

def list_users():
    print("Подключение к MongoDB...")
    client = MongoClient(MONGODB_URI, tlsCAFile=certifi.where())
    db = client["fridge_manager"]
    
    users = db["users"]
    cities = db["cities"]
    
    # Получаем всех пользователей
    all_users = list(users.find({}).sort("username", 1))
    
    # Получаем города для маппинга
    city_map = {}
    for city in cities.find({}):
        city_map[str(city["_id"])] = city
    
    print("\n" + "=" * 80)
    print("СПИСОК ПОЛЬЗОВАТЕЛЕЙ")
    print("=" * 80)
    print(f"Всего пользователей: {len(all_users)}\n")
    
    # Группируем по ролям
    admins = []
    accountants = []
    managers = []
    
    for user in all_users:
        role = user.get("role", "manager")
        if role == "admin":
            admins.append(user)
        elif role == "accountant":
            accountants.append(user)
        else:
            managers.append(user)
    
    # Выводим админов
    if admins:
        print("👑 АДМИНИСТРАТОРЫ")
        print("-" * 80)
        for user in admins:
            city_name = ""
            if user.get("cityId"):
                city = city_map.get(str(user["cityId"]))
                if city:
                    city_name = f" | Город: {city.get('name', 'N/A')} ({city.get('code', 'N/A')})"
            
            active = "✅ Активен" if user.get("active", True) else "❌ Неактивен"
            full_name = user.get("fullName", "")
            full_name_str = f" | {full_name}" if full_name else ""
            
            print(f"Логин: {user.get('username', 'N/A')}{full_name_str} | Роль: {user.get('role', 'N/A')}{city_name} | {active}")
        print()
    
    # Выводим бухгалтеров
    if accountants:
        print("📊 БУХГАЛТЕРЫ")
        print("-" * 80)
        for user in accountants:
            city_name = ""
            if user.get("cityId"):
                city = city_map.get(str(user["cityId"]))
                if city:
                    city_name = f" | Город: {city.get('name', 'N/A')} ({city.get('code', 'N/A')})"
            
            active = "✅ Активен" if user.get("active", True) else "❌ Неактивен"
            full_name = user.get("fullName", "")
            full_name_str = f" | {full_name}" if full_name else ""
            
            print(f"Логин: {user.get('username', 'N/A')}{full_name_str} | Роль: {user.get('role', 'N/A')}{city_name} | {active}")
        print()
    
    # Выводим менеджеров
    if managers:
        print("👤 МЕНЕДЖЕРЫ")
        print("-" * 80)
        for user in managers:
            city_name = ""
            if user.get("cityId"):
                city = city_map.get(str(user["cityId"]))
                if city:
                    city_name = f" | Город: {city.get('name', 'N/A')} ({city.get('code', 'N/A')})"
            
            active = "✅ Активен" if user.get("active", True) else "❌ Неактивен"
            full_name = user.get("fullName", "")
            full_name_str = f" | {full_name}" if full_name else ""
            
            print(f"Логин: {user.get('username', 'N/A')}{full_name_str} | Роль: {user.get('role', 'N/A')}{city_name} | {active}")
        print()
    
    # Итоговая статистика
    print("=" * 80)
    print("СТАТИСТИКА")
    print("=" * 80)
    print(f"Всего: {len(all_users)}")
    print(f"  - Администраторов: {len(admins)}")
    print(f"  - Бухгалтеров: {len(accountants)}")
    print(f"  - Менеджеров: {len(managers)}")
    print("=" * 80)
    
    # Простой список для копирования
    print("\n📋 ПРОСТОЙ СПИСОК (для копирования):")
    print("-" * 80)
    for user in all_users:
        role_icon = "👑" if user.get("role") == "admin" else "📊" if user.get("role") == "accountant" else "👤"
        city_name = ""
        if user.get("cityId"):
            city = city_map.get(str(user["cityId"]))
            if city:
                city_name = f" [{city.get('name', 'N/A')}]"
        print(f"{role_icon} {user.get('username', 'N/A')} - {user.get('role', 'N/A')}{city_name}")
    
    print("=" * 80)
    
    client.close()

if __name__ == "__main__":
    list_users()

