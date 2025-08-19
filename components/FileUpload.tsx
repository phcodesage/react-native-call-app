import React, { useState, useRef } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  Modal,
  Image,
  Alert,
  StyleSheet,
  ActivityIndicator,
  Dimensions,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import * as DocumentPicker from 'expo-document-picker';
import * as ImagePicker from 'expo-image-picker';
// Using expo-av for now, will migrate to expo-video in SDK 54
import { Video, ResizeMode } from 'expo-av';

interface FileUploadProps {
  onFileSend: (fileData: {
    uri: string;
    name: string;
    type: string;
    size: number;
  }) => void;
  isDark: boolean;
}

interface SelectedFile {
  uri: string;
  name: string;
  type: string;
  size: number;
}

export default function FileUpload({ onFileSend, isDark }: FileUploadProps) {
  const [showModal, setShowModal] = useState(false);
  const [selectedFile, setSelectedFile] = useState<SelectedFile | null>(null);
  const [isUploading, setIsUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [showPreview, setShowPreview] = useState(false);

  const formatFileSize = (bytes: number): string => {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  };

  const pickDocument = async () => {
    try {
      const result = await DocumentPicker.getDocumentAsync({
        type: '*/*',
        copyToCacheDirectory: true,
      });

      if (!result.canceled && result.assets && result.assets.length > 0) {
        const file = result.assets[0];
        setSelectedFile({
          uri: file.uri,
          name: file.name,
          type: file.mimeType || 'application/octet-stream',
          size: file.size || 0,
        });
        setShowPreview(true);
      }
    } catch (error) {
      console.error('Error picking document:', error);
      Alert.alert('Error', 'Failed to pick document');
    }
  };

  const pickImage = async () => {
    try {
      const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (status !== 'granted') {
        Alert.alert('Permission Required', 'Sorry, we need camera roll permissions to make this work!');
        return;
      }

      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ImagePicker.MediaTypeOptions.All,
        allowsEditing: true,
        aspect: [4, 3],
        quality: 0.8,
      });

      if (!result.canceled && result.assets && result.assets.length > 0) {
        const asset = result.assets[0];
        setSelectedFile({
          uri: asset.uri,
          name: `image_${Date.now()}.${asset.type === 'video' ? 'mp4' : 'jpg'}`,
          type: asset.type === 'video' ? 'video/mp4' : 'image/jpeg',
          size: asset.fileSize || 0,
        });
        setShowPreview(true);
      }
    } catch (error) {
      console.error('Error picking image:', error);
      Alert.alert('Error', 'Failed to pick image');
    }
  };

  const takePhoto = async () => {
    try {
      const { status } = await ImagePicker.requestCameraPermissionsAsync();
      if (status !== 'granted') {
        Alert.alert('Permission Required', 'Sorry, we need camera permissions to make this work!');
        return;
      }

      const result = await ImagePicker.launchCameraAsync({
        allowsEditing: true,
        aspect: [4, 3],
        quality: 0.8,
      });

      if (!result.canceled && result.assets && result.assets.length > 0) {
        const asset = result.assets[0];
        setSelectedFile({
          uri: asset.uri,
          name: `photo_${Date.now()}.jpg`,
          type: 'image/jpeg',
          size: asset.fileSize || 0,
        });
        setShowPreview(true);
      }
    } catch (error) {
      console.error('Error taking photo:', error);
      Alert.alert('Error', 'Failed to take photo');
    }
  };

  const sendFile = async () => {
    if (!selectedFile) return;

    setIsUploading(true);
    setUploadProgress(0);

    try {
      // Simulate upload progress
      const progressInterval = setInterval(() => {
        setUploadProgress(prev => {
          if (prev >= 90) {
            clearInterval(progressInterval);
            return prev;
          }
          return prev + 10;
        });
      }, 200);

      // Call the parent's file send handler
      await onFileSend(selectedFile);
      
      setUploadProgress(100);
      
      // Close modals after successful upload
      setTimeout(() => {
        setShowPreview(false);
        setShowModal(false);
        setSelectedFile(null);
        setIsUploading(false);
        setUploadProgress(0);
      }, 1000);

    } catch (error) {
      console.error('Error sending file:', error);
      Alert.alert('Error', 'Failed to send file');
      setIsUploading(false);
      setUploadProgress(0);
    }
  };

  const renderFilePreview = () => {
    if (!selectedFile) return null;

    const isImage = selectedFile.type.startsWith('image/');
    const isVideo = selectedFile.type.startsWith('video/');

    return (
      <View style={[styles.previewContainer, isDark && styles.previewContainerDark]}>
        {isImage && (
          <Image 
            source={{ uri: selectedFile.uri }} 
            style={styles.imagePreview}
            resizeMode={ResizeMode.CONTAIN}
          />
        )}
        {isVideo && (
          <Video
            source={{ uri: selectedFile.uri }}
            style={styles.videoPreview}
            useNativeControls
            resizeMode={ResizeMode.CONTAIN}
          />
        )}
        {!isImage && !isVideo && (
          <View style={styles.documentPreview}>
            <Ionicons 
              name="document" 
              size={60} 
              color={isDark ? '#9CA3AF' : '#6B7280'} 
            />
          </View>
        )}
        
        <View style={styles.fileInfo}>
          <Text style={[styles.fileName, isDark && styles.fileNameDark]} numberOfLines={2}>
            {selectedFile.name}
          </Text>
          <Text style={[styles.fileSize, isDark && styles.fileSizeDark]}>
            {formatFileSize(selectedFile.size)}
          </Text>
        </View>

        {isUploading && (
          <View style={styles.progressContainer}>
            <View style={[styles.progressBar, isDark && styles.progressBarDark]}>
              <View 
                style={[styles.progressFill, { width: `${uploadProgress}%` }]} 
              />
            </View>
            <Text style={[styles.progressText, isDark && styles.progressTextDark]}>
              {uploadProgress}%
            </Text>
          </View>
        )}

        <View style={styles.previewActions}>
          <TouchableOpacity
            style={[styles.cancelButton, isDark && styles.cancelButtonDark]}
            onPress={() => {
              setShowPreview(false);
              setSelectedFile(null);
              setIsUploading(false);
              setUploadProgress(0);
            }}
            disabled={isUploading}
          >
            <Text style={[styles.cancelButtonText, isDark && styles.cancelButtonTextDark]}>
              Cancel
            </Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={[
              styles.sendButton,
              isUploading && styles.sendButtonDisabled
            ]}
            onPress={sendFile}
            disabled={isUploading}
          >
            {isUploading ? (
              <ActivityIndicator color="white" size="small" />
            ) : (
              <Text style={styles.sendButtonText}>Send File</Text>
            )}
          </TouchableOpacity>
        </View>
      </View>
    );
  };

  return (
    <>
      {/* File Upload Button */}
      <TouchableOpacity
        style={[styles.attachButton, isDark && styles.attachButtonDark]}
        onPress={() => setShowModal(true)}
      >
        <Ionicons 
          name="attach" 
          size={24} 
          color={isDark ? '#9CA3AF' : '#6B7280'} 
        />
      </TouchableOpacity>

      {/* File Selection Modal */}
      <Modal
        visible={showModal}
        transparent
        animationType="slide"
        onRequestClose={() => setShowModal(false)}
      >
        <View style={styles.modalOverlay}>
          <View style={[styles.modalContent, isDark && styles.modalContentDark]}>
            <View style={styles.modalHeader}>
              <Text style={[styles.modalTitle, isDark && styles.modalTitleDark]}>
                Select File
              </Text>
              <TouchableOpacity onPress={() => setShowModal(false)}>
                <Ionicons 
                  name="close" 
                  size={24} 
                  color={isDark ? '#9CA3AF' : '#6B7280'} 
                />
              </TouchableOpacity>
            </View>

            <View style={styles.optionsContainer}>
              <TouchableOpacity style={styles.option} onPress={takePhoto}>
                <Ionicons name="camera" size={32} color="#3B82F6" />
                <Text style={[styles.optionText, isDark && styles.optionTextDark]}>
                  Take Photo
                </Text>
              </TouchableOpacity>

              <TouchableOpacity style={styles.option} onPress={pickImage}>
                <Ionicons name="image" size={32} color="#10B981" />
                <Text style={[styles.optionText, isDark && styles.optionTextDark]}>
                  Photo/Video
                </Text>
              </TouchableOpacity>

              <TouchableOpacity style={styles.option} onPress={pickDocument}>
                <Ionicons name="document" size={32} color="#F59E0B" />
                <Text style={[styles.optionText, isDark && styles.optionTextDark]}>
                  Document
                </Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      {/* File Preview Modal */}
      <Modal
        visible={showPreview}
        transparent
        animationType="slide"
        onRequestClose={() => {
          if (!isUploading) {
            setShowPreview(false);
            setSelectedFile(null);
          }
        }}
      >
        <View style={styles.modalOverlay}>
          <View style={[styles.previewModal, isDark && styles.previewModalDark]}>
            {renderFilePreview()}
          </View>
        </View>
      </Modal>
    </>
  );
}

