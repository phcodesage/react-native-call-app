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
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
// Using expo-av for now, will migrate to expo-video in SDK 54
import { Video, ResizeMode } from 'expo-av';
import * as FileSystem from 'expo-file-system';
import { Image as ExpoImage } from 'expo-image';

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
}: FileMessageProps) {
  const [showFullScreen, setShowFullScreen] = useState(false);
  const [isDownloading, setIsDownloading] = useState(false);

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
      const downloadUri = FileSystem.documentDirectory + file_name;
      
      const downloadResult = await FileSystem.downloadAsync(file_url, downloadUri);
      
      if (downloadResult.status === 200) {
        console.log('[FileMessage] downloaded to', downloadResult.uri);
        // Try to open the downloaded file with the system if possible; otherwise show the saved path
        try {
          const opened = await Linking.openURL(downloadResult.uri);
          if (!opened) {
            Alert.alert('Success', `File downloaded to: ${downloadResult.uri}`);
          }
        } catch {
          Alert.alert('Success', `File downloaded to: ${downloadResult.uri}`);
        }
      } else {
        throw new Error('Download failed');
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
          <ExpoImage
            source={{ uri: file_url }}
            style={isPreview ? styles.fullScreenImage : styles.thumbnailImage}
            contentFit="cover"
          />
        </TouchableOpacity>
      );
    }
    
    if (isVideo && file_url) {
      console.log('[FileMessage] rendering video', { isPreview });
      return (
        <TouchableOpacity onPress={isPreview ? undefined : openFullScreen}>
          <Video
            source={{ uri: file_url }}
            style={isPreview ? styles.fullScreenVideo : styles.thumbnailVideo}
            useNativeControls={isPreview}
            resizeMode={ResizeMode.COVER}
            shouldPlay={isPreview}
          />
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
