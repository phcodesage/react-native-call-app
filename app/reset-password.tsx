import { useAuth } from '@/contexts/AuthContext';
import { useTheme } from '@/contexts/ThemeContext';
import { ThemeToggle } from '@/components/ThemeToggle';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import React, { useEffect, useRef, useState } from 'react';
import { ENV, getAuthUrl } from '../config/env';
import {
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

const API_BASE_URL = ENV.AUTH_BASE_URL;

export default function ResetPasswordScreen() {
  // Step 1 state
  const [username, setUsername] = useState('');
  const [email, setEmail] = useState('');
  const [isStep1Loading, setIsStep1Loading] = useState(false);
  
  // Step 2 state
  const [verificationCode, setVerificationCode] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [showNewPassword, setShowNewPassword] = useState(false);
  const [isStep2Loading, setIsStep2Loading] = useState(false);
  
  // General state
  const [currentStep, setCurrentStep] = useState(1);
  const [resetToken, setResetToken] = useState<string | null>(null);
  const [timeRemaining, setTimeRemaining] = useState(15 * 60); // 15 minutes in seconds
  const [timerActive, setTimerActive] = useState(false);
  
  const router = useRouter();
  const { theme } = useTheme();
  const isDark = theme === 'dark';
  const { isAuthenticated, isLoading: authLoading } = useAuth();
  const timerRef = useRef<number | null>(null);

  // Redirect if already authenticated
  useEffect(() => {
    if (isAuthenticated && !authLoading) {
      router.replace('/(tabs)');
    }
  }, [isAuthenticated, authLoading]);

  // Timer effect
  useEffect(() => {
    if (timerActive && timeRemaining > 0) {
      timerRef.current = setTimeout(() => {
        setTimeRemaining(prev => prev - 1);
      }, 1000);
    } else if (timeRemaining === 0) {
      setTimerActive(false);
      Alert.alert(
        'Code Expired',
        'The verification code has expired. Please request a new one.',
        [{ text: 'OK', onPress: () => handleBackToStep1() }]
      );
    }

    return () => {
      if (timerRef.current) {
        clearTimeout(timerRef.current);
      }
    };
  }, [timerActive, timeRemaining]);

  const formatTime = (seconds: number) => {
    const minutes = Math.floor(seconds / 60);
    const remainingSeconds = seconds % 60;
    return `${minutes.toString().padStart(2, '0')}:${remainingSeconds.toString().padStart(2, '0')}`;
  };

  const startTimer = () => {
    setTimeRemaining(15 * 60);
    setTimerActive(true);
  };

  const stopTimer = () => {
    setTimerActive(false);
    if (timerRef.current) {
      clearTimeout(timerRef.current);
    }
  };

  const handleBackToStep1 = () => {
    setCurrentStep(1);
    setResetToken(null);
    setVerificationCode('');
    setNewPassword('');
    stopTimer();
  };

  const handleBackToLogin = () => {
    router.replace('/login');
  };

  const validateStep1 = () => {
    if (!username.trim()) {
      Alert.alert('Error', 'Please enter your username');
      return false;
    }
    if (!email.trim()) {
      Alert.alert('Error', 'Please enter your email address');
      return false;
    }
    if (!/\S+@\S+\.\S+/.test(email)) {
      Alert.alert('Error', 'Please enter a valid email address');
      return false;
    }
    return true;
  };

  const validateStep2 = () => {
    if (!verificationCode.trim() || verificationCode.length !== 6) {
      Alert.alert('Error', 'Please enter the 6-digit verification code');
      return false;
    }
    if (!newPassword || newPassword.length < 6) {
      Alert.alert('Error', 'Password must be at least 6 characters long');
      return false;
    }
    if (!resetToken) {
      Alert.alert('Error', 'Invalid session. Please start over.');
      handleBackToStep1();
      return false;
    }
    return true;
  };

  const handleRequestReset = async () => {
    if (!validateStep1()) return;

    setIsStep1Loading(true);

    try {
      const response = await fetch(`${API_BASE_URL}/api/request-password-reset`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          username: username.trim(),
          email: email.trim(),
        }),
      });

      const contentType = response.headers.get('content-type');
      
      if (response.ok) {
        if (contentType && contentType.includes('application/json')) {
          const data = await response.json();
          if (data.success && data.token) {
            setResetToken(data.token);
            setCurrentStep(2);
            startTimer();
            Alert.alert(
              'Success',
              'Verification code sent successfully! Check your email.',
              [{ text: 'OK' }]
            );
          } else {
            const errorMsg = data.error || data.msg || 'Failed to send verification code';
            Alert.alert('Request Failed', errorMsg);
          }
        } else {
          Alert.alert('Request Failed', 'Server returned an invalid response');
        }
      } else {
        try {
          if (contentType && contentType.includes('application/json')) {
            const data = await response.json();
            const errorMsg = data.error || data.msg || 'Failed to send verification code';
            Alert.alert('Request Failed', errorMsg);
          } else {
            Alert.alert('Request Failed', `Server error: ${response.status}`);
          }
        } catch {
          Alert.alert('Request Failed', `Server error: ${response.status}`);
        }
      }
    } catch (error) {
      console.error('Request reset error:', error);
      Alert.alert('Error', 'Network error. Please check your connection and try again.');
    } finally {
      setIsStep1Loading(false);
    }
  };

  const handleResetPassword = async () => {
    if (!validateStep2()) return;

    setIsStep2Loading(true);

    try {
      const response = await fetch(`${API_BASE_URL}/api/verify-reset-code`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          token: resetToken,
          code: verificationCode.trim(),
          newPassword: newPassword,
        }),
      });

      const contentType = response.headers.get('content-type');
      
      if (response.ok) {
        if (contentType && contentType.includes('application/json')) {
          const data = await response.json();
          if (data.success) {
            stopTimer();
            Alert.alert(
              'Success',
              'Password reset successfully! You can now log in with your new password.',
              [
                {
                  text: 'Go to Login',
                  onPress: () => router.replace('/login'),
                },
              ]
            );
          } else {
            const errorMsg = data.error || data.msg || 'Failed to reset password';
            Alert.alert('Reset Failed', errorMsg);
          }
        } else {
          // Response is not JSON but status is OK, assume success
          stopTimer();
          Alert.alert(
            'Success',
            'Password reset successfully! You can now log in with your new password.',
            [
              {
                text: 'Go to Login',
                onPress: () => router.replace('/login'),
              },
            ]
          );
        }
      } else {
        try {
          if (contentType && contentType.includes('application/json')) {
            const data = await response.json();
            const errorMsg = data.error || data.msg || 'Failed to reset password';
            Alert.alert('Reset Failed', errorMsg);
            
            // If token expired or too many attempts, go back to step 1
            if (response.status === 429 || errorMsg.includes('expired')) {
              setTimeout(() => {
                handleBackToStep1();
              }, 2000);
            }
          } else {
            Alert.alert('Reset Failed', `Server error: ${response.status}`);
            if (response.status === 429) {
              setTimeout(() => {
                handleBackToStep1();
              }, 2000);
            }
          }
        } catch {
          Alert.alert('Reset Failed', `Server error: ${response.status}`);
        }
      }
    } catch (error) {
      console.error('Reset password error:', error);
      Alert.alert('Error', 'Network error. Please check your connection and try again.');
    } finally {
      setIsStep2Loading(false);
    }
  };

  const handleCodeChange = (text: string) => {
    // Only allow numbers and limit to 6 digits
    const numericText = text.replace(/\D/g, '').slice(0, 6);
    setVerificationCode(numericText);
  };

  if (authLoading) {
    return (
      <SafeAreaView style={[styles.container, styles.centerContent, { backgroundColor: isDark ? '#1f2937' : '#ffffff' }]}>
        <ActivityIndicator size="large" color="#420796" />
        <Text style={[styles.loadingText, { color: isDark ? '#ffffff' : '#1f2937' }]}>
          Loading...
        </Text>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: isDark ? '#1f2937' : '#ffffff' }]}>
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        style={styles.keyboardAvoidingView}
        keyboardVerticalOffset={Platform.OS === 'ios' ? 0 : 20}
      >
        <ScrollView 
          contentContainerStyle={styles.scrollContent} 
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
          bounces={false}
        >
          {/* Header */}
          <View style={styles.header}>
            <TouchableOpacity style={styles.backButton} onPress={handleBackToLogin}>
              <Ionicons 
                name="arrow-back" 
                size={24} 
                color={isDark ? '#ffffff' : '#1f2937'} 
              />
            </TouchableOpacity>
            <Text style={[styles.title, { color: isDark ? '#ffffff' : '#1f2937' }]}>
              Reset Password
            </Text>
            <ThemeToggle />
          </View>

          {/* Step 1: Request Reset Code */}
          {currentStep === 1 && (
            <View style={styles.stepContainer}>
              {/* Icon and Description */}
              <View style={styles.iconContainer}>
                <View style={[styles.iconCircle, { backgroundColor: isDark ? '#1e40af' : '#dbeafe' }]}>
                  <Ionicons 
                    name="mail-outline" 
                    size={24} 
                    color={isDark ? '#60a5fa' : '#2563eb'} 
                  />
                </View>
                <Text style={[styles.stepDescription, { color: isDark ? '#9ca3af' : '#6b7280' }]}>
                  Enter your username and email to receive a verification code
                </Text>
              </View>

              {/* Form */}
              <View style={styles.form}>
                <View style={styles.inputGroup}>
                  <Text style={[styles.label, { color: isDark ? '#d1d5db' : '#374151' }]}>
                    Username
                  </Text>
                  <View style={[
                    styles.inputContainer,
                    { 
                      backgroundColor: isDark ? '#374151' : '#f9fafb',
                      borderColor: isDark ? '#4b5563' : '#d1d5db'
                    }
                  ]}>
                    <Ionicons 
                      name="person-outline" 
                      size={20} 
                      color={isDark ? '#9ca3af' : '#6b7280'} 
                      style={styles.inputIcon}
                    />
                    <TextInput
                      style={[styles.input, { color: isDark ? '#ffffff' : '#1f2937' }]}
                      placeholder="Enter your username"
                      placeholderTextColor={isDark ? '#9ca3af' : '#6b7280'}
                      value={username}
                      onChangeText={setUsername}
                      autoCapitalize="none"
                      autoCorrect={false}
                      autoFocus
                    />
                  </View>
                </View>

                <View style={styles.inputGroup}>
                  <Text style={[styles.label, { color: isDark ? '#d1d5db' : '#374151' }]}>
                    Email Address
                  </Text>
                  <View style={[
                    styles.inputContainer,
                    { 
                      backgroundColor: isDark ? '#374151' : '#f9fafb',
                      borderColor: isDark ? '#4b5563' : '#d1d5db'
                    }
                  ]}>
                    <Ionicons 
                      name="mail-outline" 
                      size={20} 
                      color={isDark ? '#9ca3af' : '#6b7280'} 
                      style={styles.inputIcon}
                    />
                    <TextInput
                      style={[styles.input, { color: isDark ? '#ffffff' : '#1f2937' }]}
                      placeholder="Enter your email"
                      placeholderTextColor={isDark ? '#9ca3af' : '#6b7280'}
                      value={email}
                      onChangeText={setEmail}
                      autoCapitalize="none"
                      autoCorrect={false}
                      keyboardType="email-address"
                    />
                  </View>
                </View>

                <TouchableOpacity
                  style={[styles.primaryButton, { opacity: isStep1Loading ? 0.7 : 1 }]}
                  onPress={handleRequestReset}
                  disabled={isStep1Loading}
                >
                  {isStep1Loading ? (
                    <ActivityIndicator size="small" color="#ffffff" />
                  ) : (
                    <Text style={styles.primaryButtonText}>Send Verification Code</Text>
                  )}
                </TouchableOpacity>
              </View>
            </View>
          )}

          {/* Step 2: Verify Code and Reset Password */}
          {currentStep === 2 && (
            <View style={styles.stepContainer}>
              {/* Icon and Description */}
              <View style={styles.iconContainer}>
                <View style={[styles.iconCircle, { backgroundColor: isDark ? '#065f46' : '#d1fae5' }]}>
                  <Ionicons 
                    name="checkmark-circle-outline" 
                    size={24} 
                    color={isDark ? '#34d399' : '#059669'} 
                  />
                </View>
                <Text style={[styles.stepDescription, { color: isDark ? '#9ca3af' : '#6b7280' }]}>
                  Enter the 6-digit code sent to your email
                </Text>
                <Text style={[styles.emailDisplay, { color: isDark ? '#60a5fa' : '#2563eb' }]}>
                  Code sent to: {email}
                </Text>
              </View>

              {/* Form */}
              <View style={styles.form}>
                <View style={styles.inputGroup}>
                  <Text style={[styles.label, { color: isDark ? '#d1d5db' : '#374151' }]}>
                    Verification Code
                  </Text>
                  <View style={styles.codeInputContainer}>
                    <TextInput
                      style={[
                        styles.codeInput,
                        { 
                          color: isDark ? '#ffffff' : '#1f2937',
                          backgroundColor: isDark ? '#374151' : '#f9fafb',
                          borderColor: isDark ? '#4b5563' : '#d1d5db'
                        }
                      ]}
                      placeholder="000000"
                      placeholderTextColor={isDark ? '#9ca3af' : '#6b7280'}
                      value={verificationCode}
                      onChangeText={handleCodeChange}
                      keyboardType="numeric"
                      maxLength={6}
                      autoFocus
                    />
                  </View>
                </View>

                <View style={styles.inputGroup}>
                  <Text style={[styles.label, { color: isDark ? '#d1d5db' : '#374151' }]}>
                    New Password
                  </Text>
                  <View style={[
                    styles.inputContainer,
                    { 
                      backgroundColor: isDark ? '#374151' : '#f9fafb',
                      borderColor: isDark ? '#4b5563' : '#d1d5db'
                    }
                  ]}>
                    <Ionicons 
                      name="lock-closed-outline" 
                      size={20} 
                      color={isDark ? '#9ca3af' : '#6b7280'} 
                      style={styles.inputIcon}
                    />
                    <TextInput
                      style={[styles.input, { color: isDark ? '#ffffff' : '#1f2937' }]}
                      placeholder="New password (min 6 characters)"
                      placeholderTextColor={isDark ? '#9ca3af' : '#6b7280'}
                      value={newPassword}
                      onChangeText={setNewPassword}
                      secureTextEntry={!showNewPassword}
                      autoCapitalize="none"
                      autoCorrect={false}
                    />
                    <TouchableOpacity
                      style={styles.eyeButton}
                      onPress={() => setShowNewPassword(!showNewPassword)}
                    >
                      <Ionicons 
                        name={showNewPassword ? "eye-off-outline" : "eye-outline"} 
                        size={20} 
                        color={isDark ? '#9ca3af' : '#6b7280'} 
                      />
                    </TouchableOpacity>
                  </View>
                </View>

                <TouchableOpacity
                  style={[styles.successButton, { opacity: isStep2Loading ? 0.7 : 1 }]}
                  onPress={handleResetPassword}
                  disabled={isStep2Loading}
                >
                  {isStep2Loading ? (
                    <ActivityIndicator size="small" color="#ffffff" />
                  ) : (
                    <Text style={styles.successButtonText}>Reset Password</Text>
                  )}
                </TouchableOpacity>

                {/* Timer Display */}
                {timerActive && (
                  <View style={styles.timerContainer}>
                    <Text style={[styles.timerText, { color: isDark ? '#9ca3af' : '#6b7280' }]}>
                      Code expires in: <Text style={styles.timerValue}>{formatTime(timeRemaining)}</Text>
                    </Text>
                  </View>
                )}

                {/* Back Button */}
                <TouchableOpacity style={styles.backToStep1Button} onPress={handleBackToStep1}>
                  <Text style={[styles.backToStep1Text, { color: isDark ? '#60a5fa' : '#2563eb' }]}>
                    ← Back to email verification
                  </Text>
                </TouchableOpacity>
              </View>
            </View>
          )}

          {/* Back to Login Link */}
          <View style={styles.loginLinkContainer}>
            <TouchableOpacity onPress={handleBackToLogin}>
              <Text style={[styles.loginLink, { color: isDark ? '#60a5fa' : '#2563eb' }]}>
                Back to Login
              </Text>
            </TouchableOpacity>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  centerContent: {
    justifyContent: 'center',
    alignItems: 'center',
  },
  loadingText: {
    marginTop: 16,
    fontSize: 16,
  },
  keyboardAvoidingView: {
    flex: 1,
  },
  scrollContent: {
    flexGrow: 1,
    paddingHorizontal: 24,
    paddingVertical: 20,
    justifyContent: 'space-between',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 32,
  },
  backButton: {
    padding: 8,
  },
  title: {
    fontSize: 20,
    fontWeight: '600',
  },
  placeholder: {
    width: 40,
  },
  stepContainer: {
    flex: 1,
  },
  iconContainer: {
    alignItems: 'center',
    marginBottom: 32,
  },
  iconCircle: {
    width: 48,
    height: 48,
    borderRadius: 24,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 12,
  },
  stepDescription: {
    fontSize: 14,
    textAlign: 'center',
    marginBottom: 4,
  },
  emailDisplay: {
    fontSize: 12,
    textAlign: 'center',
  },
  form: {
    flex: 1,
  },
  inputGroup: {
    marginBottom: 20,
  },
  label: {
    fontSize: 14,
    fontWeight: '500',
    marginBottom: 8,
  },
  inputContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  inputIcon: {
    marginRight: 12,
  },
  input: {
    flex: 1,
    fontSize: 16,
    paddingVertical: 4,
  },
  eyeButton: {
    padding: 4,
  },
  codeInputContainer: {
    alignItems: 'center',
  },
  codeInput: {
    width: 120,
    paddingHorizontal: 16,
    paddingVertical: 12,
    fontSize: 24,
    fontFamily: 'monospace',
    textAlign: 'center',
    borderWidth: 1,
    borderRadius: 12,
    letterSpacing: 8,
  },
  primaryButton: {
    backgroundColor: '#420796',
    borderRadius: 12,
    paddingVertical: 16,
    alignItems: 'center',
    marginTop: 8,
  },
  primaryButtonText: {
    color: '#ffffff',
    fontSize: 16,
    fontWeight: '600',
  },
  successButton: {
    backgroundColor: '#059669',
    borderRadius: 12,
    paddingVertical: 16,
    alignItems: 'center',
    marginTop: 8,
  },
  successButtonText: {
    color: '#ffffff',
    fontSize: 16,
    fontWeight: '600',
  },
  timerContainer: {
    alignItems: 'center',
    marginTop: 16,
  },
  timerText: {
    fontSize: 14,
  },
  timerValue: {
    fontFamily: 'monospace',
    fontWeight: 'bold',
  },
  backToStep1Button: {
    alignItems: 'center',
    marginTop: 16,
  },
  backToStep1Text: {
    fontSize: 14,
    fontWeight: '500',
  },
  loginLinkContainer: {
    alignItems: 'center',
    marginTop: 24,
  },
  loginLink: {
    fontSize: 14,
    fontWeight: '500',
  },
});
