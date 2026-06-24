const mongoose = require('mongoose');

const BotSettingsSchema = new mongoose.Schema({
  key: { type: String, default: 'global', unique: true },
  activityName: { type: String, default: 'Krypton Bot' }, // Título/Atividade
  activityType: { type: Number, default: 4 }, // 4 = Custom Status (Status Personalizado estilo Loritta)
  activityState: { type: String, default: 'Atendimento via Tickets ativo!' }, // Texto do Status
  activityEmoji: { type: String, default: '💎' }, // Emoji do Status personalizado
  status: { type: String, default: 'online' } // online, idle, dnd, invisible
});

module.exports = mongoose.model('BotSettings', BotSettingsSchema);
