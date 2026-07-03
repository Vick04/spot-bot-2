# Liquidity-based order sizing (live + emulator)

## Problem

Cada orden usa hoy todo el balance (all-in). Se quiere que el monto de cada
orden dependa de la liquidez del par, para no ofertar en altcoins pequeñas el
mismo monto que en BTC:

    orderSize = min(balance, quoteVolume24h * LIQUIDITY_FACTOR, MAX_ORDER_USDT)

Debe funcionar en vivo y en el emulador.

## Decisiones (brainstorming)

- **Fuente de `quoteVolume24h`: un solo camino de cálculo.** Se computa como la
  suma rodante del quote-volume de las últimas 1440 velas 1m, alimentada por el
  mismo dato en ambos modos. Sin stream `@ticker` nuevo. Igual filosofía de
  paridad que los indicadores 1h.
  - Live: el kline WS ya trae `k.q` (quote-volume de esa vela 1m).
  - Emulador: nueva columna `quote_volume` en el `_1m.csv` (el downloader hoy la
    descarta). Requiere re-descargar los 175 símbolos (lo corre el usuario tras
    el cambio al downloader).
- **Preload en vivo**: precargar ~1440 velas 1m por símbolo vía REST para llenar
  la ventana de volumen (y de paso la MA99), así el sizing es correcto desde t=0.
- **Posiciones parciales**: `buy` deja de ser all-in; el sobrante del balance
  queda disponible. Sigue habiendo una sola posición a la vez.
- **Config**: `LIQUIDITY_FACTOR = 0.0001`, `MAX_ORDER_USDT = 10_000` como
  constantes en `OrderManager`.
- Fuera de alcance: frontend; el sizing no se muestra en `ObserverState` para UI
  (sí se agrega `quoteVolume24h` a `ObserverState` para que `evaluateTick` lo
  consuma).

## Diseño

### 1. Dato por vela — `quoteVolume`

- `types/index.ts`: `Candle` gana `quoteVolume?: number` (quote-volume de la vela
  1m). Ausente → tratado como 0 aguas abajo.
- `services/binanceWebSocket.ts`: parsea `k.q` a `candle.quoteVolume`.
- `services/historicalCandles.ts`: `parseRow` lee `row[7]` (quote asset volume)
  a `quoteVolume`.
- `scripts/download-history.js`: añade columna `quote_volume` al `_1m.csv`
  (índice 7 del kline; hoy `writeCsv` guarda solo OHLC + indicadores). Header 1m
  pasa a `...,bb_down,quote_volume`. Solo el 1m la necesita.
- `emulator/csvCandleSource.ts`: `parseCandleLine` lee la columna `quote_volume`
  cuando existe (por posición de columna del 1m); ausente → `undefined`.

### 2. Rolling 24h — inline en el `Observer`

- `Observer`: `quoteVol1m: Queue<number>(1440)` + `quoteVolSum` (running sum,
  O(1), mismo patrón que `ma99Sum`; no módulo aparte). En `updateCandle1m` (vela
  cerrada) hace push de `candle.quoteVolume ?? 0` y actualiza la suma (resta el
  evictado).
- `get24hQuoteVolume(): number` = la suma corriente (si la ventana no está llena
  → subestima; con preload de 1440 no ocurre en vivo).
- `ObserverState` gana `quoteVolume24h: number`. Se testea alimentando velas al
  `Observer` (warmup, evicción).

### 3. Order sizing — función pura + `OrderManager`

- `utils/orderSize.ts`: `computeOrderSize(balance, quoteVolume24h, { factor, maxUsdt }): number`
  = `Math.max(0, Math.min(balance, quoteVolume24h * factor, maxUsdt))`.
- `OrderManager`: constantes `LIQUIDITY_FACTOR = 0.0001`, `MAX_ORDER_USDT = 10_000`.
- `buy(symbol, price, quoteVolume24h)`: `orderSize = computeOrderSize(...)`;
  si `orderSize <= 0` → no compra.

### 4. Posiciones parciales (contabilidad)

- `buy`: `usdtSpent = orderSize`; `balance -= orderSize` (antes `balance = 0`).
  `quantity = (orderSize / price) * (1 - FEE)`.
- `sell`: `balance += usdtReceived` (antes `balance = usdtReceived`).
- `cancelActiveOrder`: `balance += order.usdtSpent` (antes `balance = usdtSpent`).
- Sigue comprando solo si `!hasActiveOrder` → una posición a la vez; el sobrante
  del balance queda ocioso hasta cerrar. `getBalance()` puede ser > 0 con orden
  activa (afecta `getStatus`/reporte, correcto).

### 5. Wiring

- `tradingPipeline.ts` `evaluateTick`: pasa `state.quoteVolume24h` a
  `orderManager.buy(symbol, price, state.quoteVolume24h)`. Punto único
  compartido live/emulador.
- Live preload (`BotManager` + `historicalCandles`): `fetchHistoricalCandles`
  pasa a traer ~1440 velas 1m (paginado, límite 1000 de Binance → 2 llamadas por
  símbolo con `endTime`). `Observer.preload` alimenta tanto la MA99 (queue de 99,
  evicta) como la ventana de volumen (1440).
- Emulador: sin cambios de wiring; la ventana de volumen se llena desde el CSV.

### 6. Tests (TDD)

- `computeOrderSize`: tope por volumen, tope por `MAX_ORDER_USDT`, límite por
  balance, `quoteVolume=0` → 0, valores negativos defensivos → 0.
- Rolling 24h (tracker): suma correcta, warmup (<1440 → suma parcial), evicción a
  los 1440.
- `OrderManager`: compra parcial deja `balance = balance - orderSize`; `sell`
  suma `usdtReceived`; `cancel` devuelve `usdtSpent`; `buy` con `quoteVolume=0`
  no compra.
- Parseo de `quoteVolume` desde una fila de CSV 1m y desde el payload WS.

## Riesgos / notas

- El cambio all-in → parcial toca la contabilidad de balance; los tests de
  `OrderManager` existentes (compra parcial, cancel, discarded final order en el
  emulador) deben seguir cuadrando.
- Los CSV actuales no tienen `quote_volume`; hasta re-descargar, el emulador
  sizing usará volumen 0 → órdenes 0 (no opera). Se maneja con parseo tolerante y
  se documenta que el usuario debe re-descargar.
- Warmup de volumen en vivo cubierto por el preload de 1440.
