const TelegramBot = require('node-telegram-bot-api');
const MessageFormatter = require('../utils/formatter');
const config = require('../config');

class TelegramBotService {
  constructor(telegramConfig, getPositionsCallback = null) {
    this.bot = new TelegramBot(telegramConfig.botToken, { polling: true });
    this.chatId = telegramConfig.chatId;
    this.pinnedMessageId = null;
    this.getPositions = getPositionsCallback;
    this.webAppUrl = config.webapp?.url;
  }

  async sendOrUpdatePositions(positions) {
    const message = MessageFormatter.formatPositionMessage(positions);

    try {
      if (this.pinnedMessageId) {
        await this.bot.editMessageText(message, {
          chat_id: this.chatId,
          message_id: this.pinnedMessageId,
          parse_mode: 'HTML'
        });
      } else {
        const sentMessage = await this.bot.sendMessage(this.chatId, message, {
          parse_mode: 'HTML'
        });
        this.pinnedMessageId = sentMessage.message_id;
        await this.bot.pinChatMessage(this.chatId, this.pinnedMessageId);
      }
    } catch (error) {
      console.error('Telegram error:', error.message);
    }
  }

  async sendNotification(type, position) {
    const message = MessageFormatter.formatPositionUpdate(type, position);

    try {
      await this.bot.sendMessage(this.chatId, message, {
        parse_mode: 'HTML'
      });
    } catch (error) {
      console.error('Telegram notification error:', error.message);
    }
  }

  setupCommands() {
    this.bot.onText(/\/start(@\w+)?/, (msg) => {
      const commands = [
        '/positions - Show all current positions',
        '/positions SYMBOL - Show positions for specific symbol',
        '/chatid - Get your chat ID'
      ];

      if (this.webAppUrl) {
        commands.push('/app - Open Mini App');
      }

      this.bot.sendMessage(msg.chat.id,
          'MEXC Position Tracker Bot\n\n' +
          'Your positions will be automatically tracked and displayed here.\n\n' +
          'Commands:\n' + commands.join('\n')
      );
    });

    this.bot.onText(/\/app(@\w+)?/, (msg) => {
      if (!this.webAppUrl) {
        this.bot.sendMessage(msg.chat.id, 'Mini App URL not configured. Set WEBAPP_URL in .env');
        return;
      }

      this.bot.sendMessage(msg.chat.id, 'Open the Positions Mini App:', {
        reply_markup: {
          inline_keyboard: [[
            {
              text: 'Open Positions',
              web_app: { url: this.webAppUrl }
            }
          ]]
        }
      });
    });

    this.bot.onText(/\/chatid(@\w+)?/, (msg) => {
      this.bot.sendMessage(msg.chat.id, `Your Chat ID: ${msg.chat.id}`);
    });

    this.bot.onText(/\/positions(@\w+)?(.*)/, async (msg, match) => {
      if (!this.getPositions) {
        this.bot.sendMessage(msg.chat.id, '❌ Positions service not available');
        return;
      }

      const symbolFilter = match[2] ? match[2].trim().toUpperCase() : null;
      const allPositions = this.getPositions();

      if (!allPositions || allPositions.size === 0) {
        this.bot.sendMessage(msg.chat.id, '✅ No open positions', { parse_mode: 'HTML' });
        return;
      }

      let filteredPositions = allPositions;

      if (symbolFilter) {
        filteredPositions = new Map();
        for (const [key, position] of allPositions) {
          if (position.symbol.toUpperCase().includes(symbolFilter)) {
            filteredPositions.set(key, position);
          }
        }

        if (filteredPositions.size === 0) {
          this.bot.sendMessage(msg.chat.id, `❌ No positions found for symbol: ${symbolFilter}`, { parse_mode: 'HTML' });
          return;
        }
      }

      const message = MessageFormatter.formatPositionMessage(filteredPositions);

      try {
        await this.bot.sendMessage(msg.chat.id, message, { parse_mode: 'HTML' });
      } catch (error) {
        console.error('Error sending positions:', error.message);
        this.bot.sendMessage(msg.chat.id, '❌ Error retrieving positions');
      }
    });
  }
}

module.exports = TelegramBotService;
