const mongoose = require('mongoose');

const UserSchema = new mongoose.Schema({
  discordId: { type: String, required: true, unique: true },
  email: { type: String, default: null },
  isVerified: { type: Boolean, default: false },
  otp: { type: String, default: null },
  otpExpires: { type: Date, default: null },
  role: { type: String, default: 'user' } // 'user' ou 'superadmin' para mafiosodashopping@gmail.com
});

module.exports = mongoose.model('User', UserSchema);
