# PAUSE por régimen de BTC — Diseño

**Fecha:** 2026-07-01
**Objetivo:** dar al bot semi-autonomía detectando automáticamente los descensos
sostenidos de BTC y pausando la operación durante ellos, para evitar que una
posición quede enterrada meses ("orden eterna" / pérdida catastrófica).

## Motivación

El análisis de emulaciones (mensuales, intervalos largos y múltiples) mostró que
el bot se atasca cuando compra un símbolo dentro de un **descenso sostenido de
BTC de varias semanas** (no en caídas agudas con rebote). Ejemplos: ZECUSDT
(comprada Nov 16, −75%), PARTIUSDT (Jun 17, −27%), PNUT (Sep, −30%), PENGU (Dic,
−22%). Saltear esas ventanas a mano (config B) subió el resultado de +180% a
+367% y evitó el entierro de 7 meses de Nov. La regla automática reemplaza ese
tuning manual de intervalos.

## Señal

Sobre las velas **1d de BTC**: `close < MA20` (la MA20 1d ya viene precalculada en
`history/BTCUSDT/BTCUSDT_1d.csv`, columna `ma20`). Precio bajo su media de ~1 mes
= régimen bajista.

## Máquina de estados (histéresis asimétrica)

Rápido a pausar, lento a reanudar:

- **No pausado**: un `close 1d < MA20` → entra **PAUSE** de inmediato.
- **Pausado**: cuenta cierres 1d consecutivos `≥ MA20`; **reanuda** tras **N**
  cierres (configurable, default **2**). Cualquier `close 1d < MA20` reinicia el
  contador a 0.

Antes de que la MA20 exista (primeras ~20 velas 1d) el régimen no puede evaluarse
→ se trata como **no pausado** (permite operar).

## Comportamiento

- **Al entrar en PAUSE**: se cierra la posición abierta (si la hay). El cierre se
  ejecuta a mercado en la **primera vela 1m del símbolo en cartera** posterior al
  disparo de PAUSE, al `close` de esa vela. Se registra como orden completada
  (realiza la pérdida/ganancia — más realista que descartarla).
- **Mientras pausado**: se bloquean **todas las compras nuevas**. Como las compras
  están bloqueadas, solo puede haber una posición abierta en el momento de la
  transición a PAUSE; el force-close es una acción única por episodio.
- **Cadencia**: el estado se actualiza por día, usando la **última vela 1d de BTC
  completada** conforme avanza el tiempo simulado (misma plomería de
  "higher-timeframe" usada antes: precarga + puntero por tiempo).

## Componentes

- **`BtcRegime`** (clase nueva): la máquina de estados. Construida con las velas
  1d de BTC (`{ closeTime, close, ma20 }`, ordenadas) y `N`. `update(now)` avanza
  un puntero por `closeTime` y aplica la transición de estado **una sola vez por
  cada vela 1d recién completada** (no re-evalúa la misma vela en cada tick 1m),
  para que el conteo de rachas sea correcto; getter `paused`.
- **Lector BTC 1d**: extrae `{ closeTime, close, ma20 }` de `BTCUSDT_1d.csv`
  (closeTime = openTime + 1 día). Filas sin `ma20` se omiten para el cálculo.
- **`EmulatorEngine`**: carga BTC 1d, crea el `BtcRegime`, lo avanza con el reloj
  simulado en cada vela, expone `isPaused` al pipeline y dispara el force-close en
  la transición a PAUSE.
- **`tradingPipeline`**: gate de compra `&& !paused`; si `paused` y hay orden
  activa del símbolo de la vela en curso → force-close a su `close`.
- **`run.ts`**: carga `BTCUSDT_1d.csv` para el régimen; constante `N` (resume).

## Parámetros

- MA: **20** (columna `ma20` precalculada, 1d). Fija por ahora.
- `N` (cierres sobre la MA para reanudar): configurable, default **2**.

## Live

Si en `BotManager` (live) no se cablea un feed de BTC 1d, el régimen no se
construye y `paused` es siempre `false` → el bot live no pausa. Queda igual que
hoy hasta que se conecte una fuente de BTC 1d. La lógica de pausa es, por ahora,
efectiva solo en el emulador.

## Validación (criterio de éxito)

Correr los **12 meses completos SIN skips manuales** con la regla activa, comparar
contra:
- **Baseline sin pausa**: ~+180% (con la orden eterna de Nov).
- **Config B manual**: +367% (saltaba las ventanas a mano).

Éxito si la pausa automática (a) evita los entierros (ZEC/PARTI ya no quedan
atascados meses), (b) acerca el rendimiento al de config B sin tuning manual de
intervalos, y (c) la última orden completada llega cerca del final del período.

## Fuera de alcance (por ahora)

- Feed de BTC 1d en vivo (solo emulador).
- MA de período configurable (se usa la MA20 precalculada).
- Señales alternativas (retorno N-días, drawdown) — descartadas en el diseño.
- Marcador `DANGER` per-símbolo (techo parabólico / cuchillo cayendo) — línea
  separada, no parte de esta pausa global.
