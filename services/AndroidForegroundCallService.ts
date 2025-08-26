import { Platform } from 'react-native';
import BackgroundService from '@huddle01/react-native-background-actions';

// Android-only foreground service to keep an ongoing call notification updated every second
// Uses react-native-background-actions. This runs only on real/dev client builds, not in Expo Go.

let startedAt: number | null = null;
let callerName: string | undefined;
let isRunning = false;

function formatDurationFrom(startMs: number) {
  const duration = Math.floor((Date.now() - startMs) / 1000);
  const h = Math.floor(duration / 3600);
  const m = Math.floor((duration % 3600) / 60);
  const s = duration % 60;
  return h > 0
    ? `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
    : `${m}:${String(s).padStart(2, '0')}`;
}

const task = async (taskData: any) => {
  // Keep loop alive until stopped
  while (BackgroundService.isRunning()) {
    if (startedAt) {
      const duration = formatDurationFrom(startedAt);
      const title = callerName ? `Call with ${callerName}` : 'Call in progress';
      const desc = `Ongoing • ${duration}`;
      try {
        await BackgroundService.updateNotification({ taskTitle: title, taskDesc: desc });
      } catch {}
    }
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
};

const optionsBase = {
  taskName: 'OngoingCall',
  taskTitle: 'Call in progress',
  taskDesc: 'Ongoing • 00:00',
  taskIcon: {
    name: 'ic_launcher', // default app icon
    type: 'mipmap',
  },
  color: '#10b981',
  parameters: {},
  linkingURI: 'callapp://', // optional deep link to return
  // Android-only options
  progressBar: { max: 100, value: 0, indeterminate: true },
  // Allows microphone/camera, etc.
  foregroundServiceType: 'mediaProjection|microphone|camera|mediaPlayback|connectedDevice',
} as const;

async function start(name?: string, callStartedAtMs?: number) {
  if (Platform.OS !== 'android') return;
  // Hotfix: Android 14+ requires startForeground with explicit type; current lib may start with type=none.
  // Avoid crash by not starting on API >= 34. Fallback to Expo snapshot notification in CallScreen.
  const apiLevel = typeof Platform.Version === 'number' ? Platform.Version : parseInt(String(Platform.Version), 10);
  if (apiLevel >= 34) return;
  callerName = name;
  startedAt = callStartedAtMs ?? Date.now();
  if (isRunning) return;
  try {
    await BackgroundService.start(task, optionsBase as any);
    isRunning = true;
  } catch (e) {
    // ignore if already running
  }
}

async function stop() {
  if (Platform.OS !== 'android') return;
  try {
    await BackgroundService.stop();
  } catch {}
  isRunning = false;
  startedAt = null;
  callerName = undefined;
}

export default { start, stop };
