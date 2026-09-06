/**
 * Behavioural tests against a hand-rolled fake DOM (no jsdom, no dependencies).
 *
 * These globals are installed before the module is imported, so this file must
 * stay separate from smoke.test.mjs, which asserts the no-DOM behaviour.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

/* --- the smallest DOM that exercises the real code paths ------------------- */

class Target {
  constructor() {
    this.handlers = new Map();
  }
  addEventListener(type, fn) {
    if (!this.handlers.has(type)) this.handlers.set(type, []);
    this.handlers.get(type).push(fn);
  }
  removeEventListener(type, fn) {
    const list = this.handlers.get(type) || [];
    const index = list.indexOf(fn);
    if (index >= 0) list.splice(index, 1);
  }
  listenerCount() {
    let total = 0;
    for (const list of this.handlers.values()) total += list.length;
    return total;
  }
  fire(type, event = {}) {
    for (const fn of (this.handlers.get(type) || []).slice()) fn({ type, preventDefault() {}, ...event });
  }
}

class El extends Target {
  constructor(tag) {
    super();
    this.tagName = tag.toUpperCase();
    this.children = [];
    this.id = '';
    this.textContent = '';
    const classes = new Set();
    this.classList = {
      add: (c) => classes.add(c),
      remove: (c) => classes.delete(c),
      contains: (c) => classes.has(c),
    };
  }
  appendChild(child) {
    this.children.push(child);
    child.parent = this;
    return child;
  }
  remove() {
    if (this.parent) this.parent.children = this.parent.children.filter((c) => c !== this);
  }
  closest() {
    return this.tagName === 'INPUT' ? this : null;
  }
  requestFullscreen() {
    doc.fullscreenElement = this;
    return Promise.resolve();
  }
}

const doc = new (class extends Target {
  constructor() {
    super();
    this.documentElement = new El('html');
    this.head = new El('head');
    this.fullscreenElement = null;
    this.fullscreenEnabled = true;
    this.visibilityState = 'visible';
  }
  createElement(tag) {
    return new El(tag);
  }
  getElementById(id) {
    return this.head.children.find((c) => c.id === id) || null;
  }
  exitFullscreen() {
    this.fullscreenElement = null;
    return Promise.resolve();
  }
})();

const win = new Target();
win.innerWidth = 1024;
win.innerHeight = 768;
win.matchMedia = () => ({ matches: false });
win.PointerEvent = function PointerEvent() {};

let lastSentinel = null;
const wakeLock = {
  requests: 0,
  async request() {
    wakeLock.requests++;
    const sentinel = new Target();
    sentinel.released = false;
    sentinel.release = async () => {
      sentinel.released = true;
      sentinel.fire('release');
    };
    lastSentinel = sentinel;
    return sentinel;
  },
};

const screenStub = {
  orientation: {
    locked: null,
    async lock(type) {
      screenStub.orientation.locked = type;
    },
    unlock() {
      screenStub.orientation.locked = null;
    },
  },
};

globalThis.window = win;
globalThis.document = doc;
globalThis.screen = screenStub;
Object.defineProperty(globalThis, 'navigator', {
  value: { wakeLock, userActivation: { isActive: true } },
  configurable: true,
});

const Kiosk = (await import('../dist/index.js')).default;

const settle = () => new Promise((resolve) => setTimeout(resolve, 10));
const events = [];
const track = {
  onExit: (info) => events.push('exit:' + info.reason),
  onIdleReset: () => events.push('idle'),
  onError: (err) => events.push('error:' + err.code),
};

/* -------------------------------------------------------------------------- */

test('enter() applies every requested feature and reports it', async () => {
  const result = await Kiosk.enter({ orientation: 'landscape', idleResetMs: 50, ...track });

  assert.deepEqual(result.skipped, []);
  assert.deepEqual(result.applied, [
    'fullscreen',
    'orientation',
    'wakeLock',
    'gestures',
    'text-selection',
    'context-menu',
    'key-blocking',
    'exit-gesture',
    'idle-reset',
  ]);
  assert.equal(doc.fullscreenElement, doc.documentElement);
  assert.equal(screenStub.orientation.locked, 'landscape');
  assert.equal(doc.documentElement.classList.contains('kiosk-mode-active'), true);
  assert.equal(doc.head.children.some((c) => c.id === 'kiosk-mode-style'), true);
  assert.equal(Kiosk.isActive(), true);
  assert.equal(Kiosk.getState().wakeLock, true);
});

