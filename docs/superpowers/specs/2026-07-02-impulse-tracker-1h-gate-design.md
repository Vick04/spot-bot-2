# ImpulseTracker: gate Step 1 on previous closed 1h candle

## Problem

`ImpulseTracker.process()` fija el `floor` (Step 1) solo comprobando `close < ma99`.
Se quiere añadir una segunda condición, en AND: que la última vela de 1h **cerrada**
haya sido negativa (`close < open`). Solo afecta Step 1 (fijar floor por primera vez);
Steps 2-4 (actualizar floor a un mínimo más bajo, `allowed`, `reached`) no cambian.

Esto debe funcionar tanto en el bot en vivo (`BotManager` + `BinanceWebSocket`) como
en el emulador (`EmulatorEngine` + CSVs de `history/`), con la misma semántica.

## Decisiones

- **Alcance**: todos los símbolos que trackea `ImpulseTracker`, no solo un subconjunto.
- **Fuente de la vela 1h en vivo**: nuevo stream `kline_1h` de Binance por símbolo
  (se añade `'1h'` a `CANDLE_TIMEFRAMES`), igual fuente de verdad que los CSV.
- **Fuente de la vela 1h en emulación**: los archivos `history/<SYMBOL>/<SYMBOL>_1h.csv`
  ya descargados (existen para los 175 símbolos), leídos en paralelo al CSV de 1m.
- **Preload en vivo**: al arrancar, se hace fetch REST de la última vela 1h cerrada
  por símbolo (mismo patrón que el preload de 99 velas 1m), para que la condición
  funcione desde el primer segundo en vez de esperar hasta ~1h.
- **Preload en emulación**: no hace falta uno especial — el propio historial CSV
  cubre el cold start de forma natural a medida que se reproduce.
- **Visibilidad**: el estado (vela 1h / si es negativa) queda interno a
  Observer/ImpulseTracker. No se expone en `ObserverState` ni en el frontend.
- **Definición de "negativa"**: `close < open` sobre la vela 1h.
- **Definición de "previa"**: la última vela 1h **cerrada** (no la que está en curso).

## Diseño

### 1. Tipos y configuración

- `backend/src/types/index.ts`: `CandleTimeframe` pasa de `'1s' | '1m'` a
  `'1s' | '1m' | '1h'`.
- `backend/src/config/constants.ts`: `CANDLE_TIMEFRAMES = ['1s', '1m', '1h']` y
  `BINANCE_TIMEFRAME_MAP` con `'1h': '1h'`. Con esto `BinanceWebSocket` abre el
  stream `kline_1h` por símbolo automáticamente (el parseo de eventos ya es
  genérico vía `k.i` / `k.x`); no requiere cambios en `binanceWebSocket.ts`.

### 2. `ImpulseTracker` (`backend/src/observers/ImpulseTracker.ts`)

- `process(close: number, ma99: number, prevHourNegative: boolean): void` —
  nuevo tercer parámetro, requerido (único caller es `Observer`).
- Step 1 pasa de `if (close < ma99)` a `if (close < ma99 && prevHourNegative)`.
- Steps 2, 3, 4, `reset()`, `resetAll()`, `getSnapshot()` y
  `ImpulseTrackingSnapshot` no cambian.

### 3. `Observer` (`backend/src/observers/Observer.ts`)

- Nuevo campo `private lastClosed1hCandle: Candle | null = null`.
- Nuevo método `updateCandle1h(candle: Candle): void` — si `candle.isClosed`,
  reemplaza `lastClosed1hCandle`. Se reutiliza tanto para el evento en vivo/CSV
  como para el preload inicial (misma ruta de código).
- En `updateCandle1s` y en la rama de emulación de `updateCandle1m`, antes de
  llamar a `impulseTracker.process`, se calcula:
  ```ts
  const prevHourNegative = this.lastClosed1hCandle
    ? this.lastClosed1hCandle.close < this.lastClosed1hCandle.open
    : false;
  ```
  y se pasa como tercer argumento.
