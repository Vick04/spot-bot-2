# Live signal detector: replace ImpulseTracker/OrderManager with condition-based symbol list

## Problem

El live bot hoy compra/vende basado en `ImpulseTracker` (máquina de estados
floor/allowed/reached sobre MA99) y `OrderManager` (simulación de balance con
target/stop-loss). Se reemplaza por completo con un detector de señales
puramente observacional: por cada símbolo, en tiempo real, se evalúa si
cumple alguna de cuatro condiciones sobre 1m y 1h. El cliente muestra
únicamente los nombres de los símbolos que califican — no hay órdenes, no hay
balance, no hay "top 25".

## Condición de calificación

Un símbolo **califica** si se cumple **cualquiera** (OR) de:

1. `close_1h > bbUpper_1h` (banda viva)
2. `close_1m > bbUpper_1m` (banda viva)
3. Últimas 3 velas 1h positivas (incluye la vela 1h en formación)
4. Últimas 3 velas 1m positivas (incluye la vela 1m en formación)

Se recalculan las 4 en cada tick de precio (stream 1s) y la lista de
calificados se actualiza en vivo.

### bbUpper — "banda viva"

`bbUpper(TF) = SMA20 + 2 · stddevPoblacional` sobre una ventana de 20 valores:
las **19 últimas velas cerradas** de ese timeframe + el **precio actual** en
el lugar del 20º (más reciente). La banda se recalcula en cada tick junto con
el precio — no espera a que la vela cierre. Reusa `bollingerUpper()` de
`utils/indicators.ts` (ya usa desviación estándar poblacional, consistente).

Si hay menos de 19 velas cerradas disponibles para ese timeframe, la
sub-condición es `false` (no calificable aún por falta de historial).

### 3 velas positivas

"Positiva" = `close > open`. Para la vela en formación, `close` es el precio
actual y `open` es el open real de esa vela (viene del stream de Binance
incluso con `isClosed: false`). Se evalúan: vela actual (en formación) + 2
velas cerradas inmediatamente anteriores. Las 3 deben ser positivas.

Si hay menos de 2 velas cerradas disponibles, la sub-condición es `false`.

## Alcance: qué se elimina

- `backend/src/observers/ImpulseTracker.ts` y su test
- `backend/src/managers/OrderManager.ts` y su test
- `backend/src/managers/tradingPipeline.ts` (`evaluateTick`)
- `backend/src/managers/TopSymbolsManager.ts` (solo servía al gating de compra)
- `backend/src/emulator/` completo (EmulatorEngine, run, csvCandleSource,
  hourCandleCursor(+test), reportWriter) — emulaba la estrategia de órdenes
  que se elimina; no se adapta al nuevo detector en este trabajo.
- Referencias en `package.json` al script `emulate` (si existe)
- Frontend: `SymbolTable.tsx`, `Top25Table.tsx`, `ReadyTable.tsx`,
  `OrdersPanel.tsx`, y el sistema de pestañas en `App.tsx`
- Tipos que ya no aplican: `ImpulseTrackingSnapshot`, `ActiveOrder`,
  `CompletedOrder`, `OrderStatus`

## Qué se conserva / reusa

- `binanceWebSocket.ts` — ya emite velas 1m/1h en formación con `open`/`close`
  reales y `isClosed`; no requiere cambios.
- `utils/indicators.ts` (`sma`, `bollingerUpper`) — se reusan tal cual.
- `historicalCandles.ts` / preload al arranque — se ajusta el tamaño de
  precarga (ver Datos y preload).
- `symbolManager.ts`, `socketServer.ts`, estructura general de
  `BotManager`/`ObserverManager`/`Observer` (roles, no implementación).

## Arquitectura backend

### 1. `utils/signals.ts` (nuevo) — función pura

```ts
interface SignalReasons {
  bbUpper1m: boolean;
  bbUpper1h: boolean;
  threePositive1m: boolean;
  threePositive1h: boolean;
}

function detectSignal(
  price: number,
  closed1m: Candle[],   // últimas N velas 1m cerradas, ascendente, N >= 19 idealmente
  form1mOpen: number | null,
  closed1h: Candle[],
  form1hOpen: number | null,
): { qualifies: boolean; reasons: SignalReasons }
```

- Cada sub-condición se calcula de forma independiente (ver fórmulas arriba).
- `qualifies = reasons.bbUpper1m || reasons.bbUpper1h || reasons.threePositive1m || reasons.threePositive1h`.
- Función pura, sin estado — fácil de testear con arrays fijos de velas.

### 2. `Observer` (reescrito)

