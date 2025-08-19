import type { RefObject } from 'react';
import type { FlatList } from 'react-native';
import type { Socket } from 'socket.io-client';
import { Audio } from 'expo-av';

type MaybeUser = { username?: string } | null | undefined;

interface CreateSendNotificationArgs<TItem = any> {
  socketRef: RefObject<Socket | null>;
  roomId?: string;
  user?: MaybeUser;
  onLocalEcho?: (text: string, timestamp: number) => void;
  flatListRef?: RefObject<FlatList<TItem> | null>;
}

// Lazy-loaded sound for sending notification
let sendNotifSound: Audio.Sound | null = null;
let sendNotifSoundLoading: Promise<void> | null = null;

async function loadSendNotifSound() {
  const { sound } = await Audio.Sound.createAsync(
    require('../assets/sounds/notif-sound.wav'),
    { shouldPlay: false, isLooping: false, volume: 1.0 }
  );
  sendNotifSound = sound;
}

async function playSendNotifSound() {
  if (!sendNotifSound) {
    sendNotifSoundLoading ??= loadSendNotifSound();
    await sendNotifSoundLoading;
  }
  await sendNotifSound?.replayAsync();
}

// Factory that returns a callback suitable for onPress
export function createSendNotification<TItem = any>({
  socketRef,
  roomId,
  user,
  onLocalEcho,
  flatListRef,
}: CreateSendNotificationArgs<TItem>) {
  return () => {
    if (!roomId || !user?.username || !socketRef.current) return;
    const ts = Date.now();
    try {
      socketRef.current.emit('send_notification', {
        room: roomId,
        from: user.username,
        timestamp: ts,
      });

      // Play local send sound (best-effort)
      void playSendNotifSound().catch((e) => {
        console.warn('Failed to play local send sound:', e);
      });

      // Let the caller add a local echo with its own types/state
      onLocalEcho?.('You sent a notification', ts);

      // Optional auto-scroll
      setTimeout(() => flatListRef?.current?.scrollToEnd?.({ animated: true }), 100);
    } catch (error) {
      console.error('Error sending notification:', error);
    }
  };
}

export default createSendNotification;
