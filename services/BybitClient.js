const { RestClientV5 } = require('bybit-api');

class BybitClient {
  constructor(apiKey, apiSecret) {
    this.apiKey = apiKey;
    this.apiSecret = apiSecret;
    this.client = new RestClientV5({
      key: apiKey,
      secret: apiSecret,
    });
  }

  async fetchOpenPositions() {
    try {
      const response = await this.client.getPositionInfo({
        category: 'linear',
        settleCoin: 'USDT',
      });

      if (response.retCode === 0 && response.result?.list) {
        return response.result.list
          .filter(pos => parseFloat(pos.size) !== 0)
          .map(pos => this.normalizePosition(pos));
      }

      return [];
    } catch (error) {
      console.error('Error fetching Bybit positions:', error.message);
      return [];
    }
  }

  normalizePosition(pos) {
    const size = parseFloat(pos.size || 0);
    const positionIdx = Number(pos.positionIdx ?? 0);
    const side = (pos.side || '').toLowerCase();
    const isLong = positionIdx === 1 || (positionIdx !== 2 && side !== 'sell');
    const isIsolated = parseInt(pos.tradeMode) === 1;

    // Bybit API provides ready values in USDT
    const positionValue = parseFloat(pos.positionValue || 0);
    const markPrice = parseFloat(pos.markPrice || 0);

    return {
      symbol: pos.symbol,
      positionId: `${pos.symbol}_${positionIdx}`,
      holdVol: Math.abs(size),
      holdAvgPrice: parseFloat(pos.avgPrice || 0),
      positionType: isLong ? 1 : 2,
      openType: isIsolated ? 1 : 2,
      leverage: parseFloat(pos.leverage || 0),
      liquidatePrice: parseFloat(pos.liqPrice || 0),
      realised: parseFloat(pos.cumRealisedPnl || 0),
      unrealisedPnl: parseFloat(pos.unrealisedPnl || 0),
      positionValue: positionValue,
      currentPrice: markPrice,
      state: size !== 0 ? 1 : 3,
      marginCoin: 'USDT'
    };
  }

  async fetchContractDetails(symbol) {
    try {
      const response = await this.client.getTickers({
        category: 'linear',
        symbol: symbol,
      });

      if (response.retCode === 0 && response.result?.list?.[0]) {
        const ticker = response.result.list[0];
        const fairPrice = parseFloat(ticker.markPrice || 0);
        const contractSize = 1;

        return { contractSize, fairPrice };
      }

      return { contractSize: 1, fairPrice: 0 };
    } catch (error) {
      console.error(`Error fetching Bybit contract details for ${symbol}:`, error.message);
      return { contractSize: 1, fairPrice: 0 };
    }
  }
}

module.exports = BybitClient;
