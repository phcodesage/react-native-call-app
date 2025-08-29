import { Ionicons } from '@expo/vector-icons';
import React, { useEffect, useRef, useState } from 'react';
import { Platform } from 'react-native';
import {
    ActivityIndicator,
    Alert,
    Animated,
    Dimensions,
    Modal,
    ScrollView,
    StatusBar,
    StyleSheet,
    Text,
    TouchableOpacity,
    View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import {
    MediaStream,
    RTCView,
    mediaDevices
} from 'react-native-webrtc';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useTheme } from '@/contexts/ThemeContext';

// RTCView props interface for proper typing
interface RTCViewProps {
  streamURL: string;
  style?: any;
  objectFit?: 'contain' | 'cover';
  mirror?: boolean;
  zOrder?: number;
}

interface MediaDeviceInfo {
  deviceId: string;
  kind: string;
  label: string;
  groupId: string;
}

interface CallSetupModalProps {
  visible: boolean;
  callType: 'audio' | 'video';
  recipientName: string;
  onStartCall: (selectedDevices: {
    audioDeviceId?: string;
    videoDeviceId?: string;
    speakerDeviceId?: string;
  }) => void;
  onCancel: () => void;
}

export const CallSetupModal: React.FC<CallSetupModalProps> = ({
  visible,
  callType,
  recipientName,
  onStartCall,
  onCancel,
}) => {
  const { theme } = useTheme();
  const isDark = theme === 'dark';
  const insets = useSafeAreaInsets();

  const [previewStream, setPreviewStream] = useState<MediaStream | null>(null);
  const [audioDevices, setAudioDevices] = useState<MediaDeviceInfo[]>([]);
  const [videoDevices, setVideoDevices] = useState<MediaDeviceInfo[]>([]);
  const [speakerDevices, setSpeakerDevices] = useState<MediaDeviceInfo[]>([]);
  const [selectedAudioDevice, setSelectedAudioDevice] = useState<string>('');
  const [selectedVideoDevice, setSelectedVideoDevice] = useState<string>('');
  const [selectedSpeakerDevice, setSelectedSpeakerDevice] = useState<string>('');
  const [isLoading, setIsLoading] = useState(false);
  const [isStartingCall, setIsStartingCall] = useState(false);
  const [micLevel, setMicLevel] = useState(0);
  const [currentFacingMode, setCurrentFacingMode] = useState<'user' | 'environment'>('user');
  const [callStartAnimation] = useState(new Animated.Value(0));
  const [showCallStartOverlay, setShowCallStartOverlay] = useState(false);
  // Do not start camera automatically; toggle via Start Camera button
  const [cameraStarted, setCameraStarted] = useState(false);
  // Discovered mapping for which deviceId is front/back
  const [frontDeviceId, setFrontDeviceId] = useState<string | null>(null);
  const [backDeviceId, setBackDeviceId] = useState<string | null>(null);

  // Initialize devices and preview when modal opens
  useEffect(() => {
    if (visible) {
      // Reset transient UI state on open to avoid stuck "Calling ..." overlay across sessions
      setIsStartingCall(false);
      setShowCallStartOverlay(false);
      callStartAnimation.setValue(0);
      setCameraStarted(false);
      initializeDevicesAndPreview();
    } else {
      cleanupPreview();
    }
    return cleanupPreview;
  }, [visible, callType]);

  const initializeDevicesAndPreview = async () => {
    try {
      setIsLoading(true);
      
      // Request permissions first with better error handling
      // IMPORTANT: Start with audio-only; do not open camera until user taps Start Camera
      const constraints = {
        audio: {
          channelCount: 2,
          sampleRate: 48000,
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
        video: false as const,
      };
      
      console.log('Requesting media with constraints:', constraints);
      const stream = await mediaDevices.getUserMedia(constraints);
      console.log('Media stream obtained:', stream.getTracks().length, 'tracks');
      
      setPreviewStream(stream);
      
      // Get available devices after getting stream
      const devices = await mediaDevices.enumerateDevices() as MediaDeviceInfo[];
      console.log('Available devices:', devices.length);
      
      const audioInputs = devices.filter((device: MediaDeviceInfo) => device.kind === 'audioinput');
      const videoInputs = devices.filter((device: MediaDeviceInfo) => device.kind === 'videoinput');
      const audioOutputs = devices.filter((device: MediaDeviceInfo) => device.kind === 'audiooutput');
      
      console.log('Device counts - Audio inputs:', audioInputs.length, 'Video inputs:', videoInputs.length, 'Audio outputs:', audioOutputs.length);
      console.log('Video devices found:', videoInputs.map(d => ({ id: d.deviceId, label: d.label })));
      
      setAudioDevices(audioInputs);
      setVideoDevices(videoInputs);
      setSpeakerDevices(audioOutputs);
      
      // Load saved preferences first
      const savedPreferences = await loadDevicePreferences();
      
      // Set default selections to match currently used devices or saved preferences
      const audioTrack = stream.getAudioTracks()[0];
      const videoTrack = stream.getVideoTracks()[0];
      
      if (audioTrack) {
        const audioSettings = audioTrack.getSettings() as any;
        const currentAudioDeviceId = audioSettings.deviceId;
        
        // Find the actual device being used
        const currentAudioDevice = audioInputs.find(device => device.deviceId === currentAudioDeviceId);
        const preferredAudioDevice = currentAudioDevice?.deviceId || savedPreferences.audioDeviceId || (audioInputs.length > 0 ? audioInputs[0].deviceId : '');
        setSelectedAudioDevice(preferredAudioDevice);
      }
      
      // Do not set video device yet; camera hasn't started. We'll set after Start Camera.
      
      if (audioOutputs.length > 0) {
        const preferredSpeakerDevice = savedPreferences.speakerDeviceId || audioOutputs[0].deviceId;
        setSelectedSpeakerDevice(preferredSpeakerDevice);
      }
      
      // Start mic level monitoring for both audio and video calls
      startMicLevelMonitoring(stream);
      
    } catch (error: any) {
      console.error('Error initializing devices:', error);
      
      let errorMessage = 'Please grant camera and microphone permissions to make calls.';
      
      if (error.name === 'NotAllowedError') {
        errorMessage = 'Camera and microphone permissions were denied. Please enable them in your device settings.';
      } else if (error.name === 'NotFoundError') {
        errorMessage = 'No camera or microphone found on this device.';
      } else if (error.name === 'NotReadableError') {
        errorMessage = 'Camera or microphone is already in use by another application.';
      } else if (error.name === 'OverconstrainedError') {
        errorMessage = 'The requested camera or microphone settings are not supported.';
      }
      
      Alert.alert(
        'Permission Required',
        errorMessage,
        [
          { text: 'Cancel', style: 'cancel', onPress: onCancel },
          { text: 'Retry', onPress: () => initializeDevicesAndPreview() }
        ]
      );
    } finally {
      setIsLoading(false);
    }
  };

  const startMicLevelMonitoring = (stream: MediaStream) => {
    // This is a simplified version - in a real app you'd use Web Audio API
    // For React Native, you might need a native module or use a different approach
    const audioTracks = stream.getAudioTracks();
    if (audioTracks.length > 0) {
      // Simulate mic level for demonstration
      // In production, you would use a proper audio level detection library
      let animationFrame: number;
      let lastLevel = 0;
      
      const updateMicLevel = () => {
        // Simulate more realistic mic level changes
        const targetLevel = Math.random() * 100;
        const smoothedLevel = lastLevel + (targetLevel - lastLevel) * 0.3;
        lastLevel = smoothedLevel;
        setMicLevel(Math.round(smoothedLevel));
        
        animationFrame = requestAnimationFrame(updateMicLevel);
      };
      
      updateMicLevel();
      
      return () => {
        if (animationFrame) {
          cancelAnimationFrame(animationFrame);
        }
        setMicLevel(0);
      };
    }
  };

  const formatDeviceLabel = (device: MediaDeviceInfo, type: string, index: number): string => {
    // Special handling for camera devices
    if (type === 'Camera') {
      // Prefer discovered mapping if available
      if (frontDeviceId && device.deviceId === frontDeviceId) {
        return `📷 Front Camera`;
      }
      if (backDeviceId && device.deviceId === backDeviceId) {
        return `📷 Back Camera`;
      }
      if (device.label) {
        // Check for front/back camera indicators
        if (device.label.toLowerCase().includes('front') ||
            device.label.toLowerCase().includes('user') ||
            device.label.toLowerCase().includes('facing front')) {
          return `📷 Front Camera`;
        }
        if (device.label.toLowerCase().includes('back') ||
            device.label.toLowerCase().includes('environment') ||
            device.label.toLowerCase().includes('rear') ||
            device.label.toLowerCase().includes('facing back')) {
          return `📷 Back Camera`;
        }
        // Fallback to original label with camera emoji
        return `📷 ${device.label}`;
      }
      // No label or ambiguous label: map by common numeric IDs first
      const id = (device.deviceId || '').toLowerCase();
      if (id === '1' || id.endsWith(':1')) {
        return `📷 Front Camera`;
      }
      if (id === '0' || id.endsWith(':0')) {
        return `📷 Back Camera`;
      }
      // Last resort: index-based generic label
      return `📷 Camera ${index}`;
    }
    
    // Handle audio devices
    if (device.label) {
      // Check for Bluetooth devices
      if (device.label.toLowerCase().includes('bluetooth') ||
          device.label.toLowerCase().includes('airpods') ||
          device.label.toLowerCase().includes('wireless')) {
        return `🎧 ${device.label}`;
      }
      // Check for wired headphones
      if (device.label.toLowerCase().includes('headphone') ||
          device.label.toLowerCase().includes('headset')) {
        return `🎧 ${device.label}`;
      }
      // Check for built-in devices
      if (device.label.toLowerCase().includes('built-in') ||
          device.label.toLowerCase().includes('speaker')) {
        return `🔊 ${device.label}`;
      }
      return device.label;
    }
    return `${type} ${index}`;
  };

  const storeDevicePreferences = async (devices: {
    audioDeviceId?: string;
    videoDeviceId?: string;
    speakerDeviceId?: string;
  }) => {
    try {
      if (devices.audioDeviceId) {
        await AsyncStorage.setItem('preferredAudioDevice', devices.audioDeviceId);
      }
      if (devices.videoDeviceId) {
        await AsyncStorage.setItem('preferredVideoDevice', devices.videoDeviceId);
      }
      if (devices.speakerDeviceId) {
        await AsyncStorage.setItem('preferredSpeakerDevice', devices.speakerDeviceId);
      }
      console.log('Device preferences stored:', devices);
    } catch (error) {
      console.error('Error storing device preferences:', error);
    }
  };

  const loadDevicePreferences = async () => {
    try {
      const [audioDeviceId, videoDeviceId, speakerDeviceId] = await Promise.all([
        AsyncStorage.getItem('preferredAudioDevice'),
        AsyncStorage.getItem('preferredVideoDevice'),
        AsyncStorage.getItem('preferredSpeakerDevice'),
      ]);
      
      return {
        audioDeviceId: audioDeviceId || undefined,
        videoDeviceId: videoDeviceId || undefined,
        speakerDeviceId: speakerDeviceId || undefined,
      };
    } catch (error) {
      console.error('Error loading device preferences:', error);
      return {};
    }
  };

  const cleanupPreview = () => {
    if (previewStream) {
      previewStream.getTracks().forEach(track => track.stop());
      setPreviewStream(null);
    }
    setMicLevel(0);
    setCurrentFacingMode('user'); // Reset to front camera
    setSelectedAudioDevice('');
    setSelectedVideoDevice('');
    setSelectedSpeakerDevice('');
    setShowCallStartOverlay(false);
    callStartAnimation.setValue(0);
  };

  const updateFacingModeFromDevice = (device: MediaDeviceInfo) => {
    const deviceLabel = device.label.toLowerCase();
    const deviceId = device.deviceId.toLowerCase();
    
    console.log('Updating facing mode for device:', { id: device.deviceId, label: device.label });
    
    // For devices with numeric IDs, use a different strategy
    if (device.deviceId === '0' || device.deviceId === '1') {
      // On most devices, '0' is typically front camera, '1' is back camera
      // But this can vary, so we'll test with actual stream
      console.log('Numeric device ID detected, will determine facing mode from stream');
      return; // Don't set facing mode here, let it be determined by actual testing
    }
    
    // More comprehensive detection logic for labeled devices
    if (deviceLabel.includes('back') || deviceLabel.includes('environment') || 
        deviceLabel.includes('rear') || deviceId.includes('back') || 
        deviceId.includes('environment') || deviceId.includes('rear')) {
      console.log('Setting facing mode to environment (back)');
      setCurrentFacingMode('environment');
    } else if (deviceLabel.includes('front') || deviceLabel.includes('user') || 
               deviceId.includes('front') || deviceId.includes('user') ||
               deviceLabel.includes('selfie')) {
      console.log('Setting facing mode to user (front)');
      setCurrentFacingMode('user');
    } else {
      console.log('Could not determine facing mode from device info');
    }
  };

  // Discover which deviceId maps to front/back cameras by probing facingMode
  const discoverCameraMapping = async () => {
    try {
      // Probe front (user)
      const userProbe = await mediaDevices.getUserMedia({ audio: false as const, video: { facingMode: 'user' } });
      const userTrack = userProbe.getVideoTracks()[0];
      const userId = (userTrack?.getSettings() as any)?.deviceId as string | undefined;
      userProbe.getTracks().forEach(t => t.stop());

      // Probe back (environment)
      const envProbe = await mediaDevices.getUserMedia({ audio: false as const, video: { facingMode: 'environment' } });
      const envTrack = envProbe.getVideoTracks()[0];
      const envId = (envTrack?.getSettings() as any)?.deviceId as string | undefined;
      envProbe.getTracks().forEach(t => t.stop());

      if (userId && envId && userId !== envId) {
        setFrontDeviceId(userId);
        setBackDeviceId(envId);
        console.log('Discovered camera mapping', { front: userId, back: envId });
      } else {
        console.log('Camera mapping probe inconclusive');
      }
    } catch (e) {
      console.warn('discoverCameraMapping failed:', e);
    }
  };

  const handleDeviceChange = async (deviceType: 'audio' | 'video', deviceId: string) => {
    try {
      console.log(`Switching ${deviceType} device to:`, deviceId);
      
      // Update state immediately for UI feedback
      if (deviceType === 'audio') {
        setSelectedAudioDevice(deviceId);
      } else if (deviceType === 'video') {
        setSelectedVideoDevice(deviceId);
        
        // Update facing mode based on device selection
        const device = videoDevices.find(d => d.deviceId === deviceId);
        if (device) {
          updateFacingModeFromDevice(device);
        }
      }
      
      // Update preview stream with new device
      if (previewStream) {
        // Clean up current stream
        previewStream.getTracks().forEach(track => track.stop());
        
        // Build new constraints
        const audioConstraints = deviceType === 'audio' 
          ? { 
              deviceId: { exact: deviceId },
              channelCount: 2,
              sampleRate: 48000,
              echoCancellation: true,
              noiseSuppression: true,
              autoGainControl: true,
            }
          : { 
              deviceId: selectedAudioDevice ? { exact: selectedAudioDevice } : undefined,
              channelCount: 2,
              sampleRate: 48000,
              echoCancellation: true,
              noiseSuppression: true,
              autoGainControl: true,
            };

        const videoConstraints = (callType === 'video' && cameraStarted) ? 
          (deviceType === 'video' ? {
              deviceId: { exact: deviceId },
              width: { ideal: 1280, min: 640 },
              height: { ideal: 720, min: 480 },
              frameRate: { ideal: 30, min: 15 },
            } : {
              deviceId: selectedVideoDevice ? { exact: selectedVideoDevice } : undefined,
              width: { ideal: 1280, min: 640 },
              height: { ideal: 720, min: 480 },
              frameRate: { ideal: 30, min: 15 },
            }) : false;
        
        const constraints = {
          audio: audioConstraints,
          video: videoConstraints,
        };
        
        console.log('New constraints for device switch:', constraints);
        const newStream = await mediaDevices.getUserMedia(constraints);
        console.log('New stream obtained with tracks:', newStream.getTracks().length);
        
        // Verify the stream is using the correct device
        if (deviceType === 'video' && newStream.getVideoTracks().length > 0) {
          const videoTrack = newStream.getVideoTracks()[0];
          const videoSettings = videoTrack.getSettings() as any;
          console.log('Video track settings after switch:', videoSettings);
          
          // For numeric device IDs, determine facing mode from actual stream capabilities
          if (deviceId === '0' || deviceId === '1') {
            // Prefer discovered mapping if available
            if (frontDeviceId && deviceId === frontDeviceId) {
              setCurrentFacingMode('user');
              console.log(`Set facing mode via discovered mapping for device ${deviceId}: user (front)`);
            } else if (backDeviceId && deviceId === backDeviceId) {
              setCurrentFacingMode('environment');
              console.log(`Set facing mode via discovered mapping for device ${deviceId}: environment (back)`);
            } else {
              const isFrontCamera = deviceId === '1';
              setCurrentFacingMode(isFrontCamera ? 'user' : 'environment');
              console.log(`Set facing mode based on numeric assumption for device ${deviceId}: ${isFrontCamera ? 'user (front)' : 'environment (back)'}`);
            }
          }
          
          // Ensure the selected device matches what's actually being used
          if (videoSettings.deviceId && videoSettings.deviceId !== deviceId) {
            console.warn('Device switch may not have worked as expected');
            // Update selection to match actual device
            const actualDevice = videoDevices.find(d => d.deviceId === videoSettings.deviceId);
            if (actualDevice) {
              setSelectedVideoDevice(actualDevice.deviceId);
              updateFacingModeFromDevice(actualDevice);
            }
          }
        }
        
        setPreviewStream(newStream);
        
        // Start mic level monitoring for the new stream
        startMicLevelMonitoring(newStream);
      }
    } catch (error: any) {
      console.error('Error changing device:', error);
      
      let errorMessage = 'Failed to switch device. Please try again.';
      if (error.name === 'NotAllowedError') {
        errorMessage = 'Device access denied. Please check your permissions.';
      } else if (error.name === 'NotFoundError') {
        errorMessage = 'Selected device not found or unavailable.';
      } else if (error.name === 'NotReadableError') {
        errorMessage = 'Device is busy or being used by another application.';
      }
      
      Alert.alert('Device Switch Error', errorMessage);
    }
  };

  const handleCameraSwitch = async () => {
    try {
      if (!previewStream || callType !== 'video') return;
      const videoTrack = previewStream.getVideoTracks()[0] as any;
      if (Platform.OS === 'android' && videoTrack && (videoTrack._switchCamera || videoTrack.switchCamera)) {
        // Use native switch for stability on Android
        console.log('Switching camera via native track API on Android');
        const fn = videoTrack._switchCamera || videoTrack.switchCamera;
        fn.call(videoTrack);
        // Toggle facing mode hint for UI
        setCurrentFacingMode(prev => (prev === 'user' ? 'environment' : 'user'));
        return;
      }

      console.log('Fallback camera switch via getUserMedia');
      const targetFacing = currentFacingMode === 'user' ? 'environment' : 'user';
      // Stop only the video track before switching
      previewStream.getVideoTracks().forEach(track => track.stop());
      const newVideoStream = await mediaDevices.getUserMedia({
        audio: false,
        video: {
          width: { ideal: 1280, min: 640 },
          height: { ideal: 720, min: 480 },
          frameRate: { ideal: 30, min: 15 },
          facingMode: targetFacing,
        },
      } as any);

      // Replace only video tracks in previewStream to keep audio stable
      const audioTracks = previewStream.getAudioTracks();
      const merged = new MediaStream();
      audioTracks.forEach(t => merged.addTrack(t));
      newVideoStream.getVideoTracks().forEach(t => merged.addTrack(t));
      setPreviewStream(merged);
      setCurrentFacingMode(targetFacing);
    } catch (error: any) {
      console.error('Error switching camera:', error);
      Alert.alert('Camera Switch Error', 'Failed to switch camera. Please try again.');
    }
  };

  const handleStartCall = async () => {
    setIsStartingCall(true);
    setShowCallStartOverlay(true);
    
    // Start call animation
    Animated.sequence([
      Animated.timing(callStartAnimation, {
        toValue: 1,
        duration: 800,
        useNativeDriver: true,
      }),
      Animated.timing(callStartAnimation, {
        toValue: 0,
        duration: 300,
        useNativeDriver: true,
      })
    ]).start();
    
    const selectedDevices = {
      audioDeviceId: selectedAudioDevice,
      videoDeviceId: (callType === 'video' && cameraStarted && !!selectedVideoDevice) ? selectedVideoDevice : undefined,
      speakerDeviceId: selectedSpeakerDevice,
    };
    
    // Store device preferences
    await storeDevicePreferences(selectedDevices);
    
    // Add a small delay for animation
    setTimeout(() => {
      onStartCall(selectedDevices);
    }, 1100);
  };

  const renderDeviceSelector = (
    title: string,
    devices: MediaDeviceInfo[],
    selectedDevice: string,
    onSelect: (deviceId: string) => void,
    icon: string
  ) => (
    <View style={styles.deviceSection}>
      <View style={styles.deviceHeader}>
        <Ionicons 
          name={icon as any} 
          size={20} 
          color={isDark ? '#9ca3af' : '#6b7280'} 
        />
        <Text style={[styles.deviceTitle, { color: isDark ? '#f3f4f6' : '#1f2937' }]}>
          {title}
        </Text>
      </View>
      
      <ScrollView 
        style={styles.deviceList}
        showsVerticalScrollIndicator={false}
      >
        {devices.map((device) => (
          <TouchableOpacity
            key={device.deviceId}
            style={[
              styles.deviceItem,
              {
                backgroundColor: selectedDevice === device.deviceId 
                  ? '#420796' 
                  : (isDark ? '#374151' : '#f3f4f6'),
              }
            ]}
            onPress={() => onSelect(device.deviceId)}
          >
            <Text style={[
              styles.deviceItemText,
              {
                color: selectedDevice === device.deviceId 
                  ? '#ffffff' 
                  : (isDark ? '#f3f4f6' : '#1f2937'),
              }
            ]}>
              {formatDeviceLabel(device, title, devices.indexOf(device) + 1)}
            </Text>
            {selectedDevice === device.deviceId && (
              <Ionicons name="checkmark-circle" size={20} color="#ffffff" />
            )}
          </TouchableOpacity>
        ))}
      </ScrollView>
    </View>
  );

  const { width: screenWidth, height: screenHeight } = Dimensions.get('window');

  const renderCallStartOverlay = () => {
    if (!showCallStartOverlay) return null;

    const scale = callStartAnimation.interpolate({
      inputRange: [0, 1],
      outputRange: [0.8, 1.2],
    });

    const opacity = callStartAnimation.interpolate({
      inputRange: [0, 0.5, 1],
      outputRange: [0, 1, 0],
    });

    return (
      <Animated.View style={[
        styles.callStartOverlay,
        {
          opacity,
          transform: [{ scale }],
        }
      ]}>
        <View style={styles.callStartContent}>
          <Animated.View style={[
            styles.callStartIcon,
            { transform: [{ scale }] }
          ]}>
            <Ionicons 
              name={callType === 'video' ? 'videocam' : 'call'} 
              size={60} 
              color="#ffffff" 
            />
          </Animated.View>
          <Text style={styles.callStartText}>Calling {recipientName}...</Text>
        </View>
      </Animated.View>
    );
  };

  // Start camera on demand
  const startCamera = async () => {
    try {
      const constraints = {
        audio: {
          deviceId: selectedAudioDevice ? { exact: selectedAudioDevice } : undefined,
          channelCount: 2,
          sampleRate: 48000,
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
        video: {
          width: { ideal: 1280, min: 640 },
          height: { ideal: 720, min: 480 },
          frameRate: { ideal: 30, min: 15 },
          facingMode: currentFacingMode,
        },
      } as const;

      if (previewStream) {
        previewStream.getTracks().forEach(t => t.stop());
      }

      const newStream = await mediaDevices.getUserMedia(constraints);
      setPreviewStream(newStream);

      if (Platform.OS !== 'android') {
        const devices = await mediaDevices.enumerateDevices() as MediaDeviceInfo[];
        const videoInputs = devices.filter((d: MediaDeviceInfo) => d.kind === 'videoinput');
        const videoTrack = newStream.getVideoTracks()[0];
        if (videoTrack) {
          const videoSettings = videoTrack.getSettings() as any;
          const currentVideoDeviceId = videoSettings.deviceId;
          const currentVideoDevice = videoInputs.find(d => d.deviceId === currentVideoDeviceId);
          const preferredVideoDevice = currentVideoDevice?.deviceId || (videoInputs.length > 0 ? videoInputs[0].deviceId : '');
          setSelectedVideoDevice(preferredVideoDevice);
          if (currentVideoDevice) updateFacingModeFromDevice(currentVideoDevice);
        }
      }

      setCameraStarted(true);
      startMicLevelMonitoring(newStream);
      // Avoid extra probes on Android to prevent black screen due to multiple camera opens
      if (Platform.OS !== 'android') {
        // Discover mapping asynchronously (best-effort)
        discoverCameraMapping();
      }
    } catch (e) {
      console.error('Failed to start camera:', e);
      Alert.alert('Camera', 'Unable to start camera. Check permissions and try again.');
    }
  };

  return (
    <Modal
      visible={visible}
      transparent={false}
      animationType="slide"
      onRequestClose={onCancel}
      statusBarTranslucent={true}
    >
      <View style={[
        styles.fullScreenContainer,
        { 
          backgroundColor: isDark ? '#1f2937' : '#ffffff',
          paddingTop: insets.top,
          paddingBottom: insets.bottom,
        }
      ]}>
        <StatusBar 
          barStyle={isDark ? 'light-content' : 'dark-content'} 
          backgroundColor={isDark ? '#1f2937' : '#ffffff'}
          translucent={false}
        />
          {/* Header */}
          <View style={styles.header}>
            <View>
              <Text style={[styles.title, { color: isDark ? '#f3f4f6' : '#1f2937' }]}>
                {callType === 'video' ? 'Video Call' : 'Audio Call'} Setup
              </Text>
              <Text style={[styles.subtitle, { color: isDark ? '#9ca3af' : '#6b7280' }]}>
                Calling {recipientName}
              </Text>
            </View>
          </View>

          {isLoading ? (
            <View style={styles.loadingContainer}>
              <ActivityIndicator size="large" color="#420796" />
              <Text style={[styles.loadingText, { color: isDark ? '#9ca3af' : '#6b7280' }]}>
                Setting up devices...
              </Text>
            </View>
          ) : (
            <ScrollView style={styles.content} showsVerticalScrollIndicator={false}>
              {/* Video Preview */}
              {callType === 'video' && (
                <View style={styles.previewContainer}>
                  <View style={styles.videoPreview}>
                    {cameraStarted && previewStream && previewStream.getVideoTracks().length > 0 ? (
                      <>
                        {React.createElement(RTCView as any, {
                          streamURL: previewStream.toURL(),
                          style: styles.previewVideo,
                          objectFit: "cover",
                          mirror: currentFacingMode === 'user', // Only mirror front camera
                          zOrder: 0,
                        })}
                        {/* Camera Switch Button */}
                        <TouchableOpacity
                          style={styles.cameraSwitchButton}
                          onPress={() => handleCameraSwitch()}
                        >
                          <Ionicons 
                            name="camera-reverse" 
                            size={24} 
                            color="#ffffff" 
                          />
                        </TouchableOpacity>
                      </>
                    ) : (
                      <View style={[styles.previewPlaceholder, { backgroundColor: isDark ? '#374151' : '#f3f4f6' }]}>
                        <Ionicons 
                          name="camera-outline" 
                          size={48} 
                          color={isDark ? '#9ca3af' : '#6b7280'} 
                        />
                        <Text style={[styles.placeholderText, { color: isDark ? '#9ca3af' : '#6b7280' }]}>
                          {'Camera is off'}
                        </Text>
                        <TouchableOpacity style={styles.startCameraButton} onPress={startCamera}>
                          <Ionicons name="videocam" size={18} color="#ffffff" />
                          <Text style={styles.startCameraButtonText}>Start Camera</Text>
                        </TouchableOpacity>
                      </View>
                    )}
                  </View>
                </View>
              )}

              {/* Audio Level Indicator - Show for both audio and video calls */}
              <View style={styles.audioLevelContainer}>
                <Text style={[styles.previewLabel, { color: isDark ? '#9ca3af' : '#6b7280' }]}>
                  Microphone Level
                </Text>
                <View style={styles.micLevelBar}>
                  <View
                    style={[
                      styles.micLevelFill,
                      { width: `${micLevel}%` }
                    ]}
                  />
                </View>
                <Text style={[styles.micLevelText, { color: isDark ? '#9ca3af' : '#6b7280' }]}>
                  {micLevel > 70 ? 'High' : micLevel > 30 ? 'Good' : micLevel > 5 ? 'Low' : 'Silent'}
                </Text>
              </View>

              {/* Device Selectors */}
              {renderDeviceSelector(
                'Microphone',
                audioDevices,
                selectedAudioDevice,
                (deviceId) => handleDeviceChange('audio', deviceId),
                'mic'
              )}
              {callType === 'video' && !cameraStarted && (
                <View style={styles.deviceSection}>
                  <View style={styles.deviceHeader}>
                    <Ionicons
                      name="videocam"
                      size={20}
                      color={isDark ? '#9ca3af' : '#6b7280'}
                    />
                    <Text style={[styles.deviceTitle, { color: isDark ? '#f3f4f6' : '#1f2937' }]}>
                      Camera
                    </Text>
                  </View>
                  <View style={[styles.noDeviceContainer, { backgroundColor: isDark ? '#374151' : '#f3f4f6' }]}>
                    <Text style={[styles.noDeviceText, { color: isDark ? '#9ca3af' : '#6b7280' }]}>
                      Start camera to select a camera device
                    </Text>
                    <TouchableOpacity style={styles.startCameraButton} onPress={startCamera}>
                      <Ionicons name="videocam" size={18} color="#ffffff" />
                      <Text style={styles.startCameraButtonText}>Start Camera</Text>
                    </TouchableOpacity>
                  </View>
                </View>
              )}
              {callType === 'video' && cameraStarted && renderDeviceSelector(
                'Camera',
                videoDevices,
                selectedVideoDevice,
                (deviceId) => handleDeviceChange('video', deviceId),
                'videocam'
              )}
              {renderDeviceSelector(
                'Speaker',
                speakerDevices,
                selectedSpeakerDevice,
                (deviceId) => setSelectedSpeakerDevice(deviceId),
                'volume-high'
              )}

              {/* Show message if no speaker devices available */}
              {speakerDevices.length === 0 && (
                <View style={styles.deviceSection}>
                  <View style={styles.deviceHeader}>
                    <Ionicons
                      name="volume-high"
                      size={20}
                      color={isDark ? '#9ca3af' : '#6b7280'}
                    />
                    <Text style={[styles.deviceTitle, { color: isDark ? '#f3f4f6' : '#1f2937' }]}>
                      Speaker / Audio Output
                    </Text>
                  </View>
                  <View style={[styles.noDeviceContainer, { backgroundColor: isDark ? '#374151' : '#f3f4f6' }]}>
                    <Text style={[styles.noDeviceText, { color: isDark ? '#9ca3af' : '#6b7280' }]}>
                      No audio output devices detected. Audio will use default speaker.
                    </Text>
                  </View>
                </View>
              )}
            </ScrollView>
          )}

          {/* Action Buttons */}
          <View style={styles.actions}>
            <TouchableOpacity
              style={[
                styles.actionButton,
                styles.cancelButton,
                { backgroundColor: isDark ? '#374151' : '#f3f4f6' }
              ]}
              onPress={onCancel}
              disabled={isStartingCall}
            >
              <Text style={[styles.cancelButtonText, { color: isDark ? '#f3f4f6' : '#1f2937' }]}>
                Cancel
              </Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={[
                styles.actionButton,
                styles.startButton,
                { opacity: isStartingCall ? 0.7 : 1 }
              ]}
              onPress={handleStartCall}
              disabled={isLoading || isStartingCall}
            >
              {isStartingCall ? (
                <ActivityIndicator size="small" color="#ffffff" />
              ) : (
                <Ionicons 
                  name={callType === 'video' ? 'videocam' : 'call'} 
                  size={20} 
                  color="#ffffff" 
                />
              )}
              <Text style={styles.startButtonText}>
                {isStartingCall ? `Calling ${recipientName}...` : 'Start Call'}
              </Text>
            </TouchableOpacity>
          </View>
        
        {/* Call Start Animation Overlay */}
        {renderCallStartOverlay()}
      </View>
    </Modal>
  );
};

const styles = StyleSheet.create({
  fullScreenContainer: {
    flex: 1,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(0, 0, 0, 0.1)',
  },
  title: {
    fontSize: 20,
    fontWeight: '600',
    marginBottom: 4,
    marginTop: 8,
  },
  subtitle: {
    fontSize: 14,
  },
  closeButton: {
    padding: 4,
  },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 40,
  },
  loadingText: {
    marginTop: 16,
    fontSize: 16,
  },
  content: {
    flex: 1,
    padding: 20,
  },
  previewContainer: {
    marginBottom: 24,
  },
  previewLabel: {
    fontSize: 16,
    fontWeight: '500',
    marginBottom: 12,
  },
  videoPreview: {
    width: '100%',
    height: 200,
    borderRadius: 12,
    overflow: 'hidden',
    backgroundColor: '#000',
    position: 'relative',
  },
  previewVideo: {
    flex: 1,
  },
  previewPlaceholder: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    borderRadius: 12,
  },
  placeholderText: {
    marginTop: 12,
    fontSize: 14,
    textAlign: 'center',
  },
  startCameraButton: {
    marginTop: 12,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: '#420796',
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 20,
  },
  startCameraButtonText: {
    color: '#ffffff',
    fontSize: 14,
    fontWeight: '600',
    marginLeft: 6,
  },
  cameraSwitchButton: {
    position: 'absolute',
    top: 12,
    right: 12,
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: 'rgba(0, 0, 0, 0.6)',
    justifyContent: 'center',
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.25,
    shadowRadius: 4,
    elevation: 4,
  },
  audioLevelContainer: {
    marginBottom: 24,
  },
  micLevelBar: {
    height: 8,
    backgroundColor: '#e5e7eb',
    borderRadius: 4,
    overflow: 'hidden',
  },
  micLevelFill: {
    height: '100%',
    backgroundColor: '#10b981',
    borderRadius: 4,
  },
  micLevelText: {
    fontSize: 12,
    marginTop: 4,
    textAlign: 'center',
  },
  deviceSection: {
    marginBottom: 24,
  },
  deviceHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 12,
  },
  deviceTitle: {
    fontSize: 16,
    fontWeight: '500',
    marginLeft: 8,
  },
  deviceList: {
    maxHeight: 120,
  },
  deviceItem: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: 12,
    borderRadius: 8,
    marginBottom: 8,
  },
  deviceItemText: {
    fontSize: 14,
    flex: 1,
  },
  actions: {
    flexDirection: 'row',
    padding: 20,
    gap: 12,
  },
  actionButton: {
    flex: 1,
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    paddingVertical: 14,
    paddingHorizontal: 20,
    borderRadius: 12,
    gap: 8,
  },
  cancelButton: {
    borderWidth: 1,
    borderColor: '#d1d5db',
  },
  cancelButtonText: {
    fontSize: 16,
    fontWeight: '500',
  },
  startButton: {
    backgroundColor: '#420796',
  },
  startButtonText: {
    color: '#ffffff',
    fontSize: 16,
    fontWeight: '600',
  },
  callStartOverlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: 'rgba(0, 0, 0, 0.8)',
    justifyContent: 'center',
    alignItems: 'center',
    zIndex: 1000,
  },
  callStartContent: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  callStartIcon: {
    width: 120,
    height: 120,
    borderRadius: 60,
    backgroundColor: '#420796',
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 20,
    shadowColor: '#420796',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.4,
    shadowRadius: 16,
    elevation: 8,
  },
  callStartText: {
    color: '#ffffff',
    fontSize: 18,
    fontWeight: '600',
    textAlign: 'center',
  },
  noDeviceContainer: {
    padding: 16,
    borderRadius: 8,
    alignItems: 'center',
  },
  noDeviceText: {
    fontSize: 14,
    textAlign: 'center',
  },
});
