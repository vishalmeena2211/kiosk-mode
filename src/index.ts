/**
 * kiosk-mode — put a web page into true kiosk mode with one call.
 *
 * Fullscreen, screen wake lock, orientation lock, gesture/context-menu/key
 * suppression, an idle reset timer and a hidden staff exit gesture — all
 * best-effort per platform, all fully reversible.
 */

/* -------------------------------------------------------------------------- */
/* Types                                                                      */
/* -------------------------------------------------------------------------- */

/** Screen corner used by the hidden exit gesture. */
export type KioskCorner = 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right';

/** Orientation values accepted by {@link KioskOptions.orientation}. */
export type KioskOrientation =
  | 'landscape'
  | 'portrait'
  | 'landscape-primary'
  | 'portrait-primary'
  | 'any'
  | null;

/** The subset of `OrientationLockType` this package will hand to the browser. */
export type KioskOrientationLock = 'landscape' | 'portrait' | 'landscape-primary' | 'portrait-primary' | 'any';

/** Why kiosk mode ended. */
export type KioskExitReason =
  /** {@link exit} was called by your code. */
  | 'api'
  /** The staff exit gesture (N taps in a corner) was performed. */
  | 'gesture'
  /** The browser left fullscreen behind our back — usually the Esc key. */
  | 'fullscreen-lost'
  /** The page is going away (`pagehide`), so kiosk mode was torn down. */
  | 'visibility';

/** Stable error codes surfaced through {@link KioskOptions.onError} and rejected promises. */
export type KioskErrorCode =
  /** No `window`/`document` — server-side rendering or a worker. */
  | 'unsupported-environment'
  /** `requestFullscreen()` was called outside a user gesture and the browser refused. */
  | 'fullscreen-requires-gesture'
  /** Fullscreen failed for any other reason (or the API is absent). */
  | 'fullscreen-failed'
  /** The Screen Wake Lock API is missing, blocked by policy, or rejected the request. */
  | 'wake-lock-failed'
  /** `screen.orientation.lock()` is missing or rejected. */
  | 'orientation-lock-failed'
  /** One of your own callbacks (`onIdleReset`, `onExit`) threw. */
  | 'callback-failed';

/** A normalised error. Always an `Error`; `code` is stable across browsers. */
export class KioskError extends Error {
  /** Stable, machine-readable reason. */
  readonly code: KioskErrorCode;
  /** Which feature failed (`'fullscreen'`, `'wakeLock'`, `'orientation'`), when applicable. */
  readonly feature: string | null;

  constructor(code: KioskErrorCode, message: string, options?: { feature?: string; cause?: unknown }) {
    super(message);
    this.name = 'KioskError';
    this.code = code;
    this.feature = options?.feature ?? null;
    if (options && 'cause' in options) (this as { cause?: unknown }).cause = options.cause;
  }
}

/** What the current browser can actually do. All booleans, all safe to read on a server. */
export interface KioskSupport {
  /** Fullscreen API (standard or `webkit`-prefixed) is present. `false` on iPhone Safari. */
  fullscreen: boolean;
  /** Screen Wake Lock API (`navigator.wakeLock`) is present. */
  wakeLock: boolean;
  /** `screen.orientation.lock()` is present. `false` on all iOS browsers. */
  orientationLock: boolean;
  /** Pointer Lock API is present (not used by this package; reported for completeness). */
  pointerLock: boolean;
  /** The page is running as an installed PWA (`display-mode: standalone` or iOS `navigator.standalone`). */
  standalone: boolean;
}

/** A snapshot of kiosk state. Immutable — a new object is produced on every change. */
export interface KioskState {
  /** Kiosk mode is running. */
  active: boolean;
  /** The document currently owns a fullscreen element. */
  fullscreen: boolean;
  /** A screen wake lock sentinel is currently held. */
  wakeLock: boolean;
  /** An orientation lock was applied and has not been released. */
  orientationLocked: boolean;
  /**
   * Milliseconds of inactivity as of the last state change: `0` right after user
   * activity, and `idleResetMs` at the moment `onIdleReset` fires. It is not a
   * live-ticking counter — nothing here re-renders once a second.
   */
  idleMs: number;
}

/** One feature that could not be applied, and the browser's reason. */
export interface KioskSkipped {
  /** `'fullscreen' | 'orientation' | 'wakeLock' | ...` */
  feature: string;
  /** Human-readable explanation, including the browser's own message where there was one. */
  reason: string;
}

