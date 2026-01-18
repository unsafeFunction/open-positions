const WebSocket = require('ws');
const io = require('socket.io-client');
const EventEmitter = require('events');
const config = require('../config');

class ApiWebSocket extends EventEmitter {
  constructor(wsUrl = null) {
    super();
    this.wsUrl = wsUrl || config.api.wsUrl;
    this.ws = null;
    this.reconnectTimeout = null;
    this.reconnectDelay = 5000;
  }

  connect() {
    console.log('🔌 Connecting to API WebSocket...');

    try {
      this.ws = io(this.wsUrl);

      this.ws.on('open', () => {
        console.log('✅ Connected to API WebSocket');
        this.emit('connected');
      });

      this.ws.on('exchange:created', (data) => {
        console.log('📥 EXCHANGE CREATED:', data);
        this.emit('exchangeCreated', data);
      });

      this.ws.on('error', (error) => {
        console.error('❌ API WebSocket Error:', error.message);
      });

      this.ws.on('close', () => {
        console.log('🔴 API WebSocket Disconnected');
        this.scheduleReconnect();
      });
    } catch (error) {
      console.error('Failed to create WebSocket connection:', error.message);
      this.scheduleReconnect();
    }
  }


  scheduleReconnect() {
    if (this.reconnectTimeout) {
      clearTimeout(this.reconnectTimeout);
    }

    this.reconnectTimeout = setTimeout(() => {
      console.log('🔄 Attempting to reconnect to API WebSocket...');
      this.connect();
    }, this.reconnectDelay);
  }

  disconnect() {
    if (this.reconnectTimeout) {
      clearTimeout(this.reconnectTimeout);
      this.reconnectTimeout = null;
    }

    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
  }
}

module.exports = ApiWebSocket;
