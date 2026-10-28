import { useAppStore } from '@/store/store';
import { isWails } from './wails';

/**
 * Notification Sound Utility
 */

export type SoundType = 'new-group' | 'message' | 'file-upload';

const SOUND_PATHS: Record<SoundType, string> = {
  'new-group': '/new-group-notif.mp3',
  'message': '/message-notif.mp3',
  'file-upload': '/file-message-notif.mp3',
};

/** Plays a notification sound. Safely handles browser restrictions. */
export function playNotificationSound(type: SoundType) {
  const { enableNotificationSounds } = useAppStore.getState();
  if (!enableNotificationSounds) return;

  try {
    const audio = new Audio(SOUND_PATHS[type]);
    audio.volume = 0.3; // Subtle volume
    audio.play().catch(err => {
      // Browsers often block autoplay sounds until the user interacts with the page.
      // We log this as debug only to avoid cluttering the console.
      console.debug(`[notifications] Sound playback blocked for ${type}:`, err.message);
    });
  } catch (err) {
    console.warn(`[notifications] Error playing sound ${type}:`, err);
  }
}

/** Requests permission for browser desktop notifications. */
export async function requestNotificationPermission() {
  if (isWails()) return 'granted'; // Wails handles this natively
  if (!('Notification' in window)) return 'denied';
  if (Notification.permission === 'granted') return 'granted';
  return await Notification.requestPermission();
}

/** Shows a browser desktop notification. */
export function showBrowserNotification(title: string, body: string, icon?: string) {
  const { enableDesktopNotifications } = useAppStore.getState();
  if (!enableDesktopNotifications) return;

  if (isWails()) {
    // Call Wails native notification
    const wails = (window as any).go?.main?.App;
    if (wails?.ShowNotification) {
      wails.ShowNotification(title, body);
    }
    return;
  }

  if (!('Notification' in window) || Notification.permission !== 'granted') return;
  
  // Only show if the tab is not focused
  if (document.visibilityState === 'visible' && document.hasFocus()) return;

  const notif = new Notification(title, {
    body,
    icon: icon || '/logo192.png', // Fallback to app logo
    tag: 'cove-msg', // Consolidate multiple notifications
    silent: true, // We play our own custom sounds
  });

  notif.onclick = () => {
    window.focus();
    notif.close();
  };
}
