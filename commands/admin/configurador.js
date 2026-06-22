const { SlashCommandBuilder, PermissionFlagsBits, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const GuildConfig = require('../../models/GuildConfig');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('configurador')
    .setDescription('Painel de Configuração Interativo do Bot (Apenas Staff)')
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
      .setDescription('Selecione as opções abaixo para realizar alterações nas configurações em tempo real ou enviar o painel público de atendimento.')
      .addFields(
        { name: 'Status do Sistema', value: config.active ? '🟢 Ativado (Aberto para novos tickets)' : '🔴 Desativado (Fechado para novos tickets)', inline: true },
        { name: 'Múltiplos Cargos Staff', value: config.staffRoleIds.length > 0 ? config.staffRoleIds.map(id => `<@&${id}>`).join(', ') : '⚠️ Nenhum configurado', inline: true },
        { name: 'Canal do Painel Público', value: config.panelChannelId ? `<#${config.panelChannelId}>` : '❌ Nenhum canal registrado', inline: true }
      )
      .setColor('#5865F2')
      .setTimestamp();

    const btnToggle = new ButtonBuilder()
      .setCustomId('config_toggle_active')
      .setLabel(config.active ? 'Desativar Tickets' : 'Ativar Tickets')
      .setStyle(config.active ? ButtonStyle.Danger : ButtonStyle.Success)
      .setEmoji(config.active ? '🔒' : '🔓');

    const btnDesign = new ButtonBuilder()
      .setCustomId('discord_config_panel')
      .setLabel('Editar Design')
      .setStyle(ButtonStyle.Primary)
      .setEmoji('🎨');

    const btnCategories = new ButtonBuilder()
      .setCustomId('discord_config_categories')
      .setLabel('Editar Categorias')
      .setStyle(ButtonStyle.Primary)
      .setEmoji('🏷️');

    const btnSendPanel = new ButtonBuilder()
      .setCustomId('config_send_public_panel')
      .setLabel('Gerar Painel de Tickets')
      .setStyle(ButtonStyle.Secondary)
      .setEmoji('📩');

    const row = new ActionRowBuilder().addComponents(btnToggle, btnDesign, btnCategories, btnSendPanel);

    return interaction.editReply({ embeds: [embed], components: [row] });
  }
};
