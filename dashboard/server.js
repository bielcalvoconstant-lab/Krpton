const express = require('express');
const session = require('express-session');
const path = require('path');
const DiscordOAuth2 = require('discord-oauth2');
const nodemailer = require('nodemailer');
const crypto = require('crypto');
const GuildConfig = require('../models/GuildConfig');
const User = require('../models/User');
const { liveUpdatePanel } = require('../utils/panelUpdater');

// Funções Auxiliares de Criptografia Segura (Nativas do Node.js)
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

  // Middlewares de verificação de autenticação
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

  // --- ROTAS DO SITE ---

  // Página Inicial
  app.get('/', (req, res) => {
    res.render('index', { 
      user: req.session.user || null, 
      clientId: process.env.CLIENT_ID 
    });
  });

  // Tela de Login Local (E-mail + Senha)
  app.get('/login', (req, res) => {
    if (req.session.user) return res.redirect('/dashboard');
    res.render('verify-email', { user: null, error: req.query.error || null, mode: 'login' });
  });

  // POST Login Local
  app.post('/login', async (req, res) => {
    const { email, password } = req.body;
    if (!email || !password) return res.redirect('/login?error=Preencha todos os campos.');

    try {
      const dbUser = await User.findOne({ email: email.toLowerCase() });
      if (!dbUser || !verifyPassword(password, dbUser.password)) {
        return res.redirect('/login?error=Credenciais inválidas.');
      }

      const otpCode = Math.floor(100000 + Math.random() * 900000).toString();
      dbUser.otp = otpCode;
      dbUser.otpExpires = new Date(Date.now() + 10 * 60 * 1000);
      dbUser.isVerified = false;
      await dbUser.save();

      sendSecurityEmail(email, otpCode);

      req.session.user = { email: dbUser.email, id: dbUser.discordId };
      req.session.save(() => {
        res.redirect(`/verify-otp?email=${encodeURIComponent(email)}`);
      });
    } catch (err) {
      res.redirect('/login?error=Erro interno de autenticação.');
    }
  });

  // Tela de Cadastro Local
  app.get('/register', (req, res) => {
    res.render('verify-email', { user: null, error: req.query.error || null, mode: 'register' });
  });

  // POST Cadastro Local
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
      res.redirect('/register?error=Erro ao processar o cadastro.');
    }
  });

  // --- RECONECTAR / ESQUECI A SENHA ---

  app.get('/forgot-password', (req, res) => {
    res.render('verify-email', { user: null, error: req.query.error || null, mode: 'forgot' });
  });

  app.post('/forgot-password', async (req, res) => {
    const { email } = req.body;
    const dbUser = await User.findOne({ email: email.toLowerCase() });

    if (!dbUser) return res.redirect('/forgot-password?error=E-mail não cadastrado no painel.');

    const resetCode = Math.floor(100000 + Math.random() * 900000).toString();
    dbUser.resetToken = resetCode;
    dbUser.resetTokenExpires = new Date(Date.now() + 15 * 60 * 1000); // 15 minutos
    await dbUser.save();

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
      return res.redirect(`/reset-password?email=${encodeURIComponent(email)}&error=Código incorreto ou expirado.`);
    }

    dbUser.password = hashPassword(newPassword);
    dbUser.resetToken = null;
    dbUser.resetTokenExpires = null;
    await dbUser.save();

    res.redirect('/login?error=Senha alterada com sucesso! Faça login com as novas credenciais.');
  });

  // Enviar / Reenviar Código OTP
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

  // Função auxiliar de envio de emails de segurança por API
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
                            <p style="font-size: 14px; color: #94a3b8;">Olá! Use o código de 6 dígitos abaixo para verificar a sua conta.</p>
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

  // --- ROTAS DO DISCORD OAUTH2 (LOGIN DIRETO / VINCULAÇÃO) ---

  // Rota de Redirecionamento de Login do Discord
  app.get('/auth/login', (req, res) => {
    const url = oauth.generateAuthUrl({
      scope: ['identify', 'guilds'],
      state: 'krypton_secret_state'
    });
    res.redirect(url);
  });

  // Callback de retorno do Discord
  app.get('/auth/callback', async (req, res) => {
    const { code } = req.query;
    if (!code) return res.redirect('/');

    try {
      const tokenData = await oauth.tokenRequest({
        code,
        scope: ['identify', 'guilds'],
        grantType: 'authorization_code'
      });

      const discordUser = await oauth.getUser(tokenData.access_token);
      const guilds = await oauth.getUserGuilds(tokenData.access_token);

      let dbUser;

      // Se já está logado localmente por e-mail, apenas vincula o Discord
      if (req.session.user) {
        dbUser = await User.findOneAndUpdate(
          { email: req.session.user.email },
          { discordId: discordUser.id },
          { new: true }
        );
      } else {
        // Se entrou diretamente pelo botão do Discord, procura a conta pelo ID do Discord ou E-mail
        dbUser = await User.findOne({ discordId: discordUser.id });
        
        if (!dbUser && discordUser.email) {
          dbUser = await User.findOne({ email: discordUser.email.toLowerCase() });
        }

        // NOVO: Registro Automático Seguro se for o primeiro login da conta
        if (!dbUser) {
          const randomPassword = crypto.randomBytes(16).toString('hex');
          const encryptedPassword = hashPassword(randomPassword);
          const role = discordUser.email && discordUser.email.toLowerCase() === 'mafiosodashopping@gmail.com' ? 'superadmin' : 'user';

          dbUser = await User.create({
            email: discordUser.email ? discordUser.email.toLowerCase() : `${discordUser.username}@discord-user.com`,
            password: encryptedPassword,
            discordId: discordUser.id,
            isVerified: true, // E-mail verificado pela conta do Discord
            role
          });
        } else {
          // Atualiza as chaves da conta existente
          dbUser.discordId = discordUser.id;
          dbUser.isVerified = true;
          await dbUser.save();
        }
      }

      req.session.user = { email: dbUser.email, id: dbUser.discordId };
      req.session.guilds = guilds.filter(g => g.owner || (BigInt(g.permissions) & 8n) === 8n);
      req.session.userRole = dbUser.role;

      req.session.save(() => {
        res.redirect('/dashboard');
      });
    } catch (err) {
      console.error('[ERRO OAUTH CALLBACK]', err);
      res.redirect('/login?error=Erro ao realizar login com o Discord.');
    }
  });

  // Logout do site
  app.get('/auth/logout', (req, res) => {
    req.session.destroy(() => {
      res.redirect('/');
    });
  });

  // --- ROTAS DO PAINEL PRINCIPAL ---

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

    req.session.save(() => {
      res.redirect('/dashboard');
    });
  });

  // Lista de servidores
  app.get('/dashboard', checkAuth, checkVerifiedEmail, (req, res) => {
    if (!req.session.guilds) {
      return res.redirect('/auth/login'); // Força a puxar a lista de servidores se ela estiver ausente
    }
    res.render('dashboard', { 
      user: req.session.user, 
      guilds: req.session.guilds,
      role: req.session.userRole 
    });
  });

  // Configuração individual de servidor
  app.get('/dashboard/:guildId', checkAuth, checkVerifiedEmail, async (req, res) => {
    const { guildId } = req.params;
    if (!req.session.guilds) return res.redirect('/auth/login');
    
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

  // ROTA DO DESENVOLVEDOR: Presença global (Apenas mafiosodashopping@gmail.com)
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

  // Salvar configurações do Servidor
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
              active: catStatus[i] !== 'hide'
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

      // Atualiza o Discord de forma assíncrona para evitar congelamentos
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