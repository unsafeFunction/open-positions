const crypto = require('crypto');
const config = require('../config');

class MexcClient {
  constructor(apiKey, apiSecret) {
    this.apiKey = apiKey;
    this.apiSecret = apiSecret;
    this.restUrl = config.mexc.restUrl;
  }
  
  generateSignature(reqTime) {
    const signString = this.apiKey + reqTime;
    return crypto.createHmac('sha256', this.apiSecret)
    .update(signString)
    .digest('hex');
  }
  
  async fetchOpenPositions() {
    const timestamp = Date.now().toString();
    const signature = this.generateSignature(timestamp);
    
    const url = `${this.restUrl}/private/position/open_positions`;
    
    try {
      const response = await fetch(url, {
        method: 'GET',
        headers: {
          'Content-Type': 'application/json',
          'ApiKey': this.apiKey,
          'Request-Time': timestamp,
          'Signature': signature
        }
      });
      
      const result = await response.json();
      
      if (result.success && result.data) {
        return result.data;
      }
      
      return [];
    } catch (error) {
      console.error('Error fetching positions:', error.message);
      return [];
    }
  }
  
  async fetchContractDetails(symbol) {
    try {
      const [contractResponse, tickerResponse] = await Promise.all([
        fetch(`${this.restUrl}/contract/detail?symbol=${symbol}`),
        fetch(`${this.restUrl}/contract/ticker?symbol=${symbol}`)
      ]);

      const contractResult = await contractResponse.json();
      const tickerResult = await tickerResponse.json();

      let contractSize = 1;
      let fairPrice = 0;

      if (contractResult.success && contractResult.data) {
        contractSize = parseFloat(contractResult.data.contractSize || 1);
      }

      if (tickerResult.success && tickerResult.data) {
        fairPrice = parseFloat(
          tickerResult.data.fairPrice ||
          tickerResult.data.lastPrice ||
          tickerResult.data.indexPrice ||
          0
        );
      }

      return { contractSize, fairPrice };
    } catch (error) {
      console.error(`Error fetching MEXC contract details for ${symbol}:`, error.message);
      return { contractSize: 1, fairPrice: 0 };
    }
  }
}

module.exports = MexcClient;