/** The outcome of {@link enter}. Kiosk mode is best-effort: read `skipped` to see what did not apply. */
export interface KioskResult {
  /** Always `true` — {@link enter} rejects rather than returning an inactive result. */
  active: true;
  /** Features that were applied, e.g. `['fullscreen', 'wakeLock', 'gestures']`. */
  applied: string[];
  /** Features that were requested but could not be applied, each with a reason. */
  skipped: KioskSkipped[];
}

/** Configuration for the hidden staff exit gesture. */
export interface KioskExitGesture {
  /** Number of taps required. Default `4`. */
  taps?: number;
  /** Which corner the taps must land in. Default `'top-left'`. */
  corner?: KioskCorner;
  /** All taps must happen inside this window, in ms. Default `2000`. */
  withinMs?: number;
  /** Size of the square hit area in CSS pixels. Default `64`. */
  size?: number;
}

/** Options for {@link enter}. Every field is optional. */
export interface KioskOptions {
  /** Element to make fullscreen. Default `document.documentElement`. */
  element?: Element;
  /** Request fullscreen. Default `true`. Requires a user gesture — see the README. */
  fullscreen?: boolean;
  /** Orientation to lock to after fullscreen resolves. Default `null` (do not lock). */
  orientation?: KioskOrientation;
  /** Hold a screen wake lock so the display never sleeps. Default `true`. */
  wakeLock?: boolean;
  /** Suppress the right-click / long-press context menu outside form fields. Default `true`. */
  disableContextMenu?: boolean;
  /** Suppress text selection outside form fields. Default `true`. */
  disableTextSelection?: boolean;
  /** Suppress pinch-zoom, double-tap-zoom, pull-to-refresh, the iOS callout and overscroll bounce. Default `true`. */
  disableGestures?: boolean;
  /**
   * Key names (`KeyboardEvent.key`) to swallow. Default `['F5', 'F11', 'F12']`.
   * Pass `[]` to block nothing.
   */
  blockKeys?: string[];
  /**
   * Swallow Ctrl/Cmd shortcuts. `true` (default) blocks `r, p, s, w, f`;
   * pass your own array of letters, or `false` to block none.
   *
   * Browsers do **not** let a page block Ctrl+W, Cmd+Q, Alt+Tab or the address
   * bar. Real lockdown needs an OS-level or managed-browser policy.
   */
  blockModifierKeys?: boolean | string[];
  /** Hidden staff exit gesture. Default `{ taps: 4, corner: 'top-left', withinMs: 2000 }`. Pass `false` to disable. */
  exitGesture?: KioskExitGesture | false;
  /** Milliseconds of no pointer/key/touch activity before {@link KioskOptions.onIdleReset} fires. Default `null` (off). */
  idleResetMs?: number | null;
  /** Called once when the idle window elapses. Re-arms on the next user activity. */
  onIdleReset?: () => void;
  /** Called when kiosk mode ends, whatever the cause. */
  onExit?: (info: { reason: KioskExitReason }) => void;
  /** Called for every non-fatal failure. {@link enter} never rejects because one optional feature failed. */
  onError?: (err: KioskError) => void;
}

/* -------------------------------------------------------------------------- */
/* Pure helpers (no DOM — these are the unit-tested core)                      */
/* -------------------------------------------------------------------------- */

/** Input for {@link isInCorner}. */
export interface CornerHitTest {
  /** Pointer X in CSS pixels, relative to the viewport. */
  x: number;
  /** Pointer Y in CSS pixels, relative to the viewport. */
  y: number;
  /** Corner to test against. */
  corner: KioskCorner;
  /** Square hit-area size in CSS pixels. Default `64`. */
  size?: number;
  /** Viewport width. */
  width: number;
  /** Viewport height. */
  height: number;
}

/**
 * Is a point inside the given screen corner?
 *
 * ```ts
 * isInCorner({ x: 10, y: 10, corner: 'top-left', width: 1024, height: 768 }); // true
 * ```
 */
export function isInCorner(input: CornerHitTest): boolean {
  const size = input.size ?? DEFAULT_CORNER_SIZE;
  const { x, y, width, height } = input;
  if (!(size > 0)) return false;
  const left = x >= 0 && x <= size;
  const right = x <= width && x >= width - size;
  const top = y >= 0 && y <= size;
  const bottom = y <= height && y >= height - size;
  switch (input.corner) {
    case 'top-left':
      return left && top;
    case 'top-right':
      return right && top;
    case 'bottom-left':
      return left && bottom;
    case 'bottom-right':
      return right && bottom;
    default:
      return false;
  }
}

