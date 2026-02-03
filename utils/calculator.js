class PnLCalculator {
  static calculateUnrealizedPnL(position, currentPrice) {
    const { holdVol, holdAvgPrice, positionType, contractSize = 1 } = position;

    if (!currentPrice || currentPrice <= 0) return 0;

    let priceDiff;
    if (positionType === 1) {
      priceDiff = currentPrice - holdAvgPrice;
    } else {
      priceDiff = holdAvgPrice - currentPrice;
    }

    return priceDiff * holdVol * contractSize;
  }

  static calculatePositionValue(holdVol, contractSize, currentPrice) {
    return holdVol * contractSize * currentPrice;
  }

  static formatPnL(pnl) {
    const sign = pnl >= 0 ? '+' : '';
    const absPnl = Math.abs(pnl);

    if (absPnl < 0.01 && absPnl > 0) {
      return `${sign}$${parseFloat(pnl.toFixed(6))}`;
    }
    
    return `${sign}$${parseFloat(pnl.toFixed(4))}`;
  }

  static formatPercentage(ratio) {
    return `${(ratio * 100).toFixed(2)}%`;
  }

static formatPrice(price, decimals = 4) {
  if (price === null || price === undefined || Number(price) === 0) {
    return 'N/A';
  }

  const num = Number(price);

  if (Math.abs(num) >= 1e-4) {
    return `$${num.toFixed(decimals)}`;
  }

  const [mantissa, exponent] = num.toExponential().split('e');
  const exp = Math.abs(Number(exponent));

  const digits = mantissa.replace('.', '');

  return `$0.0{${exp-1}}${digits}`;
}
}

module.exports = PnLCalculator;
