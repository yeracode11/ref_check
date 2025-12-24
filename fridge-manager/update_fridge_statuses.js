require('dotenv').config();
const mongoose = require('mongoose');
const Fridge = require('./models/Fridge');
const Checkin = require('./models/Checkin');

// Функция для вычисления расстояния между двумя точками (в метрах)
function calculateDistance(loc1, loc2) {
  if (!loc1 || !loc2 || !loc1.coordinates || !loc2.coordinates) {
    return null;
  }
  const [lng1, lat1] = loc1.coordinates;
  const [lng2, lat2] = loc2.coordinates;
  
  const R = 6371000; // Радиус Земли в метрах
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLng = (lng2 - lng1) * Math.PI / 180;
  const a = 
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
    Math.sin(dLng / 2) * Math.sin(dLng / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

async function updateFridgeStatuses() {
  try {
    // Увеличиваем таймауты для MongoDB
    const mongooseOptions = {
      serverSelectionTimeoutMS: 60000,
      socketTimeoutMS: 60000,
      connectTimeoutMS: 60000,
    };
    
    await mongoose.connect(process.env.MONGODB_URI, mongooseOptions);
    console.log('Connected to MongoDB');

    const fridges = await Fridge.find({ active: true }).lean();
    console.log(`Found ${fridges.length} active fridges`);

    let updated = 0;
    let moved = 0;
    let installed = 0;
    let errors = 0;
    const batchSize = 50; // Обрабатываем по 50 холодильников за раз

    for (let i = 0; i < fridges.length; i += batchSize) {
      const batch = fridges.slice(i, i + batchSize);
      console.log(`Processing batch ${Math.floor(i / batchSize) + 1}/${Math.ceil(fridges.length / batchSize)} (${i + 1}-${Math.min(i + batchSize, fridges.length)} of ${fridges.length})`);

      for (const fridge of batch) {
        try {
          const checkins = await Checkin.find({ fridgeId: fridge.code }).sort({ visitedAt: 1 }).lean();
          const totalCheckins = checkins.length;

          if (totalCheckins === 0) {
            // Нет отметок - оставляем текущий статус
            continue;
          }

          let newStatus = fridge.warehouseStatus;

          if (totalCheckins === 1) {
            // Первая отметка - должен быть "installed"
            if (fridge.warehouseStatus === 'warehouse' || fridge.warehouseStatus === 'returned') {
              newStatus = 'installed';
              installed++;
            }
          } else if (totalCheckins >= 2) {
            // Вторая и последующие отметки - проверяем перемещение
            const firstLocation = checkins[0].location;
            const lastLocation = checkins[checkins.length - 1].location;

            if (firstLocation && lastLocation) {
              const distance = calculateDistance(firstLocation, lastLocation);
              if (distance !== null && distance > 50) {
                // Местоположение изменилось более чем на 50 метров
                newStatus = 'moved';
                moved++;
              } else if (fridge.warehouseStatus === 'warehouse' || fridge.warehouseStatus === 'returned') {
                // Если еще не установлен, устанавливаем
                newStatus = 'installed';
                installed++;
              }
            }
          }

          if (newStatus !== fridge.warehouseStatus) {
            await Fridge.findByIdAndUpdate(fridge._id, {
              $set: { warehouseStatus: newStatus },
              $push: {
                statusHistory: {
                  status: newStatus,
                  changedAt: new Date(),
                  changedBy: null,
                  notes: `Автоматическое обновление статуса на основе истории отметок`,
                }
              }
            });
            updated++;
            if (updated % 10 === 0) {
              console.log(`  Updated ${updated} fridges so far...`);
            }
          }
        } catch (error) {
          errors++;
          console.error(`Error processing fridge ${fridge.code}:`, error.message);
        }
      }

      // Небольшая пауза между батчами
      if (i + batchSize < fridges.length) {
        await new Promise(resolve => setTimeout(resolve, 100));
      }
    }

    console.log(`\nUpdate complete:`);
    console.log(`- Total updated: ${updated}`);
    console.log(`- Moved: ${moved}`);
    console.log(`- Installed: ${installed}`);
    console.log(`- Errors: ${errors}`);

    await mongoose.disconnect();
    console.log('Disconnected from MongoDB');
  } catch (error) {
    console.error('Error:', error);
    process.exit(1);
  }
}

updateFridgeStatuses();

