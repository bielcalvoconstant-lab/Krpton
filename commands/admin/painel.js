const { SlashCommandBuilder, PermissionFlagsBits, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, ChannelSelectMenuBuilder, RoleSelectMenuBuilder, ChannelType } = require('discord.js');
const GuildConfig = require('../../models/GuildConfig');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('painel')
    .setDescription('Painel de Controle completo para gerenciar e customizar os tickets do servidor')
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),

  async execute(interaction) {
    await interaction.deferReply({ ephemeral: true });
    const { guild } = interaction;

    let config = await GuildConfig.findOne({ guildId: guild.id });
    if (!config) {
      config = await GuildConfig.create({ guildId: guild.id });
    }

    const embed = new EmbedBuilder()
      .setTitle('⚙️ Central Suprema de Configuração - Krypton')
      .setDescription('Selecione os canais de destino e cargos de atendimento nos menus abaixo. Suas alterações são aplicadas instantaneamente no banco de dados e sincronizadas com o painel público.')
      .addFields(
        { name: 'Status do Sistema', value: config.active ? '🟢 **ATIVADO**' : '🔴 **DESATIVADO**', inline: true },
        { name: 'Contador de Tickets', value: `🎫 \`#${String(config.ticketCount || 0).padStart(4, '0')}\``, inline: true },
        { name: 'Canal de Destino', value: config.panelChannelId ? `<#${config.panelChannelId}>` : '❌ Nenhum canal registrado', inline: true }
      )
      .setColor(config.panelEmbed.color || '#5865F2')
      .setTimestamp();

    // Menus Nativos do Discord v14 para Seleção de Canais e Cargos
    const selectCategory = new ChannelSelectMenuBuilder()
      .setCustomId('config_select_category')
      .setPlaceholder('📁 Escolha a categoria onde os tickets serão criados...')
      .addChannelTypes(ChannelType.GuildCategory);

    const selectLogs = new ChannelSelectMenuBuilder()
      .setCustomId('config_select_logs')
      .setPlaceholder('📝 Escolha o canal de LOGS de atividade...');

    const selectTranscripts = new ChannelSelectMenuBuilder()
      .setCustomId('config_select_transcripts')
      .setPlaceholder('📜 Escolha o canal de históricos de chat (Transcripts)...');

    const selectRoles = new RoleSelectMenuBuilder()
      .setCustomId('config_select_roles')
      .setPlaceholder('🛡️ Escolha um ou mais cargos de atendimento (Staff)...')
      .setMinValues(1)
      .setMaxValues(10);

    // Botões administrativos (incluindo o novo botão de alternar categorias)
    const btnToggle = new ButtonBuilder()
      .setCustomId('config_toggle_active')
      .setLabel(config.active ? 'Desativar Tickets' : 'Ativar Tickets')
      .setStyle(config.active ? ButtonStyle.Danger : ButtonStyle.Success)
      .setEmoji(config.active ? '🔒' : '🔓');

    const btnToggleCategories = new ButtonBuilder()
      .setCustomId('config_toggle_categories_btn')
      .setLabel('Exibir/Ocultar Botões')
      .setStyle(ButtonStyle.Primary)
      .setEmoji('👁️');

    const btnDesign = new ButtonBuilder().setCustomId('discord_config_panel').setLabel('Editar Texto').setStyle(ButtonStyle.Secondary).setEmoji('✍️');
    const btnImages = new ButtonBuilder().setCustomId('discord_config_images').setLabel('Editar Imagens').setStyle(ButtonStyle.Secondary).setEmoji('🖼️');
    const btnColor = new ButtonBuilder().setCustomId('discord_config_color').setLabel('Editar Cor').setStyle(ButtonStyle.Secondary).setEmoji('🌈');
    const btnSendPanel = new ButtonBuilder().setCustomId('config_send_public_panel').setLabel('Gerar Painel de Tickets').setStyle(ButtonStyle.Secondary).setEmoji('📩');

    const row1 = new ActionRowBuilder().addComponents(selectCategory);
    const row2 = new ActionRowBuilder().addComponents(selectLogs);
    const row3 = new ActionRowBuilder().addComponents(selectTranscripts);
    const row4 = new ActionRowBuilder().addComponents(selectRoles);
    const row5 = new ActionRowBuilder().addComponents(btnToggle, btnToggleCategories, btnDesign, btnImages, btnColor);
    const row6 = new ActionRowBuilder().addComponents(btnSendPanel);

    return interaction.editReply({ embeds: [embed], components: [row1, row2, row3, row4, row5, row6] });
  }
};