import { ThemedText } from '@/components/ThemedText';
import { ThemedView } from '@/components/ThemedView';
import { useAuth } from '@/contexts/AuthContext';
import { useTheme } from '@/contexts/ThemeContext';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import React, { useEffect, useRef, useState } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { ActivityIndicator, Alert, AppState, AppStateStatus, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
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
  const [serverWarning, setServerWarning] = useState<string | null>(null);
  // Keep latest online status map to avoid being overwritten by fetchContacts
  const userStatusRef = useRef<Record<string, boolean>>({});
  const appStateRef = useRef<AppStateStatus>(AppState.currentState);

  // Helper function to safely render text
  const safeText = (text: any): string => {
    if (text === null || text === undefined) return '';
    if (typeof text === 'string') return text.trim();
    if (typeof text === 'number') return String(text);
    return String(text).trim();
  };

  useEffect(() => {
    // Attempt to quickly show cached contacts first
    (async () => {
      try {
        const cached = await AsyncStorage.getItem('contacts_cache');
        if (cached) {
          const parsed = JSON.parse(cached);
          if (Array.isArray(parsed)) setContacts(parsed);
        }
      } catch {}
    })();

    fetchContacts();
    initializeSocket();

    // Handle app state changes to maintain socket connection
    const handleAppStateChange = (nextAppState: AppStateStatus) => {
      if (appStateRef.current.match(/inactive|background/) && nextAppState === 'active') {
        console.log('[ContactList] App has come to the foreground - reconnecting socket');
        // Reconnect socket if needed
        if (socketRef.current && !socketRef.current.connected) {
          socketRef.current.connect();
        }
        // Refresh contacts when coming back to foreground
        fetchContacts();
      } else if (nextAppState.match(/inactive|background/)) {
        console.log('[ContactList] App has gone to the background');
        // Keep socket connected in background for notifications
        // Don't disconnect the socket to maintain real-time updates
      }
      appStateRef.current = nextAppState;
    };

    const subscription = AppState.addEventListener('change', handleAppStateChange);
    
    return () => {
      subscription?.remove();
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
      
      // Clear any previous server warning
      setServerWarning(null);

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
      // Persist latest status map
      const map: Record<string, boolean> = {};
      for (const u of userList) map[u.username] = !!u.online;
      userStatusRef.current = map;
      // Apply to current contacts immediately
      setContacts(prev => prev.map(c => ({ ...c, online: map[c.username] ?? false })));
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
      setServerWarning('Server unreachable. Showing cached contacts.');
    });

    socket.on('error', (error) => {
      console.error('Socket error:', error);
    });

    // Listen for global message notifications to update unread counts
    socket.on('global_message_notification', (data: any) => {
      try {
        console.log('[ContactList] Received global message notification:', data);
        
        // Update unread count for the sender (only if not in that room)
        if (data?.from && data?.room) {
          setContacts(prevContacts => {
            return prevContacts.map(contact => {
              if (contact.username === data.from) {
                const currentUnread = typeof contact.unreadCount === 'number' && !isNaN(contact.unreadCount) ? contact.unreadCount : 0;
                return {
                  ...contact,
                  unreadCount: currentUnread + 1,
                  lastMessage: data.message || contact.lastMessage,
                  lastMessageTime: data.timestamp ? formatTimestamp(data.timestamp) : contact.lastMessageTime,
                };
              }
              return contact;
            });
          });
        }
      } catch (e) {
        console.error('Error handling global_message_notification in contact list:', e);
      }
    });

    // Listen for unread count updates (when user reads messages)
    socket.on('unread_count_updated', (data: any) => {
      try {
        console.log('[ContactList] Unread count updated:', data);
        
        if (data?.room && data?.count !== undefined && data?.username === user?.username) {
          // This is an update for the current user's unread count
          // Extract the other user from the room name to update their contact
          const roomUsers = data.room.split('-');
          const otherUser = roomUsers.find((u: string) => u !== user?.username);
          
          if (otherUser) {
            setContacts(prevContacts => {
              return prevContacts.map(contact => {
                if (contact.username === otherUser) {
                  const validCount = typeof data.count === 'number' && !isNaN(data.count) ? data.count : 0;
                  console.log(`[ContactList] Updating unread count for ${otherUser}: ${validCount} (original: ${data.count}, type: ${typeof data.count})`);
                  return {
                    ...contact,
                    unreadCount: validCount,
                  };
                }
                return contact;
              });
            });
          }
        }
      } catch (e) {
        console.error('Error handling unread_count_updated:', e);
      }
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
      const fetchUnreadCounts = async () => {
        try {
          console.log('[FETCH_UNREAD] Making request to /api/unread-counts with token:', token ? 'present' : 'missing');
          const response = await fetch(`${API_BASE_URL}/api/unread-counts`, {
            headers: {
              'Authorization': `Bearer ${token}`,
              'Content-Type': 'application/json',
            },
          });

          console.log('[FETCH_UNREAD] Response status:', response.status);
          if (response.ok) {
            const unreadCounts = await response.json();
            console.log('Unread counts raw data:', JSON.stringify(unreadCounts, null, 2));
            return unreadCounts;
          } else {
            console.error('Failed to fetch unread counts:', response.status, response.statusText);
            const errorText = await response.text();
            console.error('Error response body:', errorText);
            return {};
          }
        } catch (error) {
          console.error('Error fetching unread counts:', error);
          return {};
        }
      };

      const unreadCounts = await fetchUnreadCounts();

      // Transform users into contacts with latest message info and unread counts
      const transformedContacts = usersData.map((username: string) => {
        const roomId = [user?.username, username].sort().join('-');
        const latestMessage = latestMessages[roomId];
        
        // Try to find unread count by exact username match first, then by partial match
        // Handle nested structure: unreadCounts.unread_counts or direct unreadCounts
        const counts = unreadCounts.unread_counts || unreadCounts;
        let unreadCount = counts[username];
        if (unreadCount === undefined) {
          // Check for partial matches (e.g., "m2" for "m2-red")
          const partialMatch = Object.keys(counts).find(key => 
            username.includes(key) || key.includes(username)
          );
          if (partialMatch) {
            unreadCount = counts[partialMatch];
            console.log(`[ContactList] Found partial match for ${username}: ${partialMatch} = ${unreadCount} (type: ${typeof unreadCount})`);
          }
        }
        
        // Ensure unreadCount is a valid number
        const validUnreadCount = (() => {
          if (typeof unreadCount === 'number' && !isNaN(unreadCount) && unreadCount > 0) {
            return unreadCount;
          }
          if (typeof unreadCount === 'string') {
            const parsed = parseInt(unreadCount, 10);
            return !isNaN(parsed) && parsed > 0 ? parsed : 0;
          }
          return 0;
        })();

        return {
          id: username,
          username: username,
          // Use latest known online status from socket (if available)
          online: userStatusRef.current[username] ?? false,
          lastMessage: latestMessage?.message || 'No messages yet',
          lastMessageTime: latestMessage?.timestamp ? formatTimestamp(latestMessage.timestamp) : '',
          unreadCount: validUnreadCount,
        };
      });

      setContacts(transformedContacts);
      // Persist cache on success
      try {
        await AsyncStorage.setItem('contacts_cache', JSON.stringify(transformedContacts));
        setServerWarning(null);
      } catch {}
      console.log('Transformed contacts:', transformedContacts);
      
    } catch (error) {
      console.error('Error fetching contacts:', error);
      // Load cached contacts if available
      try {
        const cached = await AsyncStorage.getItem('contacts_cache');
        if (cached) {
          const parsed = JSON.parse(cached);
          if (Array.isArray(parsed)) setContacts(parsed);
        }
      } catch {}
      setServerWarning('Server unreachable. Showing cached contacts.');
    } finally {
      setIsLoading(false);
      setIsRefreshing(false);
    }
  };

  const formatTimestamp = (timestamp: string): string => {
    try {
      // Clean timestamp - remove trailing Z if present and handle various formats
      const cleanTimestamp = timestamp.replace(/Z$/, '').replace(/\+00:00Z$/, '+00:00');
      const date = new Date(cleanTimestamp);
      
      // Check if date is valid
      if (isNaN(date.getTime())) {
        console.warn(`[formatTimestamp] Invalid timestamp: ${timestamp}`);
        return '';
      }
      
      const now = new Date();
      const diffInMinutes = Math.floor((now.getTime() - date.getTime()) / (1000 * 60));
      
      if (diffInMinutes < 1) return 'now';
      if (diffInMinutes < 60) return `${diffInMinutes}m`;
      if (diffInMinutes < 1440) return `${Math.floor(diffInMinutes / 60)}h`;
      return `${Math.floor(diffInMinutes / 1440)}d`;
    } catch (error) {
      console.warn(`[formatTimestamp] Error parsing timestamp: ${timestamp}`, error);
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
    
    // Debug logging for NaN issue
    if (contact.username === 'admin') {
      console.log(`[DEBUG] Admin contact data:`, {
        username: contact.username,
        lastMessageTime: contact.lastMessageTime,
        safeLastMessageTime: lastMessageTime,
        unreadCount: contact.unreadCount
      });
    }
    
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
                {(() => {
                  const count = contact.unreadCount;
                  // Only log if there might be an issue
                  if (count && (typeof count !== 'number' || isNaN(count))) {
                    console.log(`[Badge Debug] ${contact.username}: INVALID count=${count}, type=${typeof count}, isNaN=${isNaN(count)}`);
                  }
                  
                  if (typeof count === 'number' && count > 0 && !isNaN(count)) {
                    return (
                      <View style={styles.unreadBadge}>
                        <Text style={styles.unreadText}>
                          {count > 99 ? '99+' : String(count)}
                        </Text>
                      </View>
                    );
                  }
                  return null;
                })()}
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
    ]} edges={['top', 'left', 'right']}>
      {/* Header */}
      <ThemedView
        style={[
          styles.header,
          {
            backgroundColor: theme === 'dark' ? '#111827' : '#ffffff',
            borderBottomColor: theme === 'dark' ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.06)',
          },
        ]}
      >
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

      {/* Server warning banner */}
      {serverWarning ? (
        <View style={[styles.warningBanner, { backgroundColor: '#f59e0b20', borderColor: theme === 'dark' ? '#f59e0b' : '#d97706' }]}> 
          <Ionicons name="alert-circle" size={16} color={theme === 'dark' ? '#f59e0b' : '#b45309'} style={{ marginRight: 6 }} />
          <Text style={{ color: theme === 'dark' ? '#fbbf24' : '#92400e', fontSize: 12 }}>{serverWarning}</Text>
        </View>
      ) : null}

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
  warningBanner: {
    marginHorizontal: 16,
    marginTop: 8,
    marginBottom: 4,
    paddingHorizontal: 10,
    paddingVertical: 8,
    borderRadius: 8,
    borderWidth: 1,
    flexDirection: 'row',
    alignItems: 'center',
  },
});
