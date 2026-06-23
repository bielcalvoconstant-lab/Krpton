const mongoose = require('mongoose');

const UserSchema = new mongoose.Schema({
  email: { type: String, required: true, unique: true },
  password: { type: String, required: true }, // Senha criptografada (hash)
  discordId: { type: String, default: null }, // ID do Discord associado após login
  isVerified: { type: Boolean, default: false }, // Verificação de 2FA por e-mail concluída
  otp: { type: String, default: null },
  otpExpires: { type: Date, default: null },
  resetToken: { type: String, default: null }, // Código de redefinição de senha
  resetTokenExpires: { type: Date, default: null },
  role: { type: String, default: 'user' } // 'user' ou 'superadmin' para mafiosodashopping@gmail.com
});

module.exports = mongoose.model('User', UserSchema);