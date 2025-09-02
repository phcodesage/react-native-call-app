import { Ionicons } from '@expo/vector-icons';
import React, { useEffect, useRef, useState } from 'react';
import {
    Alert,
    Animated,
    Dimensions,
    FlatList,
    KeyboardAvoidingView,
    Platform,
    SafeAreaView,
    StatusBar,
    StyleSheet,
    Text,
    TextInput,
    TouchableOpacity,
    useColorScheme,
    View,
} from 'react-native';
import { GestureHandlerRootView, PanGestureHandler, State } from 'react-native-gesture-handler';
import { MediaStream, RTCView } from 'react-native-webrtc';
import * as Notifications from 'expo-notifications';
import CallOngoingNotification from '../services/CallOngoingNotification';
import AndroidForegroundCallService from '../services/AndroidForegroundCallService';
import ChangeColorModal from './change-color/ChangeColorModal';
import FileMessage from './FileMessage';

// RTCView props interface for proper typing
interface RTCViewProps {
  streamURL: string;
  style?: any;
  objectFit?: 'contain' | 'cover';
  mirror?: boolean;
  zOrder?: number;
}

const { width, height } = Dimensions.get('window');

interface ChatMessage {
  id: string;
  text?: string;
  timestamp: Date;
  isOwn: boolean;
  senderName: string;
  type?: 'text' | 'file';
  // Media/file fields (mirrors main chat subset)
  file_url?: string;
  file_id?: string;
  file_name?: string;
  file_type?: string;
  file_size?: number;
}

interface CallScreenProps {
  localStream: MediaStream | null;
  remoteStream: MediaStream | null;
  isConnected: boolean;
  isAudioMuted: boolean;
  isVideoMuted: boolean;
  callDuration: string;
  recipientName: string;
  roomId?: string;
  // If parent has a chat color (e.g., set by remote peer), use it during call chat overlay
  peerChatBgColor?: string | null;
  onEndCall: () => void;
  onToggleMute: () => void;
  onToggleVideo: () => void;
  onSwitchCamera: () => void;
  onToggleSpeaker?: () => void;
  onSendMessage?: (message: string) => void;
  messages?: ChatMessage[];
  onOpenFilePicker?: () => void;
  // Extra quick actions (all optional)
  onOpenCamera?: () => void;
  onRingDoorbell?: () => void;
  onOpenChangeColor?: () => void;
  onToggleTimestamps?: () => void;
  showTimestamps?: boolean;
  onResetBgColor?: () => void;
  onApplyBgColor?: (color: string | null) => void;
}

