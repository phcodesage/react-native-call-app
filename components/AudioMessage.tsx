import React, { useEffect, useMemo, useRef, useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, Animated } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Audio } from 'expo-av';

interface AudioMessageProps {
  uri?: string; // Prefer uri (data URL or http URL)
  file_url?: string; // Back-compat in case prop is passed like FileMessage
  isOutgoing: boolean;
  isDark: boolean;
  embedded?: boolean; // if true, render without outer bubble background
}

const WaveBar: React.FC<{ height: number; active: boolean; color: string; activeColor: string }> = ({ height, active, color, activeColor }) => {
  const h = useRef(new Animated.Value(height)).current;
  const o = useRef(new Animated.Value(active ? 1 : 0.45)).current;
  useEffect(() => {
    Animated.parallel([
      Animated.timing(h, { toValue: height, duration: 150, useNativeDriver: false }),
      Animated.timing(o, { toValue: active ? 1 : 0.45, duration: 150, useNativeDriver: false }),
    ]).start();
  }, [height, active]);
  return (
    <Animated.View style={[styles.waveBar, { height: h, opacity: o, backgroundColor: active ? activeColor : color }]} />
  );
};

const AudioMessage: React.FC<AudioMessageProps> = ({ uri, file_url, isOutgoing, isDark, embedded = false }) => {
  const sourceUri = (uri || file_url || '').trim();
  const [isPlaying, setIsPlaying] = useState(false);
  const [isPaused, setIsPaused] = useState(false);
  const [positionMs, setPositionMs] = useState(0);
  const [durationMs, setDurationMs] = useState(0);
  const [bars, setBars] = useState<number[]>([]);
  const [activeIndex, setActiveIndex] = useState(0);
  const soundRef = useRef<Audio.Sound | null>(null);

  // Build a pleasant, deterministic fake waveform based on uri hash so it looks stable per message
  const seededBars = useMemo(() => {
    const str = sourceUri || Math.random().toString();
    let seed = 0;
    for (let i = 0; i < str.length; i++) seed = (seed * 31 + str.charCodeAt(i)) >>> 0;
    const count = 32; // fewer bars for a cleaner compact row
    const arr: number[] = [];
    for (let i = 0; i < count; i++) {
      seed = (1103515245 * seed + 12345) % 2**31;
      const r = (seed / 2**31);
      // Height between 6 and 22 with a soft envelope
      const envelope = 0.65 + 0.35 * Math.sin((i / count) * Math.PI);
      arr.push(6 + 16 * r * envelope);
    }
    return arr;
  }, [sourceUri]);

  useEffect(() => {
    setBars(seededBars);
  }, [seededBars]);

  useEffect(() => {
    return () => {
      try { soundRef.current?.unloadAsync(); } catch {}
      soundRef.current = null;
    };
  }, []);

  const ensureSound = async () => {
    if (soundRef.current) return soundRef.current;
    if (!sourceUri) throw new Error('No audio uri');
    const { sound } = await Audio.Sound.createAsync(
      { uri: sourceUri },
      { shouldPlay: false },
      (status) => {
        if (!status.isLoaded) return;
        const pos = status.positionMillis || 0;
        const dur = (status.durationMillis || durationMs || 1);
        setPositionMs(pos);
        if (dur !== durationMs) setDurationMs(dur);
        const progress = Math.max(0, Math.min(1, pos / Math.max(1, dur)));
        setActiveIndex(Math.floor(progress * Math.max(1, bars.length)));
        if (status.didJustFinish) {
          setIsPlaying(false);
          setIsPaused(false);
          setPositionMs(0);
          setActiveIndex(0);
        }
      }
    );
    soundRef.current = sound;
    return sound;
  };

  const play = async () => {
    try {
      const s = await ensureSound();
      await s.playAsync();
      setIsPlaying(true);
      setIsPaused(false);
    } catch (e) {}
  };

  const pause = async () => {
    try {
      const s = soundRef.current;
      if (!s) return;
      await s.pauseAsync();
      setIsPlaying(false);
      setIsPaused(true);
    } catch {}
  };

  const stop = async () => {
    try {
      const s = soundRef.current;
      if (!s) return;
      await s.stopAsync();
      try { await s.setPositionAsync(0); } catch {}
      setIsPlaying(false);
      setIsPaused(false);
      setPositionMs(0);
      setActiveIndex(0);
    } catch {}
  };

  const format = (ms: number) => {
    const total = Math.floor(ms / 1000);
    const m = Math.floor(total / 60);
    const s = total % 60;
    return `${m}:${String(s).padStart(2, '0')}`;
  };

  // Colors that read well on top of chat bubbles when embedded
  const barBase = isOutgoing ? 'rgba(255,255,255,0.55)' : (isDark ? '#5ea0f6' : '#2563eb');
  const barActive = isOutgoing ? '#ffffff' : (isDark ? '#93c5fd' : '#3b82f6');

  return (
    <View
      style={[
        styles.container,
        embedded ? styles.embedded : (isOutgoing ? styles.outgoing : styles.incoming),
        !embedded && isDark && styles.containerDark,
      ]}
    >
      <View style={styles.row}>
        <TouchableOpacity
          style={[styles.roundBtn, { backgroundColor: isOutgoing ? 'rgba(255,255,255,0.2)' : (isDark ? 'rgba(255,255,255,0.08)' : '#e5e7eb') }]}
          onPress={isPlaying ? pause : play}
          activeOpacity={0.8}
        >
          <Ionicons name={isPlaying ? 'pause' : 'play'} size={16} color={isOutgoing ? '#ffffff' : (isDark ? '#e5e7eb' : '#111827')} />
        </TouchableOpacity>
        <View style={styles.waveWrap}>
          <View style={styles.waveRow}>
            {bars.map((h, i) => (
              <WaveBar key={i} height={h} active={i <= activeIndex && isPlaying} color={barBase} activeColor={barActive} />
            ))}
          </View>
        </View>
        <Text style={[styles.timeText, { color: isOutgoing ? 'rgba(255,255,255,0.9)' : (isDark ? '#d1d5db' : '#374151') }]}>
          {format(isPlaying || isPaused ? positionMs : (durationMs || 1))}
        </Text>
      </View>
    </View>
  );
};

export default AudioMessage;

const styles = StyleSheet.create({
  container: {
    padding: 10,
    borderRadius: 12,
    maxWidth: '100%',
  },
  embedded: {
    backgroundColor: 'transparent',
    padding: 0,
    maxWidth: '100%',
    width: '100%',
    flex: 1,
  },
  containerDark: {
    backgroundColor: '#374151',
  },
  outgoing: {
    backgroundColor: '#3B82F6',
    alignSelf: 'flex-end',
  },
  incoming: {
    backgroundColor: '#F3F4F6',
    alignSelf: 'flex-start',
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  roundBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    justifyContent: 'center',
    alignItems: 'center',
  },
  waveWrap: {
    flex: 1,
  },
  waveRow: {
    height: 40,
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: 2,
  },
  waveBar: {
    width: 3,
    borderRadius: 2,
    minHeight: 3,
  },
  timeText: {
    marginTop: 4,
    fontSize: 12,
    alignSelf: 'flex-end',
  },
});
