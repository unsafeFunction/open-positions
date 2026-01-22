# MEXC Position Tracker

Multi-exchange position tracker for MEXC and Gate.io with Telegram bot notifications.

## Installation

```bash
npm install
```

## Configuration

Create a `.env` file in the project root:

```env
API_BASE_URL=http://localhost:5001
API_WS_URL=ws://localhost:5001
API_SECRET=your_api_secret
```

## Development

```bash
npm start
# or
npm run dev
```

## Production Build

Build the minified production bundle:

```bash
npm run build
```

This will:
- Bundle all code into a single minified file
- Copy the `.env` file to the dist folder
- Copy node_modules dependencies
- Create executable bundle at `dist/bundle.js`

Run the production build:

```bash
npm run build:start
```

Or directly:

```bash
cd dist
node bundle.js
```

## Deployment

To deploy the production build:

1. Build the application:
   ```bash
   npm run build
   ```

2. Copy the `dist` folder to your production server

3. On the server, ensure `.env` file has correct values

4. Run:
   ```bash
   cd dist
   node bundle.js
   ```

## Scripts

- `npm start` - Start development server
- `npm run dev` - Start with NODE_ENV=development
- `npm run build` - Build production bundle
- `npm run build:start` - Run production bundle
- `npm run clean` - Remove dist folder

## Features

- Real-time position tracking (MEXC, Gate.io)
- Telegram bot notifications
- Position aggregation across exchanges
- Automatic PnL calculations
- WebSocket price updates

## License

ISC
