const { EmbedBuilder, ActionRowBuilder, StringSelectMenuBuilder } = require('discord.js');
const GuildConfig = require('../models/GuildConfig');

/**
 * Filtra e valida se o texto fornecido é um emoji válido do Discord.
 * Se for texto puro ou inválido, retorna undefined para evitar o erro 50035.
 */
function parseEmoji(emojiStr) {
  if (!emojiStr) return undefined;
  const trimmed = emojiStr.trim();
  if (trimmed === '') return undefined;

  // Se for emoji customizado do Discord (Ex: <:krypton:123456789012345678>)
  const customEmojiRegex = /<?a?:?\w+:(\d+)>?/;
  const match = trimmed.match(customEmojiRegex);
  if (match) {
    return { id: match[1] };
  }

  // Se for apenas letras/números (texto puro), não é um emoji unicode válido
  const textRegex = /^[a-zA-Z0-9\s-_]+$/;
  if (textRegex.test(trimmed)) {
    return undefined;
  }

  return trimmed; // Retorna o emoji unicode diretamente (Ex: ⚠️)
}

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

    if (activeCategories.length === 0) {
      selectMenu.addOptions([{
        label: 'Nenhuma categoria ativa',
        value: 'none_active',
        description: 'Entre em contato com os administradores.'
      }]);
      selectMenu.setDisabled(true);
    } else {
      selectMenu.addOptions(
        activeCategories.slice(0, 25).map(cat => ({
          label: cat.label,
          description: cat.description || '',
          value: cat.value,
          emoji: parseEmoji(cat.emoji) // CORREÇÃO: Aplica a higienização do emoji
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

module.exports = { liveUpdatePanel, parseEmoji };
