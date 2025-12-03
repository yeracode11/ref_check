from pymongo import MongoClient

# Подключение к MongoDB
client = MongoClient("mongodb://localhost:27017/")
db = client["fridge_manager"]
cities_collection = db["cities"]
fridges_collection = db["fridges"]

# Создаем город Тараз
city = {
    "name": "Тараз",
    "code": "taras",
    "active": True
}

# Проверяем, существует ли уже город
existing_city = cities_collection.find_one({"code": "taras"})

if existing_city:
    print(f"✅ Город 'Тараз' уже существует (ID: {existing_city['_id']})")
    city_id = existing_city["_id"]
else:
    # Создаем город
    result = cities_collection.insert_one(city)
    city_id = result.inserted_id
    print(f"✅ Город 'Тараз' создан (ID: {city_id})")

# Привязываем все холодильники к городу Тараз
update_result = fridges_collection.update_many(
    {},
    {"$set": {"cityId": city_id}}
)

print(f"✅ Привязано {update_result.modified_count} холодильников к городу Тараз")
print(f"📊 Всего холодильников в базе: {fridges_collection.count_documents({})}")

client.close()

