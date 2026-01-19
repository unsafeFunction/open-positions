const crypto = require('crypto');
const config = require('../config');

class GateClient {
  constructor(apiKey, apiSecret) {
    this.apiKey = apiKey;
    this.apiSecret = apiSecret;
    this.restUrl = config.gate.restUrl;
    this.settle = 'usdt'; // Default to USDT perpetual
  }

  generateSignature(method, path, queryString, bodyPayload, timestamp) {
    const hashedPayload = crypto.createHash('sha512').update(bodyPayload || '').digest('hex');
    const signString = `${method}\n${path}\n${queryString}\n${hashedPayload}\n${timestamp}`;
    return crypto.createHmac('sha512', this.apiSecret).update(signString).digest('hex');
  }

  async fetchOpenPositions() {
    const timestamp = Math.floor(Date.now() / 1000).toString();
    const method = 'GET';
    const path = `/api/v4/futures/${this.settle}/positions`;
    const queryString = '';

    const signature = this.generateSignature(method, path, queryString, '', timestamp);

    const url = `${this.restUrl}${path}`;

    try {
      const response = await fetch(url, {
        method: method,
        headers: {
          'Content-Type': 'application/json',
          'KEY': this.apiKey,
          'Timestamp': timestamp,
          'SIGN': signature
        }
      });

      const result = await response.json();

      if (Array.isArray(result)) {
        // Filter only open positions (size > 0)
        return result.filter(pos => Math.abs(parseFloat(pos.size)) > 0).map(pos => {
          // Gate.io margin type: cross_leverage_limit = 0 means isolated, > 0 means cross
          const crossLeverageLimit = parseFloat(pos.cross_leverage_limit || 0);
          const isIsolated = crossLeverageLimit === 0;

          // Get actual leverage
          // For cross margin: use cross_leverage_limit
          // For isolated: use leverage field
          let actualLeverage;
          if (!isIsolated && crossLeverageLimit > 0) {
            actualLeverage = crossLeverageLimit;
          } else {
            actualLeverage = parseFloat(pos.leverage || 0);
          }

          return {
            symbol: pos.contract,
            positionId: pos.contract,
            holdVol: Math.abs(parseFloat(pos.size)),
            holdAvgPrice: parseFloat(pos.entry_price),
            positionType: parseFloat(pos.size) > 0 ? 1 : 2,
            openType: isIsolated ? 1 : 2,
            leverage: actualLeverage,
            liquidatePrice: parseFloat(pos.liq_price),
            realised: parseFloat(pos.realised_pnl || 0),
            unrealisedPnl: parseFloat(pos.unrealised_pnl || 0),
            state: 1
          };
        });
      }

      return [];
    } catch (error) {
      console.error('Error fetching Gate positions:', error.message);
      return [];
    }
  }

  async fetchContractDetails(symbol) {
    try {
      const url = `${this.restUrl}/api/v4/futures/${this.settle}/contracts/${symbol}`;

      const response = await fetch(url);
      const result = await response.json();

      if (result && result.name) {
        return {
          contractSize: parseFloat(result.quanto_multiplier || 1),
          fairPrice: parseFloat(result.mark_price || result.last_price || 0)
        };
      }
      return { contractSize: 1, fairPrice: 0 };
    } catch (error) {
      console.error(`Error fetching contract details for ${symbol}:`, error.message);
      return { contractSize: 1, fairPrice: 0 };
    }
  }
}

module.exports = GateClient;
