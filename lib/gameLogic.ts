import { type BoardLayout, DEFAULT_BOARD_LAYOUT } from './boardLayouts';

export type Difficulty = 'easy' | 'medium' | 'hard' | 'expert';

// Deterministic PRNG using Mulberry32
function mulberry32(seed: number) {
  return function () {
    let t = (seed += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function hashStringToNumber(str: string): number {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = (Math.imul(31, hash) + str.charCodeAt(i)) | 0;
  }
  return hash >>> 0;
}

function shuffleWithRng<T>(array: T[], rng: () => number): T[] {
  const result = [...array];
  for (let i = result.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
}

export function isValidPlacement(
  board: (number | null)[][],
  row: number,
  col: number,
  val: number,
  boxRows: number,
  boxCols: number,
): boolean {
  const size = board.length;

  for (let c = 0; c < size; c++) {
    if (board[row][c] === val) return false;
  }

  for (let r = 0; r < size; r++) {
    if (board[r][col] === val) return false;
  }

  const startRow = Math.floor(row / boxRows) * boxRows;
  const startCol = Math.floor(col / boxCols) * boxCols;

  for (let r = 0; r < boxRows; r++) {
    for (let c = 0; c < boxCols; c++) {
      if (board[startRow + r][startCol + c] === val) return false;
    }
  }

  return true;
}

function solveBoardInternal(
  board: (number | null)[][],
  boxRows: number,
  boxCols: number,
  rng: () => number,
): boolean {
  const size = board.length;

  for (let r = 0; r < size; r++) {
    for (let c = 0; c < size; c++) {
      if (board[r][c] === null) {
        const digits = Array.from({ length: size }, (_, i) => i + 1);
        const shuffled = shuffleWithRng(digits, rng);

        for (const num of shuffled) {
          if (isValidPlacement(board, r, c, num, boxRows, boxCols)) {
            board[r][c] = num;
            if (solveBoardInternal(board, boxRows, boxCols, rng)) {
              return true;
            }
            board[r][c] = null;
          }
        }
        return false;
      }
    }
  }
  return true;
}

export function generate(layout: BoardLayout, difficulty: Difficulty) {
  return generateWithRng(layout, difficulty, Math.random);
}

function generateWithRng(
  layout: BoardLayout,
  difficulty: Difficulty,
  rng: () => number,
): { puzzle: (number | null)[][]; solution: number[][] } {
  const size = layout.size || 9;
  const boxRows = layout.boxRows || 3;
  const boxCols = layout.boxCols || 3;

  const board: (number | null)[][] = Array.from({ length: size }, () =>
    Array(size).fill(null),
  );

  solveBoardInternal(board, boxRows, boxCols, rng);

  const solution = board.map((row) => [...(row as number[])]);

  // Explicit, healthy clue bounds
  let cluesCount: number;
  if (size === 9) {
    switch (difficulty) {
      case 'easy':
        cluesCount = 42;
        break;
      case 'medium':
        cluesCount = 36;
        break;
      case 'hard':
        cluesCount = 31;
        break;
      case 'expert':
        cluesCount = 28;
        break;
      default:
        cluesCount = 34;
    }
  } else if (size === 6) {
    cluesCount = difficulty === 'easy' ? 20 : 16;
  } else if (size === 4) {
    cluesCount = 8;
  } else if (size === 8) {
    cluesCount = 32;
  } else {
    cluesCount = 5;
  }

  const cellsToRemove = size * size - cluesCount;
  const puzzle = board.map((row) => [...row]);

  const allCoords: [number, number][] = [];
  for (let r = 0; r < size; r++) {
    for (let c = 0; c < size; c++) {
      allCoords.push([r, c]);
    }
  }
  const shuffledCoords = shuffleWithRng(allCoords, rng);

  for (let i = 0; i < cellsToRemove; i++) {
    const [r, c] = shuffledCoords[i];
    puzzle[r][c] = null;
  }

  return { puzzle, solution };
}

// Bounded strictly between 9x9 Easy, Medium, and Hard (No Expert)
export function generateDailyChallenge(dateString: string): {
  puzzle: (number | null)[][];
  solution: number[][];
  difficulty: Difficulty;
  dateString: string;
} {
  const seedNum = hashStringToNumber(dateString);
  const rng = mulberry32(seedNum);

  // Parse YYYY-MM-DD reliably without UTC offset skew
  const parts = dateString.split('-').map(Number);
  const dateObj = new Date(parts[0], parts[1] - 1, parts[2]);
  const dayOfWeek = dateObj.getDay(); // 0 is Sun, 6 is Sat

  let difficulty: Difficulty;
  if (dayOfWeek === 1 || dayOfWeek === 2) {
    difficulty = 'easy'; // Mon, Tue
  } else if (dayOfWeek === 3 || dayOfWeek === 4) {
    difficulty = 'medium'; // Wed, Thu
  } else {
    difficulty = 'hard'; // Fri, Sat, Sun
  }

  // Explicit 9x9 layout to prevent any small-board fallbacks
  const layout: BoardLayout = {
    id: '9x9',
    label: '9x9',
    size: 9,
    boxRows: 3,
    boxCols: 3,
  };

  const { puzzle, solution } = generateWithRng(layout, difficulty, rng);

  return {
    puzzle,
    solution,
    difficulty,
    dateString,
  };
}