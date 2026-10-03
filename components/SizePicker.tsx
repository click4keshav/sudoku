import { useState } from 'react';
import {
  Modal,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import type { BoardLayout } from '../lib/boardLayouts';
import { BOARD_LAYOUTS } from '../lib/boardLayouts';

type SizePickerProps = {
  layout: BoardLayout;
  onChange: (layout: BoardLayout) => void;
};

export default function SizePicker({ layout, onChange }: SizePickerProps) {
  const [open, setOpen] = useState(false);

  return (
    <View style={styles.wrap}>
      <Text style={styles.heading}>Choose Your Game</Text>
      <Pressable
        onPress={() => setOpen(true)}
        style={styles.trigger}
        accessibilityRole="button"
        accessibilityLabel={`Select game type, currently ${layout.label}`}
      >
        <Text style={styles.triggerLabel} numberOfLines={1}>
          {layout.label}
        </Text>
        <Text style={styles.chevron}>▾</Text>
      </Pressable>

      <Modal
        visible={open}
        transparent
        animationType="fade"
        onRequestClose={() => setOpen(false)}
      >
        <View style={styles.backdrop}>
          <Pressable
            style={StyleSheet.absoluteFill}
            onPress={() => setOpen(false)}
            accessibilityLabel="Dismiss game type menu"
          />
          <View style={styles.menu}>
            {BOARD_LAYOUTS.map((option) => {
              const selected = option.size === layout.size;
              return (
                <Pressable
                  key={option.label}
                  onPress={() => {
                    onChange(option);
                    setOpen(false);
                  }}
                  style={[styles.option, selected && styles.optionSelected]}
                  accessibilityRole="button"
                  accessibilityState={{ selected }}
                  accessibilityLabel={option.label}
                >
                  <Text
                    style={[
                      styles.optionLabel,
                      selected && styles.optionLabelSelected,
                    ]}
                  >
                    {option.label}
                  </Text>
                </Pressable>
              );
            })}
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    width: '100%',
    maxWidth: 420,
    marginBottom: 16,
    gap: 8,
    zIndex: 2,
  },
  heading: {
    fontSize: 16,
    fontWeight: '600',
    color: '#111111',
  },
  trigger: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 12,
    paddingHorizontal: 14,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#C8C8C8',
    backgroundColor: '#FFFFFF',
  },
  triggerLabel: {
    flex: 1,
    fontSize: 16,
    fontWeight: '600',
    color: '#111111',
  },
  chevron: {
    marginLeft: 8,
    fontSize: 16,
    color: '#111111',
  },
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.35)',
    justifyContent: 'center',
    paddingHorizontal: 24,
  },
  menu: {
    backgroundColor: '#FFFFFF',
    borderRadius: 12,
    overflow: 'hidden',
  },
  option: {
    paddingVertical: 14,
    paddingHorizontal: 16,
  },
  optionSelected: {
    backgroundColor: '#111111',
  },
  optionLabel: {
    fontSize: 16,
    fontWeight: '600',
    color: '#111111',
  },
  optionLabelSelected: {
    color: '#FFFFFF',
  },
});
