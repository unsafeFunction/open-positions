const { WebsocketClient } = require('bybit-api');
const EventEmitter = require('events');

class BybitWebSocket extends EventEmitter {
  constructor(apiKey, apiSecret) {
    super();
    this.apiKey = apiKey;
    this.apiSecret = apiSecret;
    this.wsClient = null;
    this.priceSubscriptions = new Set();
    this.knownAlgoOrders = new Map();
    this.isAuthenticated = false;
  }

  connect() {
    console.log('Bybit WebSocket connecting...');

    this.wsClient = new WebsocketClient({
      key: this.apiKey,
      secret: this.apiSecret,
      market: 'v5',
    });

    // Setup event handlers FIRST, before subscribing
    this.setupEventHandlers();

    // Subscribe to private channels for linear perpetuals
    // The library will auto-connect and authenticate
    // Topic format: just the topic name, category is the second param
    this.wsClient.subscribeV5('position', 'linear');
    this.wsClient.subscribeV5('order', 'linear');
    this.wsClient.subscribeV5('execution', 'linear');
  }

  setupEventHandlers() {
    this.wsClient.on('open', (data) => {
      console.log('Bybit WebSocket connected:', data.wsKey);
    });

    // The library emits 'authenticated' when private channel auth succeeds
    this.wsClient.on('authenticated', (data) => {
      console.log('Bybit WebSocket authenticated successfully');
      if (!this.isAuthenticated) {
        this.isAuthenticated = true;
        this.emit('authenticated');
      }
    });

    this.wsClient.on('update', (data) => {
      this.handleMessage(data);
    });

    this.wsClient.on('response', (data) => {
      console.log('Bybit response:', JSON.stringify(data));
      if (data.success === true) {
        console.log('Bybit subscription confirmed:', data.req_id || data.op || 'N/A');
        // If we got a successful subscription to a private channel, auth worked
        const topic = data.conn_id || data.req_id || '';
        if (!this.isAuthenticated && (topic.includes('position') || topic.includes('order'))) {
          console.log('Bybit WebSocket authenticated (via subscription response)');
          this.isAuthenticated = true;
          this.emit('authenticated');
        }
      }
    });

    this.wsClient.on('error', (error) => {
      console.error('Bybit WebSocket error:', error);
    });

    this.wsClient.on('exception', (data) => {
      console.error('Bybit WebSocket exception:', data);
    });

    this.wsClient.on('reconnecting', (data) => {
      console.log('Bybit WebSocket reconnecting:', data?.wsKey);
    });

    this.wsClient.on('reconnected', (data) => {
      console.log('Bybit WebSocket reconnected:', data?.wsKey);
    });

    this.wsClient.on('close', (data) => {
      console.log('Bybit WebSocket closed:', data?.wsKey);
    });
  }

  handleMessage(data) {
    const topic = data.topic || '';

    if (topic.startsWith('position')) {
      this.handlePositionUpdate(data.data);
    } else if (topic.startsWith('order')) {
      this.handleOrderUpdate(data.data);
    } else if (topic.startsWith('execution')) {
      this.handleExecutionUpdate(data.data);
    } else if (topic.startsWith('tickers')) {
      this.handleTickerUpdate(data.data);
    }
  }

  handlePositionUpdate(positions) {
    if (!Array.isArray(positions)) return;

    positions.forEach(pos => {
      const size = parseFloat(pos.size || 0);
      const positionIdx = Number(pos.positionIdx ?? 0);
      const side = (pos.side || '').toLowerCase();
      const isLong = positionIdx === 1 || (positionIdx !== 2 && side !== 'sell');
      const isIsolated = parseInt(pos.tradeMode) === 1;
      const positionId = `${pos.symbol}_${positionIdx}`;

      // Bybit API provides ready values in USDT
      const positionValue = parseFloat(pos.positionValue || 0);
      const markPrice = parseFloat(pos.markPrice || 0);

      const positionData = {
        symbol: pos.symbol,
        positionId: positionId,
        holdVol: Math.abs(size),
        holdAvgPrice: parseFloat(pos.avgPrice || pos.entryPrice || 0),
        positionType: isLong ? 1 : 2,
        openType: isIsolated ? 1 : 2,
        leverage: parseFloat(pos.leverage || 0),
        liquidatePrice: parseFloat(pos.liqPrice || 0),
        realised: parseFloat(pos.cumRealisedPnl || 0),
        pnl: parseFloat(pos.unrealisedPnl || 0),
        positionValue: positionValue,
        currentPrice: markPrice,
        state: size !== 0 ? 1 : 3
      };

      if (positionData.state === 3) {
        // console.log('[Bybit][PositionCloseEvent][WS]', JSON.stringify({
        //   raw: {
        //     symbol: pos.symbol,
        //     side: pos.side,
        //     positionIdx: pos.positionIdx,
        //     size: pos.size,
        //     avgPrice: pos.avgPrice,
        //     entryPrice: pos.entryPrice,
        //     markPrice: pos.markPrice,
        //     cumRealisedPnl: pos.cumRealisedPnl,
        //     unrealisedPnl: pos.unrealisedPnl
        //   },
        //   mapped: positionData
        // }));
      }

      this.emit('positionUpdate', positionData);
    });
  }

