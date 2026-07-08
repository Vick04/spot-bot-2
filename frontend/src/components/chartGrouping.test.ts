import { test } from 'node:test';
import assert from 'node:assert/strict';
import { groupObservers } from './chartGrouping';
import { ObserverData, TimeframeSignal } from '../types';

const EMPTY: TimeframeSignal = { step1: false, step2: false };

function observer(symbol: string, m1: TimeframeSignal, h1: TimeframeSignal): ObserverData {
  const qualifies = m1.step1 || m1.step2 || h1.step1 || h1.step2;
  return { symbol, qualifies, reasons: { m1, h1 } };
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

test('within a group, pinned symbols sort first; unpinned keep relative order', () => {
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
