const WebSocket = require('ws');
const zlib = require('zlib');
const EventEmitter = require('events');
const BingXClient = require('./BingXClient');
const config = require('../config');

class BingXWebSocket extends EventEmitter {
  constructor(apiKey, apiSecret) {
    super();
    this.apiKey = apiKey;
    this.apiSecret = apiSecret;
    this.wsUrl = config.bingx.wsUrl;
    this.client = new BingXClient(apiKey, apiSecret);
    this.wsPrivate = null;
    this.wsPublic = null;
    this.listenKey = null;
    this.listenKeyInterval = null;
    this.pingInterval = null;
    this.priceSubscriptions = new Set();
  }

  async connect() {
    try {
      this.listenKey = await this.client.generateListenKey();
      if (!this.listenKey) {
        console.error('BingX: Failed to generate listenKey, retrying in 5s...');
        setTimeout(() => this.connect(), 5000);
        return;
      }
      console.log('BingX: ListenKey generated');
      this.connectPrivate();
      this.startListenKeyRefresh();
    } catch (error) {
      console.error('BingX: Connection error:', error.message);
      setTimeout(() => this.connect(), 5000);
    }
  }

  connectPrivate() {
    const url = `${this.wsUrl}?listenKey=${this.listenKey}`;
    this.wsPrivate = new WebSocket(url);

    this.wsPrivate.on('open', () => {
      console.log('BingX WebSocket private connected');
      this.subscribeToPrivateChannels();
      this.startPing();
      this.emit('authenticated');
    });

    this.wsPrivate.on('message', (data) => {
      this.handleMessage(data, 'private');
    });

    this.wsPrivate.on('error', (error) => {
      console.error('BingX WebSocket private error:', error.message);
    });

    this.wsPrivate.on('close', () => {
      console.log('BingX WebSocket private closed');
      this.stopPing();
      setTimeout(() => this.reconnect(), 5000);
    });
  }

  connectPublic() {
    if (this.wsPublic && (this.wsPublic.readyState === WebSocket.OPEN || this.wsPublic.readyState === WebSocket.CONNECTING)) {
      return;
    }

    this.wsPublic = new WebSocket(this.wsUrl);

    this.wsPublic.on('open', () => {
      console.log('BingX WebSocket public connected');
      // Resubscribe to prices
      this.priceSubscriptions.forEach(symbol => {
        this.subscribeToPrice(symbol, true);
      });
    });

    this.wsPublic.on('message', (data) => {
      this.handleMessage(data, 'public');
    });

    this.wsPublic.on('error', (error) => {
      console.error('BingX WebSocket public error:', error.message);
    });

    this.wsPublic.on('close', () => {
      console.log('BingX WebSocket public closed');
      setTimeout(() => this.connectPublic(), 5000);
    });
  }

  async reconnect() {
    try {
      this.listenKey = await this.client.generateListenKey();
      if (this.listenKey) {
        this.connectPrivate();
      } else {
        setTimeout(() => this.reconnect(), 5000);
      }
    } catch (error) {
      console.error('BingX: Reconnect error:', error.message);
      setTimeout(() => this.reconnect(), 5000);
    }
  }

  subscribeToPrivateChannels() {
    const subscribeMessage = {
      id: Date.now().toString(),
      reqType: 'sub',
      dataType: 'ACCOUNT_UPDATE'
    };
    this.sendPrivate(subscribeMessage);

    const orderSub = {
      id: (Date.now() + 1).toString(),
      reqType: 'sub',
      dataType: 'ORDER_TRADE_UPDATE'
    };
    this.sendPrivate(orderSub);
  }

  subscribeToPrice(symbol, force = false) {
    if (!force && this.priceSubscriptions.has(symbol)) {
      return;
    }

    // Connect public WS if not connected
    if (!this.wsPublic || this.wsPublic.readyState !== WebSocket.OPEN) {
      this.priceSubscriptions.add(symbol);
      this.connectPublic();
      return;
    }

    const subscribeMessage = {
      id: Date.now().toString(),
      reqType: 'sub',
      dataType: `${symbol}@ticker`
    };
    this.sendPublic(subscribeMessage);
    this.priceSubscriptions.add(symbol);
  }

  decompressMessage(data) {
    try {
      // BingX sends GZIP compressed data
      if (Buffer.isBuffer(data) || data instanceof ArrayBuffer) {
        const buffer = Buffer.isBuffer(data) ? data : Buffer.from(data);
        try {
          return zlib.gunzipSync(buffer).toString('utf-8');
        } catch (e) {
          // Try inflate if gunzip fails
          try {
            return zlib.inflateSync(buffer).toString('utf-8');
          } catch (e2) {
            return buffer.toString('utf-8');
          }
        }
      }
      return data.toString('utf-8');
    } catch (error) {
      return data.toString('utf-8');
    }
  }

