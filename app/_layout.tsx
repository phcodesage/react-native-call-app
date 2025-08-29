import { DarkTheme, DefaultTheme, ThemeProvider as NavigationThemeProvider } from '@react-navigation/native';
import { AuthProvider, useAuth } from '@/contexts/AuthContext';
import { ThemeProvider as CustomThemeProvider, useTheme } from '@/contexts/ThemeContext';
import { useFonts } from 'expo-font';
import { Stack, useRouter, useSegments } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { StatusBar } from 'expo-status-bar';
import { useEffect } from 'react';
import 'react-native-reanimated';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { AuthGuard } from '@/components/AuthGuard';
import { AlertProvider } from '@/hooks/useCustomAlert';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { AppState } from 'react-native';
 

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
  const { isAuthenticated } = useAuth();
  const router = useRouter();
  const segments = useSegments();

  // Restore last opened chat when app starts or resumes
  useEffect(() => {
    if (!isAuthenticated) return;
    const maybeRestore = async () => {
      try {
        const last = await AsyncStorage.getItem('last_room_id');
        // Only redirect if we're not already on a chat route
        const onChatRoute = segments && segments[0] === 'chat';
        if (last && !onChatRoute) {
          router.replace(`/chat/${last}`);
        }
      } catch {}
    };
    void maybeRestore();

    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active' && isAuthenticated) {
        void maybeRestore();
      }
    });
    return () => {
      sub.remove();
    };
  }, [isAuthenticated, segments]);
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

