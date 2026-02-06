const WebSocket = require('ws');
const crypto = require('crypto');
const EventEmitter = require('events');

class BitgetWebSocket extends EventEmitter {
  constructor(apiKey, apiSecret, apiPass) {
    super();
    this.apiKey = apiKey;
    this.apiSecret = apiSecret;
    this.apiPass = apiPass;
    this.wsUrlPrivate = 'wss://ws.bitget.com/v2/ws/private';
    this.wsUrlPublic = 'wss://ws.bitget.com/v2/ws/public';
    this.wsPrivate = null;
    this.wsPublic = null;
    this.pingInterval = null;
    this.priceSubscriptions = new Set();
    this.knownAlgoOrders = new Map(); // Track known TP/SL orders: symbol -> { tp: price, sl: price }
    this.pendingAlgoUpdates = new Map(); // Buffer for combining TP/SL updates
    this.instType = 'USDT-FUTURES';
  }

  generateSignature(timestamp) {
    const message = timestamp + 'GET' + '/user/verify';
    return crypto.createHmac('sha256', this.apiSecret)
      .update(message)
      .digest('base64');
  }

  connect() {
    this.connectPrivate();
  }

  connectPrivate() {
    console.log('Bitget WebSocket connecting to private...');
    this.wsPrivate = new WebSocket(this.wsUrlPrivate);

    this.wsPrivate.on('open', () => {
      console.log('Bitget WebSocket private connected');
      this.authenticate();
      this.startPing();
    });

    this.wsPrivate.on('message', (data) => {
      this.handleMessage(data, 'private');
    });

    this.wsPrivate.on('error', (error) => {
      console.error('Bitget WebSocket private error:', error.message);
    });

    this.wsPrivate.on('close', () => {
      console.log('Bitget WebSocket private closed');
      this.stopPing();
      setTimeout(() => this.connectPrivate(), 5000);
    });
  }

  connectPublic() {
    if (this.wsPublic && (this.wsPublic.readyState === WebSocket.OPEN || this.wsPublic.readyState === WebSocket.CONNECTING)) {
      return;
    }

    console.log('Bitget WebSocket connecting to public...');
    this.wsPublic = new WebSocket(this.wsUrlPublic);

    this.wsPublic.on('open', () => {
      console.log('Bitget WebSocket public connected');
      // Resubscribe to prices
      this.priceSubscriptions.forEach(symbol => {
        this.subscribeToPrice(symbol, true);
      });
    });

    this.wsPublic.on('message', (data) => {
      this.handleMessage(data, 'public');
    });

    this.wsPublic.on('error', (error) => {
      console.error('Bitget WebSocket public error:', error.message);
    });

    this.wsPublic.on('close', () => {
      console.log('Bitget WebSocket public closed');
      setTimeout(() => this.connectPublic(), 5000);
    });
  }

  authenticate() {
    const timestamp = Math.floor(Date.now() / 1000).toString();
    const signature = this.generateSignature(timestamp);

    const loginMessage = {
      op: 'login',
      args: [{
        apiKey: this.apiKey,
        passphrase: this.apiPass,
        timestamp: timestamp,
        sign: signature
      }]
    };

    this.sendPrivate(loginMessage);
  }

  subscribeToPrivateChannels() {
    const subscribeMessage = {
      op: 'subscribe',
      args: [
        { instType: this.instType, channel: 'positions', instId: 'default' },
        { instType: this.instType, channel: 'orders', instId: 'default' },
        { instType: this.instType, channel: 'orders-algo', instId: 'default' }
      ]
    };

    this.sendPrivate(subscribeMessage);
  }

  subscribeToPrice(symbol, force = false) {
    if (!force && this.priceSubscriptions.has(symbol)) {
      return;
    }

    // Connect public WebSocket if not connected
    if (!this.wsPublic || this.wsPublic.readyState !== WebSocket.OPEN) {
      this.priceSubscriptions.add(symbol);
      this.connectPublic();
      return;
    }

    const subscribeMessage = {
      op: 'subscribe',
      args: [{
        instType: this.instType,
        channel: 'ticker',
        instId: symbol
      }]
    };

    this.sendPublic(subscribeMessage);
    this.priceSubscriptions.add(symbol);
  }

  handleMessage(data, source) {
    try {
      const dataStr = data.toString();

      // Handle pong (plain string response)
      if (dataStr === 'pong') {
        return;
      }

      const message = JSON.parse(dataStr);

      // Handle login response
      if (message.event === 'login') {
        if (message.code === 0 || message.code === '0') {
          console.log('Bitget WebSocket authenticated successfully');
          this.subscribeToPrivateChannels();
          this.emit('authenticated');
        } else {
          console.error('Bitget WebSocket login failed:', message);
        }
        return;
      }

      // Handle subscription response
      if (message.event === 'subscribe') {
        console.log('Bitget subscribed to:', message.arg?.channel);
        return;
      }

      // Handle error
      if (message.event === 'error') {
        console.error('Bitget WebSocket error:', message.code, message.msg);
        return;
      }

      // Handle data updates
      if (message.action && message.data && message.arg) {
        const channel = message.arg.channel;
        const action = message.action; // 'snapshot' for initial data, 'update' for changes

        if (channel === 'positions') {
          this.handlePositionUpdate(message.data, action);
        } else if (channel === 'orders') {
          this.handleOrderUpdate(message.data);
        } else if (channel === 'orders-algo') {
          this.handleAlgoOrderUpdate(message.data);
        } else if (channel === 'ticker') {
          this.handleTickerUpdate(message.data);
        }
      }

    } catch (error) {
      console.error('Error parsing Bitget message:', error.message);
    }
  }

