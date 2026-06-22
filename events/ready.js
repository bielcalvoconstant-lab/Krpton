const { ActivityType } = require('discord.js');

module.exports = {
  name: 'ready',
  once: true,
  execute(client) {
    console.log(`[KRYPTON] Online e operando como ${client.user.tag}`);
    client.user.setActivity('canais de suporte', { type: ActivityType.Watching });
  }
};
