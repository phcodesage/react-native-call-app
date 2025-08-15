import { Ionicons } from '@expo/vector-icons';
import React, { useEffect, useRef } from 'react';
import {
  Animated,
  Dimensions,
  Modal,
  StyleSheet,
  Text,
  TouchableOpacity,
  Vibration,
  View,
} from 'react-native';
import { useTheme } from '@/contexts/ThemeContext';

const { width } = Dimensions.get('window');

interface IncomingCallModalProps {
  visible: boolean;
  callerName: string;
  callType: 'audio' | 'video';
  onAccept: () => void;
  onDecline: () => void;
}

export const IncomingCallModal: React.FC<IncomingCallModalProps> = ({
  visible,
  callerName,
  callType,
  onAccept,
  onDecline,
}) => {
  const { theme } = useTheme();
  const isDark = theme === 'dark';
  
  const pulseAnim = useRef(new Animated.Value(1)).current;
  const slideAnim = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (visible) {
      // Start vibration pattern
      const vibrationPattern = [0, 1000, 500, 1000, 500, 1000];
      Vibration.vibrate(vibrationPattern, true);

      // Start pulse animation
      const pulseAnimation = Animated.loop(
        Animated.sequence([
          Animated.timing(pulseAnim, {
            toValue: 1.2,
            duration: 1000,
            useNativeDriver: true,
          }),
          Animated.timing(pulseAnim, {
            toValue: 1,
            duration: 1000,
            useNativeDriver: true,
          }),
        ])
      );

      // Start slide animation
      const slideAnimation = Animated.timing(slideAnim, {
        toValue: 1,
        duration: 300,
        useNativeDriver: true,
      });

      pulseAnimation.start();
      slideAnimation.start();

      return () => {
        Vibration.cancel();
        pulseAnimation.stop();
      };
    } else {
      // Reset animations
      Animated.timing(slideAnim, {
        toValue: 0,
        duration: 200,
        useNativeDriver: true,
      }).start();
      
      pulseAnim.setValue(1);
      Vibration.cancel();
    }
  }, [visible, pulseAnim, slideAnim]);

  if (!visible) return null;

  return (
    <Modal
      visible={visible}
      transparent={true}
      animationType="none"
      statusBarTranslucent={true}
    >
      <View style={styles.overlay}>
        <Animated.View
          style={[
            styles.container,
            {
              transform: [
                {
                  translateY: slideAnim.interpolate({
                    inputRange: [0, 1],
                    outputRange: [300, 0],
                  }),
                },
              ],
            },
          ]}
        >
          {/* Background Gradient */}
          <View style={[
            styles.background,
            { backgroundColor: isDark ? '#1f2937' : '#ffffff' }
          ]}>
            {/* Header */}
            <View style={styles.header}>
              <Text style={[styles.incomingLabel, { color: isDark ? '#9ca3af' : '#6b7280' }]}>
                Incoming {callType} call
              </Text>
              <Ionicons
                name={callType === 'video' ? 'videocam' : 'call'}
                size={24}
                color="#420796"
              />
            </View>

            {/* Caller Info */}
            <View style={styles.callerInfo}>
              <Animated.View
                style={[
                  styles.avatarContainer,
                  { transform: [{ scale: pulseAnim }] }
                ]}
              >
                <View style={styles.avatar}>
                  <Text style={styles.avatarText}>
                    {callerName.charAt(0).toUpperCase()}
                  </Text>
                </View>
                
                {/* Pulse rings */}
                <Animated.View
                  style={[
                    styles.pulseRing,
                    styles.pulseRing1,
                    {
                      opacity: pulseAnim.interpolate({
                        inputRange: [1, 1.2],
                        outputRange: [0.7, 0],
                      }),
                      transform: [{ scale: pulseAnim }],
                    },
                  ]}
                />
                <Animated.View
                  style={[
                    styles.pulseRing,
                    styles.pulseRing2,
                    {
                      opacity: pulseAnim.interpolate({
                        inputRange: [1, 1.2],
                        outputRange: [0.5, 0],
                      }),
                      transform: [
                        {
                          scale: pulseAnim.interpolate({
                            inputRange: [1, 1.2],
                            outputRange: [1, 1.4],
                          }),
                        },
                      ],
                    },
                  ]}
                />
              </Animated.View>

              <Text style={[styles.callerName, { color: isDark ? '#f3f4f6' : '#1f2937' }]}>
                {callerName}
              </Text>
              <Text style={[styles.callTypeLabel, { color: isDark ? '#9ca3af' : '#6b7280' }]}>
                {callType === 'video' ? 'Video Call' : 'Voice Call'}
              </Text>
            </View>

            {/* Action Buttons */}
            <View style={styles.actions}>
              {/* Decline Button */}
              <TouchableOpacity
                style={[styles.actionButton, styles.declineButton]}
                onPress={onDecline}
                activeOpacity={0.8}
              >
                <Ionicons name="call" size={32} color="#ffffff" />
              </TouchableOpacity>

              {/* Accept Button */}
              <TouchableOpacity
                style={[styles.actionButton, styles.acceptButton]}
                onPress={onAccept}
                activeOpacity={0.8}
              >
                <Ionicons name="call" size={32} color="#ffffff" />
              </TouchableOpacity>
            </View>

            {/* Quick Actions */}
            <View style={styles.quickActions}>
              <TouchableOpacity style={styles.quickActionButton}>
                <Ionicons name="chatbubble" size={20} color={isDark ? '#9ca3af' : '#6b7280'} />
                <Text style={[styles.quickActionText, { color: isDark ? '#9ca3af' : '#6b7280' }]}>
                  Message
                </Text>
              </TouchableOpacity>
              
              <TouchableOpacity style={styles.quickActionButton}>
                <Ionicons name="person-add" size={20} color={isDark ? '#9ca3af' : '#6b7280'} />
                <Text style={[styles.quickActionText, { color: isDark ? '#9ca3af' : '#6b7280' }]}>
                  Remind me
                </Text>
              </TouchableOpacity>
            </View>
          </View>
        </Animated.View>
      </View>
    </Modal>
  );
};

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.9)',
    justifyContent: 'flex-end',
  },
  container: {
    width: '100%',
  },
  background: {
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    paddingTop: 32,
    paddingBottom: 40,
    paddingHorizontal: 24,
    minHeight: 400,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 32,
    gap: 8,
  },
  incomingLabel: {
    fontSize: 16,
    fontWeight: '500',
  },
  callerInfo: {
    alignItems: 'center',
    marginBottom: 48,
  },
  avatarContainer: {
    position: 'relative',
    marginBottom: 24,
  },
  avatar: {
    width: 120,
    height: 120,
    borderRadius: 60,
    backgroundColor: '#420796',
    justifyContent: 'center',
    alignItems: 'center',
    elevation: 8,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
  },
  avatarText: {
    fontSize: 48,
    fontWeight: '600',
    color: '#ffffff',
  },
  pulseRing: {
    position: 'absolute',
    borderWidth: 2,
    borderColor: '#420796',
    borderRadius: 100,
  },
  pulseRing1: {
    width: 140,
    height: 140,
    top: -10,
    left: -10,
  },
  pulseRing2: {
    width: 160,
    height: 160,
    top: -20,
    left: -20,
  },
  callerName: {
    fontSize: 28,
    fontWeight: '600',
    marginBottom: 4,
    textAlign: 'center',
  },
  callTypeLabel: {
    fontSize: 16,
    fontWeight: '400',
  },
  actions: {
    flexDirection: 'row',
    justifyContent: 'space-around',
    alignItems: 'center',
    marginBottom: 32,
    paddingHorizontal: 40,
  },
  actionButton: {
    width: 72,
    height: 72,
    borderRadius: 36,
    justifyContent: 'center',
    alignItems: 'center',
    elevation: 6,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.3,
    shadowRadius: 6,
  },
  declineButton: {
    backgroundColor: '#ef4444',
    transform: [{ rotate: '135deg' }],
  },
  acceptButton: {
    backgroundColor: '#10b981',
  },
  quickActions: {
    flexDirection: 'row',
    justifyContent: 'space-around',
    paddingHorizontal: 40,
  },
  quickActionButton: {
    alignItems: 'center',
    gap: 8,
    padding: 16,
  },
  quickActionText: {
    fontSize: 12,
    fontWeight: '500',
  },
});
