import React, { useState } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  Modal,
  StyleSheet,
  Dimensions,
  Alert,
  Linking,
  ActivityIndicator,
  Platform,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { MessageStatusIndicator } from './MessageStatusIndicator';
// Using expo-av for now, will migrate to expo-video in SDK 54
import { Video, ResizeMode } from 'expo-av';
import * as FileSystem from 'expo-file-system';
import { Image as ExpoImage } from 'expo-image';
import * as Sharing from 'expo-sharing';
import * as Notifications from 'expo-notifications';
import AsyncStorage from '@react-native-async-storage/async-storage';

interface FileMessageProps {
  file_id?: string;
  file_name?: string;
  file_type?: string;
  file_size?: number;
  file_url?: string;
  sender: string;
  timestamp: string;
  isOutgoing: boolean;
  isDark: boolean;
  status?: string;
  showStatusText?: boolean;
}

export default function FileMessage({
  file_id,
  file_name,
  file_type,
  file_size,
  file_url,
  sender,
  timestamp,
  isOutgoing,
  isDark,
  status,
  showStatusText = false,
}: FileMessageProps) {
  const [showFullScreen, setShowFullScreen] = useState(false);
  const [isDownloading, setIsDownloading] = useState(false);
  // Loading states for media previews
  const [thumbLoading, setThumbLoading] = useState(false);
  const [fullLoading, setFullLoading] = useState(false);

  const formatFileSize = (bytes?: number): string => {
    if (!bytes || bytes === 0) return '0 Bytes';
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  };

  const getFileIcon = (fileType?: string): string => {
    if (!fileType) return 'document';
    
    if (fileType.startsWith('image/')) return 'image';
    if (fileType.startsWith('video/')) return 'videocam';
    if (fileType.startsWith('audio/')) return 'musical-notes';
    if (fileType.includes('pdf')) return 'document-text';
    if (fileType.includes('word') || fileType.includes('doc')) return 'document-text';
    if (fileType.includes('excel') || fileType.includes('sheet')) return 'grid';
    if (fileType.includes('zip') || fileType.includes('archive')) return 'archive';
    
    return 'document';
  };

  const downloadFile = async () => {
    if (!file_url || !file_name) {
      Alert.alert('Error', 'File information is missing');
      return;
    }

    setIsDownloading(true);
    
    try {
      console.log('[FileMessage] downloading', { file_url, file_name });
      // Android: save to Downloads with progress notification
      // iOS: use share sheet
      if (Platform.OS === 'android') {
        // Ensure we have (and persist) access to the Downloads directory
        const getDownloadsDirUri = async (): Promise<string | null> => {
          const key = 'android_downloads_tree_uri_v1';
          const saved = await AsyncStorage.getItem(key);
          if (saved) {
            console.log('[FileMessage][Android] Using persisted directoryUri:', saved);
            return saved;
          }
          const perm = await FileSystem.StorageAccessFramework.requestDirectoryPermissionsAsync();
          console.log('[FileMessage][Android] SAF permission result:', JSON.stringify(perm));
          if (!perm.granted || !perm.directoryUri) return null;
          // Note: Expo persists SAF access for app lifetime; we store the URI for reuse
          await AsyncStorage.setItem(key, perm.directoryUri);
          console.log('[FileMessage][Android] Persisted new directoryUri:', perm.directoryUri);
          return perm.directoryUri;
        };

        // Ask for notification permission (no-op if already granted) and set channel
        try {
          await Notifications.requestPermissionsAsync();
          // Android: ensure channel exists
          await Notifications.setNotificationChannelAsync('downloads', {
            name: 'Downloads',
            importance: Notifications.AndroidImportance.DEFAULT,
            vibrationPattern: [200],
            lockscreenVisibility: Notifications.AndroidNotificationVisibility.PUBLIC,
          });
          console.log('[FileMessage][Android] Notifications permission/channel ready');
        } catch {}

        const downloadsUri = await getDownloadsDirUri();
        if (!downloadsUri) {
          Alert.alert('Permission required', 'Please select the Downloads folder to save files.');
          console.warn('[FileMessage][Android] No directoryUri selected for Downloads');
          return;
        }

        // Download with progress into cache first
        const tmpPath = (FileSystem.cacheDirectory || FileSystem.documentDirectory || '') + file_name;
        console.log('[FileMessage][Android] Temp download path:', tmpPath);
        let lastNotifId: string | null = null;
        const downloadResumable = FileSystem.createDownloadResumable(
          file_url,
          tmpPath,
          {},
          async (progress) => {
            const pct = Math.floor((progress.totalBytesWritten / Math.max(1, progress.totalBytesExpectedToWrite)) * 100);
            console.log('[FileMessage][Android] progress', {
              written: progress.totalBytesWritten,
              total: progress.totalBytesExpectedToWrite,
              pct,
            });
            try {
              // Update a progress notification
              if (!lastNotifId) {
                const id = await Notifications.scheduleNotificationAsync({
                  content: {
                    title: 'Downloading…',
                    body: `${file_name} (${pct}%)`,
                  },
                  trigger: null,
                });
                lastNotifId = id;
              } else {
                // Cancel and re-issue to simulate update
                await Notifications.dismissNotificationAsync(lastNotifId);
                lastNotifId = await Notifications.scheduleNotificationAsync({
                  content: { title: 'Downloading…', body: `${file_name} (${pct}%)` },
                  trigger: null,
                });
              }
            } catch {}
          }
        );

        const result = await downloadResumable.downloadAsync();
        console.log('[FileMessage][Android] download result:', result);
        if (!result || result.status !== 200) throw new Error('Download failed');

        try {
          const mime = file_type || 'application/octet-stream';
          const info = await FileSystem.getInfoAsync(result.uri);
          console.log('[FileMessage][Android] downloaded file info:', info);
          const base64 = await FileSystem.readAsStringAsync(result.uri, { encoding: FileSystem.EncodingType.Base64 });
          const destUri = await FileSystem.StorageAccessFramework.createFileAsync(downloadsUri, file_name, mime);
          console.log('[FileMessage][Android] created destination file:', destUri);
          await FileSystem.writeAsStringAsync(destUri, base64, { encoding: FileSystem.EncodingType.Base64 });
          console.log('[FileMessage][Android] wrote file to destination');
          // Completion notification
          try {
            if (lastNotifId) await Notifications.dismissNotificationAsync(lastNotifId);
            await Notifications.scheduleNotificationAsync({
              content: { title: 'Download complete', body: `${file_name} saved to Downloads` },
              trigger: null,
            });
          } catch {}
        } catch (e) {
          console.warn('[FileMessage][Android] Save to Downloads error', e);
          Alert.alert('Error', 'Could not save to Downloads folder.');
        }
        return;
      }

      // Always download to a temp path first (iOS/web)
      const tmpPath = (FileSystem.cacheDirectory || FileSystem.documentDirectory || '') + file_name;
      console.log('[FileMessage][iOS/web] Temp path:', tmpPath);
      const { uri: tmpUri, status } = await FileSystem.downloadAsync(file_url, tmpPath);

      if (status !== 200) throw new Error('Download failed');

      if (Platform.OS === 'ios') {
        try {
          const canShare = await Sharing.isAvailableAsync();
          console.log('[FileMessage][iOS] Sharing available:', canShare);
          if (canShare) {
            await Sharing.shareAsync(tmpUri, {
              mimeType: file_type,
              dialogTitle: 'Save or share file',
              UTI: undefined,
            });
            console.log('[FileMessage][iOS] Share sheet presented');
          } else {
            await Linking.openURL(tmpUri);
            console.log('[FileMessage][iOS] Opened tmp URI');
          }
        } catch (e) {
          console.warn('[FileMessage] iOS share error', e);
          Alert.alert('Error', 'Could not present share sheet.');
        }
      } else {
        try {
          await Linking.openURL(file_url);
          console.log('[FileMessage][web/other] Opened original URL');
        } catch {
          Alert.alert('Downloaded', 'File downloaded to temporary location.');
          console.warn('[FileMessage][web/other] Fallback alert shown');
        }
      }
      
    } catch (error) {
      console.error('Error downloading file:', error);
      Alert.alert('Error', 'Failed to download file');
    } finally {
      setIsDownloading(false);
    }
  };

  const openFullScreen = () => {
    if (file_type?.startsWith('image/') || file_type?.startsWith('video/')) {
      setShowFullScreen(true);
    } else {
      // For non-media files, try to open with system default app
      if (file_url) {
        Linking.openURL(file_url).catch(() => {
          Alert.alert('Error', 'Cannot open this file type');
        });
      }
    }
  };

  const renderFileContent = (isPreview = false) => {
    const isImage = !!file_type && file_type.startsWith('image/');
    const isVideo = !!file_type && file_type.startsWith('video/');
    console.log('[FileMessage] render', { isPreview, file_type, file_url: (file_url || '').slice(0, 80) + '...' });

    if (isImage && file_url) {
      console.log('[FileMessage] rendering image', { isPreview });
      return (
        <TouchableOpacity onPress={isPreview ? undefined : openFullScreen}>
          <View style={[styles.mediaWrapper, isPreview ? styles.fullMediaWrapper : styles.thumbMediaWrapper]}>
            <ExpoImage
              source={{ uri: file_url }}
              style={isPreview ? styles.fullScreenImage : styles.thumbnailImage}
              contentFit="cover"
              onLoadStart={() => (isPreview ? setFullLoading(true) : setThumbLoading(true))}
              onLoadEnd={() => (isPreview ? setFullLoading(false) : setThumbLoading(false))}
              onError={() => (isPreview ? setFullLoading(false) : setThumbLoading(false))}
              transition={150}
            />
            {(isPreview ? fullLoading : thumbLoading) && (
              <View style={styles.spinnerOverlay}>
                <ActivityIndicator size={isPreview ? 'large' : 'small'} color="#FFFFFF" />
              </View>
            )}
          </View>
        </TouchableOpacity>
      );
    }
    
    if (isVideo && file_url) {
      console.log('[FileMessage] rendering video', { isPreview });
      return (
        <TouchableOpacity onPress={isPreview ? undefined : openFullScreen}>
          <View style={[styles.mediaWrapper, isPreview ? styles.fullMediaWrapper : styles.thumbMediaWrapper]}>
            <Video
              source={{ uri: file_url }}
              style={isPreview ? styles.fullScreenVideo : styles.thumbnailVideo}
              useNativeControls={isPreview}
              resizeMode={ResizeMode.COVER}
              shouldPlay={isPreview}
              onLoadStart={() => (isPreview ? setFullLoading(true) : setThumbLoading(true))}
              onLoad={() => (isPreview ? setFullLoading(false) : setThumbLoading(false))}
              onError={() => (isPreview ? setFullLoading(false) : setThumbLoading(false))}
            />
            {(isPreview ? fullLoading : thumbLoading) && (
              <View style={styles.spinnerOverlay}>
                <ActivityIndicator size={isPreview ? 'large' : 'small'} color="#FFFFFF" />
              </View>
            )}
          </View>
        </TouchableOpacity>
      );
    }
    
    console.log('[FileMessage] rendering doc icon');
    // For other file types, show icon only here; filename will be rendered in the common meta section below
    return (
      <TouchableOpacity style={styles.documentContainer} onPress={openFullScreen}>
        <Ionicons
          name={getFileIcon(file_type) as any}
          size={isPreview ? 60 : 48}
          color={isDark ? '#9CA3AF' : '#6B7280'}
        />
      </TouchableOpacity>
    );
  };

  return (
    <>
      <View style={[
        styles.container,
        isOutgoing ? styles.outgoingContainer : styles.incomingContainer,
        isDark && styles.containerDark,
      ]}>
        <View style={styles.previewWrapper}>
          {renderFileContent()}
        </View>

        <View style={styles.metaSection}>
          {!!file_name && (
            <Text
              style={[styles.fileTitle, isDark && styles.fileNameDark]}
              numberOfLines={1}
              ellipsizeMode="tail"
            >
              {file_name}
            </Text>
          )}
          {!!file_size && (
            <Text style={[styles.fileSize, isDark && styles.fileSizeDark]}>
              {formatFileSize(file_size)}
            </Text>
          )}

          {!isOutgoing && (
            <TouchableOpacity onPress={downloadFile} disabled={isDownloading}>
              <Text style={[styles.downloadLink, isDark && styles.downloadLinkDark]}>
                {isDownloading ? 'Downloading…' : 'Download'}
              </Text>
            </TouchableOpacity>
          )}
          
          {/* Status indicator */}
          <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'flex-end', marginTop: 4 }}>
            <MessageStatusIndicator 
              status={status} 
              isOutgoing={isOutgoing} 
              size={10} 
              showText={showStatusText}
            />
          </View>
        </View>
      </View>

      {/* Full Screen Preview Modal */}
      <Modal
        visible={showFullScreen}
        transparent
        animationType="fade"
        onRequestClose={() => setShowFullScreen(false)}
      >
        <View style={styles.fullScreenOverlay}>
          <View style={styles.fullScreenHeader}>
            <TouchableOpacity
              style={styles.closeButton}
              onPress={() => setShowFullScreen(false)}
            >
              <Ionicons name="close" size={24} color="white" />
            </TouchableOpacity>
          </View>
          
          <View style={styles.fullScreenContent}>
            {renderFileContent(true)}
          </View>
          
          <View style={styles.fullScreenFooter}>
            <Text style={styles.fullScreenFileName} numberOfLines={2}>
              {file_name}
            </Text>
            {!isOutgoing && (
              <TouchableOpacity
                style={styles.fullScreenDownloadButton}
                onPress={downloadFile}
                disabled={isDownloading}
              >
                <Text style={styles.downloadButtonText}>Download</Text>
              </TouchableOpacity>
            )}
          </View>
        </View>
      </Modal>
    </>
  );
}

