 import { useEffect, useRef, useState } from 'react';
import { Alert, Platform } from 'react-native';
import type { Socket } from 'socket.io-client';
import type { MediaStream } from 'react-native-webrtc';
import type { WebRTCService, CallDevice } from '@/services/WebRTCService';
import { Audio } from 'expo-av';
import * as Notifications from 'expo-notifications';

type MaybeUser = { username?: string } | null | undefined;

interface UseCallFunctionsArgs {
  socketRef: React.RefObject<Socket | null>;
  roomId?: string;
  user?: MaybeUser;
  pendingOfferRef: React.RefObject<any>;
  pendingAnswerRef: React.RefObject<any>;
  callTimerRef: React.RefObject<NodeJS.Timeout | null>;
}

export function useCallFunctions({
  socketRef,
  roomId,
  user,
  pendingOfferRef,
  pendingAnswerRef,
  callTimerRef,
}: UseCallFunctionsArgs) {
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
  const [isScreenSharing, setIsScreenSharing] = useState(false);
  const [callDuration, setCallDuration] = useState('00:00');
  const webRTCServiceRef = useRef<WebRTCService | null>(null);
  const pendingIceCandidatesRef = useRef<any[]>([]);

  // Helper function to detect call type from SDP
  const detectCallTypeFromSDP = (sdp: string): 'audio' | 'video' | null => {
    if (!sdp) return null;
    // Check if SDP contains video media description
    return sdp.includes('m=video') ? 'video' : 'audio';
  };
  const callDirectionRef = useRef<'outgoing' | 'incoming' | null>(null);
  // Track if we've already prepared the incoming call (created PC and local tracks)
  const incomingPreparedRef = useRef<boolean>(false);

  // Sounds for call states (outgoing only)
  const ringingSoundRef = useRef<Audio.Sound | null>(null);
  const answerSoundRef = useRef<Audio.Sound | null>(null);
  const failedSoundRef = useRef<Audio.Sound | null>(null);

  // Android ongoing notification id
  const notificationIdRef = useRef<string | null>(null);

  // Load/unload sounds
  useEffect(() => {
    let mounted = true;
    (async () => {
      try {
        const [ringing, answer, failed] = await Promise.all([
          Audio.Sound.createAsync(require('../assets/sounds/ringing(gain-down).mp3'), { shouldPlay: false, isLooping: true, volume: 1.0 }),
          Audio.Sound.createAsync(require('../assets/sounds/answer.mp3'), { shouldPlay: false, isLooping: false, volume: 1.0 }),
          Audio.Sound.createAsync(require('../assets/sounds/failed.mp3'), { shouldPlay: false, isLooping: false, volume: 1.0 }),
        ]);
        if (!mounted) {
          ringing.sound.unloadAsync();
          answer.sound.unloadAsync();
          failed.sound.unloadAsync();
          return;
        }
        ringingSoundRef.current = ringing.sound;
        answerSoundRef.current = answer.sound;
        failedSoundRef.current = failed.sound;

        // Request notifications permission (Android 13+ and iOS)
        await Notifications.requestPermissionsAsync();

        // Android: ensure a high-importance channel for calls
        if (Platform.OS === 'android') {
          await Notifications.setNotificationChannelAsync('calls', {
            name: 'Calls',
            importance: Notifications.AndroidImportance.MAX,
            vibrationPattern: [0, 250, 250, 250],
            lockscreenVisibility: Notifications.AndroidNotificationVisibility.PUBLIC,
            bypassDnd: true,
            sound: undefined, // using custom sound via expo-av instead
            showBadge: false,
          });
        }
      } catch (e) {
        console.warn('Call sounds load failed:', e);
      }
    })();
    return () => {
      mounted = false;
      ringingSoundRef.current?.unloadAsync();
      answerSoundRef.current?.unloadAsync();
      failedSoundRef.current?.unloadAsync();
      ringingSoundRef.current = null;
      answerSoundRef.current = null;
      failedSoundRef.current = null;

      if (Platform.OS === 'android' && notificationIdRef.current) {
        void Notifications.dismissNotificationAsync(notificationIdRef.current);
        notificationIdRef.current = null;
      }
    };
  }, []);

  const playRinging = async () => {
    try { await ringingSoundRef.current?.replayAsync(); } catch {}
  };
  const stopRinging = async () => {
    try { await ringingSoundRef.current?.stopAsync(); } catch {}
  };
  const playAnswer = async () => {
    try { await answerSoundRef.current?.replayAsync(); } catch {}
  };
  const playFailed = async () => {
    try { await failedSoundRef.current?.replayAsync(); } catch {}
  };

  const showOrUpdateCallNotification = async (title: string, body?: string) => {
    if (Platform.OS !== 'android') return;
    // Do not show a system notification while user is on the call screen
    // We only keep a system notification when the call screen isn't visible
    if (showCallScreen) return;
    try {
      if (notificationIdRef.current) {
        await Notifications.dismissNotificationAsync(notificationIdRef.current);
        notificationIdRef.current = null;
      }
      notificationIdRef.current = await Notifications.scheduleNotificationAsync({
        content: {
          title,
          body,
          priority: Notifications.AndroidNotificationPriority.MAX,
          sticky: true,
        },
        trigger: null,
      });
    } catch (e) {
      console.warn('Failed to present call notification:', e);
    }
  };

  const showCallEndedNotification = async (title: string = 'Call ended') => {
    if (Platform.OS !== 'android') return;
    // Only show if not on call screen
    if (showCallScreen) return;
    try {
      // Dismiss any ongoing sticky notification first
      if (notificationIdRef.current) {
        await Notifications.dismissNotificationAsync(notificationIdRef.current);
        notificationIdRef.current = null;
      }
      await Notifications.scheduleNotificationAsync({
        content: {
          title,
          priority: Notifications.AndroidNotificationPriority.MAX,
          sticky: false,
        },
        trigger: null,
      });
    } catch (e) {
      console.warn('Failed to present call-ended notification:', e);
    }
  };

  const dismissCallNotification = async () => {
    if (Platform.OS !== 'android') return;
    try {
      if (notificationIdRef.current) {
        await Notifications.dismissNotificationAsync(notificationIdRef.current);
        notificationIdRef.current = null;
      }
    } catch {}
  };

  // Call handling functions
  const initializeWebRTC = async () => {
    try {
      console.log('[INIT-1] Chat: Initializing WebRTC with backend ICE servers');
      const { initializeWebRTC: initWebRTC } = await import('@/config/env');
      console.log('[INIT-2] Imported initWebRTC function');
      const webRTCService = await initWebRTC();
      console.log('[INIT-3] WebRTC service created:', !!webRTCService);
      webRTCServiceRef.current = webRTCService;
      console.log('[INIT-4] Chat: WebRTC initialized successfully');
    } catch (error) {
      console.error('[INIT-ERROR] Chat: Failed to initialize WebRTC:', error);
      throw error;
    }

    // Set up event handlers
    if (!webRTCServiceRef.current) return;

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
          // Stop ringing and play answer when call connects (outgoing)
          void stopRinging();
          void playAnswer();
          break;
        case 'disconnected':
        case 'failed':
          handleCallEnd();
          // On failure/disconnect, stop ringing and play failed tone
          void stopRinging();
          void playFailed();
          break;
      }
    };

    webRTCServiceRef.current.onIceCandidate = (candidate: any) => {
      if (socketRef.current && roomId) {
        socketRef.current.emit('signal', {
          room: roomId,
          signal: candidate,
          from: user?.username,
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
      const { requestCallPermissions } = await import('@/utils/permissions');
      const permissionResult = await requestCallPermissions(type === 'video');

      if (!permissionResult.granted) {
        Alert.alert(
          'Permission Required',
          permissionResult.message || 'Camera and microphone permissions are required for calls.',
          [
            { text: 'Cancel', style: 'cancel' },
            {
              text: 'Settings',
              onPress: () => {
                import('react-native').then(({ Linking }) => {
                  Linking.openSettings();
                });
              },
            },
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

      // Start ringing (outgoing) until connected or failed
      void playRinging();
      void showOrUpdateCallNotification('Calling…');

      await webRTCServiceRef.current.initializeCall(callType, selectedDevices);

      const offer = await webRTCServiceRef.current.createOffer();

      if (socketRef.current && roomId) {
        socketRef.current.emit('signal', {
          room: roomId,
          signal: { type: 'offer', sdp: offer.sdp, callType },
          from: user?.username,
        });
        // Mark direction as outgoing
        callDirectionRef.current = 'outgoing';
      }
    } catch (error) {
      console.error('Error starting call:', error);
      Alert.alert('Error', 'Failed to start call. Please try again.');
      // Stop ringing and play failed if start failed
      void stopRinging();
      void playFailed();
      void dismissCallNotification();
      handleCallEnd();
    }
  };

  const handleIncomingCall = async (caller: string, offer: any, callType: 'audio' | 'video') => {
    console.log('[CALL-1] Incoming call from:', caller, 'Type:', callType);
    
    // Store the offer for processing after WebRTC initialization
    console.log('[CALL-2] Storing pending offer:', offer?.type);
    pendingOfferRef.current = offer;
    // Clear any previous ICE candidates
    pendingIceCandidatesRef.current = [];
    console.log('[CALL-2.1] Cleared ICE candidate queue for new call');
    
    setIncomingCaller(caller);
    setShowIncomingCall(true);

    // Detect call type from SDP if not explicitly provided
    const detectedCallType = detectCallTypeFromSDP(offer?.sdp) || callType;
    console.log('[CALL-3] Detected call type from SDP:', detectedCallType, 'hasVideo:', detectedCallType === 'video');

    setIncomingCallType(detectedCallType);
    setCallType(detectedCallType);

    // Don't initialize WebRTC here - do it only when user accepts the call
    // This matches the working web version pattern
    console.log('[CALL-4] Incoming call received, waiting for user to accept before WebRTC setup');

    // Mark direction as incoming (we were called)
    callDirectionRef.current = 'incoming';

    setShowIncomingCall(true);
    // Start ringing and show notification for incoming call
    void playRinging();
    void showOrUpdateCallNotification(`Incoming ${detectedCallType} call`, `From ${caller}`);
  };

  const handleAcceptCall = async () => {
    try {
      // Initialize WebRTC only when user accepts (matching web version pattern)
      console.log('[ACCEPT-1] User accepted call, initializing WebRTC now...');
      await initializeWebRTC();
      
      if (!webRTCServiceRef.current) {
        console.log('[ACCEPT-2] ERROR: WebRTC service is null after initialization');
        throw new Error('Failed to initialize WebRTC service');
      }
      console.log('[ACCEPT-3] WebRTC service initialized successfully');

      // Initialize call with media permissions
      console.log('[ACCEPT-4] Initializing call with type:', incomingCallType);
      await webRTCServiceRef.current.initializeCall(incomingCallType);
      console.log('[ACCEPT-5] Call initialization completed');
      
      // Process the offer and create answer
      if (pendingOfferRef.current) {
        console.log('[ACCEPT-6] Processing offer after WebRTC setup:', pendingOfferRef.current.type);
        const answer = await webRTCServiceRef.current.createAnswer(pendingOfferRef.current);
        console.log('[ACCEPT-7] Answer created successfully:', answer.type);
        pendingAnswerRef.current = answer;
        
        // Process queued ICE candidates after answer is created
        console.log('[ACCEPT-7.1] Processing', pendingIceCandidatesRef.current.length, 'queued ICE candidates');
        for (const candidate of pendingIceCandidatesRef.current) {
          try {
            await webRTCServiceRef.current.addIceCandidate(candidate);
            console.log('[ACCEPT-7.2] Added queued ICE candidate:', candidate.candidate?.substring(0, 50) + '...');
          } catch (error) {
            console.error('[ACCEPT-7.2] Error adding queued ICE candidate:', error);
          }
        }
        pendingIceCandidatesRef.current = []; // Clear the queue
        console.log('[ACCEPT-7.3] Finished processing queued ICE candidates');
      } else {
        console.log('[ACCEPT-6] ERROR: No pending offer to process!');
      }

      setShowIncomingCall(false);
      setShowCallScreen(true);

      // Stop ringing immediately on accept and update notification
      void stopRinging();
      void showOrUpdateCallNotification('Connecting…');

      if (pendingAnswerRef.current && socketRef.current && roomId) {
        console.log('[ACCEPT-8] Sending answer to remote peer:', pendingAnswerRef.current.type);
        socketRef.current.emit('signal', {
          room: roomId,
          signal: { type: 'answer', sdp: pendingAnswerRef.current.sdp },
          from: user?.username,
        });
        console.log('[ACCEPT-9] Answer sent successfully, cleaning up refs');
        pendingAnswerRef.current = null;
        pendingOfferRef.current = null;
      } else {
        console.log('[ACCEPT-8] ERROR: Missing answer, socket, or roomId:', {
          hasAnswer: !!pendingAnswerRef.current,
          hasSocket: !!socketRef.current,
          roomId: roomId
        });
      }
    } catch (error) {
      console.error('[ACCEPT-ERROR] Error accepting call:', error);
      Alert.alert('Error', 'Failed to accept call. Please try again.');
      void dismissCallNotification();
      handleCallEnd();
    }
  };

  const handleIncomingIceCandidate = (candidate: any) => {
    console.log('[ICE-QUEUE-ADD] Queuing ICE candidate:', candidate.candidate?.substring(0, 50) + '...');
    pendingIceCandidatesRef.current.push(candidate);
    console.log('[ICE-QUEUE-ADD] Total queued candidates:', pendingIceCandidatesRef.current.length);
  };

  const handleCancelCallSetup = () => {
    setShowCallSetup(false);
  };

  const handleDeclineCall = () => {
    setShowIncomingCall(false);
    void stopRinging();
    void dismissCallNotification();
    if (socketRef.current && roomId) {
      socketRef.current.emit('signal', {
        room: roomId,
        signal: { type: 'call-declined' },
        from: user?.username,
      });
    }
  };

  const handleCallEnd = () => {
    // Capture duration from local state for accurate display
    const duration = callDuration;
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

    // Reset throttling state
    lastNotifUpdateRef.current = 0;

    // Always stop ringing on end
    void stopRinging();
    // Show a one-time 'Call ended' notification only if not on call screen
    void showCallEndedNotification();
    // Also ensure any existing sticky is dismissed
    void dismissCallNotification();

    if (socketRef.current && roomId) {
      // Emit call log with duration and direction-specific phrasing
      const peer = roomId?.split('-').find(n => n !== user?.username) || 'Unknown';
      let message = '';
      if (callDirectionRef.current === 'outgoing') {
        message = `you called ${peer}${duration ? `, duration ${duration}` : ''}`;
      } else if (callDirectionRef.current === 'incoming') {
        message = `${peer} called you${duration ? `, duration ${duration}` : ''}`;
      } else {
        // Fallback if direction unknown
        message = `call with ${peer}${duration ? `, duration ${duration}` : ''}`;
      }
      socketRef.current.emit('signal', {
        room: roomId,
        signal: { type: 'call-log', message },
        from: user?.username,
      });
      socketRef.current.emit('signal', {
        room: roomId,
        signal: { type: 'call-ended' },
        from: user?.username,
      });
    }

    // Reset direction and any pending offer/answer so next call starts fresh
    callDirectionRef.current = null;
    if (pendingOfferRef?.current) {
      pendingOfferRef.current = null;
    }
    if (pendingAnswerRef?.current) {
      pendingAnswerRef.current = null;
    }
    // Reset incoming preparation flag
    incomingPreparedRef.current = false;
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

  const handleToggleScreenShare = async () => {
    if (!webRTCServiceRef.current) return;

    try {
      if (isScreenSharing) {
        await webRTCServiceRef.current.stopScreenShare();
        setIsScreenSharing(false);
        console.log('Screen sharing stopped');
      } else {
        await webRTCServiceRef.current.startScreenShare();
        setIsScreenSharing(true);
        console.log('Screen sharing started');
      }
    } catch (error) {
      console.error('Error toggling screen share:', error);
      Alert.alert('Screen Share Error', 'Failed to toggle screen sharing. Please try again.');
    }
  };

  // While connected, keep the Android notification updated with duration
  const lastNotifUpdateRef = useRef<number>(0);
  useEffect(() => {
    if (Platform.OS !== 'android') return;
    if (!isCallConnected) {
      // Not connected: ensure sticky is cleared when toggling screens
      if (notificationIdRef.current) {
        void Notifications.dismissNotificationAsync(notificationIdRef.current).then(() => {
          notificationIdRef.current = null;
        }).catch(() => {});
      }
      return;
    }

    // If the call screen is visible, remove the sticky to avoid showing notif bar
    if (showCallScreen) {
      if (notificationIdRef.current) {
        void Notifications.dismissNotificationAsync(notificationIdRef.current).then(() => {
          notificationIdRef.current = null;
        }).catch(() => {});
      }
      return;
    }

    // Throttle updates to avoid flicker: update every 30s or when seconds hit :00 or :30
    const now = Date.now();
    const shouldUpdateByTime = !lastNotifUpdateRef.current || (now - lastNotifUpdateRef.current >= 30000);
    const shouldUpdateBySeconds = /:(00|30)$/.test(callDuration);
    if (shouldUpdateByTime || shouldUpdateBySeconds) {
      void showOrUpdateCallNotification('On call', `Duration ${callDuration}`);
      lastNotifUpdateRef.current = now;
    }
  }, [isCallConnected, callDuration, showCallScreen]);

  return {
    // state
    showCallSetup,
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
    isScreenSharing,
    callDuration,
    // refs
    webRTCServiceRef,
    // handlers
    handleStartCall,
    handleCallSetupStart,
    handleIncomingCall,
    handleIncomingIceCandidate,
    handleAcceptCall,
    handleCancelCallSetup,
    handleDeclineCall,
    handleCallEnd,
    handleToggleMute,
    handleToggleVideo,
    handleSwitchCamera,
    handleToggleScreenShare,
  };
}

export default useCallFunctions;
