# kiosk-mode

_One call to put a web page into real kiosk mode: fullscreen, wake lock, orientation lock, gesture and key blocking, idle reset, hidden staff exit gesture._

[![npm version](https://img.shields.io/npm/v/kiosk-mode.svg)](https://www.npmjs.com/package/kiosk-mode)
[![minzipped size](https://img.shields.io/bundlephobia/minzip/kiosk-mode)](https://bundlephobia.com/package/kiosk-mode)
[![license](https://img.shields.io/npm/l/kiosk-mode.svg)](./LICENSE)
[![types](https://img.shields.io/badge/types-included-3178c6.svg)](./dist/index.d.ts)

Zero dependencies. ESM + CJS + IIFE. TypeScript types included. Works with or without React.

## Before / after

```js
// Before — and this is the short version. It still leaks the wake lock the
// moment the tab is hidden, blocks nothing, and can never be undone.
const el = document.documentElement;
let sentinel = null;
try {
  await (el.requestFullscreen ?? el.webkitRequestFullscreen).call(el);
} catch (err) {
  /* was it a missing user gesture? a policy block? no way to tell from `err` */
}
try {
  await screen.orientation.lock('landscape'); // rejects unless fullscreen resolved first
} catch {}
try {
  sentinel = await navigator.wakeLock.request('screen'); // silently dies on tab hide
} catch {}
document.addEventListener('contextmenu', (e) => e.preventDefault());
document.addEventListener('gesturestart', (e) => e.preventDefault());
document.addEventListener('touchmove', (e) => e.touches.length > 1 && e.preventDefault(), { passive: false });
document.body.style.userSelect = 'none';               // now your <input> is unusable
document.documentElement.style.overscrollBehavior = 'none';
window.addEventListener('keydown', (e) => ['F5', 'F11', 'F12'].includes(e.key) && e.preventDefault());
// ...plus a double-tap-zoom tracker, an idle timer, a corner-tap exit gesture,
// a visibilitychange listener to re-acquire the wake lock, and a teardown path
// that undoes every one of the above.

// After
import Kiosk from 'kiosk-mode';
const { applied, skipped } = await Kiosk.enter({ orientation: 'landscape', idleResetMs: 60_000 });
```

`enter()` never throws because one feature is unsupported. It tells you what it got:

```js
applied; // ['fullscreen', 'orientation', 'wakeLock', 'gestures', 'text-selection', 'context-menu', 'key-blocking', 'exit-gesture', 'idle-reset']
skipped; // [{ feature: 'orientation', reason: 'screen.orientation.lock() is not implemented in this browser (no iOS browser has it).' }]
```

## Why this exists

Kiosk mode on the web is five unrelated APIs, each with a quirk that bites you in production. This package is those five quirks, handled:

- **The wake lock silently dies the moment the document is hidden.** This is the headline bug, and nearly every hand-rolled implementation has it. Switch tabs, get a notification, let the OS blank the screen once — the sentinel is released and the browser never gives it back. Your "screen always on" kiosk goes to sleep an hour into the shift. `kiosk-mode` listens for `visibilitychange` (and `fullscreenchange`) and re-acquires the `'screen'` lock every time the page comes back, and reflects the sentinel's own `release` event in state.
- **Fullscreen requires a user gesture, and the rejection is useless.** Chrome throws a `TypeError` saying "Permissions check failed", Firefox rejects with "fullscreen request denied", Safari throws with no message at all. All three mean the same thing. You get one stable `KioskError` with `code: 'fullscreen-requires-gesture'` and a message that tells you what to do — call `enter()` directly from a click handler. Prefixed `webkitRequestFullscreen` / `webkitExitFullscreen` / `webkitFullscreenElement` are used as a fallback.
- **Orientation lock requires an active fullscreen element** on Chromium, and does not exist at all on iOS. So the lock is attempted only after fullscreen has actually resolved (or when the page is an installed PWA), and a failure lands in `skipped` with the browser's own reason instead of taking your whole `enter()` call down.
- **Suppressing browser gestures is not one API.** Pinch-zoom needs WebKit's proprietary `gesturestart`/`gesturechange` plus a `touchmove` handler registered `{ passive: false }`; double-tap-zoom needs a `touchend` interval tracker; pull-to-refresh and rubber-banding need `overscroll-behavior: none`; the iOS long-press callout needs `-webkit-touch-callout`. All of it goes into **one** injected `<style>` element plus a fixed set of listeners, so all of it comes back out.
- **Naive "disable text selection" breaks your own inputs.** Set `user-select: none` on `body` and the kiosk's own name field stops being selectable and its context menu disappears. `input`, `textarea`, `select` and `[contenteditable]` are explicitly exempted from the selection, callout and context-menu suppression. Typing keeps working. This is the detail people discover after shipping.
- **The user can leave fullscreen behind your back.** Esc on desktop fires `fullscreenchange` with a null `fullscreenElement`. Rather than pretend to still be a kiosk, `kiosk-mode` tears everything down and calls `onExit({ reason: 'fullscreen-lost' })` so you can show your own "tap to resume" screen.
- **Everything is reversible.** `exit()` exits fullscreen, releases the wake lock, unlocks orientation, removes the injected stylesheet and root class, removes every listener and clears every timer. `enter()` twice does not double-bind. `exit()` when idle resolves harmlessly.
- **It is SSR-safe.** Importing it in Node throws nothing, `support()` returns all `false`, and `enter()` rejects with `code: 'unsupported-environment'` instead of crashing your render.

## Install

```sh
npm install kiosk-mode
```

Or straight from a CDN — the IIFE build exposes a `Kiosk` global:

```html
<script src="https://unpkg.com/kiosk-mode"></script>
<script>
  document.querySelector('#start').addEventListener('click', () => Kiosk.enter());
</script>
```

## Quick start

```html
<button id="start">Start check-in</button>
<script type="module">
  import Kiosk from 'kiosk-mode';

  // Must be called from a real user gesture, or fullscreen will be refused.
  document.querySelector('#start').addEventListener('click', async () => {
    const result = await Kiosk.enter({
      orientation: 'landscape',
      idleResetMs: 90_000,
      onIdleReset: () => location.reload(),
      onExit: ({ reason }) => console.log('kiosk ended:', reason),
      onError: (err) => console.warn(err.code, err.message),
    });

    console.log('applied:', result.applied);
    for (const { feature, reason } of result.skipped) {
      console.warn('skipped', feature, '—', reason);
    }
  });

  // Staff exit: 4 taps in the top-left corner within 2 seconds (the default).
  Kiosk.subscribe((state) => {
    document.body.dataset.kiosk = String(state.active);
  });
</script>
```

Named imports work too:

```js
import { enter, exit, isActive, getState, subscribe, support } from 'kiosk-mode';
```

## React

```tsx
import { useKiosk } from 'kiosk-mode/react';

export function CheckInScreen() {
  const { state, enter, exit, support } = useKiosk({
    orientation: 'landscape',
    idleResetMs: 60_000,
    onIdleReset: () => window.location.assign('/'),
  });

  if (!state.active) {
    return (
      <button onClick={enter}>
        Tap to start
        {!support.fullscreen && <small> (fullscreen unavailable on this device)</small>}
      </button>
    );
  }

  return (
    <main>
      <Form />
      <footer>{state.wakeLock ? 'Screen locked awake' : 'Screen may sleep'}</footer>
      <button onClick={exit}>Staff exit</button>
    </main>
  );
}
```

- `enter` and `exit` are stable callbacks — pass `enter` straight to `onClick` so the browser sees a real user gesture.
- `state` comes from `useSyncExternalStore` and has a `getServerSnapshot`, so it renders on the server as fully inactive.
- `support` is all-`false` on the server and on the first client render, then fills in after mount. That is deliberate: reading capabilities during render would cause a hydration mismatch.
- If the hook started kiosk mode, unmounting exits it.

## API

### Methods

| Method | Signature | Notes |
| --- | --- | --- |
| `enter` | `(options?: KioskOptions) => Promise<KioskResult>` | Call from a user gesture. Rejects only on `'unsupported-environment'`; every other failure lands in `result.skipped`. Calling it while active exits first. |
| `exit` | `(reason?: KioskExitReason) => Promise<void>` | Restores everything. Harmless when not active. |
| `isActive` | `() => boolean` | `false` on the server. |
| `getState` | `() => KioskState` | Returns the same frozen object until something changes. |
| `subscribe` | `(listener: (state: KioskState) => void) => () => void` | Returns an idempotent unsubscribe. |
| `support` | `() => KioskSupport` | Capability report. Safe on the server (all `false`). |

Pure helpers, exported because they are useful and easy to test: `isInCorner(...)`, `pushTap(...)`, `normalizeOrientation(...)`, `initialTapState`.

### Options

| Option | Type | Default | Description |
| --- | --- | --- | --- |
| `element` | `Element` | `document.documentElement` | Fullscreen target. |
| `fullscreen` | `boolean` | `true` | Request fullscreen. Needs a user gesture. |
| `orientation` | `'landscape' \| 'portrait' \| 'landscape-primary' \| 'portrait-primary' \| 'any' \| null` | `null` | Attempted only once fullscreen has resolved (or on an installed PWA). |
| `wakeLock` | `boolean` | `true` | Hold a `'screen'` wake lock, re-acquiring it whenever the page becomes visible again. |
| `disableContextMenu` | `boolean` | `true` | Blocks right-click / long-press menus outside form fields. |
| `disableTextSelection` | `boolean` | `true` | `user-select: none` everywhere except form fields. |
| `disableGestures` | `boolean` | `true` | Pinch-zoom, double-tap-zoom, pull-to-refresh, iOS callout, overscroll bounce. |
| `blockKeys` | `string[]` | `['F5', 'F11', 'F12']` | `KeyboardEvent.key` values to swallow. `[]` blocks none. |
| `blockModifierKeys` | `boolean \| string[]` | `true` | `true` blocks Ctrl/Cmd + `r p s w f`. Pass your own letters, or `false`. |
| `exitGesture` | `KioskExitGesture \| false` | `{ taps: 4, corner: 'top-left', withinMs: 2000, size: 64 }` | N taps in a screen corner call `exit()`. |
| `idleResetMs` | `number \| null` | `null` | Inactivity before `onIdleReset` fires. Re-arms on the next activity. |
| `onIdleReset` | `() => void` | — | Your reset: reload, clear the form, go back to the attract screen. |
| `onExit` | `(info: { reason: KioskExitReason }) => void` | — | `'api' \| 'gesture' \| 'fullscreen-lost' \| 'visibility'`. |
| `onError` | `(err: KioskError) => void` | — | Every non-fatal failure, normalised. |

`exitGesture` fields: `taps` (default `4`), `corner` (`'top-left' \| 'top-right' \| 'bottom-left' \| 'bottom-right'`, default `'top-left'`), `withinMs` (default `2000`), `size` (hit-square in CSS pixels, default `64`).

### State

| Field | Type | Meaning |
| --- | --- | --- |
| `active` | `boolean` | Kiosk mode is running. |
| `fullscreen` | `boolean` | The document owns a fullscreen element right now. |
| `wakeLock` | `boolean` | A wake lock sentinel is held right now. |
| `orientationLocked` | `boolean` | An orientation lock was applied and not yet released. |
| `idleMs` | `number` | Idle time as of the last state change: `0` after activity, `idleResetMs` when the idle callback fires. Not a live counter — nothing re-renders once a second. |

### Errors

`KioskError extends Error` with `code` and `feature`.

| `code` | When |
| --- | --- |
| `unsupported-environment` | No `window`/`document`. The only reason `enter()` rejects. |
| `fullscreen-requires-gesture` | `requestFullscreen()` ran outside a user gesture. |
| `fullscreen-failed` | Fullscreen failed for any other reason, or the API is absent. |
| `wake-lock-failed` | No Wake Lock API, or the request was refused (not top-level, not HTTPS, low-power mode). |
| `orientation-lock-failed` | `screen.orientation.lock()` is missing or rejected. |
| `callback-failed` | Your `onIdleReset` / `onExit` threw. Teardown continues regardless. |

### Exit reasons

| Reason | Cause |
| --- | --- |
| `api` | You called `exit()`. |
| `gesture` | The corner-tap exit gesture completed. |
| `fullscreen-lost` | The browser left fullscreen (Esc, or the OS). Kiosk mode is torn down. |
| `visibility` | The page is going away (`pagehide`), so everything was released. |

### Exported types

`KioskOptions`, `KioskResult`, `KioskState`, `KioskSupport`, `KioskSkipped`, `KioskExitGesture`, `KioskCorner`, `KioskOrientation`, `KioskOrientationLock`, `KioskExitReason`, `KioskErrorCode`, `KioskError`, `CornerHitTest`, `TapState`, and `UseKioskResult` from `kiosk-mode/react`.

## What kiosk mode can and cannot do on the web

A web page is a guest on someone else's device. Be honest with yourself about the boundary:

**This package does (the in-page layer):** fullscreen, keeps the screen awake, locks orientation where the platform allows, suppresses zoom / pull-to-refresh / context menus / text selection / a list of keys, resets the app when it is left idle, and gives staff a hidden way out.

**No web page can do (the OS layer):** stop Alt+Tab, Cmd+Tab or the app switcher; block Ctrl+W, Cmd+Q or the power button; prevent the user from reaching the address bar, the home screen or another app; survive a device reboot; or stop someone from simply pressing Esc.

For real lockdown you pair this with a platform policy:

| Platform | Mechanism |
| --- | --- |
| ChromeOS / managed Chrome | Kiosk apps or the `KioskAppsToPin` / auto-launch policies |
| Windows | Assigned Access, or Edge/Chrome launched with `--kiosk` |
| Android | Android Enterprise dedicated-device (COSU) mode, or a launcher with screen pinning |
| iOS / iPadOS | Guided Access, or Single App Mode via MDM |
| Linux signage | A window manager launching the browser in `--kiosk` |

The split is clean: the policy stops the user leaving the browser, this package stops the browser getting in the way inside the page.

## Browser support

`support()` is the source of truth on any given device. This table is the shape of the world:

| Platform | Fullscreen | Wake Lock | Orientation lock |
| --- | --- | --- | --- |
| Chrome desktop | Yes | Yes (84+) | API present, but rejects — desktop OSes do not rotate |
| Chrome Android | Yes | Yes (84+) | Yes, once fullscreen is active |
| Edge desktop | Yes | Yes (84+) | Same as Chrome desktop |
| Safari macOS | Yes (standard since 16.4, `webkit`-prefixed before) | Yes (16.4+) | No |
| Safari iOS — iPhone | **No API at all** | Yes (16.4+) | No |
| Safari iPadOS | Prefixed, partial — trust `support().fullscreen` | Yes (16.4+) | No |
| Firefox desktop | Yes | Yes (126+) | API present, rejects on desktop |
| Firefox Android | Yes | Yes (126+) | Yes, once fullscreen is active |

### iOS, plainly

iPhone Safari has **no Fullscreen API** and **no orientation lock**. There is no workaround, and any library claiming otherwise is wrong. `enter()` still applies everything else — wake lock (16.4+), gesture suppression, context-menu suppression, the idle timer and the exit gesture — and reports fullscreen and orientation in `skipped`.

The way to get near-kiosk on iOS is to **install the page to the Home Screen**. Ship a web app manifest:

```json
{
  "name": "Check-in",
  "display": "fullscreen",
  "orientation": "landscape",
  "start_url": "/",
  "background_color": "#0d1117"
}
```

Add `<meta name="apple-mobile-web-app-capable" content="yes">` for older iOS, then **Share → Add to Home Screen**. Launched from that icon the page runs without Safari's chrome, and `support().standalone` is `true`. Combine it with Guided Access (triple-click the side button) and you have a locked terminal. Note that a page opened from the Home Screen still has no Fullscreen API — it simply no longer needs one.

## Recipes

### Self-service terminal that resets itself

```js
const startButton = document.querySelector('#start');

startButton.addEventListener('click', async () => {
  await Kiosk.enter({
    orientation: 'landscape',
    idleResetMs: 120_000,
    onIdleReset: () => {
      form.reset();
      router.navigate('/attract');
    },
    onExit: ({ reason }) => {
      if (reason === 'gesture') router.navigate('/staff');
      else startButton.hidden = false; // fullscreen was lost: offer a way back in
    },
  });
  startButton.hidden = true;
});
```

Kiosk mode cannot re-enter fullscreen on its own — the browser demands a fresh gesture — so the honest pattern is always "show a tap-to-resume button", never a silent retry.

### Digital signage: warn when the screen might sleep

```js
Kiosk.subscribe(({ active, wakeLock }) => {
  banner.hidden = !active || wakeLock;
  banner.textContent = 'Screen may sleep — check device power settings.';
});

await Kiosk.enter({ wakeLock: true, exitGesture: { taps: 5, corner: 'bottom-right', withinMs: 3000 } });
```

### Exam / ordering screen with tighter key blocking

```js
await Kiosk.enter({
  blockKeys: ['F1', 'F3', 'F5', 'F6', 'F11', 'F12', 'Escape'],
  blockModifierKeys: ['r', 'p', 's', 'w', 'f', 'n', 't', 'u', 'i', 'j'],
  disableTextSelection: true,
});
```

`'Escape'` in `blockKeys` stops your own dialogs from closing on Esc — it does **not** stop the browser leaving fullscreen. That is enforced above the page and is not interceptable.

## Gotchas

- **Fullscreen needs a gesture, every time.** Not after an `await`, not in a `setTimeout`, not on `DOMContentLoaded`. `enter()` is `async`, so call it as the first thing in the handler and await it afterwards.
- **Esc ends kiosk mode.** By design: leaving fullscreen tears everything down and fires `onExit({ reason: 'fullscreen-lost' })`. Re-entering requires a new user gesture.
- **Ctrl+W, Cmd+Q, Alt+Tab and the address bar cannot be blocked.** No web API can. See the OS-layer table above.
- **Double-tap suppression affects fast double-clicks.** Two taps within 300 ms outside a form field have their default prevented. If your UI relies on double-click, set `disableGestures: false` and suppress what you need yourself.
- **The wake lock needs a visible, top-level, secure page.** It will not be granted inside a cross-origin iframe, over plain HTTP (except `localhost`), or sometimes when the device is in low-power mode. The failure lands in `skipped` with the browser's reason.
- **Orientation lock rejects on desktop.** The API exists in Chrome and Firefox on desktop but there is nothing to rotate, so the promise rejects. That is normal and is reported, not thrown.
- **`idleMs` is not a ticking clock.** It is `0` after activity and `idleResetMs` when the callback fires. Activity is throttled to once per second so a moving mouse does not burn CPU or spam subscribers.
- **The idle callback fires once per idle period** and re-arms on the next user activity, so an unattended kiosk does not call it in a loop.
- **`pagehide` tears kiosk mode down** with reason `'visibility'`. If the page is restored from the back/forward cache, call `enter()` again from a gesture.
- **One kiosk session per page.** The module holds a single global session; `enter()` while active exits first rather than stacking listeners.

## Contributing

```sh
git clone https://github.com/vishalmeena2211/kiosk-mode.git
cd kiosk-mode
npm install
npm run dev        # tsup --watch
npm run typecheck
npm test           # builds, then runs node:test against dist/
```

The demo at `demo/index.html` loads `../dist/index.global.js` — run `npm run build`, serve the folder (`npx serve .`), and open `demo/index.html`. Fullscreen and wake lock need a real origin, so opening the file directly with `file://` will not show them working.

Issues and pull requests welcome, especially real device reports for the browser support table.

## License

MIT © Vishal Meena
