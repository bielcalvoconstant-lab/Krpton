const mongoose = require('mongoose');

const BlacklistSchema = new mongoose.Schema({
  userId: { type: String, required: true, unique: true },
  reason: { type: String, default: 'Nenhuma razão fornecida' },
  addedBy: { type: String, required: true },
  addedAt: { type: Date, default: Date.now }
});

module.exports = mongoose.model('Blacklist', BlacklistSchema);