const { width } = Dimensions.get('window');

const styles = StyleSheet.create({
  attachButton: {
    padding: 8,
    borderRadius: 20,
    backgroundColor: '#F3F4F6',
    marginRight: 8,
  },
  attachButtonDark: {
    backgroundColor: '#374151',
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  modalContent: {
    backgroundColor: 'white',
    borderRadius: 16,
    padding: 20,
    width: width * 0.9,
    maxWidth: 400,
  },
  modalContentDark: {
    backgroundColor: '#1F2937',
  },
  modalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 20,
  },
  modalTitle: {
    fontSize: 18,
    fontWeight: 'bold',
    color: '#111827',
  },
  modalTitleDark: {
    color: '#F9FAFB',
  },
  optionsContainer: {
    flexDirection: 'row',
    justifyContent: 'space-around',
  },
  option: {
    alignItems: 'center',
    padding: 16,
    borderRadius: 12,
    backgroundColor: '#F9FAFB',
    minWidth: 80,
  },
  optionText: {
    marginTop: 8,
    fontSize: 14,
    color: '#374151',
    textAlign: 'center',
  },
  optionTextDark: {
    color: '#D1D5DB',
  },
  previewModal: {
    backgroundColor: 'white',
    borderRadius: 16,
    padding: 20,
    width: width * 0.95,
    maxWidth: 500,
    maxHeight: '80%',
  },
  previewModalDark: {
    backgroundColor: '#1F2937',
  },
  previewContainer: {
    alignItems: 'center',
  },
  previewContainerDark: {
    backgroundColor: '#1F2937',
  },
  imagePreview: {
    width: '100%',
    height: 200,
    borderRadius: 12,
    marginBottom: 16,
  },
  videoPreview: {
    width: '100%',
    height: 200,
    borderRadius: 12,
    marginBottom: 16,
  },
  documentPreview: {
    width: '100%',
    height: 120,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#F3F4F6',
    borderRadius: 12,
    marginBottom: 16,
  },
  fileInfo: {
    alignItems: 'center',
    marginBottom: 20,
  },
  fileName: {
    fontSize: 16,
    fontWeight: '600',
    color: '#111827',
    textAlign: 'center',
    marginBottom: 4,
  },
  fileNameDark: {
    color: '#F9FAFB',
  },
  fileSize: {
    fontSize: 14,
    color: '#6B7280',
  },
  fileSizeDark: {
    color: '#9CA3AF',
  },
  progressContainer: {
    width: '100%',
    marginBottom: 20,
  },
  progressBar: {
    height: 8,
    backgroundColor: '#E5E7EB',
    borderRadius: 4,
    overflow: 'hidden',
    marginBottom: 8,
  },
  progressBarDark: {
    backgroundColor: '#374151',
  },
  progressFill: {
    height: '100%',
    backgroundColor: '#3B82F6',
    borderRadius: 4,
  },
  progressText: {
    textAlign: 'center',
    fontSize: 14,
    color: '#6B7280',
  },
  progressTextDark: {
    color: '#9CA3AF',
  },
  previewActions: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    width: '100%',
  },
  cancelButton: {
    flex: 1,
    padding: 12,
    borderRadius: 8,
    backgroundColor: '#F3F4F6',
    marginRight: 8,
    alignItems: 'center',
  },
  cancelButtonDark: {
    backgroundColor: '#374151',
  },
  cancelButtonText: {
    color: '#6B7280',
    fontWeight: '600',
  },
  cancelButtonTextDark: {
    color: '#9CA3AF',
  },
  sendButton: {
    flex: 1,
    padding: 12,
    borderRadius: 8,
    backgroundColor: '#3B82F6',
    marginLeft: 8,
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'center',
  },
  sendButtonDisabled: {
    backgroundColor: '#9CA3AF',
  },
  sendButtonText: {
    color: 'white',
    fontWeight: '600',
  },
});
