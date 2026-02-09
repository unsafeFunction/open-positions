const PnLCalculator = require('./calculator');

class MessageFormatter {
  static EXCHANGE_URLS = {
    'MEXC': (symbol) => `https://futures.mexc.com/exchange/${symbol}`,
    'GATE': (symbol) => `https://www.gate.io/futures_trade/USDT/${symbol}`,
    'Bitget': (symbol) => `https://www.bitget.com/futures/usdt/${symbol}`,
    'Binance': (symbol) => `https://www.binance.com/en/futures/${symbol}`,
    'Bybit': (symbol) => `https://www.bybit.com/trade/usdt/${symbol}`
  };

  static calculateDollarValue(vol, contractSize, price) {
    const v = parseFloat(vol) || 0;
    const cs = parseFloat(contractSize) || 1;
    const p = parseFloat(price) || 0;
    return v * cs * p;
  }

  static formatDollarValue(value) {
    return `${parseFloat(value.toFixed(2))}$`;
  }

  static calculateCoinAmount(vol, contractSize) {
    const v = parseFloat(vol) || 0;
    const cs = parseFloat(contractSize) || 1;
    return v * cs;
  }

  static formatCoinAmount(value) {
    const num = parseFloat(value) || 0;
    if (num === 0) return '0';
    if (Math.abs(num) >= 1) return parseFloat(num.toFixed(4)).toString();
    return parseFloat(num.toFixed(8)).toString();
  }

  static extractBaseAsset(symbol = '') {
    if (!symbol) return '';
    if (symbol.includes('_')) return symbol.split('_')[0];
    if (symbol.includes('-')) return symbol.split('-')[0];
    if (symbol.includes('/')) return symbol.split('/')[0];
    if (symbol.includes(':')) return symbol.split(':')[0];

    const knownQuotes = ['USDT', 'USDC', 'BUSD', 'FDUSD', 'TUSD', 'DAI', 'USD'];
    for (const quote of knownQuotes) {
      if (symbol.endsWith(quote) && symbol.length > quote.length) {
        return symbol.slice(0, -quote.length);
      }
    }
    return symbol;
  }

  static shouldShowCoinAmount(position) {
    return true;
  }

  static formatVolumeWithCoin(valueUsd, item, vol, contractSize) {
    const usd = this.formatDollarValue(valueUsd);
    if (!this.shouldShowCoinAmount(item)) {
      return usd;
    }
    const coins = this.calculateCoinAmount(vol, contractSize);
    const base = this.extractBaseAsset(item?.symbol || '');
    return `${usd} (${this.formatCoinAmount(coins)} ${base})`;
  }

  static getExchangeUrl(exchangeType, symbol) {
    const urlGenerator = this.EXCHANGE_URLS[exchangeType];
    return urlGenerator ? urlGenerator(symbol) : null;
  }

