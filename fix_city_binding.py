#!/usr/bin/env python3
"""
Скрипт для диагностики и исправления привязки холодильников к городу
"""

from pymongo import MongoClient
from bson import ObjectId
import certifi

# Подключение к MongoDB (Atlas)
client = MongoClient(
    "mongodb+srv://eracode11:Erasoft04@cluster0.jncxfdw.mongodb.net/fridge_manager?retryWrites=true&w=majority&appName=Cluster0",
    tlsCAFile=certifi.where(),
)
db = client["fridge_manager"]
cities_collection = db["cities"]
fridges_collection = db["fridges"]

# Находим город Тараз
taras_city = cities_collection.find_one({"code": "taras"})

if not taras_city:
    print("❌ Город 'Тараз' не найден!")
    client.close()
    exit(1)

city_id = taras_city["_id"]
print(f"✅ Город 'Тараз' найден (ID: {city_id})")
print(f"   Тип ID: {type(city_id)}")

# Проверяем холодильники
total_fridges = fridges_collection.count_documents({})
print(f"\n📊 Всего холодильников: {total_fridges}")

# Проверяем, сколько уже привязано
fridges_with_city = fridges_collection.count_documents({"cityId": city_id})
print(f"📊 Уже привязано к Тараз: {fridges_with_city}")

# Проверяем холодильники без cityId
fridges_without_city = fridges_collection.count_documents({"cityId": {"$exists": False}})
print(f"📊 Без cityId: {fridges_without_city}")

# Проверяем холодильники с другим cityId
fridges_with_other_city = fridges_collection.count_documents({
    "cityId": {"$exists": True, "$ne": city_id}
})
print(f"📊 С другим cityId: {fridges_with_other_city}")

# Проверяем несколько примеров
print("\n🔍 Примеры холодильников:")
sample = list(fridges_collection.find({}).limit(3))
for f in sample:
    print(f"   Код: {f.get('code')}, cityId: {f.get('cityId')}, тип cityId: {type(f.get('cityId'))}")

# Исправляем: привязываем все холодильники к Тараз
print("\n🔧 Привязываем все холодильники к городу Тараз...")

# Вариант 1: Обновляем те, у которых нет cityId или другой cityId
result1 = fridges_collection.update_many(
    {"cityId": {"$ne": city_id}},
    {"$set": {"cityId": city_id}}
)

print(f"✅ Обновлено холодильников: {result1.modified_count}")

# Проверяем результат
fridges_with_city_after = fridges_collection.count_documents({"cityId": city_id})
print(f"📊 Теперь привязано к Тараз: {fridges_with_city_after}")

client.close()
print("\n✅ Готово!")

