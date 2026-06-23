const mongoose = require('mongoose');

const GuildConfigSchema = new mongoose.Schema({
  guildId: { type: String, required: true, unique: true },
  staffRoleIds: { type: [String], default: [] },
  logChannelId: { type: String, default: null },
  transcriptChannelId: { type: String, default: null },
  ticketCategory: { type: String, default: null },
  maxTickets: { type: Number, default: 3 },
  active: { type: Boolean, default: true },
  ticketCount: { type: Number, default: 0 }, // Contador sequencial de tickets do servidor
  panelChannelId: { type: String, default: null },
  panelMessageId: { type: String, default: null },
  panelEmbed: {
    title: { type: String, default: '📩 Central de Suporte' },
    description: { type: String, default: 'Clique no menu de seleção abaixo para abrir um ticket de suporte.' },
    color: { type: String, default: '#5865F2' },
    thumbnail: { type: String, default: '' },
    image: { type: String, default: '' }
  },
  categories: {
    type: Array,
    default: [
      { value: 'suporte', label: 'Suporte Geral', description: 'Dúvidas e assistência básica', emoji: '💬' },
      { value: 'financeiro', label: 'Financeiro', description: 'Questões relacionadas a pagamentos', emoji: '💳' },
      { value: 'denuncia', label: 'Denúncias', description: 'Reportar infrações ou abusos', emoji: '⚠️' }
    ]
  }
});

module.exports = mongoose.model('GuildConfig', GuildConfigSchema);
