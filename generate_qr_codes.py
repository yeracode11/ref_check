#!/usr/bin/env python3
"""
Скрипт для генерации QR-кодов для всех холодильников.
Генерирует QR-коды с URL вида: https://fridge-frontend.onrender.com/checkin/{fridge_code}
"""

import os
import qrcode
from PIL import Image, ImageDraw, ImageFont
from pymongo import MongoClient
import certifi

# Настройки
MONGO_URI = "mongodb+srv://eracode11:Erasoft04@cluster0.jncxfdw.mongodb.net/fridge_manager?retryWrites=true&w=majority&appName=Cluster0"
DB_NAME = "fridge_manager"
OUTPUT_DIR = "qr_codes"
BASE_URL = os.getenv("FRONTEND_URL", "https://fridge-frontend.onrender.com")  # Можно задать через переменную окружения

# Создаем директорию для QR-кодов
os.makedirs(OUTPUT_DIR, exist_ok=True)

# Подключение к MongoDB (Atlas)
print("🔌 Подключение к MongoDB...")
client = MongoClient(
    MONGO_URI,
    tlsCAFile=certifi.where(),
)
db = client[DB_NAME]
fridges_collection = db["fridges"]

# Получаем все активные холодильники
print("📦 Загрузка холодильников из базы...")
fridges = list(fridges_collection.find({"active": True}))

if not fridges:
    print("⚠️  Не найдено активных холодильников")
    exit(1)

print(f"✅ Найдено {len(fridges)} холодильников")

# Функция для генерации QR-кода (упрощенная версия без текста)
def generate_qr_with_text(code: str, name: str, url: str, output_path: str):
    """Генерирует QR-код (без текста, чтобы избежать проблем с textbbox)"""
    # Создаем QR-код
    qr = qrcode.QRCode(
        version=1,
        error_correction=qrcode.constants.ERROR_CORRECT_L,
        box_size=10,
        border=4,
    )
    qr.add_data(url)
    qr.make(fit=True)
    
    # Создаем изображение QR-кода
    qr_img = qr.make_image(fill_color="black", back_color="white")
    
    # Сохраняем QR-код напрямую (без текста)
    qr_img.save(output_path, "PNG")
    return output_path

# Генерируем QR-коды
print("\n🎨 Генерация QR-кодов...")
generated = 0
errors = 0

for fridge in fridges:
    code = fridge.get("code")
    name = fridge.get("name", "Холодильник")
    
    if not code:
        print(f"⚠️  Пропущен холодильник без кода: {fridge.get('_id')}")
        errors += 1
        continue
    
    # Формируем URL с правильным кодированием кода
    from urllib.parse import quote
    encoded_code = quote(code, safe='')
    url = f"{BASE_URL}/checkin/{encoded_code}"
    
    # Путь для сохранения
    output_path = os.path.join(OUTPUT_DIR, f"qr_{code}.png")
    
    try:
        generate_qr_with_text(code, name, url, output_path)
        generated += 1
        if generated % 50 == 0:
            print(f"  ✅ Сгенерировано {generated} QR-кодов...")
    except Exception as e:
        print(f"❌ Ошибка при генерации QR для {code}: {e}")
        errors += 1

print(f"\n✅ Готово!")
print(f"   Сгенерировано: {generated} QR-кодов")
print(f"   Ошибок: {errors}")
print(f"   Папка: {os.path.abspath(OUTPUT_DIR)}")
print(f"\n💡 Для изменения базового URL задайте переменную окружения:")
print(f"   export FRONTEND_URL=https://fridge-frontend.onrender.com")
print(f"   python3 generate_qr_codes.py")

client.close()

