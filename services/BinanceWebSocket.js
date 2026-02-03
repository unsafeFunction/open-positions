const { WebsocketClient } = require('binance');
const EventEmitter = require('events');

class BinanceWebSocket extends EventEmitter {
  constructor(apiKey, apiSecret) {
    super();
    this.apiKey = apiKey;
    this.apiSecret = apiSecret;
    this.wsClient = null;
    this.priceSubscriptions = new Set();
    this.knownAlgoOrders = new Map();
    this.pendingAlgoUpdates = new Map();
  }

  connect() {
    console.log('Binance WebSocket connecting...');

    this.wsClient = new WebsocketClient({
      api_key: this.apiKey,
      api_secret: this.apiSecret,
      beautify: true,
    });

    this.setupEventHandlers();

    // Subscribe to USD-M futures user data stream
    this.wsClient.subscribeUsdFuturesUserDataStream();
  }

  setupEventHandlers() {
    this.wsClient.on('open', (data) => {
      console.log('Binance WebSocket connected:', data.wsKey);
      if (data.wsKey && data.wsKey.includes('usdm')) {
        console.log('Binance WebSocket authenticated successfully');
        this.emit('authenticated');
      }
    });

    this.wsClient.on('formattedMessage', (data) => {
      this.handleMessage(data);
    });

    this.wsClient.on('message', (data) => {
      // Raw message handler as fallback
      if (typeof data === 'string') {
        try {
          const parsed = JSON.parse(data);
          this.handleMessage(parsed);
        } catch (e) {
          // Ignore parse errors
        }
      }
    });

    this.wsClient.on('error', (error) => {
      console.error('Binance WebSocket error:', error);
    });

    this.wsClient.on('reconnecting', (data) => {
      console.log('Binance WebSocket reconnecting:', data?.wsKey);
    });

    this.wsClient.on('reconnected', (data) => {
      console.log('Binance WebSocket reconnected:', data?.wsKey);
    });
  }

  handleMessage(data) {
    const eventType = data.eventType || data.e;


    switch (eventType) {
      case 'ACCOUNT_UPDATE':
      case 'accountUpdate':
        this.handleAccountUpdate(data);
        break;
      case 'ORDER_TRADE_UPDATE':
      case 'orderTradeUpdate':
        this.handleOrderUpdate(data);
        break;
      case 'markPriceUpdate':
        this.handleMarkPriceUpdate(data);
        break;
      default:
    }
  }

  handleAccountUpdate(data) {
    // Handle position updates from ACCOUNT_UPDATE event
    const updateData = data.updateData || data.a || {};
    const positions = updateData.positions || updateData.P || [];

    if (!Array.isArray(positions)) return;

    positions.forEach(pos => {
      const symbol = pos.symbol || pos.s;
      const size = parseFloat(pos.positionAmount || pos.pa || 0);
      const isLong = size > 0;
      const marginType = pos.marginType || pos.mt;
      const isIsolated = marginType === 'isolated';
      const positionSide = pos.positionSide || pos.ps || 'BOTH';

      const positionData = {
        symbol: symbol,
        positionId: symbol + '_' + positionSide,
        holdVol: Math.abs(size),
        holdAvgPrice: parseFloat(pos.entryPrice || pos.ep || 0),
        positionType: isLong ? 1 : 2,
        openType: isIsolated ? 1 : 2,
        leverage: 0,
        liquidatePrice: 0,
        realised: parseFloat(pos.realizedProfit || pos.cr || 0),
        pnl: parseFloat(pos.unrealizedProfit || pos.up || 0),
        state: size !== 0 ? 1 : 3
      };

      this.emit('positionUpdate', positionData);
    });
  }

  handleOrderUpdate(data) {
    const order = data.order || data.o || data;


    const symbol = order.symbol || order.s;
    const orderId = order.orderId || order.i;
    const size = parseFloat(order.originalQuantity || order.q || 0);
    const originalPrice = parseFloat(order.originalPrice || order.price || order.p || 0);
    const avgPrice = parseFloat(order.averagePrice || order.ap || 0);
    const side = order.orderSide || order.side || order.S;
    const positionSide = order.positionSide || order.ps;
    const orderType = order.orderType || order.o;
    const status = order.orderStatus || order.X;
    const executedQty = parseFloat(order.orderFilledAccumulatedQuantity || order.executedQuantity || order.z || 0);
    const realizedProfit = parseFloat(order.realisedProfit || order.realizedProfit || order.rp || 0);
    const isReduceOnly = order.isReduceOnly || order.R || false;

    // Use avgPrice if filled, otherwise use originalPrice for pending orders
    const finalPrice = avgPrice > 0 ? avgPrice : originalPrice;

    const orderData = {
      symbol: symbol,
      orderId: orderId,
      vol: size,
      notionalUsd: 0,
      price: finalPrice,
      side: this.mapOrderSide(side, positionSide, isReduceOnly),
      leverage: 0,
      state: this.mapOrderStatus(status),
      dealVol: executedQty,
      orderType: this.mapOrderType(orderType),
      pnl: realizedProfit
    };

    // Check if this is a TP/SL order - only send stopOrderUpdate, not regular orderUpdate
    if (this.isStopOrder(orderType)) {
      this.handleStopOrderFromOrder(order, orderData, status);
      return;
    }

    this.emit('orderUpdate', orderData);
  }

