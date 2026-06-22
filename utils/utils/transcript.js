const { AttachmentBuilder } = require('discord.js');

async function createTranscript(channel, guild) {
  const messages = await channel.messages.fetch({ limit: 100 });
  const sortedMessages = [...messages.values()].reverse();

  let htmlContent = `
  <!DOCTYPE html>
  <html lang="pt-BR">
  <head>
    <meta charset="UTF-8">
    <title>Histórico de Ticket: ${channel.name}</title>
    <script src="https://cdn.tailwindcss.com"></script>
  </head>
  <body class="bg-slate-900 text-slate-100 p-8">
    <div class="max-w-4xl mx-auto">
      <header class="border-b border-slate-700 pb-4 mb-6">
        <h1 class="text-3xl font-bold">Krypton Ticket Transcript</h1>
        <p class="text-sm text-slate-400">Canal: #${channel.name} | Servidor: ${guild.name}</p>
        <p class="text-xs text-slate-500">Documento gerado automaticamente no encerramento.</p>
      </header>
      <section class="space-y-4">
  `;

  for (const msg of sortedMessages) {
    if (msg.author.bot && !msg.embeds.length) continue; // Pular mensagens internas de utilidade básica do bot

    const dateStr = msg.createdAt.toLocaleString('pt-BR');
    htmlContent += `
      <div class="flex items-start gap-4 p-3 bg-slate-800 rounded-lg">
        <img src="${msg.author.displayAvatarURL()}" class="w-10 h-10 rounded-full" alt="Avatar" />
        <div>
          <div class="flex items-center gap-2">
            <span class="font-bold text-violet-400">${msg.author.tag}</span>
            <span class="text-xs text-slate-500">${dateStr}</span>
          </div>
          <p class="text-sm text-slate-300 mt-1">${msg.content || ''}</p>
    `;

    if (msg.embeds.length > 0) {
      msg.embeds.forEach(embed => {
        htmlContent += `
          <div class="mt-2 p-3 bg-slate-700 rounded border-l-4 border-violet-500 max-w-lg">
            ${embed.title ? `<div class="font-semibold text-slate-100">${embed.title}</div>` : ''}
            ${embed.description ? `<div class="text-xs text-slate-300 mt-1">${embed.description}</div>` : ''}
          </div>
        `;
      });
    }

    htmlContent += `
        </div>
      </div>
    `;
  }

  htmlContent += `
      </section>
    </div>
  </body>
  </html>
  `;

  const buffer = Buffer.from(htmlContent, 'utf-8');
  return new AttachmentBuilder(buffer, { name: `transcript-${channel.name}.html` });
}

module.exports = { createTranscript };