  handleOrderUpdate(orders) {
    if (!Array.isArray(orders)) return;

    orders.forEach(order => {
      const symbol = order.symbol;
      const orderId = order.orderId;
      const size = parseFloat(order.qty || 0);
      const limitPrice = parseFloat(order.price || 0);
      const avgPrice = parseFloat(order.avgPrice || 0);
      const side = order.side;
      const positionIdx = order.positionIdx;
      const orderType = order.orderType;
      const status = order.orderStatus;
      const executedQty = parseFloat(order.cumExecQty || 0);
      const realizedPnl = parseFloat(
        order.closedPnl || order.cumExecPnl || order.execPnl || order.realisedPnl || order.realizedPnl || 0
      );
      const reduceOnly = order.reduceOnly === true || order.reduceOnly === 'true';
      const stopOrderType = order.stopOrderType || '';

      // Use avgPrice if filled, otherwise use limitPrice for pending orders
      const finalPrice = avgPrice > 0 ? avgPrice : limitPrice;

      const orderData = {
        symbol: symbol,
        orderId: orderId,
        vol: size,
        notionalUsd: 0,
        price: finalPrice,
        side: this.mapOrderSide(side, positionIdx, reduceOnly),
        leverage: 0,
        state: this.mapOrderStatus(status),
        dealVol: executedQty,
        orderType: this.mapOrderType(orderType),
        pnl: realizedPnl
      };

      // Bybit sends TP/SL via order updates: detect by dedicated stop fields/flags.
      if (this.isTpSlOrderUpdate(order)) {
        console.log('[Bybit][TpSlOrderUpdate]', JSON.stringify({
          symbol: order.symbol,
          orderId: order.orderId,
          orderStatus: status,
          orderType: order.orderType,
          stopOrderType: order.stopOrderType,
          orderFilter: order.orderFilter,
          triggerPrice: order.triggerPrice,
          takeProfit: order.takeProfit,
          stopLoss: order.stopLoss,
          tpslMode: order.tpslMode,
          parentOrderLinkId: order.parentOrderLinkId,
          reduceOnly: order.reduceOnly,
          closeOnTrigger: order.closeOnTrigger
        }));
        this.handleStopOrderFromOrder(order, orderData, status);
        return;
      }

      this.emit('orderUpdate', orderData);
    });
  }

  handleStopOrderFromOrder(order, orderData, status) {
    const stopOrderType = (order.stopOrderType || '').toString();
    const triggerPrice = parseFloat(order.triggerPrice || 0);
    const takeProfit = parseFloat(order.takeProfit || 0);
    const stopLoss = parseFloat(order.stopLoss || 0);
    const orderId = order.orderId;
    const orderKey = `${orderId}_${status}`;

    // Skip if we've already processed this exact order+status
    if (this.knownAlgoOrders.has(orderKey)) {
      return;
    }
    this.knownAlgoOrders.set(orderKey, true);

    let triggerSide = 0;
    if (stopOrderType.includes('TakeProfit') || (takeProfit > 0 && stopLoss <= 0)) {
      triggerSide = 1;
    } else if (stopOrderType.includes('StopLoss') || (stopLoss > 0 && takeProfit <= 0)) {
      triggerSide = 2;
    }

    const mappedState = this.mapStopOrderStatus(status);

    // Remove from tracking if cancelled
    if (mappedState === 2) {
      this.knownAlgoOrders.delete(`${orderId}_New`);
      this.knownAlgoOrders.delete(`${orderId}_Untriggered`);
    }

    const stopOrderData = {
      symbol: orderData.symbol,
      orderId: orderData.orderId,
      vol: orderData.vol,
      price: orderData.price,
      triggerSide: triggerSide,
      takeProfitPrice: takeProfit > 0 ? takeProfit : (triggerSide === 1 ? triggerPrice : 0),
      stopLossPrice: stopLoss > 0 ? stopLoss : (triggerSide === 2 ? triggerPrice : 0),
      side: orderData.side,
      state: mappedState
    };

    this.emit('stopOrderUpdate', stopOrderData);
  }

