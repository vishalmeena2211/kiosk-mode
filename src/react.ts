/**
 * React adapter for kiosk-mode.
 *
 * ```tsx
 * import { useKiosk } from 'kiosk-mode/react';
 *
 * function CheckInScreen() {
 *   const { state, enter, exit, support } = useKiosk({ orientation: 'landscape' });
 *   // enter() must run inside the click handler for fullscreen to be granted
 *   return <button onClick={enter}>{state.active ? 'Running' : 'Enter kiosk mode'}</button>;
 * }
 * ```
 */

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import {
  enter as enterKiosk,
  exit as exitKiosk,
  getState,
  subscribe,
  support as readSupport,
} from './index';
import type { KioskOptions, KioskResult, KioskState, KioskSupport } from './index';

const SERVER_STATE: KioskState = Object.freeze({
  active: false,
  fullscreen: false,
  wakeLock: false,
  orientationLocked: false,
  idleMs: 0,
});

const SERVER_SUPPORT: KioskSupport = Object.freeze({
  fullscreen: false,
  wakeLock: false,
  orientationLock: false,
  pointerLock: false,
  standalone: false,
});

function getServerSnapshot(): KioskState {
  return SERVER_STATE;
}

/** What {@link useKiosk} returns. */
export interface UseKioskResult {
  /** Live kiosk state, via `useSyncExternalStore`. */
  state: KioskState;
  /**
   * Enter kiosk mode with the options passed to the hook. Stable identity, so it
   * is safe in dependency arrays — and safe to use directly as `onClick`, which
   * is what satisfies the browser's user-gesture requirement for fullscreen.
   */
  enter: () => Promise<KioskResult>;
  /** Leave kiosk mode and restore the page. Stable identity. */
  exit: () => Promise<void>;
  /**
   * Browser capability report. All `false` during SSR and on the very first
   * client render, then filled in after mount — so it never causes a hydration
   * mismatch.
   */
  support: KioskSupport;
}

/**
 * Drive kiosk mode from React.
 *
 * Options are read at the moment you call `enter()`, so changing them between
 * renders does not restart kiosk mode and does not change the callback identity.
 *
 * If this hook started kiosk mode, unmounting exits it automatically.
 */
export function useKiosk(options: KioskOptions = {}): UseKioskResult {
  const state = useSyncExternalStore(subscribe, getState, getServerSnapshot);
  const [support, setSupport] = useState<KioskSupport>(SERVER_SUPPORT);

  const optionsRef = useRef(options);
  optionsRef.current = options;

  const startedRef = useRef(false);

  useEffect(() => {
    setSupport(readSupport());
  }, []);

  const enter = useCallback(async (): Promise<KioskResult> => {
    const result = await enterKiosk(optionsRef.current);
    startedRef.current = true;
    return result;
  }, []);

  const exit = useCallback(async (): Promise<void> => {
    startedRef.current = false;
    await exitKiosk();
  }, []);

  useEffect(() => {
    return () => {
      if (startedRef.current) {
        startedRef.current = false;
        void exitKiosk();
      }
    };
  }, []);

  return { state, enter, exit, support };
}

export type { KioskOptions, KioskResult, KioskState, KioskSupport } from './index';

export default useKiosk;
