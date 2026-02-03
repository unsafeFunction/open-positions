const crypto = require('crypto');
const config = require('../config');

class BitgetClient {
  constructor(apiKey, apiSecret, apiPass) {
    this.apiKey = apiKey;
    this.apiSecret = apiSecret;
    this.apiPass = apiPass;
    this.restUrl = config.bitget.restUrl;
    this.productType = 'USDT-FUTURES';
  }

  generateSignature(timestamp, method, requestPath, body = '') {
    const message = timestamp + method.toUpperCase() + requestPath + body;
    return crypto.createHmac('sha256', this.apiSecret)
      .update(message)
      .digest('base64');
  }

  async request(method, path, params = null) {
    const timestamp = Date.now().toString();
    let requestPath = path;
    let body = '';

    if (method === 'GET' && params) {
      const queryString = new URLSearchParams(params).toString();
      requestPath = path + '?' + queryString;
    } else if (method === 'POST' && params) {
      body = JSON.stringify(params);
    }

    const signature = this.generateSignature(timestamp, method, requestPath, body);

    const headers = {
      'Content-Type': 'application/json',
      'ACCESS-KEY': this.apiKey,
      'ACCESS-SIGN': signature,
      'ACCESS-TIMESTAMP': timestamp,
      'ACCESS-PASSPHRASE': this.apiPass,
      'locale': 'en-US'
    };

    const url = this.restUrl + requestPath;

    try {
      const response = await fetch(url, {
        method: method,
        headers: headers,
        body: method === 'POST' ? body : undefined
      });

      const result = await response.json();

      if (result.code === '00000') {
        return result.data;
      } else {
        console.error('Bitget API error:', result.code, result.msg);
        return null;
      }
    } catch (error) {
      console.error('Bitget request error:', error.message);
      return null;
    }
  }

  async fetchOpenPositions() {
    try {
      const result = await this.request('GET', '/api/v2/mix/position/all-position', {
        productType: this.productType,
        marginCoin: 'USDT'
      });

      if (result && Array.isArray(result)) {
        return result
          .filter(pos => parseFloat(pos.total) > 0)
          .map(pos => this.normalizePosition(pos));
      }

      return [];
    } catch (error) {
      console.error('Error fetching Bitget positions:', error.message);
      return [];
    }
  }

  normalizePosition(pos) {
    const size = parseFloat(pos.total || 0);
    const isLong = pos.holdSide === 'long';
    const isIsolated = pos.marginMode === 'isolated';

    return {
      symbol: pos.symbol,
      positionId: pos.posId || pos.symbol,
      holdVol: Math.abs(size),
      holdAvgPrice: parseFloat(pos.openPriceAvg || 0),
      positionType: isLong ? 1 : 2,
      openType: isIsolated ? 1 : 2,
      leverage: parseFloat(pos.leverage || 0),
      liquidatePrice: parseFloat(pos.liquidationPrice || 0),
      realised: parseFloat(pos.achievedProfits || 0),
      unrealisedPnl: parseFloat(pos.unrealizedPL || 0),
      state: size > 0 ? 1 : 3,
      marginCoin: pos.marginCoin || 'USDT'
    };
  }

  async fetchContractDetails(symbol) {
    try {
      // Get contract info
      const contracts = await this.request('GET', '/api/v2/mix/market/contracts', {
        productType: this.productType
      });

      let contractSize = 1;
      if (contracts && Array.isArray(contracts)) {
        const contract = contracts.find(c => c.symbol === symbol);
        if (contract) {
          contractSize = parseFloat(contract.sizeMultiplier || 1);
        }
      }

      // Get ticker for price
      const ticker = await this.request('GET', '/api/v2/mix/market/ticker', {
        productType: this.productType,
        symbol: symbol
      });

      let fairPrice = 0;
      if (ticker && Array.isArray(ticker) && ticker.length > 0) {
        fairPrice = parseFloat(ticker[0].markPrice || ticker[0].lastPr || 0);
      }

      return { contractSize, fairPrice };
    } catch (error) {
      console.error(`Error fetching Bitget contract details for ${symbol}:`, error.message);
      return { contractSize: 1, fairPrice: 0 };
    }
  }
}

module.exports = BitgetClient;
