# Emulador de 12 meses sobre historial 1m

## Contexto

El backend corre en tiempo real conectado a Binance por websocket, decidiendo
compra/venta a partir de ticks de 1s. Existe un historial descargado de 12
meses de velas 1m para 175 símbolos en `history/<SYMBOL>/<SYMBOL>_1m.csv`
(~6.9 GB en total, no cabe en memoria). Se quiere un emulador que reproduzca
la lógica de decisión del bot sobre ese historial, tratándolo como si fuera
el stream de Binance, y que produzca un reporte de rendimiento estimado.

Un intento anterior de esta misma funcionalidad se implementó en una sesión
previa pero nunca se commiteó y se perdió por completo (el working tree no
conserva ningún archivo de esa sesión). Este spec reconstruye el diseño desde
cero, con un cambio de alcance importante respecto al intento anterior: **el
bot en vivo debe seguir operando sobre ticks de 1s sin ningún cambio de
comportamiento.** La migración a velas 1m aplica *solo* al emulador.

## Requisitos

- Módulo de emulador en el backend que ejecute la lógica de decisión del bot
  sobre el historial de 175 símbolos (~12 meses, ~81M velas 1m).
- El emulador se ejecuta como script CLI (`npm run emulate` en `backend/`).
- El comportamiento del bot en vivo (ticks 1s, `Observer`, `BotManager`,
  `ImpulseTracker`, `OrderManager`) no debe cambiar en absoluto.
- Al terminar, se genera un reporte en Markdown con:
  - Encabezado: saldo inicial, saldo final, rendimiento %, win rate, cantidad
    de órdenes ejecutadas.
  - Tabla de órdenes ejecutadas: símbolo, % de rendimiento, fecha de inicio,
    fecha de fin.
- Si al agotarse el historial queda una orden activa sin cerrar, se descarta:
  se restaura el saldo al valor previo a esa compra y la orden no se incluye
  en el reporte. Esto evita que un cierre forzado con pérdida grande (por
  ejemplo, una posición atascada en un símbolo que nunca recupera el precio
  de entrada) distorsione el resultado — el reporte refleja el progreso del
  bot hasta antes de la orden inconclusa.

## No objetivos

- No se modifica el frontend.
- No se modifican los umbrales de la estrategia (+0.8% allowed, +1.3% hit,
  +0.5% target), la comisión (0.1%), el saldo inicial (10 000 USDT) ni la
  regla de una sola posición activa a la vez (all-in, compounding).
- No se añade stop-loss ni salida por tiempo. El hallazgo de un intento
  anterior (una posición atascada puede bloquear el capital durante meses)
  queda documentado como resultado esperado de la emulación, no como bug a
  corregir en este trabajo.

## Diseño

### Principio guía: cambios aditivos, comportamiento live intacto

Las clases del bot en vivo (`Observer`, `ObserverManager`, `ImpulseTracker`,
`OrderManager`) se extienden con parámetros opcionales que, sin proveerse,
preservan exactamente el comportamiento actual. El emulador es quien provee
esos parámetros; el bot en vivo sigue instanciando las clases sin argumentos
extra.

### Reloj inyectable

`ImpulseTracker` y `OrderManager` usan `Date.now()` internamente (ventana de
10s de `readyToBuy`, `openedAt`/`closedAt` de las órdenes). En la emulación,
procesar ~81M velas no debe tomar 12 meses de tiempo real — el reloj debe
avanzar según el tiempo simulado de cada vela (`candle.openTime`), no según
el reloj del sistema.

- `ImpulseTracker`: constructor gana `clock?: () => number` (default
  `Date.now`). Sustituye los dos usos internos de `Date.now()`.
- `OrderManager`: constructor gana `clock?: () => number` (default
  `Date.now`). Sustituye `Date.now()` en `buy()` (openedAt) y `sell()`
  (closedAt).
- El emulador mantiene una única celda de reloj mutable, compartida por
  todos los símbolos, que se adelanta a `candle.openTime` antes de procesar
  cada vela del stream fusionado.

### Modo de Observer: `'live'` vs `'emulation'`

El problema central: en vivo, `Observer.updateCandle1s` alimenta el
`ImpulseTracker` con el `close` de cada tick de 1s; `updateCandle1m` solo
empuja velas cerradas a la cola de la MA99. El emulador no tiene datos de
1s — solo velas 1m — así que necesita que el impulso se calcule a partir de
cada vela 1m cerrada, usando su `high` como precio (para no perder el
recorrido intra-minuto).

- `Observer` constructor gana `options?: { mode?: 'live' | 'emulation';
  clock?: () => number }`, default `mode: 'live'`.
- En modo `'live'` (default): `updateCandle1s` y `updateCandle1m` se
  comportan exactamente igual que hoy. Cero cambio de comportamiento.
- En modo `'emulation'`: `updateCandle1m`, al recibir una vela cerrada, llama
  `impulseTracker.process(candle.high, ma99)` (si hay MA99 disponible) antes
  de empujar la vela a la cola. `updateCandle1s` nunca se invoca (el
  emulador no genera velas de 1s).
- El `clock` se pasa al `ImpulseTracker` interno del `Observer`.

`ObserverManager` constructor gana `options?: { mode?; clock? }`, que
propaga a cada `Observer` que crea. Sin opciones, comportamiento actual.

### Lógica de decisión compartida

`BotManager` tiene hoy, inline en su handler de eventos `'candle'`, la
lógica de: chequear venta (`orderManager.onPriceTick`) y chequear condición
de compra (`readyToBuy` + Top25 + sin orden activa → `orderManager.buy`).
Se extrae esa lógica a una función pura en
`backend/src/managers/tradingPipeline.ts`:

