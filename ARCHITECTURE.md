# Spot-Bot-2: Arquitectura y Flujos

## 🎯 Propósito
Bot de trading automático para BTCUSDT en Binance que detecta pivotes locales (máximos y mínimos) usando el **patrón ZigZag** y ejecuta operaciones buy/sell automáticas.

---

## 📐 Patrón Core: Observer/Manager

### Estructura General
```
BotManager (orquestador principal)
├── SymbolManager (metadatos de Binance)
├── ObserverManager (multi-símbolo)
│   └── Observer × N (uno por símbolo: BTCUSDT, etc.)
├── OrderManager (estado de cuenta)
└── BinanceWebSocket (streaming de datos)
```

---

## 🔍 Observer (backend/src/observers/Observer.ts)

**Responsabilidad:** Rastrear datos de mercado para UN SÍMBOLO.

### Buffers de Datos
```typescript
closed1m: Queue<Candle>           // Últimas 200 velas de 1m
closed1h: Queue<Candle>           // Últimas 200 velas de 1h  
quoteVol1m: Queue<number>         // Últimas 1440 valores de volumen en quote (24h)
form1mCandle: Candle | null       // Vela actual formándose (1m)
form1hCandle: Candle | null       // Vela actual formándose (1h)
currentPrice: number | null       // Último precio en vivo (de 1s ticks)
```

### Estado ZigZag (La Señal Crítica)
```typescript
ZigZagState {
  direction: 'up' | 'down' | null    // null=cold-start, up=espera pivote max, down=espera pivote min
  extremePrice: number                // Precio extremo actual siendo rastreado
  barsSinceExtreme: number             // Velas desde última actualización del extremo
  lastPivot: {price, type} | null     // Pivote confirmado (NUNCA se repinta)
  pendingHigh/Low: number              // Cold-start: dos candidatos simultáneos
  pendingHighBars/LowBars: number     // Cold-start: contadores de barras
}
```

### Máquina de Estados ZigZag

**Cold-start (direction === null):**
1. Primera vela: inicia `pendingHigh` y `pendingLow`
2. Cada vela: actualiza candidatos independientes
3. Confirmación: cuando un candidato se desvía ≥1% del otro Y han pasado ≥20 velas
   - Si `pendingHigh - low >= 1%` → confirma MAX, `direction='down'`
   - Si `high - pendingLow >= 1%` → confirma MIN, `direction='up'`

**Normal (direction !== null):**
1. Rastrear `extremePrice` y `barsSinceExtreme`
2. Si nueva vela extiende el extremo → reset `barsSinceExtreme=0`
3. Si precio retrae ≥1% desde extremo Y ≥20 velas han pasado → confirma pivote opuesto

### Métodos de Actualización

```typescript
updateCandle1s(candle)     // Solo actualiza currentPrice (para gráficos en vivo)
                           // NUNCA cambia ZigZag o performance

updateCandle1m(candle)     // Si isClosed=true:
                           //   - Push a closed1m buffer
                           //   - Actualiza volumen
                           //   - Avanza ZigZag si zigzagTimeframe='1m'
                           // Si isClosed=false: guarda como formingCandle

updateCandle1h(candle)     // Si isClosed=true:
                           //   - Push a closed1h buffer
                           //   - Recomputa performance windows
                           //   - Avanza ZigZag si zigzagTimeframe='1h'
                           // Si isClosed=false: guarda como formingCandle
```

### Métodos de Precarga (para emulación/reinicio)

```typescript
preloadClosed1m(candles)   // Repite cada vela por nextZigZagState()
                           // Reconstruye estado ZigZag real (no arranca en frío)

preloadClosed1h(candles)   // Solo recomputa performance al final
                           // No repite ZigZag (a menos que zigzagTimeframe='1h')

preloadQuoteVolume1m(candles)  // Llena ventana de 24h de volumen
```

### Performance Windows
```typescript
performance: {
  h24: number | null    // % cambio últimas 24 velas de 1h
  h12: number | null    // % cambio últimas 12 velas
  h6: number | null     // % cambio últimas 6 velas
  h3: number | null     // % cambio últimas 3 velas
  h1: number | null     // % cambio últimas 1 vela
}
```

Se recomputan en cada vela 1h cerrada, independientemente de cambios en ZigZag.

---

## 🎛️ ObserverManager (backend/src/managers/ObserverManager.ts)

**Responsabilidad:** Coordinar N observadores, emitir eventos, servir datos para UI.

### Estructura
```typescript
observers: Map<string, Observer>  // Una Observer por símbolo
extends EventEmitter              // Para pub/sub de eventos
```

### Eventos Emitidos

#### 1. 'signal' (UI-facing)
Emitido cuando:
- Se confirma un pivote NUEVO, O
- Se cierra una vela 1h (independientemente de ZigZag)

