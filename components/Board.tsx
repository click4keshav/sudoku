import {
    type DimensionValue,
    Pressable,
    StyleSheet,
    Text,
    View,
  } from 'react-native';
  import type { BoardLayout } from '../lib/boardLayouts';
  
  const OUTER_BORDER = 3;
  const BLOCK_GAP = 2;
  const CELL_GAP = 1;
  
  export type SelectedCell = { row: number; col: number };
  export type CellValue = number | null;
  export type NotesGrid = boolean[][][];
  
  export type ThemeColors = {
    boardBorder: string;
    blockBg: string;
    cellBg: string;
    selectedBg: string;
    rowColBg: string;
    matchBg: string;
    clueText: string;
    userText: string;
    errorText: string;
    errorBg: string;
    noteText: string;
    isDark: boolean;
  };
  
  type BoardProps = {
    layout: BoardLayout;
    values: CellValue[][];
    initialClues: boolean[][];
    errors: boolean[][];
    notes: NotesGrid;
    selected: SelectedCell | null;
    hintHighlightCell?: SelectedCell | null;
    isPaused: boolean;
    theme: ThemeColors;
    onResume: () => void;
    onSelectCell: (cell: SelectedCell) => void;
  };
  
  export default function Board({
    layout,
    values,
    initialClues,
    errors,
    notes,
    selected,
    hintHighlightCell,
    isPaused,
    theme,
    onResume,
    onSelectCell,
  }: BoardProps) {
    const { size, boxRows, boxCols } = layout;
    const valueFontSize = size <= 4 ? 28 : size <= 6 ? 24 : 18;
    const boxesDown = size / boxRows;
    const boxesAcross = size / boxCols;
  
    const selectedValue =
      selected != null ? values[selected.row]?.[selected.col] : null;
  
    return (
      <View
        style={[
          styles.board,
          {
            borderColor: theme.boardBorder,
            backgroundColor: theme.boardBorder,
          },
        ]}
      >
        {Array.from({ length: boxesDown }, (_, boxRow) => (
          <View key={boxRow} style={styles.blockRow}>
            {Array.from({ length: boxesAcross }, (_, boxCol) => (
              <View
                key={boxCol}
                style={[styles.block, { backgroundColor: theme.blockBg }]}
              >
                {Array.from({ length: boxRows }, (_, rowInBox) => (
                  <View key={rowInBox} style={styles.cellRow}>
                    {Array.from({ length: boxCols }, (_, colInBox) => {
                      const row = boxRow * boxRows + rowInBox;
                      const col = boxCol * boxCols + colInBox;
                      const isSelected =
                        selected?.row === row && selected?.col === col;
                      const value = values[row]?.[col];
                      const isClue = initialClues[row]?.[col];
                      const isError = errors[row]?.[col];
  
                      const isHintCell =
                        hintHighlightCell?.row === row &&
                        hintHighlightCell?.col === col;
  
                      const isRowOrCol =
                        selected != null &&
                        (selected.row === row || selected.col === col);
  
                      const isSameNumber =
                        selectedValue != null &&
                        value != null &&
                        value === selectedValue;
  
                      let bg = theme.cellBg;
                      if (isRowOrCol) bg = theme.rowColBg;
                      if (isSameNumber) bg = theme.matchBg;
                      if (isSelected) bg = theme.selectedBg;
                      if (isError) bg = theme.errorBg;
                      if (isHintCell) bg = '#FEF08A';
  
                      return (
                        <Pressable
                          key={col}
                          onPress={() => onSelectCell({ row, col })}
                          style={[styles.cell, { backgroundColor: bg }]}
                          accessibilityRole="button"
                          accessibilityLabel={`Row ${row + 1}, column ${col + 1}${
                            value ? `, ${value}` : ''
                          }`}
                          accessibilityState={{ selected: isSelected }}
                        >
                          {value != null ? (
                            <Text
                              style={[
                                styles.value,
                                { fontSize: valueFontSize },
                                isClue
                                  ? { color: theme.clueText, fontWeight: '800' }
                                  : { color: theme.userText, fontWeight: '700' },
                                isError
                                  ? { color: theme.errorText, fontWeight: '800' }
                                  : null,
                              ]}
                            >
                              {value}
                            </Text>
                          ) : (
                            <Notes
                              marks={notes[row]?.[col] || []}
                              boxRows={boxRows}
                              boxCols={boxCols}
                              textColor={theme.noteText}
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
  
        {isPaused && (
          <Pressable
            onPress={onResume}
            style={[
              styles.pausedOverlay,
              {
                backgroundColor: theme.isDark
                  ? 'rgba(20,20,20,0.96)'
                  : 'rgba(255,255,255,0.96)',
              },
            ]}
          >
            <Text style={[styles.pausedIcon, { color: theme.clueText }]}>▶</Text>
            <Text style={[styles.pausedText, { color: theme.clueText }]}>
              Game Paused
            </Text>
            <Text style={[styles.pausedSub, { color: theme.noteText }]}>
              Tap anywhere to resume
            </Text>
          </Pressable>
        )}
      </View>
    );
  }
  
  function Notes({
    marks,
    boxRows,
    boxCols,
    textColor,
  }: {
    marks: boolean[];
    boxRows: number;
    boxCols: number;
    textColor: string;
  }) {
    const noteWidth = `${100 / boxCols}%` as DimensionValue;
    const noteHeight = `${100 / boxRows}%` as DimensionValue;
  
    return (
      <View style={styles.notes}>
        {marks.map((on, index) => (
          <Text
            key={index}
            style={[
              styles.note,
              { width: noteWidth, height: noteHeight, color: textColor },
            ]}
          >
            {on ? index + 1 : ''}
          </Text>
        ))}
      </View>
    );
  }
  
  const styles = StyleSheet.create({
    board: {
      width: '100%',
      maxWidth: 420,
      aspectRatio: 1,
      borderWidth: OUTER_BORDER,
      gap: BLOCK_GAP,
      position: 'relative',
    },
    blockRow: {
      flex: 1,
      flexDirection: 'row',
      gap: BLOCK_GAP,
    },
    block: {
      flex: 1,
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
    },
    value: {
      fontWeight: '600' as const,
    },
    notes: {
      width: '100%',
      height: '100%',
      flexDirection: 'row',
      flexWrap: 'wrap',
    },
    note: {
      fontSize: 9,
      lineHeight: 12,
      textAlign: 'center',
      fontWeight: '600' as const,
    },
    pausedOverlay: {
      position: 'absolute',
      top: 0,
      left: 0,
      right: 0,
      bottom: 0,
      alignItems: 'center',
      justifyContent: 'center',
      gap: 8,
      zIndex: 10,
    },
    pausedIcon: {
      fontSize: 36,
    },
    pausedText: {
      fontSize: 22,
      fontWeight: '700' as const,
    },
    pausedSub: {
      fontSize: 14,
    },
  });