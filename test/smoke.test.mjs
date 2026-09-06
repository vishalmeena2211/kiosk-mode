import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import Kiosk, {
  enter,
  exit,
  isActive,
  getState,
  subscribe,
  support,
  isInCorner,
  pushTap,
  normalizeOrientation,
  initialTapState,
  KioskError,
} from '../dist/index.js';

/* -------------------------------------------------------------------------- */
/* 1. SSR safety — this whole file runs in Node with no window or document.    */
/* -------------------------------------------------------------------------- */

test('SSR: importing the package does not touch the DOM', () => {
  assert.equal(typeof globalThis.window, 'undefined');
  assert.equal(typeof globalThis.document, 'undefined');
});

test('SSR: support() reports every capability as false', () => {
  assert.deepEqual(support(), {
    fullscreen: false,
    wakeLock: false,
    orientationLock: false,
    pointerLock: false,
    standalone: false,
  });
});

test('SSR: isActive() is false and getState() is an idle snapshot', () => {
  assert.equal(isActive(), false);
  assert.deepEqual(getState(), {
    active: false,
    fullscreen: false,
    wakeLock: false,
    orientationLocked: false,
    idleMs: 0,
  });
  assert.equal(Object.isFrozen(getState()), true);
});

test('SSR: enter() rejects with a typed unsupported-environment error', async () => {
  await assert.rejects(
    () => enter(),
    (err) => {
      assert.equal(err.name, 'KioskError');
      assert.equal(err.code, 'unsupported-environment');
      assert.match(err.message, /DOM/);
      return true;
    },
  );
});

test('SSR: exit() when not active resolves harmlessly', async () => {
  await exit();
  await exit();
  assert.equal(isActive(), false);
});

test('subscribe() returns an idempotent unsubscribe', () => {
  const unsubscribe = subscribe(() => {});
  assert.equal(typeof unsubscribe, 'function');
  unsubscribe();
  unsubscribe();
});

/* -------------------------------------------------------------------------- */
/* 2. API surface                                                             */
/* -------------------------------------------------------------------------- */

test('every documented export exists with the right type', () => {
  for (const fn of [enter, exit, isActive, getState, subscribe, support, isInCorner, pushTap, normalizeOrientation]) {
    assert.equal(typeof fn, 'function');
  }
  assert.equal(typeof KioskError, 'function');
  assert.deepEqual(initialTapState, { count: 0, firstAt: 0, fired: false });
});

test('the default export mirrors the named exports', () => {
  assert.equal(typeof Kiosk, 'object');
  for (const key of [
    'enter',
    'exit',
    'isActive',
    'getState',
    'subscribe',
    'support',
    'isInCorner',
    'pushTap',
    'normalizeOrientation',
  ]) {
    assert.equal(typeof Kiosk[key], 'function', `Kiosk.${key} should be a function`);
  }
  assert.equal(Kiosk.enter, enter);
  assert.equal(Kiosk.exit, exit);
});

test('KioskError carries a stable code and feature', () => {
  const err = new KioskError('wake-lock-failed', 'nope', { feature: 'wakeLock' });
  assert.ok(err instanceof Error);
  assert.equal(err.name, 'KioskError');
  assert.equal(err.code, 'wake-lock-failed');
  assert.equal(err.feature, 'wakeLock');
  assert.equal(new KioskError('fullscreen-failed', 'x').feature, null);
});

test('all three builds and both type files are emitted', () => {
  const dist = (name) => fileURLToPath(new URL(`../dist/${name}`, import.meta.url));
  for (const file of ['index.js', 'index.cjs', 'index.d.ts', 'react.js', 'react.cjs', 'react.d.ts', 'index.global.js']) {
    assert.equal(existsSync(dist(file)), true, `dist/${file} should exist`);
  }
});

/* -------------------------------------------------------------------------- */
/* 3. Pure logic                                                              */
/* -------------------------------------------------------------------------- */

