// === Merged Discord Bot with mention ignore @everyone/@here and DM toggle system ===
const {
  Client,
  GatewayIntentBits,
  Partials,
  EmbedBuilder,
  PermissionsBitField,
} = require('discord.js');

const BOT_TOKEN = 'MTQwMTEzMzY3MTE5NjUyNDYwNA.Gd0Nuu.IjsXesT0CSghStfK57Q8okhnCnLPfhP-IO5QvM';
const BOT_OWNER_ID = '1399842224010821723';
const HOSTER_ROLE_ID = '1400492122104402040';
const EMOJI_2 = '<:emoji_2:1401284292222648443>';

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.GuildMessageReactions,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildMembers,
  ],
  partials: [Partials.Message, Partials.Channel, Partials.Reaction],
});

const activeSessions = new Map();
const dmAllEnabled = new Map(); // Per-server toggle

client.once('ready', () => {
  console.log(`✅ Logged in as ${client.user.tag}`);
  client.user.setPresence({
    status: 'idle',
    activities: [{ name: 'OSC FC', type: 3 }],
  });
});

// DM info message to hosters when they get role
async function sendHosterDM(member) {
  try {
    const embed = new EmbedBuilder()
      .setColor('Purple')
      .setTitle('👑 Welcome Friendly Hoster!')
      .setDescription(
        `You've been added as a **Friendly Hoster** in **${member.guild.name}**!\n\n__**How to use the bot:**__\n\n> **.friendly** - Start a match setup\n> **.cancel** - Cancel a match\n\nOnce 7 players react, the bot will announce the link automatically.\n\nNeed help? Contact <@${BOT_OWNER_ID}>`
      )
      .setFooter({ text: 'OSC FC Bot by savvy also hoster is priv dont ask.' });
    await member.send({ embeds: [embed] });
  } catch {
    // Ignore if DM fails
  }
}

client.on('guildMemberUpdate', async (oldMember, newMember) => {
  if (
    !oldMember.roles.cache.has(HOSTER_ROLE_ID) &&
    newMember.roles.cache.has(HOSTER_ROLE_ID)
  ) {
    // Member got hoster role
    sendHosterDM(newMember);
  }
});

