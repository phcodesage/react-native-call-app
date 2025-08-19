import React, { useState, useEffect, useRef } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  Dimensions,
  ActivityIndicator,
  Platform,
} from 'react-native';
import { Audio } from 'expo-av';
import * as FileSystem from 'expo-file-system';
import { Ionicons } from '@expo/vector-icons';
import { useThemeColor } from '@/hooks/useThemeColor';
// Using simple View-based waveform instead of Skia for compatibility

// Native waveform (Android/iOS). We'll use on Android only for now.
import { Waveform } from '@simform_solutions/react-native-audio-waveform';

interface AudioMessageProps {
  uri: string;
  duration: number;
  isOutgoing: boolean;
  timestamp: number;
  onReaction?: (emoji: string) => void;
}

export default function AudioMessage({ 
  uri, 
  duration, 
  isOutgoing, 
  timestamp,
  onReaction 
}: AudioMessageProps) {
  const [sound, setSound] = useState<Audio.Sound | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [isLoaded, setIsLoaded] = useState(false);
  const [waveformData, setWaveformData] = useState<number[]>([]);
  const [tempFileUri, setTempFileUri] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [waveformWidth, setWaveformWidth] = useState<number>(0);
  
  const positionUpdateInterval = useRef<NodeJS.Timeout | null>(null);

  const primaryColor = useThemeColor({}, 'tint');

  useEffect(() => {
    // Generate mock waveform data based on duration
    const dataPoints = Math.min(50, Math.max(20, Math.floor(duration / 2)));
    const mockData = Array.from({ length: dataPoints }, () => 
      Math.random() * 0.8 + 0.2 // Values between 0.2 and 1.0
    );
    setWaveformData(mockData);

    // If URI is base64 data, proactively write a temp file so native waveform can render immediately
    (async () => {
      try {
        if (uri && uri.startsWith('data:')) {
          const mimeMatch = uri.match(/^data:(.*?);/);
          const mime = (mimeMatch && mimeMatch[1]) ? mimeMatch[1] : 'audio/m4a';
          const base64 = uri.includes('base64,') ? uri.split('base64,').pop() : null;
          if (!base64 || base64.trim().length === 0) return;
          const ext = mime.includes('wav') ? 'wav' : mime.includes('mp3') ? 'mp3' : mime.includes('aac') ? 'aac' : mime.includes('mpeg') ? 'mp3' : mime.includes('x-m4a') || mime.includes('m4a') ? 'm4a' : 'caf';
          const fileName = `audio_${Date.now()}.${ext}`;
          const fileUri = `${FileSystem.cacheDirectory}${fileName}`;
          await FileSystem.writeAsStringAsync(fileUri, base64, { encoding: FileSystem.EncodingType.Base64 });
          setTempFileUri(fileUri);
        }
      } catch {}
    })();

    return () => {
      if (sound) {
        sound.unloadAsync();
      }
      if (positionUpdateInterval.current) {
        clearInterval(positionUpdateInterval.current);
      }
      if (tempFileUri) {
        // Best-effort cleanup of temp file
        FileSystem.deleteAsync(tempFileUri, { idempotent: true }).catch(() => {});
      }
    };
  }, [duration]);

  const loadAudio = async (): Promise<Audio.Sound | null> => {
    try {
      setError(null);
      if (!uri || uri.trim().length === 0) {
        console.warn('AudioMessage: empty URI, skipping load');
        setIsLoaded(false);
        return null;
      }
      if (sound) {
        await sound.unloadAsync();
      }

      // Handle both file URIs and base64 data URLs
      let audioSource;
      if (uri.startsWith('data:')) {
        // Base64 data URL from server -> write to a temp file for reliable playback
        // Example: data:audio/m4a;base64,AAAA...
        // Sanitize nested data: prefixes and extract mime/base64 robustly
        const mimeMatch = uri.match(/^data:(.*?);/);
        const mime = (mimeMatch && mimeMatch[1]) ? mimeMatch[1] : 'audio/m4a';
        const base64 = uri.includes('base64,') ? uri.split('base64,').pop() : null;
        if (!base64 || base64.trim().length === 0) throw new Error('Invalid data URI');
        const ext = mime.includes('wav') ? 'wav' : mime.includes('mp3') ? 'mp3' : mime.includes('aac') ? 'aac' : mime.includes('mpeg') ? 'mp3' : mime.includes('x-m4a') || mime.includes('m4a') ? 'm4a' : 'caf';
        const fileName = `audio_${Date.now()}.${ext}`;
        const fileUri = `${FileSystem.cacheDirectory}${fileName}`;
        await FileSystem.writeAsStringAsync(fileUri, base64, { encoding: FileSystem.EncodingType.Base64 });
        setTempFileUri(fileUri);
        audioSource = { uri: fileUri };
      } else if (uri.startsWith('file://')) {
        // Local file URI
        audioSource = { uri };
      } else {
        // Assume it's a remote URL
        audioSource = { uri };
      }

      const { sound: newSound } = await Audio.Sound.createAsync(audioSource, { shouldPlay: false });

      setSound(newSound);
      setIsLoaded(true);

      newSound.setOnPlaybackStatusUpdate((status) => {
        if (status.isLoaded) {
          setCurrentTime(status.positionMillis || 0);
          
          if (status.didJustFinish) {
            setIsPlaying(false);
            setCurrentTime(0);
            if (positionUpdateInterval.current) {
              clearInterval(positionUpdateInterval.current);
            }
          }
        }
      });

      return newSound;
    } catch (error) {
      console.error('Error loading audio:', error);
      // Set a fallback state to show the user there was an error
      setIsLoaded(false);
      setError('Failed to load audio');
      return null;
    }
  };

  const togglePlayback = async () => {
    try {
      if (!uri || uri.trim().length === 0) {
        console.warn('AudioMessage: cannot play, empty URI');
        return;
      }
      if (!sound) {
        setIsLoading(true);
        const created = await loadAudio();
        setIsLoading(false);
        if (created) {
          await created.playAsync();
          setIsPlaying(true);
        }
        return;
      }

      if (isPlaying) {
        await sound.pauseAsync();
        setIsPlaying(false);
        if (positionUpdateInterval.current) {
          clearInterval(positionUpdateInterval.current);
        }
      } else {
        await sound.playAsync();
        setIsPlaying(true);
      }
    } catch (error) {
      console.error('Error toggling playback:', error);
      setError('Playback error');
      setIsLoading(false);
    }
  };

  const seekToPosition = async (progress: number) => {
    if (!sound || !isLoaded) return;

    try {
      const position = progress * duration * 1000; // Convert to milliseconds
      await sound.setPositionAsync(position);
      setCurrentTime(position);
    } catch (error) {
      console.error('Error seeking:', error);
    }
  };

  const formatTime = (milliseconds: number) => {
    const seconds = Math.floor(milliseconds / 1000);
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  const WaveformPlayer = () => {
    const { width: screenWidth } = Dimensions.get('window');
    // Use measured width from container; fallback to 60% of screen if not measured yet
    const fallbackWidth = screenWidth * 0.6;
    const canvasWidth = Math.max(120, waveformWidth || fallbackWidth);
    const canvasHeight = 48;

    // Prefer native waveform on Android when we have a local path
    const localPath = tempFileUri || (uri?.startsWith('file://') ? uri : null);
    if (Platform.OS === 'android' && localPath) {
      return (
        <View style={{ width: canvasWidth, height: canvasHeight }}>
          <Waveform
            mode="static"
            path={localPath}
            candleSpace={2}
            candleWidth={3}
            scrubColor="white"
          />
        </View>
      );
    }

    if (waveformData.length === 0) {
      return <View style={{ width: canvasWidth, height: canvasHeight }} />;
    }

    const progress = duration > 0 ? (currentTime / 1000) / duration : 0;
    const progressIndex = Math.floor(progress * waveformData.length);
    const barWidth = canvasWidth / waveformData.length;
    const maxBarHeight = canvasHeight - 4;

    const handleWaveformPress = (event: any) => {
      const { locationX } = event.nativeEvent;
      const progress = locationX / canvasWidth;
      seekToPosition(Math.max(0, Math.min(1, progress)));
    };

    return (
      <TouchableOpacity onPress={handleWaveformPress} activeOpacity={0.8}>
        <View style={{ width: canvasWidth, height: canvasHeight, flexDirection: 'row', alignItems: 'center' }}>
          {waveformData.map((value, index) => {
            const barHeight = value * maxBarHeight;
            const isPlayed = index < progressIndex;
            
            return (
              <View
                key={index}
                style={{
                  width: barWidth - 1,
                  height: barHeight,
                  // Use strong contrast since parent bubble is dark
                  backgroundColor: isPlayed ? 'rgba(255,255,255,0.95)' : 'rgba(255,255,255,0.5)',
                  marginRight: 1,
                  borderRadius: 1,
                }}
              />
            );
          })}
        </View>
      </TouchableOpacity>
    );
  };

  const PlayButton = () => (
    <TouchableOpacity
      style={[styles.playButton, { backgroundColor: 'rgba(255,255,255,0.25)' }]}
      onPress={togglePlayback}
      disabled={isLoading || !uri}
    >
      {isLoading ? (
        <ActivityIndicator size="small" color="#fff" />
      ) : (
        <Ionicons
          name={isPlaying ? 'pause' : 'play'}
          size={20}
          color="white"
        />
      )}
    </TouchableOpacity>
  );

  return (
    <View style={styles.container}>
      <View style={styles.audioContent}>
        <PlayButton />
        
        <View
          style={styles.waveformContainer}
          onLayout={(e) => setWaveformWidth(e.nativeEvent.layout.width)}
        >
          <WaveformPlayer />
          <Text style={styles.timeText}>
            {isPlaying ? formatTime(currentTime) : formatTime(duration * 1000)}
          </Text>
          {error ? (
            <Text style={styles.errorText}>Tap to retry</Text>
          ) : null}
        </View>
      </View>

      {onReaction && (
        <TouchableOpacity
          style={styles.reactionButton}
          onPress={() => onReaction('👍')}
        >
          <Ionicons name="heart-outline" size={16} color="rgba(255,255,255,0.7)" />
        </TouchableOpacity>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    maxWidth: '100%',
    marginVertical: 4,
    marginHorizontal: 0,
    borderRadius: 0,
    padding: 0,
    // No shadow here; parent bubble already has elevation/shadow
  },
  audioContent: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    minHeight: 48,
  },
  playButton: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
  },
  waveformContainer: {
    flex: 1,
    alignItems: 'center',
    gap: 4,
  },
  timeText: {
    color: 'rgba(255,255,255,0.9)',
    fontSize: 12,
    fontWeight: '600',
    letterSpacing: 0.5,
  },
  errorText: {
    color: 'rgba(255,255,255,0.8)',
    fontSize: 10,
    marginTop: 2,
  },
  reactionButton: {
    position: 'absolute',
    top: -8,
    right: -8,
    width: 24,
    height: 24,
    borderRadius: 12,
    backgroundColor: 'rgba(0,0,0,0.3)',
    alignItems: 'center',
    justifyContent: 'center',
  },
});