/** State carried between taps of the exit gesture. */
export interface TapState {
  /** Taps accumulated in the current window. */
  count: number;
  /** Timestamp of the first tap in the current window. */
  firstAt: number;
  /** The gesture completed on this tap. */
  fired: boolean;
}

/** A fresh, un-started tap state. */
export const initialTapState: TapState = Object.freeze({ count: 0, firstAt: 0, fired: false });

/**
 * Fold one tap into the exit-gesture state machine.
 *
 * - A tap that misses the corner (`hit: false`) resets the counter.
 * - A tap later than `withinMs` after the first one starts a new window.
 * - Reaching `taps` sets `fired: true` **once** and resets the counter, so
 *   holding a finger down in the corner cannot fire it repeatedly.
 *
 * ```ts
 * let s = initialTapState;
 * for (const t of [0, 100, 200, 300]) s = pushTap(s, { t, hit: true, taps: 4, withinMs: 2000 });
 * s.fired; // true
 * ```
 */
export function pushTap(
  state: TapState,
  input: { t: number; hit: boolean; taps: number; withinMs: number },
): TapState {
  if (!input.hit) return { count: 0, firstAt: 0, fired: false };
  const startsNewWindow = state.count === 0 || input.t - state.firstAt > input.withinMs;
  const count = startsNewWindow ? 1 : state.count + 1;
  const firstAt = startsNewWindow ? input.t : state.firstAt;
  const needed = Math.max(1, Math.floor(input.taps));
  if (count >= needed) return { count: 0, firstAt: 0, fired: true };
  return { count, firstAt, fired: false };
}

/**
 * Map a {@link KioskOrientation} to the string handed to `screen.orientation.lock()`.
 * Returns `null` for `null`, `undefined` and anything unrecognised — meaning
 * "do not attempt a lock".
 *
 * ```ts
 * normalizeOrientation('landscape'); // 'landscape'
 * normalizeOrientation(null);        // null
 * ```
 */
export function normalizeOrientation(orientation: KioskOrientation | undefined): KioskOrientationLock | null {
  switch (orientation) {
    case 'landscape':
    case 'portrait':
    case 'landscape-primary':
    case 'portrait-primary':
    case 'any':
      return orientation;
    default:
      return null;
  }
}

/* -------------------------------------------------------------------------- */
/* Internals                                                                  */
/* -------------------------------------------------------------------------- */

const STYLE_ID = 'kiosk-mode-style';
const ROOT_CLASS = 'kiosk-mode-active';
const DEFAULT_CORNER_SIZE = 64;
const DEFAULT_BLOCK_KEYS: readonly string[] = ['F5', 'F11', 'F12'];
const DEFAULT_MODIFIER_KEYS: readonly string[] = ['r', 'p', 's', 'w', 'f'];
const DOUBLE_TAP_MS = 300;
const ACTIVITY_THROTTLE_MS = 1000;
const FIELD_SELECTOR = 'input, textarea, select, [contenteditable]';

interface WakeLockSentinelLike extends EventTarget {
  released: boolean;
  release(): Promise<void>;
}

interface WakeLockLike {
  request(type: 'screen'): Promise<WakeLockSentinelLike>;
}

const IDLE_STATE: KioskState = Object.freeze({
  active: false,
  fullscreen: false,
  wakeLock: false,
  orientationLocked: false,
  idleMs: 0,
});

let state: KioskState = IDLE_STATE;
let listeners: Array<(s: KioskState) => void> = [];

interface ResolvedConfig {
  element: Element | null;
  fullscreen: boolean;
  orientation: KioskOrientation;
  wakeLock: boolean;
  disableContextMenu: boolean;
  disableTextSelection: boolean;
  disableGestures: boolean;
  blockKeys: string[];
  modifierKeys: string[];
  exitGesture: Required<KioskExitGesture> | false;
  idleResetMs: number | null;
  onIdleReset?: () => void;
  onExit?: (info: { reason: KioskExitReason }) => void;
  onError?: (err: KioskError) => void;
}

const DEFAULT_CONFIG: ResolvedConfig = {
  element: null,
  fullscreen: true,
  orientation: null,
  wakeLock: true,
  disableContextMenu: true,
  disableTextSelection: true,
  disableGestures: true,
  blockKeys: [],
  modifierKeys: [],
  exitGesture: false,
  idleResetMs: null,
};

let running = false;
let config: ResolvedConfig = DEFAULT_CONFIG;

