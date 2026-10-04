export type BoardLayout = {
  id: string;
  label: string;
  size: number;
  boxRows: number;
  boxCols: number;
};

export const BOARD_LAYOUTS: BoardLayout[] = [
  { id: '3x3', label: '3x3', size: 3, boxRows: 1, boxCols: 3 },
  { id: '4x4', label: '4x4', size: 4, boxRows: 2, boxCols: 2 },
  { id: '6x6', label: '6x6', size: 6, boxRows: 2, boxCols: 3 },
  { id: '8x8', label: '8x8', size: 8, boxRows: 2, boxCols: 4 },
  { id: '9x9', label: '9x9', size: 9, boxRows: 3, boxCols: 3 },
];

export const DEFAULT_BOARD_LAYOUT: BoardLayout = BOARD_LAYOUTS[4];