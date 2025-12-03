import sys
from pymongo import MongoClient
import bcrypt

# Подключение к MongoDB
client = MongoClient("mongodb://localhost:27017/")
db = client["fridge_manager"]
collection = db["users"]

def reset_password(username, new_password):
    """Сброс пароля пользователя"""
    user = collection.find_one({"username": username})
    
    if not user:
        print(f"❌ Пользователь '{username}' не найден")
        return False
    
    # Хешируем новый пароль
    salt = bcrypt.gensalt()
    hashed_password = bcrypt.hashpw(new_password.encode('utf-8'), salt)
    
    # Обновляем пароль
    collection.update_one(
        {"username": username},
        {"$set": {"password": hashed_password.decode('utf-8')}}
    )
    
    print(f"✅ Пароль для пользователя '{username}' успешно изменен!")
    print(f"   Новый пароль: {new_password}")
    return True

def list_users():
    """Список всех пользователей"""
    users = collection.find({}, {"username": 1, "email": 1, "role": 1, "active": 1, "_id": 0})
    print("\n📋 Пользователи в системе:")
    print("=" * 60)
    for user in users:
        status = "✅ Активен" if user.get("active", True) else "❌ Неактивен"
        print(f"👤 {user['username']}")
        print(f"   Email: {user.get('email', 'N/A')}")
        print(f"   Роль: {user.get('role', 'N/A')}")
        print(f"   Статус: {status}")
        print("-" * 60)

if __name__ == "__main__":
    if len(sys.argv) < 2:
        print("Использование:")
        print("  python3 reset_password.py list                    # Показать всех пользователей")
        print("  python3 reset_password.py reset <username> <pass> # Сбросить пароль")
        print("\nПример:")
        print("  python3 reset_password.py reset manager1 password123")
        sys.exit(1)
    
    command = sys.argv[1]
    
    if command == "list":
        list_users()
    elif command == "reset":
        if len(sys.argv) < 4:
            print("❌ Ошибка: укажите username и новый пароль")
            print("Пример: python3 reset_password.py reset manager1 password123")
            sys.exit(1)
        
        username = sys.argv[2]
        new_password = sys.argv[3]
        reset_password(username, new_password)
    else:
        print(f"❌ Неизвестная команда: {command}")
        sys.exit(1)

