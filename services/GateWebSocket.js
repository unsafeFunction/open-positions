const WebSocket = require('ws');
const crypto = require('crypto');
const EventEmitter = require('events');

class GateWebSocket extends EventEmitter {
  constructor(apiKey, apiSecret) {
    super();
    this.apiKey = apiKey;
    this.apiSecret = apiSecret;
    this.settle = 'usdt';
    this.wsUrl = `wss://fx-ws.gateio.ws/v4/ws/${this.settle}`;
    this.ws = null;
    this.pingInterval = null;
    this.priceSubscriptions = new Set();
    this.knownAutoOrders = new Set(); // Track known autoorder IDs to avoid duplicate notifications
    this.pendingPositionUpdates = new Map(); // symbol -> latest position data
    this.positionUpdateTimers = new Map(); // symbol -> timeout id
  }

  generateSignature(channel, event, timestamp) {
    const message = `channel=${channel}&event=${event}&time=${timestamp}`;
    return crypto.createHmac('sha512', this.apiSecret).update(message).digest('hex');
  }

  connect() {
    this.ws = new WebSocket(this.wsUrl);

    this.ws.on('open', () => {
      console.log('Gate.io WebSocket connected');
      this.authenticate();
      this.startPing();
    });

    this.ws.on('message', (data) => {
      this.handleMessage(data);
    });

    this.ws.on('error', (error) => {
      console.error('Gate.io WebSocket Error:', error.message);
    });

    this.ws.on('close', () => {
      this.stopPing();
      this.clearPositionUpdateTimers();
      setTimeout(() => this.connect(), 5000);
    });
  }

  authenticate() {
    this.subscribeToChannel('futures.positions');
    this.subscribeToChannel('futures.orders');
    this.subscribeToChannel('futures.autoorders');
  }

  subscribeToChannel(channel) {
    const timestamp = Math.floor(Date.now() / 1000);
    const event = 'subscribe';
    const signature = this.generateSignature(channel, event, timestamp);

    const authMessage = {
      time: timestamp,
      channel: channel,
      event: event,
      payload: ['!all'],
      auth: {
        method: 'api_key',
        KEY: this.apiKey,
        SIGN: signature
      }
    };

    this.send(authMessage);
  }

  subscribeToPrice(symbol) {
    if (!this.priceSubscriptions.has(symbol)) {
      const subscribeMessage = {
        time: Math.floor(Date.now() / 1000),
        channel: 'futures.tickers',
        event: 'subscribe',
        payload: [symbol]
      };
      this.send(subscribeMessage);
      this.priceSubscriptions.add(symbol);
    }
  }

  handleMessage(data) {
    try {
      const message = JSON.parse(data);

      if (message.event === 'update' && message.channel === 'futures.pong') {
        return;
      }

      if (message.event === 'subscribe') {
        if (message.channel === 'futures.positions' && (message.error === null || message.error === undefined)) {
          this.emit('authenticated');
        }
        return;
      }

      if (message.event === 'update' && message.channel === 'futures.positions') {
        if (message.result && Array.isArray(message.result)) {
          message.result.forEach(position => {
            const size = parseFloat(position.size);
            const crossLeverageLimit = parseFloat(position.cross_leverage_limit || 0);
            const isIsolated = crossLeverageLimit === 0;

            let actualLeverage;
            if (!isIsolated && crossLeverageLimit > 0) {
              actualLeverage = crossLeverageLimit;
            } else {
              actualLeverage = parseFloat(position.leverage || 0);
            }

            const positionData = {
              symbol: position.contract,
              positionId: position.contract,
              holdVol: Math.abs(size),
              holdAvgPrice: parseFloat(position.entry_price),
              positionType: size > 0 ? 1 : 2,
              openType: isIsolated ? 1 : 2,
              leverage: actualLeverage,
              liquidatePrice: parseFloat(position.liq_price),
              realised: parseFloat(position.realised_pnl || 0),
              pnl: parseFloat(position.unrealised_pnl || 0),
              state: Math.abs(size) > 0 ? 1 : 3
            };
            this.queuePositionUpdate(position.contract, positionData);
          });
        }
      }

      if (message.event === 'update' && message.channel === 'futures.orders') {
        if (message.result && Array.isArray(message.result)) {
          message.result.forEach(order => {
            // Process only final order updates from Gate (finished/cancelled outcomes).
            if (order.status !== 'finished') {
              return;
            }

            const orderData = {
              symbol: order.contract,
              orderId: order.id,
              vol: Math.abs(parseFloat(order.size)),
              price: parseFloat(order.price),
              side: this.mapGateSide(order.size, order.is_close || order.is_reduce_only),
              leverage: parseFloat(order.leverage || 0),
              state: this.mapGateOrderStatus(order.status, order.finish_as),
              dealVol: Math.abs(parseFloat(order.size)) - Math.abs(parseFloat(order.left || 0)),
              orderType: this.mapGateOrderType(order.price, order.tif),
              pnl: parseFloat(order.pnl || order.realised_pnl || 0)
            };
            this.emit('orderUpdate', orderData);
          });
        }
      }

      if (message.event === 'update' && message.channel === 'futures.autoorders') {
        if (message.result && Array.isArray(message.result)) {
          message.result.forEach(order => {
            const orderId = order.id;
            const triggerPrice = parseFloat(order.trigger?.price || 0);
            const rule = order.trigger?.rule;
            const state = this.mapGateAutoOrderStatus(order.status, order.finish_as);

            // Skip already known open orders (avoid duplicate notifications)
            if (state === 1 && this.knownAutoOrders.has(orderId)) {
              return;
            }

            if (state === 1) {
              this.knownAutoOrders.add(orderId);
            } else {
              this.knownAutoOrders.delete(orderId);
            }

            // rule 1 (>=) = SL, rule 2 (<=) = TP
            const isTP = rule === 2 || rule === '<=';
            const triggerSide = isTP ? 1 : 2;

            const orderData = {
              symbol: order.initial?.contract || order.contract,
              orderId: orderId,
              state: state,
              triggerSide: triggerSide,
              takeProfitPrice: isTP ? triggerPrice : 0,
              stopLossPrice: isTP ? 0 : triggerPrice
            };
            this.emit('stopOrderUpdate', orderData);
          });
        }
      }

      if (message.event === 'update' && message.channel === 'futures.tickers') {
        if (message.result && Array.isArray(message.result)) {
          message.result.forEach(ticker => {
            this.emit('priceUpdate', {
              symbol: ticker.contract,
              price: parseFloat(ticker.last)
            });
          });
        }
      }

    } catch (error) {
      console.error('Error parsing Gate.io message:', error.message);
    }
  }

