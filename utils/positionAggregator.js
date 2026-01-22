class PositionAggregator {
  /**
   * Groups positions by symbol and calculates weighted averages
   * @param {Map} positions - The allPositions Map
   * @returns {Array} Aggregated positions
   */
  static aggregateBySymbol(positions) {
    const symbolGroups = new Map();

    for (const [key, pos] of positions) {
      const symbol = pos.symbol;
      if (!symbolGroups.has(symbol)) {
        symbolGroups.set(symbol, []);
      }
      symbolGroups.get(symbol).push(pos);
    }

    const aggregated = [];

    for (const [symbol, posArray] of symbolGroups) {
      const longs = posArray.filter(p => p.positionType === 1);
      const shorts = posArray.filter(p => p.positionType === 2);

      if (longs.length > 0) {
        aggregated.push(this.calculateWeightedPosition(symbol, longs, 1));
      }
      if (shorts.length > 0) {
        aggregated.push(this.calculateWeightedPosition(symbol, shorts, 2));
      }
    }

    return aggregated.sort((a, b) => a.symbol.localeCompare(b.symbol));
  }

  static calculateWeightedPosition(symbol, positions, positionType) {
    let totalVolume = 0;
    let weightedPriceSum = 0;
    let totalValue = 0;
    let totalUnrealizedPnl = 0;
    let totalRealizedPnl = 0;
    const exchanges = [];
    const breakdown = [];

    for (const pos of positions) {
      const volume = pos.holdVol * (pos.contractSize || 1);
      totalVolume += volume;
      weightedPriceSum += pos.holdAvgPrice * volume;
      totalValue += pos.positionValue || 0;
      totalUnrealizedPnl += pos.unrealizedPnl || 0;
      totalRealizedPnl += pos.realised || 0;

      if (!exchanges.includes(pos.exchangeName)) {
        exchanges.push(pos.exchangeName);
      }

      breakdown.push({
        exchangeName: pos.exchangeName,
        exchangeId: pos.exchangeId,
        volume: pos.holdVol,
        contractSize: pos.contractSize || 1,
        entryPrice: pos.holdAvgPrice,
        currentPrice: pos.currentPrice,
        unrealizedPnl: pos.unrealizedPnl || 0,
        realizedPnl: pos.realised || 0,
        leverage: pos.leverage
      });
    }

    return {
      symbol,
      positionType,
      weightedAvgPrice: totalVolume > 0 ? weightedPriceSum / totalVolume : 0,
      totalVolume,
      totalValue,
      totalUnrealizedPnl,
      totalRealizedPnl,
      currentPrice: positions[0]?.currentPrice || 0,
      exchanges,
      exchangeBreakdown: breakdown,
      positionCount: positions.length
    };
  }

  /**
   * Get summary statistics for all positions
   * @param {Map} positions - The allPositions Map
   * @returns {Object} Summary statistics
   */
  static getSummary(positions) {
    let totalValue = 0;
    let totalUnrealizedPnl = 0;
    let totalRealizedPnl = 0;
    const exchanges = new Set();

    for (const [key, pos] of positions) {
      totalValue += pos.positionValue || 0;
      totalUnrealizedPnl += pos.unrealizedPnl || 0;
      totalRealizedPnl += pos.realised || 0;
      if (pos.exchangeName) {
        exchanges.add(pos.exchangeName);
      }
    }

    return {
      totalValue,
      totalUnrealizedPnl,
      totalRealizedPnl,
      positionCount: positions.size,
      exchanges: Array.from(exchanges)
    };
  }
}

module.exports = PositionAggregator;