const VIEWPORT = { width: 1024, height: 768 };

test('isInCorner: hits each of the four corners', () => {
  assert.equal(isInCorner({ x: 10, y: 10, corner: 'top-left', ...VIEWPORT }), true);
  assert.equal(isInCorner({ x: 1020, y: 10, corner: 'top-right', ...VIEWPORT }), true);
  assert.equal(isInCorner({ x: 10, y: 760, corner: 'bottom-left', ...VIEWPORT }), true);
  assert.equal(isInCorner({ x: 1020, y: 760, corner: 'bottom-right', ...VIEWPORT }), true);
});

test('isInCorner: misses the middle of the screen and the wrong corner', () => {
  assert.equal(isInCorner({ x: 512, y: 384, corner: 'top-left', ...VIEWPORT }), false);
  assert.equal(isInCorner({ x: 1020, y: 10, corner: 'top-left', ...VIEWPORT }), false);
  assert.equal(isInCorner({ x: 10, y: 760, corner: 'top-left', ...VIEWPORT }), false);
});

test('isInCorner: respects the default 64px hit area and a custom size', () => {
  assert.equal(isInCorner({ x: 64, y: 64, corner: 'top-left', ...VIEWPORT }), true);
  assert.equal(isInCorner({ x: 65, y: 64, corner: 'top-left', ...VIEWPORT }), false);
  assert.equal(isInCorner({ x: 120, y: 120, corner: 'top-left', size: 160, ...VIEWPORT }), true);
  assert.equal(isInCorner({ x: 10, y: 10, corner: 'top-left', size: 0, ...VIEWPORT }), false);
});

const GESTURE = { taps: 4, withinMs: 2000 };
const tap = (state, t, hit = true) => pushTap(state, { t, hit, ...GESTURE });

test('pushTap: four hits inside the window fire exactly once', () => {
  let s = initialTapState;
  for (const t of [0, 100, 200]) {
    s = tap(s, t);
    assert.equal(s.fired, false);
  }
  s = tap(s, 300);
  assert.equal(s.fired, true);
  assert.equal(s.count, 0);

  // A fifth tap starts a fresh window rather than re-firing.
  s = tap(s, 400);
  assert.equal(s.fired, false);
  assert.equal(s.count, 1);
});

test('pushTap: a tap outside the window restarts the count', () => {
  let s = initialTapState;
  s = tap(s, 0);
  s = tap(s, 100);
  s = tap(s, 200);
  assert.equal(s.count, 3);
  s = tap(s, 2500);
  assert.equal(s.fired, false);
  assert.equal(s.count, 1);
  assert.equal(s.firstAt, 2500);
});

test('pushTap: a miss resets the count to zero', () => {
  let s = initialTapState;
  s = tap(s, 0);
  s = tap(s, 100);
  assert.equal(s.count, 2);
  s = tap(s, 150, false);
  assert.deepEqual(s, { count: 0, firstAt: 0, fired: false });
});

test('pushTap: a single-tap gesture fires immediately', () => {
  const s = pushTap(initialTapState, { t: 0, hit: true, taps: 1, withinMs: 2000 });
  assert.equal(s.fired, true);
});

test('normalizeOrientation: passes through the values the API accepts', () => {
  assert.equal(normalizeOrientation('landscape'), 'landscape');
  assert.equal(normalizeOrientation('portrait'), 'portrait');
  assert.equal(normalizeOrientation('landscape-primary'), 'landscape-primary');
  assert.equal(normalizeOrientation('portrait-primary'), 'portrait-primary');
  assert.equal(normalizeOrientation('any'), 'any');
});

test('normalizeOrientation: null, undefined and junk mean "do not lock"', () => {
  assert.equal(normalizeOrientation(null), null);
  assert.equal(normalizeOrientation(undefined), null);
  assert.equal(normalizeOrientation('sideways'), null);
  assert.equal(normalizeOrientation(''), null);
});