  handleStopOrderFromOrder(order, orderData, status) {
    const orderType = order.orderType || order.o;
    const stopPrice = parseFloat(order.stopPrice || order.sp || 0);
    const orderId = order.orderId || order.i;
    const orderKey = `${orderId}_${status}`;

    // Skip if we've already processed this exact order+status
    if (this.knownAlgoOrders.has(orderKey)) {
      return;
    }
    this.knownAlgoOrders.set(orderKey, true);

    let triggerSide = 0;
    if (orderType.includes('TAKE_PROFIT')) {
      triggerSide = 1;
    } else if (orderType.includes('STOP')) {
      triggerSide = 2;
    }

    const mappedState = this.mapStopOrderStatus(status);

    // Remove from tracking if cancelled
    if (mappedState === 2) {
      this.knownAlgoOrders.delete(`${orderId}_NEW`);
    }

    const stopOrderData = {
      symbol: orderData.symbol,
      orderId: orderData.orderId,
      vol: orderData.vol,
      price: orderData.price,
      triggerSide: triggerSide,
      takeProfitPrice: triggerSide === 1 ? stopPrice : 0,
      stopLossPrice: triggerSide === 2 ? stopPrice : 0,
      side: orderData.side,
      state: mappedState
    };

    this.emit('stopOrderUpdate', stopOrderData);
  }

  handleMarkPriceUpdate(data) {
    const symbol = data.symbol || data.s;
    const markPrice = parseFloat(data.markPrice || data.p || 0);

    this.emit('priceUpdate', {
      symbol: symbol,
      price: markPrice
    });
  }

  subscribeToPrice(symbol) {
    if (!this.priceSubscriptions.has(symbol)) {
      this.wsClient.subscribeMarkPrice(symbol, 'usdm');
      this.priceSubscriptions.add(symbol);
    }
  }

  mapOrderSide(side, positionSide, isReduceOnly = false) {
    // 1 = Open Long, 2 = Close Short, 3 = Open Short, 4 = Close Long
    if (positionSide === 'LONG') {
      return side === 'BUY' ? 1 : 4;
    } else if (positionSide === 'SHORT') {
      return side === 'SELL' ? 3 : 2;
    } else {
      // BOTH (one-way mode) - use isReduceOnly to determine open vs close
      if (side === 'BUY') {
        return isReduceOnly ? 2 : 1; // Close Short or Open Long
      } else {
        return isReduceOnly ? 4 : 3; // Close Long or Open Short
      }
    }
  }

  mapOrderStatus(status) {
    switch (status) {
      case 'NEW':
      case 'PARTIALLY_FILLED':
        return 2;
      case 'FILLED':
        return 3;
      case 'CANCELED':
      case 'CANCELLED':
      case 'EXPIRED':
      case 'REJECTED':
        return 4;
      default:
        return 2;
    }
  }

  mapStopOrderStatus(status) {
    switch (status) {
      case 'NEW':
        return 1;
      case 'CANCELED':
      case 'CANCELLED':
      case 'EXPIRED':
      case 'REJECTED':
        return 2;
      case 'FILLED':
        return 3;
      default:
        return 1;
    }
  }

  mapOrderType(orderType) {
    switch (orderType) {
      case 'LIMIT':
        return 1;
      case 'MARKET':
        return 5;
      case 'STOP':
      case 'STOP_MARKET':
      case 'TAKE_PROFIT':
      case 'TAKE_PROFIT_MARKET':
      case 'TRAILING_STOP_MARKET':
        return 1;
      default:
        return 1;
    }
  }

  isStopOrder(orderType) {
    return ['STOP', 'STOP_MARKET', 'TAKE_PROFIT', 'TAKE_PROFIT_MARKET',
            'TRAILING_STOP_MARKET'].includes(orderType);
  }

  disconnect() {
    this.pendingAlgoUpdates.forEach(pending => {
      if (pending.timeout) {
        clearTimeout(pending.timeout);
      }
    });
    this.pendingAlgoUpdates.clear();

    if (this.wsClient) {
      this.wsClient.closeAll();
      this.wsClient = null;
    }
  }
}

module.exports = BinanceWebSocket;
