# Spot-Bot-2: ZigZag Auto-Trading Bot for Bitcoin

A sophisticated automated cryptocurrency trading bot that detects pivot points (local highs and lows) using the **ZigZag algorithm** and executes buy/sell trades on Binance Spot market with real-time streaming data.

## Features

🎯 **ZigZag Pivot Detection**
- Sticky pivot confirmation (never repaints)
- Cold-start state machine for initial direction detection
- Configurable deviation thresholds and bar requirements
- Works on multiple timeframes (1m, 1h)

📊 **Real-Time Market Data**
- WebSocket streaming from Binance (1s, 1m, 1h candles)
- 200-candle rolling chart buffer per timeframe
- 24-hour rolling quote-volume window for liquidity-aware order sizing
- Live price updates for accurate execution

💰 **Intelligent Order Management**
- Liquidity-based position sizing (respects 24h volume)
- Automated buy on MIN pivot confirmation
- Automated sell on MAX pivot confirmation
- Fee accounting (0.1% per side)
- Balance and profit tracking

🧪 **Backtesting Engine**
- Historical CSV replay without code changes
- All-in compounding sizing for parameter testing
- Accurate slippage calculation (pivot vs execution price)
- Max drawdown tracking
- Markdown report generation with pivot history

## How It Works

### Architecture

The system uses an **Observer/Manager pattern**:

```
BotManager (Orchestrator)
├── ObserverManager (Multi-symbol coordinator)
│   └── Observer × N (One per symbol: BTCUSDT, etc.)
├── OrderManager (Account & trade state)
└── BinanceWebSocket (Live data stream)
```

### Trading Flow

1. **Historical Preload**: Observer loads 200 × 1m + 200 × 1h candles, replays ZigZag state
2. **Live Streaming**: WebSocket feeds 1s, 1m, 1h candles as they close
3. **ZigZag Detection**: Observer advances state machine, detects pivot confirmations
4. **Signal Emission**: Pivot confirmation fires event to OrderManager
5. **Order Execution**: Buy/sell at current market price (not stale pivot price)
6. **Performance Tracking**: Windows computed hourly (h24, h12, h6, h3, h1)

### ZigZag State Machine

**Cold-start** (first pivots):
- Tracks two candidates (high and low) simultaneously
- Confirms direction when deviation ≥ 1% + ≥ 20 bars have passed
- Deterministic, never repaints

**Normal Operation** (after cold-start):
- Tracks `extremePrice` and `barsSinceExtreme`
- Confirms next pivot when price retraces ≥ 1% and ≥ 20 bars elapsed
- Last pivot is sticky: once confirmed, object reference never changes

## Installation

### Prerequisites
- Node.js 18+ and npm
- A Binance account with API keys (for live trading)
- CSV historical candle data (for backtesting)

### Setup

```bash
# Clone and install
git clone <repo-url>
cd spot-bot-2
npm install

# Backend
cd backend
npm install

# Frontend (optional)
cd ../frontend
npm install
```

### Environment

Create `.env` in `backend/`:
```env
BINANCE_API_KEY=your_api_key
BINANCE_API_SECRET=your_api_secret
PORT=3000
```

## Usage

### Live Trading

```bash
cd backend
npm start
```

Starts:
- Historical data preload (1m, 1h for all symbols)
- WebSocket connection to Binance
- API server on `http://localhost:3000`
- Auto-trading executions on BTCUSDT pivot confirmations

### Backtesting

```bash
npm run emulate
```

Generates a detailed Markdown report with:
- Configuration (ZigZag parameters, period)
- Summary (returns, win rate, max drawdown, avg trade duration)
- Trades table (pivot prices, execution prices, slippage %)
- **Detected Pivots** (all pivots with timestamps and prices)

Example output: `results/emulation-2026-07-21T03-25-28-619Z.md`

### Testing

```bash
npm test
```

Runs unit tests for:
- Observer state machine and buffers
- Order sizing and execution
- Indicator calculations (MA, Bollinger Bands)
- ZigZag pivot detection
- CSV candle parsing
- Report formatting

## Configuration

### ZigZag Parameters

Edit `backend/src/managers/BotManager.ts`:

```typescript
const ZIGZAG_ENABLED_SYMBOLS = new Set(['BTCUSDT']);
```

Or pass custom config to EmulatorEngine:

```typescript
{
  deviationPct: 1,           // % retracement needed
  minBarsBetweenPivots: 20,  // minimum bars since extremum
  priceSource: 'close'       // 'close' or 'highLow'
}
```

### Order Sizing

Live: `{ factor: 0.0001, maxUsdt: 10_000 }` → max $10k per trade
Emulator: `{ factor: MAX_SAFE_INTEGER, maxUsdt: Infinity }` → all-in compounding

Edit `backend/src/managers/OrderManager.ts`:

```typescript
const DEFAULT_ORDER_SIZE_CONFIG = { factor: 0.0001, maxUsdt: 10_000 };
```

## API Endpoints

### WebSocket Events

```typescript
observerManager.on('pivot', (event) => {
  // { symbol, type: 'min'|'max', price, barsSinceExtreme }
});

observerManager.on('signal', (state) => {
  // { symbol, performance, zigzag }
});

observerManager.on('chart:tick', (event) => {
  // { symbol, m1: { candle, series }, h1: { ... } }
});

observerManager.on('chart:closed', (event) => {
  // { symbol, timeframe, candle, series }
});
```

