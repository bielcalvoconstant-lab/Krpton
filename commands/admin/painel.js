const { SlashCommandBuilder, PermissionFlagsBits, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const GuildConfig = require('../../models/GuildConfig');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('painel')
    .setDescription('Central de gerenciamento e configuração dos tickets (Apenas Administradores)')
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),

  async execute(interaction) {
    await interaction.deferReply({ ephemeral: true });
    const { guild } = interaction;

    let config = await GuildConfig.findOne({ guildId: guild.id });
    if (!config) {
      config = await GuildConfig.create({ guildId: guild.id });
    }

    const embed = new EmbedBuilder()
      .setTitle('⚙️ Central de Configuração - Krypton')
      .setDescription('Use os botões interativos abaixo para personalizar a aparência do painel de suporte, editar as categorias ou desativar o sistema.')
      .addFields(
        { name: 'Status do Sistema', value: config.active ? '🟢 **ATIVADO**' : '🔴 **DESATIVADO**', inline: true },
        { name: 'Contador de Tickets', value: `🎫 \`#${String(config.ticketCount || 0).padStart(4, '0')}\``, inline: true },
        { name: 'Canal de Destino', value: config.panelChannelId ? `<#${config.panelChannelId}>` : '❌ Nenhum canal registrado', inline: true }
      )
      .setColor(config.panelEmbed.color || '#5865F2')
      .setTimestamp();

    // Linha 1 de botões: Status e Aparência
    const btnToggle = new ButtonBuilder()
      .setCustomId('config_toggle_active')
      .setLabel(config.active ? 'Desativar Tickets' : 'Ativar Tickets')
      .setStyle(config.active ? ButtonStyle.Danger : ButtonStyle.Success)
      .setEmoji(config.active ? '🔒' : '🔓');

    const btnDesign = new ButtonBuilder()
      .setCustomId('discord_config_panel')
      .setLabel('Editar Texto')
      .setStyle(ButtonStyle.Primary)
      .setEmoji('✍️');

    const btnImages = new ButtonBuilder()
      .setCustomId('discord_config_images')
      .setLabel('Editar Imagens')
      .setStyle(ButtonStyle.Primary)
      .setEmoji('🖼️');

    // Linha 2 de botões: Cores, Categorias e Envio
    const btnColor = new ButtonBuilder()
      .setCustomId('discord_config_color')
      .setLabel('Editar Cor')
      .setStyle(ButtonStyle.Primary)
      .setEmoji('🌈');

    const btnCategories = new ButtonBuilder()
      .setCustomId('discord_config_categories')
      .setLabel('Categorias')
      .setStyle(ButtonStyle.Primary)
      .setEmoji('🏷️');

    const btnSendPanel = new ButtonBuilder()
      .setCustomId('config_send_public_panel')
      .setLabel('Gerar Painel de Tickets')
      .setStyle(ButtonStyle.Secondary)
      .setEmoji('📩');

    const row1 = new ActionRowBuilder().addComponents(btnToggle, btnDesign, btnImages);
    const row2 = new ActionRowBuilder().addComponents(btnColor, btnCategories, btnSendPanel);

    return interaction.editReply({ embeds: [embed], components: [row1, row2] });
  }
};