import type { BoardLayout } from './boardLayouts';
import type { CellValue } from '../components/Board';

export type Difficulty = 'easy' | 'medium' | 'hard';

/**
 * Checks whether placing `num` at (row, col) is valid under Sudoku rules.
 */
export function isValid(
  board: CellValue[][],
  layout: BoardLayout,
  row: number,
  col: number,
  num: number,
): boolean {
  const { size, boxRows, boxCols } = layout;

  // Row and Column check
  for (let i = 0; i < size; i++) {
    if (board[row][i] === num) return false;
    if (board[i][col] === num) return false;
  }

  // Box check
  const startRow = Math.floor(row / boxRows) * boxRows;
  const startCol = Math.floor(col / boxCols) * boxCols;

  for (let r = 0; r < boxRows; r++) {
    for (let c = 0; c < boxCols; c++) {
      if (board[startRow + r][startCol + c] === num) {
        return false;
      }
    }
  }

  return true;
}

/**
 * Utility: Deep clone a 2D board
 */
function cloneBoard(board: CellValue[][]): CellValue[][] {
  return board.map((row) => [...row]);
}

/**
 * Utility: Shuffle array in-place (Fisher-Yates) for random board generation
 */
function shuffle<T>(arr: T[]): T[] {
  const result = [...arr];
  for (let i = result.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
}

/**
 * Solves the board using backtracking.
 * Set `randomize = true` to produce different full boards on each run.
 */
export function solve(
  board: CellValue[][],
  layout: BoardLayout,
  randomize = false,
): CellValue[][] | null {
  const working = cloneBoard(board);
  const { size } = layout;

  const digits = Array.from({ length: size }, (_, i) => i + 1);

  function backtrack(): boolean {
    for (let r = 0; r < size; r++) {
      for (let c = 0; c < size; c++) {
        if (working[r][c] == null) {
          const candidates = randomize ? shuffle(digits) : digits;

          for (const num of candidates) {
            if (isValid(working, layout, r, c, num)) {
              working[r][c] = num;
              if (backtrack()) return true;
              working[r][c] = null;
            }
          }
          return false;
        }
      }
    }
    return true;
  }

  return backtrack() ? working : null;
}

/**
 * Counts solutions up to `limit` (stops early if > 1 to stay fast).
 */
export function countSolutions(
  board: CellValue[][],
  layout: BoardLayout,
  limit = 2,
): number {
  const working = cloneBoard(board);
  const { size } = layout;
  let count = 0;

  function backtrack(): boolean {
    for (let r = 0; r < size; r++) {
      for (let c = 0; c < size; c++) {
        if (working[r][c] == null) {
          for (let num = 1; num <= size; num++) {
            if (isValid(working, layout, r, c, num)) {
              working[r][c] = num;
              backtrack();
              working[r][c] = null;
              if (count >= limit) return true;
            }
          }
          return false;
        }
      }
    }
    count++;
    return count >= limit;
  }

  backtrack();
  return count;
}

/**
 * Generates a puzzle with a guaranteed unique solution.
 */
export function generate(
  layout: BoardLayout,
  difficulty: Difficulty = 'medium',
): { puzzle: CellValue[][]; solution: CellValue[][] } {
  const { size } = layout;

  // 1. Build an empty board and generate a random complete solution
  const empty: CellValue[][] = Array.from({ length: size }, () =>
    Array.from({ length: size }, () => null),
  );
  const solution = solve(empty, layout, true);
  if (!solution) {
    throw new Error('Failed to create a valid base solution.');
  }

  const puzzle = cloneBoard(solution);

  // 2. Decide how many cells to attempt to remove based on board size & difficulty
  const totalCells = size * size;
  const removalRatio =
    difficulty === 'easy' ? 0.4 : difficulty === 'medium' ? 0.55 : 0.65;
  const attempts = Math.floor(totalCells * removalRatio);

  // 3. Collect and shuffle all coordinates
  const positions: [number, number][] = [];
  for (let r = 0; r < size; r++) {
    for (let c = 0; c < size; c++) {
      positions.push([r, c]);
    }
  }
  const shuffledPositions = shuffle(positions);

  let removed = 0;
  for (const [r, c] of shuffledPositions) {
    if (removed >= attempts) break;

    const temp = puzzle[r][c];
    puzzle[r][c] = null;

    // Check if the board still has exactly 1 solution
    if (countSolutions(puzzle, layout, 2) !== 1) {
      puzzle[r][c] = temp; // Revert
    } else {
      removed++;
    }
  }

  return { puzzle, solution };
}