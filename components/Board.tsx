import { Pressable, StyleSheet, Text, View } from 'react-native';
import type { BoardLayout } from '../lib/boardLayouts';

const OUTER_BORDER = 3;
const BLOCK_GAP = 2;
const CELL_GAP = 1;
const BLACK = '#000000';
const GREY = '#B0B0B0';
const SELECTED_FILL = '#C5E4FF';
const CELL_FILL = '#FFFFFF';

export type SelectedCell = { row: number; col: number };
export type CellValue = number | null;
export type NotesGrid = boolean[][][];

type BoardProps = {
  layout: BoardLayout;
  values: CellValue[][];
  notes: NotesGrid;
  selected: SelectedCell | null;
  onSelectCell: (cell: SelectedCell) => void;
};

export default function Board({
  layout,
  values,
  notes,
  selected,
  onSelectCell,
}: BoardProps) {
  const { size, boxRows, boxCols } = layout;
  const valueFontSize = size <= 4 ? 28 : size <= 6 ? 24 : 18;
  const boxesDown = size / boxRows;
  const boxesAcross = size / boxCols;

  return (
    <View style={styles.board}>
      {Array.from({ length: boxesDown }, (_, boxRow) => (
        <View key={boxRow} style={styles.blockRow}>
          {Array.from({ length: boxesAcross }, (_, boxCol) => (
            <View key={boxCol} style={styles.block}>
              {Array.from({ length: boxRows }, (_, rowInBox) => (
                <View key={rowInBox} style={styles.cellRow}>
                  {Array.from({ length: boxCols }, (_, colInBox) => {
                    const row = boxRow * boxRows + rowInBox;
                    const col = boxCol * boxCols + colInBox;
                    const isSelected =
                      selected?.row === row && selected?.col === col;
                    const value = values[row][col];

                    return (
                      <Pressable
                        key={col}
                        onPress={() => onSelectCell({ row, col })}
                        style={[
                          styles.cell,
                          isSelected && styles.selected,
                        ]}
                        accessibilityRole="button"
                        accessibilityLabel={cellLabel(row, col, value)}
                        accessibilityState={{ selected: isSelected }}
                      >
                        {value != null ? (
                          <Text
                            style={[styles.value, { fontSize: valueFontSize }]}
                          >
                            {value}
                          </Text>
                        ) : (
                          <Notes
                            marks={notes[row][col]}
                            boxRows={boxRows}
                            boxCols={boxCols}
                          />
                        )}
                      </Pressable>
                    );
                  })}
                </View>
              ))}
            </View>
          ))}
        </View>
      ))}
    </View>
  );
}

function Notes({
  marks,
  boxRows,
  boxCols,
}: {
  marks: boolean[];
  boxRows: number;
  boxCols: number;
}) {
  const noteWidth = `${100 / boxCols}%` as const;
  const noteHeight = `${100 / boxRows}%` as const;

  return (
    <View style={styles.notes}>
      {marks.map((on, index) => (
        <Text
          key={index}
          style={[styles.note, { width: noteWidth, height: noteHeight }]}
        >
          {on ? index + 1 : ' '}
        </Text>
      ))}
    </View>
  );
}

function cellLabel(row: number, col: number, value: CellValue) {
  const position = `Row ${row + 1}, column ${col + 1}`;
  return value == null ? position : `${position}, ${value}`;
}

const styles = StyleSheet.create({
  board: {
    width: '100%',
    maxWidth: 420,
    aspectRatio: 1,
    borderWidth: OUTER_BORDER,
    borderColor: BLACK,
    backgroundColor: BLACK,
    gap: BLOCK_GAP,
  },
  blockRow: {
    flex: 1,
    flexDirection: 'row',
    gap: BLOCK_GAP,
  },
  block: {
    flex: 1,
    backgroundColor: GREY,
    gap: CELL_GAP,
  },
  cellRow: {
    flex: 1,
    flexDirection: 'row',
    gap: CELL_GAP,
  },
  cell: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
    backgroundColor: CELL_FILL,
  },
  selected: {
    backgroundColor: SELECTED_FILL,
  },
  value: {
    fontWeight: '600',
    color: '#1A1A1A',
  },
  notes: {
    width: '100%',
    height: '100%',
    flexDirection: 'row',
    flexWrap: 'wrap',
  },
  note: {
    fontSize: 8,
    lineHeight: 12,
    textAlign: 'center',
    color: '#6B6B6B',
  },
});