Responsabilidades:
- Mantener un ring buffer de las últimas ~20 velas **cerradas** de 1m (`Queue<Candle>`, reusa `utils/Queue.ts`) y otro de 1h.
- Mantener el `open` de la vela 1m y 1h **en formación** (actualizado desde el stream cuando `isClosed === false`; al cerrar, la vela pasa al ring buffer y se limpia el "en formación" hasta la siguiente).
- Mantener `currentPrice` = último `close` del stream 1s.
- En cada actualización relevante (tick 1s, o cierre/actualización de vela 1m/1h), recalcular `detectSignal(...)` y cachear el resultado.
- `getSignal(): { symbol, qualifies, reasons }`.
- Ya no expone `ma99`, `impulseTracking`, `isReady` (MA99) — esos conceptos desaparecen.

### 3. `ObserverManager`

- Igual que hoy en estructura (mapa symbol→Observer, `updateCandle` dispatcher), pero:
  - Elimina el evento `'hit'` (era para TopSymbolsManager).
  - Tras cada `updateCandle`, emite `'signal'` con `{ symbol, qualifies, reasons }` solo si `qualifies` cambió de valor (evita spam), y siempre emite `'candle'` como hoy si algo más lo consume.
  - `getQualifyingSymbols(): string[]` — deriva de `getAllStates()`/estado interno.

### 4. `BotManager`

- Pierde `topSymbolsManager` y `orderManager`.
- `start()`: crea observers, precarga, conecta WS, cablea `ws.on('candle', ...)` → `observerManager.updateCandle(candle)`. Ya no hay `evaluateTick`.
- `resetBot()`, `forceSell()` y cualquier endpoint/UI de enable/disable/reset se eliminan por completo: sin `OrderManager` no hay balance ni orden activa que resetear o forzar a vender. Si el `BotManager` necesita un método de reinicio en el futuro, se diseñará contra el nuevo detector cuando haga falta (YAGNI por ahora).

### 5. Socket / API (`socketServer.ts`, `routes/api.ts`)

- El payload deja de incluir `impulseTracking`, `activeOrder`, `orderHistory`, `top25`.
- Nuevo payload: `qualifyingSymbols: { symbol: string; reasons: SignalReasons }[]`.
- Se emite en cada cambio de señal (ver ObserverManager) y también en snapshot completo al conectar un cliente nuevo.
- Endpoint REST equivalente para estado inicial (reemplaza el que devolvía `ObserverState[]`/order status).

### 6. Tipos (`types/index.ts`)

- Eliminar: `ImpulseTrackingSnapshot`, `ActiveOrder`, `CompletedOrder`, `OrderStatus`.
- `ObserverState` se simplifica a algo como:
  ```ts
  interface ObserverState {
    symbol: string;
    qualifies: boolean;
    reasons: SignalReasons;
  }
  ```
- `Candle` no cambia.

## Datos y preload

- Al arrancar (`BotManager.start`), precargar por símbolo ≥19 velas 1m cerradas y ≥19 velas 1h cerradas (para que bbUpper tenga ventana completa desde el primer tick). Antes de tener suficiente historial, el símbolo simplemente no califica por esas sub-condiciones (no bloquea las otras).
- Reusa `fetchHistoricalCandles` / `fetchClosedHourCandles` ya existentes, ajustando el tamaño solicitado (de 99 a ~20).

## Frontend

- `App.tsx`: sin pestañas. Header (título + estado de conexión) + una lista simple de símbolos calificados (nombre + badge opcional indicando qué razón(es) cumple, ya que el payload las trae, aunque el requisito mínimo es solo el nombre).
- Se elimina `SymbolTable`, `Top25Table`, `ReadyTable`, `OrdersPanel`.
- `useSocket.ts` / `useApi.ts`: se actualizan los tipos consumidos al nuevo payload (`qualifyingSymbols`), eliminando referencias a `top25`, `orderStatus`, `orderHistory`.
- `frontend/src/types/index.ts`: refleja el nuevo `ObserverState`/payload.

## Testing

- `utils/signals.test.ts` (nuevo, reemplaza `ImpulseTracker.test.ts`):
  - Cada sub-condición aislada (bbUpper1m, bbUpper1h, threePositive1m, threePositive1h) en verdadero/falso.
  - OR combinando 0, 1 y varias condiciones verdaderas.
  - Casos de historial insuficiente (< 19 cerradas, < 2 cerradas) → esa sub-condición en `false`, sin excepción.
  - Banda viva: verificar que el precio actual participa en el cálculo de SMA/stddev (cambia el resultado según el precio, no solo según velas cerradas).
- `OrderManager.test.ts` se elimina junto con la clase.
- No hay test de `Observer` hoy (se revisa si conviene añadir uno ligero de integración observer→detectSignal, pero no es obligatorio para este spec).

## Fuera de alcance

- No se reescribe el emulador para la nueva lógica (se elimina, ver arriba).
- No se persiste histórico de señales; solo estado en vivo.
- No hay alertas/sonidos/notificaciones — solo la lista visible en el cliente.
