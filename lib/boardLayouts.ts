export interface BoardLayout {
  id: number;
  label: string;
  size: number;
  boxRows: number;
  boxCols: number;
}

export const BOARD_LAYOUTS: BoardLayout[] = [
  { id: 1, label: '3x3', size: 3, boxRows: 1, boxCols: 3 },
  { id: 2, label: '4x4', size: 4, boxRows: 2, boxCols: 2 },
  { id: 3, label: '6x6', size: 6, boxRows: 2, boxCols: 3 },
  { id: 4, label: '8x8', size: 8, boxRows: 4, boxCols: 2 },
  { id: 5, label: '9x9', size: 9, boxRows: 3, boxCols: 3 },
];

export const DEFAULT_BOARD_LAYOUT = BOARD_LAYOUTS[0];