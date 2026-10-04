import AsyncStorage from '@react-native-async-storage/async-storage';
import { StatusBar } from 'expo-status-bar';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { supabase } from './lib/supabase';
import type { User } from '@supabase/supabase-js';
import { getCurrentUser, signInWithGoogle, signOutUser } from './lib/auth';
import {
  recordGameRunToSupabase,
  syncUserDataUponLogin,
  fetchUserStatsFromCloud,
  syncActiveGameToCloud,
  clearActiveGameFromCloud,
  STATS_KEY,
} from './lib/gameSync';
import * as Application from 'expo-application';
import {
  SafeAreaProvider,
  useSafeAreaInsets,
} from 'react-native-safe-area-context';
import {
  Alert,
  Image,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  View,
} from 'react-native';
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
  BOARD_LAYOUTS,
  type BoardLayout,
} from './lib/boardLayouts';
import { generate, type Difficulty } from './lib/gameLogic';

const STORAGE_KEY = '@sudoku_save_v4';
const FAVORITES_KEY = '@sudoku_favorites_v4';
const SETTINGS_KEY = '@sudoku_settings_v4';

type MoveSnapshot = {
  values: CellValue[][];
  notes: NotesGrid;
  errors: boolean[][];
  mistakes: number;
};

type CategoryStats = {
  started: number;
  won: number;
  bestTime: number | null;
  streak: number;
};

type AllStats = Record<string, CategoryStats>;

type SavedGameItem = {
  id: string;
  date: string;
  layout: BoardLayout;
  difficulty: Difficulty;
  values: CellValue[][];
  solution: CellValue[][];
  initialClues: boolean[][];
  errors: boolean[][];
  notes: NotesGrid;
  mistakes: number;
  timerSeconds: number;
};

type AppSettings = {
  limitMistakes: boolean;
  autoRemoveNotes: boolean;
  autoCheckErrors: boolean;
  highlightDuplicates: boolean;
  fastInputMode: boolean;
  showTimer: boolean;
  themeMode: 'light' | 'dark';
  accentTheme: 'classic' | 'sepia' | 'slate' | 'navy';
};

const DEFAULT_SETTINGS: AppSettings = {
  limitMistakes: true,
  autoRemoveNotes: true,
  autoCheckErrors: true,
  highlightDuplicates: true,
  fastInputMode: false,
  showTimer: true,
  themeMode: 'light',
  accentTheme: 'classic',
};

type SmartHint = {
  row: number;
  col: number;
  value: number;
  reason: string;
};

function emptyNotes(size: number): NotesGrid {
  return Array.from({ length: size }, () =>
    Array.from({ length: size }, () =>
      Array.from({ length: size }, () => false),
    ),
  );
}

function emptyErrors(size: number): boolean[][] {
  return Array.from({ length: size }, () =>
    Array.from({ length: size }, () => false),
  );
}

function clone2D<T>(arr: T[][]): T[][] {
  return arr.map((r) => [...r]);
}

function clone3D(arr: boolean[][][]): boolean[][][] {
  return arr.map((row) => row.map((cell) => [...cell]));
}

function formatTime(seconds: number): string {
  const mins = Math.floor(seconds / 60);
  const secs = seconds % 60;
  return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
}

