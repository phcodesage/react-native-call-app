import React, { useState, useRef, useEffect } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  Modal,
  StyleSheet,
  Alert,
  Switch,
  Platform,
  ActionSheetIOS,
} from 'react-native';
import { Audio } from 'expo-av';
import { Ionicons } from '@expo/vector-icons';
import { useThemeColor } from '@/hooks/useThemeColor';

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
  const [isStereo, setIsStereo] = useState(true);
  const [stereoSupported, setStereoSupported] = useState(true);
  const [selectedMic, setSelectedMic] = useState<string>('Default Microphone');
  const [sound, setSound] = useState<Audio.Sound | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);

  const durationInterval = useRef<NodeJS.Timeout | null>(null);
  const startTime = useRef<number>(0);
  const animationFrame = useRef<number | null>(null);

  const backgroundColor = useThemeColor({}, 'background');
  const textColor = useThemeColor({}, 'text');
  const primaryColor = useThemeColor({}, 'tint');
  // Avoid white button on dark theme when tint is #fff
  const primaryButtonBg = primaryColor === '#fff' ? '#7c3aed' : primaryColor;

  useEffect(() => {
    return () => {
      if (durationInterval.current) clearInterval(durationInterval.current);
      if (animationFrame.current) cancelAnimationFrame(animationFrame.current);
      unloadSoundSafe();
    };
  }, []);

  useEffect(() => {
    if (!visible) {
      cleanupMedia();
      resetRecordingUI();
    } else {
      resetRecordingUI();
    }
  }, [visible]);

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

      const tryStart = async (channels: number) => {
        const { recording: newRecording } = await Audio.Recording.createAsync({
          android: {
            extension: '.m4a',
            outputFormat: Audio.AndroidOutputFormat.MPEG_4,
            audioEncoder: Audio.AndroidAudioEncoder.AAC,
            sampleRate: 44100,
            numberOfChannels: channels,
            bitRate: 128000,
          },
          ios: {
            extension: '.m4a',
            outputFormat: Audio.IOSOutputFormat.MPEG4AAC,
            audioQuality: Audio.IOSAudioQuality.HIGH,
            sampleRate: 44100,
            numberOfChannels: channels,
            bitRate: 128000,
          },
          web: {
            mimeType: 'audio/webm',
            bitsPerSecond: 128000,
          },
        });
        return newRecording;
      };

      let channels = isStereo && stereoSupported ? 2 : 1;
      let newRecording: Audio.Recording | null = null;
      try {
        newRecording = await tryStart(channels);
      } catch (e) {
        if (channels === 2) {
          // Fallback to mono if stereo not supported
          setStereoSupported(false);
          setIsStereo(false);
          setStatus('Stereo not supported. Switched to mono.');
          channels = 1;
          newRecording = await tryStart(1);
        } else {
          throw e;
        }
      }

      if (!newRecording) throw new Error('Failed to initialize recording');

      setRecording(newRecording);
      setIsRecording(true);
      if (channels === 2) setStatus('Recording (Stereo)...'); else setStatus('Recording...');
      setWaveformData([]);

      startTime.current = Date.now();
      durationInterval.current = setInterval(updateDuration, 100) as any;

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
        await onRecordingStop(uri);
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
      cleanupMedia();
      resetRecordingUI();
      onClose();
    }
  };

  const handleDelete = () => {
    cleanupMedia();
    resetRecordingUI();
  };

  const resetRecordingUI = () => {
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

    unloadSoundSafe();
  };

  const handleClose = () => {
    if (isRecording && recording) {
      stopRecording();
    }
    cleanupMedia();
    resetRecordingUI();
    onClose();
  };

  const cleanupMedia = () => {
    try {
      if (durationInterval.current) {
        clearInterval(durationInterval.current);
        durationInterval.current = null;
      }
      if (animationFrame.current) {
        cancelAnimationFrame(animationFrame.current);
        animationFrame.current = null;
      }
      unloadSoundSafe();
    } catch (e) {
      console.warn('cleanupMedia error', e);
    }
  };

  const loadPreviewSound = async (uri: string) => {
    try {
      await unloadSoundSafe();
      const { sound: s } = await Audio.Sound.createAsync({ uri }, { shouldPlay: false });
      s.setOnPlaybackStatusUpdate((st: any) => {
        if (!st.isLoaded) return;
        if ('isPlaying' in st) setIsPlaying(!!st.isPlaying);
      });
      setSound(s);
    } catch (e) {
      console.warn('Failed to load preview sound', e);
    }
  };

  const unloadSoundSafe = async () => {
    try {
      if (sound) {
        await sound.unloadAsync();
      }
    } catch {}
    setSound(null);
    setIsPlaying(false);
  };

  const togglePlay = async () => {
    if (!sound) return;
    const status = await sound.getStatusAsync();
    if (!status.isLoaded) return;
    if (status.isPlaying) {
      await sound.pauseAsync();
    } else {
      await sound.playAsync();
    }
  };

  const onRecordingStop = async (uri: string) => {
    setRecordingUri(uri);
    setStatus('Preview your recording');
    await loadPreviewSound(uri);
  };

  const openMicPicker = () => {
    const options = ['Default (System)', 'Bottom (Primary)', 'Front (Selfie)', 'Cancel'];
    const cancelButtonIndex = options.length - 1;
    if (Platform.OS === 'ios') {
      ActionSheetIOS.showActionSheetWithOptions(
        {
          options,
          cancelButtonIndex,
          title: 'Select Microphone',
          userInterfaceStyle: 'dark',
        },
        (buttonIndex) => {
          if (buttonIndex !== cancelButtonIndex) setSelectedMic(options[buttonIndex]);
        }
      );
    } else {
      Alert.alert('Select Microphone', undefined, [
        { text: options[0], onPress: () => setSelectedMic(options[0]) },
        { text: options[1], onPress: () => setSelectedMic(options[1]) },
        { text: options[2], onPress: () => setSelectedMic(options[2]) },
        { text: 'Cancel', style: 'cancel' },
      ]);
    }
  };

  const WaveformVisualizer = () => {
    if (waveformData.length === 0) {
      return <View style={[styles.waveformContainer]} />;
    }

    return (
      <View style={[styles.waveformContainer, { flexDirection: 'row', alignItems: 'flex-end' }]}>
        {waveformData.map((value, index) => {
          const barHeight = Math.max(2, (value / 100) * 64);
          return (
            <View
              key={index}
              style={{
                width: 4,
                height: barHeight,
                backgroundColor: primaryButtonBg,
                marginRight: 2,
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
      animationType="fade"
      presentationStyle="overFullScreen"
      transparent
      onRequestClose={handleClose}
    >
      <View style={styles.modalOverlay}>
        <View style={[
          styles.card,
          {
            backgroundColor,
            borderColor: '#374151',
          },
        ]}>
          {/* Header */}
          <View style={styles.cardHeader}>
            <Text style={[styles.cardTitle, { color: textColor }]}>Audio Recorder</Text>
          </View>

          {/* Body */}
          <View style={styles.cardBody}>
            {/* Microphone select (placeholder) */}
            <View style={styles.formGroup}>
              <Text style={[styles.label, { color: textColor }]}>Select Microphone</Text>
              <TouchableOpacity onPress={openMicPicker} activeOpacity={0.85} style={[styles.selectBox, { borderColor: '#374151' }]}> 
                <Text style={{ color: textColor }} numberOfLines={1}>{selectedMic}</Text>
                <Ionicons name="chevron-down" size={18} color={textColor} />
              </TouchableOpacity>
            </View>

            {/* Stereo toggle */}
            {stereoSupported && (
              <View style={styles.inlineRow}>
                <Switch
                  value={isStereo}
                  onValueChange={setIsStereo}
                  trackColor={{ false: '#9ca3af', true: primaryButtonBg }}
                  thumbColor={isStereo ? '#ffffff' : '#f4f3f4'}
                  ios_backgroundColor="#9ca3af"
                />
                <Text style={{ color: textColor }}>Record in Stereo</Text>
              </View>
            )}

            {/* Status & duration */}
            <Text style={[styles.statusText, { color: '#9ca3af' }]}>{status}</Text>
            {(isRecording || recordingUri) && (
              <Text style={[styles.durationText, { color: textColor }]}>{formatDuration(duration)}</Text>
            )}

            {/* Audio preview */}
            {recordingUri && (
              <View style={[styles.previewBox, { backgroundColor: '#0f172a', borderColor: '#374151', flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 12 }]}
              >
                <TouchableOpacity onPress={togglePlay} style={{ paddingHorizontal: 16, paddingVertical: 10, backgroundColor: primaryButtonBg, borderRadius: 20 }}>
                  <Text style={{ color: '#fff', fontWeight: '700' }}>{isPlaying ? 'Pause' : 'Play'}</Text>
                </TouchableOpacity>
              </View>
            )}

            {/* Visualizer */}
            {(isRecording || recordingUri) && (
              <View style={[styles.visualizerBox, { backgroundColor: '#111827', borderColor: '#374151' }]}> 
                <WaveformVisualizer />
              </View>
            )}
          </View>

          {/* Primary actions */}
          <View style={styles.actionsRow}>
            {!isRecording && !recordingUri && (
              <TouchableOpacity style={[styles.primaryBtn, { backgroundColor: primaryButtonBg }]} onPress={startRecording}>
                <Text style={styles.primaryBtnText}>Start Recording</Text>
              </TouchableOpacity>
            )}
            {isRecording && (
              <TouchableOpacity style={[styles.primaryBtn, { backgroundColor: '#8b5cf6' }]} onPress={stopRecording}>
                <Text style={styles.primaryBtnText}>Stop Recording</Text>
              </TouchableOpacity>
            )}
            {recordingUri && !isRecording && (
              <TouchableOpacity style={[styles.primaryBtn, { backgroundColor: '#6b7280' }]} onPress={handleDelete}>
                <Text style={styles.primaryBtnText}>Delete Recording</Text>
              </TouchableOpacity>
            )}
          </View>

          {/* Footer */}
          <View style={[styles.footer, { borderTopColor: '#374151' }]}>
            <TouchableOpacity style={[styles.secondaryBtn]} onPress={handleClose}>
              <Text style={styles.secondaryBtnText}>Cancel</Text>
            </TouchableOpacity>
            {recordingUri && !isRecording ? (
              <TouchableOpacity style={[styles.secondaryBtn, { backgroundColor: primaryButtonBg }]} onPress={handleSend}>
                <Text style={styles.primaryBtnText}>Send</Text>
              </TouchableOpacity>
            ) : null}
          </View>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.5)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  card: {
    width: '94%',
    maxWidth: 720,
    borderRadius: 8,
    borderWidth: 1,
    overflow: 'hidden',
  },
  cardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  cardTitle: {
    fontSize: 22,
    fontWeight: '800',
  },
  iconButton: {
    padding: 6,
  },
  cardBody: {
    paddingHorizontal: 16,
    paddingBottom: 12,
    alignItems: 'center',
  },
  formGroup: {
    marginBottom: 12,
  },
  label: {
    fontSize: 12,
    fontWeight: '600',
    marginBottom: 6,
  },
  selectBox: {
    borderWidth: 1,
    borderRadius: 6,
    paddingHorizontal: 10,
    paddingVertical: 10,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    width: '100%',
  },
  inlineRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 12,
    justifyContent: 'center',
  },
  statusText: {
    textAlign: 'center',
    fontSize: 12,
    marginBottom: 8,
  },
  durationText: {
    textAlign: 'center',
    fontSize: 28,
    fontWeight: '800',
    marginBottom: 12,
  },
  previewBox: {
    height: 56,
    borderRadius: 8,
    borderWidth: 1,
    marginBottom: 12,
    width: '100%',
  },
  visualizerBox: {
    height: 120,
    borderRadius: 8,
    borderWidth: 1,
    padding: 8,
    width: '100%',
  },
  waveformContainer: {
    flex: 1,
    borderRadius: 6,
    overflow: 'hidden',
  },
  actionsRow: {
    flexDirection: 'column',
    gap: 8,
    paddingHorizontal: 16,
    paddingTop: 8,
  },
  primaryBtn: {
    width: '100%',
    paddingVertical: 14,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  primaryBtnText: {
    color: 'white',
    fontWeight: '600',
  },
  footer: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: 12,
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderTopWidth: 1,
  },
  secondaryBtn: {
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 8,
    backgroundColor: '#6b7280',
  },
  secondaryBtnText: {
    color: 'white',
    fontWeight: '600',
  },
});