  handlePositionUpdate(positions, action = 'update') {
    if (!Array.isArray(positions)) return;

    positions.forEach(pos => {
      const size = parseFloat(pos.total || pos.size || 0);
      const isLong = pos.holdSide === 'long';
      const isIsolated = pos.marginMode === 'isolated';

      const positionData = {
        symbol: pos.instId || pos.symbol,
        positionId: `${pos.instId || pos.symbol}_${pos.holdSide}`,
        holdVol: Math.abs(size),
        holdAvgPrice: parseFloat(pos.openPriceAvg || pos.averageOpenPrice || 0),
        positionType: isLong ? 1 : 2,
        openType: isIsolated ? 1 : 2,
        leverage: parseFloat(pos.leverage || 0),
        liquidatePrice: parseFloat(pos.liquidationPrice || 0),
        realised: parseFloat(pos.achievedProfits || 0),
        pnl: parseFloat(pos.unrealizedPL || 0),
        state: size > 0 ? 1 : 3,
        isSnapshot: action === 'snapshot'
      };

      this.emit('positionUpdate', positionData);
    });
  }

  handleOrderUpdate(orders) {
    if (!Array.isArray(orders)) return;

    orders.forEach(order => {
      const size = parseFloat(order.size || order.sz || order.newSize || 0);
      const notionalUsd = parseFloat(order.notionalUsd || order.fillNotionalUsd || 0);
      const rawOrderType = order.orderType || order.ordType;

      // For market orders, price comes from priceAvg/avgPx after fill
      // For limit orders, price is the limit price
      const fillPrice = parseFloat(order.priceAvg || order.avgPx || order.fillAvgPrice || 0);
      const limitPrice = parseFloat(order.price || order.px || 0);
      const finalPrice = fillPrice > 0 ? fillPrice : limitPrice;

      const orderData = {
        symbol: order.instId || order.symbol,
        orderId: order.orderId || order.ordId,
        vol: size,
        notionalUsd: notionalUsd,
        price: finalPrice,
        side: this.mapOrderSide(order.side, order.tradeSide, order.posSide),
        leverage: parseFloat(order.leverage || 0),
        state: this.mapOrderStatus(order.status || order.state),
        dealVol: parseFloat(order.baseVolume || order.accBaseVolume || order.fillSz || 0),
        orderType: this.mapOrderType(order.orderType || order.ordType),
        pnl: parseFloat(order.pnl || order.profit || order.realizedPnl || 0)
      };

      this.emit('orderUpdate', orderData);
    });
  }

  handleAlgoOrderUpdate(orders) {
    if (!Array.isArray(orders)) return;

    orders.forEach(order => {
      const orderId = order.orderId || order.id;
      const status = order.planStatus || order.status;
      const orderKey = `${orderId}_${status}`;

      // Skip if we've already processed this exact order+status
      if (this.knownAlgoOrders.has(orderKey)) {
        return;
      }

      const symbol = order.instId || order.symbol;
      const size = parseFloat(order.size || order.sz || 0);
      const triggerPrice = parseFloat(order.triggerPrice || order.triggerPx || 0);

      const planType = order.planType || order.tpslType || '';
      let triggerSide = 0;
      if (planType.includes('profit') || planType.includes('tp') || planType === 'profit_plan') {
        triggerSide = 1;
      } else if (planType.includes('loss') || planType.includes('sl') || planType === 'loss_plan') {
        triggerSide = 2;
      }

      const mappedState = this.mapAlgoOrderStatus(status);

      // Track this order
      this.knownAlgoOrders.set(orderKey, true);

      // Remove from tracking if cancelled (so re-setting triggers notification)
      if (mappedState === 2) { // cancelled
        this.knownAlgoOrders.delete(`${orderId}_live`);
        this.knownAlgoOrders.delete(`${orderId}_not_trigger`);
      }

      // Buffer updates by symbol to combine TP/SL into single notification
      const pendingKey = `${symbol}_${mappedState}`;
      if (!this.pendingAlgoUpdates.has(pendingKey)) {
        this.pendingAlgoUpdates.set(pendingKey, {
          symbol: symbol,
          orderId: orderId,
          vol: Math.abs(size),
          price: parseFloat(order.executePrice || order.price || 0),
          side: this.mapOrderSide(order.side, order.tradeSide, order.posSide),
          state: mappedState,
          takeProfitPrice: 0,
          stopLossPrice: 0,
          triggerSide: 0
        });
      }

      const pending = this.pendingAlgoUpdates.get(pendingKey);
      if (triggerSide === 1) {
        pending.takeProfitPrice = triggerPrice;
        pending.triggerSide = pending.stopLossPrice > 0 ? 0 : 1; // 0 = both, 1 = TP only
      } else if (triggerSide === 2) {
        pending.stopLossPrice = triggerPrice;
        pending.triggerSide = pending.takeProfitPrice > 0 ? 0 : 2; // 0 = both, 2 = SL only
      }

      // Debounce: wait a short time for related orders to arrive
      if (pending.timeout) {
        clearTimeout(pending.timeout);
      }
      pending.timeout = setTimeout(() => {
        this.emitPendingAlgoUpdate(pendingKey);
      }, 150);
    });
  }

