require('dotenv').config();
const { Client, GatewayIntentBits, Partials } = require('discord.js');
const mongoose = require('mongoose');

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent
  ],
  partials: [Partials.Channel, Partials.Message, Partials.GuildMember]
});

// CORREÇÃO: Desativa o enfileiramento de consultas na memória (Operation Buffering).
// Se o banco estiver fora do ar, o bot falha rapidamente e avisa o usuário, em vez de travar no "pensando".
mongoose.set('bufferCommands', false);

mongoose.connect(process.env.MONGO_URI, {
  serverSelectionTimeoutMS: 5000, // Interrompe a tentativa de conexão após 5 segundos de silêncio
})
.then(() => console.log('[BANCO DE DADOS] Conectado ao MongoDB com sucesso.'))
.catch((err) => {
  console.error('[ERRO CRÍTICO BANCO] Falha ao conectar ao MongoDB:', err.message);
});

// Inicializando Gerenciadores (Handlers)
require('./handlers/commandHandler')(client);
require('./handlers/eventHandler')(client);

// Inicialização do Dashboard Web
require('./dashboard/server')(client);

client.login(process.env.DISCORD_TOKEN);
