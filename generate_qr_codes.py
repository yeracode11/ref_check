#!/usr/bin/env python3
"""
Скрипт для генерации QR-кодов для всех холодильников.
Генерирует QR-коды с URL вида: https://ваш-домен/checkin/{fridge_code}
"""

import os
import qrcode
from PIL import Image, ImageDraw, ImageFont
from pymongo import MongoClient

# Настройки
MONGO_URI = "mongodb+srv://eracode11:Erasoft04@cluster0.jncxfdw.mongodb.net/?appName=Cluster0"
DB_NAME = "fridge_manager"
OUTPUT_DIR = "qr_codes"
BASE_URL = os.getenv("FRONTEND_URL", "https://fridge-frontend.onrender.com")  # Можно задать через переменную окружения

# Создаем директорию для QR-кодов
os.makedirs(OUTPUT_DIR, exist_ok=True)

# Подключение к MongoDB
print("🔌 Подключение к MongoDB...")
client = MongoClient(MONGO_URI)
db = client[DB_NAME]
fridges_collection = db["fridges"]

# Получаем все активные холодильники
print("📦 Загрузка холодильников из базы...")
fridges = list(fridges_collection.find({"active": True}))

if not fridges:
    print("⚠️  Не найдено активных холодильников")
    exit(1)

print(f"✅ Найдено {len(fridges)} холодильников")

# Функция для генерации QR-кода с текстом
def generate_qr_with_text(code: str, name: str, url: str, output_path: str):
    """Генерирует QR-код с подписью (код и название холодильника)"""
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
    
    # Размеры QR-кода
    qr_size = qr_img.size[0]
    
    # Параметры для текста
    padding = 20
    text_height = 80
    img_width = qr_size + (padding * 2)
    img_height = qr_size + text_height + (padding * 2)
    
    # Создаем новое изображение с местом для текста
    final_img = Image.new("RGB", (img_width, img_height), "white")
    
    # Вставляем QR-код
    final_img.paste(qr_img, (padding, padding))
    
    # Добавляем текст
    draw = ImageDraw.Draw(final_img)
    
    # Пытаемся использовать системный шрифт, если не получится - используем дефолтный
    try:
        font_large = ImageFont.truetype("/System/Library/Fonts/Helvetica.ttc", 16)
        font_small = ImageFont.truetype("/System/Library/Fonts/Helvetica.ttc", 12)
    except:
        try:
            font_large = ImageFont.truetype("arial.ttf", 16)
            font_small = ImageFont.truetype("arial.ttf", 12)
        except:
            font_large = ImageFont.load_default()
            font_small = ImageFont.load_default()
    
    # Текст: код холодильника
    code_text = f"#{code}"
    text_bbox = draw.textbbox((0, 0), code_text, font=font_large)
    text_width = text_bbox[2] - text_bbox[0]
    text_x = (img_width - text_width) // 2
    draw.text((text_x, qr_size + padding + 10), code_text, fill="black", font=font_large)
    
    # Текст: название (обрезаем если слишком длинное)
    name_display = name[:30] + "..." if len(name) > 30 else name
    text_bbox = draw.textbbox((0, 0), name_display, font=font_small)
    text_width = text_bbox[2] - text_bbox[0]
    text_x = (img_width - text_width) // 2
    draw.text((text_x, qr_size + padding + 35), name_display, fill="gray", font=font_small)
    
    # Сохраняем
    final_img.save(output_path, "PNG")
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
    
    # Формируем URL
    url = f"{BASE_URL}/checkin/{code}"
    
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
print(f"   export FRONTEND_URL=https://ваш-домен.com")
print(f"   python3 generate_qr_codes.py")

client.close()