  emitPendingAlgoUpdate(pendingKey) {
    const pending = this.pendingAlgoUpdates.get(pendingKey);
    if (!pending) return;

    this.pendingAlgoUpdates.delete(pendingKey);

    this.emit('stopOrderUpdate', {
      symbol: pending.symbol,
      orderId: pending.orderId,
      vol: pending.vol,
      price: pending.price,
      triggerSide: pending.triggerSide,
      takeProfitPrice: pending.takeProfitPrice,
      stopLossPrice: pending.stopLossPrice,
      side: pending.side,
      state: pending.state
    });
  }

  handleTickerUpdate(tickers) {
    if (!Array.isArray(tickers)) return;

    tickers.forEach(ticker => {
      this.emit('priceUpdate', {
        symbol: ticker.instId || ticker.symbol,
        price: parseFloat(ticker.markPrice || ticker.lastPr || ticker.last || 0)
      });
    });
  }

  mapOrderSide(side, tradeSide, posSide) {
    const isOpen = tradeSide === 'open';
    const isLong = posSide === 'long';

    if (isOpen && isLong) return 1;
    if (!isOpen && !isLong) return 2;
    if (isOpen && !isLong) return 3;
    if (!isOpen && isLong) return 4;

    return side === 'buy' ? 1 : 3;
  }

  mapOrderStatus(status) {
    switch (status) {
      case 'new':
      case 'init':
      case 'live':
        return 2;
      case 'partial_fill':
      case 'partially_filled':
        return 2;
      case 'full_fill':
      case 'filled':
        return 3;
      case 'cancelled':
      case 'canceled':
        return 4;
      default:
        return 2;
    }
  }

  mapAlgoOrderStatus(status) {
    switch (status) {
      case 'live':
      case 'not_trigger':
        return 1;
      case 'cancelled':
      case 'canceled':
      case 'fail_trigger':
      case 'expired':
      case 'order_failed':
        return 2;
      case 'triggered':
      case 'executed':
        return 3;
      default:
        console.log(`Bitget unknown algo order status: "${status}", treating as cancelled`);
        return 2;
    }
  }

  mapOrderType(orderType) {
    // 1=limit, 2=PostOnly, 3=IOC, 4=FOK, 5=market, 6=market-to-limit
    const type = (orderType || '').toLowerCase();
    switch (type) {
      case 'limit':
        return 1;
      case 'post_only':
        return 2;
      case 'ioc':
        return 3;
      case 'fok':
        return 4;
      case 'market':
        return 5;
      default:
        return 1;
    }
  }

  sendPrivate(message) {
    if (this.wsPrivate && this.wsPrivate.readyState === WebSocket.OPEN) {
      this.wsPrivate.send(JSON.stringify(message));
    }
  }

  sendPublic(message) {
    if (this.wsPublic && this.wsPublic.readyState === WebSocket.OPEN) {
      this.wsPublic.send(JSON.stringify(message));
    }
  }

  startPing() {
    this.pingInterval = setInterval(() => {
      if (this.wsPrivate && this.wsPrivate.readyState === WebSocket.OPEN) {
        this.wsPrivate.send('ping');
      }
      if (this.wsPublic && this.wsPublic.readyState === WebSocket.OPEN) {
        this.wsPublic.send('ping');
      }
    }, 25000);
  }

  stopPing() {
    if (this.pingInterval) {
      clearInterval(this.pingInterval);
      this.pingInterval = null;
    }
  }

  disconnect() {
    this.stopPing();
    // Clear pending algo update timeouts
    this.pendingAlgoUpdates.forEach(pending => {
      if (pending.timeout) {
        clearTimeout(pending.timeout);
      }
    });
    this.pendingAlgoUpdates.clear();

    if (this.wsPrivate) {
      this.wsPrivate.close();
      this.wsPrivate = null;
    }
    if (this.wsPublic) {
      this.wsPublic.close();
      this.wsPublic = null;
    }
  }
}

module.exports = BitgetWebSocket;
