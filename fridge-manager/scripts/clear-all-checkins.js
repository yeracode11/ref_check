const mongoose = require('mongoose');
const Checkin = require('../models/Checkin');
require('dotenv').config();

const MONGO_URI = process.env.MONGO_URI || 'mongodb://localhost:27017/fridge_manager';

async function clearAllCheckins() {
  try {
    console.log('Подключение к MongoDB...');
    await mongoose.connect(MONGO_URI);
    console.log('✅ Подключено к MongoDB');

    console.log('Удаление всех отметок...');
    const result = await Checkin.deleteMany({});
    
    console.log(`✅ Успешно удалено ${result.deletedCount} отметок`);
    
    await mongoose.disconnect();
    console.log('✅ Отключено от MongoDB');
    process.exit(0);
  } catch (error) {
    console.error('❌ Ошибка:', error);
    process.exit(1);
  }
}

clearAllCheckins();

