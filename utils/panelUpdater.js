const { EmbedBuilder, ActionRowBuilder, StringSelectMenuBuilder } = require('discord.js');
const GuildConfig = require('../models/GuildConfig');

/**
 * Atualiza o painel público do Discord em tempo real filtrando categorias ativas.
 * @param {Client} client Instância do cliente do bot.
 * @param {string} guildId ID do servidor do Discord.
 */
async function liveUpdatePanel(client, guildId) {
  const config = await GuildConfig.findOne({ guildId });
  if (!config || !config.panelChannelId || !config.panelMessageId) return;

  try {
    const channel = await client.channels.fetch(config.panelChannelId).catch(() => null);
    if (!channel) return;
    const message = await channel.messages.fetch(config.panelMessageId).catch(() => null);
    if (!message) return;

    // FILTRO: Remove do painel qualquer categoria cujo "active" seja falso (Ocultado)
    const activeCategories = config.categories.filter(cat => cat.active !== false);

    const embed = new EmbedBuilder()
      .setTitle(config.panelEmbed.title)
      .setDescription(config.panelEmbed.description)
      .setColor(config.panelEmbed.color || '#5865F2');

    if (config.panelEmbed.thumbnail) embed.setThumbnail(config.panelEmbed.thumbnail);
    if (config.panelEmbed.image) embed.setImage(config.panelEmbed.image);

    const selectMenu = new StringSelectMenuBuilder()
      .setCustomId('ticket_category_select')
      .setPlaceholder(config.active ? 'Escolha uma categoria para receber atendimento...' : '❌ SISTEMA DE TICKETS DESATIVADO TEMPORARIAMENTE')
      .setDisabled(!config.active || activeCategories.length === 0)
      .addOptions(
        activeCategories.slice(0, 25).map(cat => ({
          label: cat.label,
          description: cat.description || '',
          value: cat.value,
          emoji: cat.emoji || undefined
        }))
      );

    const row = new ActionRowBuilder().addComponents(selectMenu);
    await message.edit({ embeds: [embed], components: [row] });
  } catch (err) {
    console.error('[ERRO LIVE UPDATE]', err.message);
  }
}

module.exports = { liveUpdatePanel };