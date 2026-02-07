const EventEmitter = require('events');
const ApiClient = require('./ApiClient');
const ApiWebSocket = require('./ApiWebSocket');
const ExchangeManager = require('./ExchangeManager');
const TelegramBotService = require('./TelegramBot');
const PositionAggregator = require('../utils/positionAggregator');

class PositionTracker extends EventEmitter {
  constructor() {
    super();
    this.apiClient = new ApiClient();
    this.apiWs = new ApiWebSocket();
    this.exchangeManagers = new Map();
    this.telegram = null;
    this.allPositions = new Map();
    this.telegramUpdateInterval = null;
    this.positionsChanged = false;
  }

  async start() {
    const userData = await this.apiClient.fetchUsersWithExchanges();

    if (!userData) {
      console.error('Failed to fetch user data from API');
      return;
    }

    await this.initializeExchanges(userData);

    this.apiWs.connect();

    this.apiWs.on('exchangeCreated', async (eventData) => {
      await this.handleExchangeCreated(eventData);
    });

    this.apiWs.on('exchangeDeleted', (eventData) => {
      this.handleExchangeDeleted(eventData);
    });
  }

  async initializeExchanges(userData) {
    if (!userData.exchanges || userData.exchanges.length === 0) {
      return;
    }

    if (userData.telegram_bot_key && userData.telegram_chat_id && !this.telegram) {
      this.telegram = new TelegramBotService(
        {
          botToken: userData.telegram_bot_key,
          chatId: userData.telegram_chat_id
        },
        () => this.allPositions,
        () => this.getExchangeStatuses()
      );
      this.telegram.setupCommands();
      this.startTelegramUpdateInterval();
    }

    for (const exchange of userData.exchanges) {
      await this.addExchange(exchange);
    }
  }

  async addExchange(exchangeConfig) {
    const exchangeId = exchangeConfig.id;

    if (this.exchangeManagers.has(exchangeId)) {
      return;
    }

    const manager = new ExchangeManager(exchangeConfig, this.telegram, this);
    this.exchangeManagers.set(exchangeId, manager);

    await manager.start();
  }

  async handleExchangeCreated(eventData) {
    if (eventData.telegram_bot_key && eventData.telegram_chat_id && !this.telegram) {
      this.telegram = new TelegramBotService(
        {
          botToken: eventData.telegram_bot_key,
          chatId: eventData.telegram_chat_id
        },
        () => this.allPositions,
        () => this.getExchangeStatuses()
      );
      this.telegram.setupCommands();
      this.startTelegramUpdateInterval();
    }

    await this.addExchange(eventData.exchange);
  }

  handleExchangeDeleted(eventData) {
    const exchangeId = eventData.exchange?.id;
    if (exchangeId) {
      console.log(`🗑️ Exchange deleted: ${eventData.exchange.name} (${exchangeId})`);
      this.removeExchange(exchangeId);
    }
  }

  updatePositions(exchangeId, exchangePositions) {
    for (const [key] of this.allPositions) {
      if (key.startsWith(`${exchangeId}_`)) {
        this.allPositions.delete(key);
      }
    }

    for (const [posKey, position] of exchangePositions) {
      const globalKey = `${exchangeId}_${posKey}`;
      this.allPositions.set(globalKey, {
        ...position,
        exchangeId
      });
    }

    this.positionsChanged = true;
    this.emit('positionsUpdated', this.getPositionsForApi());
  }

  getPositionsForApi() {
    const positions = Array.from(this.allPositions.values());
    const summary = PositionAggregator.getSummary(this.allPositions);

    return {
      positions,
      exchanges: summary.exchanges,
      summary: {
        totalValue: summary.totalValue,
        totalUnrealizedPnl: summary.totalUnrealizedPnl,
        totalRealizedPnl: summary.totalRealizedPnl,
        positionCount: summary.positionCount
      }
    };
  }

  getPositionsByExchange(exchangeName) {
    return Array.from(this.allPositions.values())
      .filter(p => p.exchangeName === exchangeName);
  }

  getExchangeStatuses() {
    const statuses = [];
    for (const manager of this.exchangeManagers.values()) {
      statuses.push(manager.getStatus());
    }
    return statuses;
  }

  getCombinedPositions() {
    return PositionAggregator.aggregateBySymbol(this.allPositions);
  }

  startTelegramUpdateInterval() {
    if (this.telegramUpdateInterval) {
      return;
    }

    if (this.telegram && this.allPositions.size > 0) {
      this.telegram.sendOrUpdatePositions(this.allPositions);
    }

    this.telegramUpdateInterval = setInterval(async () => {
      if (this.positionsChanged && this.telegram && this.allPositions.size > 0) {
        await this.telegram.sendOrUpdatePositions(this.allPositions);
        this.positionsChanged = false;
      }
    }, 10000);
  }

  stopTelegramUpdateInterval() {
    if (this.telegramUpdateInterval) {
      clearInterval(this.telegramUpdateInterval);
      this.telegramUpdateInterval = null;
    }
  }

  removeExchange(exchangeId) {
    const manager = this.exchangeManagers.get(exchangeId);
    if (manager) {
      manager.stop();
      this.exchangeManagers.delete(exchangeId);

      for (const [key] of this.allPositions) {
        if (key.startsWith(`${exchangeId}_`)) {
          this.allPositions.delete(key);
        }
      }

      this.positionsChanged = true;
    }
  }

  stop() {
    this.stopTelegramUpdateInterval();
    this.exchangeManagers.forEach((manager) => {
      manager.stop();
    });
    this.apiWs.disconnect();
  }
}

module.exports = PositionTracker;
