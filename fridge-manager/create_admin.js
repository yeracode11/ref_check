/**
 * Создать пользователя admin или сбросить пароль существующего (роль admin, active: true).
 *
 *   node create_admin.js admin 'НовыйПароль123'
 *
 * Использует MONGODB_URI из .env (с учётом auth, как у приложения).
 */

require('dotenv').config();
const mongoose = require('mongoose');
const User = require('./models/User');

async function main() {
  const username = (process.argv[2] || '').trim();
  const password = process.argv[3];

  if (!username || !password || password.length < 6) {
    console.error('Использование: node create_admin.js <username> <password>');
    console.error('Пароль не короче 6 символов.');
    process.exit(1);
  }

  const uri = process.env.MONGODB_URI || 'mongodb://localhost:27017/fridge_manager';
  console.log('Подключение:', uri.replace(/\/\/[^:]+:[^@]+@/, '//***@'));
  await mongoose.connect(uri);

  let user = await User.findOne({ username });
  if (user) {
    user.password = password;
    user.role = 'admin';
    user.active = true;
    await user.save();
    console.log(`Обновлён пользователь "${username}" (пароль, роль admin, active).`);
  } else {
    await User.create({
      username,
      password,
      role: 'admin',
      active: true,
      fullName: username,
    });
    console.log(`Создан пользователь "${username}" с ролью admin.`);
  }

  await mongoose.disconnect();
  console.log('Готово.');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
