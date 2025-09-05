import * as Notifications from 'expo-notifications';
import { AppState, Platform } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';

// Configure notification behavior
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowAlert: true,
    shouldPlaySound: true,
    shouldSetBadge: true,
    shouldShowBanner: true,
    shouldShowList: true,
  }),
});

export interface MessageNotification {
  id: string;
  title: string;
  body: string;
  data?: any;
  roomId?: string;
  sender?: string;
}

export class MessageNotificationService {
  private static instance: MessageNotificationService;
  private currentRoomId: string | null = null;
  private isAppInForeground = true;

  private constructor() {
    this.setupAppStateListener();
    this.setupNotificationChannels();
  }

  static getInstance(): MessageNotificationService {
    if (!MessageNotificationService.instance) {
      MessageNotificationService.instance = new MessageNotificationService();
    }
    return MessageNotificationService.instance;
  }

  private setupAppStateListener() {
    // Get initial app state
    this.isAppInForeground = AppState.currentState === 'active';
    console.log('[NotificationService] Initial app state:', AppState.currentState);
    
    AppState.addEventListener('change', (nextAppState) => {
      this.isAppInForeground = nextAppState === 'active';
      console.log('[NotificationService] App state changed:', nextAppState, 'isAppInForeground:', this.isAppInForeground);
    });
  }

  private async setupNotificationChannels() {
    if (Platform.OS === 'android') {
      await Notifications.setNotificationChannelAsync('messages', {
        name: 'Messages',
        importance: Notifications.AndroidImportance.HIGH,
        vibrationPattern: [0, 250, 250, 250],
        lightColor: '#FF231F7C',
        sound: 'default',
        enableVibrate: true,
        showBadge: true,
      });

      await Notifications.setNotificationChannelAsync('calls', {
        name: 'Calls',
        importance: Notifications.AndroidImportance.MAX,
        vibrationPattern: [0, 1000, 500, 1000],
        lightColor: '#00FF00',
        sound: 'default',
        enableVibrate: true,
        showBadge: true,
      });
    }
  }

  setCurrentRoom(roomId: string | null) {
    this.currentRoomId = roomId;
    console.log('[NotificationService] Current room set to:', roomId);
  }

  async requestPermissions(): Promise<boolean> {
    try {
      const { status: existingStatus } = await Notifications.getPermissionsAsync();
      let finalStatus = existingStatus;

      if (existingStatus !== 'granted') {
        const { status } = await Notifications.requestPermissionsAsync();
        finalStatus = status;
      }

      if (finalStatus !== 'granted') {
        console.warn('[NotificationService] Notification permissions not granted');
        return false;
      }

      console.log('[NotificationService] Notification permissions granted');
      return true;
    } catch (error) {
      console.error('[NotificationService] Error requesting permissions:', error);
      return false;
    }
  }

  async showMessageNotification(
    sender: string,
    message: string,
    roomId: string,
    messageId?: string
  ): Promise<void> {
    try {
      // Don't show notification if:
      // 1. App is in foreground AND user is in the same room
      // 2. User hasn't granted permissions
      const hasPermissions = await this.requestPermissions();
      if (!hasPermissions) {
        console.log('[NotificationService] No permissions granted');
        return;
      }

      const shouldShowNotification = 
        !this.isAppInForeground || 
        (this.isAppInForeground && this.currentRoomId !== roomId);

      console.log('[NotificationService] Notification decision:', {
        isAppInForeground: this.isAppInForeground,
        currentRoomId: this.currentRoomId,
        messageRoomId: roomId,
        shouldShowNotification,
        sender,
        message: message.substring(0, 50) + '...'
      });

      if (!shouldShowNotification) {
        console.log('[NotificationService] Skipping notification - user is in the same room');
        return;
      }

      // Truncate long messages
      const truncatedMessage = message.length > 100 
        ? message.substring(0, 100) + '...' 
        : message;

      const notificationId = messageId || `msg_${Date.now()}`;

      const notificationRequest = {
        identifier: notificationId,
        content: {
          title: sender,
          body: truncatedMessage,
          data: {
            type: 'message',
            roomId,
            sender,
            messageId,
          },
          categoryIdentifier: 'message',
          sound: 'default',
          ...(Platform.OS === 'android' && {
            channelId: 'messages',
            priority: Notifications.AndroidNotificationPriority.HIGH,
          }),
        },
        trigger: null, // Show immediately
      };

      console.log('[NotificationService] About to schedule notification:', notificationRequest);
      
      await Notifications.scheduleNotificationAsync(notificationRequest);

      console.log('[NotificationService] Notification scheduled successfully');

      console.log('[NotificationService] Message notification shown:', {
        sender,
        roomId,
        isAppInForeground: this.isAppInForeground,
        currentRoom: this.currentRoomId,
      });

      // Update badge count
      await this.updateBadgeCount();
    } catch (error) {
      console.error('[NotificationService] Error showing message notification:', error);
    }
  }

