const { SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');
const Blacklist = require('../../models/Blacklist');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('blacklist')
    .setDescription('Gerencia a lista negra do sistema de tickets')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageMessages)
    .addSubcommand(sub =>
      sub.setName('add')
        .setDescription('Adiciona um usuário à blacklist')
        .addUserOption(opt => opt.setName('usuario').setDescription('Usuário a ser banido').setRequired(true))
        .addStringOption(opt => opt.setName('motivo').setDescription('Motivo do banimento'))
    )
    .addSubcommand(sub =>
      sub.setName('remove')
        .setDescription('Remove um usuário da blacklist')
        .addUserOption(opt => opt.setName('usuario').setDescription('Usuário a ser removido').setRequired(true))
    ),

  async execute(interaction) {
    const { options, user } = interaction;
    const sub = options.getSubcommand();
    const targetUser = options.getUser('usuario');

    if (sub === 'add') {
      const reason = options.getString('motivo') || 'Nenhuma razão fornecida';
      await Blacklist.findOneAndUpdate(
        { userId: targetUser.id },
        { userId: targetUser.id, reason, addedBy: user.id },
        { upsert: true }
      );
      return interaction.reply({ content: `**${targetUser.tag}** foi adicionado à lista negra de suporte.`, ephemeral: true });
    }

    if (sub === 'remove') {
      const check = await Blacklist.findOneAndDelete({ userId: targetUser.id });
      if (!check) return interaction.reply({ content: 'Este usuário não está na blacklist.', ephemeral: true });

      return interaction.reply({ content: `**${targetUser.tag}** foi removido da lista negra de suporte.`, ephemeral: true });
    }
  }
};
