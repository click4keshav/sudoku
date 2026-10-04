import { Pressable, StyleSheet, Text, View } from 'react-native';

type KeypadProps = {
  size: number;
  notesMode: boolean;
  remainingCounts: Record<number, number>;
  canUndo: boolean;
  onNotesModeChange: (value: boolean) => void;
  onDigit: (digit: number) => void;
  onErase: () => void;
  onUndo: () => void;
  onHint: () => void;
};

export default function Keypad({
  size,
  notesMode,
  remainingCounts,
  canUndo,
  onNotesModeChange,
  onDigit,
  onErase,
  onUndo,
  onHint,
}: KeypadProps) {
  const digits = Array.from({ length: size }, (_, index) => index + 1);

  return (
    <View style={styles.wrap}>
      {/* 4 Action Helper Buttons */}
      <View style={styles.actions}>
        <Pressable
          onPress={onUndo}
          disabled={!canUndo}
          style={({ pressed }) => [
            styles.actionBtn,
            !canUndo && styles.actionBtnDisabled,
            pressed && canUndo && styles.pressed,
          ]}
          accessibilityRole="button"
          accessibilityLabel="Undo move"
        >
          <Text style={[styles.actionIcon, !canUndo && styles.iconDisabled]}>↶</Text>
          <Text style={[styles.actionLabel, !canUndo && styles.iconDisabled]}>Undo</Text>
        </Pressable>

        <Pressable
          onPress={onErase}
          style={({ pressed }) => [styles.actionBtn, pressed && styles.pressed]}
          accessibilityRole="button"
          accessibilityLabel="Erase"
        >
          <Text style={styles.actionIcon}>⌫</Text>
          <Text style={styles.actionLabel}>Erase</Text>
        </Pressable>

        <Pressable
          onPress={() => onNotesModeChange(!notesMode)}
          style={({ pressed }) => [
            styles.actionBtn,
            notesMode && styles.actionBtnActive,
            pressed && styles.pressed,
          ]}
          accessibilityRole="button"
          accessibilityLabel="Notes Pencil Mode"
        >
          <Text style={[styles.actionIcon, notesMode && styles.iconActive]}>✎</Text>
          <Text style={[styles.actionLabel, notesMode && styles.iconActive]}>
            Notes {notesMode ? 'ON' : 'OFF'}
          </Text>
        </Pressable>

        <Pressable
          onPress={onHint}
          style={({ pressed }) => [styles.actionBtn, pressed && styles.pressed]}
          accessibilityRole="button"
          accessibilityLabel="Hint"
        >
          <Text style={styles.actionIcon}>💡</Text>
          <Text style={styles.actionLabel}>Hint</Text>
        </Pressable>
      </View>

      {/* Number Pad with Remaining Count Badges */}
      <View style={styles.digits}>
        {digits.map((digit) => {
          const remaining = remainingCounts[digit] ?? size;
          const isDone = remaining <= 0;

          return (
            <Pressable
              key={digit}
              onPress={() => !isDone && onDigit(digit)}
              disabled={isDone}
              style={({ pressed }) => [
                styles.digit,
                isDone && styles.digitDone,
                pressed && !isDone && styles.pressed,
              ]}
              accessibilityRole="button"
              accessibilityLabel={`Number ${digit}, ${remaining} left`}
            >
              <Text style={[styles.digitLabel, isDone && styles.digitLabelDone]}>
                {digit}
              </Text>
              <Text style={[styles.remainingLabel, isDone && styles.remainingLabelDone]}>
                {isDone ? '✓' : remaining}
              </Text>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    width: '100%',
    maxWidth: 420,
    gap: 12,
    marginTop: 12,
    alignItems: 'center',
  },
  actions: {
    width: '100%',
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingHorizontal: 8,
  },
  actionBtn: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 6,
    marginHorizontal: 3,
    borderRadius: 8,
    backgroundColor: '#F3F4F6',
  },
  actionBtnActive: {
    backgroundColor: '#111111',
  },
  actionBtnDisabled: {
    opacity: 0.35,
  },
  actionIcon: {
    fontSize: 20,
    color: '#111111',
    lineHeight: 22,
  },
  iconActive: {
    color: '#FFFFFF',
  },
  iconDisabled: {
    color: '#9E9E9E',
  },
  actionLabel: {
    fontSize: 10,
    fontWeight: '700',
    color: '#4B5563',
    marginTop: 2,
  },
  digits: {
    width: '100%',
    flexDirection: 'row',
    flexWrap: 'nowrap',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 5,
  },
  digit: {
    flex: 1,
    minWidth: 0,
    paddingVertical: 6,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#D1D5DB',
    backgroundColor: '#F9FAFB',
  },
  digitDone: {
    backgroundColor: '#E5E7EB',
    borderColor: '#E5E7EB',
    opacity: 0.3,
  },
  digitLabel: {
    fontSize: 20,
    lineHeight: 24,
    fontWeight: '700',
    color: '#111827',
  },
  digitLabelDone: {
    color: '#9CA3AF',
  },
  remainingLabel: {
    fontSize: 10,
    fontWeight: '600',
    color: '#6B7280',
    marginTop: 1,
  },
  remainingLabelDone: {
    color: '#9CA3AF',
  },
  pressed: {
    opacity: 0.6,
  },
});