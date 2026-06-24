const { EmbedBuilder, ActionRowBuilder, StringSelectMenuBuilder } = require('discord.js');
const GuildConfig = require('../models/GuildConfig');

/**
 * Sincroniza e edita a mensagem pública ativa no Discord de forma segura.
 * @param {Client} client Instância do cliente do bot.
 * @param {string} guildId ID do servidor do Discord.
 */
async function liveUpdatePanel(client, guildId) {
  const config = await GuildConfig.findOne({ guildId }).catch(() => null);
  if (!config || !config.panelChannelId || !config.panelMessageId) return;

  try {
    const channel = await client.channels.fetch(config.panelChannelId).catch(() => null);
    if (!channel) return;

    const message = await channel.messages.fetch(config.panelMessageId).catch(() => null);
    if (!message) {
      config.panelChannelId = null;
      config.panelMessageId = null;
      await config.save().catch(() => null);
      return;
    }

    const activeCategories = config.categories.filter(cat => cat.active !== false);

    const embed = new EmbedBuilder()
      .setTitle(config.panelEmbed.title)
      .setDescription(config.panelEmbed.description)
      .setColor(config.panelEmbed.color || '#5865F2');

    if (config.panelEmbed.thumbnail) embed.setThumbnail(config.panelEmbed.thumbnail);
    if (config.panelEmbed.image) embed.setImage(config.panelEmbed.image);

    const selectMenu = new StringSelectMenuBuilder()
      .setCustomId('ticket_category_select')
      .setPlaceholder(config.active ? 'Escolha uma categoria para receber atendimento...' : '❌ SISTEMA DE TICKETS DESATIVADO TEMPORARIAMENTE');

    // CORREÇÃO: Impede RangeError se todas as categorias forem ocultadas
    if (activeCategories.length === 0) {
      selectMenu.addOptions({
        label: 'Nenhuma categoria ativa',
        value: 'none_active',
        description: 'Entre em contato com os administradores.'
      });
      selectMenu.setDisabled(true);
    } else {
      selectMenu.addOptions(
        activeCategories.slice(0, 25).map(cat => ({
          label: cat.label,
          description: cat.description || '',
          value: cat.value,
          emoji: cat.emoji || undefined
        }))
      );
      selectMenu.setDisabled(!config.active);
    }

    const row = new ActionRowBuilder().addComponents(selectMenu);
    await message.edit({ embeds: [embed], components: [row] }).catch(() => null);
  } catch (err) {
    console.error('[ERRO LIVE UPDATE]', err.message);
  }
}

module.exports = { liveUpdatePanel };