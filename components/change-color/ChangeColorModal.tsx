// components/change-color/ChangeColorModal.tsx
import React, { useMemo, useState } from 'react';
import { Modal, View, Text, TouchableOpacity, StyleSheet, TextInput } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

type Props = {
  visible: boolean;
  isDark: boolean;
  initialColor?: string | null;
  onClose: () => void;
  onApply: (hex: string | null) => void;
  onReset: () => void;
};

const SWATCHES = [
  '#FF5733', '#33FF57', '#3357FF', '#F333FF', '#FFFF33',
  '#33FFFF', '#FF33FF', '#33FFAA', '#AA33FF', '#FFAA33',
];

export default function ChangeColorModal({
  visible,
  isDark,
  initialColor,
  onClose,
  onApply,
  onReset,
}: Props) {
  const [selectedColor, setSelectedColor] = useState<string | null>(initialColor ?? null);

  const previewStyle = useMemo(
    () => ({
      backgroundColor: selectedColor ?? (isDark ? '#111827' : '#000000'),
      borderColor: isDark ? '#9ca3af' : '#e5e7eb',
    }),
    [selectedColor, isDark]
  );

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={onClose}
    >
      <View style={styles.modalOverlay}>
        <View style={[
          styles.container,
          { backgroundColor: isDark ? '#1f2937' : '#f3f4f6' }
        ]}>
          <View style={styles.header}>
            <Text style={[styles.title, { color: isDark ? '#f3f4f6' : '#111827' }]}>
              Choose Background Color
            </Text>
            <TouchableOpacity onPress={onClose}>
              <Ionicons name="close" size={18} color={isDark ? '#f3f4f6' : '#111827'} />
            </TouchableOpacity>
          </View>

          <Text style={[styles.subtitle, { color: isDark ? '#d1d5db' : '#6b7280' }]}>
            {selectedColor ? selectedColor : 'No color selected'}
          </Text>

          {/* Swatches */}
          <View style={styles.swatchGrid}>
            {SWATCHES.map((c) => {
              const isSelected = selectedColor === c;
              return (
                <TouchableOpacity
                  key={c}
                  onPress={() => setSelectedColor(c)}
                  style={[
                    styles.swatch,
                    { backgroundColor: c, borderColor: isDark ? '#374151' : '#6b7280' },
                    isSelected && styles.swatchSelected,
                  ]}
                />
              );
            })}
          </View>

          {/* Preview */}
          <View style={[styles.preview, previewStyle]} />

          {/* Hex input */}
          <TextInput
            style={[
              styles.hexInput,
              {
                color: isDark ? '#f3f4f6' : '#111827',
                borderColor: isDark ? '#9ca3af' : '#e5e7eb',
                backgroundColor: isDark ? '#111827' : '#000000',
              },
            ]}
            value={selectedColor ?? ''}
            placeholder="#000000"
            placeholderTextColor={isDark ? '#9ca3af' : '#9ca3af'}
            autoCapitalize="none"
            autoCorrect={false}
            onChangeText={(t) => {
              const v = t.startsWith('#') ? t : `#${t}`;
              const valid = /^#([0-9A-Fa-f]{3}|[0-9A-Fa-f]{6})$/.test(v);
              if (valid) setSelectedColor(v);
            }}
          />

          {/* Footer */}
          <View style={styles.footer}>
            <TouchableOpacity
              style={[styles.btn, { backgroundColor: '#6b7280' }]}
              onPress={() => { onReset(); onClose(); }}
            >
              <Text style={styles.btnText}>Cancel</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.btn, { backgroundColor: '#8b5cf6', opacity: selectedColor ? 1 : 0.6 }]}
              disabled={!selectedColor}
              onPress={() => { onApply(selectedColor); onClose(); }}
            >
              <Text style={styles.btnText}>Send Color</Text>
            </TouchableOpacity>
          </View>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  modalOverlay: {
    flex: 1, alignItems: 'center', justifyContent: 'center',
    backgroundColor: 'rgba(0,0,0,0.5)',
    paddingHorizontal: 20,
  },
  container: {
    width: '100%', borderRadius: 16, padding: 16,
  },
  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    marginBottom: 8,
  },
  title: { fontSize: 16, fontWeight: '600' },
  subtitle: { fontSize: 12, marginBottom: 12, textAlign: 'center' },
  swatchGrid: {
    flexDirection: 'row', flexWrap: 'wrap', gap: 8, justifyContent: 'space-between', marginBottom: 12,
  },
  swatch: {
    width: 44, height: 44, borderRadius: 8, borderWidth: 2,
  },
  swatchSelected: {
    borderColor: '#ffffff',
  },
  preview: {
    height: 40, borderRadius: 8, borderWidth: 1, marginBottom: 12,
  },
  hexInput: {
    borderWidth: 1, borderRadius: 8, paddingVertical: 8, paddingHorizontal: 10, marginBottom: 14,
  },
  footer: {
    flexDirection: 'row', justifyContent: 'space-between',
  },
  btn: { paddingVertical: 10, paddingHorizontal: 16, borderRadius: 8 },
  btnText: { color: 'white', fontWeight: '600' },
});