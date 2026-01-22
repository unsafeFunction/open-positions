const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '.env') })

const PositionTracker = require('./services/PositionTracker');
const WebServer = require('./services/WebServer');

const tracker = new PositionTracker();
const webServer = new WebServer(tracker);

async function start() {
  await tracker.start();
  webServer.start();
}

start();

process.on('SIGINT', () => {
  console.log('\nShutting down...');
  tracker.stop();
  webServer.stop();
  process.exit(0);
});