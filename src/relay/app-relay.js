// The app's own MIDI relay on the Mac: one bridge for the whole app, started by the shell
// (src/app/index.js), so it keeps relaying while the student moves between Today, the player and
// the exercises. Today's "Piano & iPad" card and Settings → This device show it and hold its
// "Connect piano" button. It only runs where the iPad link shows: the Mac itself (localhost) with
// the dev server behind it; anywhere else startAppRelay() returns null.
//
//   startAppRelay() → bridge | null   (connects without a click when MIDI was allowed before)
//   appRelay()      → the running bridge, or null
import {relayAvailable} from '../midi-relay.js';
import {isThisMac, onMac} from '../app/mac.js';
import {createBridge} from './bridge-core.js';

let bridge = null;

export function startAppRelay() {
  if (bridge) return bridge;
  if (!relayAvailable || !isThisMac() || !onMac()) return null;
  bridge = createBridge({announceIdle: 'connected'}).start();
  bridge.autoConnect();
  return bridge;
}

export const appRelay = () => bridge;