client.on('messageCreate', async (message) => {
  try {
    if (!message.guild || message.author.bot) return;

    const prefix = '.';
    if (!message.content.startsWith(prefix)) {
      if (
        message.mentions.has(client.user) &&
        !message.mentions.everyone &&
        !message.mentions.roles.some(
          (r) => r.name === '@everyone' || r.name === '@here'
        )
      ) {
        const embed = new EmbedBuilder()
          .setTitle('👋 Hi!')
          .setDescription(
            `I'm OSC FC bot made by <@${BOT_OWNER_ID}>.\nI am online 24/7 unless the subscription is cancelled.\n\nMy commands:\n\`.friendly\` - Start a friendly match\n\`.cancel\` - Cancel the friendly session (Friendly Hosters only)\n\`.training\` - Start a training session\n*(For Friendly Hosters)*`
          )
          .setColor('Blue')
          .setTimestamp();
        await message.channel.send({ embeds: [embed] });
      }
      return;
    }

    const args = message.content.slice(prefix.length).trim().split(/ +/);
    const command = args.shift().toLowerCase();

    const guildId = message.guild.id;
    const authorId = message.author.id;
    const member = await message.guild.members.fetch(authorId);

    const isOwner = authorId === BOT_OWNER_ID;
    const isAdmin = member.permissions.has(PermissionsBitField.Flags.Administrator);
    const isHoster = HOSTER_ROLE_ID && member.roles.cache.has(HOSTER_ROLE_ID);
    const isServerOwner = message.guild.ownerId === authorId;
    const dmEnabled = dmAllEnabled.get(guildId) || false;

    if (command === 'dmenable') {
      if (!(isOwner || isServerOwner))
        return message.reply('Only the bot owner or server owner can use this command.');
      dmAllEnabled.set(guildId, true);
      return message.reply('✅ DM to all participants is now ENABLED for admins and hosters.');
    }

    if (command === 'dmdisable') {
      if (!(isOwner || isServerOwner))
        return message.reply('Only the bot owner or server owner can use this command.');
      dmAllEnabled.set(guildId, false);
      return message.reply('❌ DM to all participants is now DISABLED. Only the bot owner can DM users.');
    }

    // Shared function for both friendly and training sessions
    async function startSession(type) {
      if (!(isOwner || isAdmin || isHoster)) {
        return message.reply('You are not allowed to run this command.');
      }

      if (activeSessions.has(guildId)) {
        return message.reply('⚠️ A session is already running. Use `.cancel` to stop it.');
      }

      await message.delete().catch(() => {});

      const session = {
        messages: [],
        participants: new Set(),
        collectors: [],
        cancelled: false,
        type: type, // 'friendly' or 'training'
      };
      activeSessions.set(guildId, session);

      const color = type === 'friendly' ? 'Green' : 'Purple';
      const title = type === 'friendly' ? 'Friendly Match' : 'Training Session';

      const friendlyMsg = await message.channel.send({
        content: `@everyone Also please show up.`,
        embeds: [
          new EmbedBuilder()
            .setTitle(title)
            .setDescription(
              `# ${EMOJI_2} ▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬ ${EMOJI_2}\n${type.toUpperCase()}IES HOSTING – OSC FC\nReacts: 7+\nReact with: ✅\n| @here @everyone\n▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬`
            )
            .setColor(color),
        ],
      });
      session.messages.push(friendlyMsg);

      await friendlyMsg.react('✅');

      const collector = friendlyMsg.createReactionCollector({
        filter: (reaction, user) => reaction.emoji.name === '✅' && !user.bot,
        time: 15 * 60 * 1000,
      });
      session.collectors.push(collector);

      // 6-minute no-player cancel timeout
      const timeout6m = setTimeout(async () => {
        if (!session.cancelled && session.participants.size < 6) {
          await message.channel.send('# Friendly canceled Due to no players.');
          await cleanupSession(guildId);
        }
      }, 6 * 60 * 1000);

      // 15-minute hard timeout (silent)
      const timeout15m = setTimeout(async () => {
        if (!session.cancelled) {
          await cleanupSession(guildId);
        }
      }, 15 * 60 * 1000);

      collector.on('collect', async (reaction, user) => {
        if (session.cancelled) return;

        if (!session.participants.has(user.id)) {
          session.participants.add(user.id);

          if (isOwner || dmEnabled) {
            try {
              await user.send({
                embeds: [
                  new EmbedBuilder()
                    .setTitle('Friendly Invite')
                    .setDescription(
                      `Hello <@${user.id}>,\nThere is a friendly being hosted in <#${message.channel.id}>.\nIf you want to play, react ✅.`
                    )
                    .setColor('Blue'),
                ],
              });
            } catch {}
          }
        }

        // When 6 or 7 players reached, stop collecting
        if (session.participants.size === 6 || session.participants.size === 7) {
          clearTimeout(timeout6m);
          clearTimeout(timeout15m);
          collector.stop();
        }
      });

      collector.on('end', async () => {
        if (!activeSessions.has(guildId) || session.cancelled) return;

        await message.channel.send({ content: `# React for Positions @here` });

        const positions = ['GK', 'CB', 'RB', 'LB', 'ST', 'RW', 'LW'];
        const claimed = new Map();

        for (const pos of positions) {
          if (session.cancelled) break;

          const posMsg = await message.channel.send({
            embeds: [
              new EmbedBuilder()
                .setTitle(`${pos}`)
                .setDescription(`React ✅ to claim this position.`)
                .setColor('Orange'),
            ],
          });
          session.messages.push(posMsg);

          await posMsg.react('✅');

          const rCollector = posMsg.createReactionCollector({
            filter: (r, u) => r.emoji.name === '✅' && !u.bot,
            max: 1,
            time: 15 * 60 * 1000,
          });
          session.collectors.push(rCollector);

          rCollector.on('collect', (r, u) => {
            if (session.cancelled || [...claimed.values()].includes(u.id)) return;
            claimed.set(pos, u.id);
            posMsg.edit({
              embeds: [
                new EmbedBuilder()
                  .setTitle(`${pos}`)
                  .setDescription(`${pos}: <@${u.id}>`)
                  .setColor('Green'),
              ],
            });
          });
        }
      });
    }

    if (command === 'friendly') {
      await startSession('friendly');
    }

    if (command === 'training') {
      await startSession('training');
    }

    if (command === 'cancel') {
      if (!(isOwner || isAdmin || isHoster))
        return message.reply('You are not allowed to run this command.');

      if (!activeSessions.has(guildId))
        return message.reply('There is no active session to cancel.');

      const session = activeSessions.get(guildId);
      session.cancelled = true;

      for (const col of session.collectors) {
        try {
          col.stop();
        } catch {}
      }

      for (const msg of session.messages) {
        try {
          await msg.delete();
        } catch {}
      }

      activeSessions.delete(guildId);
      await message.channel.send(`# Friendly Canceled`);
      await message.delete().catch(() => {});
    }
  } catch (err) {
    console.error('Error in messageCreate:', err);
  }
});

// Cleanup helper
async function cleanupSession(guildId) {
  const session = activeSessions.get(guildId);
  if (!session) return;

  session.cancelled = true;
  for (const col of session.collectors) {
    try {
      col.stop();
    } catch {}
  }
  for (const msg of session.messages) {
    try {
      await msg.delete();
    } catch {}
  }
  activeSessions.delete(guildId);
}

process.on('unhandledRejection', (reason) => {
  console.error('Unhandled Rejection:', reason);
});
process.on('uncaughtException', (err) => {
  console.error('Uncaught Exception:', err);
});

client.login(BOT_TOKEN);