let cleanups: Array<() => void> = [];
let sentinel: WakeLockSentinelLike | null = null;
let idleTimer: ReturnType<typeof setTimeout> | null = null;
let lastActivityAt = 0;
let lastTouchEndAt = 0;
let tapState: TapState = initialTapState;
let orientationWasLocked = false;
let fullscreenApplied = false;
let exiting = false;

function hasDOM(): boolean {
  return typeof window !== 'undefined' && typeof document !== 'undefined';
}

function setState(patch: Partial<KioskState>): void {
  const next: KioskState = { ...state, ...patch };
  if (
    next.active === state.active &&
    next.fullscreen === state.fullscreen &&
    next.wakeLock === state.wakeLock &&
    next.orientationLocked === state.orientationLocked &&
    next.idleMs === state.idleMs
  ) {
    return;
  }
  state = Object.freeze(next);
  for (const listener of listeners.slice()) listener(state);
}

function emitError(err: KioskError): void {
  try {
    config.onError?.(err);
  } catch {
    /* a throwing onError must not break teardown */
  }
}

function on(
  target: EventTarget,
  type: string,
  handler: (event: never) => void,
  options?: AddEventListenerOptions,
): void {
  target.addEventListener(type, handler as EventListener, options);
  cleanups.push(() => target.removeEventListener(type, handler as EventListener, options));
}

function inFormField(target: EventTarget | null): boolean {
  const el = target as Element | null;
  if (!el || typeof (el as Element).closest !== 'function') return false;
  return el.closest(FIELD_SELECTOR) !== null;
}

/* --- vendor-prefixed fullscreen --------------------------------------------- */

interface PrefixedDocument extends Document {
  webkitFullscreenElement?: Element | null;
  webkitExitFullscreen?: () => Promise<void> | void;
  webkitFullscreenEnabled?: boolean;
}

interface PrefixedElement extends Element {
  webkitRequestFullscreen?: (options?: FullscreenOptions) => Promise<void> | void;
}

function fullscreenElement(): Element | null {
  if (!hasDOM()) return null;
  const doc = document as PrefixedDocument;
  return doc.fullscreenElement ?? doc.webkitFullscreenElement ?? null;
}

function fullscreenAvailable(): boolean {
  if (!hasDOM()) return false;
  const doc = document as PrefixedDocument;
  const el = document.documentElement as PrefixedElement;
  const hasMethod = typeof el.requestFullscreen === 'function' || typeof el.webkitRequestFullscreen === 'function';
  const enabled = doc.fullscreenEnabled ?? doc.webkitFullscreenEnabled ?? true;
  return hasMethod && enabled !== false;
}

function requestFullscreen(element: Element): Promise<void> {
  const el = element as PrefixedElement;
  const method = el.requestFullscreen ?? el.webkitRequestFullscreen;
  if (typeof method !== 'function') {
    return Promise.reject(
      new KioskError('fullscreen-failed', 'This browser has no Fullscreen API (iPhone Safari never has).', {
        feature: 'fullscreen',
      }),
    );
  }
  try {
    return Promise.resolve(method.call(el, { navigationUI: 'hide' } as FullscreenOptions));
  } catch (err) {
    return Promise.reject(err);
  }
}

function exitFullscreen(): Promise<void> {
  if (!hasDOM() || !fullscreenElement()) return Promise.resolve();
  const doc = document as PrefixedDocument;
  const method = doc.exitFullscreen ?? doc.webkitExitFullscreen;
  if (typeof method !== 'function') return Promise.resolve();
  try {
    return Promise.resolve(method.call(doc)).catch(() => undefined);
  } catch {
    return Promise.resolve();
  }
}

function describe(err: unknown): string {
  if (err instanceof Error) return err.message || err.name;
  return String(err);
}

/**
 * Fullscreen rejections are wildly inconsistent between engines: Chrome throws a
 * `TypeError` with "Permissions check failed", Firefox a plain rejection with
 * "fullscreen request denied", Safari a `TypeError` with no message at all.
 * Anything that smells like a missing user gesture becomes one stable code.
 */
function classifyFullscreenError(err: unknown): KioskError {
  const message = describe(err);
  const userActivation = (navigator as Navigator & { userActivation?: { isActive: boolean } }).userActivation;
  const looksLikeGesture =
    /gesture|user activation|permissions check|denied|not allowed|notallowederror/i.test(message) ||
    (err instanceof Error && err.name === 'NotAllowedError') ||
    (!!userActivation && userActivation.isActive === false);
  if (looksLikeGesture) {
    return new KioskError(
      'fullscreen-requires-gesture',
      'requestFullscreen() was refused because it did not run inside a user gesture. ' +
        'Call Kiosk.enter() directly from a click/touch handler (not after an await, a timer, or on page load). ' +
        `Browser said: ${message || 'no message'}`,
      { feature: 'fullscreen', cause: err },
    );
  }
  return new KioskError('fullscreen-failed', `Fullscreen request failed: ${message}`, {
    feature: 'fullscreen',
    cause: err,
  });
}

