#!/usr/bin/env python3
"""
Скрипт для проверки подключения к разным базам данных.
"""

import os
from pymongo import MongoClient
import certifi

# База данных с пользователями
FRIDGE_MANAGER_URI = os.environ.get(
    "FRIDGE_MANAGER_URI",
    "mongodb+srv://eracode11:Erasoft04@cluster0.jncxfdw.mongodb.net/fridge_manager?retryWrites=true&w=majority&appName=Cluster0"
)

# База данных, к которой подключается сервер (refcheck)
REFCHECK_URI = os.environ.get(
    "REFCHECK_URI",
    "mongodb+srv://eracode11:Erasoft04@cluster0.jncxfdw.mongodb.net/refcheck?retryWrites=true&w=majority&appName=Cluster0"
)

def check_database(uri, db_name):
    print(f"\n{'='*80}")
    print(f"Проверка базы данных: {db_name}")
    print(f"{'='*80}")
    
    try:
        client = MongoClient(uri, tlsCAFile=certifi.where())
        db = client.get_database()
        
        print(f"✅ Подключено к базе: {db.name}")
        
        users = db["users"]
        user_count = users.count_documents({})
        print(f"📊 Всего пользователей: {user_count}")
        
        if user_count > 0:
            print("\nПримеры пользователей:")
            sample_users = list(users.find({}, {"username": 1, "role": 1, "active": 1}).limit(5))
            for u in sample_users:
                active_status = "✅" if u.get("active", True) else "❌"
                print(f"  {active_status} {u.get('username')} ({u.get('role')})")
            
            # Проверяем наличие admin
            admin = users.find_one({"username": "admin"})
            if admin:
                print(f"\n✅ Пользователь 'admin' найден")
            else:
                print(f"\n❌ Пользователь 'admin' НЕ найден")
        else:
            print("\n⚠️  База данных пустая - пользователей нет")
        
        client.close()
        return user_count > 0
        
    except Exception as e:
        print(f"❌ Ошибка подключения: {e}")
        return False

if __name__ == "__main__":
    print("Проверка подключения к базам данных")
    print("="*80)
    
    # Проверяем fridge_manager
    has_users_fm = check_database(FRIDGE_MANAGER_URI, "fridge_manager")
    
    # Проверяем refcheck
    has_users_ref = check_database(REFCHECK_URI, "refcheck")
    
    print("\n" + "="*80)
    print("РЕЗУЛЬТАТЫ")
    print("="*80)
    
    if has_users_fm and not has_users_ref:
        print("\n✅ Пользователи находятся в базе 'fridge_manager'")
        print("❌ Сервер подключается к базе 'refcheck' (пустая)")
        print("\n💡 РЕШЕНИЕ:")
        print("   Нужно изменить переменную окружения MONGODB_URI на сервере")
        print("   с 'refcheck' на 'fridge_manager'")
        print("\n   На сервере выполните:")
        print("   export MONGODB_URI='mongodb+srv://...@cluster0...mongodb.net/fridge_manager?retryWrites=true&w=majority&appName=Cluster0'")
        print("   pm2 restart fridge-manager")
    elif has_users_ref:
        print("\n✅ Пользователи находятся в базе 'refcheck'")
    else:
        print("\n⚠️  Пользователи не найдены ни в одной базе данных")

