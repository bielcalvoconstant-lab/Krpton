const mongoose = require('mongoose');

const UserSchema = new mongoose.Schema({
  email: { type: String, required: true, unique: true },
  password: { type: String, required: true },
  discordId: { type: String, default: null },
  isVerified: { type: Boolean, default: false },
  otp: { type: String, default: null },
  otpExpires: { type: Date, default: null },
  resetToken: { type: String, default: null },
  resetTokenExpires: { type: Date, default: null },
  role: { type: String, default: 'user' }, // 'superadmin' para mafiosodashopping@gmail.com
  isVip: { type: Boolean, default: false }, // Status de assinatura VIP real
  stripeCustomerId: { type: String, default: null } // ID do Cliente no Stripe
});

module.exports = mongoose.model('User', UserSchema);