  static formatPositionMessage(positionsMap) {
    if (!positionsMap || positionsMap.size === 0) {
      return 'Нет открытых позиций';
    }

    const groupedBySymbol = new Map();

    for (const [key, position] of positionsMap) {
      const symbol = position.symbol;
      if (!groupedBySymbol.has(symbol)) {
        groupedBySymbol.set(symbol, []);
      }
      groupedBySymbol.get(symbol).push(position);
    }

    const sortedSymbols = Array.from(groupedBySymbol.keys()).sort();

    let message = '📊 <b>ОТКРЫТЫЕ ПОЗИЦИИ</b> 📊\n';

    for (const symbol of sortedSymbols) {
      const positions = groupedBySymbol.get(symbol);

      positions.sort((a, b) => {
        const nameA = a.exchangeName || `Exchange ${a.exchangeId}`;
        const nameB = b.exchangeName || `Exchange ${b.exchangeId}`;
        return nameA.localeCompare(nameB);
      });
      message += `<code>${symbol}</code>\n`;
      message += '------------------------\n';

      positions.forEach((pos, idx) => {
        const sideEmoji = pos.positionType === 1 ? '🟢' : '🔴';
        const side = pos.positionType === 1 ? 'Лонг' : 'Шорт';
        const mode = pos.openType === 1 ? 'Изол' : 'Кросс';
        const exchangeName = pos.exchangeName || `Exchange ${pos.exchangeId}`;

        const unrealizedPnl = pos.unrealizedPnl || 0;
        const realizedPnl = pos.realised || 0;
        const posValue = pos.positionValue || 0;

        message += `<b>${exchangeName}</b>\n`;
        message += `${sideEmoji} ${side} | ${mode} | <b>${pos.leverage}x</b>\n`;
        message += `💰 <b>Объем:</b> ${this.formatDollarValue(posValue)}\n`;
        message += `📍 <b>ТВХ:</b> ${PnLCalculator.formatPrice(pos.holdAvgPrice)}\n`;
        message += `📈 <b>Текущая:</b> ${PnLCalculator.formatPrice(pos.currentPrice)}\n`;
        message += `📊 <b>Нереализ:</b> ${PnLCalculator.formatPnL(unrealizedPnl)}\n`;
        message += `💵 <b>Реализ:</b> ${PnLCalculator.formatPnL(realizedPnl)}\n`;
        message += `⚠️ <b>Ликвид:</b> ${PnLCalculator.formatPrice(Math.abs(pos.liquidatePrice))}\n`;

        if (idx < positions.length - 1) {
          message += `---\n`;
        }
      });

      message += '\n';
    }

    message += `🕐 <b>Обновлено:</b> ${new Date().toLocaleTimeString()}\n`;

    return message;
  }

