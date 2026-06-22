const { SlashCommandBuilder, PermissionFlagsBits, EmbedBuilder } = require('discord.js');
const GuildConfig = require('../../models/GuildConfig');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('config')
    .setDescription('Configurações do sistema de tickets Krypton')
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .addSubcommand(sub =>
      sub.setName('set_roles')
        .setDescription('Define o cargo de staff')
        .addRoleOption(opt => opt.setName('cargo').setDescription('Cargo dos atendentes').setRequired(true))
    )
    .addSubcommand(sub =>
      sub.setName('set_channels')
        .setDescription('Define os canais de log e categoria')
        .addChannelOption(opt => opt.setName('categoria').setDescription('Categoria onde os tickets serão criados').setRequired(true))
        .addChannelOption(opt => opt.setName('logs').setDescription('Canal de logs de auditoria').setRequired(true))
        .addChannelOption(opt => opt.setName('transcripts').setDescription('Canal onde os históricos de chat serão salvos').setRequired(true))
    ),

  async execute(interaction) {
    await interaction.deferReply({ ephemeral: true });
    const { options, guildId } = interaction;
    const sub = options.getSubcommand();

    let config = await GuildConfig.findOne({ guildId });
    if (!config) config = new GuildConfig({ guildId });

    if (sub === 'set_roles') {
      const role = options.getRole('cargo');
      config.staffRoleId = role.id;
      await config.save();

      return interaction.editReply({ content: `Cargo de Atendimento configurado para: <@&${role.id}>` });
    }

    if (sub === 'set_channels') {
      const category = options.getChannel('categoria');
      const logs = options.getChannel('logs');
      const transcripts = options.getChannel('transcripts');

      config.ticketCategory = category.id;
      config.logChannelId = logs.id;
      config.transcriptChannelId = transcripts.id;
      await config.save();

      return interaction.editReply({ 
        content: `Canais configurados:\n- Categoria de Tickets: <#${category.id}>\n- Canal de Logs: <#${logs.id}>\n- Canal de Transcripts: <#${transcripts.id}>`
      });
    }
  }
};
