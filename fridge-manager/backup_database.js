const mongoose = require('mongoose');
const fs = require('fs');
const path = require('path');
require('dotenv').config();
const Fridge = require('./models/Fridge');
const Checkin = require('./models/Checkin');
const City = require('./models/City');
const User = require('./models/User');

/**
 * Скрипт для создания бэкапа базы данных
 * Сохраняет все коллекции в JSON файлы с временной меткой
 */
async function backupDatabase() {
  try {
    console.log('🔌 Подключение к MongoDB...');
    await mongoose.connect(process.env.MONGODB_URI);
    console.log('✓ Подключено к MongoDB\n');

    // Создаем директорию для бэкапов, если её нет
    const backupDir = path.join(__dirname, 'backups');
    if (!fs.existsSync(backupDir)) {
      fs.mkdirSync(backupDir, { recursive: true });
      console.log(`✓ Создана директория для бэкапов: ${backupDir}\n`);
    }

    // Генерируем имя файла с временной меткой
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, -5);
    const backupSubDir = path.join(backupDir, `backup-${timestamp}`);
    fs.mkdirSync(backupSubDir, { recursive: true });
    console.log(`📁 Директория бэкапа: ${backupSubDir}\n`);

    console.log('=== Начало создания бэкапа ===\n');

    // Бэкап холодильников
    console.log('📦 Создание бэкапа холодильников...');
    const fridges = await Fridge.find({}).lean();
    const fridgesBackup = {
      timestamp: new Date().toISOString(),
      count: fridges.length,
      data: fridges
    };
    fs.writeFileSync(
      path.join(backupSubDir, 'fridges.json'),
      JSON.stringify(fridgesBackup, null, 2),
      'utf8'
    );
    console.log(`✓ Сохранено холодильников: ${fridges.length}`);

    // Бэкап отметок (чек-инов)
    console.log('\n📦 Создание бэкапа отметок (чек-инов)...');
    const checkins = await Checkin.find({}).lean();
    const checkinsBackup = {
      timestamp: new Date().toISOString(),
      count: checkins.length,
      data: checkins
    };
    fs.writeFileSync(
      path.join(backupSubDir, 'checkins.json'),
      JSON.stringify(checkinsBackup, null, 2),
      'utf8'
    );
    console.log(`✓ Сохранено отметок: ${checkins.length}`);

    // Бэкап городов
    console.log('\n📦 Создание бэкапа городов...');
    const cities = await City.find({}).lean();
    const citiesBackup = {
      timestamp: new Date().toISOString(),
      count: cities.length,
      data: cities
    };
    fs.writeFileSync(
      path.join(backupSubDir, 'cities.json'),
      JSON.stringify(citiesBackup, null, 2),
      'utf8'
    );
    console.log(`✓ Сохранено городов: ${cities.length}`);

    // Бэкап пользователей (без паролей)
    console.log('\n📦 Создание бэкапа пользователей...');
    const users = await User.find({}).select('-password').lean();
    const usersBackup = {
      timestamp: new Date().toISOString(),
      count: users.length,
      data: users
    };
    fs.writeFileSync(
      path.join(backupSubDir, 'users.json'),
      JSON.stringify(usersBackup, null, 2),
      'utf8'
    );
    console.log(`✓ Сохранено пользователей: ${users.length}`);

    // Создаем файл с информацией о бэкапе
    const backupInfo = {
      timestamp: new Date().toISOString(),
      collections: {
        fridges: fridges.length,
        checkins: checkins.length,
        cities: cities.length,
        users: users.length
      },
      totalRecords: fridges.length + checkins.length + cities.length + users.length,
      description: 'Бэкап перед исправлением warehouseStatus для холодильников с moved'
    };
    fs.writeFileSync(
      path.join(backupSubDir, 'backup-info.json'),
      JSON.stringify(backupInfo, null, 2),
      'utf8'
    );

    console.log('\n=== Итоговая статистика ===');
    console.log(`📁 Директория: ${backupSubDir}`);
    console.log(`📦 Холодильников: ${fridges.length}`);
    console.log(`📝 Отметок: ${checkins.length}`);
    console.log(`🏙️  Городов: ${cities.length}`);
    console.log(`👥 Пользователей: ${users.length}`);
    console.log(`📊 Всего записей: ${fridges.length + checkins.length + cities.length + users.length}`);

    // Вычисляем размер бэкапа
    let totalSize = 0;
    const files = ['fridges.json', 'checkins.json', 'cities.json', 'users.json', 'backup-info.json'];
    files.forEach(file => {
      const filePath = path.join(backupSubDir, file);
      if (fs.existsSync(filePath)) {
        const stats = fs.statSync(filePath);
        totalSize += stats.size;
      }
    });
    const sizeMB = (totalSize / 1024 / 1024).toFixed(2);
    console.log(`💾 Размер бэкапа: ${sizeMB} MB`);

    console.log('\n✅ Бэкап успешно создан!');
    console.log(`📂 Файлы сохранены в: ${backupSubDir}`);

    await mongoose.connection.close();
    console.log('\n✅ Скрипт завершен');

  } catch (error) {
    console.error('❌ Критическая ошибка:', error);
    await mongoose.connection.close();
    process.exit(1);
  }
}

// Запуск скрипта
if (require.main === module) {
  backupDatabase()
    .then(() => {
      console.log('\n✅ Бэкап завершен успешно');
      process.exit(0);
    })
    .catch((error) => {
      console.error('\n❌ Бэкап завершен с ошибкой:', error);
      process.exit(1);
    });
}

module.exports = backupDatabase;
