class PnLCalculator {
  static calculateUnrealizedPnL(position, currentPrice, exchangeType = 'MEXC') {
    const { holdVol, holdAvgPrice, positionType, contractSize = 1 } = position;

    if (!currentPrice || currentPrice <= 0) return 0;

    // For MEXC: Unrealized PnL = (Current Price - Open Price) × Position Size × Contract Size
    // For SHORT positions, reverse the price difference
    // Contract Size for MEXC is the face value (e.g., 0.0001 for BTC)

    let priceDiff;
    if (positionType === 1) {
      // LONG: profit when price goes up
      priceDiff = currentPrice - holdAvgPrice;
    } else {
      // SHORT: profit when price goes down
      priceDiff = holdAvgPrice - currentPrice;
    }

    if (exchangeType === 'MEXC') {
      // For MEXC: Contract size is the face value per contract
      // If contractSize < 1 (e.g., 0.0001 for BTC), it's already the multiplier
      // If contractSize >= 1 (e.g., 10 for SENT), it's also the multiplier
      // PnL = priceDiff × holdVol × contractSize
      return priceDiff * holdVol * contractSize;
    } else {
      // For Gate.io: Contract size is multiplier
      // PnL = priceDiff × holdVol × contractSize
      return priceDiff * holdVol * contractSize;
    }
  }
  
  static calculatePositionValue(holdVol, contractSize, currentPrice, exchangeType = 'MEXC') {
    // MEXC: contractSize is the face value per contract
    // - For BTC: contractSize = 0.0001 (1 contract = 0.0001 BTC)
    // - For SENT: contractSize = 10 (1 contract = 10 SENT)
    // Position value = holdVol × contractSize × currentPrice
    //
    // Gate.io: contractSize is quanto_multiplier (typically 1 for USDT perpetuals)
    // Position value = holdVol × contractSize × currentPrice

    return holdVol * contractSize * currentPrice;
  }
  
  static formatPnL(pnl) {
    const sign = pnl >= 0 ? '+' : '';
    const absPnl = Math.abs(pnl);

    // For very small values (less than 0.01), use more decimal places
    if (absPnl < 0.01 && absPnl > 0) {
      return `${sign}$${parseFloat(pnl.toFixed(6))}`;
    }

    // Remove trailing zeros after decimal point
    return `${sign}$${parseFloat(pnl.toFixed(4))}`;
  }
  
  static formatPercentage(ratio) {
    return `${(ratio * 100).toFixed(2)}%`;
  }

  static formatPrice(price, decimals = 4) {
    if (price === null || price === undefined || price === 0) {
      return 'N/A';
    }
    return `$${parseFloat(parseFloat(price).toFixed(decimals))}`;
  }
}

module.exports = PnLCalculator;