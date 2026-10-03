export type BoardLayout = {
  size: number;
  boxRows: number;
  boxCols: number;
  name: string;
  label: string;
};

export const BOARD_LAYOUTS: BoardLayout[] = [
  {
    size: 3,
    boxRows: 1,
    boxCols: 3,
    name: 'Beginner',
    label: 'Beginner (3×3)',
  },
  {
    size: 4,
    boxRows: 2,
    boxCols: 2,
    name: 'Starter',
    label: 'Starter (4×4)',
  },
  {
    size: 6,
    boxRows: 2,
    boxCols: 3,
    name: 'Getting there',
    label: 'Getting there (6×6)',
  },
  {
    size: 8,
    boxRows: 2,
    boxCols: 4,
    name: 'Almost there',
    label: 'Almost there (8×8)',
  },
  {
    size: 9,
    boxRows: 3,
    boxCols: 3,
    name: 'Expert',
    label: 'Expert (9×9)',
  },
];

export const DEFAULT_BOARD_LAYOUT = BOARD_LAYOUTS[BOARD_LAYOUTS.length - 1];
