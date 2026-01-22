const express = require('express');
const { WebSocketServer } = require('ws');
const http = require('http');
const config = require('../config');

class WebServer {
  constructor(positionTracker) {
    this.positionTracker = positionTracker;
    this.app = express();
    this.server = http.createServer(this.app);
    this.wss = null;
    this.clients = new Set();
    this.port = config.webapp?.port || 3002;
    this.host = config.webapp?.host || '0.0.0.0';
    this.corsOrigins = config.webapp?.corsOrigins || ['http://localhost:3000'];

    this.setupMiddleware();
    this.setupRoutes();
    this.setupWebSocket();
    this.setupPositionUpdates();
  }

  setupMiddleware() {
    this.app.use(express.json());

    // CORS middleware
    this.app.use((req, res, next) => {
      const origin = req.headers.origin;

      // Allow configured origins or all if '*' is in the list
      if (this.corsOrigins.includes('*') || this.corsOrigins.includes(origin)) {
        res.header('Access-Control-Allow-Origin', origin || '*');
      }

      res.header('Access-Control-Allow-Methods', 'GET, OPTIONS');
      res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept');

      if (req.method === 'OPTIONS') {
        return res.sendStatus(200);
      }
      next();
    });
  }

  setupRoutes() {
    this.app.get('/api/positions', (req, res) => {
      try {
        const data = this.positionTracker.getPositionsForApi();
        res.json({ success: true, data, timestamp: Date.now() });
      } catch (error) {
        console.error('Error fetching positions:', error);
        res.status(500).json({ success: false, error: 'Failed to fetch positions' });
      }
    });

    this.app.get('/api/positions/exchange/:name', (req, res) => {
      try {
        const exchangeName = decodeURIComponent(req.params.name);
        const positions = this.positionTracker.getPositionsByExchange(exchangeName);
        res.json({ success: true, data: { positions }, timestamp: Date.now() });
      } catch (error) {
        console.error('Error fetching positions by exchange:', error);
        res.status(500).json({ success: false, error: 'Failed to fetch positions' });
      }
    });

    this.app.get('/api/positions/combined', (req, res) => {
      try {
        const positions = this.positionTracker.getCombinedPositions();
        res.json({ success: true, data: { positions }, timestamp: Date.now() });
      } catch (error) {
        console.error('Error fetching combined positions:', error);
        res.status(500).json({ success: false, error: 'Failed to fetch combined positions' });
      }
    });

    this.app.get('/health', (req, res) => {
      res.json({ status: 'ok', timestamp: Date.now() });
    });
  }

  setupWebSocket() {
    this.wss = new WebSocketServer({ server: this.server, path: '/ws' });

    this.wss.on('connection', (ws) => {
      console.log('WebSocket client connected');
      this.clients.add(ws);

      const data = this.positionTracker.getPositionsForApi();
      ws.send(JSON.stringify({ type: 'positions', data, timestamp: Date.now() }));

      ws.on('close', () => {
        console.log('WebSocket client disconnected');
        this.clients.delete(ws);
      });

      ws.on('error', (error) => {
        console.error('WebSocket error:', error);
        this.clients.delete(ws);
      });
    });
  }

  setupPositionUpdates() {
    this.positionTracker.on('positionsUpdated', (data) => {
      this.broadcast({ type: 'positions', data, timestamp: Date.now() });
    });
  }

  broadcast(message) {
    const messageStr = JSON.stringify(message);
    for (const client of this.clients) {
      if (client.readyState === 1) {
        client.send(messageStr);
      }
    }
  }

  start() {
    this.server.listen(this.port, this.host, () => {
      console.log(`API Server running on http://${this.host}:${this.port}`);
      console.log(`WebSocket available at ws://${this.host}:${this.port}/ws`);
      console.log(`CORS origins: ${this.corsOrigins.join(', ')}`);
    });
  }

  stop() {
    this.wss.close();
    this.server.close();
  }
}

module.exports = WebServer;
