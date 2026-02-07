module.exports = {
  api: {
    baseUrl: process.env.API_BASE_URL || 'http://localhost:5001',
    wsUrl: process.env.API_WS_URL || 'ws://localhost:5001',
    apiSecret: process.env.API_SECRET
  },
  mexc: {
    wsUrl: 'wss://contract.mexc.com/edge',
    restUrl: 'https://contract.mexc.com/api/v1'
  },
  gate: {
    wsUrl: 'wss://fx-ws.gateio.ws/v4/ws/usdt',
    restUrl: 'https://api.gateio.ws'
  },
  bitget: {
    restUrl: 'https://api.bitget.com'
  },
  binance: {
    restUrl: 'https://fapi.binance.com'
  },
  bybit: {
    restUrl: 'https://api.bybit.com'
  },
  bingx: {
    restUrl: 'https://open-api.bingx.com',
    wsUrl: 'wss://open-api-swap.bingx.com/swap-market'
  },
  webapp: {
    port: parseInt(process.env.PORT || process.env.WEBAPP_PORT) || 3002,
    host: process.env.WEBAPP_HOST || '0.0.0.0',
    url: process.env.WEBAPP_URL,
    corsOrigins: process.env.WEBAPP_CORS_ORIGINS?.split(',') || [
      'http://localhost:3000',
      'http://localhost:3002',
      'http://localhost:3003',
    ]
  }
};