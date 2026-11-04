/**
 * Haptics (spec 52) — subtle, never constant.
 * Every call is guarded so the app works on devices/emulators without a
 * haptics engine.
 */
type HapticsModule = typeof import('expo-haptics');

let module: HapticsModule | null | undefined;

function load(): HapticsModule | null {
  if (module !== undefined) return module;
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    module = require('expo-haptics') as HapticsModule;
  } catch {
    module = null;
  }
  return module;
}

export type HapticKind = 'success' | 'toggle' | 'confirm' | 'light';

export async function haptic(kind: HapticKind): Promise<void> {
  const haptics = load();
  if (!haptics) return;
  try {
    switch (kind) {
      case 'success':
        await haptics.notificationAsync(haptics.NotificationFeedbackType.Success);
        break;
      case 'confirm':
        await haptics.notificationAsync(haptics.NotificationFeedbackType.Warning);
        break;
      case 'toggle':
        await haptics.selectionAsync();
        break;
      case 'light':
      default:
        await haptics.impactAsync(haptics.ImpactFeedbackStyle.Light);
        break;
    }
  } catch {
    // haptics are a nicety, never a requirement
  }
}
