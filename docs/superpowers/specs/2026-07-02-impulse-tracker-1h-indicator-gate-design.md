# ImpulseTracker: gate Step 1 on previous 1h candle indicators

## Problem

Reemplazar la condición actual del gate de Step 1 (última vela 1h cerrada
negativa, `close < open`) por una nueva basada en indicadores de la última vela
1h cerrada:

    close_1h > ma99_1h  AND  close_1h > ma20_1h  AND  close_1h < bb_upper_1h

junto a la condición 1m preexistente `close < ma99(1m)`. Debe funcionar en vivo
y en el emulador.

## Contexto

- La fórmula de los indicadores está en `scripts/download-history.js`
  (`writeCsv`): Bollinger(20, 2) con **desviación estándar poblacional**.
  - `ma20 = SMA` de los últimos 20 closes (requiere ≥20 velas).
  - `ma99 = SMA` de los últimos 99 closes (requiere ≥99 velas).
  - `sd = sqrt( Σ (close_k − ma20)² / 20 )` sobre los últimos 20 closes.
  - `bb_up = ma20 + 2·sd`.
  - En la fila i, los indicadores se calculan **incluyendo** `close[i]`; la
    condición compara `close[i]` contra su propio ma20/ma99/bb_up.
- Los CSV `history/<SYMBOL>/<SYMBOL>_1h.csv` ya traen estas columnas
  precalculadas, pero Binance (WS `kline_1h` / REST) NO las entrega en vivo.

## Decisiones

- **Reemplaza** la condición "vela 1h negativa"; no se suma.
- **Un solo camino de cálculo**: el `Observer` mantiene una ventana rodante de
  los últimos 99 closes de 1h por símbolo y calcula ma20/ma99/bb_up con la
  fórmula de arriba, **idéntica en vivo y en emulación**. Se ignoran las
  columnas precalculadas del CSV (quedan solo como fixture de validación en un
  test). Garantiza paridad live/emulación.
- **Warmup**: si la ventana aún no tiene 99 closes, el gate queda cerrado
  (`false`). Coincide con el comportamiento actual del MA99 y con las celdas
  vacías del CSV en las primeras 98 filas.
- **Aplica a live y emulador.**

## Diseño

### 1. `backend/src/utils/indicators.ts` (nuevo)

Funciones puras que replican `download-history.js`:

- `sma(values: number[]): number` — media aritmética (el caller pasa la ventana
  exacta: últimos 20 o últimos 99).
- `bollingerUpper(last20: number[]): number` — `sma + 2·populationStdDev`.

Se testean directamente contra una fila real del CSV de BTC (paridad de fórmula).

### 2. `backend/src/observers/Observer.ts`

- Reemplaza `lastClosed1hCandle: Candle | null` por:
  - `hourCloses: Queue<number>` (capacidad 99),
  - `lastHourClose: number | null`.
- `updateCandle1h(candle)`: si `candle.isClosed`, `hourCloses.push(candle.close)`
  y `lastHourClose = candle.close`.
- Helper privado `hourGateOpen(): boolean`:
  - si `hourCloses` no está llena (99) → `false`;
  - `const closes = hourCloses.toArray();`
  - `ma99 = sma(closes)` (los 99);
  - `ma20 = sma(closes.slice(-20))`;
  - `bbUpper = bollingerUpper(closes.slice(-20))`;
  - `const c = lastHourClose;`
  - retorna `c > ma99 && c > ma20 && c < bbUpper`.
- `updateCandle1s` y la rama de emulación de `updateCandle1m` pasan
  `hourGateOpen()` como tercer argumento a `impulseTracker.process`.

### 3. `backend/src/observers/ImpulseTracker.ts`

- Sin cambio de lógica. Renombrar el tercer parámetro
  `prevHourNegative` → `hourGateOpen` y actualizar el comentario (ahora es un
  gate genérico de 1h, no "negativa").

### 4. Preload en vivo (`historicalCandles.ts`, `BotManager.ts`)

- `fetchLastClosedHourCandle(symbol)` → `fetchClosedHourCandles(symbol, limit=120)`:
  REST `interval=1h&limit=<limit>`, descarta la última fila (vela en curso),
  retorna las cerradas (`Candle[]`, ascendente).
- `ObserverManager.preloadObserverHour1h(symbol, candle)` →
  `preloadObserverHours(symbol, candles: Candle[])` que alimenta cada vela vía
  `Observer.updateCandle1h`.
- `BotManager.preloadObservers`: hace push de las ~120 velas 1h cerradas por
  símbolo (en `Promise.allSettled` separado, un fallo no bloquea el trading).

### 5. Emulador

- Sin cambios de wiring: `HourCandleCursor` ya alimenta las velas 1h cerradas a
  medida que avanza el reloj 1m. El `Observer` ahora calcula los indicadores del
  close. No se usan las columnas de indicadores del CSV.

### 6. Testing

- `indicators.ts`: `sma` y `bollingerUpper` sobre una ventana real de 99 closes
  de BTC (fila i=200 de `BTCUSDT_1h.csv`) deben reproducir
  `ma20=108746.6795`, `ma99=108446.7348…`, `bb_up=109224.5393…`
  (tolerancia ~1e-4 relativa).
- `Observer` (o el helper): gate abierto solo si `close>ma99 && close>ma20 &&
  close<bbUpper`; cerrado en cada caso que falle una; cerrado si la ventana no
  está llena.
- `ImpulseTracker`: los tests existentes siguen válidos (el booleano gatea
  Step 1 igual); actualizar nombres/comentarios al renombrar el parámetro.

## Fuera de alcance

- No se expone nada en `ObserverState` ni en el frontend (sigue interno).
- No se valida el CSV 1h contra el 1m.
- No se toca la condición 1m (`close < ma99`) ni Steps 2-4.