  handleExecutionUpdate(executions) {
    // Executions provide trade fill details
    // These are already covered by order updates with status changes
  }

  handleTickerUpdate(tickers) {
    if (!Array.isArray(tickers)) {
      tickers = [tickers];
    }

    tickers.forEach(ticker => {
      const symbol = ticker.symbol;
      const markPrice = parseFloat(ticker.markPrice || ticker.lastPrice || 0);

      this.emit('priceUpdate', {
        symbol: symbol,
        price: markPrice
      });
    });
  }

  subscribeToPrice(symbol) {
    if (!this.priceSubscriptions.has(symbol)) {
      // Subscribe to ticker for this symbol (public channel)
      this.wsClient.subscribeV5(['tickers.' + symbol], 'linear');
      this.priceSubscriptions.add(symbol);
    }
  }

  mapOrderSide(side, positionIdx, reduceOnly = false) {
    // positionIdx: 0 = One-Way, 1 = Buy side (Hedge), 2 = Sell side (Hedge)
    // 1 = Open Long, 2 = Close Short, 3 = Open Short, 4 = Close Long

    if (positionIdx === 1) {
      // Buy side in hedge mode (long position)
      return side === 'Buy' ? 1 : 4;
    } else if (positionIdx === 2) {
      // Sell side in hedge mode (short position)
      return side === 'Sell' ? 3 : 2;
    } else {
      // One-way mode - use reduceOnly to determine open vs close
      if (side === 'Buy') {
        return reduceOnly ? 2 : 1; // Close Short or Open Long
      } else {
        return reduceOnly ? 4 : 3; // Close Long or Open Short
      }
    }
  }

  mapOrderStatus(status) {
    switch (status) {
      case 'New':
      case 'PartiallyFilled':
      case 'Untriggered':
        return 2;
      case 'Filled':
        return 3;
      case 'Cancelled':
      case 'Rejected':
      case 'Expired':
      case 'Deactivated':
        return 4;
      default:
        return 2;
    }
  }

  mapStopOrderStatus(status) {
    switch (status) {
      case 'New':
      case 'Untriggered':
        return 1;
      case 'Cancelled':
      case 'Rejected':
      case 'Expired':
      case 'Deactivated':
        return 2;
      case 'Triggered':
      case 'Filled':
        return 3;
      default:
        return 1;
    }
  }

  mapOrderType(orderType) {
    switch (orderType) {
      case 'Limit':
        return 1;
      case 'Market':
        return 5;
      default:
        return 1;
    }
  }

  isStopOrder(stopOrderType) {
    return ['TakeProfit', 'StopLoss', 'PartialTakeProfit', 'PartialStopLoss',
            'TrailingStop', 'Stop'].includes(stopOrderType);
  }

  isTpSlOrderUpdate(order) {
    const stopOrderType = (order.stopOrderType || '').toString();
    const orderFilter = (order.orderFilter || '').toString();
    const triggerPrice = parseFloat(order.triggerPrice || 0);
    const takeProfit = parseFloat(order.takeProfit || 0);
    const stopLoss = parseFloat(order.stopLoss || 0);

    return this.isStopOrder(stopOrderType)
      || ['StopOrder', 'tpslOrder'].includes(orderFilter)
      || triggerPrice > 0
      || takeProfit > 0
      || stopLoss > 0;
  }

  disconnect() {
    if (this.wsClient) {
      this.wsClient.closeAll();
      this.wsClient = null;
    }
  }
}

module.exports = BybitWebSocket;
