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
    // История изменений статуса
    statusHistory: [{
      status: { type: String, enum: ['warehouse', 'installed', 'returned', 'moved'] },
      changedAt: { type: Date, default: Date.now },
      changedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
      notes: { type: String },
    }],
  },
  { timestamps: true }
);

module.exports = mongoose.model('Fridge', FridgeSchema);

