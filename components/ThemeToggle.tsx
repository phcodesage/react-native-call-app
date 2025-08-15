import React from 'react';
import { TouchableOpacity, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '@/contexts/ThemeContext';

interface ThemeToggleProps {
  size?: number;
  style?: any;
}

export const ThemeToggle: React.FC<ThemeToggleProps> = ({ 
  size = 24, 
  style 
}) => {
  const { theme, toggleTheme } = useTheme();

  return (
    <TouchableOpacity 
      style={[styles.container, style]} 
      onPress={toggleTheme}
      accessibilityLabel={`Switch to ${theme === 'dark' ? 'light' : 'dark'} mode`}
      accessibilityRole="button"
    >
      <Ionicons
        name={theme === 'dark' ? 'sunny' : 'moon'}
        size={size}
        color={theme === 'dark' ? '#fbbf24' : '#6366f1'}
      />
    </TouchableOpacity>
  );
};

const styles = StyleSheet.create({
  container: {
    padding: 8,
    borderRadius: 20,
    backgroundColor: 'transparent',
  },
});