```ts
export function evaluateTick(
  symbol: string,
  price: number,
  state: ObserverState,
  topSymbolsManager: TopSymbolsManager,
  orderManager: OrderManager
): void
```

`BotManager` la usa en su handler de `'1s'` (refactor puro, mismo
comportamiento). El emulador la usa por cada vela 1m cerrada, con
`candle.high` como precio — así ambos caminos comparten exactamente la
misma regla de decisión, sin duplicarla.

### Lectura del historial: streaming + k-way merge

175 archivos CSV (`history/<SYMBOL>/<SYMBOL>_1m.csv`, columnas
`open_time,open,high,low,close,ma20,ma99,bb_up,bb_down` — se usan solo las 5
primeras) deben combinarse en un único stream ordenado por `open_time`, sin
cargar los 6.9 GB en memoria.

`backend/src/emulator/csvCandleSource.ts`: para cada símbolo, un lector
línea por línea con buffer (stream de Node, no `readFileSync`). Un merge de
175 vías por timestamp (cola de prioridad simple sobre "próxima línea de
cada archivo") produce el stream global ordenado. Cada línea se traduce a un
`Candle` con `timeframe: '1m'`, `isClosed: true`.

### Motor del emulador

`backend/src/emulator/EmulatorEngine.ts`:

1. Instancia `ObserverManager({ mode: 'emulation', clock })`,
   `OrderManager(clock)`, `TopSymbolsManager`, crea un observer por símbolo.
2. `orderManager.setEnabled(true)` (en vivo esto se activa por API; el
   emulador lo activa directo).
3. Consume el stream fusionado de `csvCandleSource`. Por cada vela:
   - Adelanta el reloj simulado a `candle.openTime`.
   - `observerManager.updateCandle(candle)` (dispara el modo `'emulation'`
     del observer correspondiente).
   - Lee el nuevo estado del observer y llama
     `evaluateTick(symbol, candle.high, state, topSymbolsManager,
     orderManager)`.
   - Escucha el evento `'sell'` de `OrderManager` para acumular las
     órdenes completadas del reporte.
4. Al agotarse el stream: si `orderManager.hasActiveOrder()`, llama a
   `orderManager.cancelActiveOrder()` (nuevo método — ver abajo). No se
   agrega al reporte.

### Descartar la orden final inconclusa

`OrderManager` gana un método nuevo, no usado por el bot en vivo:

```ts
cancelActiveOrder(): void {
  if (!this.activeOrder) return;
  this.balance = this.activeOrder.usdtSpent;
  this.activeOrder = null;
}
```

Restaura el saldo al valor que tenía justo antes de esa compra (la compra es
all-in, así que `usdtSpent` es exactamente el saldo previo) y descarta la
orden sin registrarla en el historial.

### Reporte Markdown

`backend/src/emulator/reportWriter.ts` genera:

```md
# Reporte de emulación — 12 meses

| Métrica | Valor |
|---|---|
| Saldo inicial | 10000.00 USDT |
| Saldo final | ... USDT |
| Rendimiento | ...% |
| Win rate | ...% (WwinsW/Llosses) |
| Órdenes ejecutadas | N |

| Símbolo | Rendimiento % | Fecha inicio | Fecha fin |
|---|---|---|---|
| ... | ... | ... | ... |
```

Si hubo una orden final descartada, se agrega una nota debajo de la tabla
indicando que fue descartada y el saldo restaurado.

### CLI

`backend/src/emulator/run.ts`, ejecutado con `npm run emulate` desde
`backend/`. Flags opcionales:

- `--symbols=BTCUSDT,ETHUSDT` — limita a un subconjunto de símbolos.
- `--limit=N` — limita velas por símbolo (para pruebas rápidas).
- `--out=ruta.md` — ruta de salida (default:
  `results/emulation-<timestamp>.md`, resuelta relativa a la raíz del
  repo, no al cwd).

`backend/package.json`: nuevo script `"emulate": "ts-node --transpile-only
src/emulator/run.ts"` y `ts-node` como devDependency explícita (hoy solo
existe transitivamente vía `ts-node-dev`).

## Archivos afectados

**Nuevos:**
- `backend/src/emulator/csvCandleSource.ts`
- `backend/src/emulator/EmulatorEngine.ts`
- `backend/src/emulator/reportWriter.ts`
- `backend/src/emulator/run.ts`
- `backend/src/managers/tradingPipeline.ts`

**Modificados (aditivos, sin cambio de comportamiento por default):**
- `backend/src/observers/ImpulseTracker.ts` — `clock?` opcional.
- `backend/src/managers/OrderManager.ts` — `clock?` opcional,
  `cancelActiveOrder()`.
- `backend/src/observers/Observer.ts` — `options?: { mode?, clock? }`.
- `backend/src/managers/ObserverManager.ts` — `options?: { mode?, clock? }`.
- `backend/src/managers/BotManager.ts` — refactor a `evaluateTick()`.
- `backend/package.json` — script `emulate`, devDependency `ts-node`.

**Sin cambios:** frontend completo, `types/index.ts`, `constants.ts`.

## Testing

No hay suite de tests en el proyecto (verificado: solo `tsc` como chequeo).
Verificación:
- `tsc` limpio en backend tras cada cambio.
- Smoke test del emulador con `--symbols=BTCUSDT,ETHUSDT --limit=5000` para
  confirmar que corre y que el reporte tiene el formato esperado.
- Medición de throughput con `--limit=` alto sobre los 175 símbolos para
  estimar tiempo del run completo antes de lanzarlo sin límite.
- Run completo sin límite; inspección manual del reporte generado.
