const mongoose = require('mongoose');

const BotSettingsSchema = new mongoose.Schema({
  key: { type: String, default: 'global', unique: true },
  activityName: { type: String, default: 'canais de suporte' },
  activityType: { type: Number, default: 3 }, // 3 = Watching (Assistindo)
  status: { type: String, default: 'online' } // online, idle, dnd, invisible
});

module.exports = mongoose.model('BotSettings', BotSettingsSchema);