export const CallScreen: React.FC<CallScreenProps> = ({
  localStream,
  remoteStream,
  isConnected,
  isAudioMuted,
  isVideoMuted,
  callDuration,
  recipientName,
  roomId,
  peerChatBgColor,
  onEndCall,
  onToggleMute,
  onToggleVideo,
  onSwitchCamera,
  onToggleSpeaker,
  onSendMessage,
  messages = [],
  onOpenFilePicker,
  onOpenCamera,
  onRingDoorbell,
  onOpenChangeColor,
  onToggleTimestamps,
  showTimestamps,
  onResetBgColor,
  onApplyBgColor,
}) => {
  const colorScheme = useColorScheme();
  const isDark = colorScheme === 'dark';
  const [isLocalVideoLarge, setIsLocalVideoLarge] = useState(false);
  const [controlsVisible, setControlsVisible] = useState(true);
  const [chatVisible, setChatVisible] = useState(false);
  const [messageText, setMessageText] = useState('');
  const [localVideoPosition] = useState(new Animated.ValueXY({ x: width - 140, y: 80 }));
  const [chatAnim] = useState(new Animated.Value(0));
  const [unreadCount, setUnreadCount] = useState(0);
  // Call-only chat color state
  const [showCallColorPicker, setShowCallColorPicker] = useState(false);
  const [callChatBgColor, setCallChatBgColor] = useState<string | null>(null);
  const controlsTimeoutRef = useRef<NodeJS.Timeout | undefined>(undefined);
  const flatListRef = useRef<FlatList>(null);
  const lastSeenCountRef = useRef(0);
  const isWide = width >= 420;
  // Use widths that account for side margins so two/three fit in one row
  const btnWidth = isWide ? '31.5%' : '47%';

  const hasVideo = (localStream?.getVideoTracks().length ?? 0) > 0 || (remoteStream?.getVideoTracks().length ?? 0) > 0;

  useEffect(() => {
    // Hide controls after 5 seconds of inactivity
    const resetControlsTimer = () => {
      if (controlsTimeoutRef.current) {
        clearTimeout(controlsTimeoutRef.current);
      }
      setControlsVisible(true);
      controlsTimeoutRef.current = setTimeout(() => {
        setControlsVisible(false);
      }, 5000) as unknown as NodeJS.Timeout;
    };

    resetControlsTimer();

    return () => {
      if (controlsTimeoutRef.current) {
        clearTimeout(controlsTimeoutRef.current);
      }
    };
  }, []);

  // Init notifications and request permissions once
  useEffect(() => {
    (async () => {
      try {
        await Notifications.requestPermissionsAsync();
        await CallOngoingNotification.init();
        // Wire actions from notification to this screen's handlers
        CallOngoingNotification.setHandlers({
          onEndCall: () => {
            try { onEndCall(); } catch {}
          },
        });
      } catch {}
    })();
    return () => {
      // Ensure dismissal when screen unmounts
      CallOngoingNotification.end();
      // Stop Android foreground service when leaving screen
      AndroidForegroundCallService.stop();
    };
  }, []);

  // Start/stop ongoing call indicator based on connection state
  useEffect(() => {
    if (isConnected) {
      if (Platform.OS === 'android') {
        // On Android 14+ (API >= 34), use Expo snapshot fallback to avoid FGS type crash
        const apiLevel = typeof Platform.Version === 'number' ? Platform.Version : parseInt(String(Platform.Version), 10);
        if (apiLevel >= 34) {
          CallOngoingNotification.start({ name: recipientName });
        } else {
          // Use Android foreground service for live-updating ongoing notification
          AndroidForegroundCallService.start(recipientName);
        }
      } else {
        // Non-Android: use Expo snapshot notification
        CallOngoingNotification.start({ name: recipientName });
      }
    } else {
      if (Platform.OS === 'android') {
        AndroidForegroundCallService.stop();
      }
      CallOngoingNotification.end();
    }
    // Also dismiss when chat overlay is opened? Not necessary; only shows in background
  }, [isConnected, recipientName]);

  // Animate chat panel visibility and manage unread counter
  useEffect(() => {
    if (chatVisible) {
      lastSeenCountRef.current = messages.length;
      setUnreadCount(0);
    }
    Animated.timing(chatAnim, {
      toValue: chatVisible ? 1 : 0,
      duration: 220,
      useNativeDriver: true,
    }).start();
  }, [chatVisible]);

  useEffect(() => {
    if (!chatVisible && messages.length > lastSeenCountRef.current) {
      setUnreadCount(messages.length - lastSeenCountRef.current);
    }
  }, [messages, chatVisible]);

  // Floating live message toasts removed; messages only in chat overlay

  const openChat = () => setChatVisible(true);
  const closeChat = () => setChatVisible(false);
  const toggleChat = () => setChatVisible((v) => !v);

  const showControls = () => {
    setControlsVisible(true);
    if (controlsTimeoutRef.current) {
      clearTimeout(controlsTimeoutRef.current);
    }
    controlsTimeoutRef.current = setTimeout(() => {
      setControlsVisible(false);
    }, 5000) as unknown as NodeJS.Timeout;
  };

  const handleEndCall = () => {
    Alert.alert(
      'End Call',
      'Are you sure you want to end this call?',
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'End Call', style: 'destructive', onPress: () => { CallOngoingNotification.end(); onEndCall(); } },
      ]
    );
  };

  const onGestureEvent = Animated.event(
    [{ nativeEvent: { translationX: localVideoPosition.x, translationY: localVideoPosition.y } }],
    { useNativeDriver: false }
  );

  const onHandlerStateChange = (event: any) => {
    if (event.nativeEvent.oldState === State.ACTIVE) {
      // Snap to edges
      const { translationX, translationY } = event.nativeEvent;
      const newX = translationX < width / 2 ? 20 : width - 140;
      const newY = Math.max(80, Math.min(height - 200, translationY));
      
      Animated.spring(localVideoPosition, {
        toValue: { x: newX, y: newY },
        useNativeDriver: false,
      }).start();
    }
  };

  const sendMessage = () => {
    if (messageText.trim() && onSendMessage) {
      onSendMessage(messageText.trim());
      setMessageText('');
    }
  };

  const renderChatMessage = ({ item }: { item: ChatMessage }) => {
    // File/media message
    if (item.type === 'file') {
      return (
        <View style={[
          styles.messageContainer,
          item.isOwn ? styles.ownMessage : styles.otherMessage
        ]}>
          <FileMessage
            file_id={item.file_id}
            file_name={item.file_name}
            file_type={item.file_type}
            file_size={item.file_size}
            file_url={item.file_url}
            sender={item.senderName}
            timestamp={item.timestamp.toISOString()}
            isOutgoing={item.isOwn}
            isDark={item.isOwn}
          />
          {showTimestamps && (
            <Text style={[
              styles.messageTime,
              { color: item.isOwn ? 'rgba(255,255,255,0.7)' : 'rgba(0,0,0,0.5)' }
            ]}>
              {item.timestamp.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
            </Text>
          )}
        </View>
      );
    }

    // Default: text message
    return (
      <View style={[
        styles.messageContainer,
        item.isOwn ? styles.ownMessage : styles.otherMessage
      ]}>
        <Text style={[
          styles.messageText,
          { color: item.isOwn ? '#ffffff' : '#000000' }
        ]}>
          {item.text}
        </Text>
        {showTimestamps && (
          <Text style={[
            styles.messageTime,
            { color: item.isOwn ? 'rgba(255,255,255,0.7)' : 'rgba(0,0,0,0.5)' }
          ]}>
            {item.timestamp.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
          </Text>
        )}
      </View>
    );
  };

  const renderVideoCall = () => (
    <GestureHandlerRootView style={styles.videoContainer}>
      {/* Remote Video (Main) - Centered with aspect ratio */}
      <TouchableOpacity
        style={styles.remoteVideoContainer as any}
        onPress={showControls}
        activeOpacity={1}
      >
        {remoteStream ? (
          <View style={styles.remoteVideoWrapper}>
            {React.createElement(RTCView as any, {
              streamURL: remoteStream.toURL(),
              style: styles.remoteVideo,
              objectFit: "contain", // Changed from "cover" to "contain" to maintain aspect ratio
              zOrder: 0,
            })}
          </View>
        ) : (
          <View style={[styles.remoteVideo as any, styles.videoPlaceholder as any]}>
            <View style={styles.avatarLarge as any}>
              <Text style={styles.avatarTextLarge as any}>
                {recipientName.charAt(0).toUpperCase()}
              </Text>
            </View>
            <Text style={styles.waitingText as any}>
              {isConnected ? 'Camera is off' : 'Connecting...'}
            </Text>
          </View>
        )}
      </TouchableOpacity>

      {/* Draggable Local Video (Picture-in-Picture) */}
      {localStream && !isVideoMuted && (
        <PanGestureHandler
          onGestureEvent={onGestureEvent}
          onHandlerStateChange={onHandlerStateChange}
        >
          <Animated.View
            style={[
              styles.localVideoContainer,
              // Only apply drag transform in small PiP mode
              !isLocalVideoLarge && {
                transform: [
                  { translateX: localVideoPosition.x },
                  { translateY: localVideoPosition.y },
                ],
              },
              isLocalVideoLarge && styles.localVideoLarge
            ]}
          >
            <TouchableOpacity
              onPress={() => setIsLocalVideoLarge(!isLocalVideoLarge)}
              style={styles.localVideoTouchable}
            >
              {React.createElement(RTCView as any, {
                streamURL: localStream.toURL(),
                style: styles.localVideo,
                objectFit: "cover",
                mirror: true,
                zOrder: 1,
              })}
            </TouchableOpacity>
          </Animated.View>
        </PanGestureHandler>
      )}

      {/* Floating live messages removed */}
    </GestureHandlerRootView>
  );

  const renderAudioCall = () => (
    <TouchableOpacity
      style={styles.audioContainer}
      onPress={showControls}
      activeOpacity={1}
    >
      <View style={styles.audioContent}>
        <View style={styles.avatarContainer}>
          <View style={styles.avatarLarge}>
            <Text style={styles.avatarTextLarge}>
              {recipientName.charAt(0).toUpperCase()}
            </Text>
          </View>
          {isConnected && (
            <View style={styles.audioIndicator}>
              <View style={styles.audioWave1} />
              <View style={styles.audioWave2} />
              <View style={styles.audioWave3} />
            </View>
          )}
        </View>
        <Text style={styles.recipientName}>{recipientName}</Text>
        <Text style={styles.callStatus}>
          {isConnected ? 'Connected' : 'Connecting...'}
        </Text>
      </View>
    </TouchableOpacity>
  );

  return (
    <SafeAreaView style={styles.container}>
      {hasVideo ? renderVideoCall() : renderAudioCall()}

      {/* Chat Overlay */}
      <Animated.View
        style={[
          styles.chatOverlay,
          {
            transform: [
              {
                translateX: chatAnim.interpolate({
                  inputRange: [0, 1],
                  outputRange: [width, 0],
                }),
              },
            ],
            // Make overlay background solid
            backgroundColor: '#000000',
          },
        ]}
      >
        <View style={styles.chatHeader}>
          <Text style={styles.chatTitle}>{recipientName}</Text>
          <TouchableOpacity onPress={closeChat} hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}>
            <Ionicons name="close" size={24} color="#ffffff" />
          </TouchableOpacity>
        </View>

        <FlatList
          ref={flatListRef}
          data={messages}
          renderItem={renderChatMessage}
          keyExtractor={(item) => item.id}
          style={styles.chatMessages}
          onContentSizeChange={() => flatListRef.current?.scrollToEnd()}
        />

        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
          style={styles.chatInputContainer}
        >
          <TextInput
            style={styles.chatInput}
            value={messageText}
            onChangeText={setMessageText}
            placeholder="Type a message..."
            placeholderTextColor="#9ca3af"
            multiline
            maxLength={500}
            returnKeyType="send"
            blurOnSubmit={false}
            onSubmitEditing={() => {
              if (messageText.trim()) {
                sendMessage();
              }
            }}
            onKeyPress={({ nativeEvent }) => {
              if (nativeEvent.key === 'Enter') {
                if (messageText.trim()) {
                  sendMessage();
                }
              }
            }}
          />
          <TouchableOpacity
            style={[styles.sendButton, { opacity: messageText.trim() ? 1 : 0.5 }]}
            onPress={sendMessage}
            disabled={!messageText.trim()}
            accessibilityLabel="Send message"
          >
            <Ionicons name="send" size={20} color="#ffffff" />
          </TouchableOpacity>
        </KeyboardAvoidingView>

        {/* Chat footer actions (below input) */}
        <View style={styles.chatFooter}>
          {onToggleTimestamps && (
            <TouchableOpacity
              style={[styles.chatFooterButton, { backgroundColor: '#8b5cf6' }]}
              onPress={onToggleTimestamps}
            >
              <Ionicons name="time" size={16} color="#ffffff" />
              <Text style={styles.chatFooterButtonText}>
                {showTimestamps ? 'Hide Timestamps' : 'Show Timestamps'}
              </Text>
            </TouchableOpacity>
          )}
          {/* Move Change Color here */}
          <TouchableOpacity
            style={[styles.chatFooterButton, { backgroundColor: '#6366f1' }]}
            onPress={() => setShowCallColorPicker(true)}
          >
            <Ionicons name="color-palette" size={16} color="#ffffff" />
            <Text style={styles.chatFooterButtonText}>Change Color</Text>
          </TouchableOpacity>
          {/* Reset local call chat color override */}
          <TouchableOpacity
            style={[styles.chatFooterButton, { backgroundColor: '#6b7280' }]}
            onPress={() => {
              try { onResetBgColor && onResetBgColor(); } catch {}
              setCallChatBgColor(null);
            }}
          >
            <Ionicons name="refresh" size={16} color="#ffffff" />
            <Text style={styles.chatFooterButtonText}>Reset BG</Text>
          </TouchableOpacity>
        </View>
      </Animated.View>

      {/* Call Info Header */}
      {controlsVisible && (
        <View style={styles.header}>
          <View style={styles.callInfo}>
            <Text style={styles.recipientNameHeader}>{recipientName}</Text>
            <Text style={styles.callDuration}>{callDuration}</Text>
          </View>

        </View>
      )}

      {/* Call Controls */}
      {controlsVisible && (
        <View style={styles.controls}>
          {/* Primary Controls (compact, icon buttons) */}
          {isConnected ? (
          <View style={styles.controlGrid}>
            {onSendMessage && (
              <TouchableOpacity
                style={[styles.actionButton, { backgroundColor: '#420796' }]}
                onPress={toggleChat}
                hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
              >
                <Ionicons name={chatVisible ? 'chatbubble' : 'chatbubble-outline'} size={16} color="#ffffff" />
                <Text style={styles.actionButtonText}>{chatVisible ? 'Hide Chat' : 'Chat'}</Text>
                {!chatVisible && unreadCount > 0 && (
                  <View style={styles.chatBadge}>
                    <Text style={styles.chatBadgeText}>{unreadCount}</Text>
                  </View>
                )}
              </TouchableOpacity>
            )}

            <TouchableOpacity
              style={[styles.actionButton, { backgroundColor: isAudioMuted ? '#4b5563' : '#10b981' }]}
              onPress={onToggleMute}
              hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
            >
              <Ionicons name={isAudioMuted ? 'mic-off' : 'mic'} size={16} color="#ffffff" />
              <Text style={styles.actionButtonText}>Mic is: {isAudioMuted ? 'off' : 'on'}</Text>
            </TouchableOpacity>

            {hasVideo && (
              <TouchableOpacity
                style={[styles.actionButton, { backgroundColor: isVideoMuted ? '#4b5563' : '#3b82f6' }]}
                onPress={onToggleVideo}
                hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
              >
                <Ionicons name={isVideoMuted ? 'videocam-off' : 'videocam'} size={16} color="#ffffff" />
                <Text style={styles.actionButtonText}>Video is: {isVideoMuted ? 'off' : 'on'}</Text>
              </TouchableOpacity>
            )}

            {hasVideo && !isVideoMuted && (
              <TouchableOpacity
                style={[styles.actionButton, { backgroundColor: '#6b7280' }]}
                onPress={onSwitchCamera}
                hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
              >
                <Ionicons name="camera-reverse" size={16} color="#ffffff" />
                <Text style={styles.actionButtonText}>Switch</Text>
              </TouchableOpacity>
            )}

            {onOpenFilePicker && (
              <TouchableOpacity
                style={[styles.actionButton, { backgroundColor: '#3b82f6' }]}
                onPress={onOpenFilePicker}
                hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
              >
                <Ionicons name="document" size={16} color="#ffffff" />
                <Text style={styles.actionButtonText}>Send File</Text>
              </TouchableOpacity>
            )}

            {!hasVideo && onToggleSpeaker && (
              <TouchableOpacity
                style={[styles.actionButton, { backgroundColor: '#6b7280' }]}
                onPress={onToggleSpeaker}
                hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
              >
                <Ionicons name="volume-high" size={16} color="#ffffff" />
                <Text style={styles.actionButtonText}>Speaker</Text>
              </TouchableOpacity>
            )}
          </View>
          ) : (
            <View style={styles.connectingHintRow}>
              <Text style={styles.connectingHintText}>Connecting…</Text>
            </View>
          )}

          {/* Quick Actions (compact) */}
          {isConnected && (
          <View style={styles.actionGrid}>
            {/* Only show Camera/Send File on audio-only calls */}
            {!hasVideo && onOpenCamera && (
              <TouchableOpacity
                style={[styles.actionButton, { backgroundColor: '#f59e0b' }]}
                onPress={onOpenCamera}
              >
                <Ionicons name="camera" size={16} color="#ffffff" />
                <Text style={styles.actionButtonText}>Camera</Text>
              </TouchableOpacity>
            )}
            {!hasVideo && onOpenFilePicker && (
              <TouchableOpacity
                style={[styles.actionButton, { backgroundColor: '#3b82f6' }]}
                onPress={onOpenFilePicker}
              >
                <Ionicons name="document" size={16} color="#ffffff" />
                <Text style={styles.actionButtonText}>Send File</Text>
              </TouchableOpacity>
            )}
            {/* Always keep these */}
            {onRingDoorbell && (
              <TouchableOpacity
                style={[styles.actionButton, { backgroundColor: '#10b981' }]}
                onPress={onRingDoorbell}
              >
                <Ionicons name="notifications" size={16} color="#ffffff" />
                <Text style={styles.actionButtonText}>Ring Doorbell</Text>
              </TouchableOpacity>
            )}
            {/* Change Color moved to chat footer */}
          </View>
          )}

          {/* End Call Button */}
          <TouchableOpacity
            style={styles.endCallTextButton}
            onPress={handleEndCall}
            hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
          >
            <Text style={styles.endCallText}>End Call</Text>
          </TouchableOpacity>
        </View>
      )}
      {/* Call-only Change Color Modal */}
      <ChangeColorModal
        visible={showCallColorPicker}
        isDark={isDark}
        initialColor={callChatBgColor || undefined}
        onClose={() => setShowCallColorPicker(false)}
        onApply={(color) => {
          // Do NOT change our local background; only emit to peer
          try { onApplyBgColor && onApplyBgColor(color ?? null); } catch {}
          setShowCallColorPicker(false);
        }}
        onReset={() => {
          setCallChatBgColor(null);
          setShowCallColorPicker(false);
        }}
      />
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  videoContainer: {
    flex: 1,
    position: 'relative',
  },
  remoteVideoContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  remoteVideoWrapper: {
    width: '100%',
    height: '100%',
    justifyContent: 'center',
    alignItems: 'center',
  },
  remoteVideo: {
    width: '100%',
    height: '100%',
    backgroundColor: '#000',
  },
  localVideoContainer: {
    position: 'absolute',
    width: 120,
    height: 160,
    borderRadius: 12,
    overflow: 'hidden',
    borderWidth: 2,
    borderColor: '#ffffff',
    elevation: 5,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.25,
    shadowRadius: 4,
    zIndex: 10,
  },
  localVideoLarge: {
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    width: '100%',
    height: '100%',
    borderRadius: 0,
    borderWidth: 0,
    elevation: 0,
    shadowColor: 'transparent',
    shadowOpacity: 0,
  },
  localVideoTouchable: {
    flex: 1,
  },
  localVideo: {
    flex: 1,
  },
  videoPlaceholder: {
    justifyContent: 'center',
    alignItems: 'center',
  },
  audioContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#1f2937',
  },
  audioContent: {
    alignItems: 'center',
  },
  avatarContainer: {
    position: 'relative',
    marginBottom: 32,
  },
  avatarLarge: {
    width: 160,
    height: 160,
    borderRadius: 80,
    backgroundColor: '#420796',
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 24,
  },
  avatarTextLarge: {
    fontSize: 64,
    fontWeight: '600',
    color: '#ffffff',
  },
  audioIndicator: {
    position: 'absolute',
    bottom: -10,
    left: '50%',
    marginLeft: -30,
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: 4,
  },
  audioWave: {
    width: 4,
    backgroundColor: '#10b981',
    borderRadius: 2,
  },
  audioWave1: {
    height: 16,
    animationDelay: '0ms',
  },
  audioWave2: {
    height: 24,
    animationDelay: '150ms',
  },
  audioWave3: {
    height: 20,
    animationDelay: '300ms',
  },
  recipientName: {
    fontSize: 28,
    fontWeight: '600',
    color: '#ffffff',
    marginBottom: 8,
    textAlign: 'center',
  },
  callStatus: {
    fontSize: 16,
    color: '#9ca3af',
    textAlign: 'center',
  },
  waitingText: {
    fontSize: 18,
    color: '#9ca3af',
    marginTop: 16,
    textAlign: 'center',
  },
  header: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    paddingTop: 50,
    paddingHorizontal: 20,
    paddingBottom: 20,
    backgroundColor: 'rgba(0, 0, 0, 0.3)',
    zIndex: 1000,
    elevation: 1000,
  },
  headerChatButton: {
    position: 'absolute',
    top: 60,
    right: 16,
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: 'rgba(255, 255, 255, 0.15)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  headerChatBadge: {
    position: 'absolute',
    top: -4,
    right: -4,
    backgroundColor: '#ef4444',
    borderRadius: 9,
    minWidth: 18,
    height: 18,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 3,
  },
  headerChatBadgeText: {
    color: '#ffffff',
    fontSize: 11,
    fontWeight: '700',
  },
  callInfo: {
    alignItems: 'center',
  },
  recipientNameHeader: {
    fontSize: 20,
    fontWeight: '600',
    color: '#ffffff',
    marginBottom: 4,
  },
  callDuration: {
    fontSize: 14,
    color: '#e5e7eb',
  },
  controls: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    paddingHorizontal: 12,
    paddingBottom: 10,
    paddingTop: 8,
    backgroundColor: 'transparent',
    alignItems: 'center',
    zIndex: 1000,
    elevation: 1000,
  },
  controlGrid: {
    width: '100%',
    maxWidth: 520,
    alignSelf: 'center',
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    paddingHorizontal: 8,
    marginBottom: 8,
  },
  controlRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'space-between',
    alignItems: 'stretch',
    alignContent: 'flex-start',
    width: '100%',
    maxWidth: 520,
    alignSelf: 'center',
    marginBottom: 10,
    paddingHorizontal: 8,
  },
  textButton: {
    height: 44,
    paddingHorizontal: 12,
    marginHorizontal: 4,
    marginVertical: 8,
    borderRadius: 22,
    backgroundColor: 'rgba(255, 255, 255, 0.2)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  textButtonActive: {
    backgroundColor: 'rgba(16, 185, 129, 0.4)',
  },
  textButtonLabel: {
    color: '#ffffff',
    fontSize: 14,
    fontWeight: '600',
  },
  actionGrid: {
    width: '100%',
    maxWidth: 520,
    alignSelf: 'center',
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    paddingHorizontal: 8,
    marginBottom: 6,
  },
  actionButton: {
    flexGrow: 1,
    flexBasis: '48%',
    minHeight: 40,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  actionButtonText: {
    color: '#ffffff',
    fontWeight: '700',
    fontSize: 14,
  },
  endCallTextButton: {
    minWidth: 180,
    height: 48,
    borderRadius: 24,
    backgroundColor: '#ef4444',
    justifyContent: 'center',
    alignItems: 'center',
    marginTop: 4,
  },
  endCallText: {
    color: '#ffffff',
    fontSize: 16,
    fontWeight: '700',
  },
  chatOverlay: {
    position: 'absolute',
    top: 0,
    right: 0,
    width: '100%',
    height: '100%',
    backgroundColor: '#000000',
    zIndex: 2000,
    elevation: 2000,
  },
  chatHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: 16,
    paddingTop: 16,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(255, 255, 255, 0.1)',
  },
  chatTitle: {
    fontSize: 18,
    fontWeight: '600',
    color: '#ffffff',
  },
  chatMessages: {
    flex: 1,
    padding: 16,
  },
  messageContainer: {
    marginBottom: 12,
    maxWidth: '80%',
  },
  ownMessage: {
    alignSelf: 'flex-end',
    backgroundColor: '#420796',
    borderRadius: 16,
    borderBottomRightRadius: 4,
    padding: 12,
  },
  otherMessage: {
    alignSelf: 'flex-start',
    backgroundColor: '#ffffff',
    borderRadius: 16,
    borderBottomLeftRadius: 4,
    padding: 12,
  },
  messageText: {
    fontSize: 16,
    lineHeight: 20,
  },
  messageTime: {
    fontSize: 12,
    marginTop: 4,
  },
  chatInputContainer: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    padding: 16,
    borderTopWidth: 1,
    borderTopColor: 'rgba(255, 255, 255, 0.1)',
    gap: 12,
  },
  attachButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: 'rgba(255, 255, 255, 0.15)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  chatInput: {
    flex: 1,
    backgroundColor: 'rgba(255, 255, 255, 0.1)',
    borderRadius: 20,
    paddingHorizontal: 16,
    paddingVertical: 12,
    color: '#ffffff',
    fontSize: 16,
    maxHeight: 100,
  },
  sendButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: '#420796',
    justifyContent: 'center',
    alignItems: 'center',
  },
  chatFooter: {
    paddingHorizontal: 16,
    paddingBottom: 12,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    flexWrap: 'wrap',
  },
  chatFooterButton: {
    alignSelf: 'flex-start',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: 10,
  },
  chatFooterButtonText: {
    color: '#ffffff',
    fontWeight: '700',
    fontSize: 14,
  },
  chatBadge: {
    position: 'absolute',
    top: -4,
    right: -4,
    backgroundColor: '#ef4444',
    borderRadius: 10,
    minWidth: 20,
    height: 20,
    justifyContent: 'center',
    alignItems: 'center',
  },
  chatBadgeText: {
    color: '#ffffff',
    fontSize: 12,
    fontWeight: '600',
  },
  connectingHintRow: {
    width: '100%',
    maxWidth: 520,
    alignSelf: 'center',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 8,
  },
  connectingHintText: {
    color: '#e5e7eb',
    fontSize: 14,
    opacity: 0.85,
  },
  liveToastContainer: {
    position: 'absolute',
    left: 12,
    right: 12,
    bottom: 96,
    gap: 8,
    zIndex: 1500,
    elevation: 1500,
  },
  liveToast: {
    backgroundColor: 'rgba(0,0,0,0.55)',
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderRadius: 12,
  },
  liveToastSender: {
    color: '#a3e635',
    fontSize: 12,
    fontWeight: '700',
    marginBottom: 2,
  },
  liveToastText: {
    color: '#ffffff',
    fontSize: 13,
  },
});
