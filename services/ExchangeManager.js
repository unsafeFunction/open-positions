const MexcClient = require('./MexcClient');
const MexcWebSocket = require('./MexcWebSocket');
const GateClient = require('./GateClient');
const GateWebSocket = require('./GateWebSocket');
const PnLCalculator = require('../utils/calculator');

class ExchangeManager {
  constructor(exchangeConfig, telegramInstance = null, positionTracker = null) {
    this.exchangeId = exchangeConfig.id;
    this.exchangeType = exchangeConfig.exchange;
    this.exchangeName = exchangeConfig.name;
    this.userId = exchangeConfig.user_id;

    this.client = null;
    this.ws = null;
    this.telegram = telegramInstance; // Use shared telegram instance
    this.positionTracker = positionTracker; // Reference to PositionTracker
    this.positions = new Map();
    this.contractCache = new Map();

    this.initializeClients(exchangeConfig);
  }

  initializeClients(config) {
    if (this.exchangeType === 'MEXC') {
      this.client = new MexcClient(config.exchange_api_key, config.exchange_secret);
      this.ws = new MexcWebSocket(config.exchange_api_key, config.exchange_secret);
    } else if (this.exchangeType === 'GATE') {
      this.client = new GateClient(config.exchange_api_key, config.exchange_secret);
      this.ws = new GateWebSocket(config.exchange_api_key, config.exchange_secret);
    }
    // Telegram instance is now passed via constructor, no need to create it here
  }

  async start() {
    console.log(`🚀 Starting ${this.exchangeType} client for exchange ${this.exchangeId}...`);

    if (this.ws) {
      this.ws.connect();

      this.ws.on('authenticated', async () => {
        await this.loadInitialPositions();
      });

      this.ws.on('positionUpdate', (data) => {
        this.handlePositionUpdate(data);
      });

      this.ws.on('priceUpdate', (data) => {
        this.handlePriceUpdate(data);
      });
    }
  }

  async loadInitialPositions() {
    console.log(`📊 Loading initial positions for exchange ${this.exchangeId}...`);

    const positions = await this.client.fetchOpenPositions();
    for (const position of positions) {
      const contractInfo = await this.getContractInfo(position.symbol);

      // Use fairPrice from API, or fallback to position's fair price, or entry price
      let currentPrice = contractInfo.fairPrice;
      if (!currentPrice || currentPrice === 0) {
        currentPrice = parseFloat(position.fairPrice || position.holdAvgPrice || 0);
        console.log(`⚠️  Using fallback price for ${position.symbol}: ${currentPrice}`);
      }

      // Debug logging for contract info
      console.log(`Position: ${position.symbol}, ContractSize: ${contractInfo.contractSize}, Price: ${currentPrice}`);

      const unrealizedPnl = PnLCalculator.calculateUnrealizedPnL(
        { ...position, contractSize: contractInfo.contractSize },
        currentPrice,
        this.exchangeType
      );

      const key = `${position.symbol}_${position.positionId}`;
      this.positions.set(key, {
        ...position,
        exchangeId: this.exchangeId,
        exchangeName: this.exchangeName,
        contractSize: contractInfo.contractSize,
        currentPrice: currentPrice,
        unrealizedPnl: unrealizedPnl,
        positionValue: PnLCalculator.calculatePositionValue(
          position.holdVol,
          contractInfo.contractSize,
          currentPrice,
          this.exchangeType
        )
      });
      this.ws.subscribeToPrice(position.symbol);
    }

    // Notify position tracker about all positions
    this.notifyPositionTracker();

    console.log(`✅ Loaded ${positions.length} position(s) for exchange ${this.exchangeId}`);
  }

  async getContractInfo(symbol) {
    if (!this.contractCache.has(symbol)) {
      const info = await this.client.fetchContractDetails(symbol);
      this.contractCache.set(symbol, info);
    }
    return this.contractCache.get(symbol);
  }

  handlePositionUpdate(data) {
    const key = `${data.symbol}_${data.positionId}`;
    const prevPosition = this.positions.get(key);
    const state = data.state;
    const holdVol = parseFloat(data.holdVol);

    if ((!prevPosition || prevPosition.state === 3) && state === 1 && holdVol > 0) {
      console.log(`🟢 Position opened: ${data.symbol} (Exchange: ${this.exchangeId})`);
      if (this.telegram) {
        this.telegram.sendNotification('opened', {
          ...data,
          exchangeId: this.exchangeId,
          exchangeName: this.exchangeName
        });
      }
      this.ws.subscribeToPrice(data.symbol);
    }

    if (prevPosition && prevPosition.state === 1 && state === 3) {
      console.log(`🔴 Position closed: ${data.symbol} (Exchange: ${this.exchangeId})`);
      if (this.telegram) {
        this.telegram.sendNotification('closed', {
          ...data,
          ...prevPosition,
          exchangeId: this.exchangeId,
          exchangeName: this.exchangeName
        });
      }
      this.positions.delete(key);
      this.notifyPositionTracker();
      return;
    }

    if (prevPosition && prevPosition.state === 1 && state === 1 && prevPosition.holdVol !== holdVol) {
      console.log(`🔄 Position modified: ${data.symbol} (Exchange: ${this.exchangeId})`);
      if (this.telegram) {
        this.telegram.sendNotification('modified', {
          ...data,
          exchangeId: this.exchangeId,
          exchangeName: this.exchangeName
        });
      }
    }

    if (state === 1) {
      this.positions.set(key, {
        ...data,
        exchangeId: this.exchangeId,
        exchangeName: this.exchangeName,
        contractSize: prevPosition?.contractSize || 1,
        currentPrice: prevPosition?.currentPrice || 0,
        unrealizedPnl: parseFloat(data.pnl || 0),
        positionValue: prevPosition?.positionValue || 0
      });
      this.notifyPositionTracker();
    }
  }

  handlePriceUpdate(data) {
    const { symbol, price } = data;
    let updated = false;

    this.positions.forEach((position, key) => {
      if (key.startsWith(symbol + '_')) {
        const newUnrealizedPnl = PnLCalculator.calculateUnrealizedPnL(
          position,
          price,
          this.exchangeType
        );
        const oldUnrealizedPnl = position.unrealizedPnl || 0;

        // For very small PnL changes (like BTC with small contract sizes), lower the threshold
        const threshold = Math.abs(oldUnrealizedPnl) < 1 ? 0.01 : 0.1;

        if (Math.abs(newUnrealizedPnl - oldUnrealizedPnl) > threshold) {
          position.currentPrice = price;
          position.unrealizedPnl = newUnrealizedPnl;
          position.positionValue = PnLCalculator.calculatePositionValue(
            position.holdVol,
            position.contractSize,
            price,
            this.exchangeType
          );
          updated = true;
        }
      }
    });

    if (updated) {
      this.notifyPositionTracker();
    }
  }

  // Notify the position tracker about position changes
  notifyPositionTracker() {
    if (this.positionTracker) {
      this.positionTracker.updatePositions(this.exchangeId, this.positions);
    }
  }

  stop() {
    console.log(`🛑 Stopping exchange ${this.exchangeId}...`);
    if (this.ws) {
      this.ws.disconnect();
    }
  }
}

module.exports = ExchangeManager;