  handleMessage(rawData, source) {
    try {
      const dataStr = this.decompressMessage(rawData);

      // Handle Ping - respond with Pong
      if (dataStr === 'Ping' || dataStr === 'ping') {
        if (source === 'private') {
          this.sendPrivateRaw('Pong');
        } else {
          this.sendPublicRaw('Pong');
        }
        return;
      }

      const message = JSON.parse(dataStr);

      // Handle pong response
      if (message.pong || message.msg === 'pong' || message.dataType === 'pong') {
        return;
      }

      // Handle subscription confirmation
      if (message.msg === 'success' || message.code === 0) {
        return;
      }

      // Handle ACCOUNT_UPDATE - position changes
      if (message.dataType === 'ACCOUNT_UPDATE' || message.e === 'ACCOUNT_UPDATE') {
        this.handleAccountUpdate(message);
        return;
      }

      // Handle ORDER_TRADE_UPDATE - order changes
      if (message.dataType === 'ORDER_TRADE_UPDATE' || message.e === 'ORDER_TRADE_UPDATE') {
        this.handleOrderTradeUpdate(message);
        return;
      }

      // Handle ticker updates
      if (message.dataType && message.dataType.endsWith('@ticker')) {
        this.handleTickerUpdate(message);
        return;
      }

    } catch (error) {
      // Silently ignore parse errors for binary/ping frames
      if (error instanceof SyntaxError) return;
      console.error('Error parsing BingX message:', error.message);
    }
  }

  handleAccountUpdate(message) {
    const data = message.a || message.data || message;
    if (!data) return;

    // Position updates are in data.P or data.positions
    const positions = data.P || data.positions || [];
    if (!Array.isArray(positions)) return;

    positions.forEach(pos => {
      const size = parseFloat(pos.pa || pos.positionAmt || 0);
      const positionSide = pos.ps || pos.positionSide || 'LONG';
      const isLong = positionSide === 'LONG';
      const isoWallet = parseFloat(pos.iw || 0);
      const isIsolated = isoWallet > 0;

      const positionData = {
        symbol: pos.s || pos.symbol,
        positionId: `${pos.s || pos.symbol}_${positionSide}`,
        holdVol: Math.abs(size),
        holdAvgPrice: parseFloat(pos.ep || pos.entryPrice || 0),
        positionType: isLong ? 1 : 2,
        openType: isIsolated ? 1 : 2,
        leverage: parseFloat(pos.l || pos.leverage || 0),
        liquidatePrice: parseFloat(pos.lp || pos.liquidationPrice || 0),
        realised: parseFloat(pos.cr || pos.realisedPnl || 0),
        pnl: parseFloat(pos.up || pos.unrealizedProfit || 0),
        state: Math.abs(size) > 0 ? 1 : 3
      };

      this.emit('positionUpdate', positionData);
    });
  }

  handleOrderTradeUpdate(message) {
    const data = message.o || message.data || message;
    if (!data) return;

    const orderType = (data.o || data.orderType || data.type || '').toUpperCase();
    const symbol = data.s || data.symbol;
    const side = (data.S || data.side || '').toUpperCase();
    const positionSide = (data.ps || data.positionSide || '').toUpperCase();
    const status = (data.X || data.status || '').toUpperCase();

    // Check if this is a stop order (TP/SL)
    const isStopOrder = orderType.includes('STOP') || orderType.includes('TAKE_PROFIT');

    if (isStopOrder) {
      this.handleStopOrder(data, symbol, orderType, side, positionSide, status);
      return;
    }

    // Regular order (market or limit)
    const orderData = {
      symbol: symbol,
      orderId: data.i || data.orderId,
      vol: parseFloat(data.q || data.origQty || 0),
      price: parseFloat(data.ap || data.avgPrice || data.p || data.price || 0),
      side: this.mapSide(side, positionSide),
      leverage: 0,
      state: this.mapOrderStatus(status),
      dealVol: parseFloat(data.z || data.cumQty || data.executedQty || 0),
      orderType: this.mapOrderType(orderType),
      pnl: parseFloat(data.rp || data.realizedPnl || 0)
    };

    this.emit('orderUpdate', orderData);
  }

