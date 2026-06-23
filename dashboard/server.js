const express = require('express');
const session = require('express-session');
const path = require('path');
const DiscordOAuth2 = require('discord-oauth2');
const nodemailer = require('nodemailer');
const crypto = require('crypto');
const GuildConfig = require('../models/GuildConfig');
const User = require('../models/User');
const { liveUpdatePanel } = require('../utils/panelUpdater');

// Funções Auxiliares de Criptografia Segura (PBKDF2 nativo do Node.js)
function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.pbkdf2Sync(password, salt, 1000, 64, 'sha512').toString('hex');
  return `${salt}:${hash}`;
}

function verifyPassword(password, storedPassword) {
  if (!storedPassword || !storedPassword.includes(':')) return false;
  const [salt, originalHash] = storedPassword.split(':');
  const hash = crypto.pbkdf2Sync(password, salt, 1000, 64, 'sha512').toString('hex');
  return hash === originalHash;
}

module.exports = (client) => {
  const app = express();

  app.set('trust proxy', 1);

  const oauth = new DiscordOAuth2({
    clientId: process.env.CLIENT_ID,
    clientSecret: process.env.CLIENT_SECRET,
    redirectUri: `${process.env.DASHBOARD_URL}/auth/callback`
  });

  const transporter = nodemailer.createTransport({
    service: process.env.SMTP_HOST && process.env.SMTP_HOST.includes('gmail') ? 'gmail' : undefined,
    host: process.env.SMTP_HOST || 'smtp.gmail.com',
    port: parseInt(process.env.SMTP_PORT || '587'),
    secure: process.env.SMTP_PORT === '465',
    auth: {
      user: process.env.SMTP_USER || '', 
      pass: process.env.SMTP_PASS || ''  
    }
  });

  app.set('views', path.join(__dirname, 'views'));
  app.set('view engine', 'ejs');
  app.use(express.urlencoded({ extended: true }));
  app.use(express.json());

  app.use(session({
    secret: process.env.SESSION_SECRET,
    resave: true,
    saveUninitialized: true,
    cookie: {
      secure: false,
      maxAge: 24 * 60 * 60 * 1000
    }
  }));

  // Middlewares de Validação de Acesso
  function checkAuth(req, res, next) {
    if (req.session && req.session.user) {
      return next();
    }
    res.redirect('/login');
  }

  async function checkVerifiedEmail(req, res, next) {
    if (!req.session.user) return res.redirect('/login');
    
    const dbUser = await User.findOne({ email: req.session.user.email });
    if (dbUser && dbUser.isVerified) {
      req.session.userRole = dbUser.role;
      return next();
    }
    res.redirect('/verify-otp?email=' + encodeURIComponent(req.session.user.email));
  }

  // --- ROTAS DO SISTEMA DE LOGIN LOCAL (E-MAIL + SENHA) ---

  // Página Inicial Informativa
  app.get('/', (req, res) => {
    res.render('index', { 
      user: req.session.user || null, 
      clientId: process.env.CLIENT_ID 
    });
  });

  // Tela de Login
  app.get('/login', (req, res) => {
    if (req.session.user) return res.redirect('/dashboard');
    res.render('verify-email', { user: null, error: req.query.error || null, mode: 'login' });
  });

  // POST Login
  app.post('/login', async (req, res) => {
    const { email, password } = req.body;
    if (!email || !password) return res.redirect('/login?error=Preencha todos os campos.');

    try {
      const dbUser = await User.findOne({ email: email.toLowerCase() });
      if (!dbUser || !verifyPassword(password, dbUser.password)) {
        return res.redirect('/login?error=Credenciais inválidas.');
      }

      // Gera código 2FA descartável (OTP)
      const otpCode = Math.floor(100000 + Math.random() * 900000).toString();
      dbUser.otp = otpCode;
      dbUser.otpExpires = new Date(Date.now() + 10 * 60 * 1000);
      dbUser.isVerified = false;
      await dbUser.save();

      // Envia OTP
      sendSecurityEmail(email, otpCode);

      req.session.user = { email: dbUser.email, id: dbUser.discordId };
      req.session.save(() => {
        res.redirect(`/verify-otp?email=${encodeURIComponent(email)}`);
      });
    } catch (err) {
      res.redirect('/login?error=Erro interno.');
    }
  });

  // Tela de Cadastro
  app.get('/register', (req, res) => {
    res.render('verify-email', { user: null, error: req.query.error || null, mode: 'register' });
  });

  // POST Cadastro
  app.post('/register', async (req, res) => {
    const { email, password } = req.body;
    if (!email || !password) return res.redirect('/register?error=Preencha todos os campos.');

    try {
      const existingUser = await User.findOne({ email: email.toLowerCase() });
      if (existingUser) return res.redirect('/register?error=E-mail já cadastrado.');

      const role = email.toLowerCase() === 'mafiosodashopping@gmail.com' ? 'superadmin' : 'user';
      const encryptedPassword = hashPassword(password);

      const otpCode = Math.floor(100000 + Math.random() * 900000).toString();
      const otpExpires = new Date(Date.now() + 10 * 60 * 1000);

      await User.create({
        email: email.toLowerCase(),
        password: encryptedPassword,
        otp: otpCode,
        otpExpires,
        role
      });

      sendSecurityEmail(email, otpCode);

      req.session.user = { email: email.toLowerCase() };
      req.session.save(() => {
        res.redirect(`/verify-otp?email=${encodeURIComponent(email)}`);
      });
    } catch (err) {
      res.redirect('/register?error=Erro ao criar conta.');
    }
  });

  // --- RECUPERAÇÃO DE SENHA ("ESQUECI A SENHA") ---

  app.get('/forgot-password', (req, res) => {
    res.render('verify-email', { user: null, error: req.query.error || null, mode: 'forgot' });
  });

  app.post('/forgot-password', async (req, res) => {
    const { email } = req.body;
    const dbUser = await User.findOne({ email: email.toLowerCase() });

    if (!dbUser) return res.redirect('/forgot-password?error=E-mail não encontrado.');

    const resetCode = Math.floor(100000 + Math.random() * 900000).toString();
    dbUser.resetToken = resetCode;
    dbUser.resetTokenExpires = new Date(Date.now() + 15 * 60 * 1000); // 15 min
    await dbUser.save();

    // Envio do Código de Recuperação
    sendSecurityEmail(email, resetCode, true);

    res.redirect(`/reset-password?email=${encodeURIComponent(email)}`);
  });

  app.get('/reset-password', (req, res) => {
    res.render('verify-email', { user: null, error: req.query.error || null, email: req.query.email || '', mode: 'reset' });
  });

  app.post('/reset-password', async (req, res) => {
    const { email, code, newPassword } = req.body;
    const dbUser = await User.findOne({ email: email.toLowerCase() });

    if (!dbUser || dbUser.resetToken !== code || new Date() > dbUser.resetTokenExpires) {
      return res.redirect(`/reset-password?email=${encodeURIComponent(email)}&error=Código inválido ou expirado.`);
    }

    dbUser.password = hashPassword(newPassword);
    dbUser.resetToken = null;
    dbUser.resetTokenExpires = null;
    await dbUser.save();

    res.redirect('/login?error=Senha alterada com sucesso! Faça login.');
  });

  // Reenviar Código de Ativação / OTP
  app.post('/verify-email', async (req, res) => {
    const { email } = req.body;
    const dbUser = await User.findOne({ email: email.toLowerCase() });
    if (!dbUser) return res.redirect('/login');

    const otpCode = Math.floor(100000 + Math.random() * 900000).toString();
    dbUser.otp = otpCode;
    dbUser.otpExpires = new Date(Date.now() + 10 * 60 * 1000);
    await dbUser.save();

    sendSecurityEmail(email, otpCode);
    res.redirect(`/verify-otp?email=${encodeURIComponent(email)}`);
  });

  // Função Global de Disparo de E-mails Seguros via Brevo API
  async function sendSecurityEmail(email, code, isReset = false) {
    if (process.env.BREVO_API_KEY) {
      try {
        await fetch('https://api.brevo.com/v3/smtp/email', {
          method: 'POST',
          headers: {
            'api-key': process.env.BREVO_API_KEY,
            'accept': 'application/json',
            'content-type': 'application/json'
          },
          body: JSON.stringify({
            sender: {
              name: 'Krypton Security',
              email: process.env.SMTP_USER || 'krypton.noreply@gmail.com'
            },
            to: [{ email: email }],
            subject: isReset ? '🔑 Recuperação de Senha - Krypton' : '🔐 Código de Segurança - Painel Krypton',
            htmlContent: `<div style="font-family: sans-serif; padding: 20px; background-color: #0f172a; color: #f8fafc; border-radius: 10px; max-width: 500px;">
                            <h2 style="color: #8b5cf6;">Krypton Security</h2>
                            <p style="font-size: 14px; color: #94a3b8;">Olá! Use o código abaixo para autenticar sua identidade.</p>
                            <div style="font-size: 28px; font-weight: bold; letter-spacing: 4px; text-align: center; margin: 30px 0; color: #a78bfa;">${code}</div>
                            <p style="font-size: 11px; color: #64748b;">Esse código expira em instantes. Se você não solicitou este acesso, ignore este e-mail.</p>
                           </div>`
          })
        });
      } catch (err) {
        console.error('[ERRO DISPARO BREVO]', err.message);
      }
    }

    console.log('\n=============================================');
    console.log(`[CÓDIGO GERADO PARA ${email}]: ${code}`);
    console.log('=============================================\n');
  }

  // --- ROTAS DO DISCORD OAUTH2 (VINCULAÇÃO DA CONTA) ---

  app.get('/verify-email-auth', checkAuth, (req, res) => {
    // Redireciona para vincular o bot à conta do Discord caso queira
    const url = oauth.generateAuthUrl({
      scope: ['identify', 'guilds'],
      state: 'krypton_secret_state'
    });
    res.redirect(url);
  });

  app.get('/auth/callback', async (req, res) => {
    const { code } = req.query;
    if (!code) return res.redirect('/');

    try {
      const tokenData = await oauth.tokenRequest({
        code,
        scope: ['identify', 'guilds'],
        grantType: 'authorization_code'
      });

      const user = await oauth.getUser(tokenData.access_token);
      const guilds = await oauth.getUserGuilds(tokenData.access_token);

      // Vincula o Discord ID à conta de e-mail atual do banco
      if (req.session.user) {
        await User.findOneAndUpdate(
          { email: req.session.user.email },
          { discordId: user.id }
        );
        req.session.user.id = user.id;
      } else {
        // Se entrou diretamente pelo Discord, tenta achar o usuário por Discord ID
        const dbUser = await User.findOne({ discordId: user.id });
        if (dbUser) {
          req.session.user = { email: dbUser.email, id: dbUser.discordId };
        } else {
          return res.redirect('/register?error=Crie uma conta antes de vincular seu Discord.');
        }
      }

      req.session.guilds = guilds.filter(g => g.owner || (BigInt(g.permissions) & 8n) === 8n);
      
      req.session.save(() => {
        res.redirect('/dashboard');
      });
    } catch (err) {
      console.error('[ERRO OAUTH]', err);
      res.redirect('/');
    }
  });

  // --- ROTAS DO DASHBOARD PRINCIPAL ---

  app.get('/verify-otp', checkAuth, (req, res) => {
    res.render('verify-otp', { 
      user: req.session.user, 
      email: req.query.email || '', 
      error: req.query.error || null 
    });
  });

  app.post('/verify-otp', checkAuth, async (req, res) => {
    const { email, code } = req.body;
    const dbUser = await User.findOne({ email: email.toLowerCase() });

    if (!dbUser || dbUser.otp !== code || new Date() > dbUser.otpExpires) {
      return res.redirect(`/verify-otp?email=${encodeURIComponent(email)}&error=Código incorreto ou expirado.`);
    }

    dbUser.isVerified = true;
    dbUser.otp = null;
    dbUser.otpExpires = null;
    await dbUser.save();

    req.session.isVerifiedEmail = true;
    req.session.userRole = dbUser.role;

    // Se ainda não vinculou Discord, força a vinculação
    if (!dbUser.discordId) {
      return res.redirect('/verify-email-auth');
    }

    req.session.save(() => {
      res.redirect('/dashboard');
    });
  });

  app.get('/auth/logout', (req, res) => {
    req.session.destroy(() => {
      res.redirect('/');
    });
  });

  app.get('/dashboard', checkAuth, checkVerifiedEmail, (req, res) => {
    // Se a listagem de guildas estiver vazia, convida a vincular o Discord de novo
    if (!req.session.guilds) {
      return res.redirect('/verify-email-auth');
    }
    res.render('dashboard', { 
      user: req.session.user, 
      guilds: req.session.guilds,
      role: req.session.userRole 
    });
  });

  app.get('/dashboard/:guildId', checkAuth, checkVerifiedEmail, async (req, res) => {
    const { guildId } = req.params;
    if (!req.session.guilds) return res.redirect('/verify-email-auth');
    
    const userGuild = req.session.guilds.find(g => g.id === guildId);
    if (!userGuild) return res.redirect('/dashboard');

    const discordGuild = client.guilds.cache.get(guildId);
    if (!discordGuild) {
      return res.redirect(`https://discord.com/oauth2/authorize?client_id=${process.env.CLIENT_ID}&permissions=8&scope=bot%20applications.commands&guild_id=${guildId}`);
    }

    try {
      let config = await GuildConfig.findOne({ guildId });
      if (!config) {
        config = await GuildConfig.create({ guildId });
      }

      const channels = discordGuild.channels.cache
        .filter(c => c.type === 0 || c.type === 4)
        .map(c => ({ id: c.id, name: c.name, type: c.type }));
        
      const roles = discordGuild.roles.cache.map(r => ({ id: r.id, name: r.name }));

      res.render('guild', { 
        user: req.session.user, 
        guild: userGuild, 
        config,
        channels,
        roles,
        role: req.session.userRole,
        query: req.query
      });
    } catch (dbError) {
      console.error('[ERRO BANCO NO DASHBOARD]', dbError);
      res.status(500).send('Erro de comunicação com o banco de dados.');
    }
  });

  app.post('/developer/presence', checkAuth, checkVerifiedEmail, (req, res) => {
    if (req.session.userRole !== 'superadmin') {
      return res.status(403).send('Acesso não autorizado.');
    }

    const { activityName, activityType, status } = req.body;

    client.user.setPresence({
      status: status || 'online',
      activities: [{
        name: activityName || 'canais de suporte',
        type: parseInt(activityType || '3')
      }]
    });

    res.redirect('/dashboard?presence_success=true');
  });

  app.post('/dashboard/:guildId/save', checkAuth, checkVerifiedEmail, async (req, res) => {
    const { guildId } = req.params;
    const userGuild = req.session.guilds.find(g => g.id === guildId);
    if (!userGuild) return res.sendStatus(403);

    const { staffRoleIds, logChannelId, transcriptChannelId, ticketCategory, title, description, color, thumbnail, image, active, catLabel, catDesc, catEmoji, catValue, catStatus } = req.body;

    const rolesArray = Array.isArray(staffRoleIds) ? staffRoleIds : (staffRoleIds ? [staffRoleIds] : []);

    try {
      const updatedCategories = [];
      if (Array.isArray(catLabel)) {
        for (let i = 0; i < catLabel.length; i++) {
          if (catLabel[i] && catLabel[i].trim() !== '') {
            updatedCategories.push({
              value: catValue[i] || `categoria_${Math.random().toString(36).substring(7)}`,
              label: catLabel[i],
              description: catDesc[i] || '',
              emoji: catEmoji[i] || '💬',
              active: catStatus[i] !== 'hide' // Salva como true se não estiver ocultado
            });
          }
        }
      } else if (catLabel && catLabel.trim() !== '') {
        updatedCategories.push({
          value: catValue || 'suporte',
          label: catLabel,
          description: catDesc || '',
          emoji: catEmoji || '💬',
          active: catStatus !== 'hide'
        });
      }

      await GuildConfig.findOneAndUpdate(
        { guildId },
        {
          staffRoleIds: rolesArray,
          logChannelId,
          transcriptChannelId,
          ticketCategory,
          active: active === 'true',
          'panelEmbed.title': title,
          'panelEmbed.description': description,
          'panelEmbed.color': color,
          'panelEmbed.thumbnail': thumbnail,
          'panelEmbed.image': image,
          categories: updatedCategories
        },
        { upsert: true }
      );

      // Atualiza o Discord em background
      liveUpdatePanel(client, guildId);

      res.redirect(`/dashboard/${guildId}?success=true`);
    } catch (dbError) {
      console.error('[ERRO AO SALVAR CONFIGS]', dbError);
      res.status(500).send('Erro ao salvar as configurações.');
    }
  });

  const PORT = process.env.PORT || 3000;
  app.listen(PORT, () => console.log(`[WEBSITE] Rodando em http://localhost:${PORT}`));
};