```typescript
// El frontend usa esto para actualizar gráficos
state: ObserverState {
  symbol: string
  performance: PerformanceWindows
  zigzag: ZigZagState
}
```

#### 2. 'pivot' (trading-facing) ⭐
Emitido SOLO cuando se confirma un pivote NUEVO.

```typescript
{
  symbol: string
  type: 'min' | 'max'           // Tipo de pivote
  price: number                 // Precio histórico en el extremo
  barsSinceExtreme: number      // CRÍTICO para calcular tiempo del evento
}
```

**Nota importante:** `barsSinceExtreme` viene del estado **anterior a reseteo**, no después. Se usa en el emulator para calcular cuándo ocurrió realmente el pivote:
```
pivotTime = currentTime - ((barsSinceExtreme + 1) * timeframeMs)
```

#### 3. 'chart:tick' (vela formándose)
Emitido en cada tick de vela formándose (no cerrada).

```typescript
{
  symbol: string
  m1: { candle: ChartCandle, series: ChartSeriesPoint }
  h1: { candle: ChartCandle, series: ChartSeriesPoint }
}
```

#### 4. 'chart:closed' (vela cerrada)
Emitido cuando se cierra una vela 1m o 1h.

```typescript
{
  symbol: string
  timeframe: '1m' | '1h'
  candle: ChartCandle
  series: ChartSeriesPoint
}
```

### Métodos Clave

```typescript
createObserver(symbol, zigzagConfig?, zigzagTimeframe?)
  // Crea una Observer para un símbolo
  // zigzagConfig/timeframe: opcionales (solo emulator los pasa)

updateCandle(candle)
  // Rutea la vela al Observer correcto
  // Emite eventos según cambios de estado

getChartData(symbol, timeframe)
  // Retorna últimas 100 velas + indicadores técnicos
  // Calcula indicadores sobre buffer completo (200 velas)
  // Luego corta a ventana visible (100 velas)
  //
  // Indicadores:
  // - MA20: media móvil de 20 periodos
  // - MA99: media móvil de 99 periodos
  // - bbUpper/bbLower: bandas de Bollinger

getLatestChartPoint(symbol, timeframe)
  // Retorna último punto del gráfico (candle + series)
```

---

## 💳 OrderManager (backend/src/managers/OrderManager.ts)

**Responsabilidad:** Gestionar cuenta de trading y estado de órdenes.

### Estado
```typescript
balance: number = 10_000              // USDT inicial
activeOrders: Map<string, ActiveOrder>
completedOrders: CompletedOrder[]
orderSizeConfig: {                    // Configurable para emulator
  factor: number                      // Multiplicador de balance
  maxUsdt: number                     // Límite máximo (live: 10k, emulator: ∞)
}
clock: () => number                   // Función de tiempo (live: Date.now, emulator: simulada)
```

### Fórmula de Tamaño de Orden
```
orderSize = min(
  balance * factor / quoteVolume24h,
  maxUsdt
)
```

**Live:** `factor=0.0001, maxUsdt=10_000` → orden de máx $10k
**Emulator:** `factor=MAX_SAFE_INTEGER, maxUsdt=Infinity` → all-in compounding

### Flujo de Operaciones

```typescript
buy(symbol, price, quoteVolume24h)
  // 1. Valida que no exista orden activa para el símbolo
  // 2. Calcula tamaño de orden
  // 3. Deduce balance: balance -= orderSize
  // 4. Crea orden activa: { symbol, buyPrice, quantity, usdtSpent, openedAt }
  // 5. Emite 'opened'

sellAtPrice(symbol, price)
  // 1. Busca orden activa
  // 2. Si existe, cierra la orden:
  //    - Calcula USDT recibido (con fee)
  //    - Calcula profit y profitPct
  //    - Actualiza balance: balance += usdtReceived
  //    - Guarda en completedOrders
  // 3. Emite 'completed'
```

### Eventos

```typescript
'opened': {
  order: ActiveOrder
  balance: number
}

'completed': {
  order: CompletedOrder
  balance: number
  completedCount: number
  totalProfitPct: number
}
```

### Fee
- Buy: 0.1% sobre amount gastado
- Sell: 0.1% sobre amount recibido

---

## 🤖 BotManager (backend/src/managers/BotManager.ts)

**Responsabilidad:** Orquestación principal, startup y wiring de eventos.

### Startup Flow (method: `start()`)

```
1. Load symbols
   └─ SymbolManager.load() → obtiene lista de símbolos de Binance

2. Create observers for all symbols
   └─ observerManager.createObservers(symbols)

3. Preload historical data
   ├─ Fetch 1440 × 1m candles (24h de datos en 1m)
   │  └─ preloadObserver1m() → últimas 200 velas (para gráfico + ZigZag)
   │  └─ preloadObserverVolume() → todas 1440 (para ventana de volumen)
   │
   └─ Fetch 200 × 1h candles (últimas ~8 días)
      └─ preloadObserver1h() → últimas 200 velas (para performance)

4. Wire event: observerManager.on('pivot', ...)
   └─ Escucha eventos de pivote y ejecuta órdenes

5. Start WebSocket
   └─ BinanceWebSocket.connect()
   └─ En cada vela: observerManager.updateCandle(candle)
```

