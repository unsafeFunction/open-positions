const { USDMClient } = require('binance');

class BinanceClient {
  constructor(apiKey, apiSecret) {
    this.apiKey = apiKey;
    this.apiSecret = apiSecret;
    this.client = new USDMClient({
      api_key: apiKey,
      api_secret: apiSecret,
    });
  }

  async fetchOpenPositions() {
    try {
      const positions = await this.client.getPositions();

      if (positions && Array.isArray(positions)) {
        return positions
          .filter(pos => parseFloat(pos.positionAmt) !== 0)
          .map(pos => this.normalizePosition(pos));
      }

      return [];
    } catch (error) {
      console.error('Error fetching Binance positions:', error.message);
      return [];
    }
  }

  normalizePosition(pos) {
    const size = parseFloat(pos.positionAmt || 0);
    const isLong = size > 0;
    const isIsolated = pos.marginType === 'isolated';

    return {
      symbol: pos.symbol,
      positionId: pos.symbol + '_' + (pos.positionSide || 'BOTH'),
      holdVol: Math.abs(size),
      holdAvgPrice: parseFloat(pos.entryPrice || 0),
      positionType: isLong ? 1 : 2,
      openType: isIsolated ? 1 : 2,
      leverage: parseFloat(pos.leverage || 0),
      liquidatePrice: parseFloat(pos.liquidationPrice || 0),
      realised: 0,
      unrealisedPnl: parseFloat(pos.unRealizedProfit || 0),
      state: size !== 0 ? 1 : 3,
      marginCoin: 'USDT'
    };
  }

  async fetchContractDetails(symbol) {
    try {
      // Get mark price
      const markPrice = await this.client.getMarkPrice({ symbol });
      const fairPrice = parseFloat(markPrice?.markPrice || 0);

      // For USD-M perpetuals, contract size is always 1
      const contractSize = 1;

      return { contractSize, fairPrice };
    } catch (error) {
      console.error(`Error fetching Binance contract details for ${symbol}:`, error.message);
      return { contractSize: 1, fairPrice: 0 };
    }
  }
}

module.exports = BinanceClient;
