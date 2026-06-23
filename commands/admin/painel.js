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
      .setDescription('Selecione os canais e cargos abaixo para o bot funcionar de forma automatizada. Todas as mudanças são salvas em tempo real no banco de dados!')
      .addFields(
        { name: 'Status do Sistema', value: config.active ? '🟢 **ATIVADO** (Permite abertura)' : '🔴 **DESATIVADO** (Tickets trancados)', inline: true },
        { name: 'Contador de Tickets', value: `🎫 \`#${String(config.ticketCount || 0).padStart(4, '0')}\``, inline: true },
        { name: 'Canal de Destino', value: config.panelChannelId ? `<#${config.panelChannelId}>` : '❌ Nenhum canal registrado', inline: true }
      )
      .setColor(config.panelEmbed.color || '#5865F2')
      .setTimestamp();

    // 1. Menu de Seleção de Categorias de Canais (Onde os canais serão criados)
    const selectCategory = new ChannelSelectMenuBuilder()
      .setCustomId('config_select_category')
      .setPlaceholder('📁 Escolha a categoria onde os tickets serão criados...')
      .addChannelTypes(ChannelType.GuildCategory);

    // 2. Menu de Seleção de Canal de Logs
    const selectLogs = new ChannelSelectMenuBuilder()
      .setCustomId('config_select_logs')
      .setPlaceholder('📝 Escolha o canal de LOGS de atividade...');

    // 3. Menu de Seleção de Canal de Transcripts
    const selectTranscripts = new ChannelSelectMenuBuilder()
      .setCustomId('config_select_transcripts')
      .setPlaceholder('📜 Escolha o canal de históricos de chat (Transcripts)...');

    // 4. Menu de Seleção de Cargos Staff (Múltipla Seleção permitida)
    const selectRoles = new RoleSelectMenuBuilder()
      .setCustomId('config_select_roles')
      .setPlaceholder('🛡️ Escolha um ou mais cargos de atendimento (Staff)...')
      .setMinValues(1)
      .setMaxValues(10);

    // 5. Botões Rápidos de Ativação e Design
    const btnToggle = new ButtonBuilder()
      .setCustomId('config_toggle_active')
      .setLabel(config.active ? 'Desativar Tickets' : 'Ativar Tickets')
      .setStyle(config.active ? ButtonStyle.Danger : ButtonStyle.Success)
      .setEmoji(config.active ? '🔒' : '🔓');

    const btnDesign = new ButtonBuilder().setCustomId('discord_config_panel').setLabel('Editar Texto').setStyle(ButtonStyle.Primary).setEmoji('✍️');
    const btnImages = new ButtonBuilder().setCustomId('discord_config_images').setLabel('Editar Imagens').setStyle(ButtonStyle.Primary).setEmoji('🖼️');
    const btnColor = new ButtonBuilder().setCustomId('discord_config_color').setLabel('Editar Cor').setStyle(ButtonStyle.Primary).setEmoji('🌈');
    const btnSendPanel = new ButtonBuilder().setCustomId('config_send_public_panel').setLabel('Gerar Painel de Tickets').setStyle(ButtonStyle.Secondary).setEmoji('📩');

    const row1 = new ActionRowBuilder().addComponents(selectCategory);
    const row2 = new ActionRowBuilder().addComponents(selectLogs);
    const row3 = new ActionRowBuilder().addComponents(selectTranscripts);
    const row4 = new ActionRowBuilder().addComponents(selectRoles);
    const row5 = new ActionRowBuilder().addComponents(btnToggle, btnDesign, btnImages, btnColor, btnSendPanel);

    return interaction.editReply({ embeds: [embed], components: [row1, row2, row3, row4, row5] });
  }
};