/* --- wake lock -------------------------------------------------------------- */

function wakeLockApi(): WakeLockLike | null {
  if (!hasDOM()) return null;
  const nav = navigator as Navigator & { wakeLock?: WakeLockLike };
  return nav.wakeLock ?? null;
}

async function acquireWakeLock(): Promise<void> {
  if (!running || !config.wakeLock) return;
  if (sentinel && !sentinel.released) return;
  const api = wakeLockApi();
  if (!api) {
    throw new KioskError('wake-lock-failed', 'The Screen Wake Lock API is not available in this browser.', {
      feature: 'wakeLock',
    });
  }
  try {
    const next = await api.request('screen');
    if (!running) {
      // enter() was cancelled while we were awaiting — do not leak the sentinel.
      void next.release().catch(() => undefined);
      return;
    }
    sentinel = next;
    next.addEventListener('release', () => {
      if (sentinel === next) sentinel = null;
      setState({ wakeLock: false });
    });
    setState({ wakeLock: true });
  } catch (err) {
    throw new KioskError(
      'wake-lock-failed',
      `Could not acquire a screen wake lock: ${describe(err)}. ` +
        'This usually means the page is not top-level, is not served over HTTPS, or the device is on low power mode.',
      { feature: 'wakeLock', cause: err },
    );
  }
}

async function releaseWakeLock(): Promise<void> {
  const current = sentinel;
  sentinel = null;
  if (!current) return;
  try {
    await current.release();
  } catch {
    /* already released by the browser */
  }
}

/* --- orientation ------------------------------------------------------------ */

interface OrientationLike {
  lock?: (type: string) => Promise<void>;
  unlock?: () => void;
}

function orientationApi(): OrientationLike | null {
  if (!hasDOM() || typeof screen === 'undefined') return null;
  return (screen as Screen & { orientation?: OrientationLike }).orientation ?? null;
}

/* --- injected stylesheet ---------------------------------------------------- */

function buildCss(options: { gestures: boolean; textSelection: boolean }): string {
  const blocks: string[] = [];
  if (options.gestures) {
    blocks.push(
      `.${ROOT_CLASS}, .${ROOT_CLASS} body {` +
        'touch-action: manipulation;' +
        'overscroll-behavior: none;' +
        '-webkit-overflow-scrolling: touch;' +
        '-webkit-tap-highlight-color: transparent;' +
        '}',
      `.${ROOT_CLASS} * { -webkit-touch-callout: none; }`,
      `.${ROOT_CLASS} img, .${ROOT_CLASS} a { -webkit-user-drag: none; user-drag: none; }`,
    );
  }
  if (options.textSelection) {
    blocks.push(
      `.${ROOT_CLASS}, .${ROOT_CLASS} body, .${ROOT_CLASS} * {` +
        '-webkit-user-select: none;' +
        '-moz-user-select: none;' +
        'user-select: none;' +
        '}',
    );
  }
  if (options.gestures || options.textSelection) {
    // Form fields must stay usable — a kiosk with uneditable inputs is useless.
    blocks.push(
      `.${ROOT_CLASS} input, .${ROOT_CLASS} textarea, .${ROOT_CLASS} select, .${ROOT_CLASS} [contenteditable], .${ROOT_CLASS} [contenteditable] * {` +
        '-webkit-user-select: text;' +
        '-moz-user-select: text;' +
        'user-select: text;' +
        '-webkit-touch-callout: default;' +
        '}',
    );
  }
  return blocks.join('\n');
}

function injectStyle(css: string): void {
  const existing = document.getElementById(STYLE_ID);
  if (existing) existing.remove();
  const style = document.createElement('style');
  style.id = STYLE_ID;
  style.textContent = css;
  document.head.appendChild(style);
  document.documentElement.classList.add(ROOT_CLASS);
  cleanups.push(() => {
    style.remove();
    document.documentElement.classList.remove(ROOT_CLASS);
  });
}

/* --- idle timer -------------------------------------------------------------- */

function clearIdleTimer(): void {
  if (idleTimer !== null) {
    clearTimeout(idleTimer);
    idleTimer = null;
  }
}

