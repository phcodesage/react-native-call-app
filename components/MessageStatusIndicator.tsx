import React from 'react';
import { View, StyleSheet, Text } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '@/contexts/ThemeContext';

interface MessageStatusIndicatorProps {
  status?: string;
  isOutgoing: boolean;
  size?: number;
  showText?: boolean;
}

export const MessageStatusIndicator: React.FC<MessageStatusIndicatorProps> = ({
  status,
  isOutgoing,
  size = 12,
  showText = false,
}) => {
  const { theme } = useTheme();
  const isDark = theme === 'dark';

  // Debug logging
  console.log('[MessageStatusIndicator] Rendering with props:', { status, isOutgoing, size, showText });

  // Only show status for outgoing messages
  if (!isOutgoing || !status) {
    console.log('[MessageStatusIndicator] Not rendering - isOutgoing:', isOutgoing, 'status:', status);
    return null;
  }

  const getStatusText = () => {
    switch (status) {
      case 'sent':
        return 'Sent';
      case 'delivered':
        return 'Delivered';
      case 'seen':
        return 'Seen';
      default:
        return '';
    }
  };

  const getStatusIcon = () => {
    switch (status) {
      case 'sent':
        return (
          <Ionicons
            name="checkmark"
            size={size}
            color={isDark ? '#8E8E93' : '#8E8E93'}
          />
        );
      case 'delivered':
        return (
          <View style={styles.doubleCheck}>
            <Ionicons
              name="checkmark"
              size={size}
              color={isDark ? '#8E8E93' : '#8E8E93'}
              style={[styles.checkmark, styles.firstCheck]}
            />
            <Ionicons
              name="checkmark"
              size={size}
              color={isDark ? '#8E8E93' : '#8E8E93'}
              style={[styles.checkmark, styles.secondCheck]}
            />
          </View>
        );
      case 'seen':
        return (
          <View style={styles.doubleCheck}>
            <Ionicons
              name="checkmark"
              size={size}
              color="#34C759" // Blue/green for seen
              style={[styles.checkmark, styles.firstCheck]}
            />
            <Ionicons
              name="checkmark"
              size={size}
              color="#34C759" // Blue/green for seen
              style={[styles.checkmark, styles.secondCheck]}
            />
          </View>
        );
      default:
        return null;
    }
  };

  return (
    <View style={styles.container}>
      {getStatusIcon()}
      {showText && (
        <Text style={[styles.statusText, { color: isDark ? '#8E8E93' : '#6B7280' }]}>
          {getStatusText()}
        </Text>
      )}
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    marginLeft: 4,
    justifyContent: 'center',
    alignItems: 'center',
  },
  statusText: {
    fontSize: 10,
    marginTop: 2,
    textAlign: 'center',
  },
  doubleCheck: {
    flexDirection: 'row',
    position: 'relative',
    width: 16,
    height: 12,
  },
  checkmark: {
    position: 'absolute',
  },
  firstCheck: {
    left: 0,
  },
  secondCheck: {
    left: 4,
  },
});

export default MessageStatusIndicator;
