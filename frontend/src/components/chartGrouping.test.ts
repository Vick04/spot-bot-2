import { test } from 'node:test';
import assert from 'node:assert/strict';
import { groupObservers } from './chartGrouping';
import { ObserverData, PerformanceWindows, TimeframeSignal } from '../types';

const EMPTY: TimeframeSignal = { step1: false, step2: false };
const NO_PERFORMANCE: PerformanceWindows = { h24: null, h12: null, h6: null, h3: null, h1: null };

function observer(
  symbol: string,
  m1: TimeframeSignal,
  h1: TimeframeSignal,
  performance: PerformanceWindows = NO_PERFORMANCE
): ObserverData {
  const qualifies = m1.step1 || m1.step2 || h1.step1 || h1.step2;
  return { symbol, qualifies, reasons: { m1, h1 }, performance };
}

test('a symbol with m1.step2 goes to ready', () => {
  const o = observer('AUSDT', { step1: true, step2: true }, EMPTY);
  const { ready, watching } = groupObservers([o], new Set());
  assert.deepEqual(ready.map(x => x.symbol), ['AUSDT']);
  assert.deepEqual(watching, []);
});

test('a symbol with h1.step2 (but not m1) also goes to ready', () => {
  const o = observer('BUSDT', EMPTY, { step1: true, step2: true });
  const { ready } = groupObservers([o], new Set());
  assert.deepEqual(ready.map(x => x.symbol), ['BUSDT']);
});

test('a symbol with only step1 (either timeframe) goes to watching, not ready', () => {
  const o = observer('CUSDT', { step1: true, step2: false }, EMPTY);
  const { ready, watching } = groupObservers([o], new Set());
  assert.deepEqual(ready, []);
  assert.deepEqual(watching.map(x => x.symbol), ['CUSDT']);
});

test('a symbol with neither step in either timeframe is excluded entirely, even if pinned', () => {
  const o = observer('DUSDT', EMPTY, EMPTY);
  const { ready, watching } = groupObservers([o], new Set(['DUSDT']));
  assert.deepEqual(ready, []);
  assert.deepEqual(watching, []);
});

test('within a group, pinned symbols sort first; unpinned keep relative order when no sortWindow is given', () => {
  const a = observer('AUSDT', { step1: true, step2: false }, EMPTY);
  const b = observer('BUSDT', { step1: true, step2: false }, EMPTY);
  const c = observer('CUSDT', { step1: true, step2: false }, EMPTY);
  const { watching } = groupObservers([a, b, c], new Set(['CUSDT']));
  assert.deepEqual(watching.map(x => x.symbol), ['CUSDT', 'AUSDT', 'BUSDT']);
});

test('ready and watching are independently ordered by pin status', () => {
  const readySym = observer('RUSDT', { step1: true, step2: true }, EMPTY);
  const watchSym = observer('WUSDT', { step1: true, step2: false }, EMPTY);
  const { ready, watching } = groupObservers([watchSym, readySym], new Set(['WUSDT']));
  assert.deepEqual(ready.map(x => x.symbol), ['RUSDT']);
  assert.deepEqual(watching.map(x => x.symbol), ['WUSDT']);
});

test('with a sortWindow, unpinned symbols sort descending by that window', () => {
  const low = observer('LOWUSDT', { step1: true, step2: false }, EMPTY, { ...NO_PERFORMANCE, h1: 1 });
  const high = observer('HIGHUSDT', { step1: true, step2: false }, EMPTY, { ...NO_PERFORMANCE, h1: 5 });
  const mid = observer('MIDUSDT', { step1: true, step2: false }, EMPTY, { ...NO_PERFORMANCE, h1: 3 });
  const { watching } = groupObservers([low, high, mid], new Set(), 'h1');
  assert.deepEqual(watching.map(x => x.symbol), ['HIGHUSDT', 'MIDUSDT', 'LOWUSDT']);
});

test('with a sortWindow, null performance values sort last', () => {
  const withValue = observer('VALUEUSDT', { step1: true, step2: false }, EMPTY, { ...NO_PERFORMANCE, h1: -2 });
  const withNull = observer('NULLUSDT', { step1: true, step2: false }, EMPTY, NO_PERFORMANCE);
  const { watching } = groupObservers([withNull, withValue], new Set(), 'h1');
  assert.deepEqual(watching.map(x => x.symbol), ['VALUEUSDT', 'NULLUSDT']);
});

test('a sortWindow sorts within the pinned and unpinned partitions separately — pinned still comes first overall', () => {
  const pinnedLow = observer('PINLOWUSDT', { step1: true, step2: false }, EMPTY, { ...NO_PERFORMANCE, h1: 1 });
  const unpinnedHigh = observer('UNPINHIGHUSDT', { step1: true, step2: false }, EMPTY, { ...NO_PERFORMANCE, h1: 99 });
  const { watching } = groupObservers([unpinnedHigh, pinnedLow], new Set(['PINLOWUSDT']), 'h1');
  assert.deepEqual(watching.map(x => x.symbol), ['PINLOWUSDT', 'UNPINHIGHUSDT']);
});

test('omitting sortWindow (or passing null) preserves today\'s no-sort behavior', () => {
  const a = observer('AUSDT', { step1: true, step2: false }, EMPTY, { ...NO_PERFORMANCE, h1: 1 });
  const b = observer('BUSDT', { step1: true, step2: false }, EMPTY, { ...NO_PERFORMANCE, h1: 99 });
  const withoutArg = groupObservers([a, b], new Set());
  const withNull = groupObservers([a, b], new Set(), null);
  assert.deepEqual(withoutArg.watching.map(x => x.symbol), ['AUSDT', 'BUSDT']);
  assert.deepEqual(withNull.watching.map(x => x.symbol), ['AUSDT', 'BUSDT']);
});