  handleStopOrder(data, symbol, orderType, side, positionSide, status) {
    const triggerPrice = parseFloat(data.sp || data.stopPrice || 0);
    const isTP = orderType.includes('TAKE_PROFIT');
    const triggerSide = isTP ? 1 : 2;

    const mappedState = this.mapStopOrderStatus(status);

    const orderData = {
      symbol: symbol,
      orderId: data.i || data.orderId,
      state: mappedState,
      triggerSide: triggerSide,
      takeProfitPrice: isTP ? triggerPrice : 0,
      stopLossPrice: isTP ? 0 : triggerPrice
    };

    this.emit('stopOrderUpdate', orderData);
  }

  handleTickerUpdate(message) {
    const data = message.data || message;
    if (!data) return;

    const symbol = data.s || data.symbol;
    const price = parseFloat(data.c || data.lastPrice || data.markPrice || 0);

    if (symbol && price > 0) {
      this.emit('priceUpdate', { symbol, price });
    }
  }

  mapSide(side, positionSide) {
    // 1=OpenLong, 2=CloseShort, 3=OpenShort, 4=CloseLong
    const isBuy = side === 'BUY';
    const isLong = positionSide === 'LONG';

    if (isBuy && isLong) return 1;     // Open Long
    if (isBuy && !isLong) return 2;    // Close Short
    if (!isBuy && !isLong) return 3;   // Open Short
    if (!isBuy && isLong) return 4;    // Close Long

    return isBuy ? 1 : 3;
  }

  mapOrderType(orderType) {
    // 1=limit, 2=PostOnly, 3=IOC, 4=FOK, 5=market
    switch (orderType) {
      case 'LIMIT': return 1;
      case 'POST_ONLY': return 2;
      case 'IOC': return 3;
      case 'FOK': return 4;
      case 'MARKET': return 5;
      default: return 1;
    }
  }

  mapOrderStatus(status) {
    // 2=open, 3=filled, 4=cancelled
    switch (status) {
      case 'NEW': return 2;
      case 'PARTIALLY_FILLED': return 2;
      case 'FILLED': return 3;
      case 'CANCELED':
      case 'CANCELLED':
      case 'EXPIRED':
      case 'REJECTED': return 4;
      default: return 2;
    }
  }

  mapStopOrderStatus(status) {
    // 1=set, 2=cancelled, 3=triggered
    switch (status) {
      case 'NEW': return 1;
      case 'CANCELED':
      case 'CANCELLED':
      case 'EXPIRED':
      case 'REJECTED': return 2;
      case 'FILLED':
      case 'TRIGGERED': return 3;
      default: return 1;
    }
  }

  sendPrivate(message) {
    if (this.wsPrivate && this.wsPrivate.readyState === WebSocket.OPEN) {
      this.wsPrivate.send(JSON.stringify(message));
    }
  }

  sendPrivateRaw(message) {
    if (this.wsPrivate && this.wsPrivate.readyState === WebSocket.OPEN) {
      this.wsPrivate.send(message);
    }
  }

  sendPublic(message) {
    if (this.wsPublic && this.wsPublic.readyState === WebSocket.OPEN) {
      this.wsPublic.send(JSON.stringify(message));
    }
  }

  sendPublicRaw(message) {
    if (this.wsPublic && this.wsPublic.readyState === WebSocket.OPEN) {
      this.wsPublic.send(message);
    }
  }

  startPing() {
    this.pingInterval = setInterval(() => {
      this.sendPrivateRaw('Ping');
      if (this.wsPublic && this.wsPublic.readyState === WebSocket.OPEN) {
        this.sendPublicRaw('Ping');
      }
    }, 20000);
  }

  stopPing() {
    if (this.pingInterval) {
      clearInterval(this.pingInterval);
      this.pingInterval = null;
    }
  }

  startListenKeyRefresh() {
    // Refresh listenKey every 30 minutes (valid for 60 min)
    this.listenKeyInterval = setInterval(async () => {
      if (this.listenKey) {
        await this.client.extendListenKey(this.listenKey);
        console.log('BingX: ListenKey refreshed');
      }
    }, 30 * 60 * 1000);
  }

  stopListenKeyRefresh() {
    if (this.listenKeyInterval) {
      clearInterval(this.listenKeyInterval);
      this.listenKeyInterval = null;
    }
  }

  disconnect() {
    this.stopPing();
    this.stopListenKeyRefresh();

    if (this.wsPrivate) {
      this.wsPrivate.close();
      this.wsPrivate = null;
    }
    if (this.wsPublic) {
      this.wsPublic.close();
      this.wsPublic = null;
    }

    if (this.listenKey) {
      this.client.deleteListenKey(this.listenKey).catch(() => {});
      this.listenKey = null;
    }
  }
}

module.exports = BingXWebSocket;
