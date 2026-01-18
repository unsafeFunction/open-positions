const ApiClient = require('./ApiClient');
const ApiWebSocket = require('./ApiWebSocket');
const ExchangeManager = require('./ExchangeManager');
const TelegramBotService = require('./TelegramBot');

class PositionTracker {
  constructor() {
    this.apiClient = new ApiClient();
    this.apiWs = new ApiWebSocket();
    this.exchangeManagers = new Map();
    this.telegram = null;
    this.allPositions = new Map(); // Aggregated positions from all exchanges
  }

  async start() {
    console.log('🚀 Starting Multi-Exchange Position Tracker...\n');

    const userData = await this.apiClient.fetchUsersWithExchanges();

    if (!userData) {
      console.error('❌ Failed to fetch user data from API');
      return;
    }

    await this.initializeExchanges(userData);

    this.apiWs.connect();

    this.apiWs.on('exchangeCreated', async (eventData) => {
      await this.handleExchangeCreated(eventData);
    });
  }

  async initializeExchanges(userData) {
    console.log(`👤 Initializing exchanges for user: ${userData.username}\n`);

    if (!userData.exchanges || userData.exchanges.length === 0) {
      console.log('⚠️  No exchanges found for this user');
      return;
    }

    // Create single Telegram bot instance if credentials are provided
    if (userData.telegram_bot_key && userData.telegram_chat_id && !this.telegram) {
      console.log('📱 Creating shared Telegram bot instance');
      this.telegram = new TelegramBotService(
        {
          botToken: userData.telegram_bot_key,
          chatId: userData.telegram_chat_id
        },
        () => this.allPositions // Callback to get current positions
      );
      this.telegram.setupCommands();
    }

    for (const exchange of userData.exchanges) {
      await this.addExchange(exchange);
    }
  }

  async addExchange(exchangeConfig) {
    const exchangeId = exchangeConfig.id;

    if (this.exchangeManagers.has(exchangeId)) {
      console.log(`⚠️  Exchange ${exchangeId} already exists`);
      return;
    }

    console.log(`➕ Adding ${exchangeConfig.exchange} exchange: ${exchangeConfig.name}`);

    // Pass the shared telegram instance and position tracker to the manager
    const manager = new ExchangeManager(exchangeConfig, this.telegram, this);
    this.exchangeManagers.set(exchangeId, manager);

    await manager.start();
  }

  async handleExchangeCreated(eventData) {
    console.log(`\n📢 New exchange created event received`);
    console.log(`User ID: ${eventData.userId}`);
    console.log(`Exchange: ${eventData.exchange.exchange} - ${eventData.exchange.name}\n`);

    // Create telegram instance if not exists and credentials are provided
    if (eventData.telegram_bot_key && eventData.telegram_chat_id && !this.telegram) {
      console.log('📱 Creating shared Telegram bot instance');
      this.telegram = new TelegramBotService(
        {
          botToken: eventData.telegram_bot_key,
          chatId: eventData.telegram_chat_id
        },
        () => this.allPositions // Callback to get current positions
      );
      this.telegram.setupCommands();
    }

    await this.addExchange(eventData.exchange);
  }

  // Called by ExchangeManager to update positions
  updatePositions(exchangeId, exchangePositions) {
    // Remove old positions for this exchange
    for (const [key] of this.allPositions) {
      if (key.startsWith(`${exchangeId}_`)) {
        this.allPositions.delete(key);
      }
    }

    // Add new positions for this exchange
    for (const [posKey, position] of exchangePositions) {
      const globalKey = `${exchangeId}_${posKey}`;
      this.allPositions.set(globalKey, {
        ...position,
        exchangeId
      });
    }

    // Update telegram with all positions
    this.updateTelegramMessage();
  }

  async updateTelegramMessage() {
    if (this.telegram && this.allPositions.size > 0) {
      await this.telegram.sendOrUpdatePositions(this.allPositions);
    }
  }

  removeExchange(exchangeId) {
    const manager = this.exchangeManagers.get(exchangeId);
    if (manager) {
      manager.stop();
      this.exchangeManagers.delete(exchangeId);

      // Remove positions for this exchange
      for (const [key] of this.allPositions) {
        if (key.startsWith(`${exchangeId}_`)) {
          this.allPositions.delete(key);
        }
      }

      this.updateTelegramMessage();
      console.log(`➖ Removed exchange: ${exchangeId}`);
    }
  }

  stop() {
    console.log('\n🛑 Stopping all exchanges...');
    this.exchangeManagers.forEach((manager) => {
      manager.stop();
    });
    this.apiWs.disconnect();
  }
}

module.exports = PositionTracker;