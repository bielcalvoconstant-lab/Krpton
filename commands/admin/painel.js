const { SlashCommandBuilder, PermissionFlagsBits, EmbedBuilder, ActionRowBuilder, StringSelectMenuBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const GuildConfig = require('../../models/GuildConfig');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('painel')
    .setDescription('Envia o painel de suporte no canal atual com opção de configuração')
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),

  async execute(interaction) {
    await interaction.deferReply({ ephemeral: true });
    const { guild, channel } = interaction;

    const config = await GuildConfig.findOne({ guildId: guild.id });
    if (!config || !config.ticketCategory) {
      return interaction.editReply({ content: 'Por favor, configure o bot antes acessando o dashboard web ou utilizando o comando `/config`!' });
    }

    const embed = new EmbedBuilder()
      .setTitle(config.panelEmbed.title)
      .setDescription(config.panelEmbed.description)
      .setColor(config.panelEmbed.color || '#5865F2');

    if (config.panelEmbed.thumbnail) embed.setThumbnail(config.panelEmbed.thumbnail);
    if (config.panelEmbed.image) embed.setImage(config.panelEmbed.image);

    // Seletor de categorias
    const selectMenu = new StringSelectMenuBuilder()
      .setCustomId('ticket_category_select')
      .setPlaceholder('Escolha uma categoria para receber atendimento...')
      .addOptions(
        config.categories.slice(0, 25).map(cat => ({
          label: cat.label,
          description: cat.description || '',
          value: cat.value,
          emoji: cat.emoji || undefined
        }))
      );

    // Botão de acesso rápido à configuração
    const btnConfig = new ButtonBuilder()
      .setCustomId('discord_config_panel')
      .setLabel('Configurar Painel')
      .setStyle(ButtonStyle.Secondary)
      .setEmoji('⚙️');

    const rowSelect = new ActionRowBuilder().addComponents(selectMenu);
    const rowButton = new ActionRowBuilder().addComponents(btnConfig);

    await channel.send({ embeds: [embed], components: [rowSelect, rowButton] });
    return interaction.editReply({ content: 'Painel de suporte enviado com sucesso no canal!' });
  }
};
