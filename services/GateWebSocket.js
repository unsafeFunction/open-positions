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
  }

  generateSignature(channel, event, timestamp) {
    const message = `channel=${channel}&event=${event}&time=${timestamp}`;
    return crypto.createHmac('sha512', this.apiSecret).update(message).digest('hex');
  }

  connect() {
    this.ws = new WebSocket(this.wsUrl);

    this.ws.on('open', () => {
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
            this.emit('positionUpdate', positionData);
          });
        }
      }

      if (message.event === 'update' && message.channel === 'futures.orders') {
        if (message.result && Array.isArray(message.result)) {
          message.result.forEach(order => {
            const orderData = {
              symbol: order.contract,
              orderId: order.id,
              vol: Math.abs(parseFloat(order.size)),
              price: parseFloat(order.price),
              side: this.mapGateSide(order.size, order.is_close),
              leverage: parseFloat(order.leverage || 0),
              state: this.mapGateOrderStatus(order.status, order.finish_as),
              dealVol: Math.abs(parseFloat(order.size)) - Math.abs(parseFloat(order.left || 0)),
              category: 1
            };
            this.emit('orderUpdate', orderData);
          });
        }
      }

      if (message.event === 'update' && message.channel === 'futures.autoorders') {
        if (message.result && Array.isArray(message.result)) {
          message.result.forEach(order => {
            const size = order.initial?.size || order.size || 0;
            const price = order.initial?.price || order.price || 0;
            const triggerPrice = parseFloat(order.trigger?.price || order.trigger || 0);
            const triggerRule = order.trigger?.rule || order.trigger_rule;

            const orderData = {
              symbol: order.initial?.contract || order.contract,
              orderId: order.id,
              vol: Math.abs(parseFloat(size)),
              price: parseFloat(price),
              triggerPrice: triggerPrice,
              triggerType: 3,
              side: this.mapGateSide(size, order.is_close),
              leverage: parseFloat(order.leverage || 0),
              state: this.mapGateAutoOrderStatus(order.status, order.finish_as),
              trend: this.mapGateTrend(triggerRule)
            };
            this.emit('planOrderUpdate', orderData);
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
    if (isClose) {
      return isLong ? 2 : 4;
    }
    return isLong ? 1 : 3;
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

  mapGateAutoOrderStatus(status) {
    if (status === 'open') return 1;
    if (status === 'finished' || status === 'succeeded') return 2;
    if (status === 'cancelled') return 3;
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
