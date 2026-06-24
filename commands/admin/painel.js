const { SlashCommandBuilder, PermissionFlagsBits, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, ChannelSelectMenuBuilder, RoleSelectMenuBuilder, ChannelType } = require('discord.js');
const GuildConfig = require('../../models/GuildConfig');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('painel')
    .setDescription('Central Suprema de Configuração e Controle dos Tickets (Apenas Administradores)')
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
      .setDescription('Selecione abaixo o canal onde a mensagem pública deve aparecer e os cargos staff. Suas alterações são aplicadas instantaneamente!')
      .addFields(
        { name: 'Status do Sistema', value: config.active ? '🟢 **ATIVADO**' : '🔴 **DESATIVADO**', inline: true },
        { name: 'Contador de Tickets', value: `🎫 \`#${String(config.ticketCount || 0).padStart(4, '0')}\``, inline: true },
        { name: 'Canal de Destino', value: config.panelChannelId ? `<#${config.panelChannelId}>` : '❌ Nenhum canal selecionado', inline: true }
      )
      .setColor(config.panelEmbed.color || '#5865F2')
      .setTimestamp();

    // 1. Menu de Seleção de Canal de Destino do Painel Público (Apenas Canais de Texto)
    const selectPanelChannel = new ChannelSelectMenuBuilder()
      .setCustomId('config_select_panel_channel')
      .setPlaceholder('📩 Escolha o canal de texto onde o painel público vai aparecer...')
      .addChannelTypes(ChannelType.GuildText);

    // 2. Menu de Seleção de Cargos Staff (Múltipla Seleção)
    const selectRoles = new RoleSelectMenuBuilder()
      .setCustomId('config_select_roles')
      .setPlaceholder('🛡️ Escolha um ou mais cargos de atendimento (Staff)...')
      .setMinValues(1)
      .setMaxValues(10);

    // 3. Botões administrativos organizados
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

    const btnDesign = new ButtonBuilder()
      .setCustomId('discord_config_panel_unified')
      .setLabel('Aparência do Painel')
      .setStyle(ButtonStyle.Secondary)
      .setEmoji('🎨');

    const btnSendPanel = new ButtonBuilder()
      .setCustomId('config_send_public_panel')
      .setLabel('Gerar Painel de Tickets')
      .setStyle(ButtonStyle.Success)
      .setEmoji('📩');

    // Layout limpo com apenas 3 fileiras de componentes
    const row1 = new ActionRowBuilder().addComponents(selectPanelChannel);
    const row2 = new ActionRowBuilder().addComponents(selectRoles);
    const row3 = new ActionRowBuilder().addComponents(btnToggle, btnToggleCategories, btnDesign, btnSendPanel);

    return interaction.editReply({ embeds: [embed], components: [row1, row2, row3] });
  }
};