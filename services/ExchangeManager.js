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
    this.telegram = telegramInstance;
    this.positionTracker = positionTracker;
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
  }

  async start() {
    if (this.ws) {
      this.ws.connect();

      this.ws.on('authenticated', async () => {
        await this.loadInitialPositions();
      });

      this.ws.on('positionUpdate', (data) => {
        this.handlePositionUpdate(data);
      });

      this.ws.on('orderUpdate', (data) => {
        this.handleOrderUpdate(data);
      });

      this.ws.on('priceUpdate', (data) => {
        this.handlePriceUpdate(data);
      });

      this.ws.on('planOrderUpdate', (data) => {
        this.handlePlanOrderUpdate(data);
      });
    }
  }

  async loadInitialPositions() {
    const positions = await this.client.fetchOpenPositions();
    for (const position of positions) {
      const contractInfo = await this.getContractInfo(position.symbol);

      let currentPrice = contractInfo.fairPrice;
      if (!currentPrice || currentPrice === 0) {
        currentPrice = parseFloat(position.fairPrice || position.holdAvgPrice || 0);
      }

      const unrealizedPnl = PnLCalculator.calculateUnrealizedPnL(
        { ...position, contractSize: contractInfo.contractSize },
        currentPrice
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
          currentPrice
        )
      });
      this.ws.subscribeToPrice(position.symbol);
    }

    this.notifyPositionTracker();
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
      if (this.telegram) {
        this.telegram.sendNotification('closed', {
          ...prevPosition,
          ...data,
          exchangeId: this.exchangeId,
          exchangeName: this.exchangeName
        });
      }
      this.positions.delete(key);
      this.notifyPositionTracker();
      return;
    }

    if (prevPosition && prevPosition.state === 1 && state === 1 && prevPosition.holdVol !== holdVol) {
      const isIncrease = holdVol > prevPosition.holdVol;
      const notificationType = isIncrease ? 'positionIncreased' : 'positionDecreased';

      if (this.telegram) {
        this.telegram.sendNotification(notificationType, {
          ...data,
          exchangeId: this.exchangeId,
          exchangeName: this.exchangeName,
          contractSize: prevPosition.contractSize,
          previousHoldVol: prevPosition.holdVol
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

  async handleOrderUpdate(data) {
    const orderState = data.state;
    const category = data.category;
    const dealVol = parseFloat(data.dealVol) || 0;

    if (category === 1) {
      const contractInfo = await this.getContractInfo(data.symbol);
      const orderData = {
        ...data,
        exchangeId: this.exchangeId,
        exchangeName: this.exchangeName,
        contractSize: contractInfo.contractSize
      };

      if (orderState === 2 && dealVol === 0) {
        if (this.telegram) {
          this.telegram.sendNotification('limitOrderPlaced', orderData);
        }
      } else if (orderState === 3) {
        if (this.telegram) {
          this.telegram.sendNotification('limitOrderFilled', orderData);
        }
      } else if (orderState === 4) {
        if (this.telegram) {
          this.telegram.sendNotification('limitOrderCancelled', orderData);
        }
      }
    }
  }

  async handlePlanOrderUpdate(data) {
    const state = data.state;
    const contractInfo = await this.getContractInfo(data.symbol);
    const orderData = {
      ...data,
      exchangeId: this.exchangeId,
      exchangeName: this.exchangeName,
      contractSize: contractInfo.contractSize
    };

    if (state === 1) {
      if (this.telegram) {
        this.telegram.sendNotification('planOrderPlaced', orderData);
      }
    } else if (state === 2) {
      if (this.telegram) {
        this.telegram.sendNotification('planOrderTriggered', orderData);
      }
    } else if (state === 3) {
      if (this.telegram) {
        this.telegram.sendNotification('planOrderCancelled', orderData);
      }
    }
  }

  handlePriceUpdate(data) {
    const { symbol, price } = data;
    let updated = false;

    this.positions.forEach((position, key) => {
      if (key.startsWith(symbol + '_')) {
        const newUnrealizedPnl = PnLCalculator.calculateUnrealizedPnL(
          position,
          price
        );
        const oldUnrealizedPnl = position.unrealizedPnl || 0;

        const threshold = Math.abs(oldUnrealizedPnl) < 1 ? 0.01 : 0.1;

        if (Math.abs(newUnrealizedPnl - oldUnrealizedPnl) > threshold) {
          position.currentPrice = price;
          position.unrealizedPnl = newUnrealizedPnl;
          position.positionValue = PnLCalculator.calculatePositionValue(
            position.holdVol,
            position.contractSize,
            price
          );
          updated = true;
        }
      }
    });

    if (updated) {
      this.notifyPositionTracker();
    }
  }

  notifyPositionTracker() {
    if (this.positionTracker) {
      this.positionTracker.updatePositions(this.exchangeId, this.positions);
    }
  }

  stop() {
    if (this.ws) {
      this.ws.disconnect();
    }
  }
}

module.exports = ExchangeManager;
