import { Ionicons } from '@expo/vector-icons';
import React, { useEffect, useState } from 'react';
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

  // Initialize devices and preview when modal opens
  useEffect(() => {
    if (visible) {
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
      const constraints = {
        audio: {
          channelCount: 2,
          sampleRate: 48000,
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
        video: callType === 'video' ? {
          width: { ideal: 1280, min: 640 },
          height: { ideal: 720, min: 480 },
          frameRate: { ideal: 30, min: 15 },
          facingMode: currentFacingMode, // Use current facing mode
        } : false,
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
      
      setAudioDevices(audioInputs);
      setVideoDevices(videoInputs);
      setSpeakerDevices(audioOutputs);
      
      // Load saved preferences first
      const savedPreferences = await loadDevicePreferences();
      
      // Set default selections to saved preferences or currently used devices
      const audioTrack = stream.getAudioTracks()[0];
      const videoTrack = stream.getVideoTracks()[0];
      
      if (audioTrack) {
        const audioSettings = audioTrack.getSettings() as any;
        const preferredAudioDevice = savedPreferences.audioDeviceId || audioSettings.deviceId || (audioInputs.length > 0 ? audioInputs[0].deviceId : '');
        setSelectedAudioDevice(preferredAudioDevice);
      }
      
      if (videoTrack && callType === 'video') {
        const videoSettings = videoTrack.getSettings() as any;
        const preferredVideoDevice = savedPreferences.videoDeviceId || videoSettings.deviceId || (videoInputs.length > 0 ? videoInputs[0].deviceId : '');
        setSelectedVideoDevice(preferredVideoDevice);
      }
      
      if (audioOutputs.length > 0) {
        const preferredSpeakerDevice = savedPreferences.speakerDeviceId || audioOutputs[0].deviceId;
        setSelectedSpeakerDevice(preferredSpeakerDevice);
      }
      
      // Start mic level monitoring for audio calls
      if (callType === 'audio') {
        startMicLevelMonitoring(stream);
      }
      
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
      const interval = setInterval(() => {
        setMicLevel(Math.random() * 100);
      }, 100);
      
      return () => clearInterval(interval);
    }
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

  const handleDeviceChange = async (deviceType: 'audio' | 'video', deviceId: string) => {
    try {
      console.log(`Switching ${deviceType} device to:`, deviceId);
      
      if (deviceType === 'audio') {
        setSelectedAudioDevice(deviceId);
      } else if (deviceType === 'video') {
        setSelectedVideoDevice(deviceId);
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

        const videoConstraints = callType === 'video' ? 
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
        
        setPreviewStream(newStream);
        
        if (callType === 'audio') {
          startMicLevelMonitoring(newStream);
        }
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

      console.log('Switching camera from', currentFacingMode, 'to', currentFacingMode === 'user' ? 'environment' : 'user');
      
      // Toggle facing mode
      const newFacingMode = currentFacingMode === 'user' ? 'environment' : 'user';
      setCurrentFacingMode(newFacingMode);

      // Clean up current stream
      previewStream.getTracks().forEach(track => track.stop());
      
      // Create new stream with switched camera
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
          facingMode: newFacingMode,
        },
      };

      console.log('Camera switch constraints:', constraints);
      const newStream = await mediaDevices.getUserMedia(constraints);
      console.log('New camera stream obtained');
      
      setPreviewStream(newStream);

      // Update selected video device to match new stream
      const videoTrack = newStream.getVideoTracks()[0];
      if (videoTrack) {
        const videoSettings = videoTrack.getSettings() as any;
        if (videoSettings.deviceId) {
          setSelectedVideoDevice(videoSettings.deviceId);
        }
      }
      
    } catch (error: any) {
      console.error('Error switching camera:', error);
      
      let errorMessage = 'Failed to switch camera. Please try again.';
      if (error.name === 'NotFoundError') {
        errorMessage = 'The requested camera is not available on this device.';
      } else if (error.name === 'NotAllowedError') {
        errorMessage = 'Camera access denied. Please check your permissions.';
      } else if (error.name === 'NotReadableError') {
        errorMessage = 'Camera is busy or being used by another application.';
      }
      
      Alert.alert('Camera Switch Error', errorMessage);
      
      // Revert facing mode on error
      setCurrentFacingMode(currentFacingMode === 'user' ? 'environment' : 'user');
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
      videoDeviceId: callType === 'video' ? selectedVideoDevice : undefined,
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
              {device.label || `${title} ${devices.indexOf(device) + 1}`}
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
            <TouchableOpacity
              style={styles.closeButton}
              onPress={onCancel}
              disabled={isStartingCall}
            >
              <Ionicons name="close" size={24} color={isDark ? '#9ca3af' : '#6b7280'} />
            </TouchableOpacity>
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
                  <Text style={[styles.previewLabel, { color: isDark ? '#9ca3af' : '#6b7280' }]}>
                    Camera Preview
                  </Text>
                  <View style={styles.videoPreview}>
                    {previewStream && previewStream.getVideoTracks().length > 0 ? (
                      <>
                        {React.createElement(RTCView as any, {
                          streamURL: previewStream.toURL(),
                          style: styles.previewVideo,
                          objectFit: "cover",
                          mirror: true,
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
                          {previewStream ? 'No video signal' : 'Camera not available'}
                        </Text>
                      </View>
                    )}
                  </View>
                </View>
              )}

              {/* Audio Level Indicator */}
              {callType === 'audio' && (
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
                </View>
              )}

              {/* Device Selectors */}
              {renderDeviceSelector(
                'Microphone',
                audioDevices,
                selectedAudioDevice,
                (deviceId) => handleDeviceChange('audio', deviceId),
                'mic'
              )}

              {callType === 'video' && renderDeviceSelector(
                'Camera',
                videoDevices,
                selectedVideoDevice,
                (deviceId) => handleDeviceChange('video', deviceId),
                'camera'
              )}

              {renderDeviceSelector(
                'Speaker',
                speakerDevices,
                selectedSpeakerDevice,
                setSelectedSpeakerDevice,
                'volume-high'
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
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    padding: 20,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(0, 0, 0, 0.1)',
  },
  title: {
    fontSize: 20,
    fontWeight: '600',
    marginBottom: 4,
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
});
