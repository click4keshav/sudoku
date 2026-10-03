import { SymbolView } from 'expo-symbols';
import { Pressable, StyleSheet, Text, View } from 'react-native';

type KeypadProps = {
  size: number;
  notesMode: boolean;
  onNotesModeChange: (value: boolean) => void;
  onDigit: (digit: number) => void;
  onErase: () => void;
};

export default function Keypad({
  size,
  notesMode,
  onNotesModeChange,
  onDigit,
  onErase,
}: KeypadProps) {
  const digits = Array.from({ length: size }, (_, index) => index + 1);

  return (
    <View style={styles.wrap}>
      <View style={styles.digits}>
        {digits.map((digit) => (
          <Pressable
            key={digit}
            onPress={() => onDigit(digit)}
            style={({ pressed }) => [styles.digit, pressed && styles.pressed]}
            accessibilityRole="button"
            accessibilityLabel={`Number ${digit}`}
          >
            <Text style={styles.digitLabel}>{digit}</Text>
          </Pressable>
        ))}
      </View>

      <View style={styles.actions}>
        <Pressable
          onPress={onErase}
          style={({ pressed }) => [styles.iconButton, pressed && styles.pressed]}
          accessibilityRole="button"
          accessibilityLabel="Erase"
        >
          <SymbolView
            name={{ ios: 'eraser', android: 'ink_eraser', web: 'ink_eraser' }}
            size={26}
            tintColor="#111111"
            fallback={<Text style={styles.fallbackIcon}>⌫</Text>}
          />
        </Pressable>

        <Pressable
          onPress={() => onNotesModeChange(!notesMode)}
          style={({ pressed }) => [
            styles.iconButton,
            notesMode && styles.iconButtonOn,
            pressed && styles.pressed,
          ]}
          accessibilityRole="button"
          accessibilityState={{ selected: notesMode }}
          accessibilityLabel="Notes or pencil mode"
        >
          <SymbolView
            name={{ ios: 'pencil', android: 'edit', web: 'edit' }}
            size={26}
            tintColor={notesMode ? '#FFFFFF' : '#111111'}
            fallback={
              <Text
                style={[
                  styles.fallbackIcon,
                  notesMode && styles.fallbackIconOn,
                ]}
              >
                ✎
              </Text>
            }
          />
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    width: '100%',
    maxWidth: 420,
    gap: 16,
    marginTop: 20,
    alignItems: 'center',
  },
  digits: {
    width: '100%',
    flexDirection: 'row',
    flexWrap: 'nowrap',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
  },
  digit: {
    flex: 1,
    minWidth: 0,
    height: 48,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#C8C8C8',
    backgroundColor: '#F7F7F7',
  },
  digitLabel: {
    fontSize: 20,
    lineHeight: 24,
    fontWeight: '600',
    color: '#111111',
    textAlign: 'center',
    includeFontPadding: false,
    textAlignVertical: 'center',
  },
  actions: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 16,
  },
  iconButton: {
    width: 48,
    height: 48,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#C8C8C8',
    backgroundColor: '#F7F7F7',
  },
  iconButtonOn: {
    backgroundColor: '#111111',
    borderColor: '#111111',
  },
  fallbackIcon: {
    fontSize: 22,
    color: '#111111',
    textAlign: 'center',
    includeFontPadding: false,
  },
  fallbackIconOn: {
    color: '#FFFFFF',
  },
  pressed: {
    opacity: 0.7,
  },
});
