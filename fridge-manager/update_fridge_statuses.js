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
    await mongoose.connect(process.env.MONGODB_URI);
    console.log('Connected to MongoDB');

    const fridges = await Fridge.find({ active: true });
    console.log(`Found ${fridges.length} active fridges`);

    let updated = 0;
    let moved = 0;
    let installed = 0;

    for (const fridge of fridges) {
      const checkins = await Checkin.find({ fridgeId: fridge.code }).sort({ visitedAt: 1 });
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
        fridge.warehouseStatus = newStatus;
        fridge.statusHistory.push({
          status: newStatus,
          changedAt: new Date(),
          changedBy: null,
          notes: `Автоматическое обновление статуса на основе истории отметок`,
        });
        await fridge.save();
        updated++;
        console.log(`Updated fridge ${fridge.code}: ${fridge.warehouseStatus} -> ${newStatus}`);
      }
    }

    console.log(`\nUpdate complete:`);
    console.log(`- Total updated: ${updated}`);
    console.log(`- Moved: ${moved}`);
    console.log(`- Installed: ${installed}`);

    await mongoose.disconnect();
    console.log('Disconnected from MongoDB');
  } catch (error) {
    console.error('Error:', error);
    process.exit(1);
  }
}

updateFridgeStatuses();

