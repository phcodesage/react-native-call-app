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
import { useFocusEffect } from '@react-navigation/native';
import {
  ActivityIndicator,
  Alert,
  FlatList,
  KeyboardAvoidingView,
  Image,
  Dimensions,
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
import * as ImagePicker from 'expo-image-picker';
import { FileUploadService } from '@/services/FileUploadService';
import { Image as ExpoImage } from 'expo-image';
import { CameraView, useCameraPermissions } from 'expo-camera';
import * as FileSystem from 'expo-file-system';
import * as Clipboard from 'expo-clipboard';
import * as Notifications from 'expo-notifications';

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
  // Inline translation result (client-side only augmentation)
  translated_text?: string;
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
  const textInputRef = useRef<TextInput | null>(null);
  const isInitialLoadRef = useRef<boolean>(true);
  const isMountedRef = useRef<boolean>(true);
  const captureInProgressRef = useRef<boolean>(false);
  const isDark = theme === 'dark';
  // Refs used by call flow (must be declared before useCallFunctions)
  const callTimerRef = useRef<NodeJS.Timeout | null>(null);
  const pendingOfferRef = useRef<any>(null);
  const contactName = roomId?.split('-').find(name => name !== user?.username) || 'Unknown';
  const contactInitial = (contactName?.trim()[0] || 'U').toUpperCase();
  const [messages, setMessages] = useState<Message[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [newMessage, setNewMessage] = useState('');
  // Editing state
  const [editingMessageId, setEditingMessageId] = useState<number | null>(null);
  const [editingOriginalText, setEditingOriginalText] = useState<string>('');
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
  // Reply UI state
  const [replyContext, setReplyContext] = useState<{ sender: string; message: string; message_id: number } | null>(null);
  const [showWheel, setShowWheel] = useState(false);
  // RGB input states for manual editing
  const [rgbR, setRgbR] = useState<string>('');
  const [rgbG, setRgbG] = useState<string>('');
  const [rgbB, setRgbB] = useState<string>('');

  // Ask notification permission once to show success notifications after exports
  useEffect(() => {
    (async () => {
      try {
        await Notifications.requestPermissionsAsync();
      } catch (e) {
        // non-fatal
        console.warn('Notification permission request failed:', e);
      }
    })();
  }, []);
  // Ensure notifications show while app is foregrounded and set Android channel
  useEffect(() => {
    Notifications.setNotificationHandler({
      handleNotification: async () => ({
        shouldShowAlert: true,
        shouldPlaySound: false,
        shouldSetBadge: false,
        // Include fields expected by newer types to avoid lint errors
        shouldShowBanner: true,
        shouldShowList: true,
      }),
    });
    if (Platform.OS === 'android') {
      Notifications.setNotificationChannelAsync('default', {
        name: 'default',
        importance: Notifications.AndroidImportance.DEFAULT,
        vibrationPattern: [0, 250, 250, 250],
        lightColor: '#FF231F7C',
      }).catch(() => {});
    }
  }, []);
  const [serverWarning, setServerWarning] = useState<string | null>(null);
  const [selectedMessageId, setSelectedMessageId] = useState<number | null>(null);
  // Anchor for reaction emoji picker: screen coordinates and direction
  const [selectedMessagePos, setSelectedMessagePos] = useState<{ id: number; x: number; y: number; isOutgoing: boolean } | null>(null);
  // Refs to measure each message bubble position on screen
  const messageRefs = useRef<Map<number, any>>(new Map());
  // Height of the reaction row to place it exactly above the bubble
  const [reactionRowHeight, setReactionRowHeight] = useState<number>(0);
  const notificationSoundRef = useRef<Audio.Sound | null>(null);
  const messageSoundRef = useRef<Audio.Sound | null>(null);
  // Input auto-grow up to 2 lines, then scroll inside
  const [inputHeight, setInputHeight] = useState<number>(40);

  // Map local echo client_id <-> server message_id to bridge live events (e.g., reactions)
  const clientIdToServerIdRef = useRef(new Map<number, number>());
  const serverIdToClientIdRef = useRef(new Map<number, number>());

  // Dev helper to verify notifications in debug builds
  const testNotification = async () => {
    try {
      await Notifications.scheduleNotificationAsync({
        content: {
          title: 'Test Notification',
          body: 'This is a local test notification (debug)'.trim(),
        },
        trigger: null,
      });
    } catch (e: any) {
      Alert.alert('Notification error', e?.message || String(e));
    }
  };

  // Quick picker for in-call "Send File" button
  const openQuickFilePicker = async () => {
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
      const file = {
        uri: asset.uri as string,
        name: (asset.name as string) || 'file',
        type: (asset.mimeType as string) || guessMimeType(asset.name as string, asset.uri as string),
        size: Number(asset.size ?? 0),
      };
      setPickedFile(file);
      setIsPickedFromCamera(false);
      setShowFilePreviewModal(true);
    } catch (e) {
      Alert.alert('Error', 'Failed to open file picker');
      console.warn('[QuickPicker] error:', e);
    }
  };
  const [inputContainerHeight, setInputContainerHeight] = useState<number>(72);
  const [actionsContainerHeight, setActionsContainerHeight] = useState<number>(0);
  const INPUT_LINE_HEIGHT = 20; // should match visual line height
  const INPUT_VERTICAL_PADDING = 20; // paddingVertical 10 (top) + 10 (bottom)

  // Persist user-chosen export directory on Android
  const EXPORT_DIR_KEY = 'export_dir_uri';
  const ensureAndroidExportDir = async (): Promise<string | null> => {
    try {
      const existing = await AsyncStorage.getItem(EXPORT_DIR_KEY);
      if (existing) return existing;
      const perm = await FileSystem.StorageAccessFramework.requestDirectoryPermissionsAsync();
      if (perm.granted && perm.directoryUri) {
        await AsyncStorage.setItem(EXPORT_DIR_KEY, perm.directoryUri);
        return perm.directoryUri;
      }
      return null;
    } catch (e) {
      console.warn('ensureAndroidExportDir error:', e);
      return null;
    }
  };

  // Mobile-friendly context menu state (bottom sheet)
  const [showContextMenu, setShowContextMenu] = useState(false);
  const [contextMenuMessage, setContextMenuMessage] = useState<Message | null>(null);
  // Track which message(s) are being translated to show a lightweight inline spinner/text
  const [translatingMessageIds, setTranslatingMessageIds] = useState<Set<number>>(new Set());
  // Single-tap selection for showing inline translate button
  const [translateTargetId, setTranslateTargetId] = useState<number | null>(null);
  const toggleTranslateTarget = (id: number) => {
    setTranslateTargetId(prev => (prev === id ? null : id));
  };
  // Track which translated messages should show their original text
  const [showOriginalIds, setShowOriginalIds] = useState<Set<number>>(new Set());
  const toggleShowOriginal = (id: number) => {
    setShowOriginalIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  // Persist last opened chat room id on focus to restore later
  useFocusEffect(
    React.useCallback(() => {
      if (roomId) {
        AsyncStorage.setItem('last_room_id', String(roomId)).catch(() => {});
      }
      return () => {};
    }, [roomId])
  );

  // Track mount to avoid setState after unmount (can happen when returning from camera)
  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
    };
  }, []);

  // Normalize backend reactions shape to emoji->users map.
  // Accepts either { username: emoji } or { emoji: [users] } and produces { emoji: [users] }
  const normalizeReactions = (input: any): { [emoji: string]: string[] } => {
    if (!input) {
      console.log('[reactions][normalize] input is empty/null -> {}');
      return {};
    }
    console.log('[reactions][normalize] input:', input);
    // If already in emoji->users form
    const firstVal = input && typeof input === 'object' ? (Object.values(input as any)[0] as any) : undefined;
    if (firstVal && Array.isArray(firstVal)) {
      console.log('[reactions][normalize] detected emoji->users map, returning as-is');
      return input as { [emoji: string]: string[] };
    }
    // username->emoji form
    const result: { [emoji: string]: string[] } = {};
    Object.entries(input as { [user: string]: string }).forEach(([u, e]) => {
      if (!e) return;
      if (!result[e]) result[e] = [];
      if (!result[e].includes(u)) result[e].push(u);
    });
    console.log('[reactions][normalize] converted to emoji->users:', result);
    return result;
  };

  // Local optimistic helpers
  const addUserReactionLocal = (reactions: { [emoji: string]: string[] } | undefined, username: string, emoji: string) => {
    const map = normalizeReactions(reactions || {});
    // Remove existing reaction by this user (if any)
    Object.keys(map).forEach(k => {
      map[k] = map[k].filter(u => u !== username);
      if (map[k].length === 0) delete map[k];
    });
    // Add new
    map[emoji] = [...(map[emoji] || []), username];
    return map;
  };

  const removeUserReactionLocal = (reactions: { [emoji: string]: string[] } | undefined, username: string) => {
    const map = normalizeReactions(reactions || {});
    Object.keys(map).forEach(k => {
      map[k] = map[k].filter(u => u !== username);
      if (map[k].length === 0) delete map[k];
    });
    return map;
  };

  // Open reaction picker anchored above the message by measuring its on-screen position
  const openReactionForMessage = (messageId: number, isOutgoing: boolean) => {
    const ref = messageRefs.current.get(messageId);
    if (ref && typeof ref.measureInWindow === 'function') {
      ref.measureInWindow((x: number, y: number, width: number, height: number) => {
        // Place the bar above the bubble; x mid used to center horizontally if needed
        setSelectedMessagePos({ id: messageId, x: x + width / 2, y: y, isOutgoing });
      });
    } else {
      // Fallback: center screen
      setSelectedMessagePos({ id: messageId, x: Dimensions.get('window').width / 2, y: Dimensions.get('window').height / 2, isOutgoing });
    }
  };
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
  const [hasPendingCapture, setHasPendingCapture] = useState(false);
  const [isPickedFromCamera, setIsPickedFromCamera] = useState(false);
  const [pickedImageError, setPickedImageError] = useState<string | null>(null);
  const [pickedVideoError, setPickedVideoError] = useState<string | null>(null);
  const [isPreviewLoading, setIsPreviewLoading] = useState<boolean>(false);
  // In-app camera state (expo-camera)
  const [cameraVisible, setCameraVisible] = useState(false);
  const [cameraFacing, setCameraFacing] = useState<'front' | 'back'>('back');
  const cameraRef = useRef<CameraView | null>(null);
  const [cameraPerm, requestCameraPerm] = useCameraPermissions();
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
        interruptionModeAndroid: InterruptionModeAndroid.DoNotMix,
        shouldDuckAndroid: false,
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
        interruptionModeAndroid: InterruptionModeAndroid.DoNotMix,
        shouldDuckAndroid: false,
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

  // WebRTC ICE candidates are queued inside WebRTCService until remoteDescription is set

  useEffect(() => {
    if (roomId && token) {
      // Mark as initial load for this room
      isInitialLoadRef.current = true;
      // Reset messages immediately to avoid showing stale while loading
      setMessages([]);
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
        // Ignore our own echo so only the peer gets the bg change
        if (user?.username && data.from === user.username) return;
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
        // Ignore our own echo so local bg does not reset due to our own action
        if (user?.username && data.from === user.username) return;
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
      console.log('Received reaction (legacy) for message id:', data?.message_id);
      handleIncomingReaction(data);
    });

    // Flask backend: broadcast after /react_message and /remove_reaction
    socket.on('message_reactions_updated', (data: any) => {
      console.log('[socket] message_reactions_updated payload:', data);
      handleIncomingReaction(data);
    });

    // Listen for message deletions
    socket.on('chat_message_deleted', (data: any) => {
      try {
        const idRaw = data?.message_id;
        if (idRaw === undefined || idRaw === null) return;
        const id = Number(idRaw);
        if (!Number.isFinite(id)) return;

        setMessages(prev => prev.filter(m => m.message_id !== id));
        // Clear editing state if the deleted message is being edited
        if (editingMessageId === id) {
          cancelEdit();
        }
        // Clear reply compose if targeting the deleted message
        setReplyContext(rc => (rc && rc.message_id === id ? null : rc));
        // Close context menu if open on this message
        setContextMenuMessage(cm => {
          if (cm && cm.message_id === id) {
            setShowContextMenu(false);
            return null;
          }
          return cm;
        });
        // Remove any cached ref
        try { messageRefs.current.delete(id); } catch {}

        // Optional: small UI feedback scroll
        if (isAtBottom) setTimeout(() => flatListRef.current?.scrollToEnd({ animated: true }), 50);
      } catch (e) {
        console.warn('Failed to handle chat_message_deleted:', e);
      }
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
            // Forward ICE candidates directly; WebRTCService will queue until ready
            if (signal.candidate && webRTCServiceRef.current) {
              await webRTCServiceRef.current.addIceCandidate(signal);
            }
            break;

          case 'call-log':
            try {
              const ts = Date.now();
              const newMsg = {
                message_id: ts,
                sender: from || 'system',
                content: signal.message || '',
                timestamp: new Date(ts).toISOString(),
                type: 'text',
                message_class: 'call',
                status: 'delivered',
              } as Message;
              setMessages(prev => [...prev, newMsg]);
              if (isAtBottom) setTimeout(() => flatListRef.current?.scrollToEnd({ animated: true }), 50);
            } catch (e) {
              console.warn('Failed to append call-log message:', e);
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
      reactions: normalizeReactions(data.reactions)
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

  const handleIncomingReaction = (data: { message_id: number | string; reactions: any }) => {
    try {
      const idNum = typeof data.message_id === 'string' ? Number(data.message_id) : data.message_id;
      const normalized = normalizeReactions(data.reactions);
      console.log('[reactions][apply] for message:', idNum, 'normalized:', normalized);

      // 1) Try exact server message_id match
      let foundExact = false;
      setMessages(prev => {
        const idx = prev.findIndex(m => m.message_id === idNum);
        if (idx >= 0) {
          foundExact = true;
          const copy = [...prev];
          copy[idx] = { ...copy[idx], reactions: normalized };
          return copy;
        }
        return prev;
      });
      if (foundExact) {
        console.log('[reactions][apply] updated by server id match', idNum);
        return;
      }

      // 2) Try mapping from server id -> client echo id
      const mappedClientId = serverIdToClientIdRef.current.get(idNum);
      if (mappedClientId) {
        console.log('[reactions][apply] found server->client mapping', idNum, '->', mappedClientId);
        let updatedViaMap = false;
        setMessages(prev => {
          const idx = prev.findIndex(m => m.client_id === mappedClientId);
          if (idx >= 0) {
            updatedViaMap = true;
            const copy = [...prev];
            copy[idx] = { ...copy[idx], reactions: normalized };
            return copy;
          }
          return prev;
        });
        if (updatedViaMap) return;
      }

      // 3) Heuristic: update most recent undelivered message from me (typical local echo)
      let updatedHeuristic = false;
      setMessages(prev => {
        for (let i = prev.length - 1; i >= 0; i--) {
          const m = prev[i];
          if (m.sender === user?.username && m.status !== 'delivered' && m.message_id !== idNum) {
            const copy = [...prev];
            copy[i] = { ...copy[i], reactions: normalized };
            updatedHeuristic = true;
            console.log('[reactions][apply] heuristic applied to local echo index', i);
            return copy;
          }
        }
        return prev;
      });
      if (updatedHeuristic) return;

      // 4) Last resort: do not refresh automatically; just log
      console.warn('[reactions][apply] message id not found in state (no auto-refresh):', idNum);
    } catch (e) {
      console.warn('[reactions][apply] failed:', e);
    }
  };

  const updateMessageStatus = (messageId: number, status: string) => {
    setMessages(prevMessages => 
      prevMessages.map(msg => 
        msg.message_id === messageId ? { ...msg, status } : msg
      )
    );
  };

  const handleSendReaction = async (messageId: number, emoji: string) => {
    if (!roomId || !user?.username) return;
    // Optimistic update
    console.log('[reactions][send] optimistic add', { messageId, emoji, user: user.username });
    setMessages(prev => prev.map(m => (m.message_id === messageId ? { ...m, reactions: addUserReactionLocal(m.reactions, user.username!, emoji) } : m)));
    setSelectedMessagePos(null);
    try {
      console.log('[reactions][send] POST /react_message');
      const resp = await fetch(getApiUrl('/react_message'), {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`,
        },
        body: JSON.stringify({ room: roomId, message_id: messageId, emoji, username: user.username }),
      });
      const json = await resp.json().catch(() => null);
      console.log('[reactions][send] server response', resp.status, json);
    } catch (e) {
      console.warn('Failed to send reaction:', e);
    }
  };

  const handleRemoveReaction = async (messageId: number) => {
    if (!roomId || !user?.username) return;
    // Optimistic remove
    console.log('[reactions][remove] optimistic remove', { messageId, user: user.username });
    setMessages(prev => prev.map(m => (m.message_id === messageId ? { ...m, reactions: removeUserReactionLocal(m.reactions, user.username!) } : m)));
    try {
      console.log('[reactions][remove] POST /remove_reaction');
      const resp = await fetch(getApiUrl('/remove_reaction'), {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`,
        },
        body: JSON.stringify({ room: roomId, message_id: messageId, username: user.username }),
      });
      const json = await resp.json().catch(() => null);
      console.log('[reactions][remove] server response', resp.status, json);
    } catch (e) {
      console.warn('Failed to remove reaction:', e);
    }
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
            // Normalize cached messages to ensure consistent rendering (esp. files)
            baselineMessages = (parsed as any[]).map(normalizeMessage);
            setMessages(baselineMessages);
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
      const incoming = Array.isArray(payload)
        ? (payload as any[]).map(normalizeMessage)
        : [];

      // 4) Merge strategy: if we had a cursor, merge; else replace
      let nextMessages: Message[];
      if ((latestTs || maxId) && incoming.length > 0) {
        nextMessages = mergeAndSortMessages(sourceList, incoming);
      } else if (!sourceList.length && incoming.length >= 0) {
        nextMessages = mergeAndSortMessages([], incoming);
      } else if (baselineMessages.length > 0 && incoming.length === 0) {
        // We had cached items but server incremental returned nothing.
        // Do a full fetch without cursors to reconcile with possible DB reset.
        try {
          const fullUrl = `${API_BASE_URL}/messages/${roomId}`;
          const fullResp = await fetch(fullUrl, {
            method: 'GET',
            headers: {
              'Authorization': `Bearer ${token}`,
              'Content-Type': 'application/json',
            },
          });
          if (fullResp.ok) {
            const fullPayload = await fullResp.json();
            const fullList = Array.isArray(fullPayload) ? (fullPayload as any[]).map(normalizeMessage) : [];
            if (fullList.length === 0) {
              nextMessages = [];
              // Clear cache since backend has no data for this room now
              try { await AsyncStorage.removeItem(`messages_cache_${roomId}`); } catch {}
            } else {
              nextMessages = mergeAndSortMessages([], fullList);
            }
          } else {
            // Keep what we have if full fetch failed
            nextMessages = sourceList;
          }
        } catch {
          nextMessages = sourceList;
        }
      } else {
        // Nothing new — keep what we have
        nextMessages = sourceList;
      }

      // 5) Persist translations: merge any existing translated_text into nextMessages
      const priorList = baselineMessages.length ? baselineMessages : messages;
      const tMap = new Map<number, string>();
      for (const m of priorList) {
        if (m?.translated_text && typeof m.message_id === 'number') {
          tMap.set(m.message_id, m.translated_text);
        }
      }
      const mergedWithTranslations = nextMessages.map(m => (
        typeof m.message_id === 'number' && tMap.has(m.message_id)
          ? { ...m, translated_text: tMap.get(m.message_id)! }
          : m
      ));

      setMessages(mergedWithTranslations);
      try {
        await AsyncStorage.setItem(`messages_cache_${roomId}`, JSON.stringify(mergedWithTranslations));
        setServerWarning(null);
      } catch (e) {
        console.warn('Failed to cache messages:', e);
      }

    } catch (error) {
      console.error('Error loading messages:', error);
      // Fallback: show cached if available
      try {
        const cached = await AsyncStorage.getItem(`messages_cache_${roomId}`);
        if (cached) {
          const parsed = JSON.parse(cached);
          if (Array.isArray(parsed)) setMessages((parsed as any[]).map(normalizeMessage));
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
    // Build an index allowing replacement of local-echos by server-confirmed copies
    // Priority order when duplicates detected:
    // 1) Prefer message with a real server message_id (numeric) over client-only echo
    // 2) Prefer message with status 'delivered' over undefined
    const byKey = new Map<string, Message>();

    const makeKey = (m: Message): string => {
      if (m?.client_id) return `cid:${m.client_id}`;
      if (typeof m?.message_id === 'number') return `mid:${m.message_id}`;
      return `ts:${parseTimestampSafe(m?.timestamp)}`;
    };

    // Heuristic match: server-confirmed message likely equals a local echo
    const isLikelySame = (a: Message, b: Message): boolean => {
      try {
        if (!a || !b) return false;
        // Only dedupe for our own sent messages
        if (!user?.username) return false;
        if (a.sender !== user.username || b.sender !== user.username) return false;
        const aText = (a.content || a.message || '').trim();
        const bText = (b.content || b.message || '').trim();
        if (!aText || aText !== bText) return false;
        const aMs = parseTimestampSafe(a.timestamp);
        const bMs = parseTimestampSafe(b.timestamp);
        if (!isFinite(aMs) || !isFinite(bMs)) return false;
        const delta = Math.abs(aMs - bMs);
        // within 2 minutes is considered same
        if (delta > 120000) return false;
        // One should look like a local echo (client_id equals message_id or status 'sent')
        const aLooksLocal = a.status !== 'delivered' || (a.client_id && a.client_id === a.message_id);
        const bLooksLocal = b.status !== 'delivered' || (b.client_id && b.client_id === b.message_id);
        return aLooksLocal !== bLooksLocal;
      } catch { return false; }
    };

    const choose = (existing: Message | undefined, next: Message): Message => {
      if (!existing) return next;
      const existingHasServerId = typeof existing.message_id === 'number' && existing.client_id !== existing.message_id;
      const nextHasServerId = typeof next.message_id === 'number' && next.client_id !== next.message_id;
      if (nextHasServerId && !existingHasServerId) return next;
      if (!nextHasServerId && existingHasServerId) return existing;
      const existingDelivered = existing.status === 'delivered';
      const nextDelivered = next.status === 'delivered';
      if (nextDelivered && !existingDelivered) return next;
      // Otherwise, keep the newer by timestamp
      return parseTimestampSafe(next.timestamp) >= parseTimestampSafe(existing.timestamp) ? next : existing;
    };

    // Seed with previous list
    for (const m of prev) {
      byKey.set(makeKey(m), m);
    }
    // Merge incoming, replacing when same client_id or message_id; also collapse local echo using heuristic
    for (const m of incoming) {
      const key = makeKey(m);
      const picked = choose(byKey.get(key), m);
      byKey.set(key, picked);
      // Record mapping between client and server ids when both exist
      if (m.client_id && typeof m.message_id === 'number') {
        try {
          clientIdToServerIdRef.current.set(m.client_id, m.message_id);
          serverIdToClientIdRef.current.set(m.message_id, m.client_id);
        } catch {}
      }
      // Attempt to find and remove a matching local-echo from prev
      for (const [k, existing] of byKey.entries()) {
        if (k === key) continue;
        if (isLikelySame(existing, m)) {
          byKey.set(k, picked);
        }
      }
      // Also ensure we don't keep a duplicate under a different key when client_id and message_id both exist
      if (m.client_id && typeof m.message_id === 'number') {
        const altKey = `mid:${m.message_id}`;
        const prevAlt = byKey.get(altKey);
        const chosenAlt = choose(prevAlt, m);
        byKey.set(altKey, chosenAlt);
        // Remove the old cid entry if both point to different objects
        const cidKey = `cid:${m.client_id}`;
        const cidVal = byKey.get(cidKey);
        if (cidVal && cidVal !== chosenAlt) {
          byKey.set(cidKey, chosenAlt);
        }
      }
    }

    // Collapse to unique by message_id primarily to avoid duplicates with differing keys
    const byMessageId = new Map<number, Message>();
    for (const msg of byKey.values()) {
      if (typeof msg.message_id === 'number') {
        const existing = byMessageId.get(msg.message_id);
        byMessageId.set(msg.message_id, choose(existing, msg));
      }
    }

    let merged = Array.from(byKey.values());
    if (byMessageId.size > 0) {
      merged = Array.from(new Set(Array.from(byMessageId.values())));
    }
    merged.sort((a, b) => parseTimestampSafe(a.timestamp) - parseTimestampSafe(b.timestamp));
    return merged;
  };

  // Normalize raw messages from server/cache to our UI shape, especially for files
  const inferMimeFromName = (name?: string): string | undefined => {
    if (!name) return undefined;
    const lower = name.toLowerCase();
    if (/(\.jpg|\.jpeg|\.png|\.gif|\.webp|\.heic|\.heif)$/.test(lower)) return 'image/*';
    if (/(\.mp4|\.mov|\.m4v|\.webm)$/.test(lower)) return 'video/*';
    if (/(\.mp3|\.wav|\.m4a|\.aac|\.ogg)$/.test(lower)) return 'audio/*';
    if (/(\.pdf)$/.test(lower)) return 'application/pdf';
    if (/(\.docx?|\.rtf)$/.test(lower)) return 'application/msword';
    if (/(\.xlsx?)$/.test(lower)) return 'application/vnd.ms-excel';
    if (/(\.zip|\.rar|\.7z)$/.test(lower)) return 'application/zip';
    return undefined;
  };

  const coalesce = <T,>(...vals: T[]): T | undefined => vals.find(v => v !== undefined && v !== null) as any;

  const normalizeMessage = (raw: any): Message => {
    const iso = pickTimestampISO(raw);
    const msg: Message = {
      message_id: typeof raw?.message_id === 'number' ? raw.message_id : parseTimestampSafe(iso),
      sender: raw?.sender || raw?.from || 'unknown',
      content: raw?.content ?? raw?.message,
      message: raw?.message,
      timestamp: iso,
      type: raw?.type as any,
      status: raw?.status,
      room: raw?.room,
      client_id: raw?.client_id && Number(raw.client_id),
      reactions: normalizeReactions(raw?.reactions),
      message_class: raw?.message_class,
    };

    // File mapping: support multiple backend shapes
    const fileUrl = coalesce<string>(raw?.file_url, raw?.url, raw?.attachment_url, raw?.blob);
    const fileName = coalesce<string>(raw?.file_name, raw?.filename, raw?.name);
    const fileType = coalesce<string>(raw?.file_type, raw?.mime_type, raw?.mimetype) || inferMimeFromName(fileName);
    const fileSize = raw?.file_size ?? raw?.size;
    const fileId = coalesce<string>(raw?.file_id, raw?.id);

    const looksLikeFile = raw?.type === 'file' || !!fileUrl || !!fileId || !!fileName;
    if (looksLikeFile) {
      msg.type = 'file';
      msg.file_url = fileUrl;
      msg.file_name = fileName;
      msg.file_type = fileType;
      msg.file_size = typeof fileSize === 'string' ? parseInt(fileSize) : fileSize;
      msg.file_id = fileId;
    }
    // Fallback content for known event classes if backend omitted content
    if ((!msg.content || msg.content.length === 0) && msg.message_class) {
      if (msg.message_class === 'notification') {
        msg.type = 'text';
        msg.content = `${msg.sender || 'Someone'} sent you a notification!`;
      } else if (msg.message_class === 'color') {
        msg.type = 'text';
        // Try to format a helpful message based on available fields
        const color = (raw?.color || raw?.selected_color || raw?.new_color);
        const action = (raw?.action || '').toString().toLowerCase();
        if (action === 'reset' || color === null) {
          msg.content = `${msg.sender || 'Someone'} resets its bg color`;
        } else if (color) {
          msg.content = `${msg.sender || 'Someone'} changed your bg color`;
        } else {
          msg.content = `${msg.sender || 'Someone'} updated the color`;
        }
      }
    }

    // Reply mapping: support backend shapes raw.reply or flattened fields
    const r = raw?.reply;
    if (r && (r.message || r.sender || r.message_id)) {
      if (typeof r.message === 'string') msg.reply_content = r.message;
      if (typeof r.sender === 'string') msg.reply_sender = r.sender;
      if (r.message_id !== undefined) msg.reply_to_message_id = Number(r.message_id);
    } else {
      if (typeof raw?.reply_content === 'string') msg.reply_content = raw.reply_content;
      if (typeof raw?.reply_sender === 'string') msg.reply_sender = raw.reply_sender;
      if (raw?.reply_to_message_id !== undefined) msg.reply_to_message_id = Number(raw.reply_to_message_id);
    }

    return msg;
  };

  const sendMessage = async () => {
    // If editing, save edit instead of sending new
    if (editingMessageId) {
      const text = newMessage.trim();
      if (!text) return;
      await saveEdit(editingMessageId, text);
      return;
    }

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

      // Reply payload if present
      const replyPayload = replyContext
        ? { sender: replyContext.sender, message: replyContext.message, message_id: replyContext.message_id }
        : undefined;

      // Send message via socket
      socketRef.current.emit('send_chat_message', {
        room: roomId,
        message: messageToSend,
        from: user?.username || 'Anonymous',
        timestamp: isoTs,
        client_id: localTs,
        ...(replyPayload ? { reply: replyPayload } : {}),
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
      if (replyPayload) {
        localMsg.reply_sender = replyPayload.sender;
        localMsg.reply_content = replyPayload.message;
        localMsg.reply_to_message_id = Number(replyPayload.message_id);
      }
      setMessages(prev => [...prev, localMsg]);
      // Play message sound on send
      void messageSoundRef.current?.replayAsync().catch((e) => {
        console.warn('Failed to play message sound (send):', e);
      });
      setTimeout(() => flatListRef.current?.scrollToEnd({ animated: true }), 100);
      // Clear reply state after sending
      setReplyContext(null);
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

  // Clipboard-specific timestamp format: [MM/DD/YYYY, HH:MM:SS GMT+H[:MM]]
  // Examples:
  //   [08/25/2025, 17:20:10 GMT+8]
  //   [08/25/2025, 17:20:10 GMT+5:30]
  const formatClipboardTimestamp = (value: any) => {
    const ms = parseTimestampSafe(value);
    const dt = new Date(ms);
    const pad = (n: number) => (n < 10 ? `0${n}` : `${n}`);
    const MM = pad(dt.getMonth() + 1);
    const DD = pad(dt.getDate());
    const YYYY = dt.getFullYear();
    const HH = pad(dt.getHours());
    const mm = pad(dt.getMinutes());
    const ss = pad(dt.getSeconds());
    // getTimezoneOffset returns minutes behind UTC (e.g., -480 for UTC+8)
    const offsetMin = -dt.getTimezoneOffset();
    const sign = offsetMin >= 0 ? '+' : '-';
    const absMin = Math.abs(offsetMin);
    const hours = Math.floor(absMin / 60);
    const minutes = absMin % 60;
    const offsetStr = minutes === 0 ? `${hours}` : `${hours}:${pad(minutes)}`;
    // Use GMT+H or GMT+H:MM as per local timezone
    return `${MM}/${DD}/${YYYY}, ${HH}:${mm}:${ss} GMT${sign}${offsetStr}`;
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

          <View style={[styles.bubbleRow, isOutgoing ? styles.bubbleRowOutgoing : styles.bubbleRowIncoming]}>
            <TouchableOpacity
              activeOpacity={0.9}
              style={[styles.messageBubble, isOutgoing ? styles.myMessageBubble : styles.otherMessageBubble]}
              ref={(r) => {
                if (r) messageRefs.current.set(item.message_id, r);
              }}
              onPress={() => {
                if (item.type === 'text') toggleTranslateTarget(item.message_id);
              }}
              onLongPress={() => openContextMenu(item)}
              delayLongPress={250}
            >
              {item.reply_content && item.reply_sender ? (
                <View
                  style={{
                    marginBottom: 6,
                    padding: 8,
                    borderLeftWidth: 3,
                    borderLeftColor: '#7c3aed',
                    borderRadius: 6,
                    backgroundColor: isOutgoing ? 'rgba(255,255,255,0.08)' : 'rgba(255,255,255,0.12)'
                  }}
                >
                  <Text style={{ fontSize: 12, fontWeight: '700', color: '#a78bfa', marginBottom: 2 }} numberOfLines={1}>
                    {safeText(item.reply_sender)}
                  </Text>
                  <Text style={{ fontSize: 12, fontStyle: 'italic', color: '#e5e7eb' }} numberOfLines={2}>
                    {safeText(item.reply_content)}
                  </Text>
                </View>
              ) : null}
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
                <>
                  {item.translated_text ? (
                    showOriginalIds.has(item.message_id) ? (
                      <Text style={[styles.messageText, { color: '#e5e7eb' }]}>
                        {messageText}
                      </Text>
                    ) : null
                  ) : (
                    <Text style={[styles.messageText, { color: '#e5e7eb' }]}>
                      {messageText}
                    </Text>
                  )}
                  {item.translated_text ? (
                    <TouchableOpacity
                      style={[styles.translateButton, { alignSelf: isOutgoing ? 'flex-end' : 'flex-start', backgroundColor: isOutgoing ? '#6d28d9' : '#4338ca' }]}
                      onPress={() => toggleShowOriginal(item.message_id)}
                    >
                      <Text style={styles.translateButtonText}>
                        {showOriginalIds.has(item.message_id) ? 'Hide original' : 'Show original'}
                      </Text>
                    </TouchableOpacity>
                  ) : null}
                  {translateTargetId === item.message_id && !item.translated_text && !translatingMessageIds.has(item.message_id) ? (
                    <TouchableOpacity
                      style={[styles.translateButton, { alignSelf: isOutgoing ? 'flex-end' : 'flex-start', backgroundColor: isOutgoing ? '#6d28d9' : '#4338ca' }]}
                      onPress={() => performTranslation(item.message_id, messageText)}
                    >
                      <Text style={styles.translateButtonText}>Translate</Text>
                    </TouchableOpacity>
                  ) : null}
                  {translatingMessageIds.has(item.message_id) ? (
                    <Text style={[styles.translatingText, { color: isOutgoing ? '#d1d5db' : '#6b7280' }]}>Translating…</Text>
                  ) : item.translated_text ? (
                    <Text style={[styles.translatedText, { color: '#ffffff' }]}>
                      {item.translated_text}
                    </Text>
                  ) : null}
                </>
              )}

              {reactions.length > 0 && (
                <View style={[styles.reactionsContainer]}> 
                  {reactions.map(([emoji, users]) => {
                    const youReacted = user?.username ? (users as string[]).includes(user.username) : false;
                    return (
                      <TouchableOpacity
                        key={String(emoji)}
                        style={[styles.reactionBadge, youReacted ? { borderColor: '#a78bfa', borderWidth: 1 } : null]}
                        onPress={() => youReacted ? handleRemoveReaction(item.message_id) : undefined}
                        activeOpacity={0.7}
                      >
                        <Text>{emoji}</Text>
                        <Text style={styles.reactionCount}>{(users as string[]).length}</Text>
                      </TouchableOpacity>
                    );
                  })}
                </View>
              )}

              <Text style={styles.timestamp}>{formatTimestamp(item.timestamp)}</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.reactionButton}
              onPress={() => openReactionForMessage(item.message_id, isOutgoing)}
            >
              <Ionicons name="happy-outline" size={22} color="#888" />
            </TouchableOpacity>
          </View>


          {showTimestamps && (
            <Text style={[styles.timestamp, { color: '#ec4899', alignSelf: isOutgoing ? 'flex-end' : 'flex-start' }]}>
              {formatFullTimestamp(item.timestamp)}
            </Text>
          )}
        </View>
      </View>
    );
  };

  // Reply: from context menu tap
  const handleReply = () => {
    const msg = contextMenuMessage;
    closeContextMenu();
    if (!msg) return;
    const text = safeText(msg.content || msg.message || '');
    setReplyContext({ sender: safeText(msg.sender), message: text, message_id: Number(msg.message_id) });
    // Focus input and move caret to end
    setTimeout(() => {
      textInputRef.current?.focus();
    }, 0);
  };

  // Open mobile-friendly context menu
  const openContextMenu = (message: Message) => {
    setContextMenuMessage(message);
    setShowContextMenu(true);
  };

  const closeContextMenu = () => {
    setShowContextMenu(false);
    // small timeout to avoid immediate re-trigger
    setTimeout(() => setContextMenuMessage(null), 150);
  };
  // Perform translation for a given message id and original text
  const performTranslation = async (messageId: number, original: string) => {
    if (!original.trim()) {
      Alert.alert('Translate', 'Nothing to translate for this message.');
      return;
    }
    setTranslatingMessageIds(prev => new Set(prev).add(messageId));
    try {
      const res = await fetch(getApiUrl('/translate_message'), {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({ text: original }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      const translated = data?.translated_text || data?.translation || '';
      if (translated) {
        setMessages(prev => {
          const updated = prev.map(m => m.message_id === messageId ? { ...m, translated_text: translated } : m);
          // Persist to cache so translation survives reloads
          try {
            if (roomId) {
              void AsyncStorage.setItem(`messages_cache_${roomId}`, JSON.stringify(updated));
            }
          } catch {}
          return updated;
        });
        setTranslateTargetId(null);
      }
    } catch (e) {
      console.warn('Translate request failed:', e);
      Alert.alert('Translate failed', 'Could not translate this message.');
    } finally {
      setTranslatingMessageIds(prev => {
        const next = new Set(prev);
        next.delete(messageId);
        return next;
      });
    }
  };
  const handleEdit = () => {
    const msg = contextMenuMessage;
    if (!msg) return closeContextMenu();
    if (!user?.username) return closeContextMenu();
    if (msg.sender !== user.username) {
      Alert.alert('Not allowed', 'You can only edit your own messages.');
      closeContextMenu();
      return;
    }
    const original = safeText(msg.content || msg.message || '').replace(/\s*\(edited\)\s*$/, '');
    setEditingMessageId(msg.message_id || null);
    setEditingOriginalText(original);
    setNewMessage(original);
    closeContextMenu();
    setTimeout(() => textInputRef.current?.focus(), 50);
  };

  const cancelEdit = () => {
    setEditingMessageId(null);
    setEditingOriginalText('');
    setNewMessage('');
  };

  const saveEdit = async (messageId: number, text: string) => {
    try {
      // Optimistic UI
      setMessages(prev => prev.map(m => m.message_id === messageId ? { ...m, content: text + ' (edited)' } : m));
      // Clear edit state early for snappy UX
      setEditingMessageId(null);
      setEditingOriginalText('');
      setNewMessage('');

      try {
        await fetch(getApiUrl(`/edit_message/${messageId}`), {
          method: 'PUT',
          headers: {
            'Content-Type': 'application/json',
            ...(token ? { Authorization: `Bearer ${token}` } : {}),
          },
          body: JSON.stringify({ content: text }),
        });
      } catch (e) {
        console.warn('Edit request failed:', e);
      }
    } catch (e) {
      console.warn('saveEdit error:', e);
    }
  };
  const handleDelete = async () => {
    try {
      const msg = contextMenuMessage;
      closeContextMenu();
      if (!msg || !msg.message_id) return;
      if (!user?.username) return;
      if (msg.sender && msg.sender !== user.username) {
        Alert.alert('Not allowed', 'You can only delete your own messages.');
        return;
      }

      // Optimistic UI: remove locally
      setMessages(prev => prev.filter(m => m.message_id !== msg.message_id));
      if (selectedMessagePos?.id === msg.message_id) setSelectedMessagePos(null);

      try {
        await fetch(getApiUrl(`/delete_message/${msg.message_id}?username=${encodeURIComponent(user.username)}`), {
          method: 'DELETE',
          headers: {
            'Content-Type': 'application/json',
            ...(token ? { Authorization: `Bearer ${token}` } : {}),
          },
        });
      } catch (e) {
        console.warn('Delete request failed:', e);
      }
    } catch (err) {
      console.warn('Delete handler error:', err);
    }
  };
  const handleExportClipboard = async (withTimestamps: boolean) => {
    try {
      const msg = contextMenuMessage;
      closeContextMenu();
      if (!msg) return;

      const ts = withTimestamps ? `[${formatClipboardTimestamp(msg.timestamp)}] ` : '';
      const header = `${ts}${msg.sender}: `;

      let body = '';
      // Include reply context if present
      if (msg.reply_content) {
        const replySender = msg.reply_sender || 'Unknown';
        body += `↪ ${replySender}: ${msg.reply_content}\n`;
      }

      if (msg.type === 'text') {
        const text = (msg.content ?? msg.message ?? '').toString();
        // Strip trailing (edited) marker for clean copy
        body += text.replace(/\s*\(edited\)\s*$/, '');
      } else if (msg.type === 'file') {
        const name = msg.file_name || 'file';
        const url = msg.file_url || '';
        const size = typeof msg.file_size === 'number' ? ` (${msg.file_size} bytes)` : '';
        body += `Shared file: ${name}${size}${url ? `\n${url}` : ''}`;
      } else if (msg.type === 'audio') {
        body += 'Voice message';
      } else {
        // Fallback to any content
        body += (msg.content ?? msg.message ?? '').toString();
      }

      const toCopy = header + body;
      await Clipboard.setStringAsync(toCopy);
      Alert.alert('Copied', 'Message copied to clipboard');
    } catch (e) {
      console.warn('Clipboard export failed:', e);
      Alert.alert('Copy failed', 'Could not copy to clipboard.');
    }
  };
  const handleExportDesktop = async (withTimestamps: boolean) => {
    try {
      const msg = contextMenuMessage;
      closeContextMenu();
      if (!msg) return;

      const tsPrefix = withTimestamps ? `[${formatClipboardTimestamp(msg.timestamp)}] ` : '';
      const header = `${tsPrefix}${msg.sender}: `;

      let body = '';
      if (msg.reply_content) {
        const replySender = msg.reply_sender || 'Unknown';
        body += `↪ ${replySender}: ${msg.reply_content}\n`;
      }
      if (msg.type === 'text') {
        const text = (msg.content ?? msg.message ?? '').toString();
        body += text.replace(/\s*\(edited\)\s*$/, '');
      } else if (msg.type === 'file') {
        const name = msg.file_name || 'file';
        const url = msg.file_url || '';
        const size = typeof msg.file_size === 'number' ? ` (${msg.file_size} bytes)` : '';
        body += `Shared file: ${name}${size}${url ? `\n${url}` : ''}`;
      } else if (msg.type === 'audio') {
        body += 'Voice message';
      } else {
        body += (msg.content ?? msg.message ?? '').toString();
      }

      const content = header + body + "\n";

      // Build filename once
      const dt = new Date();
      const pad = (n: number) => (n < 10 ? `0${n}` : `${n}`);
      const stamp = `${dt.getFullYear()}${pad(dt.getMonth() + 1)}${pad(dt.getDate())}-${pad(dt.getHours())}${pad(dt.getMinutes())}${pad(dt.getSeconds())}`;
      const safeRoom = (roomId || 'chat').toString().replace(/[^a-zA-Z0-9_-]+/g, '_');
      const fileName = `message-${safeRoom}-${stamp}.txt`;

      let fileUri: string;
      if (Platform.OS === 'android') {
        // Save into user-picked folder via SAF, persist choice
        const dirUri = await ensureAndroidExportDir();
        if (!dirUri) {
          Alert.alert('Export cancelled', 'No folder selected.');
          return;
        }
        // Create file and write content
        const createdUri = await FileSystem.StorageAccessFramework.createFileAsync(
          dirUri,
          fileName,
          'text/plain'
        );
        await FileSystem.writeAsStringAsync(createdUri, content, { encoding: FileSystem.EncodingType.UTF8 });
        fileUri = createdUri;
      } else {
        // iOS/web: save to app documents dir
        const exportDir = `${FileSystem.documentDirectory}exports/`;
        try {
          await FileSystem.makeDirectoryAsync(exportDir, { intermediates: true });
        } catch {}
        fileUri = exportDir + fileName;
        await FileSystem.writeAsStringAsync(fileUri, content, { encoding: FileSystem.EncodingType.UTF8 });
      }

      // Build a friendly notification message
      const notifTitle = 'Downloaded to device';
      let notifBody = '';
      if (Platform.OS === 'android') {
        try {
          const dirUri = await AsyncStorage.getItem(EXPORT_DIR_KEY);
          if (dirUri) {
            const afterTree = dirUri.split('tree/')[1] || '';
            const afterColon = afterTree.split('%3A')[1] || afterTree;
            const folderName = decodeURIComponent(afterColon);
            notifBody = `Saved to "${folderName}" as ${fileName}`;
          }
        } catch {}
      }
      if (!notifBody) {
        notifBody = `Saved as ${fileName}`;
      }

      // Notify user with the friendly destination
      try {
        await Notifications.scheduleNotificationAsync({
          content: {
            title: notifTitle,
            body: notifBody,
          },
          trigger: null,
        });
      } catch (e) {
        // If notifications are not available, fall back to alert
        Alert.alert(notifTitle, notifBody);
      }
    } catch (e) {
      console.warn('Export to device failed:', e);
      Alert.alert('Export failed', 'Could not save the message to your device.');
    }
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

  // Adapter for CallScreen chat UI
  const callMessages = messages.map(m => ({
    id: String(m.message_id),
    text: (m.content ?? m.message ?? (m.type === 'file' ? (m.file_name || 'File') : '')) as string,
    timestamp: new Date(m.timestamp),
    isOwn: !!(user?.username && m.sender === user.username),
    senderName: m.sender || 'unknown',
    // Extend with media fields for in-call overlay
    type: (m.type === 'file' ? 'file' : 'text') as 'text' | 'file',
    file_url: m.file_url,
    file_id: m.file_id,
    file_name: m.file_name,
    file_type: m.file_type,
    file_size: m.file_size,
  }));

  const sendInCallMessage = async (text: string) => {
    try {
      const trimmed = (text || '').trim();
      if (!trimmed || !roomId || !token || !socketRef.current) return;
      const localTs = Date.now();
      const isoTs = new Date(localTs).toISOString();
      // Emit via existing chat channel
      socketRef.current.emit('send_chat_message', {
        room: roomId,
        message: trimmed,
        from: user?.username || 'Anonymous',
        timestamp: isoTs,
        client_id: localTs,
      });
      // Optimistic local echo
      const localMsg: Message = {
        message_id: localTs,
        sender: user?.username || 'system',
        content: trimmed,
        timestamp: isoTs,
        type: 'text',
        status: 'sent',
      };
      setMessages(prev => [...prev, localMsg]);
      // Play send sound and scroll
      void messageSoundRef.current?.replayAsync().catch(() => {});
      setTimeout(() => flatListRef.current?.scrollToEnd({ animated: true }), 80);
    } catch (e) {
      console.warn('sendInCallMessage failed:', e);
    }
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
          {__DEV__ && (
            <TouchableOpacity
              style={[styles.headerIconPill, { backgroundColor: '#f59e0b' }]}
              onPress={testNotification}
              accessibilityLabel="Test Notification"
            >
              <Ionicons name="notifications" size={18} color="#ffffff" />
            </TouchableOpacity>
          )}
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

        {/* Pending capture banner (avoids opening modal immediately after camera) */}
        {hasPendingCapture && pickedFile ? (
          <View style={{
            marginHorizontal: 12,
            marginBottom: 8,
            padding: 10,
            borderRadius: 8,
            backgroundColor: isDark ? '#1f2937' : '#e5e7eb',
            borderWidth: 1,
            borderColor: isDark ? '#374151' : '#d1d5db',
            flexDirection: 'row',
            alignItems: 'center',
            justifyContent: 'space-between',
          }}>
            <Text style={{ color: isDark ? '#e5e7eb' : '#111827', flex: 1 }} numberOfLines={1}>
              Captured: {pickedFile.name}
            </Text>
            <TouchableOpacity
              onPress={() => {
                if (!isMountedRef.current) return;
                setHasPendingCapture(false);
                setShowFilePreviewModal(true);
              }}
              style={{
                paddingHorizontal: 12,
                paddingVertical: 6,
                borderRadius: 6,
                backgroundColor: '#8b5cf6',
                marginLeft: 8,
              }}
            >
              <Text style={{ color: 'white', fontWeight: '600' }}>Review</Text>
            </TouchableOpacity>
          </View>
        ) : null}

        {/* In-app Camera Modal (expo-camera) */}
        {cameraVisible ? (
          <Modal visible transparent={false} animationType="slide" onRequestClose={() => setCameraVisible(false)}>
            <View style={{ flex: 1, backgroundColor: 'black' }}>
              <CameraView
                ref={(ref: CameraView | null) => { cameraRef.current = ref; }}
                style={{ flex: 1 }}
                facing={cameraFacing}
              />
              {/* Controls overlay */}
              <View style={{ position: 'absolute', bottom: 32, left: 0, right: 0, paddingHorizontal: 24 }}>
                <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
                  <TouchableOpacity
                    onPress={() => setCameraVisible(false)}
                    style={{ width: 48, height: 48, borderRadius: 24, backgroundColor: 'rgba(0,0,0,0.6)', alignItems: 'center', justifyContent: 'center' }}
                  >
                    <Ionicons name="close" color="#fff" size={24} />
                  </TouchableOpacity>
                  <TouchableOpacity
                    onPress={async () => {
                      try {
                        if (captureInProgressRef.current) return;
                        captureInProgressRef.current = true;
                        const cam = cameraRef.current as any;
                        if (!cam || !(cam as any).takePictureAsync) {
                          captureInProgressRef.current = false;
                          return;
                        }
                        const photo = await cam.takePictureAsync({ quality: 0.7, exif: false, skipProcessing: true, base64: false });
                        if (!photo?.uri) { captureInProgressRef.current = false; return; }
                        const uri: string = photo.uri;
                        const uriLast = uri.split('/').pop() || 'capture';
                        const ext = uriLast.split('?')[0].split('#')[0].split('.').pop()?.toLowerCase();
                        const name = `capture_${Date.now()}.${ext || 'jpg'}`;
                        const normExt = ext === 'heic' || ext === 'heif' ? 'jpeg' : (ext === 'jpg' ? 'jpeg' : ext);
                        const mime = `image/${normExt || 'jpeg'}`;
                        let size = 0;
                        try {
                          const info = await FileSystem.getInfoAsync(uri, { size: true });
                          if (info && typeof (info as any).size === 'number') size = (info as any).size as number;
                        } catch {}
                        const file = { uri, name, type: mime, size };
                        if (!isMountedRef.current) { captureInProgressRef.current = false; return; }
                        setCameraVisible(false);
                        setPickedFile(file);
                        setHasPendingCapture(true);
                        setIsPickedFromCamera(true);
                        captureInProgressRef.current = false;
                      } catch (err) {
                        console.warn('[InAppCamera] capture error:', err);
                        captureInProgressRef.current = false;
                      }
                    }}
                    style={{ width: 72, height: 72, borderRadius: 36, backgroundColor: '#ffffff', alignItems: 'center', justifyContent: 'center' }}
                  >
                    <View style={{ width: 60, height: 60, borderRadius: 30, backgroundColor: '#e5e7eb' }} />
                  </TouchableOpacity>
                  <TouchableOpacity
                    onPress={() => setCameraFacing((prev) => (prev === 'back' ? 'front' : 'back'))}
                    style={{ width: 48, height: 48, borderRadius: 24, backgroundColor: 'rgba(0,0,0,0.6)', alignItems: 'center', justifyContent: 'center' }}
                  >
                    <Ionicons name="camera-reverse-outline" color="#fff" size={24} />
                  </TouchableOpacity>
                </View>
              </View>
            </View>
          </Modal>
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

        {/* Reaction Picker Modal (anchored near tapped message) */}
        <Modal
          visible={selectedMessagePos !== null}
          transparent
          animationType="fade"
          onRequestClose={() => setSelectedMessagePos(null)}
        >
          <TouchableOpacity
            activeOpacity={1}
            style={styles.modalOverlay}
            onPress={() => setSelectedMessagePos(null)}
          >
            {selectedMessagePos ? (
              <TouchableOpacity
                activeOpacity={1}
                style={[
                  {
                    position: 'absolute',
                    left: 0,
                    right: 0,
                    // Place the bar exactly above the bubble using measured height
                    top: Math.max(
                      48,
                      Math.min(
                        selectedMessagePos.y - (reactionRowHeight || 120) - 8,
                        Dimensions.get('window').height - (reactionRowHeight || 120) - 48
                      )
                    ),
                    paddingHorizontal: 12,
                  },
                ]}
                onPress={() => { /* absorb presses inside content */ }}
              >
              <View style={[
                styles.emojiPickerContainer,
                {
                  margin: 0,
                  width: '100%',
                  maxWidth: undefined,
                  backgroundColor: isDark ? '#111827' : '#ffffff',
                }
              ]}
              onLayout={(e) => setReactionRowHeight(e.nativeEvent.layout.height)}
              >
              <View style={styles.emojiPickerHeader}>
                <Text style={{ fontWeight: '600', color: isDark ? '#f3f4f6' : '#111827' }}>React to message</Text>
                <TouchableOpacity onPress={() => setSelectedMessagePos(null)}>
                  <Ionicons name="close" size={18} color={isDark ? '#f3f4f6' : '#111827'} />
                </TouchableOpacity>
              </View>
              <View style={styles.emojiGrid}>
                {['👍','😂','❤️','🔥','🎉','👏','🙏','😮','😢','😡','🌟','✅'].map(e => (
                  <TouchableOpacity
                    key={e}
                    style={[styles.emojiItem, { backgroundColor: isDark ? '#1f2937' : '#f3f4f6' }]}
                    onPress={() => { if (selectedMessagePos?.id) handleSendReaction(selectedMessagePos.id, e); }}
                  >
                    <Text style={styles.emojiText}>{e}</Text>
                  </TouchableOpacity>
                ))}
              </View>
              </View>
              </TouchableOpacity>
            ) : null}
          </TouchableOpacity>
        </Modal>

        {/* Emoji Picker */}
        {/* Edit Banner */}
        {editingMessageId ? (
          <View style={[
            styles.editBanner,
            { backgroundColor: isDark ? '#78350f' : '#fde68a', borderColor: isDark ? '#f59e0b55' : '#f59e0b' }
          ]}>
            <Text style={[styles.editBannerText, { color: isDark ? '#fde68a' : '#92400e' }]}>Editing message:</Text>
            <Text style={[styles.editBannerText, { color: isDark ? '#fef3c7' : '#78350f', flex: 1 }]} numberOfLines={1}>
              {editingOriginalText}
            </Text>
            <TouchableOpacity onPress={cancelEdit} style={[styles.editCancelBtn, { backgroundColor: isDark ? '#374151' : '#d1d5db' }]}>
              <Text style={[styles.editCancelBtnText, { color: isDark ? '#e5e7eb' : '#1f2937' }]}>Cancel</Text>
            </TouchableOpacity>
          </View>
        ) : null}

        {/* Reply Preview (above input) */}
        {replyContext ? (
          <View style={[
            styles.replyPreview,
            { backgroundColor: isDark ? '#7c3aed20' : '#ddd6fe' }
          ]}>
            <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
              <View style={{ flex: 1, paddingRight: 8 }}>
                <Text style={[styles.replyAuthor, { color: isDark ? '#a78bfa' : '#7c3aed' }]}>
                  Replying to {safeText(replyContext.sender)}
                </Text>
                <Text
                  style={[styles.replyText, { color: isDark ? '#e5e7eb' : '#374151' }]}
                  numberOfLines={1}
                >
                  {safeText(replyContext.message)}
                </Text>
              </View>
              <TouchableOpacity
                onPress={() => setReplyContext(null)}
                style={{ paddingHorizontal: 10, paddingVertical: 6, borderRadius: 8, backgroundColor: isDark ? '#374151' : '#d1d5db' }}
              >
                <Text style={{ color: isDark ? '#e5e7eb' : '#1f2937', fontWeight: '600' }}>Cancel</Text>
              </TouchableOpacity>
            </View>
          </View>
        ) : null}

        {/* Input Area */}
        <View onLayout={(e) => setInputContainerHeight(e.nativeEvent.layout.height)} style={[
          styles.inputContainer, 
          {
            backgroundColor: isDark ? '#1f2937' : '#ffffff',
            paddingBottom: 12
          }
        ]}>
          {newMessage.trim().length === 0 ? (
            <>
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
            </>
          ) : (
            <TouchableOpacity
              style={[
                styles.clearInputButton,
                { backgroundColor: isDark ? '#374151' : '#d1d5db' }
              ]}
              onPress={() => {
                setNewMessage('');
                // also clear typing indicator immediately
                if (socketRef.current && roomId && user) {
                  try {
                    socketRef.current.emit('live_typing', {
                      room: roomId,
                      from: user.username,
                      text: ''
                    });
                  } catch {}
                }
              }}
            >
              <Text style={{ marginLeft: 6, color: isDark ? '#e5e7eb' : '#374151', fontWeight: '600' }}>Clear Input</Text>
            </TouchableOpacity>
          )}
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
            ref={textInputRef}
            value={newMessage}
            onChangeText={handleTextChange}
            // Do not send on Enter/newline; allow newline insertion instead
            returnKeyType="default"
            enablesReturnKeyAutomatically
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
              <Text style={{ color: '#ffffff', fontWeight: '700' }}>{editingMessageId ? 'Save' : 'Send'}</Text>
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
                style={[styles.actionButton, { backgroundColor: '#f59e0b' }]}
                onPress={async () => {
                  try {
                    if (captureInProgressRef.current) return;
                    setUploadError(null);
                    if (showActions) setShowActions(false);
                    // Request in-app camera permission
                    if (!cameraPerm?.granted) {
                      const res = await requestCameraPerm();
                      if (!res?.granted) {
                        Alert.alert('Permission required', 'Camera permission is needed to take a photo.');
                        return;
                      }
                    }
                    setCameraVisible(true);
                  } catch (e) {
                    Alert.alert('Error', 'Failed to open camera');
                    console.warn('[InAppCamera] error:', e);
                  }
                }}
              >
                <Ionicons name="camera" size={16} color="white" />
                <Text style={styles.actionButtonText}>Camera</Text>
              </TouchableOpacity>
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
                      <View style={{ width: '100%', height: 220, borderRadius: 8, position: 'relative' }}>
                        {uri.startsWith('file://') ? (
                          // Prefer RN Image for local file:// URIs (more reliable on Android)
                          <Image
                            source={{ uri }}
                            style={{ width: '100%', height: '100%', borderRadius: 8, backgroundColor: '#111827' }}
                            onLoadStart={() => {
                              setPickedImageError(null);
                              setIsPreviewLoading(true);
                              console.log('[Preview][image-rn] load start');
                            }}
                            onLoad={() => {
                              setIsPreviewLoading(false);
                              console.log('[Preview][image-rn] load success');
                            }}
                            onLoadEnd={() => setIsPreviewLoading(false)}
                            onError={() => {
                              setIsPreviewLoading(false);
                              console.warn('[Preview][image-rn] load error');
                              setPickedImageError('rn-image load error');
                            }}
                            resizeMode="cover"
                          />
                        ) : (
                          // Use ExpoImage for http(s) where decoding/caching is beneficial
                          <ExpoImage
                            source={{ uri }}
                            style={{ width: '100%', height: '100%', borderRadius: 8, backgroundColor: '#111827' }}
                            contentFit="cover"
                            onLoadStart={() => {
                              setPickedImageError(null);
                              setIsPreviewLoading(true);
                              console.log('[Preview][image-expo] load start');
                            }}
                            onLoad={() => {
                              setIsPreviewLoading(false);
                              console.log('[Preview][image-expo] load success');
                            }}
                            onError={() => {
                              setIsPreviewLoading(false);
                              console.warn('[Preview][image-expo] load error');
                              setPickedImageError('expo-image load error');
                            }}
                          />
                        )}
                        {isPreviewLoading && (
                          <View style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, alignItems: 'center', justifyContent: 'center' }}>
                            <ActivityIndicator size="large" color="#10b981" />
                            <Text style={{ marginTop: 6, color: isDark ? '#e5e7eb' : '#374151' }}>Loading preview...</Text>
                          </View>
                        )}
                      </View>
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
                      if (isPickedFromCamera) {
                        // Retake: open in-app camera instead of document picker
                        if (!cameraPerm?.granted) {
                          const res = await requestCameraPerm();
                          if (!res?.granted) return;
                        }
                        setCameraVisible(true);
                      } else {
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
                        setIsPickedFromCamera(false);
                      }
                    } catch (e) {
                      Alert.alert('Error', 'Failed to open picker');
                    }
                  }}
                >
                  <Text style={styles.modalCloseButtonText}>{isPickedFromCamera ? 'Retake' : 'Change File'}</Text>
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
            roomId={roomId as string}
            peerChatBgColor={chatBgColor}
            onResetBgColor={resetBgColor}
            onApplyBgColor={applySelectedColor}
            onSendMessage={sendInCallMessage}
            messages={callMessages as any}
            onOpenFilePicker={openQuickFilePicker}
            onOpenCamera={async () => {
              try {
                if (!cameraPerm?.granted) {
                  const perm = await requestCameraPerm();
                  if (!perm.granted) return;
                }
                setCameraVisible(true);
              } catch {}
            }}
            onRingDoorbell={sendNotification}
            onOpenChangeColor={() => setShowColorPicker((v) => !v)}
            onToggleTimestamps={() => setShowTimestamps((v) => !v)}
            showTimestamps={showTimestamps}
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
      {/* Context Menu Bottom Sheet */}
      <Modal
        visible={showContextMenu}
        transparent
        animationType="fade"
        onRequestClose={closeContextMenu}
      >
        <TouchableOpacity
          activeOpacity={1}
          style={styles.contextOverlay}
          onPress={closeContextMenu}
        >
          <View style={styles.contextSheet}>
            <View style={styles.contextHandle} />
            <TouchableOpacity style={styles.contextItem} onPress={handleReply}>
              <Text style={styles.contextItemText}>Reply</Text>
            </TouchableOpacity>
            {contextMenuMessage && user?.username && contextMenuMessage.sender === user.username ? (
              <>
                <TouchableOpacity style={styles.contextItem} onPress={handleEdit}>
                  <Text style={styles.contextItemText}>Edit</Text>
                </TouchableOpacity>
                <TouchableOpacity style={[styles.contextItem]} onPress={handleDelete}>
                  <Text style={[styles.contextItemText, styles.contextDanger]}>Delete</Text>
                </TouchableOpacity>
              </>
            ) : null}
            <TouchableOpacity style={styles.contextItem} onPress={() => handleExportClipboard(true)}>
              <Text style={styles.contextItemText}>Export to Clipboard (TS on)</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.contextItem} onPress={() => handleExportClipboard(false)}>
              <Text style={styles.contextItemText}>Export to Clipboard (TS off)</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.contextItem} onPress={() => handleExportDesktop(true)}>
              <Text style={styles.contextItemText}>Export to Device (TS on)</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.contextItem} onPress={() => handleExportDesktop(false)}>
              <Text style={styles.contextItemText}>Export to Device (TS off)</Text>
            </TouchableOpacity>
          </View>
        </TouchableOpacity>
      </Modal>
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
  translateButton: {
    marginTop: 6,
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 12,
  },
  translateButtonText: {
    color: '#ffffff',
    fontSize: 12,
    fontWeight: '600',
  },
  translatingText: {
    fontSize: 12,
    marginTop: 6,
    fontStyle: 'italic',
  },
  translatedText: {
    fontSize: 13,
    marginTop: 6,
    opacity: 0.9,
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
    alignItems: 'center',
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
  // Row that contains the bubble and its reaction button
  bubbleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  bubbleRowOutgoing: {
    flexDirection: 'row-reverse',
  },
  bubbleRowIncoming: {
    flexDirection: 'row',
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
    width: 28,
    height: 28,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
    marginHorizontal: 6,
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
    alignItems: 'center',
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
  clearInputButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 10,
    height: 36,
    borderRadius: 18,
    marginRight: 8,
    gap: 4,
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'transparent',
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
    paddingHorizontal: 14,
    height: 40,
    minWidth: 64,
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
    marginLeft: 6,
  },
  contextOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.25)',
    justifyContent: 'flex-end',
  },
  contextSheet: {
    backgroundColor: '#1f2937',
    paddingTop: 8,
    paddingBottom: 12,
    borderTopLeftRadius: 16,
    borderTopRightRadius: 16,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: '#374151',
  },
  contextHandle: {
    alignSelf: 'center',
    width: 40,
    height: 4,
    borderRadius: 2,
    backgroundColor: '#6b7280',
    marginBottom: 8,
  },
  contextItem: {
    paddingVertical: 12,
    paddingHorizontal: 20,
  },
  contextItemText: {
    color: '#e5e7eb',
    fontSize: 16,
  },
  contextDanger: {
    color: '#f87171',
    fontWeight: '700',
  },
  // Edit banner styles
  editBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginHorizontal: 12,
    marginBottom: 6,
    paddingHorizontal: 10,
    paddingVertical: 8,
    borderLeftWidth: 4,
    borderRadius: 8,
  },
  editBannerText: {
    fontSize: 12,
    fontWeight: '600',
  },
  editCancelBtn: {
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 6,
    marginLeft: 8,
  },
  editCancelBtnText: {
    fontSize: 12,
    fontWeight: '700',
  },
});
