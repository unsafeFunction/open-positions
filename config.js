module.exports = {
  api: {
    baseUrl: process.env.API_BASE_URL || 'http://localhost:5001',
    wsUrl: process.env.API_WS_URL || 'ws://localhost:5001',
    apiSecret: process.env.API_SECRET
  },
  mexc: {
    wsUrl: 'wss://contract.mexc.com/edge',
    restUrl: 'https://contract.mexc.com/api/v1'
  }
};