### Pivot → Trading Wiring

```typescript
observerManager.on('pivot', (pivot: PivotEvent) => {
  // 1. Valida que símbolo tenga auto-trading habilitado
  if (!ZIGZAG_ENABLED_SYMBOLS.has(pivot.symbol)) return;

  // 2. Obtiene precio actual en vivo
  const currentPrice = observerManager.getCurrentPrice(pivot.symbol);
  if (currentPrice === null) return;

  // 3. Obtiene volumen de 24h para dimensionamiento
  const quoteVolume24h = observerManager.getQuoteVolume24h(pivot.symbol) ?? 0;

  // 4. Ejecuta orden según tipo de pivote
  if (pivot.type === 'min') {
    orderManager.buy(pivot.symbol, currentPrice, quoteVolume24h);
  } else {
    orderManager.sellAtPrice(pivot.symbol, currentPrice);
  }
});
```

### Símbolos Habilitados
```typescript
ZIGZAG_ENABLED_SYMBOLS = new Set(['BTCUSDT'])
```

Solo BTCUSDT ejecuta trades automáticas. Otros símbolos se rastrean para gráficos pero no se tradean.
**Importante:** Mantener sincronizado con `frontend/src/components/ChartGrid.tsx`

---

## 🧪 EmulatorEngine (backend/src/emulator/EmulatorEngine.ts)

Reutiliza `ObserverManager` + `OrderManager` para backtesting con datos históricos.

### Configuración

```typescript
interface EmulatorOptions {
  historyDir: string              // Directorio con archivos CSV
  symbols: string[]
  timeframe: '1m' | '1h'          // ZigZag timeframe a probar
  zigzagConfig: ZigZagConfig      // Parámetros a probar (desviación, bar mínimas, etc.)
  limitPerSymbol?: number         // Limit de velas a procesar (para testing)
}
```

### Ejecución

```
1. Create managers con overrides:
   - Observer: zigzagConfig + timeframe personalizados
   - OrderManager: clock simulado, sizing all-in

2. Para cada vela en CSV:
   a. Avanza reloj simulado a openTime de la vela
   b. Envía tick 1s sintético (para que currentPrice refleje esta vela)
   c. Envía candle real (1m o 1h)
   d. Los handlers de 'pivot' y 'completed' se ejecutan automáticamente

3. Rastrea:
   - Trades ejecutadas (con slippage)
   - Drawdown máximo
   - Balance final
```

### Salida

```typescript
interface EmulatorResult {
  options: EmulatorOptions
  candlesProcessed: number
  firstCandleTime: number | null
  lastCandleTime: number | null
  initialBalance: number
  finalBalance: number
  trades: EmulatorTrade[]        // Con pivot price/time y execution price/time
  discardedOpenOrders: number    // Órdenes activas al final
  maxDrawdownPct: number
}
```

### Cálculo de Pivote Time

Información crítica: `barsSinceExtreme` se pasa en el evento pero **es el valor antes del reset**.

```typescript
timeframeMs = options.timeframe === '1m' ? 60000 : 3600000
pivotTime = simClock.time - ((pivot.barsSinceExtreme + 1) * timeframeMs)
```

Ejemplo: Si `barsSinceExtreme=20` en el evento de confirmación:
- Extremo se estableció hace 21 velas (20 + 1)
- `pivotTime = currentTime - (21 × timeframeMs)`

---

## 🔄 Flujo de Datos End-to-End

### Live Trading
```
BinanceWebSocket
└─> emite 'candle' cada segundo (1s), minuto (1m), hora (1h)
    └─> BotManager recibe
        └─> observerManager.updateCandle(candle)
            ├─> Observer actualiza buffers
            ├─> Observer avanza ZigZag
            └─> ObserverManager emite eventos:
                ├─> 'pivot' si hay confirmación
                │   └─> BotManager: buy/sell
                ├─> 'signal' si hay confirmación o cierre 1h
                │   └─> Frontend actualiza estado
                ├─> 'chart:tick' si vela formándose
                └─> 'chart:closed' si vela cerrada
```

### Cold-Start Observer
```
preloadClosed1m(200 velas)
└─> Repite cada vela por nextZigZagState()
    └─> Reconstruye estado ZigZag verdadero
    └─> Observer listo para tomar decisiones correctas
```

---

## 📊 Estructuras de Datos Clave

