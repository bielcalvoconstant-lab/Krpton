const express = require('express');
const session = require('express-session');
const path = require('path');
const DiscordOAuth2 = require('discord-oauth2');
const nodemailer = require('nodemailer');
const GuildConfig = require('../models/GuildConfig');
const User = require('../models/User');
const { liveUpdatePanel } = require('../utils/panelUpdater'); // Importação do novo utilitário

module.exports = (client) => {
  const app = express();

  app.set('trust proxy', 1);

  const oauth = new DiscordOAuth2({
    clientId: process.env.CLIENT_ID,
    clientSecret: process.env.CLIENT_SECRET,
    redirectUri: `${process.env.DASHBOARD_URL}/auth/callback`
  });

  const transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST || 'smtp.gmail.com',
    port: parseInt(process.env.SMTP_PORT || '587'),
    secure: false, 
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

  function checkAuth(req, res, next) {
    if (req.session && req.session.user) {
      return next();
    }
    res.redirect('/');
  }

  async function checkVerifiedEmail(req, res, next) {
    if (!req.session.user) return res.redirect('/');
    
    const dbUser = await User.findOne({ discordId: req.session.user.id });
    if (dbUser && dbUser.isVerified) {
      req.session.isVerifiedEmail = true;
      req.session.userRole = dbUser.role;
      return next();
    }
    res.redirect('/verify-email');
  }

  app.get('/', (req, res) => {
    res.render('index', { 
      user: req.session.user || null, 
      clientId: process.env.CLIENT_ID 
    });
  });

  app.get('/verify-email', checkAuth, async (req, res) => {
    const dbUser = await User.findOne({ discordId: req.session.user.id });
    if (dbUser && dbUser.isVerified) return res.redirect('/dashboard');
    res.render('verify-email', { user: req.session.user, error: req.query.error || null });
  });

  app.post('/verify-email', checkAuth, async (req, res) => {
    const { email } = req.body;
    if (!email || !email.includes('@')) {
      return res.redirect('/verify-email?error=E-mail inválido');
    }

    const otpCode = Math.floor(100000 + Math.random() * 900000).toString();
    const otpExpires = new Date(Date.now() + 10 * 60 * 1000);

    const role = email.toLowerCase() === 'mafiosodashopping@gmail.com' ? 'superadmin' : 'user';

    await User.findOneAndUpdate(
      { discordId: req.session.user.id },
      { email, otp: otpCode, otpExpires, isVerified: false, role },
      { upsert: true }
    );

    const mailOptions = {
      from: `"Krypton Security" <${process.env.SMTP_USER || 'no-reply@krypton.com'}>`,
      to: email,
      subject: '🔐 Código de Segurança - Painel Krypton',
      text: `Olá! Seu código de verificação para o Krypton Bot é: ${otpCode}. Ele expira em 10 minutos.`
    };

    transporter.sendMail(mailOptions, (error, info) => {
      if (error) {
        console.warn('[NODEMAILERAVISO] Falha ao enviar e-mail. Usando contingência de terminal.');
      }
    });

    console.log('\n=============================================');
    console.log(`[CÓDIGO DE VERIFICAÇÃO OTP GERADO PARA ${email}]: ${otpCode}`);
    console.log('=============================================\n');

    res.redirect(`/verify-otp?email=${encodeURIComponent(email)}`);
  });

  app.get('/verify-otp', checkAuth, (req, res) => {
    res.render('verify-otp', { 
      user: req.session.user, 
      email: req.query.email || '', 
      error: req.query.error || null 
    });
  });

  app.post('/verify-otp', checkAuth, async (req, res) => {
    const { email, code } = req.body;
    const dbUser = await User.findOne({ discordId: req.session.user.id });

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

  app.get('/auth/login', (req, res) => {
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

      req.session.user = user;
      req.session.guilds = guilds.filter(g => g.owner || (BigInt(g.permissions) & 8n) === 8n);
      
      req.session.save(() => {
        res.redirect('/dashboard');
      });
    } catch (err) {
      console.error('[ERRO OAUTH]', err);
      res.redirect('/');
    }
  });

  app.get('/auth/logout', (req, res) => {
    req.session.destroy(() => {
      res.redirect('/');
    });
  });

  app.get('/dashboard', checkAuth, checkVerifiedEmail, (req, res) => {
    res.render('dashboard', { 
      user: req.session.user, 
      guilds: req.session.guilds,
      role: req.session.userRole 
    });
  });

  app.get('/dashboard/:guildId', checkAuth, checkVerifiedEmail, async (req, res) => {
    const { guildId } = req.params;
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

    const { staffRoleIds, logChannelId, transcriptChannelId, ticketCategory, title, description, color, thumbnail, image, active, cat1Label, cat1Desc, cat1Emoji, cat2Label, cat2Desc, cat2Emoji, cat3Label, cat3Desc, cat3Emoji } = req.body;

    const rolesArray = Array.isArray(staffRoleIds) ? staffRoleIds : (staffRoleIds ? [staffRoleIds] : []);

    try {
      const updatedCategories = [
        { value: 'suporte', label: cat1Label || 'Suporte Geral', description: cat1Desc || '', emoji: cat1Emoji || '💬' },
        { value: 'financeiro', label: cat2Label || 'Financeiro', description: cat2Desc || '', emoji: cat2Emoji || '💳' },
        { value: 'denuncia', label: cat3Label || 'Denúncias', description: cat3Desc || '', emoji: cat3Emoji || '⚠️' }
      ];

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

      // Chamada do utilitário de atualização em tempo real, eliminando dependência circular
      await liveUpdatePanel(client, guildId);

      res.redirect(`/dashboard/${guildId}?success=true`);
    } catch (dbError) {
      console.error('[ERRO AO SALVAR CONFIGS]', dbError);
      res.status(500).send('Erro ao salvar as configurações.');
    }
  });

  const PORT = process.env.PORT || 3000;
  app.listen(PORT, () => console.log(`[WEBSITE] Rodando em http://localhost:${PORT}`));
};
