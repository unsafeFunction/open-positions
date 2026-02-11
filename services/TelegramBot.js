const TelegramBot = require('node-telegram-bot-api');
const MessageFormatter = require('../utils/formatter');
const config = require('../config');

class TelegramBotService {
  constructor(telegramConfig, getPositionsCallback = null, getExchangeStatusesCallback = null) {
    this.bot = new TelegramBot(telegramConfig.botToken, {
      polling: {
        params: {
          allowed_updates: ['message', 'chat_join_request', 'chat_member']
        }
      }
    });
    this.chatId = telegramConfig.chatId;
    this.pinnedMessageId = null;
    this.getPositions = getPositionsCallback;
    this.getExchangeStatuses = getExchangeStatusesCallback;
    this.webAppUrl = config.webapp?.url;
    this.messageTracker = new Map();

    // Access control properties
    this.autoAcceptEnabled = config.telegram?.autoAcceptEnabled || false;
    this.mainChannelId = config.telegram?.mainChannelId || null;
    this.secondChannelId = config.telegram?.secondChannelId || null;
    this.accessControlEnabled = this.autoAcceptEnabled && !!this.mainChannelId && !!this.secondChannelId;
    this.kickCheckInterval = config.telegram?.kickCheckInterval || 3600;

    // Initialize access control if enabled
    if (this.accessControlEnabled) {
      this.setupAccessControl();
    } else {
      if (!this.autoAcceptEnabled) {
        console.log('[Telegram] Access control DISABLED (TELEGRAM_AUTO_ACCEPT_ENABLED=false)');
      } else if (!this.mainChannelId || !this.secondChannelId) {
        console.log('[Telegram] Access control not configured (channel IDs not set in .env)');
      }
    }
  }

  // ============================================
  // ACCESS CONTROL METHODS
  // ============================================

  setupAccessControl() {
    console.log(`[Access Control] ===== INITIALIZING =====`);
    console.log(`[Access Control] Auto-accept: ENABLED`);
    console.log(`[Access Control] Main channel (paid members): ${this.mainChannelId}`);
    console.log(`[Access Control] Second channel (join requests): ${this.secondChannelId}`);

    // Debug: Log ALL updates to see what we're receiving
    this.bot.on('update', (update) => {
      console.log('[Access Control] Received update type:', Object.keys(update).filter(k => k !== 'update_id'));
    });

    // Listen for join requests (requires Bot API 5.5+)
    this.bot.on('chat_join_request', (joinRequest) => {
      console.log('[Access Control] ✓ chat_join_request event received!');
      this.handleJoinRequest(joinRequest);
    });

    // Listen for chat member updates (requires Bot API 5.1+)
    this.bot.on('chat_member', (update) => {
      console.log('[Access Control] ✓ chat_member event received!');
      this.handleChatMemberUpdate(update);
    });

    console.log('[Access Control] Event listeners registered');
    console.log('[Access Control] ===== READY =====');
    console.log('[Access Control] NOTE: Only NEW join requests (after bot start) will be processed');
    console.log('[Access Control] For existing pending requests, users need to cancel and re-request');
  }

  async handleJoinRequest(joinRequest) {
    console.log('[Access Control] ===== JOIN REQUEST RECEIVED =====');
    console.log('[Access Control] Request chat ID:', joinRequest.chat.id);
    console.log('[Access Control] Our second channel ID:', this.secondChannelId);

    // Only handle requests for our second channel
    if (joinRequest.chat.id !== this.secondChannelId) {
      console.log('[Access Control] Ignoring - not our second channel');
      return;
    }

    const user = joinRequest.from;
    const userTag = `${user.first_name} (ID: ${user.id})`;
    console.log(`[Access Control] Processing join request from ${userTag}`);

    try {
      await this.checkAndResolve(user.id, userTag);
    } catch (error) {
      console.error(`[Access Control] ERROR processing ${userTag}:`, error.message);
      console.error('[Access Control] Full error:', error);
    }
  }

