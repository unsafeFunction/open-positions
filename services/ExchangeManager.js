const MexcClient = require('./MexcClient');
const MexcWebSocket = require('./MexcWebSocket');
const GateClient = require('./GateClient');
const GateWebSocket = require('./GateWebSocket');
const BitgetClient = require('./BitgetClient');
const BitgetWebSocket = require('./BitgetWebSocket');
const BinanceClient = require('./BinanceClient');
const BinanceWebSocket = require('./BinanceWebSocket');
const BybitClient = require('./BybitClient');
const BybitWebSocket = require('./BybitWebSocket');
const BingXClient = require('./BingXClient');
const BingXWebSocket = require('./BingXWebSocket');
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

    this.recentOrderTypes = new Map(); // symbol -> orderType (1=limit, 5=market, etc.)
    this.isAuthenticated = false;

    this.initializeClients(exchangeConfig);
  }

  initializeClients(config) {
    if (this.exchangeType === 'MEXC') {
      this.client = new MexcClient(config.exchange_api_key, config.exchange_secret);
      this.ws = new MexcWebSocket(config.exchange_api_key, config.exchange_secret);
    } else if (this.exchangeType === 'GATE') {
      this.client = new GateClient(config.exchange_api_key, config.exchange_secret);
      this.ws = new GateWebSocket(config.exchange_api_key, config.exchange_secret);
    } else if (this.exchangeType === 'Bitget') {
      const passphrase = config.passphrase;
      this.client = new BitgetClient(config.exchange_api_key, config.exchange_secret, passphrase);
      this.ws = new BitgetWebSocket(config.exchange_api_key, config.exchange_secret, passphrase);
    } else if (this.exchangeType === 'Binance') {
      this.client = new BinanceClient(config.exchange_api_key, config.exchange_secret);
      this.ws = new BinanceWebSocket(config.exchange_api_key, config.exchange_secret);
    } else if (this.exchangeType === 'ByBit') {
      this.client = new BybitClient(config.exchange_api_key, config.exchange_secret);
      this.ws = new BybitWebSocket(config.exchange_api_key, config.exchange_secret);
    } else if (this.exchangeType === 'BingX') {
      this.client = new BingXClient(config.exchange_api_key, config.exchange_secret);
      this.ws = new BingXWebSocket(config.exchange_api_key, config.exchange_secret);
    }
  }

  async start() {
    if (this.ws) {
      this.ws.connect();

      this.ws.on('authenticated', async () => {
        this.isAuthenticated = true;
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

      this.ws.on('stopOrderUpdate', (data) => {
        this.handleStopOrderUpdate(data);
      });
    }
  }

  async loadInitialPositions() {
    const positions = await this.client.fetchOpenPositions();

    for (const position of positions) {
      const contractInfo = await this.getContractInfo(position.symbol);
      // Use currentPrice from API if available, otherwise from contract info
      let currentPrice = position.currentPrice || contractInfo.fairPrice;
      if (!currentPrice || currentPrice === 0) {
        currentPrice = parseFloat(position.holdAvgPrice || 0);
      }

      // Use unrealizedPnl from API if available (Bybit provides it)
      let unrealizedPnl = position.unrealisedPnl ?? position.unrealizedPnl;
      if (unrealizedPnl === undefined || unrealizedPnl === null) {
        unrealizedPnl = PnLCalculator.calculateUnrealizedPnL(
          { ...position, contractSize: contractInfo.contractSize },
          currentPrice
        );
      }

      // Use positionValue from API if available (Bybit), otherwise calculate
      let positionValue = position.positionValue;
      if (!positionValue || positionValue === 0) {
        // For Bybit and Bitget, holdVol is base asset quantity (e.g. 0.0001 BTC), no contractSize needed
        if (this.exchangeType === 'ByBit' || this.exchangeType === 'Bitget' || this.exchangeType === 'BingX') {
          positionValue = position.holdVol * currentPrice;
        } else {
          positionValue = PnLCalculator.calculatePositionValue(
            position.holdVol,
            contractInfo.contractSize,
            currentPrice
          );
        }
      }

      const key = `${position.symbol}_${position.positionId}`;
      // For Bybit and Bitget, holdVol is already in base asset, so contractSize should be 1
      const effectiveContractSize = (this.exchangeType === 'ByBit' || this.exchangeType === 'Bitget' || this.exchangeType === 'BingX')
        ? 1
        : contractInfo.contractSize;
      this.positions.set(key, {
        ...position,
        exchangeId: this.exchangeId,
        exchangeName: this.exchangeName,
        contractSize: effectiveContractSize,
        currentPrice: currentPrice,
        unrealizedPnl: unrealizedPnl,
        positionValue: positionValue
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

  async handlePositionUpdate(data) {
    const key = `${data.symbol}_${data.positionId}`;
    const prevPosition = this.positions.get(key);
    const state = data.state;
    const holdVol = parseFloat(data.holdVol);

    if ((!prevPosition || prevPosition.state === 3) && state === 1 && holdVol > 0) {
      this.ws.subscribeToPrice(data.symbol);

      // Skip notification for initial snapshot (existing positions on startup)
      if (this.telegram && !data.isSnapshot) {
        const skipOpenedNotification = this.exchangeType === 'BingX';
        // BingX ACCOUNT_UPDATE often arrives with partial fields (0 leverage/value),
        // so rely on ORDER_TRADE_UPDATE/TRADE_UPDATE notifications instead.
        const contractInfo = await this.getContractInfo(data.symbol);
        // For Bybit and Bitget, holdVol is already in base asset, so contractSize should be 1
        const effectiveContractSize = (this.exchangeType === 'ByBit' || this.exchangeType === 'Bitget')
          ? 1
          : contractInfo.contractSize;
        const recentOrderType = this.recentOrderTypes.get(data.symbol);
        this.recentOrderTypes.delete(data.symbol);
        const isMarket = !recentOrderType || recentOrderType === 5 || recentOrderType === 6;

        if (!skipOpenedNotification) {
          this.telegram.sendNotification('opened', {
            ...data,
            exchangeId: this.exchangeId,
            exchangeName: this.exchangeName,
            exchangeType: this.exchangeType,
            contractSize: effectiveContractSize,
            openedByMarket: isMarket
          });
        }
      }
    }

    if (prevPosition && prevPosition.state === 1 && state === 3) {
      if (this.telegram && this.exchangeType !== 'BingX') {
        this.telegram.sendNotification('closed', {
          ...prevPosition,
          ...data,
          holdAvgPrice: data.holdAvgPrice || prevPosition.holdAvgPrice,
          holdVol: data.holdVol || prevPosition.holdVol,
          currentPrice: prevPosition.holdAvgPrice,
          exchangeId: this.exchangeId,
          exchangeName: this.exchangeName,
          exchangeType: this.exchangeType
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
          exchangeType: this.exchangeType,
          contractSize: prevPosition.contractSize,
          previousHoldVol: prevPosition.holdVol
        });
      }
    }

    if (state === 1) {
      const contractInfo = await this.getContractInfo(data.symbol);
      const effectiveContractSize = (this.exchangeType === 'ByBit' || this.exchangeType === 'Bitget' || this.exchangeType === 'BingX')
        ? 1
        : contractInfo.contractSize;

      // Use values from API if provided, otherwise fallback to previous/default
      const currentPrice = data.currentPrice || prevPosition?.currentPrice || 0;
      const positionValue = data.positionValue || prevPosition?.positionValue || 0;

      this.positions.set(key, {
        ...data,
        exchangeId: this.exchangeId,
        exchangeName: this.exchangeName,
        contractSize: effectiveContractSize,
        currentPrice: currentPrice,
        unrealizedPnl: parseFloat(data.pnl || 0),
        positionValue: positionValue
      });
      this.notifyPositionTracker();
    }
  }

  async handleOrderUpdate(data) {
    const orderState = data.state;
    const orderType = data.orderType; // 1=limit, 2=PostOnly, 3=IOC, 4=FOK, 5=market, 6=market-to-limit
    const dealVol = parseFloat(data.dealVol) || 0;

    // Track order type for opening orders (side 1 = open long, side 3 = open short)
    const isOpening = data.side === 1 || data.side === 3;
    if (isOpening) {
      this.recentOrderTypes.set(data.symbol, orderType);
    }

    // Skip market orders - position update will handle the notification
    const isMarketOrder = orderType === 5 || orderType === 6;
    const exchangeLower = this.exchangeType.toLowerCase();

    if (isMarketOrder && exchangeLower !== 'bitget' && exchangeLower !== 'binance' && exchangeLower !== 'bingx') {
      return;
    }

    const contractInfo = await this.getContractInfo(data.symbol);
    // For Bybit/Bitget/BingX, order qty is already base asset amount, so contractSize should be 1
    const effectiveContractSize = (this.exchangeType === 'ByBit' || this.exchangeType === 'Bitget' || this.exchangeType === 'BingX')
      ? 1
      : contractInfo.contractSize;
    const orderData = {
      ...data,
      exchangeId: this.exchangeId,
      exchangeName: this.exchangeName,
      exchangeType: this.exchangeType,
      contractSize: effectiveContractSize
    };

    // For limit orders: notify when placed (state 2, no fills yet)
    if (!isMarketOrder && orderState === 2 && dealVol === 0) {
      if (this.telegram) {
        this.telegram.sendNotification('limitOrderPlaced', orderData);
      }
    }
    // For limit orders: notify when filled (state 3)
    else if (!isMarketOrder && orderState === 3) {
      if (this.telegram) {
        this.telegram.sendNotification('limitOrderFilled', orderData);
      }
    }
    // For market orders: notify when filled (state 3) - this is when we have the actual price
    else if (isMarketOrder && orderState === 3) {
      if (this.telegram) {
        this.telegram.sendNotification('marketOrderFilled', orderData);
      }
    }
    // For cancelled orders
    else if (orderState === 4) {
      if (this.telegram) {
        this.telegram.sendNotification('limitOrderCancelled', orderData);
      }
    }
  }

  async handleStopOrderUpdate(data) {
    let state = data.state;

    // If TP/SL reports as "set" but the position is already closed, treat as cancelled
    if (state === 1) {
      const hasOpenPosition = Array.from(this.positions.entries()).some(
        ([key, pos]) => key.startsWith(data.symbol + '_') && pos.state === 1
      );
      if (!hasOpenPosition) {
        state = 2;
      }
    }

    const contractInfo = await this.getContractInfo(data.symbol);
    // For Bybit and Bitget, holdVol is already in base asset, so contractSize should be 1
    const effectiveContractSize = (this.exchangeType === 'ByBit' || this.exchangeType === 'Bitget')
      ? 1
      : contractInfo.contractSize;
    const orderData = {
      ...data,
      exchangeId: this.exchangeId,
      exchangeName: this.exchangeName,
      exchangeType: this.exchangeType,
      contractSize: effectiveContractSize
    };

    if (this.telegram) {
      if (state === 1) {
        this.telegram.sendNotification('stopOrderSet', orderData);
      } else if (state === 2) {
        this.telegram.sendNotification('stopOrderCancelled', orderData);
      }
    }
  }

  handlePriceUpdate(data) {
    const { symbol, price } = data;
    let updated = false;

    this.positions.forEach((position, key) => {
      if (key.startsWith(symbol + '_')) {
        // Проблема тут, контракт сайз 1, а должен быть не 1
        const newUnrealizedPnl = PnLCalculator.calculateUnrealizedPnL(
          position,
          price
        );
        const oldUnrealizedPnl = position.unrealizedPnl || 0;

        const threshold = Math.abs(oldUnrealizedPnl) < 1 ? 0.01 : 0.1;

        if (Math.abs(newUnrealizedPnl - oldUnrealizedPnl) > threshold) {
          position.currentPrice = price;
          position.unrealizedPnl = newUnrealizedPnl;

          // For Bybit and Bitget, holdVol is base asset quantity (e.g. 0.0001 BTC), no contractSize needed
          if (this.exchangeType === 'ByBit' || this.exchangeType === 'Bitget' || this.exchangeType === 'BingX') {
            position.positionValue = position.holdVol * price;
          } else {
            position.positionValue = PnLCalculator.calculatePositionValue(
              position.holdVol,
              position.contractSize,
              price
            );
          }
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

  getStatus() {
    return {
      exchangeName: this.exchangeName,
      exchangeType: this.exchangeType,
      connected: this.isAuthenticated,
      positionsCount: this.positions.size
    };
  }

  stop() {
    if (this.ws) {
      this.ws.disconnect();
    }
  }
}

module.exports = ExchangeManager;