function armIdleTimer(): void {
  clearIdleTimer();
  const ms = config.idleResetMs;
  if (ms === null || !(ms > 0)) return;
  idleTimer = setTimeout(() => {
    idleTimer = null;
    setState({ idleMs: ms });
    try {
      config.onIdleReset?.();
    } catch (err) {
      emitError(new KioskError('callback-failed', `onIdleReset threw: ${describe(err)}`, { cause: err }));
    }
  }, ms);
}

function noteActivity(): void {
  const now = Date.now();
  if (now - lastActivityAt < ACTIVITY_THROTTLE_MS) return;
  lastActivityAt = now;
  setState({ idleMs: 0 });
  armIdleTimer();
}

/* -------------------------------------------------------------------------- */
/* Public API                                                                 */
/* -------------------------------------------------------------------------- */

/**
 * What this browser can do. Safe to call anywhere, including on a server, where
 * every field is `false`.
 */
export function support(): KioskSupport {
  if (!hasDOM()) {
    return { fullscreen: false, wakeLock: false, orientationLock: false, pointerLock: false, standalone: false };
  }
  const orientation = orientationApi();
  const iosStandalone = (navigator as Navigator & { standalone?: boolean }).standalone === true;
  const displayModeStandalone =
    typeof window.matchMedia === 'function' && window.matchMedia('(display-mode: standalone)').matches;
  return {
    fullscreen: fullscreenAvailable(),
    wakeLock: wakeLockApi() !== null,
    orientationLock: typeof orientation?.lock === 'function',
    pointerLock: typeof (document.documentElement as Element & { requestPointerLock?: unknown }).requestPointerLock === 'function',
    standalone: displayModeStandalone || iosStandalone,
  };
}

/** Is kiosk mode currently running? `false` on a server. */
export function isActive(): boolean {
  return state.active;
}

/** The current state snapshot. The same frozen object is returned until something changes. */
export function getState(): KioskState {
  return state;
}

/**
 * Subscribe to state changes. Returns an unsubscribe function.
 *
 * ```ts
 * const stop = Kiosk.subscribe((s) => console.log(s.fullscreen, s.wakeLock));
 * ```
 */
export function subscribe(listener: (state: KioskState) => void): () => void {
  listeners.push(listener);
  let done = false;
  return () => {
    if (done) return;
    done = true;
    listeners = listeners.filter((l) => l !== listener);
  };
}

/**
 * Enter kiosk mode.
 *
 * **Call this from a click or touch handler.** Fullscreen is only granted inside
 * a user gesture; everything else works regardless.
 *
 * Never rejects because one optional feature is unsupported — inspect
 * {@link KioskResult.skipped} to see exactly what did not apply and why. It
 * rejects only when there is no DOM at all (`'unsupported-environment'`).
 *
 * Calling it while already active exits first, so listeners are never doubled up.
 *
 * ```ts
 * button.addEventListener('click', async () => {
 *   const result = await Kiosk.enter({ orientation: 'landscape', idleResetMs: 60_000 });
 *   console.log(result.applied, result.skipped);
 * });
 * ```
 */
