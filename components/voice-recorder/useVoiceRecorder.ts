import type { RefObject } from 'react';
import type { Socket } from 'socket.io-client';

// components/voice-recorder/useVoiceRecorder.ts
export function useVoiceRecorderActions(params: {
  socketRef: RefObject<Socket | null>;
  roomId?: string;
  user?: { username?: string } | null;
}) {
  const { socketRef, roomId, user } = params;

  const sendRecording = async (uri: string, duration: number) => {
    if (!socketRef.current || !roomId) return;

    try {
      const response = await fetch(uri);
      const blob = await response.blob();
      const reader = new FileReader();

      reader.onloadend = () => {
        const base64data = reader.result as string; // data URL
        console.log('[VoiceRecorder] sending audio message, blob prefix:', base64data.slice(0, 100));
        socketRef.current?.emit('audio_message', {
          room: roomId,
          from: user?.username || 'Anonymous',
          blob: base64data,
          duration,
          timestamp: Date.now(),
        });
      };

      reader.readAsDataURL(blob);
    } catch (error) {
      console.error('Error sending audio message:', error);
    }
  };

  return { sendRecording };
}