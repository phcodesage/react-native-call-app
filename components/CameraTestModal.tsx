import { requestCameraPermission } from '@/utils/permissions';
import { Ionicons } from '@expo/vector-icons';
import React, { useEffect, useState } from 'react';
import {
    ActivityIndicator,
    Alert,
    Modal,
    SafeAreaView,
    StatusBar,
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

interface CameraTestModalProps {
  visible: boolean;
  onClose: () => void;
}

export const CameraTestModal: React.FC<CameraTestModalProps> = ({
  visible,
  onClose,
}) => {
  const { theme } = useTheme();
  const isDark = theme === 'dark';
  
  const [isLoading, setIsLoading] = useState(false);
  const [currentStream, setCurrentStream] = useState<MediaStream | null>(null);
  const [cameras, setCameras] = useState<MediaDeviceInfo[]>([]);
  const [currentCameraIndex, setCurrentCameraIndex] = useState(0);
  const [isCameraOn, setIsCameraOn] = useState(false);
  const [hasPermission, setHasPermission] = useState(false);

  useEffect(() => {
    if (visible) {
      checkPermissions();
    } else {
      stopCamera();
    }

    return () => {
      stopCamera();
    };
  }, [visible]);

  const checkPermissions = async () => {
    const result = await requestCameraPermission();
    setHasPermission(result.granted);
    
    if (result.granted) {
      await loadCameras();
    } else {
      Alert.alert('Camera Permission Required', result.message || 'Please grant camera permission to test the camera.');
    }
  };

  const loadCameras = async () => {
    try {
      setIsLoading(true);
      
      // Check if WebRTC is available
      if (!mediaDevices || typeof mediaDevices.enumerateDevices !== 'function') {
        console.warn('WebRTC mediaDevices not available, using mock cameras');
        // Provide mock cameras for development/testing
        const mockCameras: MediaDeviceInfo[] = [
          {
            deviceId: 'mock-front-camera',
            kind: 'videoinput',
            label: 'Front Camera (Mock)',
            groupId: 'mock-group-1'
          },
          {
            deviceId: 'mock-back-camera',
            kind: 'videoinput',
            label: 'Back Camera (Mock)',
            groupId: 'mock-group-2'
          }
        ];
        setCameras(mockCameras);
        setCurrentCameraIndex(0);
        return;
      }

      const devices = await mediaDevices.enumerateDevices() as MediaDeviceInfo[];
      const videoInputs = devices.filter((device: MediaDeviceInfo) => device.kind === 'videoinput');
      setCameras(videoInputs);
      
      if (videoInputs.length > 0) {
        setCurrentCameraIndex(0);
      }
    } catch (error) {
      console.error('Error loading cameras:', error);
      Alert.alert('WebRTC Not Available', 
        'Camera functionality requires a native build. This feature will work after building the APK or running on a physical device with expo-dev-client.');
    } finally {
      setIsLoading(false);
    }
  };

  const startCamera = async () => {
    if (cameras.length === 0) return;

    try {
      setIsLoading(true);
      
      // Check if WebRTC is available
      if (!mediaDevices || typeof mediaDevices.getUserMedia !== 'function') {
        Alert.alert('WebRTC Not Available', 
          'Camera preview requires native WebRTC. Please build the APK or use expo-dev-client on a physical device to test camera functionality.');
        setIsLoading(false);
        return;
      }

      // Stop current stream if exists
      if (currentStream) {
        currentStream.getTracks().forEach(track => track.stop());
      }

      const currentCamera = cameras[currentCameraIndex];
      
      // Handle mock cameras
      if (currentCamera.deviceId.startsWith('mock-')) {
        Alert.alert('Mock Camera', 
          'This is a mock camera for development. Real camera functionality will work in the native build.');
        setIsLoading(false);
        return;
      }

      const constraints = {
        video: {
          deviceId: currentCamera.deviceId,
          width: { ideal: 1280 },
          height: { ideal: 720 },
          frameRate: { ideal: 30 }
        },
        audio: false
      };

      const stream = await mediaDevices.getUserMedia(constraints);
      setCurrentStream(stream);
      setIsCameraOn(true);
    } catch (error) {
      console.error('Error starting camera:', error);
      Alert.alert('Camera Error', 'Failed to start camera. Please check your camera permissions and try again.');
    } finally {
      setIsLoading(false);
    }
  };

  const stopCamera = () => {
    if (currentStream) {
      currentStream.getTracks().forEach(track => track.stop());
      setCurrentStream(null);
    }
    setIsCameraOn(false);
  };

  const switchCamera = async () => {
    if (cameras.length <= 1) return;

    const nextIndex = (currentCameraIndex + 1) % cameras.length;
    setCurrentCameraIndex(nextIndex);

    if (isCameraOn) {
      await startCamera();
    }
  };

  const toggleCamera = () => {
    if (isCameraOn) {
      stopCamera();
    } else {
      startCamera();
    }
  };

  const handleClose = () => {
    stopCamera();
    onClose();
  };

  const getCameraName = (camera: MediaDeviceInfo) => {
    if (camera.label) {
      return camera.label;
    }
    
    // Fallback names based on device ID patterns
    const deviceId = camera.deviceId.toLowerCase();
    if (deviceId.includes('front') || deviceId.includes('user')) {
      return 'Front Camera';
    } else if (deviceId.includes('back') || deviceId.includes('environment')) {
      return 'Back Camera';
    }
    return `Camera ${currentCameraIndex + 1}`;
  };

  const isFrontCamera = (camera: MediaDeviceInfo) => {
    const deviceId = camera.deviceId.toLowerCase();
    const label = camera.label.toLowerCase();
    return deviceId.includes('front') || deviceId.includes('user') || 
           label.includes('front') || label.includes('user');
  };

  return (
    <Modal
      visible={visible}
      animationType="slide"
      presentationStyle="fullScreen"
      statusBarTranslucent={true}
    >
      <SafeAreaView style={[styles.container, { backgroundColor: isDark ? '#000' : '#fff' }]}>
        <StatusBar barStyle={isDark ? 'light-content' : 'dark-content'} backgroundColor="transparent" translucent />
        
        {/* Header */}
        <View style={[styles.header, { borderBottomColor: isDark ? '#374151' : '#e5e7eb' }]}>
          <TouchableOpacity onPress={handleClose} style={styles.headerButton}>
            <Ionicons name="close" size={24} color={isDark ? '#fff' : '#000'} />
          </TouchableOpacity>
          <Text style={[styles.headerTitle, { color: isDark ? '#fff' : '#000' }]}>
            Camera Test
          </Text>
          <View style={styles.headerButton} />
        </View>

        {!hasPermission ? (
          <View style={styles.permissionContainer}>
            <Ionicons name="camera-outline" size={64} color={isDark ? '#6b7280' : '#9ca3af'} />
            <Text style={[styles.permissionTitle, { color: isDark ? '#fff' : '#000' }]}>
              Camera Permission Required
            </Text>
            <Text style={[styles.permissionText, { color: isDark ? '#9ca3af' : '#6b7280' }]}>
              Please grant camera permission to test your camera functionality.
            </Text>
            <TouchableOpacity
              style={[styles.permissionButton, { backgroundColor: '#3b82f6' }]}
              onPress={checkPermissions}
            >
              <Text style={styles.permissionButtonText}>Grant Permission</Text>
            </TouchableOpacity>
          </View>
        ) : (
          <>
            {/* Camera Preview */}
            <View style={styles.previewContainer}>
              {isLoading ? (
                <View style={styles.loadingContainer}>
                  <ActivityIndicator size="large" color="#3b82f6" />
                  <Text style={[styles.loadingText, { color: isDark ? '#9ca3af' : '#6b7280' }]}>
                    Loading camera...
                  </Text>
                </View>
              ) : isCameraOn && currentStream ? (
                <View style={styles.videoContainer}>
                  {React.createElement(RTCView as any, {
                    streamURL: currentStream.toURL(),
                    style: styles.videoPreview,
                    objectFit: "cover",
                    mirror: cameras[currentCameraIndex] && isFrontCamera(cameras[currentCameraIndex]),
                    zOrder: 0,
                  })}
                </View>
              ) : (
                <View style={[styles.videoPlaceholder, { backgroundColor: isDark ? '#1f2937' : '#f3f4f6' }]}>
                  <Ionicons name="camera-outline" size={64} color={isDark ? '#6b7280' : '#9ca3af'} />
                  <Text style={[styles.placeholderText, { color: isDark ? '#9ca3af' : '#6b7280' }]}>
                    {cameras.some(c => c.deviceId.startsWith('mock-')) 
                      ? 'Development Mode - Camera preview will work in native build'
                      : 'Camera is off'
                    }
                  </Text>
                  {cameras.some(c => c.deviceId.startsWith('mock-')) && (
                    <Text style={[styles.developmentText, { color: isDark ? '#6b7280' : '#9ca3af' }]}>
                      Build APK or use expo-dev-client for real camera testing
                    </Text>
                  )}
                </View>
              )}
            </View>

            {/* Camera Info */}
            {cameras.length > 0 && (
              <View style={[styles.infoContainer, { backgroundColor: isDark ? '#1f2937' : '#f9fafb' }]}>
                <Text style={[styles.infoTitle, { color: isDark ? '#fff' : '#000' }]}>
                  Current Camera
                </Text>
                <Text style={[styles.infoText, { color: isDark ? '#9ca3af' : '#6b7280' }]}>
                  {getCameraName(cameras[currentCameraIndex])} ({currentCameraIndex + 1} of {cameras.length})
                </Text>
              </View>
            )}

            {/* Controls */}
            <View style={styles.controlsContainer}>
              <TouchableOpacity
                style={[
                  styles.controlButton,
                  { backgroundColor: isCameraOn ? '#ef4444' : '#22c55e' }
                ]}
                onPress={toggleCamera}
                disabled={isLoading}
              >
                <Ionicons 
                  name={isCameraOn ? "videocam-off" : "videocam"} 
                  size={24} 
                  color="#fff" 
                />
                <Text style={styles.controlButtonText}>
                  {isCameraOn ? 'Stop Camera' : 'Start Camera'}
                </Text>
              </TouchableOpacity>

              {cameras.length > 1 && (
                <TouchableOpacity
                  style={[
                    styles.controlButton,
                    { backgroundColor: '#3b82f6' }
                  ]}
                  onPress={switchCamera}
                  disabled={isLoading}
                >
                  <Ionicons name="camera-reverse" size={24} color="#fff" />
                  <Text style={styles.controlButtonText}>Switch Camera</Text>
                </TouchableOpacity>
              )}
            </View>

            {/* Instructions */}
            <View style={[styles.instructionsContainer, { backgroundColor: isDark ? '#1f2937' : '#f9fafb' }]}>
              <Text style={[styles.instructionsTitle, { color: isDark ? '#fff' : '#000' }]}>
                Instructions
              </Text>
              <Text style={[styles.instructionsText, { color: isDark ? '#9ca3af' : '#6b7280' }]}>
                • Tap "Start Camera" to begin preview{'\n'}
                • Use "Switch Camera" to test different cameras{'\n'}
                • Check video quality and ensure cameras work properly{'\n'}
                • Front camera preview is mirrored (normal behavior)
              </Text>
            </View>
          </>
        )}
      </SafeAreaView>
    </Modal>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 1,
  },
  headerButton: {
    width: 40,
    height: 40,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerTitle: {
    fontSize: 18,
    fontWeight: '600',
  },
  permissionContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 32,
  },
  permissionTitle: {
    fontSize: 24,
    fontWeight: '600',
    marginTop: 16,
    textAlign: 'center',
  },
  permissionText: {
    fontSize: 16,
    marginTop: 8,
    textAlign: 'center',
    lineHeight: 24,
  },
  permissionButton: {
    marginTop: 24,
    paddingHorizontal: 24,
    paddingVertical: 12,
    borderRadius: 8,
  },
  permissionButtonText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '600',
  },
  previewContainer: {
    flex: 1,
    margin: 16,
    borderRadius: 12,
    overflow: 'hidden',
  },
  loadingContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  loadingText: {
    marginTop: 12,
    fontSize: 16,
  },
  videoContainer: {
    flex: 1,
  },
  videoPreview: {
    flex: 1,
  },
  videoPlaceholder: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  placeholderText: {
    marginTop: 12,
    fontSize: 16,
    textAlign: 'center',
  },
  developmentText: {
    marginTop: 8,
    fontSize: 14,
    textAlign: 'center',
    fontStyle: 'italic',
  },
  infoContainer: {
    marginHorizontal: 16,
    marginBottom: 16,
    padding: 16,
    borderRadius: 8,
  },
  infoTitle: {
    fontSize: 16,
    fontWeight: '600',
    marginBottom: 4,
  },
  infoText: {
    fontSize: 14,
  },
  controlsContainer: {
    flexDirection: 'row',
    paddingHorizontal: 16,
    marginBottom: 16,
    gap: 12,
  },
  controlButton: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 12,
    borderRadius: 8,
    gap: 8,
  },
  controlButtonText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '600',
  },
  instructionsContainer: {
    marginHorizontal: 16,
    marginBottom: 16,
    padding: 16,
    borderRadius: 8,
  },
  instructionsTitle: {
    fontSize: 16,
    fontWeight: '600',
    marginBottom: 8,
  },
  instructionsText: {
    fontSize: 14,
    lineHeight: 20,
  },
});
