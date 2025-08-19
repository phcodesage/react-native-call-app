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
  callTimerRef: React.RefObject<NodeJS.Timeout | null>;
}

export function useCallFunctions({
  socketRef,
  roomId,
  user,
  pendingOfferRef,
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
  const [callDuration, setCallDuration] = useState('00:00');
  const webRTCServiceRef = useRef<WebRTCService | null>(null);

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
      console.log('Chat: Initializing WebRTC with backend ICE servers');
      const { initializeWebRTC: initWebRTC } = await import('@/config/env');
      const webRTCService = await initWebRTC();
      webRTCServiceRef.current = webRTCService;
      console.log('Chat: WebRTC initialized successfully');
    } catch (error) {
      console.error('Chat: Failed to initialize WebRTC:', error);
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

  const handleIncomingCall = async (data: any) => {
    console.log('Handling incoming call:', data);
    setIncomingCaller(data.from);

    let detectedCallType: 'audio' | 'video' = 'audio';
    if (data.signal.callType) {
      detectedCallType = data.signal.callType;
    } else if (data.signal.sdp) {
      const hasVideo = data.signal.sdp.includes('m=video');
      detectedCallType = hasVideo ? 'video' : 'audio';
      console.log('Detected call type from SDP:', detectedCallType, 'hasVideo:', hasVideo);
    }

    setIncomingCallType(detectedCallType);
    setCallType(detectedCallType);

    try {
      if (!webRTCServiceRef.current) {
        await initializeWebRTC();
      }
      if (webRTCServiceRef.current) {
        await webRTCServiceRef.current.initializeCall(detectedCallType);
      }
      console.log('WebRTC initialized for incoming call');
    } catch (error) {
      console.error('Error initializing WebRTC for incoming call:', error);
    }

    setShowIncomingCall(true);
    // Start ringing and show notification for incoming call
    void playRinging();
    void showOrUpdateCallNotification(`Incoming ${detectedCallType} call`, data.from ? `From ${data.from}` : undefined);
  };

  const handleAcceptCall = async () => {
    try {
      if (!webRTCServiceRef.current) {
        console.warn('WebRTC not initialized, initializing now...');
        await initializeWebRTC();
      }
      if (webRTCServiceRef.current) {
        await webRTCServiceRef.current.initializeCall(incomingCallType);
      } else {
        throw new Error('Failed to initialize WebRTC service');
      }

      setShowIncomingCall(false);
      setShowCallScreen(true);

      // Stop ringing immediately on accept and update notification
      void stopRinging();
      void showOrUpdateCallNotification('Connecting…');

      if (pendingOfferRef.current && webRTCServiceRef.current) {
        console.log('Processing pending offer:', pendingOfferRef.current);
        const answer = await webRTCServiceRef.current.createAnswer(pendingOfferRef.current);
        if (socketRef.current && roomId) {
          socketRef.current.emit('signal', {
            room: roomId,
            signal: { type: 'answer', sdp: answer.sdp },
            from: user?.username,
          });
          console.log('Answer sent to remote peer');
        }
        pendingOfferRef.current = null;
      }
    } catch (error) {
      console.error('Error accepting call:', error);
      Alert.alert('Error', 'Failed to accept call. Please try again.');
      void dismissCallNotification();
      handleCallEnd();
    }
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

    // Always stop ringing on end
    void stopRinging();
    void dismissCallNotification();

    if (socketRef.current && roomId) {
      socketRef.current.emit('signal', {
        room: roomId,
        signal: { type: 'call-ended' },
        from: user?.username,
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

  // While connected, keep the Android notification updated with duration
  useEffect(() => {
    if (Platform.OS !== 'android') return;
    if (isCallConnected) {
      void showOrUpdateCallNotification('On call', `Duration ${callDuration}`);
    }
  }, [isCallConnected, callDuration]);

  return {
    // state
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
    // refs
    webRTCServiceRef,
    // handlers
    handleStartCall,
    handleCallSetupStart,
    handleIncomingCall,
    handleAcceptCall,
    handleDeclineCall,
    handleCallEnd,
    handleToggleMute,
    handleToggleVideo,
    handleSwitchCamera,
  };
}

export default useCallFunctions;
