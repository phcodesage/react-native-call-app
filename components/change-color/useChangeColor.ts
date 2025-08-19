// components/change-color/useChangeColor.ts
import { RefObject } from 'react';
import type { FlatList } from 'react-native';
import type { Socket } from 'socket.io-client';
import type { Dispatch, SetStateAction } from 'react';

type MaybeUser = { username?: string } | null | undefined;

// NOTE: Use screen's Message type; avoid exporting a conflicting one here.
// export type Message = {
//   message_id: number;
//   sender: string;
//   content: string;
//   timestamp: string;
//   type: 'text';
//   message_class: 'color';
//   status: 'sent' | 'delivered' | 'read';
// };

export function useChangeColorActions(params: {
  socketRef: RefObject<Socket | null>;
  roomId?: string;
  user?: MaybeUser;
  contactName: string;
  setMessages: Dispatch<SetStateAction<any[]>>;
  flatListRef: RefObject<FlatList<any> | null>;
  setChatBgColor: (c: string | null) => void;
}) {
  const {
    socketRef,
    roomId,
    user,
    contactName,
    setMessages,
    flatListRef,
    setChatBgColor,
  } = params;

  const applySelectedColor = (selectedColor: string | null | undefined) => {
    if (!selectedColor || !socketRef.current || !roomId || !user?.username) return;
    const ts = Date.now();
    try {
      socketRef.current.emit('send_color', {
        room: roomId,
        from: user.username,
        color: selectedColor,
        timestamp: ts,
      });
      
      const msgText = `You changed the bg color of ${contactName}`;
      const localMsg = {
        message_id: ts,
        sender: user.username!,
        content: msgText,
        timestamp: new Date(ts).toISOString(),
        type: 'text',
        message_class: 'color',
        status: 'sent',
      };
      setMessages(prev => [...prev, localMsg]);
      setTimeout(() => flatListRef.current?.scrollToEnd({ animated: true }), 100);
    } catch (e) {
      console.error('Error applying color:', e);
    }
  };

  const resetBgColor = () => {
    if (!socketRef.current || !roomId || !user?.username) return;
    const ts = Date.now();
    try {
      socketRef.current.emit('reset_bg_color', {
        room: roomId,
        from: user.username,
        timestamp: ts,
      });
      setChatBgColor(null);

      const msgText = 'You reset your bg color';
      const localMsg = {
        message_id: ts,
        sender: user.username!,
        content: msgText,
        timestamp: new Date(ts).toISOString(),
        type: 'text',
        message_class: 'color',
        status: 'sent',
      };
      setMessages(prev => [...prev, localMsg]);
      setTimeout(() => flatListRef.current?.scrollToEnd({ animated: true }), 100);
    } catch (e) {
      console.error('Error resetting color:', e);
    }
  };

  return { applySelectedColor, resetBgColor };
}