const { 
  EmbedBuilder, 
  ButtonBuilder, 
  ActionRowBuilder, 
  ButtonStyle, 
  PermissionFlagsBits, 
  ChannelType,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  StringSelectMenuBuilder
} = require('discord.js');
const GuildConfig = require('../models/GuildConfig');
const Ticket = require('../models/Ticket');
const Blacklist = require('../models/Blacklist');
const { createTranscript } = require('../utils/transcript');
const { liveUpdatePanel } = require('../utils/panelUpdater');

module.exports = {
  name: 'interactionCreate',
  async execute(interaction, client) {
    const { guild, member, user } = interaction;

    // --- EXECUÇÃO DE COMANDOS SLASH ---
    if (interaction.isChatInputCommand()) {
      const command = client.commands.get(interaction.commandName);
      if (!command) return;

      try {
        await command.execute(interaction);
      } catch (error) {
        console.error('[ERRO COMANDO]', error);
        const errMessage = 'Ocorreu um erro interno ao processar este comando. Verifique se o banco de dados está online.';
        if (interaction.deferred || interaction.replied) {
          await interaction.editReply({ content: errMessage }).catch(() => null);
        } else {
          await interaction.reply({ content: errMessage, ephemeral: true }).catch(() => null);
        }
      }
      return;
    }

    // --- SELETOR DE CATEGORIA (ABERTURA DO TICKET) ---
    if (interaction.isStringSelectMenu() && interaction.customId === 'ticket_category_select') {
      try {
        await interaction.deferReply({ ephemeral: true });

        const checkBlacklist = await Blacklist.findOne({ userId: user.id });
        if (checkBlacklist) {
          return interaction.editReply({ content: `Você está na lista negra e não pode abrir tickets de suporte.` });
        }

        const config = await GuildConfig.findOne({ guildId: guild.id });
        if (!config) return interaction.editReply({ content: 'As configurações deste servidor não foram salvas.' });

        if (config.active === false) {
          return interaction.editReply({ content: 'O sistema de tickets está temporariamente desativado pela administração.' });
        }

        const activeTickets = await Ticket.countDocuments({ guildId: guild.id, userId: user.id, status: 'open' });
        if (activeTickets >= (config.maxTickets || 3)) {
          return interaction.editReply({ content: `Você já possui ${activeTickets} tickets abertos. Encerre um antes de abrir outro.` });
        }

        const categoryValue = interaction.values[0];
        const categoryObj = config.categories.find(c => c.value === categoryValue);

        config.ticketCount = (config.ticketCount || 0) + 1;
        await config.save();

        const ticketNumber = String(config.ticketCount).padStart(4, '0');
        const isDenuncia = categoryValue === 'denuncia' || categoryValue.includes('denuncia');
        const ticketName = isDenuncia ? `denuncia-${ticketNumber}` : `ticket-${ticketNumber}`;

        const overwrites = [
          { id: guild.id, deny: [PermissionFlagsBits.ViewChannel] },
          { id: user.id, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.EmbedLinks, PermissionFlagsBits.ReadMessageHistory] }
        ];

        if (config.staffRoleIds && config.staffRoleIds.length > 0) {
          config.staffRoleIds.forEach(roleId => {
            overwrites.push({ id: roleId, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory] });
          });
        }

        const ticketChannel = await guild.channels.create({
          name: ticketName,
          type: ChannelType.GuildText,
          parent: config.ticketCategory || null,
          permissionOverwrites: overwrites
        });

        await Ticket.create({
          guildId: guild.id,
          channelId: ticketChannel.id,
          userId: user.id,
          category: categoryValue,
          status: 'open'
        });

        const ticketEmbed = new EmbedBuilder()
          .setTitle(`Ticket: ${categoryObj ? categoryObj.label : 'Suporte'}`)
          .setDescription(`Olá, ${user}. Seu ticket foi criado com sucesso. Descreva seu problema de forma simplificada enquanto a nossa equipe não chega para lhe atender.`)
          .setColor(config.panelEmbed.color || '#5865F2')
          .setTimestamp();

        const btnClaim = new ButtonBuilder().setCustomId('ticket_claim').setLabel('Reivindicar').setStyle(ButtonStyle.Success).setEmoji('🙋‍♂️');
        const btnClose = new ButtonBuilder().setCustomId('ticket_close').setLabel('Fechar Ticket').setStyle(ButtonStyle.Danger).setEmoji('🔒');
        const btnAdd = new ButtonBuilder().setCustomId('ticket_add_member').setLabel('+ Membro').setStyle(ButtonStyle.Primary);
        const btnRem = new ButtonBuilder().setCustomId('ticket_rem_member').setLabel('- Membro').setStyle(ButtonStyle.Secondary);
        const btnTranscript = new ButtonBuilder().setCustomId('ticket_transcript').setLabel('Histórico').setStyle(ButtonStyle.Secondary).setEmoji('📜');

        const rowStandard = new ActionRowBuilder().addComponents(btnClaim, btnClose, btnAdd, btnRem, btnTranscript);
        const rowsToSend = [rowStandard];

        if (isDenuncia) {
          const btnProof = new ButtonBuilder().setCustomId('denuncia_attach_proof').setLabel('Anexar Provas').setStyle(ButtonStyle.Primary).setEmoji('📁');
          const btnTarget = new ButtonBuilder().setCustomId('denuncia_report_target').setLabel('Identificar Acusado').setStyle(ButtonStyle.Primary).setEmoji('👤');
          const btnDisableOptions = new ButtonBuilder().setCustomId('denuncia_disable_options').setLabel('Desativar Opções').setStyle(ButtonStyle.Danger).setEmoji('🛑');

          const rowDenuncia = new ActionRowBuilder().addComponents(btnProof, btnTarget, btnDisableOptions);
          rowsToSend.push(rowDenuncia);
        }

        await ticketChannel.send({ embeds: [ticketEmbed], components: rowsToSend });

        if (config.logChannelId) {
          const logChannel = guild.channels.cache.get(config.logChannelId);
          if (logChannel) {
            const logEmbed = new EmbedBuilder()
              .setTitle('🎫 Ticket Aberto')
              .addFields(
                { name: 'Usuário', value: `${user.tag} (${user.id})`, inline: true },
                { name: 'Categoria', value: `${categoryValue}`, inline: true },
                { name: 'Canal', value: `<#${ticketChannel.id}>`, inline: true }
              )
              .setColor('#2ECC71')
              .setTimestamp();
            await logChannel.send({ embeds: [logEmbed] }).catch(() => null);
          }
        }

        return interaction.editReply({ content: `Seu canal de atendimento foi criado com sucesso: <#${ticketChannel.id}>` });
      } catch (err) {
        console.error('[ERRO CRIAR TICKET]', err);
        return interaction.editReply({ content: 'Falha crítica ao abrir ticket de suporte.' }).catch(() => null);
      }
    }

    // --- SELETOR DE ATIVAR/DESATIVAR CATEGORIAS ---
    if (interaction.isStringSelectMenu() && interaction.customId === 'config_select_toggle_category') {
      await interaction.deferReply({ ephemeral: true });
      const selectedValue = interaction.values[0];

      const config = await GuildConfig.findOne({ guildId: guild.id });
      if (!config) return interaction.editReply({ content: 'Configurações de servidor não encontradas.' });

      const category = config.categories.find(cat => cat.value === selectedValue);
      if (!category) return interaction.editReply({ content: 'Categoria não localizada no banco de dados.' });

      category.active = (category.active === false) ? true : false;
      await config.save();

      liveUpdatePanel(client, guild.id);

      return interaction.editReply({ content: `A categoria **${category.label}** agora está ${category.active ? '🟢 **EXIBIDA**' : '🔴 **OCULTADA**'} no painel público de suporte.` });
    }

    // --- SELETORES NATIVOS DE CONFIGURAÇÃO DE CANAIS ---
    if (interaction.isChannelSelectMenu()) {
      await interaction.deferReply({ ephemeral: true });
      const config = await GuildConfig.findOne({ guildId: guild.id });
      if (!config) return interaction.editReply({ content: 'Configurações de servidor não encontradas.' });

      const selectedId = interaction.values[0];

      if (interaction.customId === 'config_select_category') {
        config.ticketCategory = selectedId;
        await config.save();
        return interaction.editReply({ content: `Categoria de criação de novos canais definida como: <#${selectedId}>` });
      }

      if (interaction.customId === 'config_select_logs') {
        config.logChannelId = selectedId;
        await config.save();
        return interaction.editReply({ content: `Canal de logs de atividades definido como: <#${selectedId}>` });
      }

      if (interaction.customId === 'config_select_transcripts') {
        config.transcriptChannelId = selectedId;
        await config.save();
        return interaction.editReply({ content: `Canal de transcripts (históricos de chat) definido como: <#${selectedId}>` });
      }

      if (interaction.customId === 'config_select_panel_channel') {
        config.panelChannelId = selectedId;
        await config.save();
        return interaction.editReply({ content: `Canal de destino onde a mensagem de suporte será enviada definido como: <#${selectedId}>` });
      }
    }

    if (interaction.isRoleSelectMenu() && interaction.customId === 'config_select_roles') {
      await interaction.deferReply({ ephemeral: true });
      const config = await GuildConfig.findOne({ guildId: guild.id });
      if (!config) return interaction.editReply({ content: 'Configurações de servidor não encontradas.' });

      config.staffRoleIds = interaction.values;
      await config.save();

      const rolesMentions = interaction.values.map(id => `<@&${id}>`).join(', ');
      return interaction.editReply({ content: `Cargos Staff atualizados com sucesso. Cargos selecionados: ${rolesMentions}` });
    }

    // --- INTERAÇÕES DOS BOTÕES ---
    if (interaction.isButton()) {
      const buttonId = interaction.customId;

      if (buttonId.startsWith('config_') || buttonId.startsWith('discord_config_')) {
        if (!member.permissions.has(PermissionFlagsBits.Administrator)) {
          return interaction.reply({ content: 'Apenas administradores do servidor podem usar estas configurações.', ephemeral: true });
        }
      }

      // 1. Liga/Desliga o sistema
      if (buttonId === 'config_toggle_active') {
        await interaction.deferReply({ ephemeral: true });
        const config = await GuildConfig.findOne({ guildId: guild.id });
        if (!config) return interaction.editReply({ content: 'Configurações de servidor não encontradas.' });

        config.active = !config.active;
        await config.save();

        liveUpdatePanel(client, guild.id); // Atualiza em background

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

        const selectPanelChannel = new ChannelSelectMenuBuilder().setCustomId('config_select_panel_channel').setPlaceholder('📩 Escolha o canal de texto onde o painel público vai aparecer...').addChannelTypes(ChannelType.GuildText);
        const selectRoles = new RoleSelectMenuBuilder().setCustomId('config_select_roles').setPlaceholder('🛡️ Escolha um ou mais cargos de atendimento (Staff)...').setMinValues(1).setMaxValues(10);

        const btnToggle = new ButtonBuilder()
          .setCustomId('config_toggle_active')
          .setLabel(config.active ? 'Desativar Tickets' : 'Ativar Tickets')
          .setStyle(config.active ? ButtonStyle.Danger : ButtonStyle.Success)
          .setEmoji(config.active ? '🔒' : '🔓');

        const btnToggleCategories = new ButtonBuilder().setCustomId('config_toggle_categories_btn').setLabel('Exibir/Ocultar Botões').setStyle(ButtonStyle.Primary).setEmoji('👁️');
        const btnDesign = new ButtonBuilder().setCustomId('discord_config_panel_unified').setLabel('Aparência do Painel').setStyle(ButtonStyle.Secondary).setEmoji('🎨');
        const btnSendPanel = new ButtonBuilder().setCustomId('config_send_public_panel').setLabel('Gerar Painel de Tickets').setStyle(ButtonStyle.Success).setEmoji('📩');

        const row1 = new ActionRowBuilder().addComponents(selectPanelChannel);
        const row2 = new ActionRowBuilder().addComponents(selectRoles);
        const row3 = new ActionRowBuilder().addComponents(btnToggle, btnToggleCategories, btnDesign, btnSendPanel);

        await interaction.message.edit({ embeds: [embed], components: [row1, row2, row3] }).catch(() => null);

        return interaction.editReply({ content: `O sistema de tickets foi ${config.active ? '🟢 **ATIVADO**' : '🔴 **DESATIVADO**'} com sucesso.` });
      }

      // 2. Enviar Menu para Exibir / Ocultar Categorias por botão
      if (buttonId === 'config_toggle_categories_btn') {
        const config = await GuildConfig.findOne({ guildId: guild.id });
        if (!config) return interaction.reply({ content: 'Configurações de servidor não localizadas.', ephemeral: true });

        const selectToggleMenu = new StringSelectMenuBuilder()
          .setCustomId('config_select_toggle_category')
          .setPlaceholder('Escolha uma categoria para alterar (Exibir/Ocultar)...')
          .addOptions(
            config.categories.map(cat => ({
              label: cat.label,
              value: cat.value,
              description: `Status: ${cat.active !== false ? '🟢 Ativo (Exibido)' : '🔴 Ocultado'}`,
              emoji: cat.active !== false ? '🟢' : '🔴'
            }))
          );

        const row = new ActionRowBuilder().addComponents(selectToggleMenu);
        return interaction.reply({ content: 'Selecione abaixo qual botão de categoria você deseja **Exibir ou Ocultar** no painel público:', components: [row], ephemeral: true });
      }

      // 3. Modal Unificado de Configuração de Design
      if (buttonId === 'discord_config_panel_unified') {
        const config = await GuildConfig.findOne({ guildId: guild.id });
        if (!config) return interaction.reply({ content: 'Configurações de servidor não encontradas.', ephemeral: true });

        const modal = new ModalBuilder()
          .setCustomId('modal_discord_appearance')
          .setTitle('🎨 Editar Design do Painel');

        const titleInput = new TextInputBuilder()
          .setCustomId('modal_panel_title')
          .setLabel('Título do Painel')
          .setValue(config.panelEmbed.title || '')
          .setStyle(TextInputStyle.Short)
          .setRequired(true);

        const descInput = new TextInputBuilder()
          .setCustomId('modal_panel_desc')
          .setLabel('Mensagem / Descrição')
          .setValue(config.panelEmbed.description || '')
          .setStyle(TextInputStyle.Paragraph)
          .setRequired(true);

        const thumbInput = new TextInputBuilder()
          .setCustomId('modal_panel_thumb')
          .setLabel('URL da Miniatura (Thumbnail)')
          .setValue(config.panelEmbed.thumbnail || '')
          .setStyle(TextInputStyle.Short)
          .setRequired(false);

        const imgInput = new TextInputBuilder()
          .setCustomId('modal_panel_img')
          .setLabel('URL do Banner Principal (Imagem)')
          .setValue(config.panelEmbed.image || '')
          .setStyle(TextInputStyle.Short)
          .setRequired(false);

        const colorInput = new TextInputBuilder()
          .setCustomId('modal_panel_color')
          .setLabel('Cor Hexadecimal (Exemplo: #5865F2)')
          .setValue(config.panelEmbed.color || '#5865F2')
          .setStyle(TextInputStyle.Short)
          .setRequired(true)
          .setMaxLength(7)
          .setMinLength(7);

        modal.addComponents(
          new ActionRowBuilder().addComponents(titleInput),
          new ActionRowBuilder().addComponents(descInput),
          new ActionRowBuilder().addComponents(thumbInput),
          new ActionRowBuilder().addComponents(imgInput),
          new ActionRowBuilder().addComponents(colorInput)
        );

        await interaction.showModal(modal);
        return;
      }

      // CORREÇÃO CRÍTICA DO BOTÃO "GERAR PAINEL"
      if (buttonId === 'config_send_public_panel') {
        await interaction.deferReply({ ephemeral: true });
        const config = await GuildConfig.findOne({ guildId: guild.id });
        if (!config) return interaction.editReply({ content: 'Configurações não encontradas.' });

        const targetChannelId = config.panelChannelId;

        // VALIDAÇÃO: Se o ID do canal estiver nulo ou ausente, interrompe antes de tentar puxar no Discord e travar
        if (!targetChannelId || targetChannelId.trim() === '') {
          return interaction.editReply({ content: 'Por favor, selecione um canal de destino válido no primeiro menu deslizante antes de tentar gerar o painel.' });
        }

        const targetChannel = guild.channels.cache.get(targetChannelId) || await guild.channels.fetch(targetChannelId).catch(() => null);

        if (!targetChannel) {
          return interaction.editReply({ content: 'Não foi possível localizar o canal de destino selecionado. Verifique as permissões de leitura do bot.' });
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
          selectMenu.addOptions({
            label: 'Nenhuma categoria ativa',
            value: 'none_active',
            description: 'Entre em contato com os administradores.'
          });
          selectMenu.setDisabled(true);
        } else {
          selectMenu.addOptions(
            activeCategories.slice(0, 25).map(cat => ({
              label: cat.label,
              description: cat.description || '',
              value: cat.value,
              emoji: cat.emoji || undefined
            }))
          );
          selectMenu.setDisabled(!config.active);
        }

        const row = new ActionRowBuilder().addComponents(selectMenu);
        
        // Exclui painel anterior se existente
        if (config.panelChannelId && config.panelMessageId) {
          const oldChannel = guild.channels.cache.get(config.panelChannelId);
          if (oldChannel) {
            const oldMsg = await oldChannel.messages.fetch(config.panelMessageId).catch(() => null);
            if (oldMsg) await oldMsg.delete().catch(() => null);
          }
        }

        const publicMessage = await targetChannel.send({ embeds: [embed], components: [row] }).catch(() => null);

        if (!publicMessage) {
          return interaction.editReply({ content: 'Falha ao enviar a mensagem de suporte. Verifique se o bot possui a permissão de ENVIAR MENSAGENS no canal selecionado.' });
        }

        config.panelMessageId = publicMessage.id;
        await config.save();

        return interaction.editReply({ content: `Painel de tickets gerado com sucesso no canal <#${targetChannelId}>. Todas as alterações serão aplicadas diretamente nesta mensagem!` });
      }

      // --- TRATAMENTO DOS BOTÕES DE DENÚNCIA EXTRAS ---
      if (buttonId === 'denuncia_attach_proof') {
        const modal = new ModalBuilder().setCustomId('modal_denuncia_proof').setTitle('📁 Anexar Prova');
        const proofInput = new TextInputBuilder().setCustomId('denuncia_proof_link').setLabel('Link ou Descrição da Prova').setStyle(TextInputStyle.Paragraph).setRequired(true);
        modal.addComponents(new ActionRowBuilder().addComponents(proofInput));
        await interaction.showModal(modal);
        return;
      }

      if (buttonId === 'denuncia_report_target') {
        const modal = new ModalBuilder().setCustomId('modal_denuncia_target').setTitle('👤 Identificar Acusado');
        const targetInput = new TextInputBuilder().setCustomId('denuncia_target_id').setLabel('Nome, ID ou Tag do Acusado').setStyle(TextInputStyle.Short).setRequired(true);
        modal.addComponents(new ActionRowBuilder().addComponents(targetInput));
        await interaction.showModal(modal);
        return;
      }

      if (buttonId === 'denuncia_disable_options') {
        await interaction.deferReply({ ephemeral: true });
        const channel = interaction.channel;
        const messages = await channel.messages.fetch({ limit: 50 });
        const originalMsg = messages.find(m => m.author.id === client.user.id && m.components.length > 1);

        if (originalMsg) {
          await originalMsg.edit({ components: [originalMsg.components[0]] });
          return interaction.editReply({ content: 'As opções adicionais de denúncia foram desativadas e congeladas com sucesso.' });
        } else {
          return interaction.editReply({ content: 'Não foi possível encontrar o cabeçalho original dos botões neste canal.' });
        }
      }

      // --- TRATAMENTO DOS BOTÕES INTERNOS PADRÕES DO TICKET ---
      const channel = interaction.channel;
      const ticketData = await Ticket.findOne({ channelId: channel.id });
      const config = await GuildConfig.findOne({ guildId: guild.id });

      if (!ticketData || !config) return;

      const isStaff = config.staffRoleIds && config.staffRoleIds.some(roleId => member.roles.cache.has(roleId));
      const isTicketOwner = ticketData.userId === user.id;

      if (!isStaff && !isTicketOwner) {
        return interaction.reply({ content: 'Você não possui permissão para utilizar estes controles.', ephemeral: true });
      }

      if (buttonId === 'ticket_claim') {
        if (!isStaff) return interaction.reply({ content: 'Apenas atendentes da staff podem reivindicar tickets.', ephemeral: true });
        if (ticketData.claimedBy) return interaction.reply({ content: `Este ticket já foi reivindicado por <@${ticketData.claimedBy}>`, ephemeral: true });

        ticketData.claimedBy = user.id;
        ticketData.status = 'claimed';
        await ticketData.save();

        if (config.staffRoleIds) {
          config.staffRoleIds.forEach(async (roleId) => {
            await channel.permissionOverwrites.edit(roleId, { SendMessages: false }).catch(() => null);
          });
        }
        await channel.permissionOverwrites.edit(user.id, { ViewChannel: true, SendMessages: true });

        await channel.send({ content: `Este ticket foi oficialmente reivindicado por ${user}.` });
        return interaction.deferUpdate();
      }

      if (buttonId === 'ticket_close') {
        ticketData.status = 'closed';
        ticketData.closedAt = new Date();
        await ticketData.save();

        await interaction.reply({ content: 'Encerramento de ticket iniciado. Gerando histórico de chat...' });

        const transcriptAttachment = await createTranscript(channel, guild);

        if (config.transcriptChannelId) {
          const transChannel = guild.channels.cache.get(config.transcriptChannelId);
          if (transChannel) {
            await transChannel.send({
              content: `Histórico finalizado do Ticket de <@${ticketData.userId}> (ID do Canal: ${channel.id})`,
              files: [transcriptAttachment]
            }).catch(() => null);
          }
        }

        try {
          const owner = await client.users.fetch(ticketData.userId);
          const feedbackEmbed = new EmbedBuilder()
            .setTitle('⭐ Avalie seu Atendimento!')
            .setDescription(`Seu ticket no servidor **${guild.name}** foi encerrado. Por favor, atribua uma nota de 1 a 5 no feedback.`)
            .setColor('#F1C40F');

          const selectFeedback = new StringSelectMenuBuilder()
            .setCustomId(`ticket_feedback_${ticketData.id}`)
            .setPlaceholder('Escolha uma nota de 1 a 5 estrelas...')
            .addOptions([
              { label: '⭐ (Ruim)', value: '1' },
              { label: '⭐⭐ (Regular)', value: '2' },
              { label: '⭐⭐⭐ (Bom)', value: '3' },
              { label: '⭐⭐⭐⭐ (Muito Bom)', value: '4' },
              { label: '⭐⭐⭐⭐⭐ (Excelente)', value: '5' }
            ]);

          const fbRow = new ActionRowBuilder().addComponents(selectFeedback);
          await owner.send({ embeds: [feedbackEmbed], components: [fbRow] }).catch(() => null);
        } catch {}

        await channel.send({ content: 'Este canal será destruído em 10 segundos.' });
        setTimeout(async () => {
          await channel.delete().catch(() => null);
        }, 10000);
      }

      if (buttonId === 'ticket_transcript') {
        const trAttachment = await createTranscript(channel, guild);
        return interaction.reply({ files: [trAttachment], ephemeral: true });
      }

      if (buttonId === 'ticket_add_member' || buttonId === 'ticket_rem_member') {
        const isAdd = buttonId === 'ticket_add_member';
        const modal = new ModalBuilder()
          .setCustomId(isAdd ? 'modal_add_user' : 'modal_rem_user')
          .setTitle(isAdd ? 'Adicionar Usuário ao Ticket' : 'Remover Usuário do Ticket');

        const inputUser = new TextInputBuilder()
          .setCustomId('target_user_id')
          .setLabel('ID do Usuário')
          .setStyle(TextInputStyle.Short)
          .setPlaceholder('Exemplo: 382894572910472019')
          .setRequired(true);

        const row = new ActionRowBuilder().addComponents(inputUser);
        modal.addComponents(row);

        await interaction.showModal(modal);
      }
    }

    // --- RECEBIMENTO DOS FORMULÁRIOS DE MODAIS (DISCORD) ---
    if (interaction.isModalSubmit()) {
      if (interaction.customId === 'modal_discord_appearance') {
        await interaction.deferReply({ ephemeral: true });
        const title = interaction.fields.getTextInputValue('modal_panel_title');
        const description = interaction.fields.getTextInputValue('modal_panel_desc');
        const thumbnail = interaction.fields.getTextInputValue('modal_panel_thumb');
        const image = interaction.fields.getTextInputValue('modal_panel_img');
        let color = interaction.fields.getTextInputValue('modal_panel_color').trim();

        if (!color.startsWith('#')) color = '#' + color;

        try {
          await GuildConfig.findOneAndUpdate(
            { guildId: guild.id },
            {
              'panelEmbed.title': title,
              'panelEmbed.description': description,
              'panelEmbed.thumbnail': thumbnail,
              'panelEmbed.image': image,
              'panelEmbed.color': color
            }
          );

          liveUpdatePanel(client, guild.id);
          return interaction.editReply({ content: 'Aparência do painel atualizada com sucesso no Discord!' });
        } catch (err) {
          return interaction.editReply({ content: 'Erro ao gravar as configurações de aparência no banco de dados.' });
        }
      }

      if (interaction.customId === 'modal_config_categories') {
        await interaction.deferReply({ ephemeral: true });
        const text1 = interaction.fields.getTextInputValue('cat1_label').split('|');
        const text2 = interaction.fields.getTextInputValue('cat2_label').split('|');
        const text3 = interaction.fields.getTextInputValue('cat3_label').split('|');

        try {
          const categories = [
            { value: 'suporte', label: (text1[0] || 'Suporte').trim(), description: (text1[1] || '').trim(), emoji: (text1[2] || '💬').trim() },
            { value: 'financeiro', label: (text2[0] || 'Financeiro').trim(), description: (text2[1] || '').trim(), emoji: (text2[2] || '💳').trim() },
            { value: 'denuncia', label: (text3[0] || 'Denúncia').trim(), description: (text3[1] || '').trim(), emoji: (text3[2] || '⚠️').trim() }
          ];

          await GuildConfig.findOneAndUpdate({ guildId: guild.id }, { categories });

          liveUpdatePanel(client, guild.id);
          return interaction.editReply({ content: 'Nomes das categorias atualizados e sincronizados no Discord em tempo real!' });
        } catch (err) {
          return interaction.editReply({ content: 'Erro ao gravar novos nomes de categorias.' });
        }
      }

      if (interaction.customId === 'modal_denuncia_proof') {
        const link = interaction.fields.getTextInputValue('denuncia_proof_link');
        const proofEmbed = new EmbedBuilder().setTitle('📁 Prova Anexada').setDescription(link).setColor('#E74C3C').setTimestamp();
        await interaction.reply({ content: 'Anexando provas...', ephemeral: true });
        return interaction.channel.send({ embeds: [proofEmbed] });
      }

      if (interaction.customId === 'modal_denuncia_target') {
        const target = interaction.fields.getTextInputValue('denuncia_target_id');
        const targetEmbed = new EmbedBuilder().setTitle('👤 Acusado Identificado').setDescription(`Acusado informado: **${target}**`).setColor('#E74C3C').setTimestamp();
        await interaction.reply({ content: 'Identificando acusado...', ephemeral: true });
        return interaction.channel.send({ embeds: [targetEmbed] });
      }

      // Modais Internos do Ticket (Membros)
      try {
        const targetUserId = interaction.fields.getTextInputValue('target_user_id');
        const targetMember = await guild.members.fetch(targetUserId).catch(() => null);

        if (!targetMember) {
          return interaction.reply({ content: 'Não foi possível encontrar nenhum membro no servidor com o ID fornecido.', ephemeral: true });
        }

        if (interaction.customId === 'modal_add_user') {
          await interaction.channel.permissionOverwrites.edit(targetUserId, {
            ViewChannel: true,
            SendMessages: true,
            ReadMessageHistory: true
          });
          return interaction.reply({ content: `<@${targetUserId}> foi adicionado com sucesso ao ticket!` });
        }

        if (interaction.customId === 'modal_rem_user') {
          await interaction.channel.permissionOverwrites.delete(targetUserId);
          return interaction.reply({ content: `<@${targetUserId}> foi removido com sucesso do ticket.` });
        }
      } catch (err) {
        console.error('[ERRO PROCESSAR MODAL MEMBERS]', err);
      }
    }

    // --- SISTEMA DE AVALIAÇÃO ---
    if (interaction.isStringSelectMenu() && interaction.customId.startsWith('ticket_feedback_')) {
      try {
        const ticketDbId = interaction.customId.replace('ticket_feedback_', '');
        const rating = parseInt(interaction.values[0]);

        await Ticket.findByIdAndUpdate(ticketDbId, { rating });
        return interaction.reply({ content: `Obrigado! Sua avaliação de ${'⭐'.repeat(rating)} foi salva no banco de dados.`, ephemeral: true });
      } catch (err) {
        console.error('[ERRO AVALIACAO]', err);
      }
    }
  }
};