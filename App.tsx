import AsyncStorage from '@react-native-async-storage/async-storage';
import { StatusBar } from 'expo-status-bar';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { supabase } from './lib/supabase';
import type { User } from '@supabase/supabase-js';
import { getCurrentUser, signInWithGoogle, signOutUser } from './lib/auth';
import { recordGameRunToSupabase } from './lib/gameSync';
import { syncUserDataUponLogin } from './lib/gameSync';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as Application from 'expo-application';
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
const STATS_KEY = '@sudoku_stats_v4';
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
  themeMode: 'light' | 'dark';
  accentTheme: 'classic' | 'sepia' | 'slate' | 'navy';
};

const DEFAULT_SETTINGS: AppSettings = {
  limitMistakes: true,
  themeMode: 'light',
  accentTheme: 'classic',
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

export default function App() {
  const [tab, setTab] = useState<'home' | 'stats' | 'profile'>('home');
  const [screen, setScreen] = useState<'home' | 'game'>('home');
  const [favoritesOpen, setFavoritesOpen] = useState(false);
  const [themeModalOpen, setThemeModalOpen] = useState(false);
  const [settingsModalOpen, setSettingsModalOpen] = useState(false);

  const [settings, setSettings] = useState<AppSettings>(DEFAULT_SETTINGS);
  const [layout, setLayout] = useState<BoardLayout>(DEFAULT_BOARD_LAYOUT);
  const [difficulty, setDifficulty] = useState<Difficulty>('medium');

  // Dedicated picker states for the Home screen selection
  const [pickerLayout, setPickerLayout] = useState<BoardLayout>(DEFAULT_BOARD_LAYOUT);
  const [pickerDifficulty, setPickerDifficulty] = useState<Difficulty>('medium');

  const insets = useSafeAreaInsets();

  const [gameId, setGameId] = useState<string>(() => Date.now().toString());
  const [values, setValues] = useState<CellValue[][]>([]);
  const [solution, setSolution] = useState<CellValue[][]>([]);
  const [initialClues, setInitialClues] = useState<boolean[][]>([]);
  const [errors, setErrors] = useState<boolean[][]>([]);
  const [notes, setNotes] = useState<NotesGrid>([]);
  const [selected, setSelected] = useState<SelectedCell | null>(null);
  const [notesMode, setNotesMode] = useState(false);
  const [isPaused, setIsPaused] = useState(false);
  const [history, setHistory] = useState<MoveSnapshot[]>([]);

  const [mistakes, setMistakes] = useState(0);
  const [hintsUsed, setHintsUsed] = useState(0);
  const [timerSeconds, setTimerSeconds] = useState(0);
  const [isGameOver, setIsGameOver] = useState(false);
  const [isWon, setIsWon] = useState(false);
  const [stats, setStats] = useState<AllStats>({});
  const [favorites, setFavorites] = useState<SavedGameItem[]>([]);
  const [hasSavedGame, setHasSavedGame] = useState(false);
  const [isLoaded, setIsLoaded] = useState(false);
  const isLoadedRef = useRef(false);

  const [user, setUser] = useState<User | null>(null);
  const [authLoading, setAuthLoading] = useState(false);
  const [deviceId, setDeviceId] = useState<string>('guest-device');

  // Fetch Android Advertising ID (AAID)
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

  const streakKey = `${layout.label} - ${difficulty.toUpperCase()}`;

  useEffect(() => {
    getCurrentUser().then((u) => {
      setUser(u);
      if (u) {
        syncUserDataUponLogin(
          (cloudStats) => {
            console.log('📊 Stats synchronized on boot:', cloudStats);
          },
          (remoteFavorites) => {
            setFavorites(remoteFavorites);
          },
        );
      }
    });

    const { data: { subscription } } = supabase.auth.onAuthStateChange(async (_event, session) => {
      const currentUser = session?.user ?? null;
      setUser(currentUser);

      if (currentUser) {
        await syncUserDataUponLogin(
          (cloudStats) => {
            console.log('📊 Stats synchronized on login:', cloudStats);
          },
          (remoteFavorites) => {
            setFavorites(remoteFavorites);
          },
        );
      }
    });

    return () => {
      subscription.unsubscribe();
    };
  }, []);

  // Load state & cloud favorites/stats
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
          const { data: cloudFavs } = await supabase
            .from('user_favorites')
            .select('*')
            .eq('user_id', currentUser.id);
          if (cloudFavs && cloudFavs.length > 0) {
            setFavorites(cloudFavs.map((f: any) => f.game_payload));
          }
        }

        if (savedGame != null) {
          const p = JSON.parse(savedGame);
          setGameId(p.gameId || Date.now().toString());
          setLayout(p.layout);
          setDifficulty(p.difficulty);
          setValues(p.values);
          setSolution(p.solution);
          setInitialClues(p.initialClues);
          setErrors(p.errors);
          setNotes(p.notes);
          setMistakes(p.mistakes);
          setTimerSeconds(p.timerSeconds);
          setIsGameOver(p.isGameOver || false);
          setIsWon(p.isWon || false);
          setHistory(p.history || []);
          setHasSavedGame(p.values?.length > 0 && !p.isGameOver && !p.isWon);
        }
      } catch (err) {
        console.warn('Load err:', err);
      } finally {
        setIsLoaded(true);
        isLoadedRef.current = true;
      }
    }
    loadData();
  }, [user]);

  // Timer interval
  useEffect(() => {
    if (screen !== 'game' || isPaused || isGameOver || isWon) return;
    const timer = setInterval(() => {
      setTimerSeconds((prev) => prev + 1);
    }, 1000);
    return () => clearInterval(timer);
  }, [screen, isPaused, isGameOver, isWon]);

  // Save game continuously
  useEffect(() => {
    if (!isLoadedRef.current || values.length === 0) return;
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
      history,
    };
    AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(state)).catch(() => {});
    setHasSavedGame(!isGameOver && !isWon);
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
    history,
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
      setMistakes(0);
      setHintsUsed(0);
      setTimerSeconds(0);
      setIsGameOver(false);
      setIsWon(false);
      setIsPaused(false);
      setHistory([]);
      setScreen('game');

      const key = `${targetLayout.label} - ${targetDifficulty.toUpperCase()}`;
      setStats((prev) => {
        const cur = prev[key] || { started: 0, won: 0, bestTime: null, streak: 0 };
        const updated = {
          ...prev,
          [key]: { ...cur, started: cur.started + 1 },
        };
        AsyncStorage.setItem(STATS_KEY, JSON.stringify(updated)).catch(() => {});
        return updated;
      });
    },
    [],
  );

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
          { user_id: user.id, game_id: gameId, game_payload: item }
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
    setFavoritesOpen(false);
    setScreen('game');
  };

  const recordWin = useCallback(
    async (finalTime: number) => {
      setIsWon(true);
      setHasSavedGame(false);
      const cur = stats[streakKey] || {
        started: 1,
        won: 0,
        bestTime: null,
        streak: 0,
      };
      const updated: AllStats = {
        ...stats,
        [streakKey]: {
          started: Math.max(cur.started, cur.won + 1),
          won: cur.won + 1,
          bestTime:
            cur.bestTime == null
              ? finalTime
              : Math.min(cur.bestTime, finalTime),
          streak: cur.streak + 1,
        },
      };
      setStats(updated);
      await AsyncStorage.setItem(STATS_KEY, JSON.stringify(updated));

      await recordGameRunToSupabase({
        gridSize: layout.size,
        difficulty: difficulty,
        timeSeconds: finalTime,
        mistakes: mistakes,
        hintsUsed: hintsUsed,
        status: 'won',
        deviceId: deviceId,
      });

      Alert.alert(
        '🎉 Congratulations!',
        `Puzzle solved in ${formatTime(finalTime)} with ${mistakes} mistake(s)!\n\nStreak: ${updated[streakKey].streak} | Best: ${formatTime(updated[streakKey].bestTime || finalTime)}`,
        [
          { text: 'Play Again', onPress: () => startNewGame(layout, difficulty) },
          { text: 'Home', onPress: () => setScreen('home') },
        ],
      );
    },
    [difficulty, layout, mistakes, startNewGame, stats, streakKey, deviceId],
  );

  const recordLoss = useCallback(async (finalMistakes: number) => {
    setIsGameOver(true);
    setHasSavedGame(false);
  
    await recordGameRunToSupabase({
      gridSize: layout.size,
      difficulty: difficulty,
      timeSeconds: timerSeconds,
      mistakes: finalMistakes, // 👈 use the passed mistake count
      hintsUsed: hintsUsed,
      status: 'lost',
      deviceId: deviceId,
    });
  }, [difficulty, layout.size, timerSeconds, hintsUsed, deviceId]);

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

  const clearSurroundingNotes = (
    currentNotes: NotesGrid,
    targetRow: number,
    targetCol: number,
    digit: number,
  ): NotesGrid => {
    const { boxRows, boxCols } = layout;
    const startRow = Math.floor(targetRow / boxRows) * boxRows;
    const startCol = Math.floor(targetCol / boxCols) * boxCols;

    return currentNotes.map((noteRow, r) =>
      noteRow.map((marks, c) => {
        const inRow = r === targetRow;
        const inCol = c === targetCol;
        const inBox =
          r >= startRow &&
          r < startRow + boxRows &&
          c >= startCol &&
          c < startCol + boxCols;

        if (inRow || inCol || inBox) {
          return marks.map((on, idx) => (idx === digit - 1 ? false : on));
        }
        return marks;
      }),
    );
  };

  const onUndo = useCallback(() => {
    if (history.length === 0 || isGameOver || isWon || isPaused) return;
    const previous = history[history.length - 1];
    setValues(previous.values);
    setNotes(previous.notes);
    setErrors(previous.errors);
    setMistakes(previous.mistakes);
    setHistory((prev) => prev.slice(0, -1));
  }, [history, isGameOver, isPaused, isWon]);

  const onHint = useCallback(() => {
    if (selected == null || isGameOver || isWon || isPaused) return;
    const { row, col } = selected;
    if (initialClues[row]?.[col]) return;
    if (values[row]?.[col] === solution[row]?.[col]) return;

    setHintsUsed((prev) => prev + 1);
    pushHistory();
    const correctVal = solution[row][col]!;

    const nextValues = values.map((rArr, r) =>
      rArr.map((v, c) => (r === row && c === col ? correctVal : v)),
    );
    setValues(nextValues);

    setErrors((current) =>
      current.map((rArr, r) =>
        rArr.map((e, c) => (r === row && c === col ? false : e)),
      ),
    );

    setNotes((curNotes) => clearSurroundingNotes(curNotes, row, col, correctVal));

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
    if (isComplete) recordWin(timerSeconds);
  }, [
    clearSurroundingNotes,
    initialClues,
    isGameOver,
    isPaused,
    isWon,
    layout.size,
    pushHistory,
    recordWin,
    selected,
    solution,
    timerSeconds,
    values,
  ]);

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

  const onDigit = useCallback(
    (digit: number) => {
      if (selected == null || isGameOver || isWon || isPaused) return;
      const { row, col } = selected;

      if (initialClues[row]?.[col]) return;
      if (values[row]?.[col] === digit) return;

      pushHistory();

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

      const isCorrect = solution[row]?.[col] === digit;
      const nextMistakes = isCorrect ? mistakes : mistakes + 1;

      if (!isCorrect) {
        setMistakes(nextMistakes);
        if (settings.limitMistakes && nextMistakes >= 3) {
          recordLoss(nextMistakes); // 👈 Put it right here! Pass nextMistakes into it.
          Alert.alert(
            'Game Over',
            'You made 3 mistakes. Better luck next time!',
            [
              { text: 'Try Again', onPress: () => startNewGame(layout, difficulty) },
              { text: 'Home', onPress: () => setScreen('home') },
            ],
          );
        }
      }

      const nextValues = values.map((valRow, r) =>
        valRow.map((v, c) => (r === row && c === col ? digit : v)),
      );
      setValues(nextValues);

      setErrors((current) =>
        current.map((errRow, r) =>
          errRow.map((err, c) => (r === row && c === col ? !isCorrect : err)),
        ),
      );

      if (isCorrect) {
        setNotes((curNotes) => clearSurroundingNotes(curNotes, row, col, digit));
      }

      if (isCorrect) {
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
        if (isComplete) recordWin(timerSeconds);
      }
    },
    [
      clearSurroundingNotes,
      difficulty,
      initialClues,
      isGameOver,
      isPaused,
      isWon,
      layout,
      mistakes,
      notesMode,
      pushHistory,
      recordLoss,
      recordWin,
      selected,
      settings.limitMistakes,
      solution,
      startNewGame,
      timerSeconds,
      values,
    ],
  );

  const onErase = useCallback(() => {
    if (selected == null || isGameOver || isWon || isPaused) return;
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
  }, [initialClues, isGameOver, isPaused, isWon, pushHistory, selected]);

  const onSolveBoard = useCallback(() => {
    if (solution.length === 0 || isGameOver || isWon) return;
    setValues(solution);
    setErrors(emptyErrors(layout.size));
    setNotes(emptyNotes(layout.size));
    setSelected(null);
  }, [isGameOver, isWon, layout.size, solution]);

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
                Mistakes:{' '}
                {settings.limitMistakes ? `${mistakes}/3` : `${mistakes} (no limit)`}
              </Text>
              <Pressable
                onPress={() => setIsPaused(!isPaused)}
                style={[styles.pauseButton, { backgroundColor: theme.cardBg }]}
              >
                <Text style={[styles.pauseButtonText, { color: theme.textPrimary }]}>
                  {isPaused ? '▶ Play' : '⏸ Pause'}
                </Text>
              </Pressable>
              <Pressable
                onPress={onSolveBoard}
                style={[styles.solveButton, { backgroundColor: theme.cardBg }]}
              >
                <Text style={[styles.solveButtonText, { color: theme.textSecondary }]}>
                  Solve
                </Text>
              </Pressable>
              <Text style={[styles.statText, { color: theme.textSecondary }]}>
                {formatTime(timerSeconds)}
              </Text>
            </View>
          </View>

          <Board
            layout={layout}
            values={values}
            initialClues={initialClues}
            errors={errors}
            notes={notes}
            selected={selected}
            isPaused={isPaused}
            theme={theme}
            onResume={() => setIsPaused(false)}
            onSelectCell={setSelected}
          />

          <Keypad
            size={layout.size}
            notesMode={notesMode}
            remainingCounts={remainingCounts}
            canUndo={history.length > 0}
            onNotesModeChange={setNotesMode}
            onDigit={onDigit}
            onErase={onErase}
            onUndo={onUndo}
            onHint={onHint}
          />
        </View>
      ) : (
        <View style={styles.tabContainer}>
          <View style={styles.appHeader}>
            <Text style={[styles.appHeaderTitle, { color: theme.textPrimary }]}>
              {tab === 'home' ? 'RamCraft' : tab === 'stats' ? 'Statistics' : 'Profile'}
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
                  RamCraft
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
                      <Text style={styles.resumeTime}>
                        {formatTime(timerSeconds)}
                      </Text>
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
                {user?.user_metadata?.full_name || user?.user_metadata?.name || (user ? 'RamCraft Player' : 'Guest Player')}
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
              { backgroundColor: theme.cardBg, 
                borderTopColor: theme.blockBg,
                paddingBottom: 24,
                height: 72,
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

            <Pressable onPress={() => setTab('stats')} style={styles.tabItem}>
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
                    settings.themeMode === 'dark' && styles.segmentTextActive,
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

      <Modal visible={settingsModalOpen} animationType="fade" transparent>
        <View style={styles.modalOverlay}>
          <View style={[styles.modalBox, { backgroundColor: theme.cardBg }]}>
            <View style={styles.modalHeader}>
              <Text style={[styles.modalTitle, { color: theme.textPrimary }]}>
                Game Rules
              </Text>
              <Pressable onPress={() => setSettingsModalOpen(false)}>
                <Text style={[styles.closeModalText, { color: theme.textSecondary }]}>
                  ✕
                </Text>
              </Pressable>
            </View>

            <View style={styles.switchRow}>
              <View style={{ flex: 1, paddingRight: 10 }}>
                <Text style={[styles.switchTitle, { color: theme.textPrimary }]}>
                  3-Mistake Rule
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
          </View>
        </View>
      </Modal>
    </View>
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
    height: 60,
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
  pauseButton: {
    paddingVertical: 4,
    paddingHorizontal: 8,
    borderRadius: 6,
  },
  pauseButtonText: {
    fontSize: 12,
    fontWeight: '600',
  },
  solveButton: {
    paddingVertical: 4,
    paddingHorizontal: 8,
    borderRadius: 6,
  },
  solveButtonText: {
    fontSize: 12,
    fontWeight: '600',
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