import { Ionicons } from '@expo/vector-icons';
import React, { useEffect, useState } from 'react';
import {
    ActivityIndicator,
    Alert,
    Modal,
    ScrollView,
    StyleSheet,
    Text,
    TouchableOpacity,
    View,
} from 'react-native';
import {
    MediaStream,
    RTCView,
    mediaDevices
} from 'react-native-webrtc';
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
      
      // Request permissions first
      const constraints = {
        audio: true,
        video: callType === 'video',
      };
      
      const stream = await mediaDevices.getUserMedia(constraints);
      setPreviewStream(stream);
      
      // Get available devices
      const devices = await mediaDevices.enumerateDevices() as MediaDeviceInfo[];
      
      const audioInputs = devices.filter((device: MediaDeviceInfo) => device.kind === 'audioinput');
      const videoInputs = devices.filter((device: MediaDeviceInfo) => device.kind === 'videoinput');
      const audioOutputs = devices.filter((device: MediaDeviceInfo) => device.kind === 'audiooutput');
      
      setAudioDevices(audioInputs);
      setVideoDevices(videoInputs);
      setSpeakerDevices(audioOutputs);
      
      // Set default selections
      if (audioInputs.length > 0) setSelectedAudioDevice(audioInputs[0].deviceId);
      if (videoInputs.length > 0) setSelectedVideoDevice(videoInputs[0].deviceId);
      if (audioOutputs.length > 0) setSelectedSpeakerDevice(audioOutputs[0].deviceId);
      
      // Start mic level monitoring for audio calls
      if (callType === 'audio') {
        startMicLevelMonitoring(stream);
      }
      
    } catch (error) {
      console.error('Error initializing devices:', error);
      Alert.alert(
        'Permission Required',
        'Please grant camera and microphone permissions to make calls.',
        [{ text: 'OK', onPress: onCancel }]
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

  const cleanupPreview = () => {
    if (previewStream) {
      previewStream.getTracks().forEach(track => track.stop());
      setPreviewStream(null);
    }
    setMicLevel(0);
  };

  const handleDeviceChange = async (deviceType: 'audio' | 'video', deviceId: string) => {
    try {
      if (deviceType === 'audio') {
        setSelectedAudioDevice(deviceId);
      } else if (deviceType === 'video') {
        setSelectedVideoDevice(deviceId);
      }
      
      // Update preview stream with new device
      if (previewStream) {
        cleanupPreview();
        
        const constraints = {
          audio: deviceType === 'audio' ? { deviceId } : { deviceId: selectedAudioDevice },
          video: callType === 'video' ? 
            (deviceType === 'video' ? { deviceId } : { deviceId: selectedVideoDevice }) : 
            false,
        };
        
        const newStream = await mediaDevices.getUserMedia(constraints);
        setPreviewStream(newStream);
        
        if (callType === 'audio') {
          startMicLevelMonitoring(newStream);
        }
      }
    } catch (error) {
      console.error('Error changing device:', error);
      Alert.alert('Error', 'Failed to switch device. Please try again.');
    }
  };

  const handleStartCall = () => {
    setIsStartingCall(true);
    
    const selectedDevices = {
      audioDeviceId: selectedAudioDevice,
      videoDeviceId: callType === 'video' ? selectedVideoDevice : undefined,
      speakerDeviceId: selectedSpeakerDevice,
    };
    
    onStartCall(selectedDevices);
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

  return (
    <Modal
      visible={visible}
      transparent={true}
      animationType="slide"
      onRequestClose={onCancel}
    >
      <View style={styles.modalOverlay}>
        <View style={[
          styles.modalContent,
          { backgroundColor: isDark ? '#1f2937' : '#ffffff' }
        ]}>
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
              {callType === 'video' && previewStream && (
                <View style={styles.previewContainer}>
                  <Text style={[styles.previewLabel, { color: isDark ? '#9ca3af' : '#6b7280' }]}>
                    Camera Preview
                  </Text>
                  <View style={styles.videoPreview}>
                    {React.createElement(RTCView as any, {
                      streamURL: previewStream.toURL(),
                      style: styles.previewVideo,
                      objectFit: "cover",
                      mirror: true,
                      zOrder: 0,
                    })}
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
        </View>
      </View>
    </Modal>
  );
};

const styles = StyleSheet.create({
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.7)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  modalContent: {
    width: '90%',
    maxWidth: 400,
    maxHeight: '80%',
    borderRadius: 16,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.25,
    shadowRadius: 8,
    elevation: 8,
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
  },
  previewVideo: {
    flex: 1,
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
});