### Candle
```typescript
{
  symbol: string
  timeframe: '1s' | '1m' | '1h'
  openTime: number              // Timestamp en ms
  open: number
  high: number
  low: number
  close: number
  isClosed: boolean             // true si candle cerrada
  quoteVolume?: number          // BTC × USDT (no siempre presente)
}
```

### ActiveOrder
```typescript
{
  symbol: string
  buyPrice: number
  quantity: number              // Cantidad de asset
  usdtSpent: number             // USDT invertido (con fee)
  openedAt: number              // Timestamp en ms
}
```

### CompletedOrder extends ActiveOrder
```typescript
{
  // ... campos de ActiveOrder
  sellPrice: number
  usdtReceived: number          // USDT recibido (con fee)
  profit: number                // USDT de ganancia
  profitPct: number             // % de ganancia
  closedAt: number              // Timestamp en ms
  durationMs: number            // Duración de la operación
}
```

### ChartData
```typescript
{
  symbol: string
  timeframe: '1m' | '1h'
  candles: ChartCandle[]        // Últimas 100 velas
  series: {
    ma20: (number | null)[]
    ma99: (number | null)[]
    bbUpper: (number | null)[]
    bbLower: (number | null)[]
  }
}
```

---

## 🎯 Principios de Diseño

### 1. **Pivotes Sticky (Nunca Repintan)**
Una vez que un pivote confirma, la referencia de objeto NO cambia. Esto permite:
- Detección de evento limpia (reference inequality)
- No hay ambigüedad sobre cuándo ejecutar trade

### 2. **Timeframe Flexible**
- Observer preload ambos buffers (1m y 1h)
- ZigZag puede correr en 1m o 1h según config
- Emulator puede testear cualquier combinación sin código adicional

### 3. **Replay Discipline**
Cuando reinicia, `preloadClosed1m()` y `preloadClosed1h()` replayan la historia completa:
- No arranca en cold-start vacío
- Reconstruye el estado ZigZag real
- Primera decisión en vivo es correcta

### 4. **Slippage Realista**
- Pivote confirma a precio histórico (extremo)
- Pero se ejecuta al precio actual en vivo
- Emulator rastrea ambos para análisis

### 5. **Quote Volume para Liquidez**
- 24h rolling window de volumen en quote
- Previene oversizing en pares baja liquidez
- Solo aplicado en live (emulator = all-in para testing)

### 6. **Performance Independiente de ZigZag**
Performance windows se recomputan en cada cierre 1h, incluso si ZigZag no cambia:
- Permite que frontend se refresque independientemente
- Señales de ZigZag y performance decoupled

---

## 📁 Estructura de Archivos (Relevante)

```
backend/src/
├── observers/
│   ├── Observer.ts              # Estado de mercado + ZigZag de UN símbolo
│   └── Observer.test.ts
├── managers/
│   ├── ObserverManager.ts       # Coordinador multi-símbolo + eventos
│   ├── ObserverManager.test.ts
│   ├── OrderManager.ts          # Estado de cuenta + ejecución
│   ├── OrderManager.test.ts
│   └── BotManager.ts            # Orquestador principal
├── emulator/
│   ├── EmulatorEngine.ts        # Motor de backtesting
│   ├── EmulatorEngine.test.ts
│   ├── csvCandleSource.ts       # Lee historiales CSV
│   ├── reportWriter.ts          # Escribe reports markdown
│   └── run.ts                   # CLI entry point
├── utils/
│   ├── zigzag.ts                # Máquina de estados ZigZag
│   ├── zigzag.test.ts
│   ├── indicators.ts            # MA, BB
│   ├── chartSeries.ts           # Computa series de indicadores
│   ├── orderSize.ts             # Fórmula de tamaño
│   └── Queue.ts                 # Cola FIFO de capacidad fija
└── types/
    └── index.ts                 # TypeScript interfaces
```

---

## 🚀 Cómo Comenzar si Necesitas Modificar

1. **Para entender flujo actual:** Lee en este orden:
   - `Observer.ts` → entiende buffers y ZigZag
   - `ObserverManager.ts` → entiende eventos
   - `OrderManager.ts` → entiende lógica de órdenes
   - `BotManager.ts` → entiende wiring e inicio

2. **Para agregar un símbolo a auto-trading:**
   - Añade símbolo a `ZIGZAG_ENABLED_SYMBOLS` en `BotManager.ts`
   - Mantén sincronizado con `frontend/src/components/ChartGrid.tsx`

3. **Para testear nuevos parámetros ZigZag:**
   - Usa `EmulatorEngine` con `zigzagConfig` personalizado
   - Corre `npm run emulate` (CLI en `emulator/run.ts`)

4. **Para entender un trade específico:**
   - Rastrea `barsSinceExtreme` en evento → calcula pivotTime real
   - Compara con execution price (currentPrice en ese momento)
   - Slippage = (execution - pivot) / pivot × 100%
