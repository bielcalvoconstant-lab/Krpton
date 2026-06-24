const { ActivityType } = require('discord.js');
const BotSettings = require('../models/BotSettings');

module.exports = {
  name: 'ready',
  once: true,
  async execute(client) {
    console.log(`[KRYPTON] Online e operando como ${client.user.tag}`);

    try {
      // Busca as configurações de status persistentes do banco de dados
      let settings = await BotSettings.findOne({ key: 'global' });
      if (!settings) {
        settings = await BotSettings.create({ key: 'global' });
      }

      // Aplica as atividades e status salvos
      client.user.setPresence({
        status: settings.status,
        activities: [{
          name: settings.activityName,
          type: settings.activityType
        }]
      });
      console.log(`[KRYPTON] Atividade persistente aplicada: ${settings.activityName} (${settings.status})`);
    } catch (err) {
      console.error('[ERRO READY PRESENCE]', err.message);
      client.user.setActivity('canais de suporte', { type: ActivityType.Watching });
    }
  }
};
