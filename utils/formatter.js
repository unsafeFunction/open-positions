const PnLCalculator = require('./calculator');

class MessageFormatter {
  static calculateDollarValue(vol, contractSize, price) {
    const v = parseFloat(vol) || 0;
    const cs = parseFloat(contractSize) || 1;
    const p = parseFloat(price) || 0;
    return v * cs * p;
  }

  static formatDollarValue(value) {
    return `$${parseFloat(value.toFixed(2))}`;
  }

  static formatPositionMessage(positionsMap) {
    if (!positionsMap || positionsMap.size === 0) {
      return '✅ No open positions';
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

    let message = '<b>📊 OPEN POSITIONS</b>\n';
    message += '═══════════════════════════\n\n';

    for (const symbol of sortedSymbols) {
      const positions = groupedBySymbol.get(symbol);

      positions.sort((a, b) => {
        const nameA = a.exchangeName || `Exchange ${a.exchangeId}`;
        const nameB = b.exchangeName || `Exchange ${b.exchangeId}`;
        return nameA.localeCompare(nameB);
      });
      message += `<b>💎 ${symbol}</b>\n`;
      message += '━━━━━━━━━━━━━━━━━━━━━━\n';

      let totalValue = 0;
      let totalUnrealizedPnL = 0;
      let totalRealizedPnL = 0;

      positions.forEach((pos, idx) => {
        const side = pos.positionType === 1 ? '🟢 LONG' : '🔴 SHORT';
        const mode = pos.openType === 1 ? 'Isolated' : 'Cross';
        const exchangeName = pos.exchangeName || `Exchange ${pos.exchangeId}`;

        const unrealizedPnl = pos.unrealizedPnl || 0;
        const realizedPnl = pos.realised || 0;
        const posValue = pos.positionValue || 0;

        totalValue += posValue;
        totalUnrealizedPnL += unrealizedPnl;
        totalRealizedPnL += realizedPnl;

        const unrealizedPnlEmoji = unrealizedPnl >= 0 ? '💚' : '❤️';
        const realizedPnlEmoji = realizedPnl >= 0 ? '💰' : '💸';

        message += `  <b>${exchangeName}</b>\n`;

        message += `  ${side} | ${mode} | ${pos.leverage}x\n`;
        message += `  💰 Size: ${this.formatDollarValue(posValue)}\n`;
        message += `  📈 Entry: ${PnLCalculator.formatPrice(pos.holdAvgPrice)}\n`;
        message += `  📊 Current: ${PnLCalculator.formatPrice(pos.currentPrice)}\n`;
        message += `  ${unrealizedPnlEmoji} Unrealized: ${PnLCalculator.formatPnL(unrealizedPnl)}\n`;
        message += `  ${realizedPnlEmoji} Realized: ${PnLCalculator.formatPnL(realizedPnl)}\n`;
        message += `  🔴 Liq: ${PnLCalculator.formatPrice(pos.liquidatePrice)}\n`;

        if (idx < positions.length - 1) {
          message += `  ─────────────────────\n`;
        }
      });

      if (positions.length > 1) {
        const totalPnL = totalUnrealizedPnL + totalRealizedPnL;
        const unrealizedEmoji = totalUnrealizedPnL >= 0 ? '💚' : '❤️';
        const realizedEmoji = totalRealizedPnL >= 0 ? '💰' : '💸';
        const totalEmoji = totalPnL >= 0 ? '💰' : '💸';

        message += '\n';
        message += `  <b>📊 ${symbol} Summary:</b>\n`;
        message += `  Total Size: ${this.formatDollarValue(totalValue)}\n`;
        message += `  ${unrealizedEmoji} Unrealized: ${PnLCalculator.formatPnL(totalUnrealizedPnL)}\n`;
        message += `  ${realizedEmoji} Realized: ${PnLCalculator.formatPnL(totalRealizedPnL)}\n`;
        message += `  ${totalEmoji} Total PnL: ${PnLCalculator.formatPnL(totalPnL)}\n`;
      }

      message += '\n';
    }

    message += `🕐 Updated: ${new Date().toLocaleTimeString()}\n`;

    return message;
  }

  static formatPositionUpdate(type, position) {
    const side = position.positionType === 1 ? 'LONG 🚀' : 'SHORT 📉';
    const exchangeName = position.exchangeName || `Exchange ${position.exchangeId}`;
    const contractSize = position.contractSize || 1;

    let message = '';

    switch(type) {
      case 'opened':
        const openValue = this.calculateDollarValue(position.holdVol, contractSize, position.holdAvgPrice);
        message = `🟢 <b>POSITION OPENED - ${exchangeName}</b>\n\n`;
        message += `<b>Symbol:</b> ${position.symbol}\n`;
        message += `<b>Side:</b> ${side}\n`;
        message += `<b>Size:</b> ${this.formatDollarValue(openValue)}\n`;
        message += `<b>Entry:</b> ${PnLCalculator.formatPrice(position.holdAvgPrice)}\n`;
        message += `<b>Leverage:</b> ${position.leverage}x\n`;
        break;

      case 'closed':
        const closedRealizedPnl = position.realised || 0;
        const closedPnlEmoji = closedRealizedPnl >= 0 ? '💚' : '❤️';
        const closedValue = this.calculateDollarValue(position.holdVol, contractSize, position.holdAvgPrice);
        const pnlPercentage = closedValue > 0
          ? ((closedRealizedPnl / closedValue) * 100).toFixed(2)
          : '0.00';

        message = `🔴 <b>POSITION CLOSED - ${exchangeName}</b>\n\n`;
        message += `<b>Symbol:</b> ${position.symbol}\n`;
        message += `<b>Side:</b> ${side}\n`;
        message += `<b>Size:</b> ${this.formatDollarValue(closedValue)}\n`;
        message += `<b>Entry:</b> ${PnLCalculator.formatPrice(position.holdAvgPrice)}\n`;
        message += `<b>Close Price:</b> ${PnLCalculator.formatPrice(position.currentPrice)}\n`;
        message += `${closedPnlEmoji} <b>Realized PnL:</b> ${PnLCalculator.formatPnL(closedRealizedPnl)} (${pnlPercentage}%)\n`;
        break;

      case 'positionIncreased':
        const addedContracts = position.holdVol - (position.previousHoldVol || 0);
        const addedValue = this.calculateDollarValue(addedContracts, contractSize, position.holdAvgPrice);
        const newTotalValue = this.calculateDollarValue(position.holdVol, contractSize, position.holdAvgPrice);

        message = `📈 <b>POSITION INCREASED - ${exchangeName}</b>\n\n`;
        message += `<b>Symbol:</b> ${position.symbol}\n`;
        message += `<b>Side:</b> ${side}\n`;
        message += `<b>Added:</b> ${this.formatDollarValue(addedValue)}\n`;
        message += `<b>New Size:</b> ${this.formatDollarValue(newTotalValue)}\n`;
        message += `<b>Avg Entry:</b> ${PnLCalculator.formatPrice(position.holdAvgPrice)}\n`;
        break;

      case 'positionDecreased':
        const removedContracts = (position.previousHoldVol || 0) - position.holdVol;
        const removedValue = this.calculateDollarValue(removedContracts, contractSize, position.holdAvgPrice);
        const remainingValue = this.calculateDollarValue(position.holdVol, contractSize, position.holdAvgPrice);
        const partialRealizedPnl = position.realised || 0;
        const partialPnlEmoji = partialRealizedPnl >= 0 ? '💚' : '❤️';

        message = `📉 <b>POSITION DECREASED - ${exchangeName}</b>\n\n`;
        message += `<b>Symbol:</b> ${position.symbol}\n`;
        message += `<b>Side:</b> ${side}\n`;
        message += `<b>Removed:</b> ${this.formatDollarValue(removedValue)}\n`;
        message += `<b>Remaining:</b> ${this.formatDollarValue(remainingValue)}\n`;
        message += `<b>Avg Entry:</b> ${PnLCalculator.formatPrice(position.holdAvgPrice)}\n`;
        if (partialRealizedPnl !== 0) {
          message += `${partialPnlEmoji} <b>Realized PnL:</b> ${PnLCalculator.formatPnL(partialRealizedPnl)}\n`;
        }
        break;

      case 'limitOrderPlaced':
        message = this.formatLimitOrder('PLACED', position);
        break;

      case 'limitOrderFilled':
        message = this.formatLimitOrder('FILLED', position);
        break;

      case 'limitOrderCancelled':
        message = this.formatLimitOrder('CANCELLED', position);
        break;

      case 'planOrderPlaced':
        message = this.formatPlanOrder('PLACED', position);
        break;

      case 'planOrderTriggered':
        message = this.formatPlanOrder('TRIGGERED', position);
        break;

      case 'planOrderCancelled':
        message = this.formatPlanOrder('CANCELLED', position);
        break;
    }

    return message;
  }

  static formatLimitOrder(status, order) {
    const exchangeName = order.exchangeName || `Exchange ${order.exchangeId}`;
    const contractSize = order.contractSize || 1;
    const orderValue = this.calculateDollarValue(order.vol, contractSize, order.price);

    let sideText = '';
    if (order.side === 1) sideText = 'OPEN LONG 🟢';
    else if (order.side === 2) sideText = 'CLOSE SHORT 🟢';
    else if (order.side === 3) sideText = 'OPEN SHORT 🔴';
    else if (order.side === 4) sideText = 'CLOSE LONG 🔴';

    let emoji = '';
    let title = '';
    if (status === 'PLACED') {
      emoji = '📝';
      title = 'LIMIT ORDER PLACED';
    } else if (status === 'FILLED') {
      emoji = '✅';
      title = 'LIMIT ORDER FILLED';
    } else if (status === 'CANCELLED') {
      emoji = '❌';
      title = 'LIMIT ORDER CANCELLED';
    }

    let message = `${emoji} <b>${title} - ${exchangeName}</b>\n\n`;
    message += `<b>Symbol:</b> ${order.symbol}\n`;
    message += `<b>Side:</b> ${sideText}\n`;
    message += `<b>Size:</b> ${this.formatDollarValue(orderValue)}\n`;
    message += `<b>Price:</b> ${PnLCalculator.formatPrice(order.price)}\n`;

    if (order.leverage) {
      message += `<b>Leverage:</b> ${order.leverage}x\n`;
    }

    return message;
  }

  static formatPlanOrder(status, order) {
    const exchangeName = order.exchangeName || `Exchange ${order.exchangeId}`;
    const contractSize = order.contractSize || 1;
    const orderValue = this.calculateDollarValue(order.vol, contractSize, order.price);

    let sideText = '';
    if (order.side === 1) sideText = 'OPEN LONG 🟢';
    else if (order.side === 2) sideText = 'CLOSE SHORT 🟢';
    else if (order.side === 3) sideText = 'OPEN SHORT 🔴';
    else if (order.side === 4) sideText = 'CLOSE LONG 🔴';

    let triggerTypeText = '';
    if (order.triggerType === 1) triggerTypeText = 'Fair Price';
    else if (order.triggerType === 2) triggerTypeText = 'Index Price';
    else if (order.triggerType === 3) triggerTypeText = 'Last Price';

    let trendText = order.trend === 1 ? '📈 rises to' : '📉 falls to';

    let emoji = '';
    let title = '';
    if (status === 'PLACED') {
      emoji = '🎯';
      title = 'TRIGGER ORDER PLACED';
    } else if (status === 'TRIGGERED') {
      emoji = '✅';
      title = 'TRIGGER ORDER EXECUTED';
    } else if (status === 'CANCELLED') {
      emoji = '❌';
      title = 'TRIGGER ORDER CANCELLED';
    }

    let message = `${emoji} <b>${title} - ${exchangeName}</b>\n\n`;
    message += `<b>Symbol:</b> ${order.symbol}\n`;
    message += `<b>Side:</b> ${sideText}\n`;
    message += `<b>Size:</b> ${this.formatDollarValue(orderValue)}\n`;
    message += `<b>Trigger:</b> ${trendText} ${PnLCalculator.formatPrice(order.triggerPrice)} (${triggerTypeText})\n`;
    message += `<b>Order Price:</b> ${PnLCalculator.formatPrice(order.price)}\n`;

    if (order.leverage) {
      message += `<b>Leverage:</b> ${order.leverage}x\n`;
    }

    if (order.stopLossPrice && order.stopLossPrice > 0) {
      message += `<b>Stop Loss:</b> ${PnLCalculator.formatPrice(order.stopLossPrice)}\n`;
    }

    if (order.takeProfitPrice && order.takeProfitPrice > 0) {
      message += `<b>Take Profit:</b> ${PnLCalculator.formatPrice(order.takeProfitPrice)}\n`;
    }

    return message;
  }
}

module.exports = MessageFormatter;
