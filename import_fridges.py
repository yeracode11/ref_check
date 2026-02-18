import pandas as pd
import os
import sys
from pymongo import MongoClient
import certifi

MONGODB_URI = os.environ.get("MONGODB_URI")
if not MONGODB_URI:
    print("❌ Не задана переменная окружения MONGODB_URI")
    print("   Пример:")
    print("   export MONGODB_URI='mongodb+srv://<user>:<password>@cluster.../fridge_manager?retryWrites=true&w=majority&appName=Cluster0'")
    sys.exit(1)

# Подключение к MongoDB (Atlas)
client = MongoClient(MONGODB_URI, tlsCAFile=certifi.where())
db = client["fridge_manager"]
collection = db["fridges"]
cities_collection = db["cities"]

# Получаем ID города Тараз (или создаем, если нет)
taras_city = cities_collection.find_one({"code": "taras"})
if not taras_city:
    # Создаем город Тараз, если его нет
    result = cities_collection.insert_one({
        "name": "Тараз",
        "code": "taras",
        "active": True
    })
    city_id = result.inserted_id
    print(f"✅ Создан город Тараз (ID: {city_id})")
else:
    city_id = taras_city["_id"]
    print(f"✅ Используется город Тараз (ID: {city_id})")

print("📖 Чтение Excel файла...")
# Чтение Excel без заголовков
df = pd.read_excel("data/fridges.xlsx", header=None)

# Находим строку с заголовками (обычно строка 5, индексация с 0)
# Данные начинаются со строки 7 (индекс 7)
header_row = 5
data_start_row = 7

# Извлекаем заголовки
headers = df.iloc[header_row].tolist()

# Берем только данные (начиная со строки 7)
df_data = df.iloc[data_start_row:].copy()

# Присваиваем правильные названия колонок
# Нужно проверить структуру: найти колонку "Адрес" и "ТП"
# Временно используем все колонки, потом определим правильные индексы
headers = df.iloc[header_row].tolist()
print(f"📋 Заголовки: {headers}")

# Ищем индексы колонок
address_col_idx = None
tp_col_idx = None
for i, header in enumerate(headers):
    if header and 'Адрес' in str(header):
        address_col_idx = i
    if header and 'ТП' in str(header):
        tp_col_idx = i

print(f"📍 Колонка 'Адрес' найдена на позиции: {address_col_idx}")
print(f"📍 Колонка 'ТП' найдена на позиции: {tp_col_idx}")

# Присваиваем названия колонок (расширяем если нужно)
num_cols = len(df_data.columns)
col_names = [f'col{i}' for i in range(num_cols)]
if address_col_idx is not None:
    col_names[address_col_idx] = 'address'
if tp_col_idx is not None:
    col_names[tp_col_idx] = 'tp'
col_names[1] = 'contractor'  # Контрагент обычно на позиции 1
col_names[2] = 'contract_number'  # Номер дог. обычно на позиции 2
col_names[4] = 'quantity'  # Кол-во обычно на позиции 4
col_names[5] = 'spv'  # СПВ обычно на позиции 5

df_data.columns = col_names[:num_cols]

print(f"📊 Найдено строк в Excel: {len(df_data)}")

# Очистка данных
df_data = df_data.dropna(subset=["address"])  # Удаляем строки без адреса
df_data = df_data.fillna("")  # Заменяем NaN на пустые строки

# Используем df_data вместо df
df = df_data

print(f"📊 Строк с адресами: {len(df)}")

# Преобразуем в записи для MongoDB
records = []
for idx, row in df.iterrows():
    # Генерируем простой числовой код (1, 2, 3...)
    code = str(idx + 1)
    
    # Получаем адрес из колонки "Адрес"
    address = str(row.get('address', '')).strip()
    if not address or address == 'nan':
        address = None
    
    # Получаем ТП из колонки "ТП"
    tp = str(row.get('tp', '')).strip()
    if not tp or tp == 'nan':
        tp = None
    
    # Формируем название из контрагента
    contractor = str(row.get('contractor', '')).strip()
    if contractor and contractor != 'nan':
        name = contractor
    else:
        name = f"Холодильник {idx+1}"
    
    # Формируем описание (включая ТП)
    description_parts = []
    if contract_num and contract_num != 'nan':
        description_parts.append(f"Договор: {contract_num}")
    quantity = str(row.get('quantity', '')).strip()
    if quantity and quantity != 'nan':
        description_parts.append(f"Кол-во: {quantity}")
    spv = str(row.get('spv', '')).strip()
    if spv and spv != 'nan':
        description_parts.append(f"СПВ: {spv}")
    if tp:
        description_parts.append(f"ТП: {tp}")
    description = "; ".join(description_parts) if description_parts else None
    
    # Создаем запись с геолокацией (по умолчанию 0,0 - реальное местоположение придет из чек-инов)
    record = {
        "code": code,
        "name": name[:200],  # Ограничиваем длину
        "cityId": city_id,  # Привязываем к городу Тараз
        # Адрес из Excel не сохраняем как адрес холодильника,
        # он будет появляться из отметок менеджеров
        "address": None,
        "description": description[:500] if description else None,  # ТП здесь
        "location": {
            "type": "Point",
            "coordinates": [0.0, 0.0]  # Временные координаты, нужно обновить через API
        },
        "active": True
    }
    records.append(record)

# Удаляем дубликаты по коду
seen_codes = set()
unique_records = []
for record in records:
    if record["code"] not in seen_codes:
        seen_codes.add(record["code"])
        unique_records.append(record)

print(f"📊 Уникальных записей для импорта: {len(unique_records)}")

# Проверяем существующие записи
existing = collection.count_documents({})
print(f"📊 Существующих записей в БД: {existing}")

# Запись в MongoDB
imported = 0
errors = 0
duplicates = 0

for record in unique_records:
    try:
        # Проверяем, существует ли уже такой код
        if collection.find_one({"code": record["code"]}):
            duplicates += 1
            continue
        collection.insert_one(record)
        imported += 1
        if imported % 100 == 0:
            print(f"  Импортировано: {imported}...")
    except Exception as err:
        errors += 1
        print(f"⚠️ Ошибка при импорте {record['code']}: {err}")

print("\n" + "="*50)
print(f"✅ Успешно импортировано: {imported}")
print(f"⚠️ Пропущено (дубликаты): {duplicates}")
print(f"❌ Ошибок: {errors}")
print(f"📊 Всего в БД теперь: {collection.count_documents({})}")
print("="*50)

# Закрываем соединение
client.close()
