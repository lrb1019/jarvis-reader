import assert from 'node:assert/strict';
import test from 'node:test';
import { fitReaderOverlay } from '../src/reader-overlay-bounds.ts';

test('large and low cards fit a narrow reader pane without negative coordinates', () => {
  assert.deepEqual(fitReaderOverlay({ x: 280, y: 420, width: 480, height: 620 }, { width: 300, height: 400 }),
    { x: 16, y: 16, width: 268, height: 368 });
});
test('a loaded dictionary height moves the card up while preserving its width', () => {
  assert.deepEqual(fitReaderOverlay({ x: 40, y: 400, width: 360, height: 500 }, { width: 700, height: 700 }),
    { x: 40, y: 184, width: 360, height: 500 });
});
test('cards keep their requested position when already inside the pane', () => {
  assert.deepEqual(fitReaderOverlay({ x: 40, y: 50, width: 360, height: 220 }, { width: 700, height: 700 }),
    { x: 40, y: 50, width: 360, height: 220 });
});
