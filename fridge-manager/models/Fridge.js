const mongoose = require('mongoose');

const GeoPointSchema = new mongoose.Schema(
  {
    type: {
      type: String,
      enum: ['Point'],
      default: 'Point',
      required: true,
    },
    coordinates: {
      type: [Number], // [lng, lat]
      required: true,
      validate: {
        validator: (value) => Array.isArray(value) && value.length === 2,
        message: 'coordinates must be [lng, lat]',
      },
    },
  },
  { _id: false }
);

// Информация о клиенте (ИП/организация)
const ClientInfoSchema = new mongoose.Schema(
  {
    name: { type: String }, // Название ИП/организации
    inn: { type: String }, // ИНН
    contractNumber: { type: String }, // Номер договора
    contactPhone: { type: String }, // Контактный телефон
    contactPerson: { type: String }, // Контактное лицо
    installDate: { type: Date }, // Дата установки
    notes: { type: String }, // Примечания
  },
  { _id: false }
);

const FridgeSchema = new mongoose.Schema(
  {
    code: { type: String, required: true, unique: true, index: true }, // Короткий код (#1, #2, #3...)
    number: { type: String, unique: true, sparse: true, index: true }, // Длинный номер из Excel (опционально)
    name: { type: String, required: true },
    cityId: { type: mongoose.Schema.Types.ObjectId, ref: 'City', index: true },
    location: { type: GeoPointSchema, index: '2dsphere', required: true },
    address: { type: String },
    description: { type: String },
    active: { type: Boolean, default: true },
    // Статус склада: 'warehouse' (на складе), 'installed' (установлен у клиента), 'returned' (возврат на склад), 'moved' (перемещен)
    warehouseStatus: { 
      type: String, 
      enum: ['warehouse', 'installed', 'returned', 'moved'], 
      default: 'warehouse',
      index: true 
    },
    // Информация о клиенте (заполняется при установке)
    clientInfo: { type: ClientInfoSchema },
    // История изменений статуса склада
    statusHistory: [{
      status: { type: String, enum: ['warehouse', 'installed', 'returned', 'moved'] },
      changedAt: { type: Date, default: Date.now },
      changedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
      notes: { type: String },
    }],
    // Состояние оборудования (сервисный модуль)
    status: {
      type: String,
      enum: ['working', 'broken', 'under_repair'],
      default: 'working',
      index: true,
    },
    // Объект закрыт на каникулы / временно не работает
    isSeasonalClosure: { type: Boolean, default: false },
    // Тип объекта: обычный, школа, режимный
    type: {
      type: String,
      enum: ['regular', 'school', 'restricted'],
      default: 'regular',
      index: true,
    },
    // Дата выявления поломки (для индикации «сложный ремонт»)
    brokenSince: { type: Date },
  },
  { timestamps: true }
);

FridgeSchema.index({ cityId: 1, active: 1, warehouseStatus: 1 });
FridgeSchema.index({ active: 1, cityId: 1, createdAt: -1 });
FridgeSchema.index({ cityId: 1, code: 1 });
FridgeSchema.index({ cityId: 1, number: 1 });

module.exports = mongoose.model('Fridge', FridgeSchema);

