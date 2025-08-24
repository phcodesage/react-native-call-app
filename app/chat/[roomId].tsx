import { CallScreen } from '@/components/CallScreen';
import { CallSetupModal } from '@/components/CallSetupModal';
import { IncomingCallModal } from '@/components/IncomingCallModal';
import { ThemedText } from '@/components/ThemedText';
import { ThemedView } from '@/components/ThemedView';
import VoiceRecorder from '@/components/voice-recorder/VoiceRecorder';
import AudioMessage from '@/components/AudioMessage';
import FileMessage from '@/components/FileMessage';
import useCallFunctions from '@/components/CallFunction';
import createSendNotification from '@/components/SendNotification';
import { useAuth } from '@/contexts/AuthContext';
import { useTheme } from '@/contexts/ThemeContext';
import { useColorScheme } from '@/hooks/useColorScheme';
import { Ionicons } from '@expo/vector-icons';
import { useLocalSearchParams, useRouter } from 'expo-router';
import React, { useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  FlatList,
  KeyboardAvoidingView,
  Image,
  Linking,
  Modal,
  Platform,
  InteractionManager,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import io, { Socket } from 'socket.io-client';
import { ENV, getApiUrl, getSocketUrl } from '../../config/env';
import { Audio, InterruptionModeAndroid, InterruptionModeIOS, Video, ResizeMode } from 'expo-av';
import ChangeColorModal from '@/components/change-color/ChangeColorModal';
import { useChangeColorActions } from '@/components/change-color/useChangeColor';
import { useVoiceRecorderActions } from '@/components/voice-recorder/useVoiceRecorder';
import * as DocumentPicker from 'expo-document-picker';
import { FileUploadService } from '@/services/FileUploadService';
import { Image as ExpoImage } from 'expo-image';

const API_BASE_URL = ENV.API_BASE_URL;
const SOCKET_URL = ENV.SOCKET_SERVER_URL;

interface Message {
  message_id: number;
  sender: string;
  content?: string;
  message?: string;
  timestamp: string;
  type: 'text' | 'audio' | 'file';
  file_url?: string;
  file_id?: string;
  file_name?: string;
  file_type?: string;
  file_size?: number;
  audio_data?: string;
  audio_id?: number;
  reply_content?: string;
  reply_sender?: string;
  reply_to_message_id?: number;
  message_class?: string;
  reactions?: { [emoji: string]: string[] }; // e.g. { '❤️': ['user1', 'user2'] }
  status?: string;
  room?: string;
  client_id?: number;
}

export default function ChatScreen() {
  const { roomId } = useLocalSearchParams<{ roomId: string }>();
  const router = useRouter();
  const colorScheme = useColorScheme();
  const { theme } = useTheme();
  const { token, user } = useAuth();
  const insets = useSafeAreaInsets();
  const flatListRef = useRef<FlatList>(null);
  // Track dimensions to compute precise bottom offset
  const contentHeightRef = useRef<number>(0);
  const listHeightRef = useRef<number>(0);
  const socketRef = useRef<Socket | null>(null);
  const isInitialLoadRef = useRef<boolean>(true);
  const isDark = theme === 'dark';
  // Refs used by call flow (must be declared before useCallFunctions)
  const callTimerRef = useRef<NodeJS.Timeout | null>(null);
  const pendingOfferRef = useRef<any>(null);
  const contactName = roomId?.split('-').find(name => name !== user?.username) || 'Unknown';
  const contactInitial = (contactName?.trim()[0] || 'U').toUpperCase();
  const [messages, setMessages] = useState<Message[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [newMessage, setNewMessage] = useState('');
  const [isSending, setIsSending] = useState(false);
  const [typingUsers, setTypingUsers] = useState<{[key: string]: string}>({});
  const typingTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const [showActions, setShowActions] = useState(false);
  const [showTimestamps, setShowTimestamps] = useState(false);
  const [showFilePreviewModal, setShowFilePreviewModal] = useState(false);
  const [showEmojiPicker, setShowEmojiPicker] = useState(false);
  const [showVoiceRecorder, setShowVoiceRecorder] = useState(false);
  const [showColorPicker, setShowColorPicker] = useState(false);
  const [selectedColor, setSelectedColor] = useState<string | null>(null);
  const [chatBgColor, setChatBgColor] = useState<string | null>(null);
  const [showWheel, setShowWheel] = useState(false);
  // RGB input states for manual editing
  const [rgbR, setRgbR] = useState<string>('');
  const [rgbG, setRgbG] = useState<string>('');
  const [rgbB, setRgbB] = useState<string>('');
  const [serverWarning, setServerWarning] = useState<string | null>(null);
  const [selectedMessageId, setSelectedMessageId] = useState<number | null>(null);
  const notificationSoundRef = useRef<Audio.Sound | null>(null);
  const messageSoundRef = useRef<Audio.Sound | null>(null);
  // Input auto-grow up to 2 lines, then scroll inside
  const [inputHeight, setInputHeight] = useState<number>(40);
  const [inputContainerHeight, setInputContainerHeight] = useState<number>(72);
  const [actionsContainerHeight, setActionsContainerHeight] = useState<number>(0);
  const INPUT_LINE_HEIGHT = 20; // should match visual line height
  const INPUT_VERTICAL_PADDING = 20; // paddingVertical 10 (top) + 10 (bottom)
  const MAX_INPUT_HEIGHT = INPUT_LINE_HEIGHT * 2 + INPUT_VERTICAL_PADDING; // two lines max
  // Scrolling state for unread indicator
  const [isAtBottom, setIsAtBottom] = useState(true);
  const [unreadCount, setUnreadCount] = useState(0);
  // File picker & upload
  const [pickedFile, setPickedFile] = useState<{ uri: string; name: string; type: string; size: number } | null>(null);
  const [isUploadingFile, setIsUploadingFile] = useState(false);
  const [uploadProgressPct, setUploadProgressPct] = useState<number>(0);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [showPickedFullScreen, setShowPickedFullScreen] = useState(false);
  const [pickedImageError, setPickedImageError] = useState<string | null>(null);
  const [pickedVideoError, setPickedVideoError] = useState<string | null>(null);
  const { applySelectedColor, resetBgColor } = useChangeColorActions({ 
    socketRef,
    roomId: roomId as string,
    user,
    contactName,
    setMessages,
    flatListRef,
    setChatBgColor,
  });
  const { sendRecording } = useVoiceRecorderActions({ socketRef, roomId: roomId as string, user });

  // Helpers: hex <-> rgb
  const clamp255 = (n: number) => Math.max(0, Math.min(255, Math.round(n)));
  const hexToRgb = (hex?: string | null): { r: number; g: number; b: number } | null => {
    if (!hex) return null;
    const v = hex.replace('#', '');
    if (v.length === 3) {
      const r = parseInt(v[0] + v[0], 16);
      const g = parseInt(v[1] + v[1], 16);
      const b = parseInt(v[2] + v[2], 16);
      return { r, g, b };
    }
    if (v.length === 6) {
      const r = parseInt(v.slice(0, 2), 16);
      const g = parseInt(v.slice(2, 4), 16);
      const b = parseInt(v.slice(4, 6), 16);
      return { r, g, b };
    }
    return null;
  };

  const handleIncomingFileMessage = (data: any) => {
    try {
      // Ignore own echo
      if (data?.from && user?.username && data.from === user.username) return;
      console.log('[FileMessage][incoming] raw payload:', data);
      const tsInfo = {
        timestamp: data?.timestamp,
        server_timestamp: data?.server_timestamp,
        server_ts: data?.server_ts,
        sent_at: data?.sent_at,
        created_at: data?.created_at,
        message_id: data?.message_id,
        client_id: data?.client_id,
      };
      console.log('[FileMessage][incoming] ts candidates:', tsInfo);
      const iso = pickTimestampISO(data);
      console.log('[FileMessage][incoming] picked ISO:', iso);
      const newMsg: Message = {
        message_id: typeof data?.message_id === 'number' ? data.message_id : parseTimestampSafe(iso),
        sender: data?.sender || data?.from || 'unknown',
        timestamp: iso,
        type: 'file',
        file_id: data?.file_id,
        file_name: data?.file_name,
        file_type: data?.file_type,
        file_size: data?.file_size,
        file_url: data?.file_url,
        status: data?.status || 'delivered',
      };

      setMessages(prev => {
        if (prev.some(msg => msg.message_id === newMsg.message_id)) return prev;
        const updated = [...prev, newMsg];
        updated.sort((a, b) => parseTimestampSafe(a.timestamp) - parseTimestampSafe(b.timestamp));
        return updated;
      });

      if (!isAtBottom) setUnreadCount(c => c + 1);
      if (isAtBottom) setTimeout(() => flatListRef.current?.scrollToEnd({ animated: true }), 50);
    } catch (e) {
      console.error('Error handling file_message:', e);
    }
  };
  const rgbToHex = (r: number, g: number, b: number) => {
    const toHex = (n: number) => clamp255(n).toString(16).padStart(2, '0');
    return `#${toHex(r)}${toHex(g)}${toHex(b)}`;
  };
  
  // Initialize selection when opening color modal and reset wheel visibility
  useEffect(() => {
    if (showColorPicker) {
      setSelectedColor(chatBgColor ?? null);
      setShowWheel(false);
    }
  }, [showColorPicker]);

  // Keep RGB fields in sync with selectedColor
  useEffect(() => {
    const rgb = hexToRgb(selectedColor);
    if (rgb) {
      setRgbR(String(rgb.r));
      setRgbG(String(rgb.g));
      setRgbB(String(rgb.b));
    } else {
      setRgbR('');
      setRgbG('');
      setRgbB('');
    }
  }, [selectedColor]);
  

  useEffect(() => {
    let mounted = true;
  
    (async () => {
      await Audio.setAudioModeAsync({
        playsInSilentModeIOS: true,
        allowsRecordingIOS: false,
        staysActiveInBackground: false,
        interruptionModeIOS: InterruptionModeIOS.DoNotMix,
        interruptionModeAndroid: InterruptionModeAndroid.DuckOthers,
        shouldDuckAndroid: true,
        playThroughEarpieceAndroid: false,
      });
  
      const { sound } = await Audio.Sound.createAsync(
        require('../../assets/sounds/notif-sound.wav'),
        { shouldPlay: false, volume: 1.0, isLooping: false }
      );
      if (mounted) notificationSoundRef.current = sound;

      const { sound: msgSound } = await Audio.Sound.createAsync(
        require('../../assets/sounds/splat2.m4a'),
        { shouldPlay: false, volume: 1.0, isLooping: false }
      );
      if (mounted) messageSoundRef.current = msgSound;
    })();
  
    return () => {
      mounted = false;
      notificationSoundRef.current?.unloadAsync();
      notificationSoundRef.current = null;
      messageSoundRef.current?.unloadAsync();
      messageSoundRef.current = null;
    };
  }, []);

  // Scroll helper (precise)
  const scrollToBottom = (animated: boolean = true) => {
    // Wait for interactions and layout to settle for more reliable scrolling
    InteractionManager.runAfterInteractions(() => {
      requestAnimationFrame(() => {
        setTimeout(() => {
          const list = flatListRef.current;
          const contentH = contentHeightRef.current || 0;
          const listH = listHeightRef.current || 0;
          // Add a small fudge factor to account for paddings/margins
          const fudge = 24;
          const targetOffset = Math.max(0, contentH - listH + fudge);
          if (targetOffset > 0 && Number.isFinite(targetOffset)) {
            list?.scrollToOffset({ offset: targetOffset, animated });
          } else {
            // Fallback
            list?.scrollToEnd({ animated });
          }
        }, 80);
      });
    });
  };

  // Call state and handlers
  const {
    showCallSetup,
    setShowCallSetup,
    showIncomingCall,
    showCallScreen,
    callType,
    incomingCallType,
    incomingCaller,
    localStream,
    remoteStream,
    isCallConnected,
    isAudioMuted,
    isVideoMuted,
    callDuration,
    webRTCServiceRef,
    handleStartCall,
    handleCallSetupStart,
    handleIncomingCall,
    handleAcceptCall,
    handleDeclineCall,
    handleCallEnd,
    handleToggleMute,
    handleToggleVideo,
    handleSwitchCamera,
  } = useCallFunctions({
    socketRef,
    roomId: roomId as string,
    user,
    pendingOfferRef,
    callTimerRef,
  });

  // Doorbell/notification sender (decoupled factory)
  const sendNotification = createSendNotification({
    socketRef,
    roomId: roomId as string,
    user,
    flatListRef,
    onLocalEcho: (text: string, ts: number) => {
      const localMsg: Message = {
        message_id: ts,
        sender: user?.username || 'system',
        content: text,
        timestamp: new Date(ts).toISOString(),
        type: 'text',
        message_class: 'notification',
        status: 'sent',
      };
      setMessages(prev => [...prev, localMsg]);
    },
  });

  // Helper function to safely render text
  const safeText = (text: any): string => {
    if (text === null || text === undefined) return '';
    if (typeof text === 'string') return text.trim();
    if (typeof text === 'number') return String(text);
    return String(text).trim();
  };


  useEffect(() => {
    let mounted = true;
  
    (async () => {
      await Audio.setAudioModeAsync({
        playsInSilentModeIOS: true,
        allowsRecordingIOS: false,
        staysActiveInBackground: false,
        interruptionModeIOS: InterruptionModeIOS.DoNotMix,
        interruptionModeAndroid: InterruptionModeAndroid.DuckOthers,
        shouldDuckAndroid: true,
        playThroughEarpieceAndroid: false,
      });
  
      const { sound } = await Audio.Sound.createAsync(
        require('../../assets/sounds/notif-sound.wav'),
        { shouldPlay: false, volume: 1.0, isLooping: false }
      );
      if (mounted) notificationSoundRef.current = sound;

      const { sound: msgSound } = await Audio.Sound.createAsync(
        require('../../assets/sounds/splat2.m4a'),
        { shouldPlay: false, volume: 1.0, isLooping: false }
      );
      if (mounted) messageSoundRef.current = msgSound;
    })();
  
    return () => {
      mounted = false;
      notificationSoundRef.current?.unloadAsync();
      notificationSoundRef.current = null;
      messageSoundRef.current?.unloadAsync();
      messageSoundRef.current = null;
    };
  }, []);

  // WebRTC readiness and pending ICE buffer (to handle early ICE from web)
  const webrtcReadyRef = useRef<boolean>(false);
  const pendingIceRef = useRef<any[]>([]);

  useEffect(() => {
    if (roomId && token) {
      // Mark as initial load for this room
      isInitialLoadRef.current = true;
      loadRoomMessages();
      initializeSocket();
      // Extra nudge to bottom right after mount
      setTimeout(() => scrollToBottom(true), 120);
    }
    
    return () => {
      if (socketRef.current) {
        socketRef.current.disconnect();
      }
    };
  }, [roomId, token]);

  // Persist messages to cache whenever they change
  useEffect(() => {
    const persist = async () => {
      if (!roomId) return;
      try {
        await AsyncStorage.setItem(`messages_cache_${roomId}`, JSON.stringify(messages));
      } catch {}
    };
    if (messages && messages.length >= 0) persist();
  }, [messages, roomId]);

  const initializeSocket = () => {
    if (!token || !user || !roomId) return;

    // Initialize socket connection
    socketRef.current = io(SOCKET_URL, {
      transports: ['websocket', 'polling'],
      timeout: 20000,
    });

    // Listen for color change
    socketRef.current?.on('receive_color', (data: any) => {
      try {
        if (!data || !data.from || !data.color) return;
        const ts = parseTimestampSafe(data?.timestamp);
        setChatBgColor(data.color);
        const msgText = `${data.from} changed your bg color`;
        const newMsg: Message = {
          message_id: ts,
          sender: data.from,
          content: msgText,
          timestamp: new Date(ts).toISOString(),
          type: 'text',
          message_class: 'color',
          status: 'delivered',
        };
        setMessages(prev => [...prev, newMsg]);
        setTimeout(() => flatListRef.current?.scrollToEnd({ animated: true }), 100);
      } catch (e) {
        console.error('Error handling receive_color:', e);
      }
    });

    // Listen for reset bg color
    socketRef.current?.on('receive_reset_bg_color', (data: any) => {
      try {
        if (!data || !data.from) return;
        const ts = parseTimestampSafe(data?.timestamp);
        setChatBgColor(null);
        const msgText = `${data.from} resets its bg color`;
        const newMsg: Message = {
          message_id: ts,
          sender: data.from,
          content: msgText,
          timestamp: new Date(ts).toISOString(),
          type: 'text',
          message_class: 'color',
          status: 'delivered',
        };
        setMessages(prev => [...prev, newMsg]);
        setTimeout(() => flatListRef.current?.scrollToEnd({ animated: true }), 100);
      } catch (e) {
        console.error('Error handling receive_reset_bg_color:', e);
      }
    });

    const socket = socketRef.current;

    socket.on('connect', () => {
      console.log('Chat socket connected:', socket.id);
      setServerWarning(null);
      
      // Register user with the socket
      socket.emit('register', {
        username: user.username,
        token: token
      });
      
      // Join the room for this conversation
      socket.emit('join', { room: roomId });
    });

    socket.on('disconnect', () => {
      console.log('Chat socket disconnected');
    });

    // Listen for incoming chat messages
    socket.on('receive_chat_message', (data: any) => {
      console.log('Received chat message id:', data?.message_id);
      // Ignore echo of our own message; we already add a local echo
      if (data?.from && user?.username && data.from === user.username) return;
      // Play message sound on incoming chat
      void messageSoundRef.current?.replayAsync().catch((e) => {
        console.warn('Failed to play message sound (incoming):', e);
      });
      // If user is not at bottom, increment unread counter and avoid auto-scroll
      if (!isAtBottom) {
        setUnreadCount((c) => c + 1);
      }
      handleIncomingMessage(data);
      // If at bottom, scroll to end after appending
      if (isAtBottom) {
        setTimeout(() => flatListRef.current?.scrollToEnd({ animated: true }), 50);
      }
    });

    // Listen for incoming notifications
    socket.on('receive_notification', (data: any) => {
      try {
        // play sound
        void notificationSoundRef.current?.replayAsync().catch((e) => {
          console.warn('Failed to play notification sound:', e);
        });
    
        // your existing message append
        const ts = parseTimestampSafe(data?.timestamp);
        const msgText = `${data?.from || 'Someone'} sent you a notification!`;
        const newMsg: Message = {
          message_id: ts,
          sender: data?.from || 'system',
          content: msgText,
          timestamp: new Date(ts).toISOString(),
          type: 'text',
          message_class: 'notification',
          status: 'delivered'
        };
        setMessages(prev => [...prev, newMsg]);
        setTimeout(() => flatListRef.current?.scrollToEnd({ animated: true }), 100);
      } catch (e) {
        console.error('Error handling receive_notification:', e);
      }
    });

    socket.on('message_delivered', (data: any) => {
      console.log('Message delivered id:', data?.message_id);
      updateMessageStatus(data.message_id, 'delivered');
    });

    // Listen for live typing events
    socket.on('live_typing', (data: any) => {
      console.log('Live typing from:', data?.from);
      handleTypingIndicator(data);
    });

    // Listen for incoming audio messages
    socket.on('audio_message', (data: any) => {
      console.log('Received audio message id:', data?.message_id);
      handleIncomingAudioMessage(data);
    });

    // Listen for incoming file messages
    socket.on('file_message', (data: any) => {
      console.log('[FileMessage][socket] event received:', data);
      handleIncomingFileMessage(data);
    });

    socket.on('receive_reaction', (data: any) => {
      console.log('Received reaction for message id:', data?.message_id);
      handleIncomingReaction(data);
    });

    // Listen for WebRTC signals
    socket.on('signal', async (data: any) => {
      console.log('Received WebRTC signal:', data);
      
      const { signal, from } = data;

      try {
        switch (signal.type) {
          case 'offer':
            console.log('Received offer from', from, 'signal:', signal);
            // Store as plain RTCSessionDescriptionInit object (RN may not expose global RTCSessionDescription)
            pendingOfferRef.current = {
              type: signal.type,
              sdp: signal.sdp,
            };
            await handleIncomingCall({ from, signal });
            break;

          case 'answer':
            if (webRTCServiceRef.current) {
              await webRTCServiceRef.current.handleAnswer(signal);
            }
            break;

          case 'ice-candidate':
          default:
            // Buffer ICE until WebRTC is ready; then flush
            if (signal.candidate) {
              if (webrtcReadyRef.current && webRTCServiceRef.current) {
                await webRTCServiceRef.current.addIceCandidate(signal);
              } else {
                console.log('Buffering ICE candidate - WebRTC not ready yet');
                pendingIceRef.current.push(signal);
              }
            }
            break;

          case 'call-declined':
            Alert.alert('Call Declined', `${from} declined your call.`);
            handleCallEnd();
            break;

          case 'call-ended':
            handleCallEnd();
            break;
        }
      } catch (error) {
        console.error('Error handling WebRTC signal:', error);
      }
    });

    socket.on('connect_error', (error: any) => {
      console.error('Chat socket connection error:', error);
      setServerWarning('Server unreachable. Showing cached messages.');
    });
  };

  const handleIncomingAudioMessage = (data: any) => {
    const iso = pickTimestampISO(data);
    const newMessage: Message = {
      message_id: typeof data?.message_id === 'number' ? data.message_id : parseTimestampSafe(iso),
      sender: data.from,
      message: '',
      timestamp: iso,
      type: 'audio',
      file_url: data.blob,
      audio_data: data.duration ? data.duration.toString() : '30',
      status: data.status || 'sent'
    };

    setMessages(prev => {
      // Avoid duplicates
      const exists = prev.some(msg => msg.message_id === newMessage.message_id);
      if (exists) return prev;
      const updated = [...prev, newMessage];
      // Sort by timestamp
      updated.sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());
      return updated;
    });
    setTimeout(() => flatListRef.current?.scrollToEnd({ animated: true }), 100);
  };

  const handleIncomingMessage = (data: any) => {
    // Extra guard: ignore own echoes here as well
    if (data?.from && user?.username && data.from === user.username) return;
    console.log('[Chat][incoming] raw payload:', data);
    const chatTsInfo = {
      timestamp: data?.timestamp,
      server_timestamp: data?.server_timestamp,
      server_ts: data?.server_ts,
      sent_at: data?.sent_at,
      created_at: data?.created_at,
      message_id: data?.message_id,
      client_id: data?.client_id,
    };
    console.log('[Chat][incoming] ts candidates:', chatTsInfo);
    const iso = pickTimestampISO(data);
    console.log('[Chat][incoming] picked ISO:', iso);
    const newMessage: Message = {
      message_id: typeof data?.message_id === 'number' ? data.message_id : parseTimestampSafe(iso),
      sender: data.from,
      content: data.message,
      timestamp: iso,
      type: 'text',
      reply_content: data.reply_content,
      reply_sender: data.reply_sender,
      reply_to_message_id: data.reply_to_message_id,
      status: data.status || 'sent',
      reactions: data.reactions || {}
    };
    
    setMessages(prevMessages => {
      // Check if message already exists to avoid duplicates
      const exists = prevMessages.some(msg => msg.message_id === newMessage.message_id);
      if (exists) return prevMessages;
      
      const updatedMessages = [...prevMessages, newMessage];
      // Sort by timestamp to maintain order
      return updatedMessages.sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());
    });
    
    // Auto-scroll to bottom when new message arrives
    setTimeout(() => {
      flatListRef.current?.scrollToEnd({ animated: true });
    }, 100);
  };

  const handleIncomingReaction = (data: { message_id: number; reactions: { [key: string]: string[] } }) => {
    setMessages(prev =>
      prev.map(msg =>
        msg.message_id === data.message_id ? { ...msg, reactions: data.reactions } : msg
      )
    );
  };

  const handleSendReaction = (messageId: number, emoji: string) => {
    if (!socketRef.current || !roomId || !user?.username) return;

    socketRef.current.emit('send_reaction', {
      room: roomId,
      message_id: messageId,
      reaction: emoji,
      from: user.username,
    });
    setSelectedMessageId(null); // Close picker
  };

  const updateMessageStatus = (messageId: number, status: string) => {
    setMessages(prevMessages => 
      prevMessages.map(msg => 
        msg.message_id === messageId ? { ...msg, status } : msg
      )
    );
  };

  const handleTypingIndicator = (data: any) => {
    const { from, text } = data;
    if (!from || from === user?.username) return;

    if (text && text.trim() !== '') {
      // User is typing - store the actual text
      setTypingUsers(prev => ({
        ...prev,
        [from]: text.trim()
      }));
    } else {
      // User stopped typing - remove from typing users
      setTypingUsers(prev => {
        const newTyping = { ...prev };
        delete newTyping[from];
        return newTyping;
      });
    }
  };

  const handleTextChange = (text: string) => {
    setNewMessage(text);
    
    // Send typing indicator
    if (socketRef.current && roomId && user) {
      socketRef.current.emit('live_typing', {
        room: roomId,
        from: user.username,
        text: text.trim()
      });
      
      // Clear previous timeout
      if (typingTimeoutRef.current) {
        clearTimeout(typingTimeoutRef.current);
      }
      
      // Set timeout to stop typing indicator
      typingTimeoutRef.current = setTimeout(() => {
        if (socketRef.current && roomId && user) {
          socketRef.current.emit('live_typing', {
            room: roomId,
            from: user.username,
            text: ''
          });
        }
      }, 1000) as unknown as NodeJS.Timeout;
    }
  };


  const handleKeyPress = (e: any) => {
    // Handle both 'Enter' and newline character for send action
    const key = e.nativeEvent.key;
    const isEnterKey = key === 'Enter' || key === '\n';
    
    if (isEnterKey && !e.nativeEvent.shiftKey) {
      e.preventDefault();
      // Send message instead of adding new line
      sendMessage();
      return false; // Prevent default behavior
    }
  };

  const loadRoomMessages = async () => {
    if (!roomId || !token) return;
    try {
      setIsLoading(true);

      // 1) Load cached messages immediately for fast UI
      let baselineMessages: Message[] = [];
      try {
        const cached = await AsyncStorage.getItem(`messages_cache_${roomId}`);
        if (cached) {
          const parsed = JSON.parse(cached);
          if (Array.isArray(parsed)) {
            baselineMessages = parsed as Message[];
            setMessages(parsed);
            // We can stop showing spinner early since UI has content
            setIsLoading(false);
            // On initial open, ensure we land at bottom of cached list
            if (isInitialLoadRef.current) scrollToBottom(true);
          }
        }
      } catch {}

      // 2) Compute incremental cursors from baseline or current state
      const sourceList = baselineMessages.length ? baselineMessages : messages;
      const latestTs = getLatestMessageTimestamp(sourceList);
      const maxId = getMaxMessageId(sourceList);

      // 3) Build URL with optional filters (backend may ignore unknown params)
      const url = new URL(`${API_BASE_URL}/messages/${roomId}`);
      if (latestTs) {
        // Send both iso and ms for flexibility
        url.searchParams.set('since', new Date(latestTs).toISOString());
        url.searchParams.set('since_ms', String(latestTs));
      }
      if (maxId) url.searchParams.set('after_id', String(maxId));

      const response = await fetch(url.toString(), {
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
      });

      if (!response.ok) {
        throw new Error('Failed to fetch messages');
      }

      const payload = await response.json();
      const incoming = Array.isArray(payload) ? (payload as Message[]) : [];

      // 4) Merge strategy: if we had a cursor, merge; else replace
      let nextMessages: Message[];
      if ((latestTs || maxId) && incoming.length > 0) {
        nextMessages = mergeAndSortMessages(sourceList, incoming);
      } else if (!sourceList.length && incoming.length >= 0) {
        nextMessages = mergeAndSortMessages([], incoming);
      } else {
        // Nothing new or server unreachable for incremental — keep what we have
        nextMessages = sourceList;
      }

      setMessages(nextMessages);
      try {
        await AsyncStorage.setItem(`messages_cache_${roomId}`, JSON.stringify(nextMessages));
        setServerWarning(null);
      } catch {}
      // Scroll to bottom on initial load or when new items arrived
      const hadNew = incoming.length > 0 || !sourceList.length;
      if (isInitialLoadRef.current || hadNew) {
        scrollToBottom(true);
        // Mark initial load complete after scheduling scroll
        isInitialLoadRef.current = false;
      }

    } catch (error) {
      console.error('Error loading messages:', error);
      // Fallback: show cached if available
      try {
        const cached = await AsyncStorage.getItem(`messages_cache_${roomId}`);
        if (cached) {
          const parsed = JSON.parse(cached);
          if (Array.isArray(parsed)) setMessages(parsed);
        }
      } catch {}
      setServerWarning('Server unreachable. Showing cached messages.');
    } finally {
      setIsLoading(false);
    }
  };

  // Helpers for incremental fetching and local merging
  const getLatestMessageTimestamp = (list: Message[]): number | null => {
    if (!Array.isArray(list) || list.length === 0) return null;
    try {
      let max = -Infinity;
      for (const m of list) {
        const ms = parseTimestampSafe(m?.timestamp);
        if (isFinite(ms) && ms > max) max = ms;
      }
      return isFinite(max) ? max : null;
    } catch {
      return null;
    }
  };

  const getMaxMessageId = (list: Message[]): number | null => {
    if (!Array.isArray(list) || list.length === 0) return null;
    try {
      let max = -Infinity;
      for (const m of list) {
        const id = typeof m?.message_id === 'number' ? m.message_id : Number(m?.message_id);
        if (isFinite(id) && id > max) max = id;
      }
      return isFinite(max) ? max : null;
    } catch {
      return null;
    }
  };

  const mergeAndSortMessages = (prev: Message[], incoming: Message[]): Message[] => {
    const map = new Map<number, Message>();
    for (const m of prev) {
      if (typeof m.message_id === 'number') map.set(m.message_id, m);
    }
    for (const m of incoming) {
      if (typeof m.message_id === 'number') map.set(m.message_id, m);
    }
    const merged = Array.from(map.values());
    merged.sort((a, b) => parseTimestampSafe(a.timestamp) - parseTimestampSafe(b.timestamp));
    return merged;
  };

  const sendMessage = async () => {
    if (!newMessage.trim() || !roomId || !token || isSending || !socketRef.current) return;
    
    const messageToSend = newMessage.trim();
    
    try {
      setIsSending(true);
      
      // Clear input immediately
      setNewMessage('');
      
      // Clear typing indicator
      if (typingTimeoutRef.current) {
        clearTimeout(typingTimeoutRef.current);
        typingTimeoutRef.current = null;
      }
      
      // Generate a stable client id and timestamp for this message
      const localTs = Date.now();
      const isoTs = new Date(localTs).toISOString();

      // Send message via socket
      socketRef.current.emit('send_chat_message', {
        room: roomId,
        message: messageToSend,
        from: user?.username || 'Anonymous',
        timestamp: isoTs,
        client_id: localTs,
      });
      
      // Optimistic local echo so it appears immediately
      const localMsg: Message = {
        message_id: localTs,
        sender: user?.username || 'system',
        content: messageToSend,
        timestamp: isoTs,
        type: 'text',
        status: 'sent',
      };
      setMessages(prev => [...prev, localMsg]);
      // Play message sound on send
      void messageSoundRef.current?.replayAsync().catch((e) => {
        console.warn('Failed to play message sound (send):', e);
      });
      setTimeout(() => flatListRef.current?.scrollToEnd({ animated: true }), 100);
    } catch (error) {
      console.error('Error sending message:', error);
      Alert.alert('Error', 'Failed to send message');
      setNewMessage(messageToSend);
    } finally {
      setIsSending(false);
    }
  };

  const formatTimestamp = (timestamp: string) => {
    const date = new Date(timestamp);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffMinutes = Math.floor(diffMs / (1000 * 60));
    const diffHours = Math.floor(diffMs / (1000 * 60 * 60));
    const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

    if (diffMinutes < 1) return 'now';
    if (diffMinutes < 60) return `${diffMinutes}m`;
    if (diffHours < 24) return `${diffHours}h`;
    if (diffDays < 7) return `${diffDays}d`;
    
    return date.toLocaleDateString();
  };

  // Full, local timestamp (e.g., "Aug 19, 2025, 1:36 AM").
  // Uses parseTimestampSafe to handle ISO strings, numbers, or strings with sub-second precision.
  const formatFullTimestamp = (value: any) => {
    const ms = parseTimestampSafe(value);
    const dt = new Date(ms);
    return dt.toLocaleString(undefined, {
      year: 'numeric',
      month: 'short',
      day: '2-digit',
      hour: 'numeric',
      minute: '2-digit',
      hour12: true,
    });
  };

  const renderMessage = ({ item }: { item: Message }) => {
    const isOutgoing = item.sender === user?.username;
    const messageText = safeText(item.content || item.message || '');
    const senderName = safeText(item.sender);
    const reactions = item.reactions ? Object.entries(item.reactions) : [];

    return (
      <View style={[styles.messageRow, isOutgoing ? styles.myMessageRow : styles.otherMessageRow]}>
        <View style={isOutgoing ? {} : {flexShrink: 1}}>
          {!isOutgoing && (
            <Text style={[styles.senderName, { color: isDark ? '#9ca3af' : '#6b7280' }]}>
              {senderName}
            </Text>
          )}

          {item.reply_content && item.reply_sender && (
            <View style={[styles.replyPreview, { backgroundColor: isDark ? '#7c3aed20' : '#ddd6fe' }]}>
              <Text style={[styles.replyAuthor, { color: isDark ? '#a78bfa' : '#7c3aed' }]}>
                {safeText(item.reply_sender)}
              </Text>
              <Text style={[styles.replyText, { color: isDark ? '#e5e7eb' : '#374151' }]} numberOfLines={1}>
                {safeText(item.reply_content)}
              </Text>
            </View>
          )}

          <TouchableOpacity
            activeOpacity={0.9}
            onLongPress={() => setSelectedMessageId(item.message_id)}
            style={[styles.messageBubble, isOutgoing ? styles.myMessageBubble : styles.otherMessageBubble]}
          >
            {item.type === 'audio' ? (
              <AudioMessage
                uri={item.file_url || ''}
                duration={item.audio_data ? parseInt(item.audio_data) : 30}
                isOutgoing={isOutgoing}
                timestamp={new Date(item.timestamp).getTime()}
                onReaction={(emoji) => handleSendReaction(item.message_id, emoji)}
              />
            ) : item.type === 'file' ? (
              <FileMessage
                file_id={item.file_id}
                file_name={item.file_name}
                file_type={item.file_type}
                file_size={item.file_size}
                file_url={item.file_url}
                sender={item.sender}
                timestamp={item.timestamp}
                isOutgoing={isOutgoing}
                isDark={isDark}
              />
            ) : (
              <Text style={[styles.messageText, { color: '#e5e7eb' }]}>
                {messageText}
              </Text>
            )}
            <Text style={styles.timestamp}>{formatTimestamp(item.timestamp)}</Text>
          </TouchableOpacity>

          {reactions.length > 0 && (
            <View style={[styles.reactionsContainer, { alignSelf: isOutgoing ? 'flex-end' : 'flex-start' }]}>
              {reactions.map(([emoji, users]) => (
                <View key={emoji} style={styles.reactionBadge}>
                  <Text>{emoji}</Text>
                  <Text style={styles.reactionCount}>{users.length}</Text>
                </View>
              ))}
            </View>
          )}

          {showTimestamps && (
            <Text style={[styles.timestamp, { color: '#ec4899', alignSelf: isOutgoing ? 'flex-end' : 'flex-start' }]}>
              {formatFullTimestamp(item.timestamp)}
            </Text>
          )}
        </View>
        <TouchableOpacity style={styles.reactionButton} onPress={() => setSelectedMessageId(item.message_id)}>
          <Ionicons name="happy-outline" size={22} color="#888" />
        </TouchableOpacity>
      </View>
    );
  };

  const parseTimestampSafe = (value: any): number => {
    if (typeof value === 'number' && isFinite(value)) return value;
    if (typeof value === 'string') {
      const n = Number(value);
      if (isFinite(n)) return n;
      const p = Date.parse(value);
      if (isFinite(p)) return p;
    }
    return Date.now();
  };

  // Parses timestamps and normalizes fractional seconds to milliseconds.
  // Fixes malformed timezone strings like "+00:00Z" by removing the extra 'Z' when an offset exists.
  // For naive ISO strings (no timezone), parse as local time to match server/local expectations.
  const parseTimestampPreferUTC = (value: any): number => {
    if (typeof value === 'number' && isFinite(value)) return value;
    if (typeof value === 'string') {
      // Truncate fractional seconds to milliseconds for JS Date.parse while preserving timezone if present
      const m = value.match(/^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2})(?:\.(\d+))?(.*)$/);
      if (m) {
        const base = m[1];
        const frac = m[2] ? m[2].slice(0, 3) : undefined;
        let tail = m[3] || '';
        // If tail has both an explicit offset and a trailing Z, drop the Z (e.g., "+00:00Z" -> "+00:00")
        if (/[+-]\d{2}:?\d{2}Z$/.test(tail)) {
          tail = tail.replace(/Z$/, '');
        }
        const normalized = frac ? `${base}.${frac}${tail}` : `${base}${tail}`;
        const p = Date.parse(normalized);
        if (isFinite(p)) return p;
      }
      // Fallback to normal parse
      const p2 = Date.parse(value);
      if (isFinite(p2)) return p2;
    }
    return Date.now();
  };

  // Normalize various possible timestamp fields into a consistent ISO string.
  const pickTimestampISO = (data: any): string => {
    const candidates = [
      data?.timestamp,
      data?.server_timestamp,
      data?.server_ts,
      data?.sent_at,
      data?.created_at,
      data?.message_id,
      data?.client_id,
    ];
    for (const c of candidates) {
      if (c === undefined || c === null) continue;
      const ms = parseTimestampPreferUTC(c);
      if (Number.isFinite(ms)) return new Date(ms).toISOString();
    }
    return new Date().toISOString();
  };

  if (isLoading) {
    return (
      <ThemedView style={styles.container}>
        <View style={[styles.header, { backgroundColor: isDark ? '#1f2937' : '#ffffff' }]}>
          <TouchableOpacity onPress={() => router.back()} style={styles.backButton}>
            <Ionicons name="arrow-back" size={24} color={isDark ? '#ffffff' : '#1f2937'} />
          </TouchableOpacity>
          <ThemedText style={styles.headerTitle}>{contactName}</ThemedText>
          <View style={styles.headerActions} />
        </View>
        
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color="#420796" />
          <ThemedText style={styles.loadingText}>Loading messages...</ThemedText>
        </View>
      </ThemedView>
    );
  }

  // Infer MIME type when picker doesn't provide it (Android often returns undefined)
  const guessMimeType = (name?: string, uri?: string) => {
    const candidate = name || uri;
    if (!candidate) return 'application/octet-stream';
    const last = candidate.split('/').pop() || candidate; // if uri has path segments
    const ext = last.split('?')[0].split('#')[0].split('.').pop()?.toLowerCase();
    switch (ext) {
      case 'jpg':
      case 'jpeg':
      case 'png':
      case 'gif':
      case 'webp':
        return `image/${ext === 'jpg' ? 'jpeg' : ext}`;
      case 'mp4':
      case 'm4v':
      case 'mov':
      case 'webm':
      case 'mkv':
      case '3gp':
        return `video/${ext === 'm4v' ? 'mp4' : ext}`;
      case 'mp3':
      case 'm4a':
      case 'wav':
        return `audio/${ext === 'm4a' ? 'mp4' : ext}`;
      case 'pdf':
        return 'application/pdf';
      default:
        return 'application/octet-stream';
    }
  };

  const isImageLike = (mime?: string, name?: string, uri?: string) => {
    const m = mime || guessMimeType(name, uri);
    return m.startsWith('image/');
  };

  const isVideoLike = (mime?: string, name?: string, uri?: string) => {
    const m = mime || guessMimeType(name, uri);
    return m.startsWith('video/');
  };

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: isDark ? '#111827' : '#ffffff' }]} edges={['top', 'left', 'right']}>
      {/* Header */}
      <View style={[styles.header, { backgroundColor: '#5b2a86' }]}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backButton}>
          <Ionicons name="arrow-back" size={24} color="#ffffff" />
        </TouchableOpacity>
        <View style={styles.headerIdentity}>
          <View style={styles.avatar}>
            <Text style={styles.avatarText}>{contactInitial}</Text>
            <View style={styles.onlineDot} />
          </View>
          <ThemedText style={[styles.headerTitle, { color: '#ffffff' }]}>{contactName}</ThemedText>
        </View>
        <View style={styles.headerActions}>
          <TouchableOpacity 
            style={[styles.headerIconPill, { backgroundColor: '#10b981' }]}
            onPress={() => handleStartCall('audio')}
          >
            <Ionicons name="call" size={18} color="#ffffff" />
          </TouchableOpacity>
          <TouchableOpacity 
            style={[styles.headerIconPill, { backgroundColor: '#3b82f6' }]}
            onPress={() => handleStartCall('video')}
          >
            <Ionicons name="videocam" size={18} color="#ffffff" />
          </TouchableOpacity>
        </View>
      </View>

      {/* Server warning banner */}
      {serverWarning ? (
        <View
          style={[
            styles.warningBanner,
            { borderColor: isDark ? '#f59e0b' : '#d97706', backgroundColor: '#f59e0b20' }
          ]}
        >
          <Ionicons name="alert-circle" size={16} color={isDark ? '#f59e0b' : '#b45309'} style={{ marginRight: 6 }} />
          <Text style={{ color: isDark ? '#fbbf24' : '#92400e', fontSize: 12 }}>{serverWarning}</Text>
        </View>
      ) : null}

      {/* Main Content with Keyboard Avoidance */}
      <KeyboardAvoidingView 
        style={[
          styles.chatContainer,
          { backgroundColor: chatBgColor ?? (isDark ? '#111827' : '#ffffff') }
        ]}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        keyboardVerticalOffset={Platform.OS === 'ios' ? 88 : 0}
        onLayout={() => {
          if (isInitialLoadRef.current) scrollToBottom(false);
        }}
      >
        {/* Messages List */}
        <FlatList
          ref={flatListRef}
          data={messages}
          keyExtractor={(item) => String(item.message_id)}
          renderItem={renderMessage}
          contentContainerStyle={styles.messagesContainer}
          ListEmptyComponent={<Text style={styles.emptyText}>No messages yet.</Text>}
          onEndReachedThreshold={0.5}
          removeClippedSubviews
          windowSize={8}
          initialNumToRender={12}
          maxToRenderPerBatch={12}
          updateCellsBatchingPeriod={50}
          onLayout={(e) => {
            listHeightRef.current = e.nativeEvent.layout.height;
          }}
          onContentSizeChange={(w, h) => {
            contentHeightRef.current = h;
          }}
          onScroll={(e) => {
            const { contentOffset, contentSize, layoutMeasurement } = e.nativeEvent;
            const paddingToBottom = 40;
            const atBottom = contentOffset.y + layoutMeasurement.height >= contentSize.height - paddingToBottom;
            if (atBottom !== isAtBottom) {
              setIsAtBottom(atBottom);
              if (atBottom) setUnreadCount(0);
            }
          }}
          scrollEventThrottle={16}
        />
        
        {/* Live Typing Indicator - Always visible above input */}
        {Object.keys(typingUsers).length > 0 ? (
          <View style={styles.typingContainer}>
            {Object.entries(typingUsers).map(([username, text]) => (
              <View key={username} style={styles.typingBubble}>
                <Text style={styles.typingUsername}>{username}:</Text>
                <Text style={styles.typingText}>{text}</Text>
              </View>
            ))}
          </View>
        ) : null}

        {/* Emoji Bar - inline above input */}
        {showEmojiPicker ? (
          <View
            style={[
              styles.emojiBar,
              {
                backgroundColor: isDark ? '#1f2937' : '#ffffff',
                borderColor: isDark ? '#374151' : '#e5e7eb',
              },
            ]}
          >
            <View style={styles.emojiPickerHeader}>
              <Text style={{ fontWeight: '600', color: isDark ? '#f3f4f6' : '#111827' }}>Pick an emoji</Text>
              <TouchableOpacity onPress={() => setShowEmojiPicker(false)}>
                <Ionicons name="close" size={18} color={isDark ? '#f3f4f6' : '#111827'} />
              </TouchableOpacity>
            </View>
            <View style={styles.emojiGrid}>
              {['😀','😁','😂','🤣','😊','😎','😍','😘','😜','🤗','👍','👏','🙏','🔥','💯','🎉','✅','❌','⚡','🌟','📞','📹'].map(e => (
                <TouchableOpacity key={e} style={styles.emojiItem} onPress={() => { setNewMessage(prev => (prev || '') + e); }}>
                  <Text style={styles.emojiText}>{e}</Text>
                </TouchableOpacity>
              ))}
            </View>
          </View>
        ) : null}

        {/* Color Picker Modal */}
        <ChangeColorModal
        visible={showColorPicker}
        isDark={isDark}
        initialColor={selectedColor}
        onClose={() => { setShowWheel(false); setShowColorPicker(false); }}
        onApply={(color) => {
          setSelectedColor(color ?? null);
          applySelectedColor(color ?? null);
        }}
        onReset={() => {
          resetBgColor();
        }}
      />

        {/* Reaction Picker Modal */}
        <Modal
          visible={selectedMessageId !== null}
          transparent
          animationType="fade"
          onRequestClose={() => setSelectedMessageId(null)}
        >
          <View style={styles.modalOverlay}>
            <View style={[styles.emojiPickerContainer, { backgroundColor: isDark ? '#111827' : '#ffffff' }]}>
              <View style={styles.emojiPickerHeader}>
                <Text style={{ fontWeight: '600', color: isDark ? '#f3f4f6' : '#111827' }}>React to message</Text>
                <TouchableOpacity onPress={() => setSelectedMessageId(null)}>
                  <Ionicons name="close" size={18} color={isDark ? '#f3f4f6' : '#111827'} />
                </TouchableOpacity>
              </View>
              <View style={styles.emojiGrid}>
                {['👍','😂','❤️','🔥','🎉','👏','🙏','😮','😢','😡','🌟','✅'].map(e => (
                  <TouchableOpacity
                    key={e}
                    style={[styles.emojiItem, { backgroundColor: isDark ? '#1f2937' : '#f3f4f6' }]}
                    onPress={() => { if (selectedMessageId) handleSendReaction(selectedMessageId, e); }}
                  >
                    <Text style={styles.emojiText}>{e}</Text>
                  </TouchableOpacity>
                ))}
              </View>
            </View>
          </View>
        </Modal>

        {/* Emoji Picker */}
        {/* Input Area */}
        <View onLayout={(e) => setInputContainerHeight(e.nativeEvent.layout.height)} style={[
          styles.inputContainer, 
          {
            backgroundColor: isDark ? '#1f2937' : '#ffffff',
            paddingBottom: 12
          }
        ]}>
          {/* Actions Toggle on the left */}
          <TouchableOpacity
            style={[
              styles.actionsToggleButton,
              { backgroundColor: showActions ? '#8b5cf6' : (isDark ? '#4b5563' : '#d1d5db') }
            ]}
            onPress={() => setShowActions(!showActions)}
          >
            <Ionicons 
              name={showActions ? "chevron-down" : "add"} 
              size={20} 
              color={showActions ? "white" : (isDark ? '#9ca3af' : '#6b7280')} 
            />
          </TouchableOpacity>
          {/* Emoji Button */}
          <TouchableOpacity
            style={[styles.emojiButton, { backgroundColor: isDark ? '#374151' : '#e5e7eb' }]}
            onPress={() => setShowEmojiPicker(prev => !prev)}
          >
            <Ionicons name="happy" size={20} color={isDark ? '#f3f4f6' : '#374151'} />
          </TouchableOpacity>
          <TextInput
            style={[
              styles.messageInput,
              { 
                backgroundColor: isDark ? '#374151' : '#f3f4f6',
                color: isDark ? '#ffffff' : '#1f2937',
                // Limit growth to two lines; scroll inside after that
                height: Math.max(40, inputHeight),
                maxHeight: MAX_INPUT_HEIGHT,
                lineHeight: INPUT_LINE_HEIGHT,
                textAlignVertical: 'top'
              }
            ]}
            value={newMessage}
            onChangeText={handleTextChange}
            onKeyPress={handleKeyPress}
            onSubmitEditing={sendMessage}
            placeholder="Type a message..."
            placeholderTextColor={isDark ? '#9ca3af' : '#6b7280'}
            multiline
            maxLength={1000}
            blurOnSubmit={false}
            onContentSizeChange={(e) => {
              const h = e.nativeEvent.contentSize.height;
              const capped = Math.min(h, MAX_INPUT_HEIGHT);
              setInputHeight(capped);
            }}
            scrollEnabled={inputHeight >= MAX_INPUT_HEIGHT}
          />
          {/* Send Button comes next to input */}
          <TouchableOpacity
            style={[
              styles.sendButton,
              { opacity: (newMessage.trim() && !isSending) ? 1 : 0.5 }
            ]}
            onPress={sendMessage}
            disabled={!newMessage.trim() || isSending}
          >
            {isSending ? (
              <ActivityIndicator size="small" color="#ffffff" />
            ) : (
              <Ionicons name="send" size={20} color="#ffffff" />
            )}
          </TouchableOpacity>
        </View>

        {/* Chat Actions - toggled grid under input */}
        {showActions ? (
          <View onLayout={(e) => setActionsContainerHeight(e.nativeEvent.layout.height)} style={[
            styles.actionsContainer,
            { backgroundColor: isDark ? '#111827' : '#ffffff', borderTopColor: isDark ? '#374151' : '#e5e7eb' }
          ]}>
            <View style={styles.actionsGrid}>
              <TouchableOpacity 
                style={[styles.actionButton, { backgroundColor: '#0ea5e9' }]}
                onPress={async () => {
                  try {
                    setUploadError(null);
                    // Expo DocumentPicker API (SDK 53+)
                    const result = await DocumentPicker.getDocumentAsync({
                      multiple: false,
                      copyToCacheDirectory: true,
                      type: '*/*',
                    });
                    const canceled = (result as any).canceled === true || (result as any).type === 'cancel';
                    if (canceled) return;
                    const asset = (result as any).assets?.[0] ?? result;
                    if (!asset?.uri) return;
                    console.log('[Picker] result asset:', {
                      uri: asset?.uri,
                      name: asset?.name,
                      mimeType: asset?.mimeType,
                      size: asset?.size,
                    });
                    const file = {
                      uri: asset.uri as string,
                      name: (asset.name as string) || 'file',
                      type: (asset.mimeType as string) || guessMimeType(asset.name as string, asset.uri as string),
                      size: Number(asset.size ?? 0),
                    };
                    console.log('[Picker] mapped file:', file);
                    setPickedFile(file);
                    setShowFilePreviewModal(true);
                  } catch (e) {
                    Alert.alert('Error', 'Failed to open file picker');
                    console.warn('[Picker] error:', e);
                  }
                }}
              >
                <Ionicons name="document" size={16} color="white" />
                <Text style={styles.actionButtonText}>Send File</Text>
              </TouchableOpacity>
              <TouchableOpacity 
                style={[styles.actionButton, { backgroundColor: '#10b981' }]}
                onPress={sendNotification}
              >
                <Ionicons name="notifications" size={16} color="white" />
                <Text style={styles.actionButtonText}>Ring Doorbell</Text>
              </TouchableOpacity>
              <TouchableOpacity 
                style={[styles.actionButton, { backgroundColor: '#6366f1' }]}
                onPress={() => { setShowColorPicker(prev => !prev); setShowEmojiPicker(false); }}
              >
                <Ionicons name="color-palette" size={16} color="white" />
                <Text style={styles.actionButtonText}>Change Color</Text>
              </TouchableOpacity>
              <TouchableOpacity 
                style={[styles.actionButton, { backgroundColor: '#ec4899' }]}
                onPress={() => setShowVoiceRecorder(true)}
              >
                <Ionicons name="mic" size={16} color="white" />
                <Text style={styles.actionButtonText}>Record Voice Message</Text>
              </TouchableOpacity>
              <TouchableOpacity 
                style={[styles.actionButton, { backgroundColor: '#8b5cf6' }]}
                onPress={() => setShowTimestamps(prev => !prev)}
              >
                <Ionicons name="time" size={16} color="white" />
                <Text style={styles.actionButtonText}>{showTimestamps ? 'Hide Timestamps' : 'Show Timestamps'}</Text>
              </TouchableOpacity>
              {chatBgColor ? (
                <TouchableOpacity 
                  style={[styles.actionButton, { backgroundColor: '#6b7280' }]}
                  onPress={resetBgColor}
                >
                  <Ionicons name="refresh" size={16} color="white" />
                  <Text style={styles.actionButtonText}>Reset BG Color</Text>
                </TouchableOpacity>
              ) : null}
              <TouchableOpacity 
                style={[styles.actionButton, { backgroundColor: '#ef4444' }]}
                onPress={() => Alert.alert('Delete All Messages', 'This will be available soon.')}
              >
                <Ionicons name="trash" size={16} color="white" />
                <Text style={styles.actionButtonText}>Delete All Messages</Text>
              </TouchableOpacity>
            </View>
          </View>
        ) : null}
      </KeyboardAvoidingView>
      
      {/* File Preview Modal */}
      <Modal
        visible={showFilePreviewModal}
        transparent
        animationType="slide"
        onRequestClose={() => {
          if (!isUploadingFile) {
            setShowFilePreviewModal(false);
            setPickedFile(null);
            setUploadProgressPct(0);
            setUploadError(null);
          }
        }}
      >
        <View style={styles.modalOverlay}>
          <View style={[styles.modalContent, { backgroundColor: isDark ? '#1f2937' : '#ffffff' }]}>
            <Text style={[styles.modalTitle, { color: isDark ? '#f3f4f6' : '#1f2937' }]}>Send File</Text>
            {pickedFile ? (
              <View style={{ marginTop: 8 }}>
                <Text style={[styles.modalText, { color: isDark ? '#e5e7eb' : '#374151' }]}>Name: {pickedFile.name}</Text>
                <Text style={[styles.modalText, { color: isDark ? '#9ca3af' : '#6b7280' }]}>Type: {pickedFile.type}</Text>
                <Text style={[styles.modalText, { color: isDark ? '#9ca3af' : '#6b7280' }]}>Size: {((pickedFile.size || 0) / (1024 * 1024)).toFixed(2)} MB</Text>
              </View>
            ) : null}

            {/* Inline preview for images/videos with logging and fallbacks */}
            {pickedFile && (() => {
              const isImage = isImageLike(pickedFile.type, pickedFile.name, pickedFile.uri);
              const isVideo = isVideoLike(pickedFile.type, pickedFile.name, pickedFile.uri);
              const uri = pickedFile.uri || '';
              const scheme = uri.split(':')[0];
              const previewable = uri.startsWith('file://') || uri.startsWith('http://') || uri.startsWith('https://');
              console.log('[Preview] candidate', {
                name: pickedFile.name,
                type: pickedFile.type,
                size: pickedFile.size,
                uriPrefix: uri.slice(0, 24),
                scheme,
                isImage,
                isVideo,
                previewable,
              });
              if (!isImage && !isVideo) return null;

              if (!previewable) {
                console.log('[Preview] non-previewable scheme, showing fallback UI');
                return (
                  <View style={{ marginTop: 12, padding: 12, borderRadius: 8, backgroundColor: isDark ? '#111827' : '#f3f4f6' }}>
                    <Text style={{ color: isDark ? '#e5e7eb' : '#374151', marginBottom: 8 }}>
                      Inline preview not available for selected file source.
                    </Text>
                    <TouchableOpacity
                      onPress={() => Linking.openURL(uri).catch(() => {})}
                      style={{ alignSelf: 'flex-start' }}
                    >
                      <Text style={{ color: '#2563EB', fontWeight: '600' }}>Open to preview</Text>
                    </TouchableOpacity>
                  </View>
                );
              }

              return (
                <View
                  style={{ marginTop: 12, width: '100%', alignSelf: 'stretch' }}
                  onLayout={(e) => {
                    const { width, height } = e.nativeEvent.layout;
                    console.log('[Preview] container layout', { width, height });
                  }}
                >
                  {isImage ? (
                    <TouchableOpacity
                      activeOpacity={0.9}
                      onPress={() => setShowPickedFullScreen(true)}
                    >
                      {uri.startsWith('file://') ? (
                        // Prefer RN Image for local file:// URIs (more reliable on Android)
                        <Image
                          source={{ uri }}
                          style={{ width: '100%', height: 220, borderRadius: 8, backgroundColor: '#111827' }}
                          onLoadStart={() => {
                            setPickedImageError(null);
                            console.log('[Preview][image-rn] load start');
                          }}
                          onLoad={() => console.log('[Preview][image-rn] load success')}
                          onError={() => {
                            console.warn('[Preview][image-rn] load error');
                            setPickedImageError('rn-image load error');
                          }}
                          resizeMode="cover"
                        />
                      ) : (
                        // Use ExpoImage for http(s) where decoding/caching is beneficial
                        <ExpoImage
                          source={{ uri }}
                          style={{ width: '100%', height: 220, borderRadius: 8, backgroundColor: '#111827' }}
                          contentFit="cover"
                          onLoadStart={() => {
                            setPickedImageError(null);
                            console.log('[Preview][image-expo] load start');
                          }}
                          onLoad={() => {
                            console.log('[Preview][image-expo] load success');
                          }}
                          onError={() => {
                            console.warn('[Preview][image-expo] load error');
                            setPickedImageError('expo-image load error');
                          }}
                        />
                      )}
                    </TouchableOpacity>
                  ) : (
                    <TouchableOpacity activeOpacity={0.9} onPress={() => setShowPickedFullScreen(true)}>
                      <Video
                        source={{ uri }}
                        style={{ width: '100%', height: 240, borderRadius: 8, backgroundColor: '#000' }}
                        useNativeControls
                        resizeMode={ResizeMode.CONTAIN}
                        shouldPlay={false}
                        isLooping={false}
                        onError={(e) => {
                          const msg = (e as any)?.toString?.() || 'video error';
                          console.warn('[Preview][video] load/play error:', msg);
                          setPickedVideoError(msg);
                        }}
                      />
                      {pickedVideoError ? (
                        <Text style={{ color: '#ef4444', marginTop: 6 }}>Video preview failed: {pickedVideoError}</Text>
                      ) : null}
                    </TouchableOpacity>
                  )}
                </View>
              );
            })()}

            {uploadError ? (
              <Text style={[styles.modalText, { color: '#ef4444', marginTop: 8 }]}>{uploadError}</Text>
            ) : null}

            {isUploadingFile ? (
              <View style={{ marginTop: 12, alignItems: 'center' }}>
                <ActivityIndicator size="large" color="#10b981" />
                <Text style={{ marginTop: 8, color: isDark ? '#e5e7eb' : '#374151' }}>Sending... {Math.max(0, Math.min(100, uploadProgressPct))}%</Text>
                <TouchableOpacity
                  style={[styles.modalCloseButton, { backgroundColor: '#ef4444', marginTop: 12 }]}
                  onPress={() => {
                    try { FileUploadService.getInstance().cancelCurrentUpload(); } catch {}
                    setIsUploadingFile(false);
                  }}
                >
                  <Text style={styles.modalCloseButtonText}>Cancel</Text>
                </TouchableOpacity>
              </View>
            ) : (
              <View style={{ marginTop: 16, flexDirection: 'row', justifyContent: 'space-between', flexWrap: 'wrap', gap: 8 }}>
                <TouchableOpacity
                  style={[styles.modalCloseButton, { backgroundColor: '#0ea5e9' }]}
                  onPress={async () => {
                    try {
                      setUploadError(null);
                      const result = await DocumentPicker.getDocumentAsync({ multiple: false, copyToCacheDirectory: true, type: '*/*' });
                      const canceled = (result as any).canceled === true || (result as any).type === 'cancel';
                      if (canceled) return;
                      const asset = (result as any).assets?.[0] ?? result;
                      if (!asset?.uri) return;
                      const file = {
                        uri: asset.uri as string,
                        name: (asset.name as string) || 'file',
                        type: (asset.mimeType as string) || guessMimeType(asset.name as string, asset.uri as string),
                        size: Number(asset.size ?? 0),
                      };
                      setPickedFile(file);
                    } catch (e) {
                      Alert.alert('Error', 'Failed to open file picker');
                    }
                  }}
                >
                  <Text style={styles.modalCloseButtonText}>Change File</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[styles.modalCloseButton, { backgroundColor: '#6b7280' }]}
                  onPress={() => { setShowFilePreviewModal(false); setPickedFile(null); setUploadError(null); setUploadProgressPct(0); }}
                >
                  <Text style={styles.modalCloseButtonText}>Close</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[styles.modalCloseButton, { backgroundColor: '#10b981' }]}
                  onPress={async () => {
                    if (!pickedFile || !roomId || !token || !user?.username) return;
                    console.log('[Upload] starting...', {
                      roomId,
                      username: user.username,
                      file: {
                        name: pickedFile.name,
                        type: pickedFile.type,
                        size: pickedFile.size,
                        uri: pickedFile.uri?.slice(0, 60) + '...'
                      }
                    });
                    try {
                      setIsUploadingFile(true);
                      setUploadError(null);
                      const uploader = FileUploadService.getInstance();
                      const result = await uploader.uploadFile(
                        pickedFile,
                        roomId as string,
                        user.username,
                        token,
                        (p) => {
                          const pct = Math.max(0, Math.min(100, p.percentage));
                          setUploadProgressPct(pct);
                          if (p.percentage % 5 === 0) {
                            console.log('[Upload] progress:', p);
                          }
                        }
                      );
                      console.log('[Upload] success:', result);
                      // Optimistic/local echo for file message
                      const localTs = Date.now();
                      const isoTs = new Date(localTs).toISOString();
                      const fileMsg: Message = {
                        message_id: localTs,
                        sender: user.username,
                        timestamp: isoTs,
                        type: 'file',
                        file_id: result.file_id,
                        file_name: result.file_name,
                        file_type: result.file_type,
                        file_size: result.file_size,
                        file_url: result.file_url,
                        status: 'sent',
                      };
                      setMessages(prev => [...prev, fileMsg]);
                      // Notify server via socket so other clients (e.g., web) receive the file message
                      if (socketRef.current) {
                        socketRef.current.emit('send_file', {
                          room: roomId,
                          from: user.username,
                          token: token,
                          file_id: result.file_id,
                          file_name: result.file_name,
                          file_type: result.file_type,
                          file_size: result.file_size,
                          file_url: result.file_url,
                          timestamp: isoTs,
                          client_id: localTs,
                        });
                      }
                      setShowFilePreviewModal(false);
                      setPickedFile(null);
                      setUploadProgressPct(0);
                      setTimeout(() => flatListRef.current?.scrollToEnd({ animated: true }), 100);
                    } catch (e: any) {
                      const msg = e?.message || 'Failed to upload file';
                      setUploadError(msg);
                      console.warn('[Upload] error:', e);
                    } finally {
                      setIsUploadingFile(false);
                    }
                  }}
                >
                  <Text style={styles.modalCloseButtonText}>Send</Text>
                </TouchableOpacity>
              </View>
            )}
          </View>
        </View>
      </Modal>

      {/* Picked file full-screen preview */}
      <Modal
        visible={showPickedFullScreen}
        transparent
        animationType="fade"
        onRequestClose={() => setShowPickedFullScreen(false)}
      >
        <View style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.92)', justifyContent: 'center' }}>
          <TouchableOpacity style={{ position: 'absolute', top: 50, right: 20, zIndex: 1 }} onPress={() => setShowPickedFullScreen(false)}>
            <Ionicons name="close" size={28} color="#fff" />
          </TouchableOpacity>
          <View style={{ alignItems: 'center', paddingHorizontal: 16 }}>
            {pickedFile && isImageLike(pickedFile.type, pickedFile.name, pickedFile.uri) ? (
              <ExpoImage
                source={{ uri: pickedFile.uri }}
                style={{ width: '100%', height: 420, borderRadius: 8 }}
                contentFit="contain"
              />
            ) : pickedFile && isVideoLike(pickedFile.type, pickedFile.name, pickedFile.uri) ? (
              <Video
                source={{ uri: pickedFile.uri }}
                style={{ width: '100%', height: 420, borderRadius: 8, backgroundColor: '#000' }}
                useNativeControls
                resizeMode={ResizeMode.CONTAIN}
                shouldPlay
                isLooping={false}
              />
            ) : null}
          </View>
        </View>
      </Modal>

      {/* Call Setup Modal */}
      <CallSetupModal
        visible={showCallSetup}
        callType={callType}
        recipientName={contactName}
        onStartCall={handleCallSetupStart}
        onCancel={() => setShowCallSetup(false)}
      />

      {/* Incoming Call Modal */}
      <IncomingCallModal
        visible={showIncomingCall}
        callerName={incomingCaller}
        callType={incomingCallType}
        onAccept={handleAcceptCall}
        onDecline={handleDeclineCall}
      />

      {/* Call Screen */}
      {showCallScreen && (
        <Modal visible={true} animationType="slide">
          <CallScreen
            localStream={localStream}
            remoteStream={remoteStream}
            isConnected={isCallConnected}
            isAudioMuted={isAudioMuted}
            isVideoMuted={isVideoMuted}
            callDuration={callDuration}
            recipientName={contactName}
            onEndCall={handleCallEnd}
            onToggleMute={handleToggleMute}
            onToggleVideo={handleToggleVideo}
            onSwitchCamera={handleSwitchCamera}
          />
        </Modal>
      )}

      {/* Voice Recorder Modal */}
      <VoiceRecorder
        visible={showVoiceRecorder}
        onClose={() => setShowVoiceRecorder(false)}
        onSendRecording={sendRecording}
      />

      {/* Floating Unread Badge */}
      {!isAtBottom ? (
        <View style={[
          styles.unreadBadgeContainer, 
          { bottom: inputContainerHeight + (showActions ? actionsContainerHeight : 0) + 12 } 
        ]} pointerEvents="box-none">
          <TouchableOpacity
            style={[styles.unreadBadge, { backgroundColor: '#10b981' }]}
            onPress={() => {
              setUnreadCount(0);
              scrollToBottom(true);
            }}
            accessibilityRole="button"
            accessibilityLabel="Scroll to latest messages"
          >
            <Ionicons name="arrow-down" size={16} color="#fff" />
            {unreadCount > 0 ? (
              <Text style={styles.unreadBadgeText}>{unreadCount}</Text>
            ) : null}
          </TouchableOpacity>
        </View>
      ) : null}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  voiceRecorderContainer: {
    width: '100%',
    paddingHorizontal: 8,
    paddingBottom: 8,
  },
  audioMessageBubble: {
    minWidth: 150,
    maxWidth: 250,
  },
  audioMessageContent: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 4,
  },
  audioPlayButton: {
    width: 36,
    height: 36,
    borderRadius: 18,
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 8,
  },
  audioWaveform: {
    flexDirection: 'row',
    alignItems: 'center',
    height: 24,
    flex: 1,
  },
  audioWaveformBar: {
    width: 3,
    marginHorizontal: 1,
    borderRadius: 1.5,
  },
  audioDuration: {
    fontSize: 12,
    marginLeft: 8,
  },
  container: {
    flex: 1,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#e5e7eb',
  },
  backButton: {
    marginRight: 12,
  },
  headerIdentity: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
  },
  headerTitle: {
    flex: 1,
    fontSize: 18,
    fontWeight: '600',
  },
  headerActions: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  headerIconPill: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
    marginLeft: 10,
  },
  avatar: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: '#7c3aed',
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 10,
  },
  avatarText: {
    color: '#ffffff',
    fontWeight: '700',
  },
  onlineDot: {
    position: 'absolute',
    right: -2,
    bottom: -2,
    width: 12,
    height: 12,
    borderRadius: 6,
    backgroundColor: '#10b981',
    borderWidth: 2,
    borderColor: '#5b2a86',
  },
  headerButton: {
    marginLeft: 16,
  },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  loadingText: {
    marginTop: 12,
    fontSize: 16,
  },
  chatContainer: {
    flex: 1,
  },
  messagesList: {
    flex: 1,
  },
  messagesContent: {
    padding: 16,
  },
  messageContainer: {
    marginBottom: 12,
    maxWidth: '75%',
  },
  outgoingMessage: {
    alignSelf: 'flex-end',
  },
  incomingMessage: {
    alignSelf: 'flex-start',
  },
  senderName: {
    fontSize: 12,
    marginBottom: 4,
    marginLeft: 12,
  },
  messageBubble: {
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderRadius: 16,
    shadowColor: '#000',
    shadowOffset: {
      width: 0,
      height: 1,
    },
    shadowOpacity: 0.1,
    shadowRadius: 2,
    elevation: 2,
  },
  messageText: {
    fontSize: 15,
    lineHeight: 20,
    fontWeight: '400',
  },
  audioMessage: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  audioText: {
    marginLeft: 8,
    fontSize: 16,
  },
  fileMessage: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  fileText: {
    marginLeft: 8,
    fontSize: 16,
  },
  timestamp: {
    fontSize: 12,
    color: '#a1a1aa',
    marginTop: 4,
    alignSelf: 'flex-end',
  },
  messageRow: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    marginVertical: 4,
    marginHorizontal: 8,
    maxWidth: '85%',
  },
  myMessageRow: {
    alignSelf: 'flex-end',
    flexDirection: 'row-reverse',
  },
  otherMessageRow: {
    alignSelf: 'flex-start',
  },
  myMessageBubble: {
    backgroundColor: '#420796',
  },
  otherMessageBubble: {
    backgroundColor: '#3944bc',
  },
  reactionsContainer: {
    flexDirection: 'row',
    marginTop: 8,
  },
  reactionBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(255, 255, 255, 0.2)',
    borderRadius: 12,
    paddingHorizontal: 6,
    paddingVertical: 2,
    marginRight: 4,
  },
  reactionCount: {
    color: '#fff',
    fontSize: 12,
    marginLeft: 4,
  },
  reactionButton: {
    padding: 4,
    marginLeft: 4,
    marginRight: 4,
  },
  messagesContainer: {
    paddingVertical: 16,
  },
  emptyText: {
    textAlign: 'center',
    marginTop: 20,
    color: '#9ca3af',
  },
  replyPreview: {
    marginHorizontal: 12,
    marginBottom: 8,
    padding: 8,
    borderRadius: 8,
    borderLeftWidth: 4,
    borderLeftColor: '#7c3aed',
  },
  replyAuthor: {
    fontSize: 12,
    fontWeight: '600',
    marginBottom: 2,
  },
  replyText: {
    fontSize: 14,
    fontStyle: 'italic',
  },
  inputContainer: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    paddingHorizontal: 16,
    paddingTop: 12,
    paddingBottom: 12,
    borderTopWidth: 1,
    borderTopColor: '#e5e7eb',
  },
  emojiButton: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 8,
  },
  actionsContainer: {
    paddingVertical: 8,
    paddingHorizontal: 16,
    borderTopWidth: 1,
    borderTopColor: '#e5e7eb',
  },
  emojiBar: {
    paddingHorizontal: 12,
    paddingTop: 8,
    paddingBottom: 6,
    borderTopWidth: 1,
    borderBottomWidth: 1,
    borderColor: '#e5e7eb',
  },
  // Inline Color Picker bar just above the input
  colorBar: {
    paddingHorizontal: 12,
    paddingTop: 8,
    paddingBottom: 8,
    borderTopWidth: 1,
    borderBottomWidth: 1,
  },
  colorRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
    marginBottom: 8,
  },
  colorSwatch: {
    width: 26,
    height: 26,
    borderRadius: 6,
    borderWidth: 1,
  },
  colorSwatchSelected: {
    borderWidth: 2,
    borderColor: '#8b5cf6',
  },
  colorActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  smallButton: {
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 6,
  },
  smallButtonText: {
    color: '#ffffff',
    fontSize: 12,
    fontWeight: '600',
  },
  actionsGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'space-between',
    gap: 8,
  },
  actionsScrollContent: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  actionButton: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 6,
    gap: 6,
    // Grid sizing: two columns
    flexBasis: '48%',
    justifyContent: 'center',
    marginBottom: 8,
  },
  actionButtonText: {
    color: 'white',
    fontSize: 12,
    fontWeight: '500',
  },
  actionsToggleButton: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 8,
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.7)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  modalContent: {
    margin: 20,
    borderRadius: 8,
    padding: 32,
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: {
      width: 0,
      height: 2,
    },
    shadowOpacity: 0.25,
    shadowRadius: 4,
    elevation: 5,
    width: '90%',
    maxWidth: 420,
  },
  emojiPickerContainer: {
    margin: 20,
    borderRadius: 8,
    padding: 16,
    width: '90%',
    maxWidth: 360,
  },
  emojiPickerHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 12,
  },
  // Color Modal styles
  colorModalContainer: {
    width: '90%',
    maxWidth: 380,
    borderRadius: 10,
    padding: 16,
  },
  colorModalHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 8,
  },
  colorModalTitle: {
    fontSize: 16,
    fontWeight: '700',
  },
  colorModalSubtitle: {
    textAlign: 'center',
    fontSize: 13,
    marginBottom: 12,
  },
  colorGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'space-between',
    marginBottom: 12,
  },
  colorSwatchLarge: {
    width: 34,
    height: 34,
    borderRadius: 8,
    borderWidth: 1,
  },
  colorPreview: {
    width: '100%',
    height: 48,
    borderRadius: 6,
    borderWidth: 2,
    marginBottom: 16,
  },
  wheelContainer: {
    width: '100%',
    marginBottom: 12,
  },
  wheelSlider: {
    width: '100%',
    height: 24,
    borderRadius: 12,
    marginBottom: 12,
  },
  colorHexContainer: {
    width: '100%',
    marginBottom: 16,
  },
  colorHexInput: {
    width: '100%',
    height: 44,
    borderRadius: 6,
    borderWidth: 2,
    paddingHorizontal: 12,
    fontSize: 14,
  },
  colorFooter: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
  },
  secondaryButton: {
    flex: 1,
    paddingVertical: 10,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  secondaryButtonText: {
    color: '#ffffff',
    fontWeight: '600',
    fontSize: 14,
  },
  primaryButton: {
    flex: 1,
    paddingVertical: 10,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  primaryButtonText: {
    color: '#ffffff',
    fontWeight: '700',
    fontSize: 14,
  },
  rgbRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 12,
  },
  rgbBox: {
    width: '31%',
  },
  rgbLabel: {
    fontSize: 12,
    marginBottom: 4,
    textAlign: 'center',
  },
  rgbInput: {
    height: 44,
    borderRadius: 6,
    borderWidth: 2,
    textAlign: 'center',
    fontSize: 14,
  },
  emojiGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'space-between',
  },
  emojiItem: {
    width: '12%',
    aspectRatio: 1,
    alignItems: 'center',
    justifyContent: 'center',
    marginVertical: 6,
    borderRadius: 8,
  },
  emojiText: {
    fontSize: 22,
  },
  modalTitle: {
    fontSize: 16,
    fontWeight: 'bold',
    marginBottom: 8,
    textAlign: 'center',
  },
  modalText: {
    fontSize: 14,
    marginBottom: 24,
    textAlign: 'center',
    lineHeight: 20,
  },
  modalCloseButton: {
    backgroundColor: '#420796',
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 8,
  },
  modalCloseButtonText: {
    color: '#ffffff',
    fontSize: 14,
    fontWeight: '500',
  },
  messageInput: {
    flex: 1,
    borderRadius: 20,
    paddingHorizontal: 16,
    paddingVertical: 10,
    marginRight: 12,
    maxHeight: 100,
    fontSize: 16,
  },
  sendButton: {
    backgroundColor: '#420796',
    borderRadius: 20,
    width: 40,
    height: 40,
    justifyContent: 'center',
    alignItems: 'center',
  },
  typingContainer: {
    paddingHorizontal: 16,
    paddingVertical: 8,
    backgroundColor: '#f9fafb',
    borderTopWidth: 1,
    borderTopColor: '#e5e7eb',
    maxHeight: 120,
  },
  typingBubble: {
    backgroundColor: '#ec4899', // pink-500
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 12,
    marginBottom: 4,
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
  },
  typingUsername: {
    fontSize: 12,
    fontWeight: '600',
    color: '#ffffff',
    marginRight: 6,
  },
  typingText: {
    fontSize: 12,
    color: '#ffffff',
    flex: 1,
  },
  warningBanner: {
    marginHorizontal: 12,
    marginTop: 8,
    marginBottom: 4,
    paddingHorizontal: 10,
    paddingVertical: 8,
    borderRadius: 8,
    borderWidth: 1,
  },
  unreadBadgeContainer: {
    position: 'absolute',
    left: 0,
    right: 0,
    alignItems: 'center',
  },
  unreadBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 16,
    shadowColor: '#000',
    shadowOpacity: 0.2,
    shadowOffset: { width: 0, height: 2 },
    shadowRadius: 4,
    elevation: 3,
  },
  unreadBadgeText: {
    color: '#fff',
    fontSize: 12,
    fontWeight: '700',
  },
});
