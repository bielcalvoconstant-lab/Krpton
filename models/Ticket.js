const mongoose = require('mongoose');

const TicketSchema = new mongoose.Schema({
  guildId: { type: String, required: true },
  channelId: { type: String, required: true, unique: true },
  userId: { type: String, required: true },
  category: { type: String, required: true },
  status: { type: String, default: 'open' }, // open, closed, claimed
  claimedBy: { type: String, default: null },
  rating: { type: Number, default: null },
  createdAt: { type: Date, default: Date.now },
  closedAt: { type: Date, default: null }
});

module.exports = mongoose.model('Ticket', TicketSchema);
