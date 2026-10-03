import { Pressable, StyleSheet, Text, View } from 'react-native';
import type { Difficulty } from '../lib/gameLogic';

const DIFFICULTIES: Difficulty[] = ['easy', 'medium', 'hard'];

type DifficultyPickerProps = {
  difficulty: Difficulty;
  onChange: (difficulty: Difficulty) => void;
};

export default function DifficultyPicker({
  difficulty,
  onChange,
}: DifficultyPickerProps) {
  return (
    <View style={styles.container}>
      {DIFFICULTIES.map((level) => {
        const isSelected = level === difficulty;
        return (
          <Pressable
            key={level}
            onPress={() => onChange(level)}
            style={[styles.button, isSelected && styles.buttonSelected]}
            accessibilityRole="button"
            accessibilityState={{ selected: isSelected }}
          >
            <Text
              style={[styles.label, isSelected && styles.labelSelected]}
            >
              {level.charAt(0).toUpperCase() + level.slice(1)}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    width: '100%',
    maxWidth: 420,
    flexDirection: 'row',
    gap: 8,
    marginBottom: 16,
  },
  button: {
    flex: 1,
    paddingVertical: 8,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#C8C8C8',
    backgroundColor: '#F7F7F7',
    alignItems: 'center',
    justifyContent: 'center',
  },
  buttonSelected: {
    backgroundColor: '#111111',
    borderColor: '#111111',
  },
  label: {
    fontSize: 14,
    fontWeight: '600',
    color: '#111111',
  },
  labelSelected: {
    color: '#FFFFFF',
  },
});