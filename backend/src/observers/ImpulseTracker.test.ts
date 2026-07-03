import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ImpulseTracker } from './ImpulseTracker';

const MA99 = 100;

// Step 1's price condition is `close < ma99`; the third arg (`hourGateOpen`)
// is the 1h indicator gate. These tests exercise the gate, not the price rule.

test('Step 1 does not set floor when the price condition holds but the 1h gate is closed', () => {
  const tracker = new ImpulseTracker();

  tracker.process(99, MA99, false); // 99 < 100, but gate closed
  assert.equal(tracker.getSnapshot().floor, undefined);
});

test('Step 1 sets floor when the price condition holds AND the 1h gate is open', () => {
  const tracker = new ImpulseTracker();

  tracker.process(99, MA99, true);
  assert.equal(tracker.getSnapshot().floor, 99);
});

test('Step 1 does not set floor when the price condition fails even if the 1h gate is open', () => {
  const tracker = new ImpulseTracker();

  tracker.process(100, MA99, true); // 100 is not < 100
  assert.equal(tracker.getSnapshot().floor, undefined);
});

test('once floor is set, the 1h gate does not gate lowering the floor (Step 2)', () => {
  const tracker = new ImpulseTracker();

  tracker.process(99, MA99, true);
  assert.equal(tracker.getSnapshot().floor, 99);

  // Lower low arrives while the gate is now closed — floor must still drop
  tracker.process(98, MA99, false);
  assert.equal(tracker.getSnapshot().floor, 98);
});

test('a full recovery increments counter and resets floor, regardless of the gate after floor', () => {
  const tracker = new ImpulseTracker();

  const floor = 100;
  tracker.process(floor, MA99 + 1000, true); // ma99 high so close < ma99 → floor set

  // A large recovery clears both allowed and reached thresholds in one move.
  tracker.process(floor * 1.10, MA99 + 1000, false);

  assert.equal(tracker.getSnapshot().counter, 1);
  assert.equal(tracker.getSnapshot().floor, undefined);
});
