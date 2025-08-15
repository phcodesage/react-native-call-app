import { Alert, Linking, Platform } from 'react-native';

// Fallback for when react-native-permissions is not available
let PERMISSIONS: any = {};
let RESULTS: any = {};
let check: any = () => Promise.resolve('granted');
let request: any = () => Promise.resolve('granted');

try {
  const permissions = require('react-native-permissions');
  PERMISSIONS = permissions.PERMISSIONS;
  RESULTS = permissions.RESULTS;
  check = permissions.check;
  request = permissions.request;
} catch (error) {
  console.warn('react-native-permissions not available, using fallback');
}

export interface PermissionResult {
  granted: boolean;
  message?: string;
}

export const requestCameraPermission = async (): Promise<PermissionResult> => {
  try {
    // Fallback for when permissions module is not available
    if (!PERMISSIONS.IOS && !PERMISSIONS.ANDROID) {
      console.warn('Permissions module not available, assuming camera permission granted');
      return { granted: true };
    }

    if (Platform.OS === 'ios') {
      const result = await request(PERMISSIONS.IOS.CAMERA);
      return {
        granted: result === RESULTS.GRANTED,
        message: result === RESULTS.DENIED ? 'Camera permission denied' : undefined
      };
    } else {
      const result = await request(PERMISSIONS.ANDROID.CAMERA);
      return {
        granted: result === RESULTS.GRANTED,
        message: result === RESULTS.DENIED ? 'Camera permission denied' : undefined
      };
    }
  } catch (error) {
    console.error('Error requesting camera permission:', error);
    return { granted: true, message: 'Using fallback permission (development mode)' };
  }
};

export const requestMicrophonePermission = async (): Promise<PermissionResult> => {
  try {
    // Fallback for when permissions module is not available
    if (!PERMISSIONS.IOS && !PERMISSIONS.ANDROID) {
      console.warn('Permissions module not available, assuming microphone permission granted');
      return { granted: true };
    }

    if (Platform.OS === 'ios') {
      const result = await request(PERMISSIONS.IOS.MICROPHONE);
      return {
        granted: result === RESULTS.GRANTED,
        message: result === RESULTS.DENIED ? 'Microphone permission denied' : undefined
      };
    } else {
      const result = await request(PERMISSIONS.ANDROID.RECORD_AUDIO);
      return {
        granted: result === RESULTS.GRANTED,
        message: result === RESULTS.DENIED ? 'Microphone permission denied' : undefined
      };
    }
  } catch (error) {
    console.error('Error requesting microphone permission:', error);
    return { granted: true, message: 'Using fallback permission (development mode)' };
  }
};

export const requestCallPermissions = async (needsVideo: boolean = false): Promise<PermissionResult> => {
  try {
    // Always request microphone permission
    const micResult = await requestMicrophonePermission();
    if (!micResult.granted) {
      return micResult;
    }

    // Request camera permission only if needed
    if (needsVideo) {
      const cameraResult = await requestCameraPermission();
      if (!cameraResult.granted) {
        return cameraResult;
      }
    }

    return { granted: true };
  } catch (error) {
    console.error('Error requesting call permissions:', error);
    return { granted: false, message: 'Error requesting permissions' };
  }
};

export const checkCallPermissions = async (needsVideo: boolean = false): Promise<PermissionResult> => {
  try {
    // Check microphone permission
    const micPermission = Platform.OS === 'ios' 
      ? PERMISSIONS.IOS.MICROPHONE 
      : PERMISSIONS.ANDROID.RECORD_AUDIO;
    
    const micResult = await check(micPermission);
    if (micResult !== RESULTS.GRANTED) {
      return { granted: false, message: 'Microphone permission required' };
    }

    // Check camera permission if needed
    if (needsVideo) {
      const cameraPermission = Platform.OS === 'ios' 
        ? PERMISSIONS.IOS.CAMERA 
        : PERMISSIONS.ANDROID.CAMERA;
      
      const cameraResult = await check(cameraPermission);
      if (cameraResult !== RESULTS.GRANTED) {
        return { granted: false, message: 'Camera permission required' };
      }
    }

    return { granted: true };
  } catch (error) {
    console.error('Error checking permissions:', error);
    return { granted: false, message: 'Error checking permissions' };
  }
};

export const showPermissionAlert = (message: string, onRetry?: () => void) => {
  Alert.alert(
    'Permission Required',
    message,
    [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Settings', onPress: () => Linking.openSettings() },
      ...(onRetry ? [{ text: 'Retry', onPress: onRetry }] : [])
    ]
  );
};
