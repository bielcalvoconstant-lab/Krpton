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

      // Constrói o objeto de atividade suportando o formato Custom Status com Emoji
      const activityPayload = {
        name: settings.activityName || 'Custom Status',
        type: settings.activityType // 4 = Custom Status
      };

      if (settings.activityState) {
        activityPayload.state = settings.activityState; // Texto longo (Ex: "Ganhe SONHOS...")
      }

      if (settings.activityEmoji && settings.activityEmoji.trim() !== '') {
        activityPayload.emoji = { name: settings.activityEmoji.trim() }; // Emoji (Ex: "💎")
      }

      client.user.setPresence({
        status: settings.status,
        activities: [activityPayload]
      });

      console.log(`[KRYPTON] Status Loritta aplicado: [${settings.activityEmoji || ''}] ${settings.activityState || ''} (${settings.status})`);
    } catch (err) {
      console.error('[ERRO READY PRESENCE]', err.message);
    }
  }
};
