require('dotenv').config()

const PositionTracker = require('./services/PositionTracker');

const tracker = new PositionTracker();
tracker.start();

process.on('SIGINT', () => {
  console.log('\n👋 Shutting down...');
  tracker.stop();
  process.exit(0);
});