import { Ionicons } from '@expo/vector-icons';
import React, { useEffect, useRef } from 'react';
import {
  Animated,
  Dimensions,
  Modal,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
  ScrollView,
} from 'react-native';
import { BlurView } from 'expo-blur';
import { useTheme } from '@/contexts/ThemeContext';

const { width: screenWidth, height: screenHeight } = Dimensions.get('window');

export type ModalType = 'success' | 'error' | 'warning' | 'info' | 'confirm';

export interface ModalAction {
  text: string;
  onPress: () => void;
  style?: 'default' | 'cancel' | 'destructive';
  icon?: string;
}

export interface CustomModalProps {
  visible: boolean;
  type?: ModalType;
  title: string;
  message: string;
  actions?: ModalAction[];
  onClose?: () => void;
  showCloseButton?: boolean;
  animationType?: 'slide' | 'fade' | 'scale';
  backdropDismiss?: boolean;
}

export const CustomModal: React.FC<CustomModalProps> = ({
  visible,
  type = 'info',
  title,
  message,
  actions = [],
  onClose,
  showCloseButton = true,
  animationType = 'scale',
  backdropDismiss = true,
}) => {
  const { theme } = useTheme();
  const isDark = theme === 'dark';
  
  const scaleAnim = useRef(new Animated.Value(0)).current;
  const fadeAnim = useRef(new Animated.Value(0)).current;
  const slideAnim = useRef(new Animated.Value(screenHeight)).current;

  useEffect(() => {
    if (visible) {
      // Start entrance animations
      const animations = [];
      
      if (animationType === 'scale') {
        animations.push(
          Animated.spring(scaleAnim, {
            toValue: 1,
            tension: 100,
            friction: 8,
            useNativeDriver: true,
          })
        );
      } else if (animationType === 'slide') {
        animations.push(
          Animated.spring(slideAnim, {
            toValue: 0,
            tension: 100,
            friction: 8,
            useNativeDriver: true,
          })
        );
      }
      
      animations.push(
        Animated.timing(fadeAnim, {
          toValue: 1,
          duration: 300,
          useNativeDriver: true,
        })
      );

      Animated.parallel(animations).start();
    } else {
      // Reset animations
      scaleAnim.setValue(0);
      fadeAnim.setValue(0);
      slideAnim.setValue(screenHeight);
    }
  }, [visible, animationType, scaleAnim, fadeAnim, slideAnim]);

  const handleBackdropPress = () => {
    if (backdropDismiss && onClose) {
      onClose();
    }
  };

  const getTypeConfig = () => {
    switch (type) {
      case 'success':
        return {
          icon: 'checkmark-circle',
          iconColor: '#10b981',
          backgroundColor: isDark ? '#064e3b' : '#ecfdf5',
          borderColor: '#10b981',
        };
      case 'error':
        return {
          icon: 'close-circle',
          iconColor: '#ef4444',
          backgroundColor: isDark ? '#7f1d1d' : '#fef2f2',
          borderColor: '#ef4444',
        };
      case 'warning':
        return {
          icon: 'warning',
          iconColor: '#f59e0b',
          backgroundColor: isDark ? '#78350f' : '#fffbeb',
          borderColor: '#f59e0b',
        };
      case 'confirm':
        return {
          icon: 'help-circle',
          iconColor: '#3b82f6',
          backgroundColor: isDark ? '#1e3a8a' : '#eff6ff',
          borderColor: '#3b82f6',
        };
      default: // info
        return {
          icon: 'information-circle',
          iconColor: '#3b82f6',
          backgroundColor: isDark ? '#1e3a8a' : '#eff6ff',
          borderColor: '#3b82f6',
        };
    }
  };

  const typeConfig = getTypeConfig();

  const getAnimatedStyle = () => {
    if (animationType === 'slide') {
      return {
        transform: [{ translateY: slideAnim }],
      };
    } else if (animationType === 'scale') {
      return {
        transform: [{ scale: scaleAnim }],
      };
    }
    return {};
  };

  const renderActions = () => {
    if (actions.length === 0) {
      return (
        <TouchableOpacity
          style={[styles.actionButton, styles.singleActionButton]}
          onPress={onClose}
        >
          <Text style={[styles.actionButtonText, { color: '#ffffff' }]}>
            OK
          </Text>
        </TouchableOpacity>
      );
    }

    return (
      <View style={styles.actionsContainer}>
        {actions.map((action, index) => {
          const isDestructive = action.style === 'destructive';
          const isCancel = action.style === 'cancel';
          const isPrimary = action.style === 'default' || (!isDestructive && !isCancel);

          return (
            <TouchableOpacity
              key={index}
              style={[
                styles.actionButton,
                actions.length === 1 && styles.singleActionButton,
                isDestructive && styles.destructiveButton,
                isCancel && [styles.cancelButton, { 
                  backgroundColor: isDark ? '#374151' : '#f3f4f6',
                  borderColor: isDark ? '#4b5563' : '#d1d5db',
                }],
                isPrimary && styles.primaryButton,
              ]}
              onPress={action.onPress}
              activeOpacity={0.8}
            >
              {action.icon && (
                <Ionicons
                  name={action.icon as any}
                  size={18}
                  color={
                    isCancel 
                      ? (isDark ? '#f3f4f6' : '#1f2937')
                      : '#ffffff'
                  }
                  style={styles.actionIcon}
                />
              )}
              <Text
                style={[
                  styles.actionButtonText,
                  {
                    color: isCancel 
                      ? (isDark ? '#f3f4f6' : '#1f2937')
                      : '#ffffff'
                  }
                ]}
              >
                {action.text}
              </Text>
            </TouchableOpacity>
          );
        })}
      </View>
    );
  };

  if (!visible) return null;

  return (
    <Modal
      visible={visible}
      transparent={true}
      animationType="none"
      statusBarTranslucent={true}
      onRequestClose={onClose}
    >
      <TouchableOpacity
        style={styles.overlay}
        activeOpacity={1}
        onPress={handleBackdropPress}
      >
        <BlurView intensity={20} style={styles.blurOverlay}>
          <Animated.View
            style={[
              styles.container,
              getAnimatedStyle(),
              { opacity: fadeAnim }
            ]}
          >
            <TouchableOpacity activeOpacity={1} onPress={() => {}}>
              <View style={[
                styles.modal,
                { backgroundColor: isDark ? '#1f2937' : '#ffffff' }
              ]}>
                {/* Close Button */}
                {showCloseButton && onClose && (
                  <TouchableOpacity
                    style={styles.closeButton}
                    onPress={onClose}
                  >
                    <Ionicons
                      name="close"
                      size={20}
                      color={isDark ? '#9ca3af' : '#6b7280'}
                    />
                  </TouchableOpacity>
                )}

                {/* Icon */}
                <View style={[
                  styles.iconContainer,
                  { backgroundColor: typeConfig.backgroundColor }
                ]}>
                  <Ionicons
                    name={typeConfig.icon as any}
                    size={32}
                    color={typeConfig.iconColor}
                  />
                </View>

                {/* Content */}
                <View style={styles.content}>
                  <Text style={[
                    styles.title,
                    { color: isDark ? '#f3f4f6' : '#1f2937' }
                  ]}>
                    {title}
                  </Text>
                  
                  <ScrollView
                    style={styles.messageContainer}
                    showsVerticalScrollIndicator={false}
                  >
                    <Text style={[
                      styles.message,
                      { color: isDark ? '#d1d5db' : '#4b5563' }
                    ]}>
                      {message}
                    </Text>
                  </ScrollView>
                </View>

                {/* Actions */}
                {renderActions()}
              </View>
            </TouchableOpacity>
          </Animated.View>
        </BlurView>
      </TouchableOpacity>
    </Modal>
  );
};

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  blurOverlay: {
    flex: 1,
    width: '100%',
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: 'rgba(0, 0, 0, 0.4)',
  },
  container: {
    width: screenWidth * 0.85,
    maxWidth: 400,
    maxHeight: screenHeight * 0.8,
  },
  modal: {
    borderRadius: 20,
    padding: 24,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.25,
    shadowRadius: 20,
    elevation: 10,
  },
  closeButton: {
    position: 'absolute',
    top: 16,
    right: 16,
    width: 32,
    height: 32,
    borderRadius: 16,
    justifyContent: 'center',
    alignItems: 'center',
    zIndex: 1,
  },
  iconContainer: {
    width: 80,
    height: 80,
    borderRadius: 40,
    justifyContent: 'center',
    alignItems: 'center',
    alignSelf: 'center',
    marginBottom: 20,
  },
  content: {
    alignItems: 'center',
    marginBottom: 24,
  },
  title: {
    fontSize: 20,
    fontWeight: '700',
    textAlign: 'center',
    marginBottom: 12,
    marginTop: 12,
    lineHeight: 28,
  },
  messageContainer: {
    maxHeight: 200,
  },
  message: {
    fontSize: 16,
    textAlign: 'center',
    lineHeight: 24,
  },
  actionsContainer: {
    flexDirection: 'row',
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
    minHeight: 48,
  },
  singleActionButton: {
    backgroundColor: '#420796',
  },
  primaryButton: {
    backgroundColor: '#420796',
  },
  destructiveButton: {
    backgroundColor: '#ef4444',
  },
  cancelButton: {
    borderWidth: 1.5,
  },
  actionIcon: {
    marginRight: 8,
  },
  actionButtonText: {
    fontSize: 16,
    fontWeight: '600',
    textAlign: 'center',
  },
});
