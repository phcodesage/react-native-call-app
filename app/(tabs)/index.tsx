import { ThemedText } from '@/components/ThemedText';
import { ThemedView } from '@/components/ThemedView';
import { useAuth } from '@/contexts/AuthContext';
import { useTheme } from '@/contexts/ThemeContext';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import React, { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Alert, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { io, Socket } from 'socket.io-client';
import { ENV, getApiUrl, getSocketUrl } from '../../config/env';

interface Contact {
  id: string;
  username: string;
  online: boolean;
  lastMessage?: string;
  lastMessageTime?: string;
  unreadCount?: number;
}

const API_BASE_URL = ENV.API_BASE_URL;
const SOCKET_URL = ENV.SOCKET_SERVER_URL;

export default function HomeScreen() {
  const { user, token, logout } = useAuth();
  const { theme } = useTheme();
  const router = useRouter();
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedContact, setSelectedContact] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const socketRef = useRef<Socket | null>(null);

  // Helper function to safely render text
  const safeText = (text: any): string => {
    if (text === null || text === undefined) return '';
    if (typeof text === 'string') return text.trim();
    if (typeof text === 'number') return String(text);
    return String(text).trim();
  };

  useEffect(() => {
    fetchContacts();
    initializeSocket();
    
    return () => {
      if (socketRef.current) {
        socketRef.current.disconnect();
      }
    };
  }, []);

  const initializeSocket = () => {
    if (!token || !user) return;

    // Initialize socket connection
    socketRef.current = io(SOCKET_URL, {
      transports: ['websocket', 'polling'],
      timeout: 20000,
    });

    const socket = socketRef.current;

    socket.on('connect', () => {
      console.log('Socket connected:', socket.id);
      
      // Register user with the socket
      socket.emit('register', {
        username: user.username,
        token: token
      });
    });

    socket.on('disconnect', () => {
      console.log('Socket disconnected');
    });

    // Listen for user list updates (online/offline status)
    socket.on('user_list', (userList: Array<{username: string, online: boolean}>) => {
      console.log('Received user list:', userList);
      updateContactsOnlineStatus(userList);
    });

    socket.on('force_logout', (data) => {
      console.log('Force logout received:', data);
      Alert.alert('Session Expired', 'Please login again.', [
        { text: 'OK', onPress: () => logout() }
      ]);
    });

    socket.on('connect_error', (error: any) => {
      console.error('Socket connection error:', error);
      console.error('Socket URL:', SOCKET_URL);
      console.error('Error details:', {
        message: error.message,
        type: error.type || 'unknown',
        description: error.description || 'No description available'
      });
    });

    socket.on('error', (error) => {
      console.error('Socket error:', error);
    });
  };

  const updateContactsOnlineStatus = (userList: Array<{username: string, online: boolean}>) => {
    setContacts(prevContacts => {
      return prevContacts.map(contact => {
        const userStatus = userList.find(u => u.username === contact.username);
        return {
          ...contact,
          online: userStatus ? userStatus.online : false
        };
      });
    });
  };

  const fetchContacts = async () => {
    if (!token) return;
    
    try {
      setIsLoading(true);
      
      // Fetch all users
      const usersResponse = await fetch(`${API_BASE_URL}/users`, {
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
      });

      if (usersResponse.status === 401) {
        // Token expired, logout user
        Alert.alert('Session Expired', 'Please login again.', [
          { text: 'OK', onPress: () => logout() }
        ]);
        return;
      }

      if (!usersResponse.ok) {
        console.error(`Users API failed with status: ${usersResponse.status}`);
        console.error(`Response: ${await usersResponse.text()}`);
        throw new Error(`Users API failed: ${usersResponse.status} - ${usersResponse.statusText}`);
      }

      const usersData = await usersResponse.json();
      console.log('Users data:', usersData);
      
      // Filter out current user from the list
      const otherUsers = Array.isArray(usersData) 
        ? usersData.filter(username => username !== user?.username)
        : [];

      // Fetch latest messages for conversations
      const latestMessagesResponse = await fetch(`${API_BASE_URL}/latest_messages`, {
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
      });

      let latestMessages: { [key: string]: any } = {};
      if (latestMessagesResponse.ok) {
        latestMessages = await latestMessagesResponse.json();
        console.log('Latest messages:', latestMessages);
      }

      // Fetch unread counts
      const unreadResponse = await fetch(`${API_BASE_URL}/api/unread-counts`, {
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
      });

      let unreadCounts: { [key: string]: number } = {};
      if (unreadResponse.ok) {
        const unreadData = await unreadResponse.json();
        unreadCounts = unreadData.unread_counts || {};
        console.log('Unread counts:', unreadCounts);
      }

      // Transform data to match our Contact interface
      const transformedContacts: Contact[] = otherUsers.map((username: string) => {
        // Create room ID using sorted usernames (consistent with backend logic)
        const roomParticipants = [user?.username, username].sort();
        const roomId = `${roomParticipants[0]}-${roomParticipants[1]}`;
        
        const latestMessage = latestMessages[roomId];
        const unreadCount = unreadCounts[username] || 0;

        return {
          id: username,
          username: username,
          online: false, // Will be updated via WebSocket
          lastMessage: latestMessage?.message || 'No messages yet',
          lastMessageTime: latestMessage?.timestamp ? formatTimestamp(latestMessage.timestamp) : '',
          unreadCount: unreadCount,
        };
      });

      setContacts(transformedContacts);
      console.log('Transformed contacts:', transformedContacts);
      
    } catch (error) {
      console.error('Error fetching contacts:', error);
      Alert.alert('Error', 'Failed to load contacts. Please check your connection.');
      
      // Use fallback mock data
      setContacts([
        {
          id: 'demo1',
          username: 'Demo User 1',
          online: false,
          lastMessage: 'Welcome to the app!',
          lastMessageTime: '1m',
          unreadCount: 0
        },
        {
          id: 'demo2',
          username: 'Demo User 2', 
          online: false,
          lastMessage: 'Hello there!',
          lastMessageTime: '5m',
          unreadCount: 1
        }
      ]);
    } finally {
      setIsLoading(false);
      setIsRefreshing(false);
    }
  };

  const formatTimestamp = (timestamp: string): string => {
    try {
      const date = new Date(timestamp);
      const now = new Date();
      const diffInMinutes = Math.floor((now.getTime() - date.getTime()) / (1000 * 60));
      
      if (diffInMinutes < 1) return 'now';
      if (diffInMinutes < 60) return `${diffInMinutes}m`;
      if (diffInMinutes < 1440) return `${Math.floor(diffInMinutes / 60)}h`;
      return `${Math.floor(diffInMinutes / 1440)}d`;
    } catch {
      return '';
    }
  };

  const handleRefresh = () => {
    setIsRefreshing(true);
    fetchContacts();
  };

  const handleLogout = () => {
    Alert.alert(
      'Logout',
      'Are you sure you want to logout?',
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Logout', style: 'destructive', onPress: logout },
      ]
    );
  };

  const isDark = theme === 'dark';
  
  const filteredContacts = contacts.filter(contact => 
    contact.username.toLowerCase().includes(searchQuery.toLowerCase())
  );

  const onlineContacts = filteredContacts.filter(contact => contact.online);
  const offlineContacts = filteredContacts.filter(contact => !contact.online);

  const handleContactPress = (contact: Contact) => {
    setSelectedContact(contact.id);
    
    // Generate room ID using sorted usernames (matches backend logic)
    const participants = [user?.username, contact.username].filter(Boolean).sort();
    const roomId = participants.join('-');
    
    // Navigate to chat screen
    router.push(`/chat/${roomId}`);
  };

  const renderContactItem = (contact: Contact) => {
    const isSelected = selectedContact === contact.id;
    const isDark = theme === 'dark';
    
    // Ensure all text values are safe
    const username = safeText(contact.username) || 'Unknown';
    const lastMessage = safeText(contact.lastMessage);
    const lastMessageTime = safeText(contact.lastMessageTime);
    const avatarLetter = username.charAt(0).toUpperCase();
    
    return (
      <TouchableOpacity
        key={contact.id}
        style={[
          styles.contactItem,
          {
            backgroundColor: isSelected 
              ? (isDark ? '#420796' : '#420796')
              : (isDark ? '#2c2c2c' : '#ffffff'),
          }
        ]}
        onPress={() => handleContactPress(contact)}
      >
        <View style={styles.contactContent}>
          <View style={[
            styles.avatar,
            { backgroundColor: isDark ? '#4f46e5' : '#3b82f6' }
          ]}>
            <Text style={styles.avatarText}>
              {avatarLetter}
            </Text>
            <View style={[
              styles.statusIndicator,
              { backgroundColor: contact.online ? '#10b981' : '#6b7280' }
            ]} />
          </View>
          
          <View style={styles.contactInfo}>
            <View style={styles.contactHeader}>
              <Text style={[
                styles.contactName,
                {
                  color: isSelected ? '#ffffff' : (isDark ? '#ffffff' : '#1f2937'),
                  fontWeight: contact.unreadCount && contact.unreadCount > 0 ? '600' : '500'
                }
              ]}>
                {username}
              </Text>
              <View style={styles.contactMeta}>
                {lastMessageTime.length > 0 ? (
                  <Text style={[
                    styles.messageTime,
                    { color: isSelected ? '#e5e7eb' : (isDark ? '#9ca3af' : '#6b7280') }
                  ]}>
                    {lastMessageTime}
                  </Text>
                ) : null}
                {(contact.unreadCount && contact.unreadCount > 0) ? (
                  <View style={styles.unreadBadge}>
                    <Text style={styles.unreadText}>
                      {String(contact.unreadCount)}
                    </Text>
                  </View>
                ) : null}
              </View>
            </View>
            {lastMessage.length > 0 ? (
              <Text 
                style={[
                  styles.lastMessage,
                  {
                    color: isSelected ? '#e5e7eb' : (isDark ? '#9ca3af' : '#6b7280'),
                    fontWeight: contact.unreadCount && contact.unreadCount > 0 ? '500' : '400'
                  }
                ]}
                numberOfLines={1}
              >
                {lastMessage}
              </Text>
            ) : null}
          </View>
        </View>
      </TouchableOpacity>
    );
  };

  return (
    <SafeAreaView style={[
      styles.container,
      { backgroundColor: theme === 'dark' ? '#1f2937' : '#f9fafb' }
    ]}>
      {/* Header */}
      <ThemedView style={styles.header}>
        <View style={styles.headerLeft}>
          <ThemedText type="title" style={styles.headerTitle}>Contacts</ThemedText>
          {user ? (
            <Text style={[styles.welcomeText, { color: theme === 'dark' ? '#9ca3af' : '#6b7280' }]}>
              Welcome, {user.username}
            </Text>
          ) : null}
        </View>
        <View style={styles.headerActions}>
          <TouchableOpacity style={styles.headerButton} onPress={handleRefresh}>
            <Ionicons 
              name="refresh" 
              size={24} 
              color={theme === 'dark' ? '#ffffff' : '#1f2937'} 
            />
          </TouchableOpacity>
          <TouchableOpacity style={styles.headerButton} onPress={handleLogout}>
            <Ionicons 
              name="log-out-outline" 
              size={24} 
              color={theme === 'dark' ? '#ffffff' : '#1f2937'} 
            />
          </TouchableOpacity>
        </View>
      </ThemedView>

      {/* Search Bar */}
      <View style={[
        styles.searchContainer,
        { backgroundColor: theme === 'dark' ? '#374151' : '#ffffff' }
      ]}>
        <Ionicons 
          name="search" 
          size={20} 
          color={theme === 'dark' ? '#9ca3af' : '#6b7280'} 
          style={styles.searchIcon}
        />
        <TextInput
          style={[
            styles.searchInput,
            { color: theme === 'dark' ? '#ffffff' : '#1f2937' }
          ]}
          placeholder="Search contacts..."
          placeholderTextColor={theme === 'dark' ? '#9ca3af' : '#6b7280'}
          value={searchQuery}
          onChangeText={setSearchQuery}
        />
      </View>

      {/* Contacts List */}
      <ScrollView style={styles.contactsList} showsVerticalScrollIndicator={false}>
        {isLoading ? (
          <View style={styles.loadingContainer}>
            <ActivityIndicator size="large" color="#420796" />
            <Text style={[styles.loadingText, { color: isDark ? '#9ca3af' : '#6b7280' }]}>
              Loading contacts...
            </Text>
          </View>
        ) : (
          <>
            {onlineContacts.length > 0 ? (
              <View>
                <Text style={[styles.sectionHeader, { color: isDark ? '#9ca3af' : '#6b7280' }]}>
                  Online ({String(onlineContacts.length)})
                </Text>
                {onlineContacts.map((contact, index) => (
                  <View key={`online-${contact.id}-${index}`}>
                    {renderContactItem(contact)}
                  </View>
                ))}
              </View>
            ) : null}
            
            {offlineContacts.length > 0 ? (
              <View>
                <Text style={[styles.sectionHeader, { color: isDark ? '#9ca3af' : '#6b7280' }]}>
                  Offline ({String(offlineContacts.length)})
                </Text>
                {offlineContacts.map((contact, index) => (
                  <View key={`offline-${contact.id}-${index}`}>
                    {renderContactItem(contact)}
                  </View>
                ))}
              </View>
            ) : null}
            
            {(filteredContacts.length === 0 && !isLoading) ? (
              <View style={styles.emptyState}>
                <Ionicons 
                  name="people-outline" 
                  size={64} 
                  color={isDark ? '#6b7280' : '#9ca3af'} 
                />
                <Text style={[styles.emptyStateText, { color: isDark ? '#9ca3af' : '#6b7280' }]}>
                  {searchQuery ? 'No contacts found' : 'No contacts available'}
                </Text>
                {!searchQuery ? (
                  <TouchableOpacity style={styles.refreshButton} onPress={handleRefresh}>
                    <Text style={styles.refreshButtonText}>Refresh</Text>
                  </TouchableOpacity>
                ) : null}
              </View>
            ) : null}
          </>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingVertical: 16,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(0, 0, 0, 0.1)',
  },
  headerLeft: {
    flex: 1,
  },
  headerTitle: {
    fontSize: 24,
    fontWeight: '600',
  },
  welcomeText: {
    fontSize: 12,
    marginTop: 2,
  },
  headerActions: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  headerButton: {
    padding: 8,
    marginLeft: 8,
  },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingVertical: 64,
  },
  loadingText: {
    marginTop: 16,
    fontSize: 16,
  },
  searchContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    marginHorizontal: 16,
    marginVertical: 12,
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderRadius: 12,
    shadowColor: '#000',
    shadowOffset: {
      width: 0,
      height: 1,
    },
    shadowOpacity: 0.1,
    shadowRadius: 2,
    elevation: 2,
  },
  searchIcon: {
    marginRight: 12,
  },
  searchInput: {
    flex: 1,
    fontSize: 16,
  },
  contactsList: {
    flex: 1,
    paddingHorizontal: 16,
  },
  section: {
    marginBottom: 24,
  },
  sectionHeader: {
    fontSize: 12,
    fontWeight: '600',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginBottom: 12,
    marginTop: 16,
    paddingHorizontal: 4,
  },
  sectionTitleContainer: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  onlineIndicator: {
    width: 8,
    height: 8,
    borderRadius: 4,
    marginRight: 8,
  },
  sectionTitle: {
    fontSize: 12,
    fontWeight: '600',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    opacity: 0.7,
  },
  countBadge: {
    backgroundColor: '#10b981',
    borderRadius: 12,
    paddingHorizontal: 8,
    paddingVertical: 2,
    marginLeft: 8,
  },
  countText: {
    color: '#ffffff',
    fontSize: 10,
    fontWeight: '600',
  },
  contactItem: {
    borderRadius: 12,
    marginBottom: 8,
    shadowColor: '#000',
    shadowOffset: {
      width: 0,
      height: 1,
    },
    shadowOpacity: 0.1,
    shadowRadius: 2,
    elevation: 2,
  },
  contactContent: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 16,
  },
  avatar: {
    width: 48,
    height: 48,
    borderRadius: 24,
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 16,
    position: 'relative',
  },
  avatarText: {
    color: '#ffffff',
    fontSize: 18,
    fontWeight: '600',
  },
  statusIndicator: {
    position: 'absolute',
    bottom: 0,
    right: 0,
    width: 12,
    height: 12,
    borderRadius: 6,
    borderWidth: 2,
    borderColor: '#ffffff',
  },
  contactInfo: {
    flex: 1,
  },
  contactHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 4,
  },
  contactName: {
    fontSize: 16,
    fontWeight: '500',
    flex: 1,
  },
  contactMeta: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  messageTime: {
    fontSize: 12,
    marginRight: 8,
  },
  unreadBadge: {
    backgroundColor: '#ef4444',
    borderRadius: 10,
    paddingHorizontal: 6,
    paddingVertical: 2,
    minWidth: 20,
    alignItems: 'center',
  },
  unreadText: {
    color: '#ffffff',
    fontSize: 10,
    fontWeight: '600',
  },
  lastMessage: {
    fontSize: 14,
    opacity: 0.8,
  },
  emptyState: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingVertical: 64,
  },
  emptyStateText: {
    marginTop: 16,
    fontSize: 16,
    opacity: 0.6,
    textAlign: 'center',
  },
  refreshButton: {
    marginTop: 16,
    paddingHorizontal: 20,
    paddingVertical: 10,
    backgroundColor: '#420796',
    borderRadius: 8,
  },
  refreshButtonText: {
    color: '#ffffff',
    fontSize: 14,
    fontWeight: '600',
  },
});
