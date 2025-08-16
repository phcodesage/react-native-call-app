import { CallScreen } from '@/components/CallScreen';
import { CallSetupModal } from '@/components/CallSetupModal';
import { CameraTestModal } from '@/components/CameraTestModal';
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
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { MediaStream } from 'react-native-webrtc';
import io, { Socket } from 'socket.io-client';
import { ENV, getApiUrl, getSocketUrl } from '../../config/env';

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
  
  // Call-related state
  const [showCallSetup, setShowCallSetup] = useState(false);
  const [showIncomingCall, setShowIncomingCall] = useState(false);
  const [showCallScreen, setShowCallScreen] = useState(false);
  const [showCameraTest, setShowCameraTest] = useState(false);
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
  const isDark = theme === 'dark';

  // Extract contact name from roomId (format: "user1-user2")
  const contactName = roomId?.split('-').find(name => name !== user?.username) || 'Unknown';

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
            // Initialize WebRTC only for offers
            if (!webRTCServiceRef.current) {
              await initializeWebRTC();
            }
            // Store the offer and show incoming call UI
            pendingOfferRef.current = signal;
            handleIncomingCall(data);
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

  const handleIncomingCall = (data: any) => {
    setIncomingCaller(data.from);
    setIncomingCallType(data.signal.callType || 'audio');
    setShowIncomingCall(true);
  };

  const handleAcceptCall = async () => {
    try {
      if (!webRTCServiceRef.current) {
        await initializeWebRTC();
      }

      setShowIncomingCall(false);
      setShowCallScreen(true);

      // Initialize call for receiving
      await webRTCServiceRef.current?.initializeCall(incomingCallType);

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
    <SafeAreaView style={[styles.container, { backgroundColor: isDark ? '#111827' : '#ffffff' }]}>
      {/* Header */}
      <View style={[styles.header, { backgroundColor: isDark ? '#1f2937' : '#ffffff' }]}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backButton}>
          <Ionicons name="arrow-back" size={24} color={isDark ? '#ffffff' : '#1f2937'} />
        </TouchableOpacity>
        <ThemedText style={styles.headerTitle}>{contactName}</ThemedText>
        <View style={styles.headerActions}>
          <TouchableOpacity 
            style={styles.headerButton}
            onPress={() => setShowCameraTest(true)}
          >
            <Ionicons name="camera-outline" size={20} color={isDark ? '#ffffff' : '#1f2937'} />
          </TouchableOpacity>
          <TouchableOpacity 
            style={styles.headerButton}
            onPress={() => handleStartCall('audio')}
          >
            <Ionicons name="call" size={20} color={isDark ? '#ffffff' : '#1f2937'} />
          </TouchableOpacity>
          <TouchableOpacity 
            style={styles.headerButton}
            onPress={() => handleStartCall('video')}
          >
            <Ionicons name="videocam" size={20} color={isDark ? '#ffffff' : '#1f2937'} />
          </TouchableOpacity>
        </View>
      </View>

      {/* Main Content with Keyboard Avoidance */}
      <KeyboardAvoidingView 
        style={styles.chatContainer}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        keyboardVerticalOffset={Platform.OS === 'ios' ? 100 : 0}
      >
        {/* Messages List */}
        <FlatList
          ref={flatListRef}
          data={messages}
          renderItem={renderMessage}
          keyExtractor={(item) => item.message_id.toString()}
          style={styles.messagesList}
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

        {/* Chat Actions */}
        {showActions ? (
          <View style={[
            styles.actionsContainer,
            { backgroundColor: isDark ? '#1f2937' : '#f9fafb' }
          ]}>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.actionsScrollContent}>
              <TouchableOpacity 
                style={[styles.actionButton, { backgroundColor: '#8b5cf6' }]}
                onPress={() => Alert.alert('Ring Doorbell', 'Doorbell notification sent!')}
              >
                <Ionicons name="notifications" size={16} color="white" />
                <Text style={styles.actionButtonText}>Ring Doorbell</Text>
              </TouchableOpacity>
              
              <TouchableOpacity 
                style={[styles.actionButton, { backgroundColor: '#a855f7' }]}
                onPress={() => Alert.alert('Color Picker', 'Color picker feature coming soon!')}
              >
                <Ionicons name="color-palette" size={16} color="white" />
                <Text style={styles.actionButtonText}>Change Color</Text>
              </TouchableOpacity>
              
              <TouchableOpacity 
                style={[styles.actionButton, { backgroundColor: '#10b981' }]}
                onPress={() => setShowFileMigrationModal(true)}
              >
                <Ionicons name="attach" size={16} color="white" />
                <Text style={styles.actionButtonText}>Send File</Text>
              </TouchableOpacity>
              
              <TouchableOpacity 
                style={[styles.actionButton, { backgroundColor: '#3b82f6' }]}
                onPress={() => Alert.alert('Camera', 'Camera feature coming soon!')}
              >
                <Ionicons name="camera" size={16} color="white" />
                <Text style={styles.actionButtonText}>Camera</Text>
              </TouchableOpacity>
              
              <TouchableOpacity 
                style={[styles.actionButton, { backgroundColor: isRecording ? '#ef4444' : '#ec4899' }]}
                onPress={() => {
                  setIsRecording(!isRecording);
                  Alert.alert(isRecording ? 'Stop Recording' : 'Start Recording', 
                    isRecording ? 'Voice recording stopped' : 'Voice recording started');
                }}
              >
                <Ionicons name={isRecording ? "stop" : "mic"} size={16} color="white" />
                <Text style={styles.actionButtonText}>
                  {isRecording ? 'Stop Recording' : 'Record Voice'}
                </Text>
              </TouchableOpacity>
              
              <TouchableOpacity 
                style={[styles.actionButton, { backgroundColor: '#6366f1' }]}
                onPress={() => {
                  setShowTimestamps(!showTimestamps);
                  Alert.alert('Timestamps', showTimestamps ? 'Timestamps hidden' : 'Timestamps shown');
                }}
              >
                <Ionicons name="time" size={16} color="white" />
                <Text style={styles.actionButtonText}>
                  {showTimestamps ? 'Hide Timestamps' : 'Show Timestamps'}
                </Text>
              </TouchableOpacity>
            </ScrollView>
          </View>
        ) : null}

        {/* Input Area */}
        <View style={[
          styles.inputContainer, 
          { 
            backgroundColor: isDark ? '#1f2937' : '#ffffff',
            paddingBottom: Math.max(insets.bottom, 12)
          }
        ]}>
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
          
          {/* Actions Toggle Button */}
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

      {/* Camera Test Modal */}
      <CameraTestModal
        visible={showCameraTest}
        onClose={() => setShowCameraTest(false)}
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
    paddingTop: Platform.OS === 'ios' ? 50 : 12,
  },
  backButton: {
    marginRight: 12,
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
  actionsContainer: {
    paddingVertical: 8,
    paddingHorizontal: 16,
    borderTopWidth: 1,
    borderTopColor: '#e5e7eb',
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
