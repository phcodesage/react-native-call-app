import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet, Modal } from 'react-native';

interface EmojiPickerProps {
  isVisible: boolean;
  onClose: () => void;
  onSelectEmoji: (emoji: string) => void;
}

const EMOJIS = ['👍', '😂', '😍', '😮', '😢', '😡', '🙏', '🎉', '🔥', '❤️'];

export const EmojiPicker: React.FC<EmojiPickerProps> = ({ isVisible, onClose, onSelectEmoji }) => {
  return (
    <Modal
      transparent={true}
      visible={isVisible}
      animationType="fade"
      onRequestClose={onClose}
    >
      <TouchableOpacity style={styles.overlay} onPress={onClose}>
        <View style={styles.pickerContainer}>
          <View style={styles.emojiGrid}>
            {EMOJIS.map((emoji) => (
              <TouchableOpacity key={emoji} onPress={() => onSelectEmoji(emoji)} style={styles.emojiButton}>
                <Text style={styles.emojiText}>{emoji}</Text>
              </TouchableOpacity>
            ))}
          </View>
        </View>
      </TouchableOpacity>
    </Modal>
  );
};

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  pickerContainer: {
    backgroundColor: '#fff',
    borderRadius: 16,
    padding: 16,
    width: '80%',
    maxWidth: 300,
  },
  emojiGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'center',
  },
  emojiButton: {
    padding: 8,
    margin: 4,
  },
  emojiText: {
    fontSize: 24,
  },
});
