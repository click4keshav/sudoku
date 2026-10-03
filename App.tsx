import { StatusBar } from 'expo-status-bar';
import { useCallback, useEffect, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import Board, {
  type CellValue,
  type NotesGrid,
  type SelectedCell,
} from './components/Board';
import DifficultyPicker from './components/DifficultyPicker';
import Keypad from './components/Keypad';
import SizePicker from './components/SizePicker';
import {
  DEFAULT_BOARD_LAYOUT,
  type BoardLayout,
} from './lib/boardLayouts';
import { generate, type Difficulty } from './lib/gameLogic';

function emptyNotes(size: number): NotesGrid {
  return Array.from({ length: size }, () =>
    Array.from({ length: size }, () =>
      Array.from({ length: size }, () => false),
    ),
  );
}

export default function App() {
  const [layout, setLayout] = useState<BoardLayout>(DEFAULT_BOARD_LAYOUT);
  const [difficulty, setDifficulty] = useState<Difficulty>('medium');

  // Board state
  const [values, setValues] = useState<CellValue[][]>([]);
  const [initialClues, setInitialClues] = useState<boolean[][]>([]);
  const [notes, setNotes] = useState<NotesGrid>([]);
  const [selected, setSelected] = useState<SelectedCell | null>(null);
  const [notesMode, setNotesMode] = useState(false);

  // Core generator function: takes board size & difficulty
  const startNewGame = useCallback(
    (targetLayout: BoardLayout, targetDifficulty: Difficulty) => {
      const { puzzle } = generate(targetLayout, targetDifficulty);

      // Lock pre-filled clue cells
      const clues = puzzle.map((row) => row.map((cell) => cell !== null));

      setValues(puzzle);
      setInitialClues(clues);
      setNotes(emptyNotes(targetLayout.size));
      setSelected(null);
    },
    [],
  );

  // Generate initial puzzle on startup
  useEffect(() => {
    startNewGame(layout, difficulty);
  }, []);

  // When Size changes
  const onChangeLayout = useCallback(
    (next: BoardLayout) => {
      setLayout(next);
      startNewGame(next, difficulty);
    },
    [difficulty, startNewGame],
  );

  // When Difficulty changes
  const onChangeDifficulty = useCallback(
    (next: Difficulty) => {
      setDifficulty(next);
      startNewGame(layout, next);
    },
    [layout, startNewGame],
  );

  const onDigit = useCallback(
    (digit: number) => {
      if (selected == null) return;
      const { row, col } = selected;

      if (initialClues[row]?.[col]) return;

      if (notesMode) {
        if (values[row][col] != null) return;

        setNotes((current) =>
          current.map((noteRow, r) =>
            noteRow.map((marks, c) =>
              r === row && c === col
                ? marks.map((on, index) => (index === digit - 1 ? !on : on))
                : marks,
            ),
          ),
        );
        return;
      }

      setValues((current) =>
        current.map((valueRow, r) =>
          valueRow.map((val, c) => (r === row && c === col ? digit : val)),
        ),
      );

      setNotes((current) =>
        current.map((noteRow, r) =>
          noteRow.map((marks, c) =>
            r === row && c === col ? marks.map(() => false) : marks,
          ),
        ),
      );
    },
    [initialClues, notesMode, selected, values],
  );

  const onErase = useCallback(() => {
    if (selected == null) return;
    const { row, col } = selected;

    if (initialClues[row]?.[col]) return;

    setValues((current) =>
      current.map((valueRow, r) =>
        valueRow.map((val, c) => (r === row && c === col ? null : val)),
      ),
    );
    setNotes((current) =>
      current.map((noteRow, r) =>
        noteRow.map((marks, c) =>
          r === row && c === col ? marks.map(() => false) : marks,
        ),
      ),
    );
  }, [initialClues, selected]);

  if (values.length === 0) {
    return null;
  }

  return (
    <View style={styles.container}>
      <SizePicker layout={layout} onChange={onChangeLayout} />
      <DifficultyPicker
        difficulty={difficulty}
        onChange={onChangeDifficulty}
      />
      <Board
        layout={layout}
        values={values}
        notes={notes}
        selected={selected}
        onSelectCell={setSelected}
      />
      <Keypad
        size={layout.size}
        notesMode={notesMode}
        onNotesModeChange={setNotesMode}
        onDigit={onDigit}
        onErase={onErase}
      />
      <StatusBar style="auto" />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#fff',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 16,
  },
});