  async checkAndResolve(userId, userTag) {
    const allowedStatuses = ['member', 'administrator', 'creator'];

    console.log(`[Access Control] Checking ${userTag} membership in main channel ${this.mainChannelId}...`);

    try {
      const member = await this.bot.getChatMember(this.mainChannelId, userId);
      console.log(`[Access Control] User status in main channel: ${member.status}`);

      if (allowedStatuses.includes(member.status)) {
        console.log(`[Access Control] ✓ User is ${member.status}, approving...`);
        await this.bot.approveChatJoinRequest(this.secondChannelId, userId);
        console.log(`[Access Control] ✅ APPROVED ${userTag} – member of main channel`);
      } else {
        console.log(`[Access Control] ✗ User status '${member.status}' not allowed, declining...`);
        await this.bot.declineChatJoinRequest(this.secondChannelId, userId);
        console.log(`[Access Control] ❌ DECLINED ${userTag} – status '${member.status}' in main channel`);
      }
    } catch (error) {
      console.log(`[Access Control] Error checking membership: ${error.message}`);

      // If user is not a participant in main channel, decline
      if (error.message.includes('USER_NOT_PARTICIPANT') || error.message.includes('user not found')) {
        console.log(`[Access Control] ✗ User not found in main channel, declining...`);
        await this.bot.declineChatJoinRequest(this.secondChannelId, userId);
        console.log(`[Access Control] ❌ DECLINED ${userTag} – not in main channel`);
      } else {
        console.error('[Access Control] Unexpected error:', error);
        throw error;
      }
    }
  }

  async kickFromSecond(userId, userTag) {
    try {
      await this.bot.banChatMember(this.secondChannelId, userId);
      await this.bot.unbanChatMember(this.secondChannelId, userId);
      console.log(`[Access Control] KICKED ${userTag} from second channel`);
      return true;
    } catch (error) {
      if (error.message.includes('USER_NOT_PARTICIPANT') || error.message.includes('user not found')) {
        console.log(`[Access Control] ${userTag} already not in second channel, skip`);
        return false;
      }
      throw error;
    }
  }

  async handleChatMemberUpdate(update) {
    // Only monitor main channel
    if (update.chat.id !== this.mainChannelId) return;

    const oldMember = update.old_chat_member;
    const newMember = update.new_chat_member;

    if (!oldMember || !newMember) return;

    const activeStatuses = ['member', 'administrator', 'creator'];
    const wasActive = activeStatuses.includes(oldMember.status);
    const isActive = activeStatuses.includes(newMember.status);

    if (wasActive && !isActive) {
      const user = newMember.user;
      const userTag = `${user.first_name} (ID: ${user.id})`;
      console.log(`[Access Control] User left main channel: ${userTag} (was ${oldMember.status}, now ${newMember.status})`);

      try {
        await this.kickFromSecond(user.id, userTag);
      } catch (error) {
        console.error(`[Access Control] Error auto-kicking ${userTag}:`, error.message);
      }
    }
  }

  // ============================================
  // POSITION TRACKING METHODS
  // ============================================

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
        '/status - Show exchange connection statuses',
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

    this.bot.onText(/\/status(@\w+)?/, (msg) => {
      if (!this.getExchangeStatuses) {
        this.bot.sendMessage(msg.chat.id, 'Сервис статусов недоступен');
        return;
      }

      const statuses = this.getExchangeStatuses();

      if (statuses.length === 0) {
        this.bot.sendMessage(msg.chat.id, 'Нет подключённых бирж');
        return;
      }

      const lines = statuses.map(s => {
        const statusEmoji = s.connected ? '🟢' : '🔴';
        const posInfo = s.positionsCount > 0 ? ` | 📊 ${s.positionsCount} pos` : '';
        return `${statusEmoji} <b>${s.exchangeName}</b> (${s.exchangeType})${posInfo}`;
      });

      const message = `📡 <b>Exchange Statuses</b>\n\n${lines.join('\n')}`;
      this.bot.sendMessage(msg.chat.id, message, { parse_mode: 'HTML' });
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
