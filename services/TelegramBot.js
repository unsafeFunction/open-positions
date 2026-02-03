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
    this.messageTracker = new Map();
  }

  getPositionKey(position) {
    return `pos_${position.symbol}_${position.positionId}`;
  }

  getOrderKey(order) {
    return `order_${order.symbol}_${order.orderId}`;
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
    const exchangeUrl = MessageFormatter.getExchangeUrl(position.exchangeType, position.symbol);

    const options = {
      parse_mode: 'HTML'
    };

    const typesWithButton = ['opened', 'limitOrderPlaced', 'marketOrderPlaced', 'marketOrderFilled'];

    if (typesWithButton.includes(type) && exchangeUrl) {
      options.reply_markup = {
        inline_keyboard: [[
          { text: position.symbol, url: exchangeUrl }
        ]]
      };
    }

    const replyTypes = {
      'closed': 'pos',
      'positionIncreased': 'pos',
      'positionDecreased': 'pos',
      'limitOrderFilled': 'order',
      'limitOrderCancelled': 'order',
      'marketOrderFilled': 'order',
      'marketOrderCancelled': 'order'
    };

    if (replyTypes[type]) {
      const key = replyTypes[type] === 'pos'
        ? this.getPositionKey(position)
        : this.getOrderKey(position);
      const originalMessageId = this.messageTracker.get(key);
      if (originalMessageId) {
        options.reply_to_message_id = originalMessageId;
      }
    }

    try {
      const sentMessage = await this.bot.sendMessage(this.chatId, message, options);

      if (type === 'opened') {
        const key = this.getPositionKey(position);
        this.messageTracker.set(key, sentMessage.message_id);
      } else if (type === 'limitOrderPlaced' || type === 'marketOrderPlaced') {
        const key = this.getOrderKey(position);
        this.messageTracker.set(key, sentMessage.message_id);
      }

      if (type === 'closed') {
        const key = this.getPositionKey(position);
        this.messageTracker.delete(key);
      } else if (['limitOrderFilled', 'limitOrderCancelled', 'marketOrderFilled', 'marketOrderCancelled'].includes(type)) {
        const key = this.getOrderKey(position);
        this.messageTracker.delete(key);
      }
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
        this.bot.sendMessage(msg.chat.id, 'Сервис позиций недоступен');
        return;
      }

      const symbolFilter = match[2] ? match[2].trim().toUpperCase() : null;
      const allPositions = this.getPositions();

      if (!allPositions || allPositions.size === 0) {
        this.bot.sendMessage(msg.chat.id, 'Нет открытых позиций', { parse_mode: 'HTML' });
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
          this.bot.sendMessage(msg.chat.id, `Позиции не найдены: ${symbolFilter}`, { parse_mode: 'HTML' });
          return;
        }
      }

      const message = MessageFormatter.formatPositionMessage(filteredPositions);

      try {
        await this.bot.sendMessage(msg.chat.id, message, { parse_mode: 'HTML' });
      } catch (error) {
        console.error('Error sending positions:', error.message);
        this.bot.sendMessage(msg.chat.id, 'Ошибка получения позиций');
      }
    });
  }
}

module.exports = TelegramBotService;
