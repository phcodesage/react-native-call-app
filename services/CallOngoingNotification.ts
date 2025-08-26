import * as Notifications from 'expo-notifications';
import { AppState, AppStateStatus, Platform } from 'react-native';

// Simple Expo-compatible ongoing call notification helper
// Notes:
// - In Expo managed workflow, there is no true foreground service.
// - We present a single ongoing notification when the app goes background,
//   showing a snapshot of the current duration.
// - It is dismissed automatically when the app returns to foreground or when the call ends.

export type CallerInfo = {
  id?: string;
  name?: string;
  avatarUrl?: string;
};

class CallOngoingNotification {
  private isActive = false;
  private callStartTime: number | null = null;
  private callerInfo: CallerInfo | null = null;
  private appState: AppStateStatus = AppState.currentState;
  private responseSub?: Notifications.Subscription;
  private appStateSub?: { remove: () => void };
  private presentedNotificationId: string | null = null;
  private onEndCallRequest?: () => void;
  private onReturnToCallRequest?: () => void;

  async init() {
    // Ensure a handler exists so notifications can show when foreground too (useful for testing)
    Notifications.setNotificationHandler({
      handleNotification: async () => ({
        shouldShowAlert: true,
        shouldPlaySound: false,
        shouldSetBadge: false,
        // Expo SDK 53+ additional fields
        shouldShowBanner: true,
        shouldShowList: true,
      }) as any,
    } as any);
    if (Platform.OS === 'android') {
      await Notifications.setNotificationChannelAsync('ongoing_call', {
        name: 'Ongoing Call',
        importance: Notifications.AndroidImportance.MAX,
        vibrationPattern: [0],
        sound: undefined,
        lockscreenVisibility: Notifications.AndroidNotificationVisibility.PUBLIC,
        bypassDnd: false,
        showBadge: false,
      });
    }

    await Notifications.setNotificationCategoryAsync('call_actions', [
      {
        identifier: 'END_CALL',
        buttonTitle: 'End Call',
        options: { isDestructive: true },
      },
      {
        identifier: 'RETURN_TO_CALL',
        buttonTitle: 'Return',
      },
    ]);

    // Handle action taps
    this.responseSub = Notifications.addNotificationResponseReceivedListener((response) => {
      const action = response.actionIdentifier;
      if (action === 'END_CALL') {
        // Bubble up to app to actually end the call
        try { this.onEndCallRequest?.(); } catch {}
        this.end();
      } else if (action === 'RETURN_TO_CALL') {
        try { this.onReturnToCallRequest?.(); } catch {}
      }
    });
  }

  setHandlers(handlers: { onEndCall?: () => void; onReturnToCall?: () => void }) {
    this.onEndCallRequest = handlers.onEndCall;
    this.onReturnToCallRequest = handlers.onReturnToCall;
  }

  async start(callerInfo: CallerInfo | null, startedAtMs?: number) {
    if (!this.responseSub) {
      await this.init();
    }
    this.isActive = true;
    this.callerInfo = callerInfo ?? null;
    this.callStartTime = startedAtMs ?? Date.now();

    // Listen for background/foreground changes
    this.appStateSub?.remove?.();
    this.appStateSub = AppState.addEventListener('change', (next) => this.onAppStateChange(next));

    // If we're already in background when starting, present immediately
    const state = AppState.currentState;
    if (state === 'background' || state === 'inactive') {
      await this.presentOngoing();
    }
  }

  private onAppStateChange = async (next: AppStateStatus) => {
    this.appState = next;
    if (!this.isActive || !this.callStartTime) return;

    if (next === 'background' || next === 'inactive') {
      await this.presentOngoing();
    } else if (next === 'active') {
      await this.dismiss();
    }
  };

  private formatDuration(): string {
    if (!this.callStartTime) return '00:00';
    const duration = Math.floor((Date.now() - this.callStartTime) / 1000);
    const h = Math.floor(duration / 3600);
    const m = Math.floor((duration % 3600) / 60);
    const s = duration % 60;
    return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}` : `${m}:${String(s).padStart(2, '0')}`;
  }

  private async presentOngoing() {
    const title = this.callerInfo?.name ? `Call with ${this.callerInfo.name}` : 'Call in progress';
    const body = `Ongoing • ${this.formatDuration()}`;

    // Dismiss old if any
    if (this.presentedNotificationId) {
      try { await Notifications.dismissNotificationAsync(this.presentedNotificationId); } catch {}
      this.presentedNotificationId = null;
    }

    const id = await Notifications.scheduleNotificationAsync({
      content: {
        title,
        body,
        categoryIdentifier: 'call_actions',
        data: { kind: 'ongoing_call', callerId: this.callerInfo?.id },
      },
      trigger: null,
    });
    this.presentedNotificationId = id;
  }

  async dismiss() {
    if (this.presentedNotificationId) {
      try { await Notifications.cancelScheduledNotificationAsync(this.presentedNotificationId); } catch {}
      try { await Notifications.dismissNotificationAsync(this.presentedNotificationId); } catch {}
      this.presentedNotificationId = null;
    }
    try { await Notifications.dismissAllNotificationsAsync(); } catch {}
  }

  async end() {
    this.isActive = false;
    this.callStartTime = null;
    this.callerInfo = null;
    await this.dismiss();
    this.appStateSub?.remove?.();
    this.appStateSub = undefined;
  }
}

export default new CallOngoingNotification();
