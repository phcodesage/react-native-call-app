import React, { useState } from 'react';
import { StyleSheet, ScrollView, TouchableOpacity, View, Text } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useColorScheme } from 'react-native';
import { ThemedText } from '@/components/ThemedText';
import { ThemedView } from '@/components/ThemedView';

interface CallRecord {
  id: string;
  contactName: string;
  type: 'incoming' | 'outgoing' | 'missed';
  callType: 'audio' | 'video';
  timestamp: Date;
  duration?: string;
}

export default function RecentCallsScreen() {
  const colorScheme = useColorScheme();
  const [callHistory] = useState<CallRecord[]>([
    {
      id: '1',
      contactName: 'Alice Johnson',
      type: 'outgoing',
      callType: 'video',
      timestamp: new Date(Date.now() - 3600000),
      duration: '12:34'
    },
    {
      id: '2',
      contactName: 'Bob Smith',
      type: 'incoming',
      callType: 'audio',
      timestamp: new Date(Date.now() - 7200000),
      duration: '5:42'
    },
    {
      id: '3',
      contactName: 'Carol Davis',
      type: 'missed',
      callType: 'video',
      timestamp: new Date(Date.now() - 10800000),
    },
    {
      id: '4',
      contactName: 'David Wilson',
      type: 'outgoing',
      callType: 'audio',
      timestamp: new Date(Date.now() - 14400000),
      duration: '8:15'
    },
    {
      id: '5',
      contactName: 'Emma Brown',
      type: 'incoming',
      callType: 'video',
      timestamp: new Date(Date.now() - 18000000),
      duration: '23:07'
    },
  ]);

  const isDark = colorScheme === 'dark';

  const getCallIcon = (type: string, callType: string) => {
    if (type === 'missed') {
      return { name: 'call', color: '#ef4444' };
    }
    if (type === 'incoming') {
      return { 
        name: callType === 'video' ? 'videocam' : 'call', 
        color: '#10b981' 
      };
    }
    return { 
      name: callType === 'video' ? 'videocam' : 'call', 
      color: '#3b82f6' 
    };
  };

  const formatTime = (date: Date) => {
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffHours = Math.floor(diffMs / (1000 * 60 * 60));
    const diffDays = Math.floor(diffHours / 24);

    if (diffHours < 1) {
      const diffMinutes = Math.floor(diffMs / (1000 * 60));
      return `${diffMinutes}m ago`;
    } else if (diffHours < 24) {
      return `${diffHours}h ago`;
    } else if (diffDays < 7) {
      return `${diffDays}d ago`;
    } else {
      return date.toLocaleDateString('en-US', { 
        month: 'short', 
        day: 'numeric' 
      });
    }
  };

  const renderCallItem = (call: CallRecord) => {
    const iconInfo = getCallIcon(call.type, call.callType);
    
    return (
      <TouchableOpacity
        key={call.id}
        style={[
          styles.callItem,
          {
            backgroundColor: isDark ? '#2c2c2c' : '#ffffff',
          }
        ]}
      >
        <View style={styles.callContent}>
          {/* Call Type Icon */}
          <View style={[
            styles.callIcon,
            { backgroundColor: `${iconInfo.color}20` }
          ]}>
            <Ionicons 
              name={iconInfo.name as any} 
              size={20} 
              color={iconInfo.color} 
            />
          </View>
          
          {/* Call Info */}
          <View style={styles.callInfo}>
            <View style={styles.callHeader}>
              <Text style={[
                styles.contactName,
                {
                  color: isDark ? '#ffffff' : '#1f2937',
                  fontWeight: call.type === 'missed' ? '600' : '500'
                }
              ]}>
                {call.contactName}
              </Text>
              <Text style={[
                styles.callTime,
                { color: isDark ? '#9ca3af' : '#6b7280' }
              ]}>
                {formatTime(call.timestamp)}
              </Text>
            </View>
            
            <View style={styles.callDetails}>
              <Text style={[
                styles.callType,
                { color: isDark ? '#9ca3af' : '#6b7280' }
              ]}>
                {call.type === 'missed' ? 'Missed' : 
                 call.type === 'incoming' ? 'Incoming' : 'Outgoing'} •{' '}
                {call.callType === 'video' ? 'Video' : 'Audio'}
                {call.duration && ` • ${call.duration}`}
              </Text>
            </View>
          </View>
          
          {/* Call Back Button */}
          <TouchableOpacity style={styles.callBackButton}>
            <Ionicons 
              name={call.callType === 'video' ? 'videocam' : 'call'} 
              size={20} 
              color={isDark ? '#9ca3af' : '#6b7280'} 
            />
          </TouchableOpacity>
        </View>
      </TouchableOpacity>
    );
  };

  return (
    <SafeAreaView style={[
      styles.container,
      { backgroundColor: isDark ? '#1f2937' : '#f9fafb' }
    ]}>
      {/* Header */}
      <ThemedView style={styles.header}>
        <ThemedText type="title" style={styles.headerTitle}>Recent Calls</ThemedText>
        <TouchableOpacity style={styles.headerButton}>
          <Ionicons 
            name="search" 
            size={24} 
            color={isDark ? '#ffffff' : '#1f2937'} 
          />
        </TouchableOpacity>
      </ThemedView>

      {/* Call History List */}
      <ScrollView style={styles.callsList} showsVerticalScrollIndicator={false}>
        {callHistory.length > 0 ? (
          callHistory.map(renderCallItem)
        ) : (
          <View style={styles.emptyState}>
            <Ionicons 
              name="call-outline" 
              size={64} 
              color={isDark ? '#6b7280' : '#9ca3af'} 
            />
            <ThemedText style={styles.emptyText}>
              No recent calls
            </ThemedText>
            <Text style={[
              styles.emptySubtext,
              { color: isDark ? '#9ca3af' : '#6b7280' }
            ]}>
              Your call history will appear here
            </Text>
          </View>
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
  headerTitle: {
    fontSize: 24,
    fontWeight: '600',
  },
  headerButton: {
    padding: 8,
  },
  callsList: {
    flex: 1,
    paddingHorizontal: 16,
    paddingTop: 8,
  },
  callItem: {
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
  callContent: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 16,
  },
  callIcon: {
    width: 40,
    height: 40,
    borderRadius: 20,
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 16,
  },
  callInfo: {
    flex: 1,
  },
  callHeader: {
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
  callTime: {
    fontSize: 12,
  },
  callDetails: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  callType: {
    fontSize: 14,
    opacity: 0.8,
  },
  callBackButton: {
    padding: 8,
  },
  emptyState: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingVertical: 64,
  },
  emptyText: {
    marginTop: 16,
    fontSize: 18,
    fontWeight: '600',
    textAlign: 'center',
  },
  emptySubtext: {
    marginTop: 8,
    fontSize: 14,
    textAlign: 'center',
  },
});
