import { Pressable, StyleSheet, Text, View } from 'react-native';
import type { Difficulty } from '../lib/gameLogic';

type Props = {
  difficulty: Difficulty;
  onChange: (d: Difficulty) => void;
};

const DIFFICULTIES: { id: Difficulty; label: string }[] = [
  { id: 'easy', label: 'Easy' },
  { id: 'medium', label: 'Medium' },
  { id: 'hard', label: 'Hard' },
  { id: 'expert', label: 'Expert' },
];

export default function DifficultyPicker({ difficulty, onChange }: Props) {
  return (
    <View style={styles.container}>
      <Text style={styles.label}>Difficulty</Text>
      <View style={styles.row}>
        {DIFFICULTIES.map((d) => {
          const isActive = difficulty === d.id;
          return (
            <Pressable
              key={d.id}
              style={[styles.chip, isActive && styles.chipActive]}
              onPress={() => onChange(d.id)}
            >
              <Text style={[styles.chipText, isActive && styles.chipTextActive]}>
                {d.label}
              </Text>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    width: '100%',
    marginBottom: 16,
  },
  label: {
    fontSize: 13,
    fontWeight: '700',
    marginBottom: 8,
    textTransform: 'uppercase',
    letterSpacing: 1,
  },
  row: {
    flexDirection: 'row',
    gap: 6,
  },
  chip: {
    flex: 1,
    paddingVertical: 10,
    alignItems: 'center',
    borderRadius: 8,
    backgroundColor: 'rgba(128,128,128,0.1)',
  },
  chipActive: {
    backgroundColor: '#005BBB',
  },
  chipText: {
    fontSize: 12,
    fontWeight: '600',
  },
  chipTextActive: {
    color: '#FFFFFF',
  },
});