- Sin vela 1h todavía (antes del primer preload/cierre): `prevHourNegative = false`,
  Step 1 no dispara — mismo patrón de cold-start que ya existe para MA99.

### 4. `ObserverManager` (`backend/src/managers/ObserverManager.ts`)

- `updateCandle()`: nueva rama `else if (candle.timeframe === '1h') observer.updateCandle1h(candle)`.
- Nuevo método `preloadObserverHour1h(symbol: string, candle: Candle): void` →
  delega a `Observer.updateCandle1h(candle)`. Se usa solo en el preload inicial
  del bot en vivo.

### 5. Preload en vivo (`backend/src/services/historicalCandles.ts`, `backend/src/managers/BotManager.ts`)

- Nueva función `fetchLastClosedHourCandle(symbol: string): Promise<Candle>` —
  REST `GET /api/v3/klines?symbol=...&interval=1h&limit=2`, descarta la última
  fila (vela en curso), retorna la anterior ya cerrada. Reutiliza el mismo
  helper `get<T>()` y `parseRow` (parametrizado por timeframe) que ya existen.
- `BotManager.preloadObservers()`: junto al fetch de 1m, añade el fetch de la
  última vela 1h cerrada por símbolo y llama a
  `observerManager.preloadObserverHour1h(symbol, candle)`. Mismo patrón
  `Promise.allSettled` que el preload de 1m; un fallo en el fetch de 1h para un
  símbolo no debe bloquear su preload de 1m (se loguea igual que ya se hace).

### 6. Emulador — lectura de CSV 1h (`backend/src/emulator/csvCandleSource.ts`, `EmulatorEngine.ts`)

- Se extrae la lectura en chunks/parseo de línea de `readSymbolCandles` a una
  función compartida parametrizable por sufijo de archivo (`_1m.csv` / `_1h.csv`)
  y timeframe, para no duplicar la lógica de buffered-read.
- Nuevo generator `readSymbolHourCandles(historyDir, symbol)` sobre
  `${symbol}_1h.csv`, usando esa función compartida.
- Nuevo helper `HourCandleCursor` (mismo archivo o `hourCandleCursor.ts`) que
  mantiene, por símbolo, un iterador sobre `readSymbolHourCandles` con
  lookahead de un elemento, y expone:
  ```ts
  advanceClosed(symbol: string, upToTime: number): Candle[]
  ```
  devuelve (en orden) las velas 1h cuyo cierre (`openTime + 3_600_000 <= upToTime`)
  ya ocurrió y aún no se habían devuelto, avanzando el cursor.
- `EmulatorEngine.run()`: antes de `observerManager.updateCandle(candle)` para
  cada vela 1m del stream merged, llama a
  `hourCandleCursor.advanceClosed(candle.symbol, candle.openTime)` y alimenta
  cada vela devuelta vía `observerManager.updateCandle({ ...vela, timeframe: '1h' })`.
- Sin preload especial en el emulador — el propio CSV cubre el cold start.

### 7. Testing

- `ImpulseTracker`: Step 1 no fija floor si `prevHourNegative` es `false` aunque
  `close < ma99`; sí lo fija cuando ambas condiciones son verdaderas; Steps 2-4
  no cambian de comportamiento con el nuevo parámetro.
- `HourCandleCursor` (o equivalente): avanza correctamente sin repetir ni saltar
  velas al llamarse con timestamps crecientes; no devuelve nada si no hay vela
  nueva cerrada.
- Hoy no existen tests para `ImpulseTracker`, `Observer`, `ObserverManager` ni
  para el código del emulador — este cambio introduce los primeros. El plan de
  implementación (TDD) debe detallar los casos exactos.

## Fuera de alcance

- No se toca `ImpulseTrackingSnapshot` ni `ObserverState` (sin visibilidad en UI).
- No se cachean/validan los CSV `_1h.csv` contra los `_1m.csv` (se asume que ya
  están correctos, igual que el resto del historial usado por el emulador).
- No se añade una condición equivalente en Step 2 (actualización de floor a un
  mínimo más bajo) — explícitamente pedido solo para Step 1.