export async function enter(options: KioskOptions = {}): Promise<KioskResult> {
  if (!hasDOM()) {
    throw new KioskError(
      'unsupported-environment',
      'kiosk-mode needs a DOM. There is no window/document here (server-side render or worker).',
    );
  }
  if (running) await exit();

  const gesture =
    options.exitGesture === false
      ? (false as const)
      : {
          taps: options.exitGesture?.taps ?? 4,
          corner: options.exitGesture?.corner ?? 'top-left',
          withinMs: options.exitGesture?.withinMs ?? 2000,
          size: options.exitGesture?.size ?? DEFAULT_CORNER_SIZE,
        };

  const modifierKeys =
    options.blockModifierKeys === false
      ? []
      : Array.isArray(options.blockModifierKeys)
        ? options.blockModifierKeys.map((k) => k.toLowerCase())
        : DEFAULT_MODIFIER_KEYS.slice();

  config = {
    element: options.element ?? document.documentElement,
    fullscreen: options.fullscreen ?? true,
    orientation: options.orientation ?? null,
    wakeLock: options.wakeLock ?? true,
    disableContextMenu: options.disableContextMenu ?? true,
    disableTextSelection: options.disableTextSelection ?? true,
    disableGestures: options.disableGestures ?? true,
    blockKeys: options.blockKeys ?? DEFAULT_BLOCK_KEYS.slice(),
    exitGesture: gesture,
    idleResetMs: options.idleResetMs ?? null,
    modifierKeys,
    onIdleReset: options.onIdleReset,
    onExit: options.onExit,
    onError: options.onError,
  };

  running = true;
  exiting = false;
  tapState = initialTapState;
  lastActivityAt = 0;
  lastTouchEndAt = 0;
  orientationWasLocked = false;
  fullscreenApplied = false;

  const applied: string[] = [];
  const skipped: KioskSkipped[] = [];
  const caps = support();

  /* 1. Fullscreen — must come first, orientation lock depends on it. */
  if (config.fullscreen) {
    if (!caps.fullscreen) {
      skipped.push({
        feature: 'fullscreen',
        reason:
          'No Fullscreen API in this browser. On iPhone Safari there is none at all — install the page to the Home Screen for a fullscreen web app manifest instead.',
      });
    } else {
      try {
        await requestFullscreen(config.element ?? document.documentElement);
        fullscreenApplied = true;
        applied.push('fullscreen');
      } catch (err) {
        const kioskError = classifyFullscreenError(err);
        emitError(kioskError);
        skipped.push({ feature: 'fullscreen', reason: kioskError.message });
      }
    }
  }
  setState({ fullscreen: fullscreenElement() !== null });

  /* 2. Orientation — Chromium requires fullscreen (or an installed PWA); iOS has none. */
  const lockType = normalizeOrientation(config.orientation);
  if (lockType) {
    const orientation = orientationApi();
    if (!caps.orientationLock || !orientation?.lock) {
      skipped.push({
        feature: 'orientation',
        reason: 'screen.orientation.lock() is not implemented in this browser (no iOS browser has it).',
      });
    } else if (fullscreenElement() === null && !caps.standalone) {
      skipped.push({
        feature: 'orientation',
        reason:
          'Orientation lock requires an active fullscreen element (or an installed PWA). Fullscreen was not granted, so the lock was not attempted.',
      });
    } else {
      try {
        await orientation.lock(lockType);
        orientationWasLocked = true;
        applied.push('orientation');
        setState({ orientationLocked: true });
      } catch (err) {
        const kioskError = new KioskError(
          'orientation-lock-failed',
          `Could not lock orientation to "${lockType}": ${describe(err)}`,
          { feature: 'orientation', cause: err },
        );
        emitError(kioskError);
        skipped.push({ feature: 'orientation', reason: kioskError.message });
      }
    }
  }

  /* 3. Wake lock. */
  if (config.wakeLock) {
    try {
      await acquireWakeLock();
      applied.push('wakeLock');
    } catch (err) {
      const kioskError =
        err instanceof KioskError
          ? err
          : new KioskError('wake-lock-failed', describe(err), { feature: 'wakeLock', cause: err });
      emitError(kioskError);
      skipped.push({ feature: 'wakeLock', reason: kioskError.message });
    }
  }

  /* 4. Stylesheet. */
  const css = buildCss({ gestures: config.disableGestures, textSelection: config.disableTextSelection });
  if (css) {
    injectStyle(css);
    if (config.disableGestures) applied.push('gestures');
    if (config.disableTextSelection) applied.push('text-selection');
  }

  /* 5. Listeners that keep the page honest. */
  on(document, 'fullscreenchange', handleFullscreenChange);
  on(document, 'webkitfullscreenchange', handleFullscreenChange);
  on(document, 'visibilitychange', handleVisibilityChange);
  on(window, 'pagehide', handlePageHide);

  if (config.disableContextMenu) {
    on(
      document,
      'contextmenu',
      (event: Event) => {
        if (inFormField(event.target)) return;
        event.preventDefault();
      },
      { capture: true },
    );
    applied.push('context-menu');
  }

  if (config.disableGestures) {
    const preventAlways = (event: Event) => event.preventDefault();
    // Safari's proprietary pinch events — the only reliable way to stop
    // pinch-zoom on iOS, since touch-action does not apply there.
    on(document, 'gesturestart', preventAlways, { passive: false });
    on(document, 'gesturechange', preventAlways, { passive: false });
    on(document, 'gestureend', preventAlways, { passive: false });
    on(
      document,
      'touchmove',
      (event: TouchEvent) => {
        if (event.touches && event.touches.length > 1) event.preventDefault();
      },
      { passive: false },
    );
    on(
      document,
      'touchend',
      (event: TouchEvent) => {
        const now = Date.now();
        if (now - lastTouchEndAt < DOUBLE_TAP_MS && !inFormField(event.target)) event.preventDefault();
        lastTouchEndAt = now;
      },
      { passive: false },
    );
  }

  if (config.blockKeys.length > 0 || config.modifierKeys.length > 0) {
    on(
      window,
      'keydown',
      (event: KeyboardEvent) => {
        if (config.blockKeys.includes(event.key)) {
          event.preventDefault();
          return;
        }
        if ((event.ctrlKey || event.metaKey) && config.modifierKeys.includes(event.key.toLowerCase())) {
          event.preventDefault();
        }
      },
      { capture: true },
    );
    applied.push('key-blocking');
  }

  if (config.exitGesture) {
    const handleTap = (x: number, y: number) => {
      const g = config.exitGesture;
      if (!g) return;
      const hit = isInCorner({
        x,
        y,
        corner: g.corner,
        size: g.size,
        width: window.innerWidth,
        height: window.innerHeight,
      });
      tapState = pushTap(tapState, { t: Date.now(), hit, taps: g.taps, withinMs: g.withinMs });
      if (tapState.fired) void exit('gesture');
    };
    if (typeof window.PointerEvent === 'function') {
      on(window, 'pointerdown', (event: PointerEvent) => handleTap(event.clientX, event.clientY), { capture: true });
    } else {
      on(
        window,
        'touchstart',
        (event: TouchEvent) => {
          const touch = event.touches && event.touches[0];
          if (touch) handleTap(touch.clientX, touch.clientY);
        },
        { capture: true, passive: true },
      );
      on(window, 'mousedown', (event: MouseEvent) => handleTap(event.clientX, event.clientY), { capture: true });
    }
    applied.push('exit-gesture');
  }

  if (config.idleResetMs !== null && config.idleResetMs > 0) {
    const activity = () => noteActivity();
    on(window, 'pointerdown', activity, { capture: true, passive: true });
    on(window, 'keydown', activity, { capture: true, passive: true });
    on(window, 'touchstart', activity, { capture: true, passive: true });
    on(window, 'wheel', activity, { capture: true, passive: true });
    on(window, 'mousemove', activity, { capture: true, passive: true });
    lastActivityAt = Date.now();
    armIdleTimer();
    applied.push('idle-reset');
  }

  setState({ active: true, idleMs: 0 });
  return { active: true, applied, skipped };
}

