#!/usr/bin/env python3
"""
Скрипт для тестирования логина пользователя.
"""

import os
from pymongo import MongoClient
import bcrypt
import certifi

MONGODB_URI = os.environ.get(
    "MONGODB_URI",
    "mongodb+srv://eracode11:Erasoft04@cluster0.jncxfdw.mongodb.net/fridge_manager?retryWrites=true&w=majority&appName=Cluster0"
)

def test_login(username, password):
    print("Подключение к MongoDB...")
    client = MongoClient(MONGODB_URI, tlsCAFile=certifi.where())
    db = client["fridge_manager"]
    users = db["users"]
    
    print(f"\nТестирование логина для: {username}")
    print("=" * 60)
    
    # Нормализуем username
    normalized_username = username.strip()
    print(f"Нормализованный username: '{normalized_username}'")
    
    # Ищем пользователя
    user = users.find_one({"username": normalized_username})
    
    if not user:
        # Пробуем поиск без учета регистра
        print(f"\nПользователь '{normalized_username}' не найден. Пробую поиск без учета регистра...")
        user = users.find_one({"username": {"$regex": f"^{normalized_username}$", "$options": "i"}})
    
    if not user:
        print(f"\n❌ Пользователь '{username}' не найден в базе данных")
        
        # Показываем примеры пользователей
        print("\nПримеры пользователей в базе:")
        sample_users = list(users.find({}, {"username": 1, "role": 1}).limit(10))
        for u in sample_users:
            print(f"  - {u.get('username')} ({u.get('role')})")
        
        client.close()
        return False
    
    print(f"\n✅ Пользователь найден:")
    print(f"   ID: {user['_id']}")
    print(f"   Username: {user.get('username')}")
    print(f"   Role: {user.get('role')}")
    print(f"   Active: {user.get('active', True)}")
    
    if not user.get('active', True):
        print(f"\n⚠️  ВНИМАНИЕ: Пользователь неактивен!")
        client.close()
        return False
    
    # Проверяем пароль
    stored_password = user.get('password', '')
    if not stored_password:
        print(f"\n❌ Пароль не найден в базе данных")
        client.close()
        return False
    
    print(f"\nПроверка пароля...")
    try:
        # Проверяем, захеширован ли пароль
        if stored_password.startswith('$2b$') or stored_password.startswith('$2a$') or stored_password.startswith('$2y$'):
            # Это bcrypt hash
            is_valid = bcrypt.checkpw(password.encode('utf-8'), stored_password.encode('utf-8'))
            if is_valid:
                print(f"✅ Пароль правильный!")
                print(f"\n✅ Логин успешен!")
                client.close()
                return True
            else:
                print(f"❌ Пароль неправильный!")
                print(f"\n💡 Попробуйте запустить: python3 restore_users.py")
                client.close()
                return False
        else:
            print(f"⚠️  Пароль не захеширован (хранится в открытом виде)")
            if stored_password == password:
                print(f"✅ Пароль совпадает (но не захеширован!)")
                client.close()
                return True
            else:
                print(f"❌ Пароль не совпадает")
                client.close()
                return False
    except Exception as e:
        print(f"❌ Ошибка при проверке пароля: {e}")
        client.close()
        return False

if __name__ == "__main__":
    import sys
    
    if len(sys.argv) < 3:
        print("Использование: python3 test_login.py <username> <password>")
        print("\nПример:")
        print("  python3 test_login.py admin 12345678")
        print("  python3 test_login.py 02 12345678")
        sys.exit(1)
    
    username = sys.argv[1]
    password = sys.argv[2]
    
    success = test_login(username, password)
    sys.exit(0 if success else 1)