### REST API

- `GET /api/status` — Current balance, active orders, performance
- `GET /api/chart/:symbol/:timeframe` — Latest 100 candles + indicators
- `GET /api/pivots/:symbol` — Observer state (ZigZag, performance)

## Project Structure

```
spot-bot-2/
├── backend/
│   └── src/
│       ├── observers/
│       │   ├── Observer.ts           # Market data + ZigZag per symbol
│       │   └── Observer.test.ts
│       ├── managers/
│       │   ├── ObserverManager.ts    # Multi-symbol, event emitter
│       │   ├── OrderManager.ts       # Trading account state
│       │   ├── BotManager.ts         # Orchestration & startup
│       │   └── *.test.ts
│       ├── emulator/
│       │   ├── EmulatorEngine.ts     # Backtesting core
│       │   ├── csvCandleSource.ts    # CSV parsing
│       │   ├── reportWriter.ts       # Markdown reports
│       │   └── run.ts                # CLI entry
│       ├── services/
│       │   ├── binanceWebSocket.ts   # Live data stream
│       │   ├── historicalCandles.ts  # REST API fetching
│       │   └── socketServer.ts       # WebSocket broadcast
│       ├── utils/
│       │   ├── zigzag.ts             # ZigZag state machine
│       │   ├── indicators.ts         # MA, Bollinger Bands
│       │   ├── orderSize.ts          # Position sizing formula
│       │   ├── Queue.ts              # FIFO buffer
│       │   └── *.test.ts
│       ├── types/
│       │   └── index.ts              # TypeScript interfaces
│       ├── routes/
│       │   └── api.ts                # REST endpoints
│       └── index.ts                  # Entry point
├── frontend/
│   └── src/
│       ├── components/
│       │   ├── ChartGrid.tsx         # Symbol chart grid
│       │   └── *.tsx
│       └── main.tsx
├── docs/
│   ├── superpowers/
│   │   └── specs/                    # Design documents
│   └── README.md
├── ARCHITECTURE.md                   # Deep technical guide
├── README.md                          # This file
└── package.json
```

## Key Concepts

### Observer State
```typescript
{
  symbol: string
  performance: {
    h24: number | null,   // % change
    h12: number | null,
    h6: number | null,
    h3: number | null,
    h1: number | null
  }
  zigzag: {
    direction: 'up' | 'down' | null
    extremePrice: number
    barsSinceExtreme: number
    lastPivot: { price, type: 'min'|'max' } | null
  }
}
```

### Pivot Event
```typescript
{
  symbol: string
  type: 'min' | 'max'
  price: number                  // Historical extremum price
  barsSinceExtreme: number       // Bars since extremum (for timing calculation)
}
```

### Order Flow
```typescript
// Buy triggered on MIN pivot
buy(symbol, currentPrice, quoteVolume24h)
  → creates ActiveOrder
  → emit 'opened'

// Sell triggered on MAX pivot
sellAtPrice(symbol, currentPrice)
  → completes order, calculates profit
  → emit 'completed'
```

## Performance Considerations

- **Chart Buffers**: 200 candles per timeframe (enough for MA99 + margin)
- **Volume Window**: 1,440 candles at 1m (24h rolling, updating live)
- **Quote Volume**: Sum maintained incrementally as window rotates
- **ZigZag Replay**: Deterministic replay on startup (no state loss)
- **WebSocket**: All updates are event-driven, no polling

## Extending

### Add a New Symbol to Auto-Trading

1. Edit `ZIGZAG_ENABLED_SYMBOLS` in `BotManager.ts`
2. Sync with `frontend/src/components/ChartGrid.tsx`
3. Restart bot

### Test Different ZigZag Parameters

```bash
npm run emulate -- --deviation 1.5 --minBars 30
```

(See `emulator/run.ts` for full CLI options)

### Add a New Indicator

1. Create function in `utils/indicators.ts`
2. Call from `computeChartSeries()` in `utils/chartSeries.ts`
3. Add to `ChartSeries` interface in `types/index.ts`

## Troubleshooting

### Bot not trading?
- Check `ZIGZAG_ENABLED_SYMBOLS` includes your symbol
- Verify WebSocket is connected: check logs for `[Server]` messages
- Run tests: `npm test`

### Unusual slippage in backtest?
- Verify CSV has correct `quoteVolume` field
- Check `barsSinceExtreme` calculation in EmulatorEngine
- Compare pivot time vs execution time in report

### Performance poor?
- Adjust `deviationPct` and `minBarsBetweenPivots` to reduce false signals
- Check market conditions (ZigZag works best in ranging, choppy markets)
- Run backtest with different parameters: `npm run emulate`

## Documentation

- **ARCHITECTURE.md** — Full technical deep dive (buffers, state machines, events, EmulatorEngine)
- **docs/superpowers/specs/** — Design specs for individual features
- **Tests** — Comprehensive unit tests in `*.test.ts` files show usage patterns

## License

Private project. All rights reserved.

## Author

Victor Gomez (victorgomez.004@gmail.com)

---

**Last Updated**: 2026-09-07
