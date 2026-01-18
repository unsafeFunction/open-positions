class PnLCalculator {
  static calculateUnrealizedPnL(position, currentPrice) {
    const { holdVol, holdAvgPrice, positionType, contractSize = 1 } = position;
    
    if (!currentPrice || currentPrice <= 0) return 0;
    
    if (positionType === 1) {
      return (currentPrice - holdAvgPrice) * holdVol * contractSize;
    } else {
      return (holdAvgPrice - currentPrice) * holdVol * contractSize;
    }
  }
  
  static calculatePositionValue(holdVol, contractSize, currentPrice) {
    return holdVol * contractSize * currentPrice;
  }
  
  static formatPnL(pnl) {
    const sign = pnl >= 0 ? '+' : '';
    return `${sign}$${pnl.toFixed(4)}`;
  }
  
  static formatPercentage(ratio) {
    return `${(ratio * 100).toFixed(2)}%`;
  }
}

module.exports = PnLCalculator;