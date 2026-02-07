const crypto = require('crypto');
const config = require('../config');

class BingXClient {
  constructor(apiKey, apiSecret) {
    this.apiKey = apiKey;
    this.apiSecret = apiSecret;
    this.restUrl = config.bingx.restUrl;
  }

  generateSignature(queryString) {
    return crypto.createHmac('sha256', this.apiSecret)
      .update(queryString)
      .digest('hex');
  }

  async request(method, path, params = {}) {
    const timestamp = Date.now().toString();
    params.timestamp = timestamp;

    // Sort params and build query string
    const sortedKeys = Object.keys(params).sort();
    const queryString = sortedKeys.map(k => `${k}=${params[k]}`).join('&');
    const signature = this.generateSignature(queryString);
    const fullQuery = `${queryString}&signature=${signature}`;

    const url = method === 'GET'
      ? `${this.restUrl}${path}?${fullQuery}`
      : `${this.restUrl}${path}?${fullQuery}`;

    try {
      const options = {
        method,
        headers: {
          'X-BX-APIKEY': this.apiKey,
          'Content-Type': 'application/json'
        }
      };

      const response = await fetch(url, options);
      const result = await response.json();

      if (result.code === 0) {
        return result.data;
      }
      // Some endpoints (listenKey) return data directly without code/data wrapper
      if (result.code === undefined && !result.msg) {
        return result;
      }
      console.error('BingX API error:', result.code, result.msg);
      return null;
    } catch (error) {
      console.error('BingX request error:', error.message);
      return null;
    }
  }

  async fetchOpenPositions() {
    try {
      const result = await this.request('GET', '/openApi/swap/v2/user/positions');

      if (result && Array.isArray(result)) {
        return result
          .filter(pos => parseFloat(pos.positionAmt) !== 0)
          .map(pos => this.normalizePosition(pos));
      }

      return [];
    } catch (error) {
      console.error('Error fetching BingX positions:', error.message);
      return [];
    }
  }

  normalizePosition(pos) {
    const size = parseFloat(pos.positionAmt || 0);
    const isLong = pos.positionSide === 'LONG' || size > 0;
    const isIsolated = pos.marginType === 'ISOLATED' || pos.isolated === true;

    return {
      symbol: pos.symbol,
      positionId: `${pos.symbol}_${pos.positionSide || (isLong ? 'LONG' : 'SHORT')}`,
      holdVol: Math.abs(size),
      holdAvgPrice: parseFloat(pos.avgPrice || pos.entryPrice || 0),
      positionType: isLong ? 1 : 2,
      openType: isIsolated ? 1 : 2,
      leverage: parseFloat(pos.leverage || 0),
      liquidatePrice: parseFloat(pos.liquidationPrice || 0),
      realised: parseFloat(pos.realisedProfit || 0),
      unrealisedPnl: parseFloat(pos.unrealizedProfit || 0),
      currentPrice: parseFloat(pos.markPrice || 0),
      state: 1
    };
  }

  async fetchContractDetails(symbol) {
    try {
      // Get contract info
      const contracts = await this.request('GET', '/openApi/swap/v2/quote/contracts');

      let contractSize = 1;
      if (contracts && Array.isArray(contracts)) {
        const contract = contracts.find(c => c.symbol === symbol);
        if (contract) {
          contractSize = parseFloat(contract.size || 1);
        }
      }

      // Get ticker for price
      const ticker = await this.request('GET', '/openApi/swap/v2/quote/ticker', { symbol });

      let fairPrice = 0;
      if (ticker) {
        // ticker can be object or array
        const t = Array.isArray(ticker) ? ticker[0] : ticker;
        if (t) {
          fairPrice = parseFloat(t.lastPrice || t.markPrice || 0);
        }
      }

      return { contractSize, fairPrice };
    } catch (error) {
      console.error(`Error fetching BingX contract details for ${symbol}:`, error.message);
      return { contractSize: 1, fairPrice: 0 };
    }
  }

  async generateListenKey() {
    try {
      const result = await this.request('POST', '/openApi/user/auth/userDataStream');
      if (result && result.listenKey) {
        return result.listenKey;
      }
      // Some responses return listenKey directly
      if (typeof result === 'string') {
        return result;
      }
      return null;
    } catch (error) {
      console.error('Error generating BingX listenKey:', error.message);
      return null;
    }
  }

  async extendListenKey(listenKey) {
    try {
      await this.request('PUT', '/openApi/user/auth/userDataStream', { listenKey });
    } catch (error) {
      console.error('Error extending BingX listenKey:', error.message);
    }
  }

  async deleteListenKey(listenKey) {
    try {
      await this.request('DELETE', '/openApi/user/auth/userDataStream', { listenKey });
    } catch (error) {
      console.error('Error deleting BingX listenKey:', error.message);
    }
  }
}

module.exports = BingXClient;
