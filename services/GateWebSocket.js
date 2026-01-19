const WebSocket = require('ws');
const crypto = require('crypto');
const EventEmitter = require('events');

class GateWebSocket extends EventEmitter {
  constructor(apiKey, apiSecret) {
    super();
    this.apiKey = apiKey;
    this.apiSecret = apiSecret;
    this.settle = 'usdt';
    this.wsUrl = `wss://fx-ws.gateio.ws/v4/ws/${this.settle}`; // Include settle in URL
    this.ws = null;
    this.pingInterval = null;
    this.priceSubscriptions = new Set();
  }

  generateSignature(channel, event, timestamp) {
    const message = `channel=${channel}&event=${event}&time=${timestamp}`;
    return crypto.createHmac('sha512', this.apiSecret).update(message).digest('hex');
  }

  connect() {
    console.log('🔌 Connecting to Gate.io WebSocket...');
    this.ws = new WebSocket(this.wsUrl);

    this.ws.on('open', () => {
      console.log('✅ Connected to Gate.io WebSocket');
      this.authenticate();
      this.startPing();
    });

    this.ws.on('message', (data) => {
      this.handleMessage(data);
    });

    this.ws.on('error', (error) => {
      console.error('❌ Gate.io WebSocket Error:', error.message);
    });

    this.ws.on('close', () => {
      console.log('🔴 Gate.io WebSocket Disconnected');
      this.stopPing();
      setTimeout(() => this.connect(), 5000);
    });
  }

  authenticate() {
    const timestamp = Math.floor(Date.now() / 1000);
    const channel = 'futures.positions';
    const event = 'subscribe';
    const signature = this.generateSignature(channel, event, timestamp);

    const authMessage = {
      time: timestamp,
      channel: channel,
      event: event,
      payload: ['!all'], // Subscribe to all positions
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

      // Handle pong
      if (message.event === 'update' && message.channel === 'futures.pong') {
        return;
      }

      // Handle authentication response
      if (message.event === 'subscribe' && message.channel === 'futures.positions') {
        if (message.error === null || message.error === undefined) {
          console.log('✅ Gate.io authentication successful');
          this.emit('authenticated');
        } else {
          console.error('❌ Gate.io authentication failed:', message.error);
        }
        return;
      }

      // Handle position updates
      if (message.event === 'update' && message.channel === 'futures.positions') {
        if (message.result && Array.isArray(message.result)) {
          message.result.forEach(position => {
            const size = parseFloat(position.size);
            // Gate.io margin type: cross_leverage_limit = 0 means isolated, > 0 means cross
            const crossLeverageLimit = parseFloat(position.cross_leverage_limit || 0);
            const isIsolated = crossLeverageLimit === 0;

            // Get actual leverage
            // For cross margin: use cross_leverage_limit
            // For isolated: use leverage field
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

      // Handle ticker (price) updates
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
      console.error('Error parsing Gate.io message:', error);
    }
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
