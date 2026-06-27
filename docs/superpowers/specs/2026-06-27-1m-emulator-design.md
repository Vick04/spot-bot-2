# Emulador de backtesting sobre historial 1m — Diseño

**Fecha:** 2026-06-27
**Objetivo:** estimar el rendimiento de ~12 meses de la lógica del bot ejecutándola sobre
el historial descargado (carpeta `history/`, 175 símbolos, velas 1m con OHLC), tratando ese
historial como si fuera el websocket de Binance.

El trabajo se divide en dos fases. La Fase 1 (refactor del flujo de validación a 1m) es
prerrequisito de la Fase 2 (el emulador), porque el emulador solo dispone de velas 1m.

---

## Fase 1 — Flujo de validación basado en velas 1m

### Motivación
La lógica actual depende de ticks de **1s**: `ImpulseTracker.process(close, ma99)` se ejecuta
por cada tick de 1s y el precio de decisión de compra/venta es `candle1s.close`. El historial
no tiene 1s. Decisión del usuario: eliminar por completo el pathway de 1s y operar **una vez
por vela 1m cerrada**, usando el **`high` (max)** de la vela como precio de decisión —
reemplazando exactamente al viejo `candle1s.close`.

### Cambios (backend)
1. **`config/constants.ts`** — `CANDLE_TIMEFRAMES = ['1m']` (se deja de suscribir a `1s`).
   `CandleTimeframe` pasa a `'1m'`.
2. **`types/index.ts`** — `CandleTimeframe = '1m'`. `CandleData` gana `max: number`
   (el `high` de la vela 1m). Se elimina `candle1s` de `ObserverState`.
3. **`observers/Observer.ts`** — se elimina `lastCandle1s`/`updateCandle1s`. En
   `updateCandle1m`, sobre vela cerrada: llamar `impulseTracker.process(candle.high, ma99)`
   **antes** de empujar la vela a la cola de la MA99 (la MA99 sigue reflejando velas previas),
   y luego empujarla. `getState().candle1m` incluye `max = lastCandle1m.high`.
4. **`managers/ObserverManager.ts`** — `updateCandle` enruta solo `'1m'`; el evento `candle`
   emitido incluye `isClosed`.
5. **`managers/BotManager.ts`** — la lógica de orden se dispara con `timeframe === '1m' && isClosed`;
   `price = state.candle1m?.max` (compra/venta y `forceSell`).
6. **`services/binanceWebSocket.ts`** — sin cambios de código (usa `CANDLE_TIMEFRAMES`).

### Cambios (frontend)
- `types/index.ts`: `CandleData` gana `max`; se elimina `candle1s` de `ObserverData`.
- `SymbolTable`, `ReadyTable`, `Top25Table`: la columna **"Close 1s"** se reemplaza por
  **"Max 1m"** (`candle1m.max`), el nuevo precio de decisión.

### Sin cambios
- Umbrales: allowed +0.8% (`1.008`), hit +1.3% (`1.013`), target +0.5% (`1.005`).
- Comisión 0.1% compra/venta; saldo inicial 10 000; una sola posición a la vez (all-in).
- Ventana `readyToBuy` de 10s: sigue funcionando porque `process()` y el chequeo de compra
  ocurren en el mismo evento de vela (elapsed ≈ 0 → compra en la vela donde se activa `allowed`).

---

## Fase 2 — Emulador (CLI)

### Forma de ejecución
Script CLI: `npm run emulate` en `backend/`. Proceso batch offline, no toca el servidor live.

### Arquitectura
- **Reloj inyectable**: `ImpulseTracker` y `OrderManager` reciben una fuente de tiempo
  (`now: () => number`, default `Date.now`). El emulador la fija al `open_time` de la vela
  en curso para que `openedAt`/`closedAt`/`durationMs` y la ventana `readyToBuy` usen
  **tiempo simulado**.
- **Carga por streaming + k-way merge**: el total son ~6.9 GB; no cabe en memoria. Se abren
  los 175 `SYMBOL_1m.csv` como streams ordenados por `open_time` y se hace un merge global
  por timestamp, alimentando velas en orden cronológico (como las entregaría el WS real).
- **Reutilización de la lógica**: el emulador instancia `ObserverManager`, `TopSymbolsManager`,
  `OrderManager` y reutiliza el mismo cableado de decisión que `BotManager` (extraído a un
  helper compartido `wireTradingPipeline` para evitar duplicación/deriva). `OrderManager`
  habilitado. Warmup natural: las primeras 99 velas de cada símbolo llenan la cola MA99.
- **Cierre final**: al agotar el historial se fuerza la venta de la posición abierta al `close`
  de su última vela (marcada como cierre forzado) y se cuenta en las estadísticas.

### Salida (Markdown `.md`)
Encabezado:
- saldo inicial, saldo final, rendimiento (%), win rate (% de órdenes con profit > 0),
  cantidad de órdenes ejecutadas.

Tabla de órdenes (una fila por orden ejecutada):
- símbolo, % de rendimiento (`profitPct`), fecha inicio (`openedAt`), fecha fin (`closedAt`).

### Notas de fidelidad
- Granularidad 1m (no 1s): la detección de impulso y las ventas usan el `high` de la vela.
- Sin stop-loss: las órdenes solo cierran al alcanzar +0.5% o por cierre forzado final.