  mapGateSide(size, isClose) {
    const isLong = parseFloat(size) > 0;
    // Handle is_close as boolean, string, or number
    const closing = isClose === true || isClose === 'true' || isClose === 1 || isClose === '1';
    if (closing) {
      return isLong ? 2 : 4;  // 2 = Close Short, 4 = Close Long
    }
    return isLong ? 1 : 3;  // 1 = Open Long, 3 = Open Short
  }

  mapGateOrderType(price, tif) {
    // Market orders on Gate have price = 0
    if (parseFloat(price) === 0) return 5; // market
    // 1=limit, 2=PostOnly, 3=IOC, 4=FOK
    switch (tif) {
      case 'poc': return 2;
      case 'ioc': return 3;
      case 'fok': return 4;
      default: return 1; // gtc = limit
    }
  }

  mapGateOrderStatus(status, finishAs) {
    if (status === 'open') return 2;
    if (status === 'finished') {
      if (finishAs === 'filled' || finishAs === 'ioc') return 3;
      if (finishAs === 'cancelled' || finishAs === 'liquidated' ||
          finishAs === 'reduce_only' || finishAs === 'position_close' ||
          finishAs === 'stp' || finishAs === 'reduce_out' ||
          finishAs === 'auto_deleveraging') return 4;
      return 3;
    }
    return 2;
  }

  mapGateAutoOrderStatus(status, finishAs) {
    // 1 = set, 2 = cancelled, 3 = triggered (ExchangeManager only handles 1 and 2)
    if (status === 'open') return 1;
    if (status === 'cancelled') return 2;
    if (status === 'finished') {
      if (finishAs === 'cancelled') return 2;
      return 3; // succeeded = triggered
    }
    return 1;
  }

  mapGateTriggerType(rule) {
    if (rule === 1 || rule === '>=') return 3;
    if (rule === 2 || rule === '<=') return 3;
    return 3;
  }

  mapGateTrend(rule) {
    if (rule === 1 || rule === '>=') return 1;
    if (rule === 2 || rule === '<=') return 2;
    return 1;
  }

  queuePositionUpdate(symbol, positionData) {
    if (!symbol) {
      return;
    }

    this.pendingPositionUpdates.set(symbol, positionData);

    const existingTimer = this.positionUpdateTimers.get(symbol);
    if (existingTimer) {
      clearTimeout(existingTimer);
    }

    // Gate may emit multiple fast updates for one fill; emit only the latest state.
    const timer = setTimeout(() => {
      const latest = this.pendingPositionUpdates.get(symbol);
      if (latest) {
        this.emit('positionUpdate', latest);
        this.pendingPositionUpdates.delete(symbol);
      }
      this.positionUpdateTimers.delete(symbol);
    }, 400);

    this.positionUpdateTimers.set(symbol, timer);
  }

  clearPositionUpdateTimers() {
    for (const timer of this.positionUpdateTimers.values()) {
      clearTimeout(timer);
    }
    this.positionUpdateTimers.clear();
    this.pendingPositionUpdates.clear();
  }

  send(message) {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(message));
    }
  }

  startPing() {
    this.pingInterval = setInterval(() => {
      const pingMessage = {
        time: Math.floor(Date.now() / 1000),
        channel: 'futures.ping'
      };
      this.send(pingMessage);
    }, 20000);
  }

  stopPing() {
    if (this.pingInterval) {
      clearInterval(this.pingInterval);
      this.pingInterval = null;
    }
  }

  disconnect() {
    this.stopPing();
    if (this.ws) {
      this.ws.close();
    }
  }
}

module.exports = GateWebSocket;
