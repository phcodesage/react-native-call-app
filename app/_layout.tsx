import { DarkTheme, DefaultTheme, ThemeProvider as NavigationThemeProvider } from '@react-navigation/native';
import { AuthProvider } from '@/contexts/AuthContext';
import { ThemeProvider as CustomThemeProvider, useTheme } from '@/contexts/ThemeContext';
import { useFonts } from 'expo-font';
import { Stack } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { StatusBar } from 'expo-status-bar';
import { useEffect } from 'react';
import 'react-native-reanimated';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { AuthGuard } from '@/components/AuthGuard';
import { AlertProvider } from '@/hooks/useCustomAlert';
 

export default function RootLayout() {
  const [loaded] = useFonts({
    SpaceMono: require('../assets/fonts/SpaceMono-Regular.ttf'),
  });

  if (!loaded) {
    // Async font loading only occurs in development.
    return null;
  }

  return (
    <CustomThemeProvider>
      <AuthProvider>
        <AlertProvider>
          <SafeAreaProvider>
            <InnerApp />
          </SafeAreaProvider>
        </AlertProvider>
      </AuthProvider>
    </CustomThemeProvider>
  );
}

function InnerApp() {
  const { theme } = useTheme();
  return (
    <NavigationThemeProvider value={theme === 'dark' ? DarkTheme : DefaultTheme}>
      <AuthGuard>
        <Stack>
          <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
          <Stack.Screen name="login" options={{ headerShown: false }} />
          <Stack.Screen name="signup" options={{ headerShown: false }} />
          <Stack.Screen name="reset-password" options={{ headerShown: false }} />
          <Stack.Screen name="chat/[roomId]" options={{ headerShown: false }} />
          <Stack.Screen name="+not-found" />
        </Stack>
      </AuthGuard>
      <StatusBar style={theme === 'dark' ? 'light' : 'dark'} translucent={false} backgroundColor={theme === 'dark' ? '#1f2937' : '#f9fafb'} />
    </NavigationThemeProvider>
  );
}