function MainApp() {
  const insets = useSafeAreaInsets();

  const [tab, setTab] = useState<'home' | 'stats' | 'profile'>('home');
  const [screen, setScreen] = useState<'home' | 'game'>('home');
  const [favoritesOpen, setFavoritesOpen] = useState(false);
  const [themeModalOpen, setThemeModalOpen] = useState(false);
  const [settingsModalOpen, setSettingsModalOpen] = useState(false);
  const [rulesModalOpen, setRulesModalOpen] = useState(false);

  const [settings, setSettings] = useState<AppSettings>(DEFAULT_SETTINGS);
  const [layout, setLayout] = useState<BoardLayout>(DEFAULT_BOARD_LAYOUT);
  const [difficulty, setDifficulty] = useState<Difficulty>('medium');

  const [pickerLayout, setPickerLayout] = useState<BoardLayout>(DEFAULT_BOARD_LAYOUT);
  const [pickerDifficulty, setPickerDifficulty] = useState<Difficulty>('medium');

  const [gameId, setGameId] = useState<string>(() => Date.now().toString());
  const [values, setValues] = useState<CellValue[][]>([]);
  const [solution, setSolution] = useState<CellValue[][]>([]);
  const [initialClues, setInitialClues] = useState<boolean[][]>([]);
  const [errors, setErrors] = useState<boolean[][]>([]);
  const [notes, setNotes] = useState<NotesGrid>([]);
  const [selected, setSelected] = useState<SelectedCell | null>(null);
  const [lockedDigit, setLockedDigit] = useState<number | null>(null);
  const [notesMode, setNotesMode] = useState(false);
  const [isPaused, setIsPaused] = useState(false);
  const [history, setHistory] = useState<MoveSnapshot[]>([]);

  const [activeHint, setActiveHint] = useState<SmartHint | null>(null);

  const [mistakes, setMistakes] = useState(0);
  const [hintsUsed, setHintsUsed] = useState(0);
  const [timerSeconds, setTimerSeconds] = useState(0);
  const [isGameOver, setIsGameOver] = useState(false);
  const [isWon, setIsWon] = useState(false);
  const [isAutoSolved, setIsAutoSolved] = useState(false);

  const [stats, setStats] = useState<AllStats>({});
  const [favorites, setFavorites] = useState<SavedGameItem[]>([]);
  const [hasSavedGame, setHasSavedGame] = useState(false);
  const [isLoaded, setIsLoaded] = useState(false);
  const isLoadedRef = useRef(false);

  const [user, setUser] = useState<User | null>(null);
  const [authLoading, setAuthLoading] = useState(false);
  const [deviceId, setDeviceId] = useState<string>('guest-device');

  useEffect(() => {
    async function getAAID() {
      try {
        const id = await Application.getAndroidId();
        if (id) setDeviceId(`AAID-${id}`);
      } catch {
        setDeviceId(`#SDK-${Math.floor(1000 + Math.random() * 9000)}`);
      }
    }
    getAAID();
  }, []);

  const isDark = settings.themeMode === 'dark';
  const theme = useMemo(() => {
    if (isDark) {
      return {
        isDark: true,
        appBg: settings.accentTheme === 'navy' ? '#0F172A' : '#121212',
        cardBg: settings.accentTheme === 'navy' ? '#1E293B' : '#1E1E1E',
        textPrimary: '#FFFFFF',
        textSecondary: '#A0A0A0',
        boardBorder: '#444444',
        blockBg: '#333333',
        cellBg: '#1A1A1A',
        selectedBg: '#1E40AF',
        rowColBg: '#172554',
        matchBg: '#1E3A8A',
        clueText: '#FFFFFF',
        userText: '#60A5FA',
        errorText: '#F87171',
        errorBg: '#7F1D1D',
        noteText: '#9CA3AF',
        accentBtn: '#3B82F6',
      };
    }
    if (settings.accentTheme === 'sepia') {
      return {
        isDark: false,
        appBg: '#FBF0D9',
        cardBg: '#F3E5C8',
        textPrimary: '#5C4033',
        textSecondary: '#8D6E63',
        boardBorder: '#5C4033',
        blockBg: '#D7CCC8',
        cellBg: '#FFFDF9',
        selectedBg: '#FFE082',
        rowColBg: '#FFF3E0',
        matchBg: '#FFECB3',
        clueText: '#3E2723',
        userText: '#8D6E63',
        errorText: '#D32F2F',
        errorBg: '#FFCDD2',
        noteText: '#8D6E63',
        accentBtn: '#8D6E63',
      };
    }
    if (settings.accentTheme === 'slate') {
      return {
        isDark: false,
        appBg: '#F1F5F9',
        cardBg: '#FFFFFF',
        textPrimary: '#0F172A',
        textSecondary: '#64748B',
        boardBorder: '#0F172A',
        blockBg: '#CBD5E1',
        cellBg: '#FFFFFF',
        selectedBg: '#93C5FD',
        rowColBg: '#E2E8F0',
        matchBg: '#BFDBFE',
        clueText: '#0F172A',
        userText: '#2563EB',
        errorText: '#EF4444',
        errorBg: '#FEE2E2',
        noteText: '#64748B',
        accentBtn: '#0F172A',
      };
    }
    return {
      isDark: false,
      appBg: '#FFFFFF',
      cardBg: '#F9FAFB',
      textPrimary: '#111827',
      textSecondary: '#6B7280',
      boardBorder: '#000000',
      blockBg: '#B0B0B0',
      cellBg: '#FFFFFF',
      selectedBg: '#7CB9F2',
      rowColBg: '#DDECFB',
      matchBg: '#B2D8FB',
      clueText: '#000000',
      userText: '#005BBB',
      errorText: '#D32F2F',
      errorBg: '#FFCDD2',
      noteText: '#6B7280',
      accentBtn: '#111111',
    };
  }, [isDark, settings.accentTheme]);

  const refreshStats = useCallback(async () => {
    const freshStats = await fetchUserStatsFromCloud();
    if (freshStats) {
      setStats(freshStats);
    }
  }, []);

  const restoreActiveGamePayload = useCallback((p: any) => {
    if (!p || !p.values || p.values.length === 0) return;
    setGameId(p.gameId || Date.now().toString());
    setLayout(p.layout);
    setDifficulty(p.difficulty);
    setValues(p.values);
    setSolution(p.solution);
    setInitialClues(p.initialClues);
    setErrors(p.errors || emptyErrors(p.layout.size));
    setNotes(p.notes || emptyNotes(p.layout.size));
    setMistakes(p.mistakes || 0);
    setTimerSeconds(p.timerSeconds || 0);
    setIsGameOver(false);
    setIsWon(false);
    setIsAutoSolved(false);
    setHistory(p.history || []);
    setHasSavedGame(true);
  }, []);

  useEffect(() => {
    getCurrentUser().then((u) => {
      setUser(u);
      if (u) {
        syncUserDataUponLogin(
          deviceId,
          (cloudStats) => cloudStats && setStats(cloudStats),
          (remoteFavorites) => setFavorites(remoteFavorites),
          (remoteActiveGame) => restoreActiveGamePayload(remoteActiveGame),
        );
      }
    });

    const { data: { subscription } } = supabase.auth.onAuthStateChange(async (_event, session) => {
      const currentUser = session?.user ?? null;
      setUser(currentUser);
      if (currentUser) {
        await syncUserDataUponLogin(
          deviceId,
          (cloudStats) => cloudStats && setStats(cloudStats),
          (remoteFavorites) => setFavorites(remoteFavorites),
          (remoteActiveGame) => restoreActiveGamePayload(remoteActiveGame),
        );
      }
    });

    return () => subscription.unsubscribe();
  }, [deviceId, restoreActiveGamePayload]);

  useEffect(() => {
    async function loadData() {
      try {
        const [savedStats, savedSettings, savedFavs, savedGame] =
          await Promise.all([
            AsyncStorage.getItem(STATS_KEY),
            AsyncStorage.getItem(SETTINGS_KEY),
            AsyncStorage.getItem(FAVORITES_KEY),
            AsyncStorage.getItem(STORAGE_KEY),
          ]);

        if (savedStats) setStats(JSON.parse(savedStats));
        if (savedSettings) setSettings(JSON.parse(savedSettings));
        if (savedFavs) setFavorites(JSON.parse(savedFavs));

        const currentUser = await getCurrentUser();
        if (currentUser) {
          await refreshStats();
        }

        if (savedGame != null) {
          const p = JSON.parse(savedGame);
          restoreActiveGamePayload(p);
        }
      } catch (err) {
        console.warn('Load err:', err);
      } finally {
        setIsLoaded(true);
        isLoadedRef.current = true;
      }
    }
    loadData();
  }, [refreshStats, restoreActiveGamePayload]);

  useEffect(() => {
    if (screen !== 'game' || isPaused || isGameOver || isWon || isAutoSolved) return;
    const timer = setInterval(() => {
      setTimerSeconds((prev) => prev + 1);
    }, 1000);
    return () => clearInterval(timer);
  }, [screen, isPaused, isGameOver, isWon, isAutoSolved]);

  useEffect(() => {
    if (!isLoadedRef.current || values.length === 0) return;

    const isOngoing = !isGameOver && !isWon && !isAutoSolved;
    const state = {
      gameId,
      layout,
      difficulty,
      values,
      solution,
      initialClues,
      errors,
      notes,
      mistakes,
      timerSeconds,
      isGameOver,
      isWon,
      isAutoSolved,
      history,
    };

    AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(state)).catch(() => {});
    setHasSavedGame(isOngoing);

    if (isOngoing && user) {
      const handler = setTimeout(() => {
        syncActiveGameToCloud(state);
      }, 800);
      return () => clearTimeout(handler);
    } else if (!isOngoing && user) {
      clearActiveGameFromCloud();
    }
  }, [
    gameId,
    layout,
    difficulty,
    values,
    solution,
    initialClues,
    errors,
    notes,
    mistakes,
    timerSeconds,
    isGameOver,
    isWon,
    isAutoSolved,
    history,
    user,
  ]);

  const updateSettings = (newSettings: Partial<AppSettings>) => {
    setSettings((prev) => {
      const updated = { ...prev, ...newSettings };
      AsyncStorage.setItem(SETTINGS_KEY, JSON.stringify(updated)).catch(() => {});
      return updated;
    });
  };

  const pushHistory = useCallback(() => {
    setHistory((prev) => [
      ...prev.slice(-30),
      {
        values: clone2D(values),
        notes: clone3D(notes),
        errors: clone2D(errors),
        mistakes,
      },
    ]);
  }, [errors, mistakes, notes, values]);

  const startNewGame = useCallback(
    (targetLayout: BoardLayout, targetDifficulty: Difficulty) => {
      setLayout(targetLayout);
      setDifficulty(targetDifficulty);

      const { puzzle, solution: solvedBoard } = generate(
        targetLayout,
        targetDifficulty,
      );
      const clues = puzzle.map((row) => row.map((cell) => cell !== null));

      setGameId(Date.now().toString());
      setValues(puzzle);
      setSolution(solvedBoard);
      setInitialClues(clues);
      setErrors(emptyErrors(targetLayout.size));
      setNotes(emptyNotes(targetLayout.size));
      setSelected(null);
      setLockedDigit(null);
      setActiveHint(null);
      setMistakes(0);
      setHintsUsed(0);
      setTimerSeconds(0);
      setIsGameOver(false);
      setIsWon(false);
      setIsAutoSolved(false);
      setIsPaused(false);
      setHistory([]);
      setScreen('game');
    },
    [],
  );

  const restartCurrentGame = useCallback(() => {
    Alert.alert(
      'Restart Puzzle',
      'Are you sure you want to clear all moves and restart this board?',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Restart',
          style: 'destructive',
          onPress: () => {
            const freshBoard = solution.map((row, r) =>
              row.map((val, c) => (initialClues[r]?.[c] ? val : null)),
            );
            setValues(freshBoard);
            setErrors(emptyErrors(layout.size));
            setNotes(emptyNotes(layout.size));
            setMistakes(0);
            setHintsUsed(0);
            setTimerSeconds(0);
            setIsGameOver(false);
            setIsWon(false);
            setIsAutoSolved(false);
            setIsPaused(false);
            setSelected(null);
            setLockedDigit(null);
            setActiveHint(null);
            setHistory([]);
          },
        },
      ],
    );
  }, [initialClues, layout.size, solution]);

  const isCurrentFavorite = favorites.some((f) => f.id === gameId);
  const toggleFavoriteCurrentGame = async () => {
    let updated: SavedGameItem[];
    if (isCurrentFavorite) {
      updated = favorites.filter((f) => f.id !== gameId);
      if (user) {
        await supabase.from('user_favorites').delete().eq('user_id', user.id).eq('game_id', gameId);
      }
    } else {
      const item: SavedGameItem = {
        id: gameId,
        date: new Date().toLocaleDateString(),
        layout,
        difficulty,
        values,
        solution,
        initialClues,
        errors,
        notes,
        mistakes,
        timerSeconds,
      };
      updated = [item, ...favorites];
      if (user) {
        await supabase.from('user_favorites').insert([
          { user_id: user.id, game_id: gameId, game_payload: item },
        ]);
      }
    }
    setFavorites(updated);
    AsyncStorage.setItem(FAVORITES_KEY, JSON.stringify(updated)).catch(() => {});
  };

  const loadFavoriteGame = (item: SavedGameItem) => {
    setGameId(item.id);
    setLayout(item.layout);
    setDifficulty(item.difficulty);
    setValues(item.values);
    setSolution(item.solution);
    setInitialClues(item.initialClues);
    setErrors(item.errors);
    setNotes(item.notes);
    setMistakes(item.mistakes);
    setTimerSeconds(item.timerSeconds);
    setIsGameOver(false);
    setIsWon(false);
    setIsAutoSolved(false);
    setFavoritesOpen(false);
    setScreen('game');
  };

  const recordWin = useCallback(
    async (finalTime: number, totalMistakes: number) => {
      if (isAutoSolved) return;

      setIsWon(true);
      setHasSavedGame(false);
      clearActiveGameFromCloud();

      const res = await recordGameRunToSupabase({
        gridSize: layout.size,
        difficulty: difficulty,
        timeSeconds: finalTime,
        mistakes: totalMistakes,
        hintsUsed: hintsUsed,
        status: 'won',
        deviceId: deviceId,
      });

      if (res?.localStats) {
        setStats(res.localStats);
      }

      if (user) {
        await refreshStats();
      }

      Alert.alert(
        '🎉 Congratulations!',
        `Puzzle solved in ${formatTime(finalTime)} with ${totalMistakes} mistake(s)!`,
        [
          { text: 'Play Again', onPress: () => startNewGame(layout, difficulty) },
          { text: 'Home', onPress: () => setScreen('home') },
        ],
      );
    },
    [difficulty, isAutoSolved, layout, refreshStats, startNewGame, deviceId, hintsUsed, user],
  );

  const recordLoss = useCallback(
    async (finalMistakes: number) => {
      if (isAutoSolved) return;

      setIsGameOver(true);
      setHasSavedGame(false);
      clearActiveGameFromCloud();

      const res = await recordGameRunToSupabase({
        gridSize: layout.size,
        difficulty: difficulty,
        timeSeconds: timerSeconds,
        mistakes: finalMistakes,
        hintsUsed: hintsUsed,
        status: 'lost',
        deviceId: deviceId,
      });

      if (res?.localStats) {
        setStats(res.localStats);
      }

      if (user) {
        await refreshStats();
      }
    },
    [difficulty, isAutoSolved, layout.size, refreshStats, timerSeconds, hintsUsed, deviceId, user],
  );

  const remainingCounts = useMemo(() => {
    const counts: Record<number, number> = {};
    for (let i = 1; i <= layout.size; i++) counts[i] = layout.size;

    for (let r = 0; r < layout.size; r++) {
      for (let c = 0; c < layout.size; c++) {
        const val = values[r]?.[c];
        const isErr = errors[r]?.[c];
        if (val != null && !isErr) {
          counts[val] = Math.max(0, (counts[val] ?? layout.size) - 1);
        }
      }
    }
    return counts;
  }, [errors, layout.size, values]);

  const isBoardFull = useMemo(() => {
    if (values.length === 0) return false;
    for (let r = 0; r < layout.size; r++) {
      for (let c = 0; c < layout.size; c++) {
        if (values[r]?.[c] == null) return false;
      }
    }
    return true;
  }, [layout.size, values]);

  const verifyCompletedBoard = useCallback(() => {
    if (isAutoSolved) return;

    let wrongCount = 0;
    const newErrors = emptyErrors(layout.size);

    for (let r = 0; r < layout.size; r++) {
      for (let c = 0; c < layout.size; c++) {
        if (values[r][c] !== solution[r][c]) {
          newErrors[r][c] = true;
          wrongCount++;
        }
      }
    }

    setErrors(newErrors);

    if (wrongCount === 0) {
      recordWin(timerSeconds, mistakes);
    } else {
      const finalMistakes = mistakes + wrongCount;
      setMistakes(finalMistakes);
      recordLoss(finalMistakes);
      Alert.alert(
        'Game Over',
        `Puzzle verification failed! You had ${wrongCount} incorrect cell(s).`,
        [
          { text: 'Try Again', onPress: () => startNewGame(layout, difficulty) },
          { text: 'Restart Board', onPress: restartCurrentGame },
          { text: 'Home', onPress: () => setScreen('home') },
        ],
      );
    }
  }, [
    difficulty,
    isAutoSolved,
    layout.size,
    mistakes,
    recordLoss,
    recordWin,
    restartCurrentGame,
    solution,
    startNewGame,
    timerSeconds,
    values,
  ]);

  const clearSurroundingNotes = useCallback(
    (currentNotes: NotesGrid, targetRow: number, targetCol: number, digit: number): NotesGrid => {
      const { size, boxRows, boxCols } = layout;
      const numIdx = digit - 1;
      const startRow = Math.floor(targetRow / boxRows) * boxRows;
      const startCol = Math.floor(targetCol / boxCols) * boxCols;

      return currentNotes.map((noteRow, r) =>
        noteRow.map((marks, c) => {
          if (r === targetRow && c === targetCol) {
            return Array(size).fill(false);
          }

          const inRow = r === targetRow;
          const inCol = c === targetCol;
          const inBox =
            r >= startRow &&
            r < startRow + boxRows &&
            c >= startCol &&
            c < startCol + boxCols;

          if (inRow || inCol || inBox) {
            if (marks[numIdx]) {
              const nextMarks = [...marks];
              nextMarks[numIdx] = false;
              return nextMarks;
            }
          }
          return marks;
        }),
      );
    },
    [layout],
  );

  const computeConflictGrid = useCallback(
    (grid: CellValue[][], row: number, col: number, digit: number): boolean[][] => {
      const nextErrors = emptyErrors(layout.size);
      const { boxRows, boxCols } = layout;
      const startRow = Math.floor(row / boxRows) * boxRows;
      const startCol = Math.floor(col / boxCols) * boxCols;

      for (let c = 0; c < layout.size; c++) {
        if (c !== col && grid[row][c] === digit) {
          nextErrors[row][c] = true;
          nextErrors[row][col] = true;
        }
      }

      for (let r = 0; r < layout.size; r++) {
        if (r !== row && grid[r][col] === digit) {
          nextErrors[r][col] = true;
          nextErrors[row][col] = true;
        }
      }

      for (let r = 0; r < boxRows; r++) {
        for (let c = 0; c < boxCols; c++) {
          const br = startRow + r;
          const bc = startCol + c;
          if ((br !== row || bc !== col) && grid[br][bc] === digit) {
            nextErrors[br][bc] = true;
            nextErrors[row][col] = true;
          }
        }
      }

      return nextErrors;
    },
    [layout],
  );

  const executeDigitInput = useCallback(
    (targetRow: number, targetCol: number, digit: number) => {
      if (initialClues[targetRow]?.[targetCol] || isGameOver || isWon || isPaused || isAutoSolved) return;

      pushHistory();

      if (notesMode) {
        if (values[targetRow][targetCol] != null) return;
        setNotes((current) =>
          current.map((noteRow, r) =>
            noteRow.map((marks, c) =>
              r === targetRow && c === targetCol
                ? marks.map((on, index) => (index === digit - 1 ? !on : on))
                : marks,
            ),
          ),
        );
        return;
      }

      const isCorrect = solution[targetRow]?.[targetCol] === digit;

      if (settings.autoCheckErrors) {
        const nextMistakes = isCorrect ? mistakes : mistakes + 1;

        if (!isCorrect) {
          setMistakes(nextMistakes);
          if (settings.limitMistakes && nextMistakes >= 3) {
            recordLoss(nextMistakes);
            Alert.alert(
              'Game Over',
              'You made 3 mistakes. Better luck next time!',
              [
                { text: 'Try Again', onPress: () => startNewGame(layout, difficulty) },
                { text: 'Restart Board', onPress: restartCurrentGame },
                { text: 'Home', onPress: () => setScreen('home') },
              ],
            );
          }
        }
      }

      const nextValues = values.map((valRow, r) =>
        valRow.map((v, c) => (r === targetRow && c === targetCol ? digit : v)),
      );
      setValues(nextValues);

      let nextErrors = emptyErrors(layout.size);
      if (settings.highlightDuplicates) {
        nextErrors = computeConflictGrid(nextValues, targetRow, targetCol, digit);
      }
      if (settings.autoCheckErrors && !isCorrect) {
        nextErrors[targetRow][targetCol] = true;
      }
      setErrors(nextErrors);

      if (isCorrect && settings.autoRemoveNotes) {
        setNotes((curNotes) => clearSurroundingNotes(curNotes, targetRow, targetCol, digit));
      }

      if (settings.autoCheckErrors && isCorrect) {
        let isComplete = true;
        for (let r = 0; r < layout.size; r++) {
          for (let c = 0; c < layout.size; c++) {
            if (nextValues[r]?.[c] !== solution[r]?.[c]) {
              isComplete = false;
              break;
            }
          }
          if (!isComplete) break;
        }
        if (isComplete) recordWin(timerSeconds, mistakes);
      }
    },
    [
      clearSurroundingNotes,
      computeConflictGrid,
      difficulty,
      initialClues,
      isAutoSolved,
      isGameOver,
      isPaused,
      isWon,
      layout,
      mistakes,
      notesMode,
      pushHistory,
      recordLoss,
      recordWin,
      restartCurrentGame,
      settings.autoCheckErrors,
      settings.autoRemoveNotes,
      settings.highlightDuplicates,
      settings.limitMistakes,
      solution,
      startNewGame,
      timerSeconds,
      values,
    ],
  );

  const handleSelectCell = useCallback(
    (cell: SelectedCell) => {
      setSelected(cell);
      if (settings.fastInputMode && lockedDigit != null) {
        executeDigitInput(cell.row, cell.col, lockedDigit);
      }
    },
    [executeDigitInput, lockedDigit, settings.fastInputMode],
  );

  const handleKeypadDigit = useCallback(
    (digit: number) => {
      if (settings.fastInputMode) {
        setLockedDigit((prev) => (prev === digit ? null : digit));
      } else {
        if (selected != null) {
          executeDigitInput(selected.row, selected.col, digit);
        }
      }
    },
    [executeDigitInput, selected, settings.fastInputMode],
  );

  const requestSmartHint = useCallback(() => {
    if (isGameOver || isWon || isPaused || isAutoSolved) return;

    for (let r = 0; r < layout.size; r++) {
      for (let c = 0; c < layout.size; c++) {
        if (values[r][c] == null && !initialClues[r][c]) {
          const correctVal = solution[r][c]!;
          setActiveHint({
            row: r,
            col: c,
            value: correctVal,
            reason: `In Row ${r + 1}, Column ${c + 1}, placing ${correctVal} satisfies all surrounding grid and block constraints.`,
          });
          setSelected({ row: r, col: c });
          return;
        }
      }
    }
  }, [initialClues, isAutoSolved, isGameOver, isPaused, isWon, layout.size, solution, values]);

  const applyActiveSmartHint = useCallback(() => {
    if (!activeHint) return;
    setHintsUsed((prev) => prev + 1);
    executeDigitInput(activeHint.row, activeHint.col, activeHint.value);
    setActiveHint(null);
  }, [activeHint, executeDigitInput]);

  const onUndo = useCallback(() => {
    if (history.length === 0 || isGameOver || isWon || isPaused || isAutoSolved) return;
    const previous = history[history.length - 1];
    setValues(previous.values);
    setNotes(previous.notes);
    setErrors(previous.errors);
    setMistakes(previous.mistakes);
    setHistory((prev) => prev.slice(0, -1));
  }, [history, isAutoSolved, isGameOver, isPaused, isWon]);

  const onErase = useCallback(() => {
    if (selected == null || isGameOver || isWon || isPaused || isAutoSolved) return;
    const { row, col } = selected;
    if (initialClues[row]?.[col]) return;

    pushHistory();
    setValues((current) =>
      current.map((rArr, r) =>
        rArr.map((val, c) => (r === row && c === col ? null : val)),
      ),
    );
    setErrors((current) =>
      current.map((rArr, r) =>
        rArr.map((err, c) => (r === row && c === col ? false : err)),
      ),
    );
  }, [initialClues, isAutoSolved, isGameOver, isPaused, isWon, pushHistory, selected]);

  const onSolveBoard = useCallback(() => {
    if (solution.length === 0 || isGameOver || isWon || isAutoSolved) return;
    Alert.alert(
      'Reveal Solution?',
      'Solving the board automatically allows you to inspect the solution, but will not count towards your stats, win count, or records.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Reveal Solution',
          style: 'destructive',
          onPress: () => {
            setIsAutoSolved(true);
            setIsGameOver(true);
            setHasSavedGame(false);
            setValues(solution);
            setErrors(emptyErrors(layout.size));
            setNotes(emptyNotes(layout.size));
            setSelected(null);
            setLockedDigit(null);
            setActiveHint(null);
          },
        },
      ],
    );
  }, [isAutoSolved, isGameOver, isWon, layout.size, solution]);

  const handleAuthAction = async () => {
    if (user) {
      Alert.alert('Sign Out', 'Do you want to log out of your cloud account?', [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Log Out',
          style: 'destructive',
          onPress: async () => {
            try {
              await signOutUser();
            } catch (err: any) {
              Alert.alert('Error signing out', err.message);
            }
          },
        },
      ]);
    } else {
      try {
        setAuthLoading(true);
        await signInWithGoogle();
      } catch (err: any) {
        Alert.alert('Sign-in Error', err.message || 'Could not complete sign in');
      } finally {
        setAuthLoading(false);
      }
    }
  };

  const handleBackPress = () => {
    Alert.alert(
      'Leave Game?',
      'Your game progress is saved. You can resume anytime from Home.',
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Go Home', onPress: () => setScreen('home') },
      ],
    );
  };

  if (!isLoaded) return null;

  const avatarUrl = user?.user_metadata?.avatar_url || user?.user_metadata?.picture;

  return (
    <View style={[styles.container, { backgroundColor: theme.appBg }]}>
      <StatusBar style={isDark ? 'light' : 'dark'} />

      {screen === 'game' ? (
        <View style={styles.gameContent}>
          <View style={styles.gameHeader}>
            <View style={styles.gameHeaderTopRow}>
              <Pressable onPress={handleBackPress} style={styles.backButton}>
                <Text style={[styles.backButtonText, { color: theme.textPrimary }]}>
                  ‹ Back
                </Text>
              </Pressable>

              <View style={styles.topRightActions}>
                <Pressable
                  onPress={toggleFavoriteCurrentGame}
                  style={styles.iconCircle}
                  accessibilityLabel="Favorite this game"
                >
                  <Text style={styles.iconCircleText}>
                    {isCurrentFavorite ? '★' : '☆'}
                  </Text>
                </Pressable>
                <Pressable
                  onPress={() => setRulesModalOpen(true)}
                  style={styles.iconCircle}
                  accessibilityLabel="Rules and How to play"
                >
                  <Text style={styles.iconCircleText}>?</Text>
                </Pressable>
                <Pressable
                  onPress={() => setThemeModalOpen(true)}
                  style={styles.iconCircle}
                  accessibilityLabel="Theme options"
                >
                  <Text style={styles.iconCircleText}>🎨</Text>
                </Pressable>
                <Pressable
                  onPress={() => setSettingsModalOpen(true)}
                  style={styles.iconCircle}
                  accessibilityLabel="Settings"
                >
                  <Text style={styles.iconCircleText}>⚙</Text>
                </Pressable>
              </View>
            </View>

            <View style={styles.statsRow}>
              <Text style={[styles.statText, { color: theme.textSecondary }]}>
                {isAutoSolved
                  ? 'Revealed (Practice)'
                  : settings.autoCheckErrors
                  ? `Mistakes: ${settings.limitMistakes ? `${mistakes}/3` : mistakes}`
                  : 'Mode: Unguided'}
              </Text>
              <Pressable
                onPress={restartCurrentGame}
                style={[styles.smallActionBtn, { backgroundColor: theme.cardBg }]}
              >
                <Text style={[styles.smallActionText, { color: theme.textPrimary }]}>
                  🔄 Restart
                </Text>
              </Pressable>
              {!isAutoSolved && (
                <Pressable
                  onPress={() => setIsPaused(!isPaused)}
                  style={[styles.smallActionBtn, { backgroundColor: theme.cardBg }]}
                >
                  <Text style={[styles.smallActionText, { color: theme.textPrimary }]}>
                    {isPaused ? '▶ Play' : '⏸ Pause'}
                  </Text>
                </Pressable>
              )}
              {!isAutoSolved && (
                <Pressable
                  onPress={onSolveBoard}
                  style={[styles.smallActionBtn, { backgroundColor: theme.cardBg }]}
                >
                  <Text style={[styles.smallActionText, { color: theme.textSecondary }]}>
                    Solve
                  </Text>
                </Pressable>
              )}
              {settings.showTimer && (
                <Text style={[styles.statText, { color: theme.textSecondary }]}>
                  {formatTime(timerSeconds)}
                </Text>
              )}
            </View>
          </View>

          <Board
            layout={layout}
            values={values}
            initialClues={initialClues}
            errors={errors}
            notes={notes}
            selected={selected}
            hintHighlightCell={activeHint ? { row: activeHint.row, col: activeHint.col } : null}
            isPaused={isPaused}
            theme={theme}
            onResume={() => setIsPaused(false)}
            onSelectCell={handleSelectCell}
          />

          {/* Smart Hint Explanation Banner */}
          {activeHint && !isAutoSolved && (
            <View style={styles.hintBanner}>
              <View style={{ flex: 1, paddingRight: 8 }}>
                <Text style={styles.hintBannerTitle}>💡 Smart Hint</Text>
                <Text style={styles.hintBannerBody}>{activeHint.reason}</Text>
              </View>
              <Pressable style={styles.hintApplyBtn} onPress={applyActiveSmartHint}>
                <Text style={styles.hintApplyBtnText}>Apply</Text>
              </Pressable>
            </View>
          )}

          {!settings.autoCheckErrors && isBoardFull && !isGameOver && !isWon && !isAutoSolved ? (
            <Pressable
              style={[styles.verifyButton, { backgroundColor: '#10B981' }]}
              onPress={verifyCompletedBoard}
            >
              <Text style={styles.verifyButtonText}>✓ Verify Board</Text>
            </Pressable>
          ) : (
            <Keypad
              size={layout.size}
              notesMode={notesMode}
              selectedDigit={lockedDigit}
              remainingCounts={remainingCounts}
              canUndo={history.length > 0 && !isAutoSolved}
              onNotesModeChange={setNotesMode}
              onDigit={handleKeypadDigit}
              onErase={onErase}
              onUndo={onUndo}
              onHint={requestSmartHint}
            />
          )}
        </View>
      ) : (
        <View style={styles.tabContainer}>
          <View style={styles.appHeader}>
            <Text style={[styles.appHeaderTitle, { color: theme.textPrimary }]}>
              {tab === 'home' ? 'Ramcraft' : tab === 'stats' ? 'Statistics' : 'Profile'}
            </Text>
            <View style={styles.topRightActions}>
              <Pressable
                onPress={() => setFavoritesOpen(true)}
                style={styles.iconCircle}
                accessibilityLabel="View starred games"
              >
                <Text style={styles.iconCircleText}>★</Text>
              </Pressable>
              <Pressable
                onPress={() => setRulesModalOpen(true)}
                style={styles.iconCircle}
                accessibilityLabel="Rules and How to play"
              >
                <Text style={styles.iconCircleText}>?</Text>
              </Pressable>
              <Pressable
                onPress={() => setThemeModalOpen(true)}
                style={styles.iconCircle}
                accessibilityLabel="Theme options"
              >
                <Text style={styles.iconCircleText}>🎨</Text>
              </Pressable>
              <Pressable
                onPress={() => setSettingsModalOpen(true)}
                style={styles.iconCircle}
                accessibilityLabel="Settings"
              >
                <Text style={styles.iconCircleText}>⚙</Text>
              </Pressable>
            </View>
          </View>

          {tab === 'home' && (
            <ScrollView
              contentContainerStyle={styles.homeScrollContent}
              showsVerticalScrollIndicator={false}
            >
              <View style={styles.homeCardWrapper}>
                <Image
                  source={require('./assets/logo.png')}
                  style={styles.logoImage}
                  resizeMode="contain"
                />
                <Text style={[styles.title, { color: theme.textPrimary }]}>
                  Ramcraft
                </Text>
                <Text style={[styles.subtitle, { color: theme.textSecondary }]}>
                  Classic Logic Challenge
                </Text>

                {hasSavedGame && (
                  <Pressable
                    style={styles.resumeCard}
                    onPress={() => {
                      setIsPaused(false);
                      setScreen('game');
                    }}
                  >
                    <View style={styles.resumeHeader}>
                      <Text style={styles.resumeTitle}>▶ Resume Game</Text>
                      {settings.showTimer && (
                        <Text style={styles.resumeTime}>
                          {formatTime(timerSeconds)}
                        </Text>
                      )}
                    </View>
                    <Text style={styles.resumeDetails}>
                      {layout.label} • {difficulty.toUpperCase()} • Mistakes:{' '}
                      {settings.limitMistakes ? `${mistakes}/3` : mistakes}
                    </Text>
                  </Pressable>
                )}

                <SizePicker layout={pickerLayout} onChange={setPickerLayout} />
                <DifficultyPicker
                  difficulty={pickerDifficulty}
                  onChange={setPickerDifficulty}
                />

                <Pressable
                  style={[styles.playButton, { backgroundColor: theme.accentBtn }]}
                  onPress={() => startNewGame(pickerLayout, pickerDifficulty)}
                >
                  <Text style={styles.playButtonText}>Start New Game</Text>
                </Pressable>
              </View>
            </ScrollView>
          )}

          {tab === 'stats' && (
            <ScrollView
              contentContainerStyle={styles.statsScrollContent}
              showsVerticalScrollIndicator={false}
            >
              <Text style={[styles.sectionHeading, { color: theme.textPrimary }]}>
                Performance Overview
              </Text>
              {BOARD_LAYOUTS.map((opt) => {
                const diffs: Difficulty[] = ['easy', 'medium', 'hard', 'expert'];
                return (
                  <View
                    key={opt.label}
                    style={[styles.statCategoryCard, { backgroundColor: theme.cardBg }]}
                  >
                    <Text style={[styles.statCardHeader, { color: theme.textPrimary }]}>
                      {opt.label}
                    </Text>
                    {diffs.map((d) => {
                      const k = `${opt.label} - ${d.toUpperCase()}`;
                      const cs = stats[k] || {
                        started: 0,
                        won: 0,
                        bestTime: null,
                        streak: 0,
                      };
                      return (
                        <View key={d} style={styles.statRowItem}>
                          <Text
                            style={[
                              styles.statRowLabel,
                              { color: theme.textSecondary },
                            ]}
                          >
                            {d.toUpperCase()}
                          </Text>
                          <Text style={[styles.statRowValue, { color: theme.textPrimary }]}>
                            Won: {cs.won}/{cs.started} • Streak: 🔥{cs.streak} • Best:{' '}
                            {cs.bestTime ? formatTime(cs.bestTime) : '--:--'}
                          </Text>
                        </View>
                      );
                    })}
                  </View>
                );
              })}
            </ScrollView>
          )}

          {tab === 'profile' && (
            <View style={styles.profileContent}>
              <View style={styles.avatarCircle}>
                {avatarUrl ? (
                  <Image
                    source={{ uri: avatarUrl }}
                    style={styles.avatarImage}
                    resizeMode="cover"
                  />
                ) : (
                  <Text style={styles.avatarText}>{user ? '✨' : '👤'}</Text>
                )}
              </View>
              <Text style={[styles.profileName, { color: theme.textPrimary }]}>
                {user?.user_metadata?.full_name || user?.user_metadata?.name || (user ? 'Ramcraft Player' : 'Guest Player')}
              </Text>
              <Text style={[styles.profileId, { color: theme.textSecondary }]}>
                {user ? user.email : `Device ID: ${deviceId}`}
              </Text>

              <View
                style={[styles.profileCard, { backgroundColor: theme.cardBg }]}
              >
                <Text style={[styles.profileCardTitle, { color: theme.textPrimary }]}>
                  Account Status
                </Text>
                <Text
                  style={[styles.profileCardBody, { color: theme.textSecondary }]}
                >
                  {user
                    ? 'Connected to Supabase Cloud. Your statistics, streak, and saved games are synced to your account.'
                    : 'Playing as guest. Your progress is tracked via Android Device ID (AAID). Sign in with Google to sync across devices.'}
                </Text>
              </View>

              <Pressable
                style={[
                  styles.loginBtn,
                  { backgroundColor: user ? '#DC2626' : theme.accentBtn },
                ]}
                onPress={handleAuthAction}
                disabled={authLoading}
              >
                <Text style={styles.loginBtnText}>
                  {authLoading
                    ? 'Connecting...'
                    : user
                    ? 'Log Out'
                    : 'Sign In with Google'}
                </Text>
              </Pressable>
            </View>
          )}

          <View
            style={[
              styles.bottomTabBar,
              {
                backgroundColor: theme.cardBg,
                borderTopColor: theme.blockBg,
                paddingBottom: insets.bottom > 0 ? insets.bottom : 12,
                height: 58 + (insets.bottom > 0 ? insets.bottom : 12),
              },
            ]}
          >
            <Pressable onPress={() => setTab('home')} style={styles.tabItem}>
              <Text
                style={[
                  styles.tabIcon,
                  { color: tab === 'home' ? theme.userText : theme.textSecondary },
                ]}
              >
                🏠
              </Text>
              <Text
                style={[
                  styles.tabLabel,
                  { color: tab === 'home' ? theme.userText : theme.textSecondary },
                ]}
              >
                Home
              </Text>
            </Pressable>

            <Pressable
              onPress={() => {
                setTab('stats');
                refreshStats();
              }}
              style={styles.tabItem}
            >
              <Text
                style={[
                  styles.tabIcon,
                  { color: tab === 'stats' ? theme.userText : theme.textSecondary },
                ]}
              >
                📊
              </Text>
              <Text
                style={[
                  styles.tabLabel,
                  { color: tab === 'stats' ? theme.userText : theme.textSecondary },
                ]}
              >
                Stats
              </Text>
            </Pressable>

            <Pressable onPress={() => setTab('profile')} style={styles.tabItem}>
              <Text
                style={[
                  styles.tabIcon,
                  {
                    color: tab === 'profile' ? theme.userText : theme.textSecondary,
                  },
                ]}
              >
                👤
              </Text>
              <Text
                style={[
                  styles.tabLabel,
                  {
                    color: tab === 'profile' ? theme.userText : theme.textSecondary,
                  },
                ]}
              >
                Profile
              </Text>
            </Pressable>
          </View>
        </View>
      )}

      {/* Favorites Modal */}
      <Modal visible={favoritesOpen} animationType="slide" transparent>
        <View style={styles.modalOverlay}>
          <View style={[styles.modalBox, { backgroundColor: theme.cardBg }]}>
            <View style={styles.modalHeader}>
              <Text style={[styles.modalTitle, { color: theme.textPrimary }]}>
                ⭐ Starred Games ({favorites.length})
              </Text>
              <Pressable onPress={() => setFavoritesOpen(false)}>
                <Text style={[styles.closeModalText, { color: theme.textSecondary }]}>
                  ✕
                </Text>
              </Pressable>
            </View>

            {favorites.length === 0 ? (
              <Text style={[styles.emptyModalText, { color: theme.textSecondary }]}>
                No favorite games saved yet. Tap the star (☆) during a game to save it
                here!
              </Text>
            ) : (
              <ScrollView style={{ maxHeight: 360 }}>
                {favorites.map((fav) => (
                  <Pressable
                    key={fav.id}
                    onPress={() => loadFavoriteGame(fav)}
                    style={[styles.favItem, { borderBottomColor: theme.blockBg }]}
                  >
                    <View>
                      <Text style={[styles.favTitle, { color: theme.textPrimary }]}>
                        {fav.layout.label} • {fav.difficulty.toUpperCase()}
                      </Text>
                      <Text style={[styles.favSub, { color: theme.textSecondary }]}>
                        Saved on {fav.date} • {formatTime(fav.timerSeconds)} • Mistakes:{' '}
                        {fav.mistakes}
                      </Text>
                    </View>
                    <Text style={{ fontSize: 18, color: '#F59E0B' }}>▶</Text>
                  </Pressable>
                ))}
              </ScrollView>
            )}
          </View>
        </View>
      </Modal>

      {/* Themes Modal */}
      <Modal visible={themeModalOpen} animationType="fade" transparent>
        <View style={styles.modalOverlay}>
          <View style={[styles.modalBox, { backgroundColor: theme.cardBg }]}>
            <View style={styles.modalHeader}>
              <Text style={[styles.modalTitle, { color: theme.textPrimary }]}>
                Appearance & Theme
              </Text>
              <Pressable onPress={() => setThemeModalOpen(false)}>
                <Text style={[styles.closeModalText, { color: theme.textSecondary }]}>
                  ✕
                </Text>
              </Pressable>
            </View>

            <Text style={[styles.settingLabel, { color: theme.textPrimary }]}>
              Color Mode
            </Text>
            <View style={styles.optionRow}>
              <Pressable
                onPress={() => updateSettings({ themeMode: 'light' })}
                style={[
                  styles.segmentBtn,
                  settings.themeMode === 'light' && styles.segmentBtnActive,
                ]}
              >
                <Text
                  style={[
                    styles.segmentText,
                    settings.themeMode === 'light' && styles.segmentTextActive,
                  ]}
                >
                  ☀ Light
                </Text>
              </Pressable>
              <Pressable
                onPress={() => updateSettings({ themeMode: 'dark' })}
                style={[
                  styles.segmentBtn,
                  settings.themeMode === 'dark' && styles.segmentBtnActive,
                ]}
              >
                <Text
                  style={[
                    styles.segmentText,
                    settings.themeMode === 'dark' && styles.segmentBtnActive,
                  ]}
                >
                  🌙 Dark
                </Text>
              </Pressable>
            </View>

            <Text
              style={[
                styles.settingLabel,
                { color: theme.textPrimary, marginTop: 16 },
              ]}
            >
              Background Palettes
            </Text>
            <View style={styles.palettesRow}>
              {[
                { id: 'classic', label: 'Classic' },
                { id: 'sepia', label: 'Warm Sepia' },
                { id: 'slate', label: 'Slate' },
                { id: 'navy', label: 'Midnight Navy' },
              ].map((p) => (
                <Pressable
                  key={p.id}
                  onPress={() =>
                    updateSettings({ accentTheme: p.id as AppSettings['accentTheme'] })
                  }
                  style={[
                    styles.paletteChip,
                    settings.accentTheme === p.id && styles.paletteChipActive,
                  ]}
                >
                  <Text
                    style={[
                      styles.paletteText,
                      settings.accentTheme === p.id && styles.paletteTextActive,
                    ]}
                  >
                    {p.label}
                  </Text>
                </Pressable>
              ))}
            </View>
          </View>
        </View>
      </Modal>

      {/* Settings Modal */}
      <Modal visible={settingsModalOpen} animationType="fade" transparent>
        <View style={styles.modalOverlay}>
          <View style={[styles.modalBox, { backgroundColor: theme.cardBg }]}>
            <View style={styles.modalHeader}>
              <Text style={[styles.modalTitle, { color: theme.textPrimary }]}>
                Game Settings
              </Text>
              <Pressable onPress={() => setSettingsModalOpen(false)}>
                <Text style={[styles.closeModalText, { color: theme.textSecondary }]}>
                  ✕
                </Text>
              </Pressable>
            </View>

            <ScrollView showsVerticalScrollIndicator={false}>
              <View style={styles.switchRow}>
                <View style={{ flex: 1, paddingRight: 10 }}>
                  <Text style={[styles.switchTitle, { color: theme.textPrimary }]}>
                    Number-First Mode
                  </Text>
                  <Text style={[styles.switchSub, { color: theme.textSecondary }]}>
                    Lock a number key to tap and place it across multiple cells quickly
                  </Text>
                </View>
                <Switch
                  value={settings.fastInputMode}
                  onValueChange={(val) => {
                    updateSettings({ fastInputMode: val });
                    if (!val) setLockedDigit(null);
                  }}
                />
              </View>

              <View style={styles.switchRow}>
                <View style={{ flex: 1, paddingRight: 10 }}>
                  <Text style={[styles.switchTitle, { color: theme.textPrimary }]}>
                    Highlight Duplicates
                  </Text>
                  <Text style={[styles.switchSub, { color: theme.textSecondary }]}>
                    Highlight conflicting numbers in row, column, and block
                  </Text>
                </View>
                <Switch
                  value={settings.highlightDuplicates}
                  onValueChange={(val) => updateSettings({ highlightDuplicates: val })}
                />
              </View>

              <View style={styles.switchRow}>
                <View style={{ flex: 1, paddingRight: 10 }}>
                  <Text style={[styles.switchTitle, { color: theme.textPrimary }]}>
                    Auto-Check Errors
                  </Text>
                  <Text style={[styles.switchSub, { color: theme.textSecondary }]}>
                    {settings.autoCheckErrors
                      ? 'Highlight incorrect numbers immediately'
                      : 'Unguided Mode: Fill wrong numbers freely, verify at the end'}
                  </Text>
                </View>
                <Switch
                  value={settings.autoCheckErrors}
                  onValueChange={(val) => updateSettings({ autoCheckErrors: val })}
                />
              </View>

              {settings.autoCheckErrors && (
                <View style={styles.switchRow}>
                  <View style={{ flex: 1, paddingRight: 10 }}>
                    <Text style={[styles.switchTitle, { color: theme.textPrimary }]}>
                      3-Mistake Limit
                    </Text>
                    <Text style={[styles.switchSub, { color: theme.textSecondary }]}>
                      {settings.limitMistakes
                        ? 'Game Over after 3 errors'
                        : 'Unlimited errors allowed (Relaxed Mode)'}
                    </Text>
                  </View>
                  <Switch
                    value={settings.limitMistakes}
                    onValueChange={(val) => updateSettings({ limitMistakes: val })}
                  />
                </View>
              )}

              <View style={styles.switchRow}>
                <View style={{ flex: 1, paddingRight: 10 }}>
                  <Text style={[styles.switchTitle, { color: theme.textPrimary }]}>
                    Auto-Clear Notes
                  </Text>
                  <Text style={[styles.switchSub, { color: theme.textSecondary }]}>
                    Erase placed numbers from candidate notes in row, column, and block
                  </Text>
                </View>
                <Switch
                  value={settings.autoRemoveNotes}
                  onValueChange={(val) => updateSettings({ autoRemoveNotes: val })}
                />
              </View>

              <View style={styles.switchRow}>
                <View style={{ flex: 1, paddingRight: 10 }}>
                  <Text style={[styles.switchTitle, { color: theme.textPrimary }]}>
                    Show Timer
                  </Text>
                  <Text style={[styles.switchSub, { color: theme.textSecondary }]}>
                    Display solve timer during active games
                  </Text>
                </View>
                <Switch
                  value={settings.showTimer}
                  onValueChange={(val) => updateSettings({ showTimer: val })}
                />
              </View>
            </ScrollView>
          </View>
        </View>
      </Modal>

      {/* Rules Modal */}
      <Modal visible={rulesModalOpen} animationType="slide" transparent>
        <View style={styles.modalOverlay}>
          <View style={[styles.modalBox, { backgroundColor: theme.cardBg, maxHeight: '82%' }]}>
            <View style={styles.modalHeader}>
              <Text style={[styles.modalTitle, { color: theme.textPrimary }]}>
                How to Play Sudoku
              </Text>
              <Pressable onPress={() => setRulesModalOpen(false)}>
                <Text style={[styles.closeModalText, { color: theme.textSecondary }]}>
                  ✕
                </Text>
              </Pressable>
            </View>

            <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ gap: 12, paddingBottom: 16 }}>
              <View style={[styles.statCategoryCard, { backgroundColor: theme.appBg }]}>
                <Text style={[styles.switchTitle, { color: theme.textPrimary }]}>1. The Goal</Text>
                <Text style={[styles.switchSub, { color: theme.textSecondary, marginTop: 4 }]}>
                  Fill the entire board so each row, column, and block contains each digit without repetition.
                </Text>
              </View>

              <View style={[styles.statCategoryCard, { backgroundColor: theme.appBg }]}>
                <Text style={[styles.switchTitle, { color: theme.textPrimary }]}>2. Standard 9x9 Grid</Text>
                <Text style={[styles.switchSub, { color: theme.textSecondary, marginTop: 4 }]}>
                  • Each row must contain digits 1 to 9.{'\n'}
                  • Each column must contain digits 1 to 9.{'\n'}
                  • Each 3x3 block must contain digits 1 to 9.
                </Text>
              </View>

              <View style={[styles.statCategoryCard, { backgroundColor: theme.appBg }]}>
                <Text style={[styles.switchTitle, { color: theme.textPrimary }]}>3. Input Modes</Text>
                <Text style={[styles.switchSub, { color: theme.textSecondary, marginTop: 4 }]}>
                  • <Text style={{ fontWeight: '700', color: theme.textPrimary }}>Cell-First (Default):</Text> Tap a cell, then tap a digit.{'\n'}
                  • <Text style={{ fontWeight: '700', color: theme.textPrimary }}>Number-First (Fast Input):</Text> Turn on in Settings, tap a number key to lock it, then rapidly tap board cells to place it!
                </Text>
              </View>

              <View style={[styles.statCategoryCard, { backgroundColor: theme.appBg }]}>
                <Text style={[styles.switchTitle, { color: theme.textPrimary }]}>4. Solvers & Assists</Text>
                <Text style={[styles.switchSub, { color: theme.textSecondary, marginTop: 4 }]}>
                  • <Text style={{ fontWeight: '700', color: theme.textPrimary }}>Smart Hints (💡):</Text> Highlights logical deductions and explains why a move belongs there.{'\n'}
                  • <Text style={{ fontWeight: '700', color: theme.textPrimary }}>Notes Mode (✎):</Text> Pencil in candidate numbers.{'\n'}
                  • <Text style={{ fontWeight: '700', color: theme.textPrimary }}>Highlight Matches:</Text> Tap any placed number to see identical digits on the board.
                </Text>
              </View>
            </ScrollView>

            <Pressable
              style={[styles.playButton, { backgroundColor: theme.accentBtn, marginTop: 8 }]}
              onPress={() => setRulesModalOpen(false)}
            >
              <Text style={styles.playButtonText}>Got it!</Text>
            </Pressable>
          </View>
        </View>
      </Modal>
    </View>
  );
}

