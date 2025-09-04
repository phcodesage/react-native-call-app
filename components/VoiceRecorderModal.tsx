import React, { useState, useRef, useEffect } from 'react';
import {
  Modal,
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  Dimensions,
  Animated,
  Alert,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Audio } from 'expo-av';
// Note: LinearGradient removed as it's not used. Add if needed for UI polish.

interface VoiceRecorderModalProps {
  visible: boolean;
  onClose: () => void;
  onSendRecording: (uri: string, duration: number) => void;
  isDark?: boolean;
}

interface WaveformBarProps {
  height: number;
  isActive: boolean;
  isDark: boolean;
}

const WaveformBar: React.FC<WaveformBarProps> = ({ height, isActive, isDark }) => {
  const animatedHeight = useRef(new Animated.Value(height)).current;
  const animatedOpacity = useRef(new Animated.Value(0.3)).current;

  useEffect(() => {
    Animated.parallel([
      Animated.timing(animatedHeight, {
        toValue: height,
        duration: 150,
        useNativeDriver: false,
      }),
      Animated.timing(animatedOpacity, {
        toValue: isActive ? 1 : 0.3,
        duration: 150,
        useNativeDriver: false,
      }),
    ]).start();
  }, [height, isActive]);

  return (
    <Animated.View
      style={[
        styles.waveformBar,
        {
          height: animatedHeight,
          backgroundColor: isDark ? '#60a5fa' : '#3b82f6',
          opacity: animatedOpacity,
        },
      ]}
    />
  );
};

