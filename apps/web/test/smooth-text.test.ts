// Offline tests for the pacing that makes streamed text appear smoothly.
// Run with: npm run test -w @app/web
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MIN_CHARS_PER_SECOND, nextRevealLength, revealCut } from '../src/lib/smoothText';

test('the reveal moves towards the text that has arrived, never past it', () => {
  const next = nextRevealLength(0, 10, 16);
  assert.ok(next > 0 && next < 10);
  assert.equal(nextRevealLength(9.9, 10, 1000), 10);
  assert.equal(nextRevealLength(12, 10, 16), 10);
});

test('a small backlog still moves at the minimum pace', () => {
  const next = nextRevealLength(0, 3, 100);
  assert.ok(Math.abs(next - MIN_CHARS_PER_SECOND * 0.1) < 1e-9 || next === 3);
});

test('a big backlog is caught up faster than a small one', () => {
  const small = nextRevealLength(0, 50, 16);
  const big = nextRevealLength(0, 2000, 16);
  assert.ok(big > small);
});

test('a long pause between frames does not make the text leap', () => {
  assert.equal(nextRevealLength(0, 10_000, 5_000), nextRevealLength(0, 10_000, 100));
});

test('a cut never splits an emoji in half', () => {
  const text = 'hi 😀 there';
  assert.equal(revealCut(text, 4), 5); // 😀 is two code units starting at 3
  assert.equal(revealCut(text, 3), 3);
  assert.equal(revealCut(text, 99), text.length);
  assert.equal(revealCut(text, -1), 0);
});
