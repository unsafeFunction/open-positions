const PnLCalculator = require('./calculator');

class MessageFormatter {
  static EXCHANGE_URLS = {
    'MEXC': (symbol) => `https://futures.mexc.com/exchange/${symbol}`,
    'GATE': (symbol) => `https://www.gate.io/futures_trade/USDT/${symbol}`,
    'Bitget': (symbol) => `https://www.bitget.com/futures/usdt/${symbol}`
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

    let message = '<b>ОТКРЫТЫЕ ПОЗИЦИИ</b>\n';

    for (const symbol of sortedSymbols) {
      const positions = groupedBySymbol.get(symbol);

      positions.sort((a, b) => {
        const nameA = a.exchangeName || `Exchange ${a.exchangeId}`;
        const nameB = b.exchangeName || `Exchange ${b.exchangeId}`;
        return nameA.localeCompare(nameB);
      });
      message += `<code>${symbol}</code>\n`;
      message += '------------------------\n';

      let totalValue = 0;
      let totalUnrealizedPnL = 0;
      let totalRealizedPnL = 0;

      positions.forEach((pos, idx) => {
        const side = pos.positionType === 1 ? 'Лонг' : 'Шорт';
        const mode = pos.openType === 1 ? 'Изол' : 'Кросс';
        const exchangeName = pos.exchangeName || `Exchange ${pos.exchangeId}`;

        const unrealizedPnl = pos.unrealizedPnl || 0;
        const realizedPnl = pos.realised || 0;
        const posValue = pos.positionValue || 0;

        totalValue += posValue;
        totalUnrealizedPnL += unrealizedPnl;
        totalRealizedPnL += realizedPnl;

        message += `<b>${exchangeName}</b>\n`;
        message += `${side} | ${mode} | ${pos.leverage}x\n`;
        message += `Объем: ${this.formatDollarValue(posValue)}\n`;
        message += `ТВХ: ${PnLCalculator.formatPrice(pos.holdAvgPrice)}\n`;
        message += `Текущая: ${PnLCalculator.formatPrice(pos.currentPrice)}\n`;
        message += `Нереализ: ${PnLCalculator.formatPnL(unrealizedPnl)}\n`;
        message += `Реализ: ${PnLCalculator.formatPnL(realizedPnl)}\n`;
        message += `Ликвид: ${PnLCalculator.formatPrice(pos.liquidatePrice)}\n`;

        if (idx < positions.length - 1) {
          message += `---\n`;
        }
      });

      if (positions.length > 1) {
        const totalPnL = totalUnrealizedPnL + totalRealizedPnL;

        message += '\n';
        message += `<b>${symbol} Итого:</b>\n`;
        message += `Объем: ${this.formatDollarValue(totalValue)}\n`;
        message += `Нереализ: ${PnLCalculator.formatPnL(totalUnrealizedPnL)}\n`;
        message += `Реализ: ${PnLCalculator.formatPnL(totalRealizedPnL)}\n`;
        message += `Всего PnL: ${PnLCalculator.formatPnL(totalPnL)}\n`;
      }

      message += '\n';
    }

    message += `Обновлено: ${new Date().toLocaleTimeString()}\n`;

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
        message = `<b>${exchangeName}</b>\n`;
        message += `<b>Открыта позиция</b>\n`;
        message += `${side} (${mode})\n\n`;
        message += `<code>${position.symbol}</code>\n`;
        message += `━━━━━━━━━━━━━━━━━━━━\n`;
        message += `<b>ТВХ:</b> ${PnLCalculator.formatPrice(position.holdAvgPrice)}\n`;
        message += `<b>Объем:</b> ${this.formatDollarValue(openValue)}\n`;
        message += `<b>Плечо:</b> ${position.leverage}x`;
        break;

      case 'closed':
        const closedRealizedPnl = position.realised || 0;
        const closedValue = this.calculateDollarValue(position.holdVol, contractSize, position.holdAvgPrice);
        const pnlPercentage = closedValue > 0
          ? ((closedRealizedPnl / closedValue) * 100).toFixed(2)
          : '0.00';

        message = `<b>${exchangeName}</b>\n`;
        message += `<b>Закрыта позиция</b>\n`;
        message += `${side} (${mode})\n\n`;
        message += `<code>${position.symbol}</code>\n`;
        message += `━━━━━━━━━━━━━━━━━━━━\n`;
        message += `<b>Цена:</b> ${PnLCalculator.formatPrice(position.currentPrice)}\n`;
        message += `<b>PNL:</b> ${PnLCalculator.formatPnL(closedRealizedPnl)} (${pnlPercentage}%)`;
        break;

      case 'positionIncreased':
        const addedContracts = position.holdVol - (position.previousHoldVol || 0);
        const addedValue = this.calculateDollarValue(addedContracts, contractSize, position.holdAvgPrice);
        const newTotalValue = this.calculateDollarValue(position.holdVol, contractSize, position.holdAvgPrice);

        message = `<b>${exchangeName}</b>\n`;
        message += `<b>Позиция увеличена</b>\n`;
        message += `${side} (${mode})\n\n`;
        message += `<code>${position.symbol}</code>\n`;
        message += `━━━━━━━━━━━━━━━━━━━━\n`;
        message += `<b>Добавлено:</b> ${this.formatDollarValue(addedValue)}\n`;
        message += `<b>Новый объем:</b> ${this.formatDollarValue(newTotalValue)}\n`;
        message += `<b>Средняя ТВХ:</b> ${PnLCalculator.formatPrice(position.holdAvgPrice)}`;
        break;

      case 'positionDecreased':
        const removedContracts = (position.previousHoldVol || 0) - position.holdVol;
        const removedValue = this.calculateDollarValue(removedContracts, contractSize, position.holdAvgPrice);
        const remainingValue = this.calculateDollarValue(position.holdVol, contractSize, position.holdAvgPrice);
        const partialRealizedPnl = position.realised || 0;

        message = `<b>${exchangeName}</b>\n`;
        message += `<b>Позиция уменьшена</b>\n`;
        message += `${side} (${mode})\n\n`;
        message += `<code>${position.symbol}</code>\n`;
        message += `━━━━━━━━━━━━━━━━━━━━\n`;
        message += `<b>Убрано:</b> ${this.formatDollarValue(removedValue)}\n`;
        message += `<b>Осталось:</b> ${this.formatDollarValue(remainingValue)}\n`;
        message += `<b>Средняя ТВХ:</b> ${PnLCalculator.formatPrice(position.holdAvgPrice)}`;
        if (partialRealizedPnl !== 0) {
          message += `\n<b>Реализованный PnL:</b> ${PnLCalculator.formatPnL(partialRealizedPnl)}`;
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
    message += `━━━━━━━━━━━━━━━━━━━━\n`;
    message += `<b>Лимитный ордер — ${status}</b>\n`;
    message += `${sideText}\n\n`;
    message += `<code>${order.symbol}</code>\n`;
    message += `━━━━━━━━━━━━━━━━━━━━\n`;
    message += `<b>Цена:</b> ${PnLCalculator.formatPrice(order.price)}\n`;
    message += `<b>Объем:</b> ${this.formatDollarValue(orderValue)}`;

    if (order.leverage) {
      message += `\n<b>Плечо:</b> ${order.leverage}x`;
    }

    // Показываем PNL при закрытии позиции (side 2 = закрыть шорт, side 4 = закрыть лонг)
    const isClosing = order.side === 2 || order.side === 4;
    if (isClosing && order.pnl !== undefined && order.pnl !== 0) {
      message += `\n<b>PNL:</b> ${PnLCalculator.formatPnL(order.pnl)}`;
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
    message += `━━━━━━━━━━━━━━━━━━━━\n`;
    message += `<b>Ордер — ${status}</b>\n`;
    message += `${sideText}\n\n`;
    message += `<code>${order.symbol}</code>\n`;
    message += `━━━━━━━━━━━━━━━━━━━━\n`;
    if (price > 0) {
      message += `<b>Цена:</b> ${PnLCalculator.formatPrice(price)}\n`;
    }
    message += `<b>Объем:</b> ${this.formatDollarValue(orderValue)}`;

    if (order.leverage) {
      message += `\n<b>Плечо:</b> ${order.leverage}x`;
    }

    // Показываем PNL при закрытии позиции (side 2 = закрыть шорт, side 4 = закрыть лонг)
    const isClosing = order.side === 2 || order.side === 4;
    if (isClosing && order.pnl !== undefined && order.pnl !== 0) {
      message += `\n<b>PNL:</b> ${PnLCalculator.formatPnL(order.pnl)}`;
    }

    return message;
  }

  static formatStopOrder(status, order) {
    const exchangeName = order.exchangeName || `Exchange ${order.exchangeId}`;
    const triggerSide = order.triggerSide; // 1 = TP, 2 = SL

    let typeText = 'TP/SL';
    if (triggerSide === 1) typeText = 'Тейк профит';
    else if (triggerSide === 2) typeText = 'Стоп лосс';

    let message = `<b>${exchangeName}</b>\n`;
    message += `━━━━━━━━━━━━━━━━━━━━\n`;
    message += `<b>${typeText} — ${status}</b>\n\n`;
    message += `<code>${order.symbol}</code>\n`;
    message += `━━━━━━━━━━━━━━━━━━━━\n`;

    if (order.takeProfitPrice && parseFloat(order.takeProfitPrice) > 0) {
      message += `<b>TP:</b> ${PnLCalculator.formatPrice(order.takeProfitPrice)}\n`;
    }

    if (order.stopLossPrice && parseFloat(order.stopLossPrice) > 0) {
      message += `<b>SL:</b> ${PnLCalculator.formatPrice(order.stopLossPrice)}`;
    }

    return message;
  }
}

module.exports = MessageFormatter;
