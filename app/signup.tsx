import React, { useState, useEffect } from 'react';
import {
  StyleSheet,
  View,
  Text,
  TextInput,
  TouchableOpacity,
  Alert,
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { ENV, getAuthUrl } from '../config/env';
import { useAuth } from '@/contexts/AuthContext';
import { useTheme } from '@/contexts/ThemeContext';
import { ThemeToggle } from '@/components/ThemeToggle';

const API_BASE_URL = ENV.AUTH_BASE_URL;

export default function SignupScreen() {
  const [username, setUsername] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  
  const router = useRouter();
  const { theme } = useTheme();
  const isDark = theme === 'dark';
  const { login, isAuthenticated, isLoading: authLoading } = useAuth();

  // Redirect if already authenticated
  useEffect(() => {
    if (isAuthenticated && !authLoading) {
      router.replace('/(tabs)');
    }
  }, [isAuthenticated, authLoading]);

  const validateInputs = () => {
    if (!username.trim()) {
      Alert.alert('Error', 'Please enter a username');
      return false;
    }
    if (username.trim().length < 3) {
      Alert.alert('Error', 'Username must be at least 3 characters long');
      return false;
    }
    if (!email.trim()) {
      Alert.alert('Error', 'Please enter an email address');
      return false;
    }
    if (!/\S+@\S+\.\S+/.test(email)) {
      Alert.alert('Error', 'Please enter a valid email address');
      return false;
    }
    if (!password) {
      Alert.alert('Error', 'Please enter a password');
      return false;
    }
    if (password.length < 6) {
      Alert.alert('Error', 'Password must be at least 6 characters long');
      return false;
    }
    if (password !== confirmPassword) {
      Alert.alert('Error', 'Passwords do not match');
      return false;
    }
    return true;
  };

  const handleSignup = async () => {
    if (!validateInputs()) {
      return;
    }

    setIsLoading(true);

    try {
      const response = await fetch(`${API_BASE_URL}/signup`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          username: username.trim(),
          email: email.trim(),
          password: password,
        }),
      });

      const contentType = response.headers.get('content-type');
      
      if (response.ok) {
        // Check if response is JSON
        if (contentType && contentType.includes('application/json')) {
          const data = await response.json();
          if (data.success) {
            Alert.alert(
              'Success',
              'Account created successfully! You can now login.',
              [
                {
                  text: 'OK',
                  onPress: () => router.replace('/login'),
                },
              ]
            );
          } else {
            const errorMsg = data.msg || data.error || 'Signup failed';
            Alert.alert('Signup Failed', errorMsg);
          }
        } else {
          // Response is not JSON (likely HTML), but status is OK, so signup probably succeeded
          Alert.alert(
            'Success',
            'Account created successfully! You can now login.',
            [
              {
                text: 'OK',
                onPress: () => router.replace('/login'),
              },
            ]
          );
        }
      } else {
        // Try to parse error response
        try {
          if (contentType && contentType.includes('application/json')) {
            const data = await response.json();
            const errorMsg = data.msg || data.error || 'Signup failed';
            Alert.alert('Signup Failed', errorMsg);
          } else {
            Alert.alert('Signup Failed', `Server error: ${response.status}`);
          }
        } catch {
          Alert.alert('Signup Failed', `Server error: ${response.status}`);
        }
      }
    } catch (error) {
      console.error('Signup error:', error);
      Alert.alert('Error', 'Network error. Please check your connection and try again.');
    } finally {
      setIsLoading(false);
    }
  };

  const handleBackToLogin = () => {
    router.replace('/login');
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
      >
        <ScrollView contentContainerStyle={styles.scrollContent} showsVerticalScrollIndicator={false}>
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
              Create Account
            </Text>
            <ThemeToggle />
          </View>

          {/* Logo/Brand */}
          {/* Form */}
          <View style={styles.form}>
            {/* Username Input */}
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
                />
              </View>
            </View>

            {/* Email Input */}
            <View style={styles.inputGroup}>
              <Text style={[styles.label, { color: isDark ? '#d1d5db' : '#374151' }]}>
                Email
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

            {/* Password Input */}
            <View style={styles.inputGroup}>
              <Text style={[styles.label, { color: isDark ? '#d1d5db' : '#374151' }]}>
                Password
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
                  placeholder="Enter your password"
                  placeholderTextColor={isDark ? '#9ca3af' : '#6b7280'}
                  value={password}
                  onChangeText={setPassword}
                  secureTextEntry={!showPassword}
                  autoCapitalize="none"
                  autoCorrect={false}
                />
                <TouchableOpacity
                  style={styles.eyeButton}
                  onPress={() => setShowPassword(!showPassword)}
                >
                  <Ionicons 
                    name={showPassword ? "eye-off-outline" : "eye-outline"} 
                    size={20} 
                    color={isDark ? '#9ca3af' : '#6b7280'} 
                  />
                </TouchableOpacity>
              </View>
            </View>

            {/* Confirm Password Input */}
            <View style={styles.inputGroup}>
              <Text style={[styles.label, { color: isDark ? '#d1d5db' : '#374151' }]}>
                Confirm Password
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
                  placeholder="Confirm your password"
                  placeholderTextColor={isDark ? '#9ca3af' : '#6b7280'}
                  value={confirmPassword}
                  onChangeText={setConfirmPassword}
                  secureTextEntry={!showConfirmPassword}
                  autoCapitalize="none"
                  autoCorrect={false}
                />
                <TouchableOpacity
                  style={styles.eyeButton}
                  onPress={() => setShowConfirmPassword(!showConfirmPassword)}
                >
                  <Ionicons 
                    name={showConfirmPassword ? "eye-off-outline" : "eye-outline"} 
                    size={20} 
                    color={isDark ? '#9ca3af' : '#6b7280'} 
                  />
                </TouchableOpacity>
              </View>
            </View>

            {/* Signup Button */}
            <TouchableOpacity
              style={[styles.signupButton, { opacity: isLoading ? 0.7 : 1 }]}
              onPress={handleSignup}
              disabled={isLoading}
            >
              {isLoading ? (
                <ActivityIndicator size="small" color="#ffffff" />
              ) : (
                <Text style={styles.signupButtonText}>Create Account</Text>
              )}
            </TouchableOpacity>

            {/* Login Link */}
            <View style={styles.loginLinkContainer}>
              <Text style={[styles.loginLinkText, { color: isDark ? '#9ca3af' : '#6b7280' }]}>
                Already have an account?{' '}
              </Text>
              <TouchableOpacity onPress={handleBackToLogin}>
                <Text style={styles.loginLink}>Sign In</Text>
              </TouchableOpacity>
            </View>
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
  brandContainer: {
    alignItems: 'center',
    marginBottom: 40,
  },
  logo: {
    width: 80,
    height: 80,
    borderRadius: 40,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 16,
  },
  subtitle: {
    fontSize: 16,
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
  signupButton: {
    backgroundColor: '#420796',
    borderRadius: 12,
    paddingVertical: 16,
    alignItems: 'center',
    marginTop: 8,
    marginBottom: 24,
  },
  signupButtonText: {
    color: '#ffffff',
    fontSize: 16,
    fontWeight: '600',
  },
  loginLinkContainer: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
  },
  loginLinkText: {
    fontSize: 14,
  },
  loginLink: {
    fontSize: 14,
    fontWeight: '600',
    color: '#420796',
  },
});
