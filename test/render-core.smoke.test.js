const { test } = require('node:test');
const assert = require('node:assert/strict');
const RenderCore = require('../js/render-core.js');

/* Proves the Node harness executes real repo code (render-core's pure helpers
 * have no DOM/WebAudio dependency and require() cleanly). */

test('snapLoopSeconds → whole beat cycles', () => {
  assert.equal(RenderCore.snapLoopSeconds(150, 1.5), 150);
});

test('applyEdgeFade zeroes the first in-sample', () => {
  const ch = [new Float32Array([1, 1, 1, 1, 1, 1, 1, 1])];
  RenderCore.applyEdgeFade(ch, 8, 1, 'in');
  assert.equal(ch[0][0], 0);
});
