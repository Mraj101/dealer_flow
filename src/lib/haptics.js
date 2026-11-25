// Small phone vibrations so taps and typing feel "real". Works in both places:
//   - Android app: the phone's native haptics, through @capacitor/haptics
//   - Web (Chrome on Android): navigator.vibrate as the fallback
//   - iPhone Safari / desktop: no vibration available, silently does nothing
// Never throws.
import { Capacitor } from '@capacitor/core'
import { Haptics, ImpactStyle, NotificationType } from '@capacitor/haptics'

const native = Capacitor.isNativePlatform()

// Web patterns in milliseconds. Under ~20 ms most phone motors don't move at all, so keep them above that.
const WEB = {
  key: 20,
  tap: 35,
  warn: [40, 60, 40],
  success: [30, 50, 30],
  error: [60, 40, 60],
}

// counts since the app opened, shown on Settings > Vibration to find out where buzzes get lost
export const hapticStats = { asked: 0, accepted: 0, refused: 0, nativeFailed: 0, last: '' }

const vibrate = (pattern) => {
  hapticStats.asked++
  let ok = false
  try { ok = navigator.vibrate?.(pattern) === true } catch { /* ignore */ }
  ok ? hapticStats.accepted++ : hapticStats.refused++
}
const safe = (p) => {
  hapticStats.asked++
  hapticStats.accepted++
  p?.catch?.(() => { hapticStats.accepted--; hapticStats.nativeFailed++; vibrate(WEB.tap) }) // native failed: try the web way
}

export const haptic = {
  // a key press while typing: the lightest tick
  key: () => (native ? safe(Haptics.impact({ style: ImpactStyle.Light })) : vibrate(WEB.key)),
  // a button tap
  tap: () => (native ? safe(Haptics.impact({ style: ImpactStyle.Medium })) : vibrate(WEB.tap)),
  // a question popped up (confirm dialog)
  warn: () => (native ? safe(Haptics.notification({ type: NotificationType.Warning })) : vibrate(WEB.warn)),
  // saved
  success: () => (native ? safe(Haptics.notification({ type: NotificationType.Success })) : vibrate(WEB.success)),
  // something went wrong / not allowed
  error: () => (native ? safe(Haptics.notification({ type: NotificationType.Error })) : vibrate(WEB.error)),
}

const CLICKABLE = 'button, a[href], [role="tab"], [role="button"], [data-haptic]'

let installed = false
// One set of listeners for the whole app, so every button and every input gets feedback
// without wiring each one by hand.
export function installGlobalHaptics() {
  if (installed) return
  installed = true

  // Taps on anything clickable. Chrome only allows vibrating inside a real user gesture: for a finger
  // that is pointerup (pointerdown does not count), for a mouse it is pointerdown. Using the right one
  // also means the very first tap already buzzes.
  const onPointer = (e) => {
    const wanted = e.pointerType === 'mouse' ? 'pointerdown' : 'pointerup'
    if (e.type !== wanted) return
    const el = e.target.closest?.(CLICKABLE)
    if (!el || el.disabled || el.getAttribute('aria-disabled') === 'true') return
    hapticStats.last = `tap on "${(el.innerText || el.getAttribute('aria-label') || el.tagName).trim().slice(0, 30)}" (${e.pointerType})`
    haptic.tap()
  }
  document.addEventListener('pointerdown', onPointer, { capture: true, passive: true })
  document.addEventListener('pointerup', onPointer, { capture: true, passive: true })

  // typing in any box; throttled so fast typing doesn't turn into one long buzz
  let last = 0
  document.addEventListener('input', (e) => {
    if (!e.target.matches?.('input, textarea, select')) return
    const now = Date.now()
    if (now - last < 60) return
    last = now
    hapticStats.last = 'typing'
    haptic.key()
  }, { capture: true, passive: true })
}
