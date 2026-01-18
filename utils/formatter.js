const PnLCalculator = require('./calculator');

class MessageFormatter {
  // Create format grouped by symbol across all exchanges
  static formatPositionMessage(positionsMap) {
    if (!positionsMap || positionsMap.size === 0) {
      return '✅ No open positions';
    }

    // Group positions by symbol
    const groupedBySymbol = new Map();

    for (const [key, position] of positionsMap) {
      const symbol = position.symbol;
      if (!groupedBySymbol.has(symbol)) {
        groupedBySymbol.set(symbol, []);
      }
      groupedBySymbol.get(symbol).push(position);
    }

    let message = '<b>📊 OPEN POSITIONS</b>\n';
    message += '═══════════════════════════\n\n';

    for (const [symbol, positions] of groupedBySymbol) {
      message += `<b>💎 ${symbol}</b>\n`;
      message += '━━━━━━━━━━━━━━━━━━━━━━\n';

      // Calculate totals for summary
      let totalSize = 0;
      let totalValue = 0;
      let weightedEntrySum = 0;
      let totalUnrealizedPnL = 0;
      let totalRealizedPnL = 0;

      positions.forEach((pos, idx) => {
        const side = pos.positionType === 1 ? '🟢 LONG' : '🔴 SHORT';
        const mode = pos.openType === 1 ? 'Isolated' : 'Cross';
        const exchangeName = pos.exchangeName || `Exchange ${pos.exchangeId}`;

        const unrealizedPnl = pos.unrealizedPnl || 0;
        const realizedPnl = pos.realised || 0;
        const totalPnl = unrealizedPnl + realizedPnl;
        const posValue = pos.positionValue || 0;
        const size = parseFloat(pos.holdVol) || 0;
        const entry = parseFloat(pos.holdAvgPrice) || 0;

        // Accumulate for summary
        totalSize += size;
        totalValue += posValue;
        weightedEntrySum += entry * size;
        totalUnrealizedPnL += unrealizedPnl;
        totalRealizedPnL += realizedPnl;

        const pnlEmoji = totalPnl >= 0 ? '💚' : '❤️';

        if (positions.length > 1) {
          message += `  <b>${exchangeName}</b>\n`;
        }

        message += `  ${side} | ${mode} | ${pos.leverage}x\n`;
        message += `  💰 Size: ${pos.holdVol} contracts\n`;
        message += `  💵 Value: $${posValue.toFixed(2)}\n`;
        message += `  📈 Entry: $${pos.holdAvgPrice}\n`;
        message += `  📊 Current: $${pos.currentPrice || 'N/A'}\n`;
        message += `  ${pnlEmoji} PnL: ${PnLCalculator.formatPnL(totalPnl)}\n`;
        message += `  🔴 Liq: $${pos.liquidatePrice || 'N/A'}\n`;

        if (idx < positions.length - 1) {
          message += `  ─────────────────────\n`;
        }
      });

      // Add summary for this symbol if there are multiple positions
      if (positions.length > 1) {
        const avgEntry = totalSize > 0 ? (weightedEntrySum / totalSize) : 0;
        const totalPnL = totalUnrealizedPnL + totalRealizedPnL;
        const summaryEmoji = totalPnL >= 0 ? '💰' : '💸';

        message += '\n';
        message += `  <b>📊 ${symbol} Summary:</b>\n`;
        message += `  Total Size: ${totalSize} contracts\n`;
        message += `  Total Value: $${totalValue.toFixed(2)}\n`;
        message += `  Avg Entry: $${avgEntry.toFixed(4)}\n`;
        message += `  ${summaryEmoji} Total PnL: ${PnLCalculator.formatPnL(totalPnL)}\n`;
      }

      message += '\n';
    }

    message += `🕐 Updated: ${new Date().toLocaleTimeString()}\n`;

    return message;
  }

  static formatPositionUpdate(type, position) {
    const side = position.positionType === 1 ? 'LONG 🚀' : 'SHORT 📉';
    const exchangeName = position.exchangeName || `Exchange ${position.exchangeId}`;

    let message = '';

    switch(type) {
      case 'opened':
        message = `🟢 <b>POSITION OPENED</b>\n\n`;
        message += `<b>Exchange:</b> ${exchangeName}\n`;
        message += `<b>Symbol:</b> ${position.symbol}\n`;
        message += `<b>Side:</b> ${side}\n`;
        message += `<b>Size:</b> ${position.holdVol} contracts\n`;
        message += `<b>Entry:</b> $${position.holdAvgPrice}\n`;
        message += `<b>Leverage:</b> ${position.leverage}x\n`;
        break;

      case 'closed':
        const realizedPnl = position.realised || 0;
        const pnlEmoji = realizedPnl >= 0 ? '💚' : '❤️';
        message = `🔴 <b>POSITION CLOSED</b>\n\n`;
        message += `<b>Exchange:</b> ${exchangeName}\n`;
        message += `<b>Symbol:</b> ${position.symbol}\n`;
        message += `<b>Side:</b> ${side}\n`;
        message += `<b>Size:</b> ${position.holdVol} contracts\n`;
        message += `<b>Entry:</b> $${position.holdAvgPrice}\n`;
        message += `${pnlEmoji} <b>Realized PnL:</b> ${PnLCalculator.formatPnL(realizedPnl)}\n`;
        break;

      case 'modified':
        message = `🔄 <b>POSITION MODIFIED</b>\n\n`;
        message += `<b>Exchange:</b> ${exchangeName}\n`;
        message += `<b>Symbol:</b> ${position.symbol}\n`;
        message += `<b>Side:</b> ${side}\n`;
        message += `<b>New Size:</b> ${position.holdVol} contracts\n`;
        break;
    }

    return message;
  }
}

module.exports = MessageFormatter;