  static formatPositionUpdate(type, position) {
    const side = position.positionType === 1 ? 'Лонг' : 'Шорт';
    const mode = position.openType === 1 ? 'Изол' : 'Кросс';
    const exchangeName = position.exchangeName || `Exchange ${position.exchangeId}`;
    const contractSize = position.contractSize || 1;

    let message = '';

    switch(type) {
      case 'opened':
        const openValue = this.calculateDollarValue(position.holdVol, contractSize, position.holdAvgPrice);
        const openMethod = position.openedByMarket ? 'маркетом' : 'лимиткой';
        const openSideEmoji = position.positionType === 1 ? '🟢' : '🔴';
        message = `<b>${exchangeName}</b>\n`;
        message += `${openSideEmoji} <b>Открыта позиция ${openMethod}</b>\n`;
        message += `${side} (${mode})\n\n`;
        message += `<code>${position.symbol}</code>\n`;
        message += `━━━━━━━━━━━━━━━━━━━━\n`;
        message += `📍 <b>ТВХ:</b> ${PnLCalculator.formatPrice(position.holdAvgPrice)}\n`;
        message += `💰 <b>Объем:</b> ${this.formatVolumeWithCoin(openValue, position, position.holdVol, contractSize)}\n`;
        message += `⚡ <b>Плечо:</b> ${position.leverage}x\n`;
        message += `⚠️ <b>Ликвид:</b> ${PnLCalculator.formatPrice(Math.abs(position.liquidatePrice))}`;
        break;

      case 'closed':
        const closedRealizedPnl = position.realised || 0;
        const closedValue = this.calculateDollarValue(position.holdVol, contractSize, position.holdAvgPrice);
        const pnlPercentage = closedValue > 0
          ? ((closedRealizedPnl / closedValue) * 100).toFixed(2)
          : '0.00';
        const pnlEmoji = closedRealizedPnl >= 0 ? '💚' : '💔';

        message = `<b>${exchangeName}</b>\n`;
        message += `🚫 <b>Закрыта позиция</b>\n`;
        message += `${side} (${mode})\n\n`;
        message += `<code>${position.symbol}</code>\n`;
        message += `━━━━━━━━━━━━━━━━━━━━\n`;
        message += `📍 <b>Цена:</b> ${PnLCalculator.formatPrice(position.currentPrice)}\n`;
        message += `💰 <b>Объем:</b> ${this.formatVolumeWithCoin(closedValue, position, position.holdVol, contractSize)}\n`;
        message += `${pnlEmoji} <b>PNL:</b> ${PnLCalculator.formatPnL(closedRealizedPnl)} (${pnlPercentage}%)`;
        break;

      case 'positionIncreased':
        const addedContracts = position.holdVol - (position.previousHoldVol || 0);
        const addedValue = this.calculateDollarValue(addedContracts, contractSize, position.holdAvgPrice);
        const newTotalValue = this.calculateDollarValue(position.holdVol, contractSize, position.holdAvgPrice);

        message = `<b>${exchangeName}</b>\n`;
        message += `📈 <b>Позиция увеличена</b>\n`;
        message += `${side} (${mode})\n\n`;
        message += `<code>${position.symbol}</code>\n`;
        message += `━━━━━━━━━━━━━━━━━━━━\n`;
        message += `➕ <b>Добавлено:</b> ${this.formatVolumeWithCoin(addedValue, position, addedContracts, contractSize)}\n`;
        message += `💰 <b>Новый объем:</b> ${this.formatVolumeWithCoin(newTotalValue, position, position.holdVol, contractSize)}\n`;
        message += `📍 <b>Средняя ТВХ:</b> ${PnLCalculator.formatPrice(position.holdAvgPrice)}`;
        break;

      case 'positionDecreased':
        const removedContracts = (position.previousHoldVol || 0) - position.holdVol;
        const removedValue = this.calculateDollarValue(removedContracts, contractSize, position.holdAvgPrice);
        const remainingValue = this.calculateDollarValue(position.holdVol, contractSize, position.holdAvgPrice);
        const partialRealizedPnl = position.realised || 0;

        message = `<b>${exchangeName}</b>\n`;
        message += `📉 <b>Позиция уменьшена</b>\n`;
        message += `${side} (${mode})\n\n`;
        message += `<code>${position.symbol}</code>\n`;
        message += `━━━━━━━━━━━━━━━━━━━━\n`;
        message += `➖ <b>Убрано:</b> ${this.formatVolumeWithCoin(removedValue, position, removedContracts, contractSize)}\n`;
        message += `💰 <b>Осталось:</b> ${this.formatVolumeWithCoin(remainingValue, position, position.holdVol, contractSize)}\n`;
        message += `📍 <b>Средняя ТВХ:</b> ${PnLCalculator.formatPrice(position.holdAvgPrice)}`;
        if (partialRealizedPnl !== 0) {
          const partialPnlEmoji = partialRealizedPnl >= 0 ? '💚' : '💔';
          message += `\n${partialPnlEmoji} <b>Реализованный PnL:</b> ${PnLCalculator.formatPnL(partialRealizedPnl)}`;
        }
        break;

      case 'limitOrderPlaced':
        message = this.formatLimitOrder('Размещен', position);
        break;

      case 'limitOrderFilled':
        message = this.formatLimitOrder('Исполнен', position);
        break;

      case 'limitOrderCancelled':
        message = this.formatLimitOrder('Отменен', position);
        break;

      case 'marketOrderPlaced':
        message = this.formatMarketOrder('Размещен', position);
        break;

      case 'marketOrderFilled':
        message = this.formatMarketOrder('Исполнен', position);
        break;

      case 'marketOrderCancelled':
        message = this.formatMarketOrder('Отменен', position);
        break;

      case 'stopOrderSet':
        message = this.formatStopOrder('установлен', position);
        break;

      case 'stopOrderCancelled':
        message = this.formatStopOrder('отменён', position);
        break;
    }

    return message;
  }