  async showCallNotification(
    caller: string,
    callType: 'audio' | 'video',
    roomId: string
  ): Promise<string> {
    try {
      const hasPermissions = await this.requestPermissions();
      if (!hasPermissions) return '';

      const notificationId = `call_${Date.now()}`;
      const callTypeText = callType === 'video' ? 'Video' : 'Audio';

      await Notifications.scheduleNotificationAsync({
        identifier: notificationId,
        content: {
          title: `Incoming ${callTypeText} Call`,
          body: `${caller} is calling you`,
          data: {
            type: 'call',
            roomId,
            caller,
            callType,
          },
          categoryIdentifier: 'call',
          sound: 'default',
          priority: Notifications.AndroidNotificationPriority.MAX,
        },
        trigger: null,
      });

      console.log('[NotificationService] Call notification shown:', {
        caller,
        callType,
        roomId,
      });

      return notificationId;
    } catch (error) {
      console.error('[NotificationService] Error showing call notification:', error);
      return '';
    }
  }

  async dismissNotification(notificationId: string): Promise<void> {
    try {
      await Notifications.dismissNotificationAsync(notificationId);
      console.log('[NotificationService] Notification dismissed:', notificationId);
    } catch (error) {
      console.error('[NotificationService] Error dismissing notification:', error);
    }
  }

  async dismissAllNotifications(): Promise<void> {
    try {
      await Notifications.dismissAllNotificationsAsync();
      console.log('[NotificationService] All notifications dismissed');
    } catch (error) {
      console.error('[NotificationService] Error dismissing all notifications:', error);
    }
  }

  private async updateBadgeCount(): Promise<void> {
    try {
      // Get unread count from storage or calculate it
      const unreadCount = await this.getUnreadMessageCount();
      await Notifications.setBadgeCountAsync(unreadCount);
    } catch (error) {
      console.error('[NotificationService] Error updating badge count:', error);
    }
  }

  private async getUnreadMessageCount(): Promise<number> {
    try {
      const unreadCountStr = await AsyncStorage.getItem('unreadMessageCount');
      return unreadCountStr ? parseInt(unreadCountStr, 10) : 0;
    } catch (error) {
      console.error('[NotificationService] Error getting unread count:', error);
      return 0;
    }
  }

  async incrementUnreadCount(): Promise<void> {
    try {
      const currentCount = await this.getUnreadMessageCount();
      const newCount = currentCount + 1;
      await AsyncStorage.setItem('unreadMessageCount', newCount.toString());
      await Notifications.setBadgeCountAsync(newCount);
    } catch (error) {
      console.error('[NotificationService] Error incrementing unread count:', error);
    }
  }

  async clearUnreadCount(): Promise<void> {
    try {
      await AsyncStorage.setItem('unreadMessageCount', '0');
      await Notifications.setBadgeCountAsync(0);
    } catch (error) {
      console.error('[NotificationService] Error clearing unread count:', error);
    }
  }

  // Setup notification response handlers
  setupNotificationHandlers(
    onMessageNotificationPress: (roomId: string, sender: string) => void,
    onCallNotificationPress: (roomId: string, caller: string, callType: string) => void
  ) {
    // Handle notification press when app is in foreground
    const foregroundSubscription = Notifications.addNotificationReceivedListener(
      (notification) => {
        console.log('[NotificationService] Notification received in foreground:', notification);
      }
    );

    // Handle notification press when app is in background/closed
    const backgroundSubscription = Notifications.addNotificationResponseReceivedListener(
      (response) => {
        console.log('[NotificationService] Notification response received:', response);
        
        const { data } = response.notification.request.content;
        
        if (data?.type === 'message') {
          onMessageNotificationPress(data.roomId as string, data.sender as string);
        } else if (data?.type === 'call') {
          onCallNotificationPress(data.roomId as string, data.caller as string, data.callType as string);
        }
      }
    );

    return {
      foregroundSubscription,
      backgroundSubscription,
    };
  }
}

export default MessageNotificationService;
