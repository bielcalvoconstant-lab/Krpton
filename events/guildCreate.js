const GuildConfig = require('../models/GuildConfig');

module.exports = {
  name: 'guildCreate',
  async execute(guild) {
    try {
      await GuildConfig.findOneAndUpdate(
        { guildId: guild.id },
        { guildId: guild.id },
        { upsert: true, new: true }
      );
      console.log(`[KRYPTON] Nova guilda adicionada ao banco: ${guild.name} (${guild.id})`);
    } catch (err) {
      console.error('[ERRO] Falha ao inserir registro da guilda no banco:', err);
    }
  }
};
