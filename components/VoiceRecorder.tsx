import React, { useState, useRef, useEffect } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  Modal,
  StyleSheet,
  Alert,
  Dimensions,
} from 'react-native';
import { Audio } from 'expo-av';
import { Ionicons } from '@expo/vector-icons';
import { useThemeColor } from '@/hooks/useThemeColor';
// Using simple View-based waveform instead of Skia for compatibility

interface VoiceRecorderProps {
  visible: boolean;
  onClose: () => void;
  onSendRecording: (uri: string, duration: number) => void;
}

export default function VoiceRecorder({ visible, onClose, onSendRecording }: VoiceRecorderProps) {
  const [recording, setRecording] = useState<Audio.Recording | null>(null);
  const [isRecording, setIsRecording] = useState(false);
  const [recordingUri, setRecordingUri] = useState<string | null>(null);
  const [duration, setDuration] = useState(0);
  const [status, setStatus] = useState('Ready to record');
  const [waveformData, setWaveformData] = useState<number[]>([]);
  
  const durationInterval = useRef<NodeJS.Timeout | null>(null);
  const startTime = useRef<number>(0);
  const animationFrame = useRef<number | null>(null);

  const backgroundColor = useThemeColor({}, 'background');
  const textColor = useThemeColor({}, 'text');
  const primaryColor = useThemeColor({}, 'tint');

  useEffect(() => {
    return () => {
      if (durationInterval.current) {
        clearInterval(durationInterval.current);
      }
      if (animationFrame.current) {
        cancelAnimationFrame(animationFrame.current);
      }
    };
  }, []);

  const requestPermissions = async () => {
    try {
      const { status } = await Audio.requestPermissionsAsync();
      if (status !== 'granted') {
        Alert.alert('Permission Required', 'Please grant microphone permission to record audio.');
        return false;
      }
      return true;
    } catch (error) {
      console.error('Error requesting permissions:', error);
      return false;
    }
  };

  const startRecording = async () => {
    try {
      const hasPermission = await requestPermissions();
      if (!hasPermission) return;

      setStatus('Requesting microphone...');
      
      await Audio.setAudioModeAsync({
        allowsRecordingIOS: true,
        playsInSilentModeIOS: true,
      });

      const { recording: newRecording } = await Audio.Recording.createAsync({
        android: {
          extension: '.m4a',
          outputFormat: Audio.AndroidOutputFormat.MPEG_4,
          audioEncoder: Audio.AndroidAudioEncoder.AAC,
          sampleRate: 44100,
          numberOfChannels: 2,
          bitRate: 128000,
        },
        ios: {
          extension: '.m4a',
          outputFormat: Audio.IOSOutputFormat.MPEG4AAC,
          audioQuality: Audio.IOSAudioQuality.HIGH,
          sampleRate: 44100,
          numberOfChannels: 2,
          bitRate: 128000,
        },
        web: {
          mimeType: 'audio/webm',
          bitsPerSecond: 128000,
        },
      });

      setRecording(newRecording);
      setIsRecording(true);
      setStatus('Recording...');
      setWaveformData([]);
      
      startTime.current = Date.now();
      durationInterval.current = setInterval(updateDuration, 100) as any;
      
      // Start waveform animation
      animateWaveform();

    } catch (error) {
      console.error('Failed to start recording:', error);
      setStatus('Error starting recording');
      Alert.alert('Recording Error', 'Failed to start recording. Please try again.');
    }
  };

  const stopRecording = async () => {
    if (!recording) return;

    try {
      setStatus('Processing...');
      setIsRecording(false);
      
      if (durationInterval.current) {
        clearInterval(durationInterval.current);
        durationInterval.current = null;
      }
      
      if (animationFrame.current) {
        cancelAnimationFrame(animationFrame.current);
        animationFrame.current = null;
      }

      await recording.stopAndUnloadAsync();
      const uri = recording.getURI();
      
      if (uri) {
        setRecordingUri(uri);
        setStatus('Preview your recording');
      }
      
      setRecording(null);
    } catch (error) {
      console.error('Failed to stop recording:', error);
      setStatus('Error stopping recording');
    }
  };

  const updateDuration = () => {
    if (startTime.current) {
      const elapsed = Math.floor((Date.now() - startTime.current) / 1000);
      setDuration(elapsed);
    }
  };

  const animateWaveform = () => {
    // Simulate waveform data - in a real implementation, you'd get this from audio analysis
    const newData = Array.from({ length: 50 }, () => Math.random() * 100);
    setWaveformData(prev => [...prev.slice(-49), ...newData].slice(-50));
    
    if (isRecording) {
      animationFrame.current = requestAnimationFrame(animateWaveform);
    }
  };

  const formatDuration = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  };

  const handleSend = () => {
    if (recordingUri) {
      onSendRecording(recordingUri, duration);
      resetRecorder();
      onClose();
    }
  };

  const handleDelete = () => {
    resetRecorder();
  };

  const resetRecorder = () => {
    setRecordingUri(null);
    setDuration(0);
    setStatus('Ready to record');
    setWaveformData([]);
    setIsRecording(false);
    
    if (durationInterval.current) {
      clearInterval(durationInterval.current);
      durationInterval.current = null;
    }
    
    if (animationFrame.current) {
      cancelAnimationFrame(animationFrame.current);
      animationFrame.current = null;
    }
  };

  const handleClose = () => {
    if (isRecording && recording) {
      stopRecording();
    }
    resetRecorder();
    onClose();
  };

  const WaveformVisualizer = () => {
    const { width } = Dimensions.get('window');
    const canvasWidth = width - 80;
    const canvasHeight = 60;

    if (waveformData.length === 0) {
      return <View style={[styles.waveformContainer, { width: canvasWidth, height: canvasHeight }]} />;
    }

    const barWidth = Math.max(2, canvasWidth / waveformData.length);
    
    return (
      <View style={[styles.waveformContainer, { width: canvasWidth, height: canvasHeight, flexDirection: 'row', alignItems: 'flex-end' }]}>
        {waveformData.map((value, index) => {
          const barHeight = Math.max(2, (value / 100) * canvasHeight);
          return (
            <View
              key={index}
              style={{
                width: barWidth - 1,
                height: barHeight,
                backgroundColor: primaryColor,
                marginRight: 1,
                borderRadius: 1,
              }}
            />
          );
        })}
      </View>
    );
  };

  return (
    <Modal
      visible={visible}
      animationType="slide"
      presentationStyle="pageSheet"
      onRequestClose={handleClose}
    >
      <View style={[styles.container, { backgroundColor }]}>
        <View style={styles.header}>
          <TouchableOpacity onPress={handleClose} style={styles.closeButton}>
            <Ionicons name="close" size={24} color={textColor} />
          </TouchableOpacity>
          <Text style={[styles.title, { color: textColor }]}>Voice Message</Text>
          <View style={styles.placeholder} />
        </View>

        <View style={styles.content}>
          <Text style={[styles.status, { color: textColor }]}>{status}</Text>
          
          {isRecording && (
            <Text style={[styles.duration, { color: primaryColor }]}>
              {formatDuration(duration)}
            </Text>
          )}

          {(isRecording || waveformData.length > 0) && <WaveformVisualizer />}

          {recordingUri && (
            <View style={styles.previewContainer}>
              <Text style={[styles.previewText, { color: textColor }]}>
                Recording ready • {formatDuration(duration)}
              </Text>
            </View>
          )}
        </View>

        <View style={styles.controls}>
          {!isRecording && !recordingUri && (
            <TouchableOpacity
              style={[styles.recordButton, { backgroundColor: primaryColor }]}
              onPress={startRecording}
            >
              <Ionicons name="mic" size={32} color="white" />
            </TouchableOpacity>
          )}

          {isRecording && (
            <TouchableOpacity
              style={[styles.stopButton, { backgroundColor: '#ef4444' }]}
              onPress={stopRecording}
            >
              <Ionicons name="stop" size={32} color="white" />
            </TouchableOpacity>
          )}

          {recordingUri && (
            <View style={styles.actionButtons}>
              <TouchableOpacity
                style={[styles.actionButton, { backgroundColor: '#6b7280' }]}
                onPress={handleDelete}
              >
                <Ionicons name="trash" size={24} color="white" />
                <Text style={styles.actionButtonText}>Delete</Text>
              </TouchableOpacity>
              
              <TouchableOpacity
                style={[styles.actionButton, { backgroundColor: primaryColor }]}
                onPress={handleSend}
              >
                <Ionicons name="send" size={24} color="white" />
                <Text style={styles.actionButtonText}>Send</Text>
              </TouchableOpacity>
            </View>
          )}
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingTop: 60,
    paddingBottom: 20,
    borderBottomWidth: 1,
    borderBottomColor: '#e5e7eb',
  },
  closeButton: {
    padding: 8,
  },
  title: {
    fontSize: 18,
    fontWeight: '600',
  },
  placeholder: {
    width: 40,
  },
  content: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 20,
  },
  status: {
    fontSize: 16,
    marginBottom: 20,
    textAlign: 'center',
  },
  duration: {
    fontSize: 24,
    fontWeight: 'bold',
    marginBottom: 20,
  },
  waveformContainer: {
    marginVertical: 20,
    borderRadius: 8,
    overflow: 'hidden',
  },
  previewContainer: {
    padding: 20,
    borderRadius: 12,
    backgroundColor: '#f3f4f6',
    marginVertical: 20,
  },
  previewText: {
    fontSize: 16,
    textAlign: 'center',
  },
  controls: {
    paddingHorizontal: 20,
    paddingBottom: 40,
    alignItems: 'center',
  },
  recordButton: {
    width: 80,
    height: 80,
    borderRadius: 40,
    alignItems: 'center',
    justifyContent: 'center',
    elevation: 4,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.25,
    shadowRadius: 4,
  },
  stopButton: {
    width: 80,
    height: 80,
    borderRadius: 40,
    alignItems: 'center',
    justifyContent: 'center',
    elevation: 4,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.25,
    shadowRadius: 4,
  },
  actionButtons: {
    flexDirection: 'row',
    gap: 20,
  },
  actionButton: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 24,
    paddingVertical: 12,
    borderRadius: 25,
    gap: 8,
  },
  actionButtonText: {
    color: 'white',
    fontSize: 16,
    fontWeight: '600',
  },
});