export default function App() {
  return (
    <SafeAreaProvider>
      <MainApp />
    </SafeAreaProvider>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  tabContainer: {
    flex: 1,
    paddingTop: 44,
  },
  appHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingBottom: 10,
  },
  appHeaderTitle: {
    fontSize: 24,
    fontWeight: '800',
  },
  topRightActions: {
    flexDirection: 'row',
    gap: 8,
  },
  iconCircle: {
    width: 38,
    height: 38,
    borderRadius: 19,
    backgroundColor: 'rgba(128,128,128,0.15)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  iconCircleText: {
    fontSize: 18,
  },
  homeScrollContent: {
    flexGrow: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingVertical: 16,
    paddingHorizontal: 20,
  },
  homeCardWrapper: {
    width: '100%',
    maxWidth: 400,
    alignItems: 'center',
  },
  logoImage: {
    width: 80,
    height: 80,
    borderRadius: 20,
    marginBottom: 8,
  },
  title: {
    fontSize: 28,
    fontWeight: '800',
    letterSpacing: 2,
  },
  subtitle: {
    fontSize: 13,
    marginBottom: 16,
  },
  resumeCard: {
    width: '100%',
    backgroundColor: '#005BBB',
    paddingVertical: 12,
    paddingHorizontal: 16,
    borderRadius: 12,
    marginBottom: 14,
  },
  resumeHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 2,
  },
  resumeTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: '#FFFFFF',
  },
  resumeTime: {
    fontSize: 15,
    fontWeight: '600',
    color: '#E0F2FE',
  },
  resumeDetails: {
    fontSize: 11,
    color: '#BAE6FD',
    fontWeight: '500',
  },
  playButton: {
    width: '100%',
    paddingVertical: 14,
    borderRadius: 10,
    alignItems: 'center',
    marginTop: 10,
  },
  playButtonText: {
    color: '#FFFFFF',
    fontSize: 15,
    fontWeight: '700',
  },
  statsScrollContent: {
    padding: 20,
    paddingBottom: 80,
  },
  sectionHeading: {
    fontSize: 18,
    fontWeight: '700',
    marginBottom: 14,
  },
  statCategoryCard: {
    padding: 16,
    borderRadius: 12,
    marginBottom: 14,
    elevation: 1,
  },
  statCardHeader: {
    fontSize: 16,
    fontWeight: '700',
    marginBottom: 8,
  },
  statRowItem: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: 4,
  },
  statRowLabel: {
    fontSize: 13,
    fontWeight: '600',
  },
  statRowValue: {
    fontSize: 13,
    fontWeight: '500',
  },
  profileContent: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
  },
  avatarCircle: {
    width: 90,
    height: 90,
    borderRadius: 45,
    backgroundColor: '#9E9E9E',
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
    marginBottom: 12,
  },
  avatarImage: {
    width: '100%',
    height: '100%',
  },
  avatarText: {
    fontSize: 44,
  },
  profileName: {
    fontSize: 22,
    fontWeight: '700',
  },
  profileId: {
    fontSize: 14,
    marginBottom: 24,
  },
  profileCard: {
    width: '100%',
    maxWidth: 360,
    padding: 16,
    borderRadius: 12,
    marginBottom: 24,
  },
  profileCardTitle: {
    fontSize: 16,
    fontWeight: '700',
    marginBottom: 6,
  },
  profileCardBody: {
    fontSize: 13,
    lineHeight: 18,
  },
  loginBtn: {
    width: '100%',
    maxWidth: 360,
    paddingVertical: 14,
    borderRadius: 10,
    alignItems: 'center',
  },
  loginBtnText: {
    color: '#FFFFFF',
    fontSize: 15,
    fontWeight: '700',
  },
  bottomTabBar: {
    flexDirection: 'row',
    borderTopWidth: 1,
    justifyContent: 'space-around',
    alignItems: 'center',
  },
  tabItem: {
    alignItems: 'center',
    justifyContent: 'center',
    flex: 1,
  },
  tabIcon: {
    fontSize: 20,
  },
  tabLabel: {
    fontSize: 11,
    fontWeight: '600',
    marginTop: 2,
  },
  gameContent: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 16,
    paddingTop: 36,
  },
  gameHeader: {
    width: '100%',
    maxWidth: 420,
    marginBottom: 8,
    gap: 8,
  },
  gameHeaderTopRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  backButton: {
    paddingVertical: 4,
    paddingHorizontal: 6,
  },
  backButtonText: {
    fontSize: 18,
    fontWeight: '700',
  },
  statsRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 4,
  },
  statText: {
    fontSize: 13,
    fontWeight: '600',
  },
  smallActionBtn: {
    paddingVertical: 4,
    paddingHorizontal: 8,
    borderRadius: 6,
  },
  smallActionText: {
    fontSize: 12,
    fontWeight: '600',
  },
  hintBanner: {
    width: '100%',
    maxWidth: 420,
    backgroundColor: '#FEF9C3',
    borderColor: '#FDE047',
    borderWidth: 1,
    borderRadius: 10,
    padding: 10,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: 8,
  },
  hintBannerTitle: {
    fontSize: 13,
    fontWeight: '700',
    color: '#854D0E',
  },
  hintBannerBody: {
    fontSize: 12,
    color: '#713F12',
    marginTop: 2,
  },
  hintApplyBtn: {
    backgroundColor: '#CA8A04',
    paddingVertical: 6,
    paddingHorizontal: 14,
    borderRadius: 6,
  },
  hintApplyBtnText: {
    color: '#FFFFFF',
    fontSize: 13,
    fontWeight: '700',
  },
  verifyButton: {
    width: '100%',
    maxWidth: 420,
    paddingVertical: 14,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 14,
    elevation: 3,
  },
  verifyButtonText: {
    color: '#FFFFFF',
    fontSize: 16,
    fontWeight: '800',
    letterSpacing: 1,
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20,
  },
  modalBox: {
    width: '100%',
    maxWidth: 380,
    borderRadius: 16,
    padding: 20,
    elevation: 5,
  },
  modalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 16,
  },
  modalTitle: {
    fontSize: 18,
    fontWeight: '700',
  },
  closeModalText: {
    fontSize: 20,
    fontWeight: '700',
  },
  emptyModalText: {
    fontSize: 14,
    textAlign: 'center',
    paddingVertical: 20,
    lineHeight: 20,
  },
  favItem: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 12,
    borderBottomWidth: 1,
  },
  favTitle: {
    fontSize: 15,
    fontWeight: '700',
  },
  favSub: {
    fontSize: 12,
    marginTop: 2,
  },
  settingLabel: {
    fontSize: 14,
    fontWeight: '700',
    marginBottom: 8,
  },
  optionRow: {
    flexDirection: 'row',
    gap: 10,
  },
  segmentBtn: {
    flex: 1,
    paddingVertical: 10,
    alignItems: 'center',
    borderRadius: 8,
    backgroundColor: '#E5E7EB',
  },
  segmentBtnActive: {
    backgroundColor: '#111827',
  },
  segmentText: {
    fontSize: 14,
    fontWeight: '600',
    color: '#374151',
  },
  segmentTextActive: {
    color: '#FFFFFF',
  },
  palettesRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  paletteChip: {
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderRadius: 8,
    backgroundColor: '#E5E7EB',
  },
  paletteChipActive: {
    backgroundColor: '#3B82F6',
  },
  paletteText: {
    fontSize: 13,
    fontWeight: '600',
    color: '#374151',
  },
  paletteTextActive: {
    color: '#FFFFFF',
  },
  switchRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 10,
  },
  switchTitle: {
    fontSize: 15,
    fontWeight: '700',
  },
  switchSub: {
    fontSize: 12,
    marginTop: 2,
  },
});