const WebSocket = require('ws');
const crypto = require('crypto');
const config = require('../config');
const EventEmitter = require('events');

class MexcWebSocket extends EventEmitter {
  constructor(apiKey, apiSecret) {
    super();
    this.apiKey = apiKey;
    this.apiSecret = apiSecret;
    this.wsUrl = config.mexc.wsUrl;
    this.ws = null;
    this.pingInterval = null;
    this.priceSubscriptions = new Set();
  }
  
  generateSignature(reqTime) {
    const signString = this.apiKey + reqTime;
    return crypto.createHmac('sha256', this.apiSecret)
    .update(signString)
    .digest('hex');
  }
  
  connect() {
    console.log('🔌 Connecting to MEXC WebSocket...');
    this.ws = new WebSocket(this.wsUrl);
    
    this.ws.on('open', () => {
      console.log('✅ Connected to MEXC WebSocket');
      this.authenticate();
      this.startPing();
    });
    
    this.ws.on('message', (data) => {
      this.handleMessage(data);
    });
    
    this.ws.on('error', (error) => {
      console.error('❌ WebSocket Error:', error.message);
    });
    
    this.ws.on('close', () => {
      console.log('🔴 WebSocket Disconnected');
      this.stopPing();
      setTimeout(() => this.connect(), 5000);
    });
  }
  
  authenticate() {
    const reqTime = Date.now().toString();
    const signature = this.generateSignature(reqTime);
    
    const loginMessage = {
      method: 'login',
      param: {
        apiKey: this.apiKey,
        reqTime: reqTime,
        signature: signature
      }
    };
    
    this.send(loginMessage);
  }
  
  subscribeToPrice(symbol) {
    if (!this.priceSubscriptions.has(symbol)) {
      const subscribeMessage = {
        method: 'sub.ticker',
        param: { symbol: symbol }
      };
      this.send(subscribeMessage);
      this.priceSubscriptions.add(symbol);
    }
  }
  
  handleMessage(data) {
    try {
      const message = JSON.parse(data);
      
      if (message.channel === 'pong') {
        return;
      }
      
      if (message.channel === 'rs.login') {
        if (message.data === 'success') {
          console.log('✅ Authentication successful');
          this.emit('authenticated');
        }
        return;
      }
      
      if (message.channel === 'push.personal.position') {
        this.emit('positionUpdate', message.data);
      }
      
      if (message.channel === 'push.ticker') {
        this.emit('priceUpdate', {
          symbol: message.symbol,
          price: parseFloat(message.data.lastPrice)
        });
      }
      
    } catch (error) {
      console.error('Error parsing message:', error);
    }
  }
  
  send(message) {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(message));
    }
  }
  
  startPing() {
    this.pingInterval = setInterval(() => {
      this.send({ method: 'ping' });
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

module.exports = MexcWebSocket;