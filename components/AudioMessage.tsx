import React, { useState, useEffect, useRef } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  Dimensions,
} from 'react-native';
import { Audio } from 'expo-av';
import { Ionicons } from '@expo/vector-icons';
import { useThemeColor } from '@/hooks/useThemeColor';
// Using simple View-based waveform instead of Skia for compatibility

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
  
  const positionUpdateInterval = useRef<NodeJS.Timeout | null>(null);

  const backgroundColor = useThemeColor({}, 'background');
  const textColor = useThemeColor({}, 'text');
  const primaryColor = useThemeColor({}, 'tint');
  const bubbleColor = isOutgoing ? primaryColor : '#6b7280';

  useEffect(() => {
    // Generate mock waveform data based on duration
    const dataPoints = Math.min(50, Math.max(20, Math.floor(duration / 2)));
    const mockData = Array.from({ length: dataPoints }, () => 
      Math.random() * 0.8 + 0.2 // Values between 0.2 and 1.0
    );
    setWaveformData(mockData);

    return () => {
      if (sound) {
        sound.unloadAsync();
      }
      if (positionUpdateInterval.current) {
        clearInterval(positionUpdateInterval.current);
      }
    };
  }, [duration]);

  const loadAudio = async () => {
    try {
      if (sound) {
        await sound.unloadAsync();
      }

      // Handle both file URIs and base64 data URLs
      let audioSource;
      if (uri.startsWith('data:')) {
        // Base64 data URL from server
        audioSource = { uri };
      } else if (uri.startsWith('file://')) {
        // Local file URI
        audioSource = { uri };
      } else {
        // Assume it's a remote URL
        audioSource = { uri };
      }

      const { sound: newSound } = await Audio.Sound.createAsync(
        audioSource,
        { shouldPlay: false }
      );

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

    } catch (error) {
      console.error('Error loading audio:', error);
      console.error('Audio URI:', uri);
      // Set a fallback state to show the user there was an error
      setIsLoaded(false);
    }
  };

  const togglePlayback = async () => {
    try {
      if (!sound) {
        await loadAudio();
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
    const { width } = Dimensions.get('window');
    const maxWidth = width * 0.6; // 60% of screen width
    const canvasWidth = Math.min(200, maxWidth);
    const canvasHeight = 40;

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
                  backgroundColor: isPlayed ? 'rgba(255,255,255,0.9)' : 'rgba(255,255,255,0.3)',
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
      style={[styles.playButton, { backgroundColor: 'rgba(255,255,255,0.2)' }]}
      onPress={togglePlayback}
    >
      <Ionicons
        name={isPlaying ? 'pause' : 'play'}
        size={20}
        color="white"
      />
    </TouchableOpacity>
  );

  return (
    <View style={[
      styles.container,
      {
        alignSelf: isOutgoing ? 'flex-end' : 'flex-start',
        backgroundColor: bubbleColor,
      }
    ]}>
      <View style={styles.audioContent}>
        <PlayButton />
        
        <View style={styles.waveformContainer}>
          <WaveformPlayer />
          <Text style={styles.timeText}>
            {isPlaying ? formatTime(currentTime) : formatTime(duration * 1000)}
          </Text>
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
    maxWidth: '80%',
    marginVertical: 4,
    marginHorizontal: 12,
    borderRadius: 18,
    padding: 12,
    elevation: 2,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.2,
    shadowRadius: 2,
  },
  audioContent: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
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