export const VoiceRecorderModal: React.FC<VoiceRecorderModalProps> = ({
  visible,
  onClose,
  onSendRecording,
  isDark = false,
}) => {
  const [isRecording, setIsRecording] = useState(false);
  const [isPlaying, setIsPlaying] = useState(false);
  const [isPaused, setIsPaused] = useState(false);
  const [recordingUri, setRecordingUri] = useState<string | null>(null);
  const [duration, setDuration] = useState(0);
  const [playbackPosition, setPlaybackPosition] = useState(0);
  const [waveformData, setWaveformData] = useState<number[]>([]);
  const [currentPlaybackIndex, setCurrentPlaybackIndex] = useState(0);
  const [recordedDurationMs, setRecordedDurationMs] = useState(0);

  const recordingRef = useRef<Audio.Recording | null>(null);
  const soundRef = useRef<Audio.Sound | null>(null);
  const durationIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const playbackIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const waveformIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const { width } = Dimensions.get('window');
  const waveformWidth = width - 120; // Account for padding and controls
  const maxBars = Math.floor(waveformWidth / 6); // 4px bar + 2px spacing

  // Generate random waveform data for visualization
  const generateWaveformBar = () => {
    return Math.random() * 40 + 10; // Random height between 10-50
  };

  // Initialize audio mode
  useEffect(() => {
    const setupAudio = async () => {
      try {
        await Audio.setAudioModeAsync({
          allowsRecordingIOS: true,
          playsInSilentModeIOS: true,
          staysActiveInBackground: false,
        });
      } catch (error) {
        console.warn('Failed to setup audio mode:', error);
      }
    };

    if (visible) {
      setupAudio();
    }

    return () => {
      // Cleanup on unmount
      if (durationIntervalRef.current) {
        clearInterval(durationIntervalRef.current);
      }
      if (playbackIntervalRef.current) {
        clearInterval(playbackIntervalRef.current);
      }
      if (waveformIntervalRef.current) {
        clearInterval(waveformIntervalRef.current);
      }
    };
  }, [visible]);

  // Reset state when modal opens
  useEffect(() => {
    if (visible) {
      setIsRecording(false);
      setIsPlaying(false);
      setIsPaused(false);
      setRecordingUri(null);
      setDuration(0);
      setPlaybackPosition(0);
      setWaveformData([]);
      setCurrentPlaybackIndex(0);
    }
  }, [visible]);

  const startRecording = async () => {
    try {
      const { status } = await Audio.requestPermissionsAsync();
      if (status !== 'granted') {
        Alert.alert('Permission Required', 'Please grant microphone permission to record audio.');
        return;
      }

      const recording = new Audio.Recording();
      await recording.prepareToRecordAsync({
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

      await recording.startAsync();
      recordingRef.current = recording;
      setIsRecording(true);
      setDuration(0);
      setWaveformData([]);

      // Start duration timer
      durationIntervalRef.current = setInterval(() => {
        setDuration(prev => prev + 0.1);
      }, 100);

      // Start waveform animation
      waveformIntervalRef.current = setInterval(() => {
        setWaveformData(prev => {
          const newData = [...prev, generateWaveformBar()];
          return newData.slice(-maxBars); // Keep only the last maxBars
        });
      }, 100);

    } catch (error) {
      console.error('Failed to start recording:', error);
      Alert.alert('Error', 'Failed to start recording. Please try again.');
    }
  };

  const stopRecording = async () => {
    try {
      if (!recordingRef.current) return;

      // Immediately update UI and clear timers for responsiveness
      setIsRecording(false);
      if (durationIntervalRef.current) {
        clearInterval(durationIntervalRef.current);
        durationIntervalRef.current = null;
      }
      if (waveformIntervalRef.current) {
        clearInterval(waveformIntervalRef.current);
        waveformIntervalRef.current = null;
      }

      // Stop and unload actual recording
      await recordingRef.current.stopAndUnloadAsync();
      const uri = recordingRef.current.getURI();
      recordingRef.current = null;
      setRecordingUri(uri);

      // Probe duration precisely using a temporary sound
      try {
        const { sound } = await Audio.Sound.createAsync({ uri: uri! }, { shouldPlay: false });
        const status = await sound.getStatusAsync();
        if ('durationMillis' in status && typeof status.durationMillis === 'number') {
          setRecordedDurationMs(status.durationMillis);
          setDuration(status.durationMillis / 1000);
        }
        await sound.unloadAsync();
      } catch (e) {
        // Fallback: keep timer-based duration
      }

      // Fill remaining waveform bars with lower heights
      setWaveformData(prev => {
        const remaining = Math.max(0, maxBars - prev.length);
        const fillerBars = Array(remaining).fill(0).map(() => Math.random() * 20 + 5);
        return [...prev, ...fillerBars];
      });

    } catch (error) {
      console.error('Failed to stop recording:', error);
      Alert.alert('Error', 'Failed to stop recording.');
    }
  };

  const playRecording = async () => {
    try {
      if (!recordingUri) return;

      // Clear any previous polling (legacy)
      if (playbackIntervalRef.current) {
        clearInterval(playbackIntervalRef.current);
        playbackIntervalRef.current = null;
      }

      // If a sound instance exists, unload to ensure fresh playback
      if (soundRef.current) {
        try { await soundRef.current.unloadAsync(); } catch {}
        soundRef.current = null;
      }

      const { sound } = await Audio.Sound.createAsync(
        { uri: recordingUri },
        { shouldPlay: true },
        (status) => {
          if (!status.isLoaded) return;
          const position = status.positionMillis || 0;
          const total = (status.durationMillis ?? recordedDurationMs) || (duration * 1000) || 1;
          const progress = Math.max(0, Math.min(1, position / total));
          const barIndex = Math.floor(progress * Math.max(1, waveformData.length));
          setPlaybackPosition(position);
          setCurrentPlaybackIndex(barIndex);

          if (status.didJustFinish) {
            setIsPlaying(false);
            setIsPaused(false);
            setPlaybackPosition(0);
            setCurrentPlaybackIndex(0);
            // Leave sound loaded to allow quick replay; position is at end.
          } else {
            // While playing
            setIsPlaying(status.isPlaying ?? true);
          }
        }
      );

      soundRef.current = sound;
      setIsPlaying(true);
      setIsPaused(false);
      setPlaybackPosition(0);
      setCurrentPlaybackIndex(0);

    } catch (error) {
      console.error('Failed to play recording:', error);
      Alert.alert('Error', 'Failed to play recording.');
    }
  };

  const pauseRecording = async () => {
    try {
      if (soundRef.current) {
        await soundRef.current.pauseAsync();
        setIsPlaying(false);
        setIsPaused(true);
        if (playbackIntervalRef.current) {
          clearInterval(playbackIntervalRef.current);
          playbackIntervalRef.current = null;
        }
      }
    } catch (error) {
      console.error('Failed to pause recording:', error);
    }
  };

  const resumeRecording = async () => {
    try {
      if (soundRef.current) {
        await soundRef.current.playAsync();
        setIsPlaying(true);
        setIsPaused(false);
      }
    } catch (error) {
      console.error('Failed to resume recording:', error);
    }
  };

  const stopPlayback = async () => {
    try {
      if (soundRef.current) {
        await soundRef.current.stopAsync();
        try { await soundRef.current.setPositionAsync(0); } catch {}
        setIsPlaying(false);
        setIsPaused(false);
        setPlaybackPosition(0);
        setCurrentPlaybackIndex(0);
        if (playbackIntervalRef.current) {
          clearInterval(playbackIntervalRef.current);
          playbackIntervalRef.current = null;
        }
      }
    } catch (error) {
      console.error('Failed to stop playback:', error);
    }
  };

  const deleteRecording = () => {
    Alert.alert(
      'Delete Recording',
      'Are you sure you want to delete this recording?',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: () => {
            setRecordingUri(null);
            setDuration(0);
            setWaveformData([]);
            setPlaybackPosition(0);
            setCurrentPlaybackIndex(0);
            if (soundRef.current) {
              soundRef.current.unloadAsync();
              soundRef.current = null;
            }
          },
        },
      ]
    );
  };

  const sendRecording = () => {
    if (recordingUri && duration > 0) {
      onSendRecording(recordingUri, duration);
      onClose();
    }
  };

  const formatTime = (seconds: number): string => {
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  const handleClose = () => {
    // Stop any ongoing recording or playback
    if (isRecording) {
      stopRecording();
    }
    if (isPlaying) {
      stopPlayback();
    }
    
    // Cleanup
    if (soundRef.current) {
      soundRef.current.unloadAsync();
      soundRef.current = null;
    }
    
    onClose();
  };

  return (
    <Modal visible={visible} transparent animationType="slide">
      <View style={styles.overlay}>
        <View style={[styles.container, { backgroundColor: isDark ? '#1f2937' : '#ffffff' }]}>
          {/* Header */}
          <View style={styles.header}>
            <TouchableOpacity onPress={handleClose} style={styles.closeButton}>
              <Ionicons name="close" size={24} color={isDark ? '#ffffff' : '#000000'} />
            </TouchableOpacity>
            <Text style={[styles.title, { color: isDark ? '#ffffff' : '#000000' }]}>
              Voice Message
            </Text>
            <View style={styles.placeholder} />
          </View>

          {/* Waveform Display */}
          <View style={styles.waveformContainer}>
            <View style={styles.waveform}>
              {waveformData.map((height, index) => (
                <WaveformBar
                  key={index}
                  height={height}
                  isActive={isPlaying && index <= currentPlaybackIndex}
                  isDark={isDark}
                />
              ))}
              {waveformData.length === 0 && !isRecording && (
                <Text style={[styles.waveformPlaceholder, { color: isDark ? '#9ca3af' : '#6b7280' }]}>
                  Tap the microphone to start recording
                </Text>
              )}
            </View>
          </View>

          {/* Duration Display */}
          <View style={styles.durationContainer}>
            <Text style={[styles.duration, { color: isDark ? '#ffffff' : '#000000' }]}>
              {formatTime(duration)}
            </Text>
            {recordingUri && (
              <Text style={[styles.playbackTime, { color: isDark ? '#9ca3af' : '#6b7280' }]}>
                / {formatTime(playbackPosition / 1000)}
              </Text>
            )}
          </View>

          {/* Controls */}
          <View style={styles.controls}>
            {!recordingUri ? (
              // Recording controls
              <View style={styles.recordingControls}>
                <TouchableOpacity
                  style={[
                    styles.recordButton,
                    isRecording && styles.recordingActive,
                    { backgroundColor: isRecording ? '#ef4444' : '#ec4899' }
                  ]}
                  onPress={isRecording ? stopRecording : startRecording}
                >
                  <Ionicons 
                    name={isRecording ? "stop" : "mic"} 
                    size={32} 
                    color="white" 
                  />
                </TouchableOpacity>
                {isRecording && (
                  <Text style={[styles.recordingText, { color: isDark ? '#ef4444' : '#dc2626' }]}>
                    Recording...
                  </Text>
                )}
              </View>
            ) : (
              // Playback controls
              <View style={styles.playbackControls}>
                <TouchableOpacity
                  style={[styles.controlButton, { backgroundColor: '#ef4444' }]}
                  onPress={deleteRecording}
                >
                  <Ionicons name="trash" size={20} color="white" />
                </TouchableOpacity>

                <TouchableOpacity
                  style={[styles.controlButton, { backgroundColor: '#6366f1' }]}
                  onPress={isPlaying ? pauseRecording : (isPaused ? resumeRecording : playRecording)}
                >
                  <Ionicons 
                    name={isPlaying ? "pause" : "play"} 
                    size={20} 
                    color="white" 
                  />
                </TouchableOpacity>

                <TouchableOpacity
                  style={[styles.controlButton, { backgroundColor: '#8b5cf6' }]}
                  onPress={stopPlayback}
                >
                  <Ionicons name="stop" size={20} color="white" />
                </TouchableOpacity>

                <TouchableOpacity
                  style={[styles.sendButton, { backgroundColor: '#10b981' }]}
                  onPress={sendRecording}
                >
                  <Ionicons name="send" size={20} color="white" />
                  <Text style={styles.sendText}>Send</Text>
                </TouchableOpacity>
              </View>
            )}
          </View>
        </View>
      </View>
    </Modal>
  );
};

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
    justifyContent: 'flex-end',
  },
  container: {
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    padding: 20,
    minHeight: 300,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 30,
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
  waveformContainer: {
    alignItems: 'center',
    marginBottom: 20,
    minHeight: 60,
  },
  waveform: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    height: 60,
    gap: 2,
  },
  waveformBar: {
    width: 4,
    borderRadius: 2,
    minHeight: 4,
  },
  waveformPlaceholder: {
    fontSize: 14,
    textAlign: 'center',
  },
  durationContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 30,
  },
  duration: {
    fontSize: 24,
    fontWeight: '600',
    fontFamily: 'monospace',
  },
  playbackTime: {
    fontSize: 16,
    marginLeft: 8,
    fontFamily: 'monospace',
  },
  controls: {
    alignItems: 'center',
  },
  recordingControls: {
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
  recordingActive: {
    transform: [{ scale: 1.1 }],
  },
  recordingText: {
    marginTop: 12,
    fontSize: 16,
    fontWeight: '500',
  },
  playbackControls: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 15,
  },
  controlButton: {
    width: 50,
    height: 50,
    borderRadius: 25,
    alignItems: 'center',
    justifyContent: 'center',
    elevation: 2,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.2,
    shadowRadius: 2,
  },
  sendButton: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingVertical: 12,
    borderRadius: 25,
    elevation: 2,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.2,
    shadowRadius: 2,
  },
  sendText: {
    color: 'white',
    fontWeight: '600',
    marginLeft: 8,
  },
});
