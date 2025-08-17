import { CallScreen } from '@/components/CallScreen';
import { CallSetupModal } from '@/components/CallSetupModal';
import { IncomingCallModal } from '@/components/IncomingCallModal';
import { ThemedText } from '@/components/ThemedText';
import { ThemedView } from '@/components/ThemedView';
import { useAuth } from '@/contexts/AuthContext';
import { useTheme } from '@/contexts/ThemeContext';
import { useColorScheme } from '@/hooks/useColorScheme';
import { CallDevice, WebRTCService } from '@/services/WebRTCService';
import { Ionicons } from '@expo/vector-icons';
import { useLocalSearchParams, useRouter } from 'expo-router';
import React, { useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  FlatList,
  KeyboardAvoidingView,
  Modal,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { MediaStream } from 'react-native-webrtc';
import io, { Socket } from 'socket.io-client';
import { ENV, getApiUrl, getSocketUrl } from '../../config/env';
import ColorPicker, { Panel1, BrightnessSlider, HueSlider } from 'reanimated-color-picker';
import { runOnJS } from 'react-native-reanimated';

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
  reactions?: { [key: string]: string[] };
  status?: string;
  room?: string;
}

export default function ChatScreen() {
  const { roomId } = useLocalSearchParams<{ roomId: string }>();
  const router = useRouter();
  const colorScheme = useColorScheme();
  const { theme } = useTheme();
  const { token, user } = useAuth();
  const insets = useSafeAreaInsets();
  
  const [messages, setMessages] = useState<Message[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [newMessage, setNewMessage] = useState('');
  const [isSending, setIsSending] = useState(false);
  const [typingUsers, setTypingUsers] = useState<{[key: string]: string}>({});
  const typingTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const [showActions, setShowActions] = useState(false);
  const [showTimestamps, setShowTimestamps] = useState(false);
  const [showFileMigrationModal, setShowFileMigrationModal] = useState(false);
  const [isRecording, setIsRecording] = useState(false);
  const [showEmojiPicker, setShowEmojiPicker] = useState(false);
  const [showColorPicker, setShowColorPicker] = useState(false);
  const [selectedColor, setSelectedColor] = useState<string | null>(null);
  const [chatBgColor, setChatBgColor] = useState<string | null>(null);
  const [showWheel, setShowWheel] = useState(false);
  // RGB input states for manual editing
  const [rgbR, setRgbR] = useState<string>('');
  const [rgbG, setRgbG] = useState<string>('');
  const [rgbB, setRgbB] = useState<string>('');
  
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
  
  // Call-related state
  const [showCallSetup, setShowCallSetup] = useState(false);
  const [showIncomingCall, setShowIncomingCall] = useState(false);
  const [showCallScreen, setShowCallScreen] = useState(false);
  const [callType, setCallType] = useState<'audio' | 'video'>('audio');
  const [incomingCallType, setIncomingCallType] = useState<'audio' | 'video'>('audio');
  const [incomingCaller, setIncomingCaller] = useState('');
  const [localStream, setLocalStream] = useState<MediaStream | null>(null);
  const [remoteStream, setRemoteStream] = useState<MediaStream | null>(null);
  const [isCallConnected, setIsCallConnected] = useState(false);
  const [isAudioMuted, setIsAudioMuted] = useState(false);
  const [isVideoMuted, setIsVideoMuted] = useState(false);
  const [callDuration, setCallDuration] = useState('00:00');
  
  const flatListRef = useRef<FlatList>(null);
  const socketRef = useRef<Socket | null>(null);
  const webRTCServiceRef = useRef<WebRTCService | null>(null);
  const callTimerRef = useRef<NodeJS.Timeout | null>(null);
  const pendingOfferRef = useRef<any>(null);

  // Helper function to safely render text
  const safeText = (text: any): string => {
    if (text === null || text === undefined) return '';
    if (typeof text === 'string') return text.trim();
    if (typeof text === 'number') return String(text);
    return String(text).trim();
  };

  // Color actions
  const applySelectedColor = () => {
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
      const localMsg: Message = {
        message_id: ts,
        sender: user.username,
        content: msgText,
        timestamp: new Date(ts).toISOString(),
        type: 'text',
        message_class: 'color',
        status: 'sent',
      };
      setMessages(prev => [...prev, localMsg]);
      setShowColorPicker(false);
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
      const localMsg: Message = {
        message_id: ts,
        sender: user.username,
        content: msgText,
        timestamp: new Date(ts).toISOString(),
        type: 'text',
        message_class: 'color',
        status: 'sent',
      };
      setMessages(prev => [...prev, localMsg]);
      setShowColorPicker(false);
      setTimeout(() => flatListRef.current?.scrollToEnd({ animated: true }), 100);
    } catch (e) {
      console.error('Error resetting color:', e);
    }
  };
  // Safe timestamp parser that accepts number or ISO string
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

  // Send a doorbell/notification and log locally
  const sendNotification = () => {
    if (!roomId || !user?.username || !socketRef.current) return;
    const ts = Date.now();
    try {
      socketRef.current.emit('send_notification', { room: roomId, from: user.username, timestamp: ts });
      // Add local echo: "You sent a notification"
      const localMsg: Message = {
        message_id: ts,
        sender: user.username,
        content: 'You sent a notification',
        timestamp: new Date(ts).toISOString(),
        type: 'text',
        message_class: 'notification',
        status: 'sent',
      };
      setMessages(prev => [...prev, localMsg]);
      setTimeout(() => flatListRef.current?.scrollToEnd({ animated: true }), 100);
    } catch (error) {
      console.error('Error sending notification:', error);
    }
  };
  const isDark = theme === 'dark';

  // Extract contact name from roomId (format: "user1-user2")
  const contactName = roomId?.split('-').find(name => name !== user?.username) || 'Unknown';
  const contactInitial = (contactName?.trim()[0] || 'U').toUpperCase();

  useEffect(() => {
    if (roomId && token) {
      loadRoomMessages();
      initializeSocket();
    }
    
    return () => {
      if (socketRef.current) {
        socketRef.current.disconnect();
      }
    };
  }, [roomId, token]);

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
      console.log('Received chat message:', data);
      handleIncomingMessage(data);
    });

    // Listen for incoming notifications
    socket.on('receive_notification', (data: any) => {
      try {
        const ts = parseTimestampSafe(data?.timestamp);
        const msgText = `${data?.from || 'Someone'} sent you a notification!`;
        const newMsg: Message = {
          message_id: ts,
          sender: data?.from || 'system',
          content: msgText,
          timestamp: new Date(ts).toISOString(),
          type: 'text',
          message_class: 'notification',
          status: 'delivered',
        };
        setMessages(prev => [...prev, newMsg]);
        setTimeout(() => flatListRef.current?.scrollToEnd({ animated: true }), 100);
      } catch (e) {
        console.error('Error handling receive_notification:', e);
      }
    });

    socket.on('message_delivered', (data: any) => {
      console.log('Message delivered:', data);
      updateMessageStatus(data.message_id, 'delivered');
    });

    // Listen for live typing events
    socket.on('live_typing', (data: any) => {
      console.log('Live typing:', data);
      handleTypingIndicator(data);
    });

    // Listen for WebRTC signals
    socket.on('signal', async (data: any) => {
      console.log('Received WebRTC signal:', data);
      
      const { signal, from } = data;

      try {
        switch (signal.type) {
          case 'offer':
            console.log('Received offer from', from, 'signal:', signal);
            pendingOfferRef.current = new RTCSessionDescription({
              type: signal.type,
              sdp: signal.sdp
            });
            await handleIncomingCall({ from, signal });
            break;

          case 'answer':
            if (webRTCServiceRef.current) {
              await webRTCServiceRef.current.handleAnswer(signal);
            }
            break;

          case 'ice-candidate':
          default:
            // Handle ICE candidates only if WebRTC is already initialized
            if (webRTCServiceRef.current && signal.candidate) {
              await webRTCServiceRef.current.addIceCandidate(signal);
            } else if (signal.candidate) {
              console.log('Ignoring ICE candidate - WebRTC not initialized yet');
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
    });
  };

  const handleIncomingMessage = (data: any) => {
    const newMessage: Message = {
      message_id: data.message_id,
      sender: data.from,
      content: data.message,
      timestamp: data.timestamp,
      type: 'text',
      reply_content: data.reply_content,
      reply_sender: data.reply_sender,
      reply_to_message_id: data.reply_to_message_id,
      status: data.status || 'sent',
      reactions: {}
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

  // Call handling functions
  const initializeWebRTC = async () => {
    try {
      console.log('Chat: Initializing WebRTC with backend ICE servers');
      const { initializeWebRTC: initWebRTC } = await import('../../config/env');
      const webRTCService = await initWebRTC();
      webRTCServiceRef.current = webRTCService;
      console.log('Chat: WebRTC initialized successfully');
    } catch (error) {
      console.error('Chat: Failed to initialize WebRTC:', error);
      throw error;
    }

    // Set up event handlers
    webRTCServiceRef.current.onLocalStream = (stream: MediaStream) => {
      setLocalStream(stream);
    };

    webRTCServiceRef.current.onRemoteStream = (stream: MediaStream) => {
      setRemoteStream(stream);
    };

    webRTCServiceRef.current.onCallStateChange = (state: string) => {
      switch (state) {
        case 'connected':
          setIsCallConnected(true);
          startCallTimer();
          break;
        case 'disconnected':
        case 'failed':
          handleCallEnd();
          break;
      }
    };

    webRTCServiceRef.current.onIceCandidate = (candidate: any) => {
      if (socketRef.current && roomId) {
        socketRef.current.emit('signal', {
          room: roomId,
          signal: candidate,
          from: user?.username
        });
      }
    };

    webRTCServiceRef.current.onCallEnd = () => {
      handleCallEnd();
    };
  };

  const startCallTimer = () => {
    if (callTimerRef.current) {
      clearInterval(callTimerRef.current);
    }

    callTimerRef.current = setInterval(() => {
      if (webRTCServiceRef.current) {
        setCallDuration(webRTCServiceRef.current.getCallDuration());
      }
    }, 1000) as unknown as NodeJS.Timeout;
  };

  const stopCallTimer = () => {
    if (callTimerRef.current) {
      clearInterval(callTimerRef.current);
      callTimerRef.current = null;
    }
    setCallDuration('00:00');
  };

  const handleStartCall = async (type: 'audio' | 'video') => {
    try {
      // Check permissions before showing call setup modal
      const { requestCallPermissions } = await import('../../utils/permissions');
      const permissionResult = await requestCallPermissions(type === 'video');
      
      if (!permissionResult.granted) {
        Alert.alert(
          'Permission Required', 
          permissionResult.message || 'Camera and microphone permissions are required for calls.',
          [
            { text: 'Cancel', style: 'cancel' },
            { text: 'Settings', onPress: () => {
              // Open device settings for permissions
              import('react-native').then(({ Linking }) => {
                Linking.openSettings();
              });
            }}
          ]
        );
        return;
      }

      if (!webRTCServiceRef.current) {
        await initializeWebRTC();
      }
      setCallType(type);
      setShowCallSetup(true);
    } catch (error) {
      console.error('Error checking call permissions:', error);
      Alert.alert('Error', 'Unable to check permissions. Please try again.');
    }
  };

  const handleCallSetupStart = async (selectedDevices: CallDevice) => {
    try {
      if (!webRTCServiceRef.current) return;

      setShowCallSetup(false);
      setShowCallScreen(true);

      // Initialize call with selected devices
      await webRTCServiceRef.current.initializeCall(callType, selectedDevices);

      // Create and send offer
      const offer = await webRTCServiceRef.current.createOffer();
      
      if (socketRef.current && roomId) {
        socketRef.current.emit('signal', {
          room: roomId,
          signal: { type: 'offer', sdp: offer.sdp, callType },
          from: user?.username
        });
      }

    } catch (error) {
      console.error('Error starting call:', error);
      Alert.alert('Error', 'Failed to start call. Please try again.');
      handleCallEnd();
    }
  };

  const handleIncomingCall = async (data: any) => {
    console.log('Handling incoming call:', data);
    setIncomingCaller(data.from);
    
    // Detect call type from SDP if not explicitly provided
    let detectedCallType: 'audio' | 'video' = 'audio';
    if (data.signal.callType) {
      detectedCallType = data.signal.callType;
    } else if (data.signal.sdp) {
      // Check if SDP contains video media
      const hasVideo = data.signal.sdp.includes('m=video');
      detectedCallType = hasVideo ? 'video' : 'audio';
      console.log('Detected call type from SDP:', detectedCallType, 'hasVideo:', hasVideo);
    }
    
    setIncomingCallType(detectedCallType);
    setCallType(detectedCallType); // Also set the main call type
    
    // Initialize WebRTC service immediately to be ready for ICE candidates
    try {
      if (!webRTCServiceRef.current) {
        await initializeWebRTC();
      }
      
      // Initialize the call to create peer connection
      if (webRTCServiceRef.current) {
        await webRTCServiceRef.current.initializeCall(detectedCallType);
      }
      console.log('WebRTC initialized for incoming call');
    } catch (error) {
      console.error('Error initializing WebRTC for incoming call:', error);
    }
    
    setShowIncomingCall(true);
  };

  const handleAcceptCall = async () => {
    try {
      // WebRTC should already be initialized from handleIncomingCall
      if (!webRTCServiceRef.current) {
        console.warn('WebRTC not initialized, initializing now...');
        await initializeWebRTC();
      }
      
      // Ensure WebRTC is initialized before proceeding
      if (webRTCServiceRef.current) {
        await webRTCServiceRef.current.initializeCall(incomingCallType);
      } else {
        throw new Error('Failed to initialize WebRTC service');
      }

      setShowIncomingCall(false);
      setShowCallScreen(true);

      // Handle the pending offer
      if (pendingOfferRef.current && webRTCServiceRef.current) {
        console.log('Processing pending offer:', pendingOfferRef.current);
        const answer = await webRTCServiceRef.current.createAnswer(pendingOfferRef.current);
        
        if (socketRef.current && roomId) {
          socketRef.current.emit('signal', {
            room: roomId,
            signal: { type: 'answer', sdp: answer.sdp },
            from: user?.username
          });
          console.log('Answer sent to remote peer');
        }
        
        // Clear the pending offer
        pendingOfferRef.current = null;
      }
    } catch (error) {
      console.error('Error accepting call:', error);
      Alert.alert('Error', 'Failed to accept call. Please try again.');
      handleCallEnd();
    }
  };

  const handleDeclineCall = () => {
    setShowIncomingCall(false);
    
    if (socketRef.current && roomId) {
      socketRef.current.emit('signal', {
        room: roomId,
        signal: { type: 'call-declined' },
        from: user?.username
      });
    }
  };

  const handleCallEnd = () => {
    webRTCServiceRef.current?.endCall();
    
    setShowCallScreen(false);
    setShowCallSetup(false);
    setShowIncomingCall(false);
    setLocalStream(null);
    setRemoteStream(null);
    setIsCallConnected(false);
    setIsAudioMuted(false);
    setIsVideoMuted(false);
    stopCallTimer();

    if (socketRef.current && roomId) {
      socketRef.current.emit('signal', {
        room: roomId,
        signal: { type: 'call-ended' },
        from: user?.username
      });
    }
  };

  const handleToggleMute = () => {
    if (webRTCServiceRef.current) {
      const muted = webRTCServiceRef.current.toggleMute();
      setIsAudioMuted(muted);
    }
  };

  const handleToggleVideo = () => {
    if (webRTCServiceRef.current) {
      const videoOff = webRTCServiceRef.current.toggleVideo();
      setIsVideoMuted(videoOff);
    }
  };

  const handleSwitchCamera = async () => {
    try {
      await webRTCServiceRef.current?.switchCamera();
    } catch (error) {
      console.error('Error switching camera:', error);
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
      
      const response = await fetch(`${API_BASE_URL}/messages/${roomId}`, {
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
      });

      if (!response.ok) {
        throw new Error('Failed to fetch messages');
      }

      const messagesData = await response.json();
      console.log('Fetched messages:', messagesData);
      
      setMessages(messagesData);
      
      // Scroll to bottom after loading messages
      setTimeout(() => {
        flatListRef.current?.scrollToEnd({ animated: true });
      }, 100);
      
    } catch (error) {
      console.error('Error loading messages:', error);
      Alert.alert('Error', 'Failed to load messages');
    } finally {
      setIsLoading(false);
    }
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
      
      // Send empty typing indicator to stop showing typing
      socketRef.current.emit('live_typing', {
        room: roomId,
        from: user?.username,
        text: ''
      });
      
      // Send message via WebSocket
      socketRef.current.emit('send_chat_message', {
        room: roomId,
        message: messageToSend,
        from: user?.username
      });
      
      console.log('Message sent via WebSocket');
      
    } catch (error) {
      console.error('Error sending message:', error);
      Alert.alert('Error', 'Failed to send message');
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

  const renderMessage = ({ item }: { item: Message }) => {
    const isOutgoing = item.sender === user?.username;
    const messageText = safeText(item.content || item.message || '');
    const senderName = safeText(item.sender);
    
    return (
      <View style={[
        styles.messageContainer,
        isOutgoing ? styles.outgoingMessage : styles.incomingMessage
      ]}>
        {!isOutgoing && (
          <Text style={[styles.senderName, { color: isDark ? '#9ca3af' : '#6b7280' }]}>
            {senderName}
          </Text>
        )}
        
        {/* Reply preview */}
        {item.reply_content && item.reply_sender && (
          <View style={[
            styles.replyPreview,
            { backgroundColor: isDark ? '#7c3aed20' : '#ddd6fe' }
          ]}>
            <Text style={[styles.replyAuthor, { color: isDark ? '#a78bfa' : '#7c3aed' }]}>
              {safeText(item.reply_sender)}
            </Text>
            <Text style={[styles.replyText, { color: isDark ? '#e5e7eb' : '#374151' }]} numberOfLines={1}>
              {safeText(item.reply_content)}
            </Text>
          </View>
        )}
        
        {item.type === 'audio' ? (
          <View style={[
            styles.messageBubble,
            {
              backgroundColor: isOutgoing 
                ? '#420796' 
                : '#3944bc'
            }
          ]}>
            <View style={styles.audioMessage}>
              <Ionicons 
                name="musical-notes" 
                size={20} 
                color="#e5e7eb" 
              />
              <Text style={[
                styles.audioText,
                { color: '#e5e7eb' }
              ]}>
                Audio message
              </Text>
            </View>
          </View>
        ) : item.file_url ? (
          <View style={[
            styles.messageBubble,
            {
              backgroundColor: isOutgoing 
                ? '#420796' 
                : '#3944bc'
            }
          ]}>
            <View style={styles.fileMessage}>
              <Ionicons 
                name="document" 
                size={20} 
                color="#e5e7eb" 
              />
              <Text style={[
                styles.fileText,
                { color: '#e5e7eb' }
              ]}>
                {safeText(item.file_name) || 'File'}
              </Text>
            </View>
          </View>
        ) : (
          <View style={[
            styles.messageBubble,
            {
              backgroundColor: isOutgoing 
                ? '#420796' 
                : '#3944bc'
            }
          ]}>
            <Text style={[
              styles.messageText,
              { color: '#e5e7eb' }
            ]}>
              {messageText}
            </Text>
          </View>
        )}
        
        <Text style={[
          styles.timestamp,
          { 
            color: isDark ? '#6b7280' : '#9ca3af',
            alignSelf: isOutgoing ? 'flex-end' : 'flex-start'
          }
        ]}>
          {formatTimestamp(item.timestamp)}
        </Text>
      </View>
    );
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

      {/* Main Content with Keyboard Avoidance */}
      <KeyboardAvoidingView 
        style={styles.chatContainer}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        keyboardVerticalOffset={Platform.OS === 'ios' ? 88 : 0}
      >
        {/* Messages List */}
        <FlatList
          ref={flatListRef}
          data={messages}
          renderItem={renderMessage}
          keyExtractor={(item) => item.message_id.toString()}
          style={[styles.messagesList, chatBgColor ? { backgroundColor: chatBgColor } : null]}
          contentContainerStyle={styles.messagesContent}
          onContentSizeChange={() => flatListRef.current?.scrollToEnd({ animated: true })}
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
        <Modal
          visible={showColorPicker}
          transparent={true}
          animationType="fade"
          onRequestClose={() => { setShowWheel(false); setShowColorPicker(false); setSelectedColor(null); }}
          >
          <View style={styles.modalOverlay}>
            <View style={[
              styles.colorModalContainer,
              { backgroundColor: isDark ? '#1f2937' : '#f3f4f6' }
            ]}>
              <View style={styles.colorModalHeader}>
                <Text style={[styles.colorModalTitle, { color: isDark ? '#f3f4f6' : '#111827' }]}>Choose Background Color</Text>
                <TouchableOpacity onPress={() => { setShowWheel(false); setShowColorPicker(false); }}>
                  <Ionicons name="close" size={18} color={isDark ? '#f3f4f6' : '#111827'} />
                </TouchableOpacity>
              </View>
              <Text style={[styles.colorModalSubtitle, { color: isDark ? '#d1d5db' : '#6b7280' }]}>
                {selectedColor ? selectedColor : 'No color selected'}
              </Text>

              <View style={styles.colorGrid}>
                {['#FF5733','#33FF57','#3357FF','#F333FF','#FFFF33',
                  '#33FFFF','#FF33FF','#33FFAA','#AA33FF','#FFAA33']
                  .map(c => (
                  <TouchableOpacity
                    key={c}
                    style={[
                      styles.colorSwatchLarge,
                      { backgroundColor: c, borderColor: isDark ? '#374151' : '#6b7280' },
                      selectedColor === c && styles.colorSwatchSelected
                    ]}
                    onPress={() => setSelectedColor(c)}
                  />
                ))}
              </View>

              {/* Preview box (tap to toggle color wheel) */}
              <TouchableOpacity
                activeOpacity={0.8}
                onPress={() => setShowWheel(prev => !prev)}
              >
                <View
                  style={[
                    styles.colorPreview,
                    { backgroundColor: selectedColor || (isDark ? '#111827' : '#000000') , borderColor: isDark ? '#9ca3af' : '#e5e7eb' }
                  ]}
                />
              </TouchableOpacity>

              {showWheel && (
                <View style={styles.wheelContainer}>
                  <ColorPicker
                    style={{ width: '100%' }}
                    value={selectedColor || '#8b5cf6'}
                    onChange={(color: any) => {
                      'worklet';
                      if (color && color.hex) {
                        runOnJS(setSelectedColor)(color.hex);
                      }
                    }}
                  >
                    <Panel1 style={{ width: '100%', height: 200, marginBottom: 12 }} />
                    <HueSlider style={styles.wheelSlider} thumbShape="pill" />
                    <BrightnessSlider style={styles.wheelSlider} />
                  </ColorPicker>
                </View>
              )}

              {/* Custom hex input */}
              <View style={styles.colorHexContainer}>
                <TextInput
                  style={[
                    styles.colorHexInput,
                    {
                      color: isDark ? '#f3f4f6' : '#111827',
                      borderColor: isDark ? '#9ca3af' : '#e5e7eb',
                      backgroundColor: isDark ? '#111827' : '#000000',
                    },
                  ]}
                  value={selectedColor ?? ''}
                  placeholder="#000000"
                  placeholderTextColor={isDark ? '#9ca3af' : '#9ca3af'}
                  autoCapitalize="none"
                  autoCorrect={false}
                  onChangeText={(t) => {
                    const v = t.startsWith('#') ? t : `#${t}`;
                    const valid = /^#([0-9A-Fa-f]{3}|[0-9A-Fa-f]{6})$/.test(v);
                    if (valid) {
                      setSelectedColor(v);
                    } else {
                      // keep raw text without breaking UI; do not apply until valid
                    }
                  }}
                />
              </View>

              {/* RGB inputs */}
              <View style={styles.rgbRow}>
                <View style={styles.rgbBox}>
                  <Text style={[styles.rgbLabel, { color: isDark ? '#d1d5db' : '#374151' }]}>R</Text>
                  <TextInput
                    keyboardType="number-pad"
                    value={rgbR}
                    onChangeText={(t) => {
                      const n = Number(t.replace(/[^0-9]/g, ''));
                      if (!Number.isNaN(n)) setRgbR(String(Math.min(255, n)));
                      if (rgbG !== '' && rgbB !== '' && !Number.isNaN(n)) {
                        setSelectedColor(rgbToHex(n, Number(rgbG), Number(rgbB)));
                      }
                    }}
                    style={[styles.rgbInput, { color: isDark ? '#f3f4f6' : '#111827', borderColor: isDark ? '#9ca3af' : '#e5e7eb', backgroundColor: isDark ? '#111827' : '#000000' }]}
                    maxLength={3}
                  />
                </View>
                <View style={styles.rgbBox}>
                  <Text style={[styles.rgbLabel, { color: isDark ? '#d1d5db' : '#374151' }]}>G</Text>
                  <TextInput
                    keyboardType="number-pad"
                    value={rgbG}
                    onChangeText={(t) => {
                      const n = Number(t.replace(/[^0-9]/g, ''));
                      if (!Number.isNaN(n)) setRgbG(String(Math.min(255, n)));
                      if (rgbR !== '' && rgbB !== '' && !Number.isNaN(n)) {
                        setSelectedColor(rgbToHex(Number(rgbR), n, Number(rgbB)));
                      }
                    }}
                    style={[styles.rgbInput, { color: isDark ? '#f3f4f6' : '#111827', borderColor: isDark ? '#9ca3af' : '#e5e7eb', backgroundColor: isDark ? '#111827' : '#000000' }]}
                    maxLength={3}
                  />
                </View>
                <View style={styles.rgbBox}>
                  <Text style={[styles.rgbLabel, { color: isDark ? '#d1d5db' : '#374151' }]}>B</Text>
                  <TextInput
                    keyboardType="number-pad"
                    value={rgbB}
                    onChangeText={(t) => {
                      const n = Number(t.replace(/[^0-9]/g, ''));
                      if (!Number.isNaN(n)) setRgbB(String(Math.min(255, n)));
                      if (rgbR !== '' && rgbG !== '' && !Number.isNaN(n)) {
                        setSelectedColor(rgbToHex(Number(rgbR), Number(rgbG), n));
                      }
                    }}
                    style={[styles.rgbInput, { color: isDark ? '#f3f4f6' : '#111827', borderColor: isDark ? '#9ca3af' : '#e5e7eb', backgroundColor: isDark ? '#111827' : '#000000' }]}
                    maxLength={3}
                  />
                </View>
              </View>

              {/* Footer buttons */}
              <View style={styles.colorFooter}>
                <TouchableOpacity style={[styles.secondaryButton, { backgroundColor: isDark ? '#6b7280' : '#9ca3af' }]} onPress={() => { setShowWheel(false); setShowColorPicker(false); }}>
                  <Text style={styles.secondaryButtonText}>Cancel</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[styles.primaryButton, { backgroundColor: '#8b5cf6', opacity: selectedColor ? 1 : 0.6 }]}
                  onPress={applySelectedColor}
                  disabled={!selectedColor}
                >
                  <Text style={styles.primaryButtonText}>Send Color</Text>
                </TouchableOpacity>
              </View>
            </View>
          </View>
        </Modal>

        {/* Input Area */}
        <View style={[
          styles.inputContainer, 
          { 
            backgroundColor: isDark ? '#1f2937' : '#ffffff',
            paddingBottom: 12
          }
        ]}>
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
                color: isDark ? '#ffffff' : '#1f2937'
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

          {/* Actions Toggle on the far right */}
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
        </View>

        {/* Chat Actions - toggled grid under input */}
        {showActions ? (
          <View style={[
            styles.actionsContainer,
            { backgroundColor: isDark ? '#111827' : '#ffffff', borderTopColor: isDark ? '#374151' : '#e5e7eb' }
          ]}>
            <View style={styles.actionsGrid}>
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
                style={[styles.actionButton, { backgroundColor: isRecording ? '#ef4444' : '#ec4899' }]}
                onPress={() => {
                  setIsRecording(!isRecording);
                  Alert.alert(isRecording ? 'Stop Recording' : 'Start Recording', 
                    isRecording ? 'Voice recording stopped' : 'Voice recording started');
                }}
              >
                <Ionicons name={isRecording ? 'stop' : 'mic'} size={16} color="white" />
                <Text style={styles.actionButtonText}>
                  {isRecording ? 'Stop Recording' : 'Record Voice Message'}
                </Text>
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
      
      {/* File Migration Modal */}
      <Modal
        visible={showFileMigrationModal}
        transparent={true}
        animationType="fade"
        onRequestClose={() => setShowFileMigrationModal(false)}
      >
        <View style={styles.modalOverlay}>
          <View style={[
            styles.modalContent,
            { backgroundColor: isDark ? '#1f2937' : '#ffffff' }
          ]}>
            <Text style={[
              styles.modalTitle,
              { color: isDark ? '#f3f4f6' : '#1f2937' }
            ]}>Feature Migrating</Text>
            <Text style={[
              styles.modalText,
              { color: isDark ? '#d1d5db' : '#6b7280' }
            ]}>File sending is still under migration.{"\n"}Please check back soon.</Text>
            <TouchableOpacity
              style={styles.modalCloseButton}
              onPress={() => setShowFileMigrationModal(false)}
            >
              <Text style={styles.modalCloseButtonText}>Close</Text>
            </TouchableOpacity>
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
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
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
    marginTop: 4,
    marginHorizontal: 12,
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
    marginLeft: 8,
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
    maxWidth: 300,
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
    marginBottom: 10,
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
});
