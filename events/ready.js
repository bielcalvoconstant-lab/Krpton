const BotSettings = require('../models/BotSettings');

module.exports = {
  name: 'ready',
  once: true,
  async execute(client) {
    console.log(`[KRYPTON] Online e operando como ${client.user.tag}`);

    try {
      let settings = await BotSettings.findOne({ key: 'global' });
      if (!settings) {
        settings = await BotSettings.create({ key: 'global' });
      }

      // Aplica o status, atividade e biografia salvas de forma unificada no cliente Discord
      client.user.setPresence({
        status: settings.status,
        activities: [{
          name: settings.activityName,
          type: settings.activityType,
          state: settings.activityState // Aplica a Biografia/Status Personalizado do Bot
        }]
      });
      console.log(`[KRYPTON] Atividade persistente aplicada: ${settings.activityName} | Bio: ${settings.activityState} (${settings.status})`);
    } catch (err) {
      console.error('[ERRO READY PRESENCE]', err.message);
    }
  }
};
