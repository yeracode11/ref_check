#!/usr/bin/env python3
"""
Скрипт для обновления кодов холодильников на простую нумерацию (1, 2, 3...)
"""

from pymongo import MongoClient
import certifi

# Подключение к MongoDB (Atlas)
client = MongoClient(
    "mongodb+srv://eracode11:Erasoft04@cluster0.jncxfdw.mongodb.net/fridge_manager?retryWrites=true&w=majority&appName=Cluster0",
    tlsCAFile=certifi.where(),
)
db = client["fridge_manager"]
fridges_collection = db["fridges"]
checkins_collection = db["checkins"]

# Получаем все холодильники, отсортированные по дате создания
fridges = list(fridges_collection.find({}).sort("createdAt", 1))

print(f"📊 Найдено холодильников: {len(fridges)}")

if len(fridges) == 0:
    print("❌ Холодильники не найдены")
    client.close()
    exit(0)

# Создаём маппинг старых кодов на новые
old_to_new_code = {}
for idx, fridge in enumerate(fridges, start=1):
    old_code = fridge.get("code")
    new_code = str(idx)
    old_to_new_code[old_code] = new_code

print(f"\n🔄 Обновление кодов холодильников...")
updated = 0
errors = 0

for old_code, new_code in old_to_new_code.items():
    try:
        # Обновляем код холодильника
        result = fridges_collection.update_one(
            {"code": old_code},
            {"$set": {"code": new_code}}
        )
        
        if result.modified_count > 0:
            # Обновляем все отметки (checkins), которые ссылаются на этот холодильник
            checkins_collection.update_many(
                {"fridgeId": old_code},
                {"$set": {"fridgeId": new_code}}
            )
            updated += 1
            if updated % 100 == 0:
                print(f"  Обновлено: {updated}...")
    except Exception as e:
        errors += 1
        print(f"❌ Ошибка при обновлении {old_code} → {new_code}: {e}")

print(f"\n✅ Готово!")
print(f"   Обновлено холодильников: {updated}")
print(f"   Ошибок: {errors}")

# Проверяем результат
print(f"\n📋 Примеры новых кодов:")
sample = list(fridges_collection.find({}).sort("createdAt", 1).limit(10))
for f in sample:
    print(f"   {f.get('code')} - {f.get('name', 'N/A')[:50]}")

client.close()

