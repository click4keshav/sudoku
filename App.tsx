import { StatusBar } from 'expo-status-bar';
import { useCallback, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import Board, {
  type CellValue,
  type NotesGrid,
  type SelectedCell,
} from './components/Board';
import Keypad from './components/Keypad';
import SizePicker from './components/SizePicker';
import {
  DEFAULT_BOARD_LAYOUT,
  type BoardLayout,
} from './lib/boardLayouts';

function emptyValues(size: number): CellValue[][] {
  return Array.from({ length: size }, () =>
    Array.from({ length: size }, () => null),
  );
}

function emptyNotes(size: number): NotesGrid {
  return Array.from({ length: size }, () =>
    Array.from({ length: size }, () =>
      Array.from({ length: size }, () => false),
    ),
  );
}

export default function App() {
  const [layout, setLayout] = useState<BoardLayout>(DEFAULT_BOARD_LAYOUT);
  const [values, setValues] = useState(() => emptyValues(layout.size));
  const [notes, setNotes] = useState(() => emptyNotes(layout.size));
  const [selected, setSelected] = useState<SelectedCell | null>(null);
  const [notesMode, setNotesMode] = useState(false);

  const onChangeLayout = useCallback((next: BoardLayout) => {
    setLayout(next);
    setValues(emptyValues(next.size));
    setNotes(emptyNotes(next.size));
    setSelected(null);
  }, []);

  const onDigit = useCallback(
    (digit: number) => {
      if (selected == null) {
        return;
      }

      const { row, col } = selected;

      if (notesMode) {
        if (values[row][col] != null) {
          return;
        }

        setNotes((current) =>
          current.map((noteRow, r) =>
            noteRow.map((marks, c) =>
              r === row && c === col
                ? marks.map((on, index) =>
                    index === digit - 1 ? !on : on,
                  )
                : marks,
            ),
          ),
        );
        return;
      }

      setValues((current) =>
        current.map((valueRow, r) =>
          valueRow.map((value, c) =>
            r === row && c === col ? digit : value,
          ),
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
    [notesMode, selected, values],
  );

  const onErase = useCallback(() => {
    if (selected == null) {
      return;
    }

    const { row, col } = selected;
    setValues((current) =>
      current.map((valueRow, r) =>
        valueRow.map((value, c) => (r === row && c === col ? null : value)),
      ),
    );
    setNotes((current) =>
      current.map((noteRow, r) =>
        noteRow.map((marks, c) =>
          r === row && c === col ? marks.map(() => false) : marks,
        ),
      ),
    );
  }, [selected]);

  return (
    <View style={styles.container}>
      <SizePicker layout={layout} onChange={onChangeLayout} />
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
