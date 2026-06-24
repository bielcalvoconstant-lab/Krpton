const mongoose = require('mongoose');

const BotSettingsSchema = new mongoose.Schema({
  key: { type: String, default: 'global', unique: true },
  activityName: { type: String, default: 'Bora trabalhar!' }, // Texto da atividade (Ex: "suporte")
  activityType: { type: Number, default: 3 }, // 3 = Watching (Assistindo)
  activityState: { type: String, default: 'Krypton | Atendimento Ativo' }, // Biografia / Custom Status personalizado
  status: { type: String, default: 'online' } // online, idle, dnd, invisible
});

module.exports = mongoose.model('BotSettings', BotSettingsSchema);