function handleFullscreenChange(): void {
  if (!running) return;
  const inFullscreen = fullscreenElement() !== null;
  setState({ fullscreen: inFullscreen });
  if (inFullscreen) {
    // Re-entering fullscreen also silently drops the wake lock on some builds.
    void acquireWakeLock().catch((err) => emitError(err as KioskError));
    return;
  }
  if (fullscreenApplied) {
    // The user escaped (Esc on desktop). Do not pretend we are still a kiosk:
    // tear everything down and tell the caller.
    void exit('fullscreen-lost');
  }
}

function handleVisibilityChange(): void {
  if (!running) return;
  // THE bug this package exists for: the browser silently releases the screen
  // wake lock whenever the document is hidden, and never gives it back.
  if (document.visibilityState === 'visible') {
    void acquireWakeLock().catch((err) => emitError(err as KioskError));
  }
}

function handlePageHide(): void {
  if (!running) return;
  void exit('visibility');
}

/**
 * Leave kiosk mode and restore the page exactly as it was: exit fullscreen,
 * release the wake lock, unlock orientation, remove the injected stylesheet,
 * remove every listener and clear every timer.
 *
 * Calling it when kiosk mode is not active resolves harmlessly.
 */
export async function exit(reason: KioskExitReason = 'api'): Promise<void> {
  if (!running || exiting) return;
  exiting = true;
  running = false;

  clearIdleTimer();
  fullscreenApplied = false;

  for (const undo of cleanups.splice(0)) {
    try {
      undo();
    } catch {
      /* keep unwinding */
    }
  }

  if (orientationWasLocked) {
    orientationWasLocked = false;
    try {
      orientationApi()?.unlock?.();
    } catch {
      /* some engines throw when nothing is locked */
    }
  }

  await releaseWakeLock();
  await exitFullscreen();

  tapState = initialTapState;
  setState({ active: false, fullscreen: false, wakeLock: false, orientationLocked: false, idleMs: 0 });

  const onExitCallback = config.onExit;
  exiting = false;
  try {
    onExitCallback?.({ reason });
  } catch (err) {
    emitError(new KioskError('callback-failed', `onExit threw: ${describe(err)}`, { cause: err }));
  }
}

/** Everything, as one object — matches the `Kiosk` global from the CDN build. */
const Kiosk = {
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
};

export default Kiosk;