test('the wake lock is re-acquired after the browser silently releases it', async () => {
  assert.equal(wakeLock.requests, 1);

  // Exactly what a browser does when the document is hidden.
  await lastSentinel.release();
  assert.equal(Kiosk.getState().wakeLock, false);

  doc.visibilityState = 'visible';
  doc.fire('visibilitychange');
  await settle();

  assert.equal(wakeLock.requests, 2);
  assert.equal(Kiosk.getState().wakeLock, true);
});

test('the context menu is blocked outside form fields and allowed inside them', () => {
  let prevented = false;
  doc.fire('contextmenu', { target: doc.documentElement, preventDefault: () => (prevented = true) });
  assert.equal(prevented, true);

  prevented = false;
  doc.fire('contextmenu', { target: new El('input'), preventDefault: () => (prevented = true) });
  assert.equal(prevented, false, 'typing and editing must keep working inside a kiosk');
});

test('blocked keys are swallowed and ordinary typing is not', () => {
  const press = (event) => {
    let prevented = false;
    win.fire('keydown', { ...event, preventDefault: () => (prevented = true) });
    return prevented;
  };
  assert.equal(press({ key: 'F5' }), true);
  assert.equal(press({ key: 'F12' }), true);
  assert.equal(press({ key: 'r', ctrlKey: true }), true);
  assert.equal(press({ key: 'p', metaKey: true }), true);
  assert.equal(press({ key: 'a' }), false);
  assert.equal(press({ key: 'r' }), false);
});

test('the idle timer fires once and reports idleMs', async () => {
  await new Promise((resolve) => setTimeout(resolve, 90));
  assert.equal(events.filter((e) => e === 'idle').length, 1);
  assert.equal(Kiosk.getState().idleMs, 50);
});

test('four corner taps run the exit gesture and restore the page completely', async () => {
  for (let i = 0; i < 4; i++) win.fire('pointerdown', { clientX: 10, clientY: 10 });
  await settle();

  assert.equal(events.includes('exit:gesture'), true);
  assert.equal(Kiosk.isActive(), false);
  assert.equal(doc.fullscreenElement, null, 'fullscreen exited');
  assert.equal(screenStub.orientation.locked, null, 'orientation unlocked');
  assert.equal(doc.head.children.length, 0, 'injected stylesheet removed');
  assert.equal(doc.documentElement.classList.contains('kiosk-mode-active'), false, 'root class removed');
  assert.equal(doc.listenerCount(), 0, 'every document listener removed');
  assert.equal(win.listenerCount(), 0, 'every window listener removed');
  assert.deepEqual(Kiosk.getState(), {
    active: false,
    fullscreen: false,
    wakeLock: false,
    orientationLocked: false,
    idleMs: 0,
  });
});

test('taps outside the corner never fire the gesture', async () => {
  await Kiosk.enter({ wakeLock: false, ...track });
  for (let i = 0; i < 8; i++) win.fire('pointerdown', { clientX: 512, clientY: 384 });
  await settle();
  assert.equal(Kiosk.isActive(), true);
  await Kiosk.exit();
  assert.equal(events.at(-1), 'exit:api');
});

test('enter() twice does not double-bind listeners', async () => {
  await Kiosk.enter({ wakeLock: false, ...track });
  const bound = doc.listenerCount() + win.listenerCount();
  await Kiosk.enter({ wakeLock: false, ...track });
  assert.equal(doc.listenerCount() + win.listenerCount(), bound);
  await Kiosk.exit();
  assert.equal(doc.listenerCount() + win.listenerCount(), 0);
});

test('losing fullscreen from outside tears kiosk mode down', async () => {
  events.length = 0;
  await Kiosk.enter({ wakeLock: false, ...track });

  doc.fullscreenElement = null; // the user pressed Esc
  doc.fire('fullscreenchange');
  await settle();

  assert.equal(events.includes('exit:fullscreen-lost'), true);
  assert.equal(Kiosk.isActive(), false);
  assert.equal(doc.listenerCount() + win.listenerCount(), 0);
});

test('unsupported features are skipped with a reason, never thrown', async () => {
  Object.defineProperty(globalThis, 'navigator', { value: {}, configurable: true });

  const result = await Kiosk.enter({ fullscreen: false, wakeLock: true, orientation: 'portrait', ...track });

  assert.equal(result.active, true);
  const features = result.skipped.map((s) => s.feature).sort();
  assert.deepEqual(features, ['orientation', 'wakeLock']);
  for (const { reason } of result.skipped) assert.ok(reason.length > 20, 'a skip reason must be actionable');
  assert.equal(events.includes('error:wake-lock-failed'), true);

  await Kiosk.exit();
  assert.equal(doc.listenerCount() + win.listenerCount(), 0);
});