const { width, height } = Dimensions.get('window');

const styles = StyleSheet.create({
  container: {
    flexDirection: 'column',
    alignItems: 'stretch',
    padding: 12,
    borderRadius: 12,
    marginVertical: 2,
    maxWidth: '80%',
  },
  outgoingContainer: {
    backgroundColor: '#3B82F6',
    alignSelf: 'flex-end',
  },
  incomingContainer: {
    backgroundColor: '#F3F4F6',
    alignSelf: 'flex-start',
  },
  containerDark: {
    backgroundColor: '#374151',
  },
  thumbnailImage: {
    width: 60,
    height: 60,
    borderRadius: 8,
    marginRight: 12,
  },
  thumbnailVideo: {
    width: 60,
    height: 60,
    borderRadius: 8,
    marginRight: 12,
  },
  documentContainer: {
    alignItems: 'center',
    marginRight: 12,
    minWidth: 60,
  },
  previewWrapper: {
    marginBottom: 6,
  },
  metaSection: {
    width: '100%',
  },
  fileInfo: {
    flex: 1,
    marginRight: 8,
  },
  fileTitle: {
    fontSize: 14,
    fontWeight: '600',
    color: '#111827',
    marginBottom: 2,
  },
  fileName: {
    fontSize: 14,
    fontWeight: '600',
    color: '#111827',
    marginBottom: 2,
  },
  fileNameDark: {
    color: '#F9FAFB',
  },
  fileNameSmall: {
    fontSize: 12,
    fontWeight: '500',
    color: '#111827',
    textAlign: 'center',
    marginTop: 4,
  },
  fileNameLarge: {
    fontSize: 16,
    fontWeight: '600',
    color: '#111827',
    textAlign: 'center',
    marginTop: 8,
  },
  fileSize: {
    fontSize: 12,
    color: '#6B7280',
  },
  fileSizeDark: {
    color: '#9CA3AF',
  },
  downloadLink: {
    marginTop: 6,
    fontSize: 13,
    fontWeight: '600',
    color: '#2563EB',
  },
  downloadLinkDark: {
    color: '#93C5FD',
  },
  downloadButton: {
    padding: 8,
    borderRadius: 6,
    backgroundColor: 'rgba(255, 255, 255, 0.2)',
  },
  downloadButtonDark: {
    backgroundColor: 'rgba(0, 0, 0, 0.2)',
  },
  fullScreenOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.9)',
    justifyContent: 'center',
  },
  fullScreenHeader: {
    position: 'absolute',
    top: 50,
    right: 20,
    zIndex: 1,
  },
  closeButton: {
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
    borderRadius: 20,
    padding: 8,
  },
  fullScreenContent: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 20,
  },
  fullScreenImage: {
    width: width - 40,
    height: height * 0.7,
    borderRadius: 8,
  },
  fullScreenVideo: {
    width: width - 40,
    height: height * 0.7,
    borderRadius: 8,
  },
  mediaWrapper: {
    position: 'relative',
    justifyContent: 'center',
    alignItems: 'center',
  },
  thumbMediaWrapper: {
    width: 60,
    height: 60,
  },
  fullMediaWrapper: {
    width: width - 40,
    height: height * 0.7,
  },
  spinnerOverlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: 'rgba(0,0,0,0.25)',
    justifyContent: 'center',
    alignItems: 'center',
    borderRadius: 8,
  },
  fullScreenFooter: {
    position: 'absolute',
    bottom: 50,
    left: 20,
    right: 20,
    alignItems: 'center',
  },
  fullScreenFileName: {
    color: 'white',
    fontSize: 16,
    fontWeight: '600',
    textAlign: 'center',
    marginBottom: 16,
  },
  fullScreenDownloadButton: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#3B82F6',
    paddingHorizontal: 20,
    paddingVertical: 12,
    borderRadius: 8,
  },
  downloadButtonText: {
    color: 'white',
    fontSize: 16,
    fontWeight: '600',
    marginLeft: 8,
  },
});