  static formatLimitOrder(status, order) {
    const exchangeName = order.exchangeName || `Exchange ${order.exchangeId}`;
    const contractSize = order.contractSize || 1;
    const orderValue = order.notionalUsd || this.calculateDollarValue(order.vol, contractSize, order.price);

    let sideText = '';
    if (order.side === 1) sideText = 'Открыть лонг';
    else if (order.side === 2) sideText = 'Закрыть шорт';
    else if (order.side === 3) sideText = 'Открыть шорт';
    else if (order.side === 4) sideText = 'Закрыть лонг'; 

    let message = `<b>${exchangeName}</b>\n`;
    message += `📝 <b>Лимитный ордер — ${status}</b>\n`;
    message += `${sideText}\n\n`;
    message += `<code>${order.symbol}</code>\n`;
    message += `━━━━━━━━━━━━━━━━━━━━\n`;
    message += `📍 <b>Цена:</b> ${PnLCalculator.formatPrice(order.price)}\n`;
    message += `💰 <b>Объем:</b> ${this.formatVolumeWithCoin(orderValue, order, order.vol, contractSize)}`;

    if (order.leverage) {
      message += `\n⚡ <b>Плечо:</b> ${order.leverage}x`;
    }

    // Показываем PNL при закрытии позиции (side 2 = закрыть шорт, side 4 = закрыть лонг)
    const isClosing = order.side === 2 || order.side === 4;
    if (isClosing && order.pnl !== undefined && order.pnl !== 0) {
      const limitPnlEmoji = order.pnl >= 0 ? '💚' : '💔';
      message += `\n${limitPnlEmoji} <b>PNL:</b> ${PnLCalculator.formatPnL(order.pnl)}`;
    }

    return message;
  }

  static formatMarketOrder(status, order) {
    const exchangeName = order.exchangeName || `Exchange ${order.exchangeId}`;
    const contractSize = order.contractSize || 1;
    const price = order.dealAvgPrice || order.price || 0;
    const orderValue = order.notionalUsd || this.calculateDollarValue(order.vol, contractSize, price);

    let sideText = '';
    if (order.side === 1) sideText = 'Открыть лонг';
    else if (order.side === 2) sideText = 'Закрыть шорт';
    else if (order.side === 3) sideText = 'Открыть шорт';
    else if (order.side === 4) sideText = 'Закрыть лонг';

    let message = `<b>${exchangeName}</b>\n`;
    message += `⚡ <b>Маркет ордер — ${status}</b>\n`;
    message += `${sideText}\n\n`;
    message += `<code>${order.symbol}</code>\n`;
    message += `━━━━━━━━━━━━━━━━━━━━\n`;
    if (price > 0) {
      message += `📍 <b>Цена:</b> ${PnLCalculator.formatPrice(price)}\n`;
    }
    message += `💰 <b>Объем:</b> ${this.formatVolumeWithCoin(orderValue, order, order.vol, contractSize)}`;

    if (order.leverage) {
      message += `\n⚡ <b>Плечо:</b> ${order.leverage}x`;
    }

    // Показываем PNL при закрытии позиции (side 2 = закрыть шорт, side 4 = закрыть лонг)
    const isClosing = order.side === 2 || order.side === 4;
    if (isClosing && order.pnl !== undefined && order.pnl !== 0) {
      const marketPnlEmoji = order.pnl >= 0 ? '💚' : '💔';
      message += `\n${marketPnlEmoji} <b>PNL:</b> ${PnLCalculator.formatPnL(order.pnl)}`;
    }

    return message;
  }

  static formatStopOrder(status, order) {
    const exchangeName = order.exchangeName || `Exchange ${order.exchangeId}`;
    const triggerSide = order.triggerSide; // 1 = TP, 2 = SL

    let typeText = '🎯 TP/SL';
    if (triggerSide === 1) typeText = '🎯 Тейк профит';
    else if (triggerSide === 2) typeText = '🛡️ Стоп лосс';

    let message = `<b>${exchangeName}</b>\n`;
    message += `<b>${typeText} — ${status}</b>\n\n`;
    message += `<code>${order.symbol}</code>\n`;
    message += `━━━━━━━━━━━━━━━━━━━━\n`;

    if (order.takeProfitPrice && parseFloat(order.takeProfitPrice) > 0) {
      message += `🎯 <b>TP:</b> ${PnLCalculator.formatPrice(order.takeProfitPrice)}\n`;
    }

    if (order.stopLossPrice && parseFloat(order.stopLossPrice) > 0) {
      message += `🛡️ <b>SL:</b> ${PnLCalculator.formatPrice(order.stopLossPrice)}`;
    }

    return message;
  }
}

module.exports = MessageFormatter;
