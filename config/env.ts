import Constants from 'expo-constants';

// Environment configuration
export const ENV = {
  // API Configuration
  API_BASE_URL: process.env.EXPO_PUBLIC_API_BASE_URL || 'https://win.flask-meet.site',
  SOCKET_SERVER_URL: process.env.EXPO_PUBLIC_SOCKET_SERVER_URL || 'https://win.flask-meet.site',

  // WebRTC Configuration
  STUN_SERVER_URL: process.env.EXPO_PUBLIC_STUN_SERVER_URL || 'stun:stun.l.google.com:19302',
  TURN_SERVER_URL: process.env.EXPO_PUBLIC_TURN_SERVER_URL || '',
  TURN_USERNAME: process.env.EXPO_PUBLIC_TURN_USERNAME || '',
  TURN_PASSWORD: process.env.EXPO_PUBLIC_TURN_PASSWORD || '',

  // Authentication
  AUTH_BASE_URL: process.env.EXPO_PUBLIC_AUTH_BASE_URL || 'https://win.flask-meet.site',
  JWT_SECRET_KEY: process.env.EXPO_PUBLIC_JWT_SECRET_KEY || 'your-jwt-secret-key-here',
  API_KEY: process.env.EXPO_PUBLIC_API_KEY || 'your-api-key-here',

  // Push Notifications
  EXPO_PUSH_TOKEN: process.env.EXPO_PUBLIC_EXPO_PUSH_TOKEN || '',
  FCM_SERVER_KEY: process.env.EXPO_PUBLIC_FCM_SERVER_KEY || '',

  // Development
  NODE_ENV: process.env.NODE_ENV || 'development',
  DEBUG_MODE: process.env.EXPO_PUBLIC_DEBUG_MODE === 'true',

  // Database
  DATABASE_URL: process.env.EXPO_PUBLIC_DATABASE_URL || '',

  // Third-party Services
  TWILIO_ACCOUNT_SID: process.env.EXPO_PUBLIC_TWILIO_ACCOUNT_SID || '',
  TWILIO_AUTH_TOKEN: process.env.EXPO_PUBLIC_TWILIO_AUTH_TOKEN || '',
  TWILIO_API_KEY: process.env.EXPO_PUBLIC_TWILIO_API_KEY || '',
  TWILIO_API_SECRET: process.env.EXPO_PUBLIC_TWILIO_API_SECRET || '',

  // App Configuration
  APP_NAME: process.env.EXPO_PUBLIC_APP_NAME || 'CallApp',
  APP_VERSION: process.env.EXPO_PUBLIC_APP_VERSION || '1.0.0',

  // Expo specific
  IS_DEV: __DEV__,
  IS_PREVIEW: Constants.appOwnership === 'expo',
  IS_PRODUCTION: process.env.NODE_ENV === 'production',
};

// Helper functions
export const getApiUrl = (endpoint: string): string => {
  return `${ENV.API_BASE_URL}${endpoint.startsWith('/') ? endpoint : `/${endpoint}`}`;
};

export const getAuthUrl = (endpoint: string): string => {
  return `${ENV.AUTH_BASE_URL}${endpoint.startsWith('/') ? endpoint : `/${endpoint}`}`;
};

export const getSocketUrl = (): string => {
  return ENV.SOCKET_SERVER_URL;
};

export const getWebRTCConfig = () => ({
  apiBaseUrl: ENV.API_BASE_URL,
  // Fallback ICE servers (will be overridden by dynamic servers from backend)
  iceServers: [
    { urls: ENV.STUN_SERVER_URL },
    ...(ENV.TURN_SERVER_URL ? [{
      urls: ENV.TURN_SERVER_URL,
      username: ENV.TURN_USERNAME,
      credential: ENV.TURN_PASSWORD,
    }] : []),
  ],
});

export const initializeWebRTC = async () => {
  const { WebRTCManager } = await import('../services/WebRTCManager');
  console.log('initializeWebRTC: Using API base URL:', ENV.API_BASE_URL);
  return WebRTCManager.initialize({ apiBaseUrl: ENV.API_BASE_URL });
};

export default ENV;
