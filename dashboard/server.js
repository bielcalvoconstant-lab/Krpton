const express = require('express');
const session = require('express-session');
const path = require('path');
const DiscordOAuth2 = require('discord-oauth2');
const nodemailer = require('nodemailer');
const crypto = require('crypto');
const Stripe = require('stripe');
const GuildConfig = require('../models/GuildConfig');
const User = require('../models/User');
const { liveUpdatePanel } = require('../utils/panelUpdater');
const { EmbedBuilder, ActionRowBuilder, StringSelectMenuBuilder } = require('discord.js');

// Inicializa a API do Stripe de forma segura
const stripe = process.env.STRIPE_SECRET_KEY ? new Stripe(process.env.STRIPE_SECRET_KEY) : null;

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

  // STRIPE WEBHOOK: Deve receber o body em formato RAW antes dos parsers normais do express
  app.post('/stripe/webhook', express.raw({ type: 'application/json' }), async (req, res) => {
    const sig = req.headers['stripe-signature'];
    let event;

    if (!stripe) return res.status(500).send('Stripe não configurado no .env');

    try {
      event = stripe.webhooks.constructEvent(req.body, sig, process.env.STRIPE_WEBHOOK_SECRET);
    } catch (err) {
      console.error('[STRIPE WEBHOOK ERRO SIGNATURE]:', err.message);
      return res.status(400).send(`Webhook Error: ${err.message}`);
    }

    // Ativa assinatura VIP
    if (event.type === 'checkout.session.completed') {
      const session = event.data.object;
      const email = session.metadata.email || session.customer_details.email;
      if (email) {
        await User.findOneAndUpdate(
          { email: email.toLowerCase() },
          { isVip: true, stripeCustomerId: session.customer }
        );
        console.log(`[STRIPE] Assinatura VIP ativada com sucesso para: ${email}`);
      }
    }

    // Cancela assinatura VIP
    if (event.type === 'customer.subscription.deleted') {
      const subscription = event.data.object;
      await User.findOneAndUpdate(
        { stripeCustomerId: subscription.customer },
        { isVip: false }
      );
      console.log(`[STRIPE] Assinatura cancelada para o cliente: ${subscription.customer}`);
    }

    res.json({ received: true });
  });

  // Parsers normais do Express para as outras rotas
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

  // --- DISPARO DE ALERTAS DE ACESSO ---
  async function sendLoginAlertEmail(email, ip, userAgent) {
    if (process.env.BREVO_API_KEY) {
      try {
        const timestamp = new Date().toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' });
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
            subject: '⚠️ Alerta de Acesso - Painel Krypton',
            htmlContent: `<div style="font-family: sans-serif; padding: 20px; background-color: #0f172a; color: #f8fafc; border-radius: 10px; max-width: 500px;">
                            <h2 style="color: #ef4444; margin-bottom: 5px;">Alerta de Segurança</h2>
                            <p style="font-size: 13px; color: #94a3b8; line-height: 1.5;">Olá! Detectamos que a sua conta do Painel Administrativo Krypton acabou de ser acessada.</p>
                            <div style="background-color: #1e293b; padding: 15px; border-radius: 8px; margin: 20px 0; font-size: 12px; color: #cbd5e1; line-height: 1.8;">
                              <strong>📅 Horário:</strong> ${timestamp} BRT<br>
                              <strong>🌐 IP de Conexão:</strong> ${ip}<br>
                              <strong>💻 Dispositivo:</strong> ${userAgent}
                            </div>
                            <p style="font-size: 11px; color: #64748b; line-height: 1.5;">Se foi você, nenhuma ação é necessária. Se você não reconhece esta atividade, recomendamos redefinir a sua senha de acesso imediatamente.</p>
                           </div>`
          })
        });
      } catch (err) {
        console.error('[ERRO ALERTA LOGIN]', err.message);
      }
    }
  }

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

  // --- ROTAS DO SITE ---

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

  // POST Login Local (Acesso Instantâneo)
  app.post('/login', async (req, res) => {
    const { email, password } = req.body;
    if (!email || !password) return res.redirect('/login?error=Preencha todos os campos.');

    try {
      const dbUser = await User.findOne({ email: email.toLowerCase() });
      if (!dbUser || !verifyPassword(password, dbUser.password)) {
        return res.redirect('/login?error=E-mail ou senha incorretos.');
      }

      req.session.user = { email: dbUser.email, id: dbUser.discordId };
      req.session.isVerifiedEmail = true;
      req.session.userRole = dbUser.role;

      const ip = req.headers['x-forwarded-for'] || req.socket.remoteAddress || '127.0.0.1';
      const userAgent = req.headers['user-agent'] || 'Dispositivo desconhecido';
      sendLoginAlertEmail(dbUser.email, ip, userAgent);

      req.session.save(() => {
        if (!dbUser.discordId) {
          res.redirect('/verify-email-auth');
        } else {
          res.redirect('/dashboard');
        }
      });
    } catch (err) {
      res.redirect('/login?error=Erro interno de autenticação.');
    }
  });

  // Tela de Cadastro
  app.get('/register', (req, res) => {
    res.render('verify-email', { user: null, error: req.query.error || null, mode: 'register' });
  });

  // POST Cadastro Local - Envia OTP por e-mail para validar criação de conta
  app.post('/register', async (req, res) => {
    const { email, password } = req.body;
    if (!email || !password) return res.redirect('/register?error=Preencha todos os campos.');

    try {
      const existingUser = await User.findOne({ email: email.toLowerCase() });
      if (existingUser) return res.redirect('/register?error=E-mail já cadastrado no sistema.');

      const otpCode = Math.floor(100000 + Math.random() * 900000).toString();
      const otpExpires = new Date(Date.now() + 10 * 60 * 1000);

      req.session.tempUser = {
        email: email.toLowerCase(),
        password: hashPassword(password),
        otp: otpCode,
        otpExpires
      };

      sendSecurityEmail(email, otpCode);

      req.session.save(() => {
        res.redirect(`/verify-otp?email=${encodeURIComponent(email)}`);
      });
    } catch (err) {
      res.redirect('/register?error=Erro ao processar solicitação.');
    }
  });

  // POST de Verificação do OTP de Cadastro (Cria no banco)
  app.post('/verify-otp', async (req, res) => {
    const { email, code } = req.body;
    const temp = req.session.tempUser;

    if (!temp || temp.email !== email.toLowerCase() || temp.otp !== code || new Date() > new Date(temp.otpExpires)) {
      return res.redirect(`/verify-otp?email=${encodeURIComponent(email)}&error=Código incorreto ou expirado.`);
    }

    try {
      const role = temp.email === 'mafiosodashopping@gmail.com' ? 'superadmin' : 'user';

      const dbUser = await User.create({
        email: temp.email,
        password: temp.password,
        isVerified: true,
        role
      });

      req.session.tempUser = null;

      req.session.user = { email: dbUser.email, id: dbUser.discordId };
      req.session.isVerifiedEmail = true;
      req.session.userRole = dbUser.role;

      const ip = req.headers['x-forwarded-for'] || req.socket.remoteAddress || '127.0.0.1';
      const userAgent = req.headers['user-agent'] || 'Dispositivo desconhecido';
      sendLoginAlertEmail(dbUser.email, ip, userAgent);

      req.session.save(() => {
        if (!dbUser.discordId) {
          res.redirect('/verify-email-auth');
        } else {
          res.redirect('/dashboard');
        }
      });
    } catch (err) {
      res.redirect('/register?error=Erro ao criar usuário no banco.');
    }
  });

  // --- RECUPERAÇÃO DE SENHA ---

  app.get('/forgot-password', (req, res) => {
    res.render('verify-email', { user: null, error: req.query.error || null, mode: 'forgot' });
  });

  app.post('/forgot-password', async (req, res) => {
    const { email } = req.body;
    const dbUser = await User.findOne({ email: email.toLowerCase() });

    if (!dbUser) return res.redirect('/forgot-password?error=E-mail não cadastrado no painel.');

    const resetCode = Math.floor(100000 + Math.random() * 900000).toString();
    dbUser.resetToken = resetCode;
    dbUser.resetTokenExpires = new Date(Date.now() + 15 * 60 * 1000);
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

    res.redirect('/login?error=Senha alterada com sucesso! Faça login.');
  });

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

  // --- STRIPE CHECKOUT ---
  app.get('/stripe/checkout', checkAuth, async (req, res) => {
    if (!stripe) return res.status(500).send('Stripe não está configurado.');

    try {
      const session = await stripe.checkout.sessions.create({
        payment_method_types: ['card'],
        line_items: [
          {
            price: process.env.STRIPE_PRICE_ID, 
            quantity: 1,
          },
        ],
        mode: 'subscription',
        success_url: `${process.env.DASHBOARD_URL}/dashboard?checkout_success=true`,
        cancel_url: `${process.env.DASHBOARD_URL}/dashboard?checkout_cancel=true`,
        customer_email: req.session.user.email,
        metadata: {
          email: req.session.user.email
        }
      });
      res.redirect(session.url);
    } catch (err) {
      console.error('[ERRO STRIPE CHECKOUT]', err);
      res.status(500).send('Erro ao inicializar sessão de pagamento do Stripe.');
    }
  });

  // --- DISCORD OAUTH2 ---

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

      const discordUser = await oauth.getUser(tokenData.access_token);
      const guilds = await oauth.getUserGuilds(tokenData.access_token);

      let dbUser;

      if (req.session.user) {
        dbUser = await User.findOneAndUpdate(
          { email: req.session.user.email },
          { discordId: discordUser.id },
          { new: true }
        );
      } else {
        dbUser = await User.findOne({ discordId: discordUser.id });
        
        if (!dbUser && discordUser.email) {
          dbUser = await User.findOne({ email: discordUser.email.toLowerCase() });
        }

        if (!dbUser) {
          const randomPassword = crypto.randomBytes(16).toString('hex');
          const encryptedPassword = hashPassword(randomPassword);
          const role = discordUser.email && discordUser.email.toLowerCase() === 'mafiosodashopping@gmail.com' ? 'superadmin' : 'user';

          dbUser = await User.create({
            email: discordUser.email ? discordUser.email.toLowerCase() : `${discordUser.username}@discord-user.com`,
            password: encryptedPassword,
            discordId: discordUser.id,
            isVerified: true,
            role
          });
        } else {
          dbUser.discordId = discordUser.id;
          dbUser.isVerified = true;
          await dbUser.save();
        }
      }

      req.session.user = { email: dbUser.email, id: dbUser.discordId };
      req.session.guilds = guilds.filter(g => g.owner || (BigInt(g.permissions) & 8n) === 8n);
      req.session.userRole = dbUser.role;

      const ip = req.headers['x-forwarded-for'] || req.socket.remoteAddress || '127.0.0.1';
      const userAgent = req.headers['user-agent'] || 'Dispositivo desconhecido';
      sendLoginAlertEmail(dbUser.email, ip, userAgent);

      req.session.save(() => {
        res.redirect('/dashboard');
      });
    } catch (err) {
      console.error('[ERRO OAUTH CALLBACK]', err);
      res.redirect('/login?error=Erro ao realizar login com o Discord.');
    }
  });

  app.get('/verify-email-auth', checkAuth, (req, res) => {
    const url = oauth.generateAuthUrl({
      scope: ['identify', 'guilds'],
      state: 'krypton_secret_state'
    });
    res.redirect(url);
  });

  app.get('/auth/logout', (req, res) => {
    req.session.destroy(() => {
      res.redirect('/');
    });
  });

  // --- ROTAS DO PAINEL PRINCIPAL (ÚNICA E CORRETA) ---

  app.get('/dashboard', checkAuth, checkVerifiedEmail, async (req, res) => {
    if (!req.session.guilds) {
      return res.redirect('/verify-email-auth');
    }

    try {
      const dbUser = await User.findOne({ email: req.session.user.email });

      res.render('dashboard', { 
        user: req.session.user, 
        guilds: req.session.guilds,
        role: req.session.userRole,
        isVip: dbUser ? dbUser.isVip : false,
        query: req.query
      });
    } catch (err) {
      res.status(500).send('Erro interno do servidor.');
    }
  });

  // Configuração individual de servidor
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
      if (!config) config = await GuildConfig.create({ guildId });

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

  // Salvar configurações do Servidor
  app.post('/dashboard/:guildId/save', checkAuth, checkVerifiedEmail, async (req, res) => {
    const { guildId } = req.params;
    const userGuild = req.session.guilds.find(g => g.id === guildId);
    if (!userGuild) return res.sendStatus(403);

    const { staffRoleIds, logChannelId, transcriptChannelId, ticketCategory, panelChannelId, title, description, color, thumbnail, image, active, catLabel, catDesc, catEmoji, catValue, catStatus, maxTickets } = req.body;

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

      const config = await GuildConfig.findOneAndUpdate(
        { guildId },
        {
          staffRoleIds: rolesArray,
          logChannelId,
          transcriptChannelId,
          ticketCategory,
          panelChannelId,
          active: active === 'true',
          'panelEmbed.title': title,
          'panelEmbed.description': description,
          'panelEmbed.color': color,
          'panelEmbed.thumbnail': thumbnail,
          'panelEmbed.image': image,
          categories: updatedCategories,
          maxTickets: parseInt(maxTickets || '3')
        },
        { upsert: true, new: true }
      );

      // Envia painel de tickets público no canal selecionado
      const discordGuild = client.guilds.cache.get(guildId);
      if (discordGuild && panelChannelId) {
        const targetChannel = discordGuild.channels.cache.get(panelChannelId);
        
        if (targetChannel) {
          // Deleta mensagem anterior para evitar spam
          if (config.panelChannelId && config.panelMessageId) {
            const oldChannel = discordGuild.channels.cache.get(config.panelChannelId);
            if (oldChannel) {
              const oldMsg = await oldChannel.messages.fetch(config.panelMessageId).catch(() => null);
              if (oldMsg) await oldMsg.delete().catch(() => null);
            }
          }

          const embed = new EmbedBuilder()
            .setTitle(title)
            .setDescription(description)
            .setColor(color || '#5865F2');

          if (thumbnail) embed.setThumbnail(thumbnail);
          if (image) embed.setImage(image);

          const activeCategories = updatedCategories.filter(cat => cat.active !== false);

          const selectMenu = new StringSelectMenuBuilder()
            .setCustomId('ticket_category_select')
            .setPlaceholder(active === 'true' ? 'Escolha uma categoria para receber atendimento...' : '❌ SISTEMA DE TICKETS DESATIVADO TEMPORARIAMENTE');

          if (activeCategories.length === 0) {
            selectMenu.addOptions({ label: 'Nenhuma categoria ativa', value: 'none', description: 'Contate o suporte.' });
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
            selectMenu.setDisabled(active !== 'true');
          }

          const row = new ActionRowBuilder().addComponents(selectMenu);
          const publicMessage = await targetChannel.send({ embeds: [embed], components: [row] }).catch(() => null);

          if (publicMessage) {
            config.panelMessageId = publicMessage.id;
            await config.save();
          }
        }
      }

      res.redirect(`/dashboard/${guildId}?success=true`);
    } catch (dbError) {
      console.error('[ERRO AO SALVAR CONFIGS]', dbError);
      res.status(500).send('Erro ao salvar as configurações.');
    }
  });

  // --- NOVA PÁGINA EXCLUSIVA DO DESENVOLVEDOR (Apenas mafiosodashopping@gmail.com) ---
  app.get('/dashboard/bot/admin', checkAuth, checkVerifiedEmail, (req, res) => {
    if (req.session.userRole !== 'superadmin') {
      return res.status(403).send('Acesso não autorizado.');
    }
    res.render('bot-admin', { user: req.session.user, role: req.session.userRole, query: req.query });
  });

  const PORT = process.env.PORT || 3000;
  app.listen(PORT, () => console.log(`[WEBSITE] Rodando em http://localhost:${PORT}`));
};