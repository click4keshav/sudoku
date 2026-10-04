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
  fetchGlobalLeaderboard,
  toggleFollowUser,
  recordDailyChallengeRun,
  fetchMonthlyDailyChallenges,
  fetchUserDailyStreak,
  fetchUserAchievements,
  updateCustomProfile,
  getCustomProfile,
  exportUserDataJson,
  deleteUserCloudDataRpc,
  ACHIEVEMENTS_METADATA,
  type DailyChallengeRun,
  type DailyStreakData,
  type LeaderboardEntry,
  type Timeframe,
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
  Share,
  StyleSheet,
  Switch,
  Text,
  TextInput,
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
import {
  generate,
  generateDailyChallenge,
  type Difficulty,
} from './lib/gameLogic';

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
  totalScore?: number;
  bestScore?: number;
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

function getTodayString(): string {
  const d = new Date();
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

const AVATAR_PRESETS = [
  '🦊', '🐼', '🦁', '🦉', '🚀', '⚡', '🎮', '🧩', '👑', '🔥'
];

function MainApp() {
  const insets = useSafeAreaInsets();

  const [tab, setTab] = useState<'home' | 'stats' | 'profile'>('home');
  const [screen, setScreen] = useState<'home' | 'game'>('home');
  const [favoritesOpen, setFavoritesOpen] = useState(false);
  const [themeModalOpen, setThemeModalOpen] = useState(false);
  const [settingsModalOpen, setSettingsModalOpen] = useState(false);
  const [rulesModalOpen, setRulesModalOpen] = useState(false);

  // Leaderboard modal state
  const [leaderboardOpen, setLeaderboardOpen] = useState(false);
  const [leaderboardType, setLeaderboardType] = useState<'career' | 'peak'>('career');
  const [leaderboardTimeframe, setLeaderboardTimeframe] = useState<Timeframe>('all_time');
  const [friendsOnly, setFriendsOnly] = useState(false);
  const [leaderboardData, setLeaderboardData] = useState<LeaderboardEntry[]>([]);
  const [loadingLeaderboard, setLoadingLeaderboard] = useState(false);

  // Daily Challenge state
  const [calendarModalOpen, setCalendarModalOpen] = useState(false);
  const [isDailyChallengeActive, setIsDailyChallengeActive] = useState(false);
  const [activeDailyDate, setActiveDailyDate] = useState<string>(getTodayString());
  const [monthlyChallenges, setMonthlyChallenges] = useState<Record<string, DailyChallengeRun>>({});
  const [dailyStreak, setDailyStreak] = useState<DailyStreakData>({ currentStreak: 0, bestStreak: 0, totalCompleted: 0 });

  // Achievements state
  const [unlockedAchievements, setUnlockedAchievements] = useState<string[]>([]);
  const [achievementToast, setAchievementToast] = useState<{ title: string; icon: string } | null>(null);

  // Profile Customization state
  const [profileModalOpen, setProfileModalOpen] = useState(false);
  const [customName, setCustomName] = useState('');
  const [customAvatar, setCustomAvatar] = useState<string | null>(null);
  const [syncingNow, setSyncingNow] = useState(false);

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

  const { totalCareerXP, peakSkillScore } = useMemo(() => {
    let career = 0;
    let peak = 0;
    Object.values(stats).forEach((item) => {
      career += item.totalScore || 0;
      peak = Math.max(peak, item.bestScore || 0);
    });
    return { totalCareerXP: career, peakSkillScore: peak };
  }, [stats]);

  // Visual Career Analytics breakdown
  const analyticsData = useMemo(() => {
    const diffs: Difficulty[] = ['easy', 'medium', 'hard', 'expert'];
    return diffs.map((diff) => {
      let started = 0;
      let won = 0;
      let timeSum = 0;
      let timeCount = 0;

      BOARD_LAYOUTS.forEach((l) => {
        const k = `${l.label} - ${diff.toUpperCase()}`;
        const s = stats[k];
        if (s) {
          started += s.started || 0;
          won += s.won || 0;
          if (s.bestTime) {
            timeSum += s.bestTime;
            timeCount++;
          }
        }
      });

      const winRate = started > 0 ? Math.round((won / started) * 100) : 0;
      const avgBestTime = timeCount > 0 ? Math.round(timeSum / timeCount) : 0;

      return {
        difficulty: diff.toUpperCase(),
        started,
        won,
        winRate,
        avgBestTime,
      };
    });
  }, [stats]);

  const refreshStats = useCallback(async () => {
    const freshStats = await fetchUserStatsFromCloud();
    if (freshStats) {
      setStats(freshStats);
    }
  }, []);

  const refreshDailyData = useCallback(async () => {
    try {
      const now = new Date();
      const monthMap = await fetchMonthlyDailyChallenges(now.getFullYear(), now.getMonth() + 1);
      const streakData = await fetchUserDailyStreak();
      if (monthMap) setMonthlyChallenges(monthMap);
      if (streakData) setDailyStreak(streakData);
    } catch {
      // Gracefully prevent uncaught errors
    }
  }, []);

  const refreshAchievements = useCallback(async () => {
    const list = await fetchUserAchievements();
    setUnlockedAchievements(list);
  }, []);

  const handleForceSync = async () => {
    setSyncingNow(true);
    await syncUserDataUponLogin(
      deviceId,
      (cloudStats) => cloudStats && setStats(cloudStats),
      (remoteFavorites) => setFavorites(remoteFavorites),
      undefined,
      () => {
        refreshDailyData();
        refreshAchievements();
      }
    );
    await refreshStats();
    setSyncingNow(false);
    Alert.alert('Sync Complete', 'All local runs, statistics, and records have been synced with the cloud.');
  };

  const handleExportData = async () => {
    await exportUserDataJson();
  };

  const handleDeleteCloudData = () => {
    Alert.alert(
      'Delete Cloud Records?',
      'This will permanently delete all your leaderboards, statistics, and challenge runs from the cloud. This action cannot be undone.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Permanently Delete',
          style: 'destructive',
          onPress: async () => {
            const success = await deleteUserCloudDataRpc();
            if (success) {
              setStats({});
              setDailyStreak({ currentStreak: 0, bestStreak: 0, totalCompleted: 0 });
              setMonthlyChallenges({});
              setUnlockedAchievements([]);
              Alert.alert('Deleted', 'Your cloud records have been permanently cleared.');
            } else {
              Alert.alert('Error', 'Could not delete records. Please try again.');
            }
          },
        },
      ]
    );
  };

  const handleSaveProfile = async () => {
    if (!customName.trim()) {
      Alert.alert('Validation', 'Display name cannot be blank.');
      return;
    }
    await updateCustomProfile(customName.trim(), customAvatar);
    setProfileModalOpen(false);
    Alert.alert('Saved', 'Your public display profile has been updated!');
  };

  const loadLeaderboard = useCallback(async () => {
    setLoadingLeaderboard(true);
    const data = await fetchGlobalLeaderboard(leaderboardType, leaderboardTimeframe, friendsOnly);
    setLeaderboardData(data);
    setLoadingLeaderboard(false);
  }, [leaderboardType, leaderboardTimeframe, friendsOnly]);

  const openLeaderboardModal = useCallback(() => {
    setLeaderboardOpen(true);
    loadLeaderboard();
  }, [loadLeaderboard]);

  useEffect(() => {
    if (leaderboardOpen) {
      loadLeaderboard();
    }
  }, [leaderboardType, leaderboardTimeframe, friendsOnly, leaderboardOpen, loadLeaderboard]);

  const handleToggleFollow = async (targetUserId: string, currentFollowing: boolean) => {
    if (!user) {
      Alert.alert('Sign In Required', 'Please sign in with Google to follow players and view your Friends leaderboard.');
      return;
    }
    const success = await toggleFollowUser(targetUserId, !currentFollowing);
    if (success) {
      setLeaderboardData((prev) =>
        prev.map((p) => (p.userId === targetUserId ? { ...p, isFollowing: !currentFollowing } : p)),
      );
    }
  };

  const triggerAchievementBanner = useCallback((id: string) => {
    const meta = ACHIEVEMENTS_METADATA.find((m) => m.id === id);
    if (meta) {
      setAchievementToast({ title: meta.title, icon: meta.icon });
      setTimeout(() => setAchievementToast(null), 4000);
    }
  }, []);

  const shareGameResult = useCallback((timeSecs: number, totalMistakes: number, totalScore: number) => {
    const mistakesBlock = totalMistakes === 0 ? '🟩🟩🟩 (0 mistakes)' : `${'🟥'.repeat(Math.min(totalMistakes, 3))} (${totalMistakes} errors)`;
    const text = `🧩 RamCraft Sudoku Daily Challenge\n📅 ${activeDailyDate}\n⏱️ Time: ${formatTime(timeSecs)}\n⚡ Score: +${totalScore} XP\n🎯 Accuracy: ${mistakesBlock}\n\nPlay at: https://ramcraft.app`;
    Share.share({ message: text });
  }, [activeDailyDate]);

  const restoreActiveGamePayload = useCallback((p: any) => {
    if (!p || !p.values || p.values.length === 0) return;
    setGameId(p.gameId || Date.now().toString());
    setLayout(p.layout || DEFAULT_BOARD_LAYOUT);
    setDifficulty(p.difficulty || 'medium');
    setValues(p.values);
    setSolution(p.solution);
    setInitialClues(p.initialClues);
    setErrors(p.errors || emptyErrors(p.layout?.size || 9));
    setNotes(p.notes || emptyNotes(p.layout?.size || 9));
    setMistakes(p.mistakes || 0);
    setTimerSeconds(p.timerSeconds || 0);
    setIsGameOver(false);
    setIsWon(false);
    setIsAutoSolved(false);
    setIsDailyChallengeActive(p.isDailyChallengeActive || false);
    setActiveDailyDate(p.activeDailyDate || getTodayString());
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
          () => {
            refreshDailyData();
            refreshAchievements();
          },
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
          () => {
            refreshDailyData();
            refreshAchievements();
          },
        );
      }
    });

    return () => subscription.unsubscribe();
  }, [deviceId, refreshAchievements, refreshDailyData, restoreActiveGamePayload]);

  useEffect(() => {
    async function loadData() {
      try {
        const [savedStats, savedSettings, savedFavs, savedGame, customProf] =
          await Promise.all([
            AsyncStorage.getItem(STATS_KEY),
            AsyncStorage.getItem(SETTINGS_KEY),
            AsyncStorage.getItem(FAVORITES_KEY),
            AsyncStorage.getItem(STORAGE_KEY),
            getCustomProfile(),
          ]);

        if (savedStats) setStats(JSON.parse(savedStats));
        if (savedSettings) setSettings(JSON.parse(savedSettings));
        if (savedFavs) setFavorites(JSON.parse(savedFavs));
        if (customProf) {
          setCustomName(customProf.displayName);
          setCustomAvatar(customProf.avatarUrl);
        }

        const currentUser = await getCurrentUser();
        if (currentUser) {
          await refreshStats();
        }

        await refreshDailyData();
        await refreshAchievements();

        if (savedGame != null) {
          const p = JSON.parse(savedGame);
          restoreActiveGamePayload(p);
        }
      } catch (err) {
        console.warn('App Init Note:', err);
      } finally {
        setIsLoaded(true);
        isLoadedRef.current = true;
      }
    }
    loadData();
  }, [refreshAchievements, refreshDailyData, refreshStats, restoreActiveGamePayload]);

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
      isDailyChallengeActive,
      activeDailyDate,
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
    activeDailyDate,
    difficulty,
    errors,
    gameId,
    history,
    initialClues,
    isAutoSolved,
    isDailyChallengeActive,
    isGameOver,
    isWon,
    layout,
    mistakes,
    notes,
    solution,
    timerSeconds,
    user,
    values,
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
      setIsDailyChallengeActive(false);
      setIsPaused(false);
      setHistory([]);
      setScreen('game');
    },
    [],
  );

  const startDailyGame = useCallback(
    (dateStr: string) => {
      const standard9x9Layout: BoardLayout = {
        id: '9x9',
        label: '9x9',
        size: 9,
        boxRows: 3,
        boxCols: 3,
      };
      setLayout(standard9x9Layout);

      const { puzzle, solution: solvedBoard, difficulty: dailyDiff } =
        generateDailyChallenge(dateStr);
      setDifficulty(dailyDiff);

      const clues = puzzle.map((row) => row.map((cell) => cell !== null));

      setGameId(`daily-${dateStr}`);
      setValues(puzzle);
      setSolution(solvedBoard);
      setInitialClues(clues);
      setErrors(emptyErrors(9));
      setNotes(emptyNotes(9));
      setSelected(null);
      setLockedDigit(null);
      setActiveHint(null);
      setMistakes(0);
      setHintsUsed(0);
      setTimerSeconds(0);
      setIsGameOver(false);
      setIsWon(false);
      setIsAutoSolved(false);
      setIsDailyChallengeActive(true);
      setActiveDailyDate(dateStr);
      setIsPaused(false);
      setHistory([]);
      setCalendarModalOpen(false);
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
    setIsDailyChallengeActive(false);
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

      if (isDailyChallengeActive) {
        const streakData = await recordDailyChallengeRun({
          challengeDate: activeDailyDate,
          status: 'won',
          timeSeconds: finalTime,
          mistakes: totalMistakes,
          hintsUsed: hintsUsed,
          score: res?.earnedScore || 100,
        });
        if (streakData) setDailyStreak(streakData);
        await refreshDailyData();
      }

      if (res?.newlyUnlockedBadges && res.newlyUnlockedBadges.length > 0) {
        res.newlyUnlockedBadges.forEach((id: string) => triggerAchievementBanner(id));
        await refreshAchievements();
      }

      if (res?.localStats) {
        setStats(res.localStats);
      }

      if (user) {
        await refreshStats();
      }

      const alertButtons: any[] = [
        { text: 'Home', onPress: () => setScreen('home') },
      ];

      if (isDailyChallengeActive) {
        alertButtons.unshift({
          text: '📤 Share Result',
          onPress: () => shareGameResult(finalTime, totalMistakes, res?.earnedScore || 100),
        });
      }

      Alert.alert(
        isDailyChallengeActive ? '🌟 Daily Challenge Solved!' : '🎉 Congratulations!',
        `Puzzle solved in ${formatTime(finalTime)}!\nScore Earned: +${res?.earnedScore || 100} XP`,
        alertButtons,
      );
    },
    [
      activeDailyDate,
      deviceId,
      difficulty,
      hintsUsed,
      isAutoSolved,
      isDailyChallengeActive,
      layout.size,
      refreshAchievements,
      refreshDailyData,
      refreshStats,
      shareGameResult,
      triggerAchievementBanner,
      user,
    ],
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

      if (isDailyChallengeActive) {
        await recordDailyChallengeRun({
          challengeDate: activeDailyDate,
          status: 'lost',
          timeSeconds: timerSeconds,
          mistakes: finalMistakes,
          hintsUsed: hintsUsed,
          score: 0,
        });
        await refreshDailyData();
      }

      if (res?.localStats) {
        setStats(res.localStats);
      }

      if (user) {
        await refreshStats();
      }
    },
    [
      activeDailyDate,
      deviceId,
      difficulty,
      hintsUsed,
      isAutoSolved,
      isDailyChallengeActive,
      layout.size,
      refreshDailyData,
      refreshStats,
      timerSeconds,
      user,
    ],
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
          { text: 'Try Again', onPress: () => isDailyChallengeActive ? startDailyGame(activeDailyDate) : startNewGame(layout, difficulty) },
          { text: 'Restart Board', onPress: restartCurrentGame },
          { text: 'Home', onPress: () => setScreen('home') },
        ],
      );
    }
  }, [
    activeDailyDate,
    difficulty,
    isAutoSolved,
    isDailyChallengeActive,
    layout,
    mistakes,
    recordLoss,
    recordWin,
    restartCurrentGame,
    solution,
    startDailyGame,
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
                { text: 'Try Again', onPress: () => isDailyChallengeActive ? startDailyGame(activeDailyDate) : startNewGame(layout, difficulty) },
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
      activeDailyDate,
      clearSurroundingNotes,
      computeConflictGrid,
      difficulty,
      initialClues,
      isAutoSolved,
      isDailyChallengeActive,
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
      startDailyGame,
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

  const todayStr = getTodayString();
  const todayChallenge = monthlyChallenges[todayStr];
  const isTodayCompleted = todayChallenge?.status === 'won';
  const avatarUrl = customAvatar || user?.user_metadata?.avatar_url || user?.user_metadata?.picture;
  const activeDisplayName = customName || user?.user_metadata?.full_name || user?.user_metadata?.name || (user ? 'RamCraft Player' : 'Guest Player');

  const now = new Date();
  const year = now.getFullYear();
  const month = now.getMonth();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const firstDayIndex = new Date(year, month, 1).getDay();

  // Monthly Crown calculation
  const completedCountInMonth = Object.keys(monthlyChallenges).filter(
    (k) => k.startsWith(`${year}-${String(month + 1).padStart(2, '0')}`) && monthlyChallenges[k].status === 'won',
  ).length;

  const monthlyCrownTier =
    completedCountInMonth >= daysInMonth ? 'gold' : completedCountInMonth >= 20 ? 'silver' : completedCountInMonth >= 10 ? 'bronze' : null;

  return (
    <View style={[styles.container, { backgroundColor: theme.appBg }]}>
      <StatusBar style={isDark ? 'light' : 'dark'} />

      {/* Real-time Achievement Toast */}
      {achievementToast && (
        <View style={styles.achievementToast}>
          <Text style={styles.achievementToastIcon}>{achievementToast.icon}</Text>
          <View style={{ flex: 1 }}>
            <Text style={styles.achievementToastBadge}>ACHIEVEMENT UNLOCKED!</Text>
            <Text style={styles.achievementToastTitle}>{achievementToast.title}</Text>
          </View>
        </View>
      )}

      {screen === 'game' ? (
        <View style={styles.gameContent}>
          <View style={styles.gameHeader}>
            <View style={styles.gameHeaderTopRow}>
              <Pressable onPress={handleBackPress} style={styles.backButton}>
                <Text style={[styles.backButtonText, { color: theme.textPrimary }]}>
                  ‹ Back
                </Text>
              </Pressable>

              <Text style={[styles.gameHeaderCenterTitle, { color: theme.textPrimary }]}>
                {isDailyChallengeActive ? `Daily Challenge (${activeDailyDate})` : `${layout.label} • ${difficulty.toUpperCase()}`}
              </Text>

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
            <View style={styles.homeFixedContainer}>
              {/* TOP: Daily Challenge Card */}
              <View style={[styles.dailyCard, { backgroundColor: isTodayCompleted ? '#065F46' : '#1E3A8A' }]}>
                <View style={styles.dailyCardHeader}>
                  <Text style={styles.dailyCardBadge}>
                    {isTodayCompleted ? '✓ TODAY COMPLETED' : '⭐ DAILY CHALLENGE'}
                  </Text>
                  <Text style={styles.dailyStreakTag}>🔥 {dailyStreak.currentStreak} Day Streak</Text>
                </View>
                <View style={styles.dailyCardBtnRow}>
                  <Pressable
                    style={styles.dailyPlayBtn}
                    onPress={() => startDailyGame(todayStr)}
                  >
                    <Text style={styles.dailyPlayBtnText}>
                      {isTodayCompleted ? 'Replay Challenge' : "Play Today's Puzzle"}
                    </Text>
                  </Pressable>
                  <Pressable
                    style={styles.dailyCalendarBtn}
                    onPress={() => setCalendarModalOpen(true)}
                  >
                    <Text style={styles.dailyCalendarBtnText}>📅 Calendar</Text>
                  </Pressable>
                </View>
              </View>

              {/* MIDDLE: 100x100 Logo + Resume Game Below It */}
              <View style={styles.middleSection}>
                <Image
                  source={require('./assets/logo.png')}
                  style={styles.centerLogoImage}
                  resizeMode="contain"
                />

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
                      {isDailyChallengeActive ? `Daily (${activeDailyDate})` : `${layout.label} • ${difficulty.toUpperCase()}`} • Mistakes:{' '}
                      {settings.limitMistakes ? `${mistakes}/3` : mistakes}
                    </Text>
                  </Pressable>
                )}
              </View>

              {/* BOTTOM: Custom Game Controls */}
              <View style={styles.bottomControlsSection}>
                <SizePicker layout={pickerLayout} onChange={setPickerLayout} />
                <DifficultyPicker
                  difficulty={pickerDifficulty}
                  onChange={setPickerDifficulty}
                />
                <Pressable
                  style={[styles.playButton, { backgroundColor: theme.accentBtn }]}
                  onPress={() => startNewGame(pickerLayout, pickerDifficulty)}
                >
                  <Text style={styles.playButtonText}>Start Custom Game</Text>
                </Pressable>
              </View>
            </View>
          )}

          {tab === 'stats' && (
            <ScrollView
              contentContainerStyle={styles.statsScrollContent}
              showsVerticalScrollIndicator={false}
            >
              <View style={styles.ratingOverviewRow}>
                <View style={[styles.ratingCard, { backgroundColor: theme.cardBg }]}>
                  <Text style={[styles.ratingLabel, { color: theme.textSecondary }]}>Career XP</Text>
                  <Text style={[styles.ratingValue, { color: theme.textPrimary }]}>⚡ {totalCareerXP.toLocaleString()}</Text>
                </View>

                <View style={[styles.ratingCard, { backgroundColor: theme.cardBg }]}>
                  <Text style={[styles.ratingLabel, { color: theme.textSecondary }]}>Peak Rating</Text>
                  <Text style={[styles.ratingValue, { color: theme.textPrimary }]}>🏆 {peakSkillScore.toLocaleString()}</Text>
                </View>
              </View>

              <Pressable
                style={[styles.leaderboardBtn, { backgroundColor: theme.accentBtn }]}
                onPress={openLeaderboardModal}
              >
                <Text style={styles.leaderboardBtnText}>🌍 View Global & Friends Leaderboard</Text>
              </Pressable>

              {/* Visual Career Analytics Section */}
              <Text style={[styles.sectionHeading, { color: theme.textPrimary }]}>
                Career Analytics & Win Rates
              </Text>

              <View style={[styles.statCategoryCard, { backgroundColor: theme.cardBg, marginBottom: 16 }]}>
                {analyticsData.map((item) => (
                  <View key={item.difficulty} style={{ marginBottom: 12 }}>
                    <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: 4 }}>
                      <Text style={[styles.statRowLabel, { color: theme.textPrimary }]}>
                        {item.difficulty}
                      </Text>
                      <Text style={[styles.statRowValue, { color: theme.textSecondary }]}>
                        {item.winRate}% ({item.won}/{item.started} Won) • Avg: {item.avgBestTime > 0 ? formatTime(item.avgBestTime) : '--:--'}
                      </Text>
                    </View>
                    {/* Visual Progress Bar */}
                    <View style={styles.analyticsBarTrack}>
                      <View
                        style={[
                          styles.analyticsBarFill,
                          {
                            width: `${Math.max(item.winRate, 2)}%`,
                            backgroundColor:
                              item.difficulty === 'EASY'
                                ? '#10B981'
                                : item.difficulty === 'MEDIUM'
                                ? '#3B82F6'
                                : item.difficulty === 'HARD'
                                ? '#F59E0B'
                                : '#EF4444',
                          },
                        ]}
                      />
                    </View>
                  </View>
                ))}
              </View>

              <Text style={[styles.sectionHeading, { color: theme.textPrimary }]}>
                Grid Performance Overview
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
                        totalScore: 0,
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
                            Won: {cs.won}/{cs.started} • 🔥{cs.streak} • Best: {cs.bestTime ? formatTime(cs.bestTime) : '--:--'} • {cs.totalScore || 0} XP
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
            <ScrollView
              contentContainerStyle={{ padding: 20, paddingBottom: 80, alignItems: 'center' }}
              showsVerticalScrollIndicator={false}
            >
              <View style={styles.avatarCircle}>
                {avatarUrl && avatarUrl.startsWith('http') ? (
                  <Image
                    source={{ uri: avatarUrl }}
                    style={styles.avatarImage}
                    resizeMode="cover"
                  />
                ) : (
                  <Text style={styles.avatarText}>{avatarUrl || (user ? '✨' : '👤')}</Text>
                )}
              </View>
              <Text style={[styles.profileName, { color: theme.textPrimary }]}>
                {activeDisplayName}
              </Text>
              <Text style={[styles.profileId, { color: theme.textSecondary }]}>
                {user ? user.email : `Device ID: ${deviceId}`}
              </Text>

              <Pressable
                style={[styles.editProfileBtn, { borderColor: theme.blockBg }]}
                onPress={() => {
                  setCustomName(activeDisplayName);
                  setProfileModalOpen(true);
                }}
              >
                <Text style={[styles.editProfileBtnText, { color: theme.userText }]}>
                  ✏ Edit Profile & Avatar
                </Text>
              </Pressable>

              {/* Achievements Showcase Section */}
              <View style={[styles.achievementsCard, { backgroundColor: theme.cardBg }]}>
                <View style={styles.achievementsHeader}>
                  <Text style={[styles.profileCardTitle, { color: theme.textPrimary }]}>
                    Trophies & Achievements
                  </Text>
                  <Text style={{ fontSize: 12, fontWeight: '700', color: '#EAB308' }}>
                    {unlockedAchievements.length}/{ACHIEVEMENTS_METADATA.length} Unlocked
                  </Text>
                </View>

                {ACHIEVEMENTS_METADATA.map((badge) => {
                  const isUnlocked = unlockedAchievements.includes(badge.id);
                  return (
                    <View
                      key={badge.id}
                      style={[
                        styles.badgeRow,
                        { borderBottomColor: theme.blockBg, opacity: isUnlocked ? 1 : 0.4 },
                      ]}
                    >
                      <Text style={styles.badgeIcon}>{badge.icon}</Text>
                      <View style={{ flex: 1, paddingHorizontal: 10 }}>
                        <Text style={[styles.badgeTitle, { color: theme.textPrimary }]}>
                          {badge.title} {isUnlocked && '✓'}
                        </Text>
                        <Text style={[styles.badgeDesc, { color: theme.textSecondary }]}>
                          {badge.description}
                        </Text>
                      </View>
                      <Text style={[styles.badgeTier, { color: badge.tier === 'diamond' ? '#38BDF8' : badge.tier === 'gold' ? '#FACC15' : badge.tier === 'silver' ? '#CBD5E1' : '#D97706' }]}>
                        {badge.tier.toUpperCase()}
                      </Text>
                    </View>
                  );
                })}
              </View>

              {/* Daily Streak Card */}
              <View
                style={[styles.profileCard, { backgroundColor: theme.cardBg }]}
              >
                <Text style={[styles.profileCardTitle, { color: theme.textPrimary }]}>
                  Daily Challenge Streaks
                </Text>
                <Text style={[styles.profileCardBody, { color: theme.textSecondary }]}>
                  Current Daily Streak: 🔥 {dailyStreak.currentStreak} Days{'\n'}
                  Best Daily Streak: 🏆 {dailyStreak.bestStreak} Days{'\n'}
                  Total Challenges Completed: ⭐ {dailyStreak.totalCompleted}
                </Text>
              </View>

              {/* Data Management & Compliance Tools */}
              <View style={[styles.profileCard, { backgroundColor: theme.cardBg }]}>
                <Text style={[styles.profileCardTitle, { color: theme.textPrimary }]}>
                  Data Management & Cloud Tools
                </Text>

                <Pressable
                  style={[styles.managementActionBtn, { backgroundColor: theme.appBg }]}
                  onPress={handleForceSync}
                  disabled={syncingNow}
                >
                  <Text style={[styles.managementActionText, { color: theme.textPrimary }]}>
                    {syncingNow ? '🔄 Syncing...' : '🔄 Force Sync Now'}
                  </Text>
                </Pressable>

                <Pressable
                  style={[styles.managementActionBtn, { backgroundColor: theme.appBg }]}
                  onPress={handleExportData}
                >
                  <Text style={[styles.managementActionText, { color: theme.textPrimary }]}>
                    📥 Export All Account Data (JSON)
                  </Text>
                </Pressable>

                {user && (
                  <Pressable
                    style={[styles.managementActionBtn, { backgroundColor: '#FEE2E2', marginTop: 8 }]}
                    onPress={handleDeleteCloudData}
                  >
                    <Text style={[styles.managementActionText, { color: '#DC2626' }]}>
                      🗑 Permanently Delete Cloud Data
                    </Text>
                  </Pressable>
                )}
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
            </ScrollView>
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

      {/* Edit Profile Customization Modal */}
      <Modal visible={profileModalOpen} animationType="fade" transparent>
        <View style={styles.modalOverlay}>
          <View style={[styles.modalBox, { backgroundColor: theme.cardBg }]}>
            <View style={styles.modalHeader}>
              <Text style={[styles.modalTitle, { color: theme.textPrimary }]}>
                Customize Public Profile
              </Text>
              <Pressable onPress={() => setProfileModalOpen(false)}>
                <Text style={[styles.closeModalText, { color: theme.textSecondary }]}>✕</Text>
              </Pressable>
            </View>

            <Text style={[styles.settingLabel, { color: theme.textPrimary }]}>Gamer Display Name</Text>
            <TextInput
              style={[styles.profileInput, { color: theme.textPrimary, borderColor: theme.blockBg }]}
              value={customName}
              onChangeText={setCustomName}
              placeholder="e.g. SudokuMaster99"
              placeholderTextColor={theme.textSecondary}
              maxLength={20}
            />

            <Text style={[styles.settingLabel, { color: theme.textPrimary, marginTop: 12 }]}>Choose Avatar Emoji</Text>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginVertical: 8 }}>
              {AVATAR_PRESETS.map((icon) => (
                <Pressable
                  key={icon}
                  onPress={() => setCustomAvatar(icon)}
                  style={[
                    styles.avatarPresetBtn,
                    customAvatar === icon && { borderColor: theme.userText, borderWidth: 2 },
                  ]}
                >
                  <Text style={{ fontSize: 24 }}>{icon}</Text>
                </Pressable>
              ))}
            </View>

            <Pressable
              style={[styles.playButton, { backgroundColor: theme.accentBtn, marginTop: 12 }]}
              onPress={handleSaveProfile}
            >
              <Text style={styles.playButtonText}>Save Profile</Text>
            </Pressable>
          </View>
        </View>
      </Modal>

      {/* Monthly Daily Challenge Calendar Modal */}
      <Modal visible={calendarModalOpen} animationType="slide" transparent>
        <View style={styles.modalOverlay}>
          <View style={[styles.modalBox, { backgroundColor: theme.cardBg, maxHeight: '90%' }]}>
            <View style={styles.modalHeader}>
              <View>
                <Text style={[styles.modalTitle, { color: theme.textPrimary }]}>
                  📅 Daily Challenges
                </Text>
                <Text style={[styles.calendarSubHeading, { color: theme.textSecondary }]}>
                  {new Date().toLocaleString('default', { month: 'long', year: 'numeric' })}
                </Text>
              </View>
              <Pressable onPress={() => setCalendarModalOpen(false)}>
                <Text style={[styles.closeModalText, { color: theme.textSecondary }]}>
                  ✕
                </Text>
              </Pressable>
            </View>

            {/* Monthly Crown Milestone Showcase */}
            <View style={styles.crownMilestoneBox}>
              <Text style={{ fontSize: 20 }}>
                {monthlyCrownTier === 'gold' ? '👑' : monthlyCrownTier === 'silver' ? '🥈' : monthlyCrownTier === 'bronze' ? '🥉' : '🔒'}
              </Text>
              <View style={{ flex: 1, paddingLeft: 8 }}>
                <Text style={[styles.crownMilestoneTitle, { color: theme.textPrimary }]}>
                  {monthlyCrownTier === 'gold' ? 'Gold Crown Achieved!' : monthlyCrownTier === 'silver' ? 'Silver Crown Achieved!' : monthlyCrownTier === 'bronze' ? 'Bronze Crown Achieved!' : 'Monthly Crown in Progress'}
                </Text>
                <Text style={[styles.crownMilestoneSub, { color: theme.textSecondary }]}>
                  {completedCountInMonth} days completed (10d 🥉 • 20d 🥈 • {daysInMonth}d 👑)
                </Text>
              </View>
            </View>

            <View style={styles.calendarStreakBanner}>
              <View style={styles.calendarStreakItem}>
                <Text style={styles.calendarStreakVal}>🔥 {dailyStreak.currentStreak}</Text>
                <Text style={styles.calendarStreakLabel}>Current Streak</Text>
              </View>
              <View style={styles.calendarStreakItem}>
                <Text style={styles.calendarStreakVal}>🏆 {dailyStreak.bestStreak}</Text>
                <Text style={styles.calendarStreakLabel}>Best Streak</Text>
              </View>
              <View style={styles.calendarStreakItem}>
                <Text style={styles.calendarStreakVal}>⭐ {dailyStreak.totalCompleted}</Text>
                <Text style={styles.calendarStreakLabel}>Completed</Text>
              </View>
            </View>

            <View style={styles.calendarDaysHeader}>
              {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map((d) => (
                <Text key={d} style={[styles.calendarDayHeadText, { color: theme.textSecondary }]}>
                  {d}
                </Text>
              ))}
            </View>

            <View style={styles.calendarGrid}>
              {Array.from({ length: firstDayIndex }).map((_, i) => (
                <View key={`empty-${i}`} style={styles.calendarSlotEmpty} />
              ))}

              {Array.from({ length: daysInMonth }).map((_, i) => {
                const dayNum = i + 1;
                const dStr = `${year}-${String(month + 1).padStart(2, '0')}-${String(dayNum).padStart(2, '0')}`;
                const isWonDay = monthlyChallenges[dStr]?.status === 'won';
                const isToday = dStr === todayStr;
                const isPastOrToday = dayNum <= now.getDate();

                return (
                  <Pressable
                    key={dStr}
                    disabled={!isPastOrToday}
                    onPress={() => startDailyGame(dStr)}
                    style={[
                      styles.calendarDaySlot,
                      { backgroundColor: theme.appBg },
                      isWonDay && { backgroundColor: '#059669' },
                      isToday && !isWonDay && { borderColor: '#3B82F6', borderWidth: 2 },
                      !isPastOrToday && { opacity: 0.3 },
                    ]}
                  >
                    <Text
                      style={[
                        styles.calendarDayNum,
                        { color: isWonDay ? '#FFFFFF' : theme.textPrimary },
                      ]}
                    >
                      {dayNum}
                    </Text>
                    {isWonDay && <Text style={styles.calendarStar}>⭐</Text>}
                  </Pressable>
                );
              })}
            </View>

            <Pressable
              style={[styles.playButton, { backgroundColor: theme.accentBtn, marginTop: 14 }]}
              onPress={() => startDailyGame(todayStr)}
            >
              <Text style={styles.playButtonText}>Play Today's Challenge</Text>
            </Pressable>
          </View>
        </View>
      </Modal>

      {/* Global & Friends Leaderboard Modal */}
      <Modal visible={leaderboardOpen} animationType="slide" transparent>
        <View style={styles.modalOverlay}>
          <View style={[styles.modalBox, { backgroundColor: theme.cardBg, maxHeight: '90%' }]}>
            <View style={styles.modalHeader}>
              <Text style={[styles.modalTitle, { color: theme.textPrimary }]}>
                {friendsOnly ? '👥 Friends Leaderboard' : '🌍 Global Leaderboard'}
              </Text>
              <Pressable onPress={() => setLeaderboardOpen(false)}>
                <Text style={[styles.closeModalText, { color: theme.textSecondary }]}>
                  ✕
                </Text>
              </Pressable>
            </View>

            {/* Scope Toggle: Global vs Friends */}
            <View style={styles.optionRow}>
              <Pressable
                onPress={() => setFriendsOnly(false)}
                style={[styles.segmentBtn, !friendsOnly && styles.segmentBtnActive]}
              >
                <Text style={[styles.segmentText, !friendsOnly && styles.segmentTextActive]}>
                  🌍 Global
                </Text>
              </Pressable>
              <Pressable
                onPress={() => setFriendsOnly(true)}
                style={[styles.segmentBtn, friendsOnly && styles.segmentBtnActive]}
              >
                <Text style={[styles.segmentText, friendsOnly && styles.segmentTextActive]}>
                  👥 Friends
                </Text>
              </Pressable>
            </View>

            {/* Timeframe Tabs: All-Time, Monthly, Weekly */}
            <View style={[styles.optionRow, { marginTop: 8 }]}>
              {(['all_time', 'monthly', 'weekly'] as Timeframe[]).map((tf) => (
                <Pressable
                  key={tf}
                  onPress={() => setLeaderboardTimeframe(tf)}
                  style={[
                    styles.segmentBtnSmall,
                    leaderboardTimeframe === tf && styles.segmentBtnSmallActive,
                  ]}
                >
                  <Text
                    style={[
                      styles.segmentSmallText,
                      leaderboardTimeframe === tf && styles.segmentSmallTextActive,
                    ]}
                  >
                    {tf === 'all_time' ? 'All-Time' : tf === 'monthly' ? 'This Month' : 'This Week'}
                  </Text>
                </Pressable>
              ))}
            </View>

            {/* Metric Toggle: Career XP vs Peak Rating */}
            <View style={[styles.optionRow, { marginTop: 8 }]}>
              <Pressable
                onPress={() => setLeaderboardType('career')}
                style={[
                  styles.segmentBtnSmall,
                  leaderboardType === 'career' && styles.segmentBtnSmallActive,
                ]}
              >
                <Text
                  style={[
                    styles.segmentSmallText,
                    leaderboardType === 'career' && styles.segmentSmallTextActive,
                  ]}
                >
                  ⚡ Career XP
                </Text>
              </Pressable>
              <Pressable
                onPress={() => setLeaderboardType('peak')}
                style={[
                  styles.segmentBtnSmall,
                  leaderboardType === 'peak' && styles.segmentBtnSmallActive,
                ]}
              >
                <Text
                  style={[
                    styles.segmentSmallText,
                    leaderboardType === 'peak' && styles.segmentBtnSmallActive,
                  ]}
                >
                  🏆 Peak Rating
                </Text>
              </Pressable>
            </View>

            {loadingLeaderboard ? (
              <Text style={[styles.emptyModalText, { color: theme.textSecondary }]}>
                Loading rankings...
              </Text>
            ) : leaderboardData.length === 0 ? (
              <Text style={[styles.emptyModalText, { color: theme.textSecondary }]}>
                {friendsOnly
                  ? 'No friend activity recorded for this period. Follow other players using the button on their rank card!'
                  : 'No games recorded yet for this period. Win a game to take the #1 spot!'}
              </Text>
            ) : (
              <ScrollView style={{ marginTop: 10 }}>
                {leaderboardData.map((player) => (
                  <View
                    key={player.userId}
                    style={[
                      styles.leaderboardRow,
                      {
                        borderBottomColor: theme.blockBg,
                        backgroundColor:
                          user?.id === player.userId
                            ? theme.isDark
                              ? '#1E3A8A'
                              : '#E0F2FE'
                            : 'transparent',
                      },
                    ]}
                  >
                    <View style={styles.leaderboardRankCol}>
                      <Text
                        style={[
                          styles.leaderboardRankText,
                          {
                            color:
                              player.rank === 1
                                ? '#EAB308'
                                : player.rank === 2
                                ? '#94A3B8'
                                : player.rank === 3
                                ? '#B45309'
                                : theme.textSecondary,
                          },
                        ]}
                      >
                        {player.rank === 1 ? '🥇' : player.rank === 2 ? '🥈' : player.rank === 3 ? '🥉' : `#${player.rank}`}
                      </Text>
                    </View>

                    <View style={{ flex: 1, paddingHorizontal: 6 }}>
                      <Text
                        numberOfLines={1}
                        style={[styles.leaderboardName, { color: theme.textPrimary }]}>
                        {player.displayName} {user?.id === player.userId && '(You)'}
                      </Text>
                      <Text style={[styles.leaderboardSub, { color: theme.textSecondary }]}>
                        Won: {player.gamesWon} games
                      </Text>
                    </View>

                    <View style={{ alignItems: 'flex-end', gap: 4 }}>
                      <Text style={[styles.leaderboardScore, { color: theme.userText }]}>
                        {leaderboardType === 'career'
                          ? `${player.totalScore.toLocaleString()} XP`
                          : `${player.peakScore.toLocaleString()} pts`}
                      </Text>

                      {user && user.id !== player.userId && (
                        <Pressable
                          onPress={() => handleToggleFollow(player.userId, Boolean(player.isFollowing))}
                          style={[
                            styles.followBtn,
                            player.isFollowing && styles.followBtnActive,
                          ]}
                        >
                          <Text style={[styles.followBtnText, player.isFollowing && styles.followBtnTextActive]}>
                            {player.isFollowing ? 'Following' : '+ Follow'}
                          </Text>
                        </Pressable>
                      )}
                    </View>
                  </View>
                ))}
              </ScrollView>
            )}
          </View>
        </View>
      </Modal>

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
                <Text style={[styles.switchTitle, { color: theme.textPrimary }]}>4. Scoring & Rankings</Text>
                <Text style={[styles.switchSub, { color: theme.textSecondary, marginTop: 4 }]}>
                  Earn XP based on board size and difficulty multiplier! Solving faster than the average target grants up to a 2.0x bonus score. Check the Global Leaderboard in Stats!
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
    paddingBottom: 2,
  },
  appHeaderTitle: {
    fontSize: 18,
    fontWeight: '800',
    letterSpacing: 0.5,
  },
  topRightActions: {
    flexDirection: 'row',
    gap: 8,
  },
  iconCircle: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: 'rgba(128,128,128,0.15)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  iconCircleText: {
    fontSize: 16,
  },
  achievementToast: {
    position: 'absolute',
    top: 50,
    alignSelf: 'center',
    zIndex: 9999,
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#1E293B',
    borderColor: '#FACC15',
    borderWidth: 1.5,
    borderRadius: 12,
    paddingVertical: 10,
    paddingHorizontal: 16,
    maxWidth: 360,
    elevation: 8,
    shadowColor: '#000',
    shadowOpacity: 0.25,
    shadowRadius: 6,
  },
  achievementToastIcon: {
    fontSize: 26,
    marginRight: 10,
  },
  achievementToastBadge: {
    fontSize: 10,
    fontWeight: '800',
    color: '#FACC15',
    letterSpacing: 0.5,
  },
  achievementToastTitle: {
    fontSize: 14,
    fontWeight: '700',
    color: '#FFFFFF',
    marginTop: 1,
  },
  homeFixedContainer: {
    flex: 1,
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingTop: 0,
    paddingBottom: 10,
  },
  dailyCard: {
    width: '100%',
    maxWidth: 400,
    borderRadius: 12,
    paddingVertical: 10,
    paddingHorizontal: 12,
    elevation: 3,
  },
  dailyCardHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 6,
  },
  dailyCardBadge: {
    color: '#FDE047',
    fontSize: 11,
    fontWeight: '800',
    letterSpacing: 0.5,
  },
  dailyStreakTag: {
    color: '#FFFFFF',
    fontSize: 12,
    fontWeight: '700',
  },
  dailyCardBtnRow: {
    flexDirection: 'row',
    gap: 8,
  },
  dailyPlayBtn: {
    flex: 1,
    backgroundColor: '#FFFFFF',
    paddingVertical: 7,
    borderRadius: 8,
    alignItems: 'center',
  },
  dailyPlayBtnText: {
    color: '#111827',
    fontSize: 12,
    fontWeight: '700',
  },
  dailyCalendarBtn: {
    backgroundColor: 'rgba(255,255,255,0.2)',
    paddingVertical: 7,
    paddingHorizontal: 12,
    borderRadius: 8,
    alignItems: 'center',
  },
  dailyCalendarBtnText: {
    color: '#FFFFFF',
    fontSize: 12,
    fontWeight: '700',
  },
  middleSection: {
    width: '100%',
    maxWidth: 400,
    alignItems: 'center',
    marginVertical: 'auto',
  },
  centerLogoImage: {
    width: 100,
    height: 100,
    borderRadius: 22,
    marginBottom: 10,
  },
  resumeCard: {
    width: '100%',
    backgroundColor: '#005BBB',
    paddingVertical: 8,
    paddingHorizontal: 14,
    borderRadius: 12,
  },
  resumeHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 2,
  },
  resumeTitle: {
    fontSize: 14,
    fontWeight: '700',
    color: '#FFFFFF',
  },
  resumeTime: {
    fontSize: 13,
    fontWeight: '600',
    color: '#E0F2FE',
  },
  resumeDetails: {
    fontSize: 11,
    color: '#BAE6FD',
    fontWeight: '500',
  },
  bottomControlsSection: {
    width: '100%',
    maxWidth: 400,
    alignItems: 'center',
  },
  playButton: {
    width: '100%',
    paddingVertical: 12,
    borderRadius: 10,
    alignItems: 'center',
    marginTop: 6,
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
  ratingOverviewRow: {
    flexDirection: 'row',
    gap: 12,
    marginBottom: 12,
  },
  ratingCard: {
    flex: 1,
    padding: 16,
    borderRadius: 12,
    alignItems: 'center',
    elevation: 2,
  },
  ratingLabel: {
    fontSize: 12,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  ratingValue: {
    fontSize: 20,
    fontWeight: '800',
    marginTop: 4,
  },
  leaderboardBtn: {
    width: '100%',
    paddingVertical: 12,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 16,
  },
  leaderboardBtnText: {
    color: '#FFFFFF',
    fontSize: 14,
    fontWeight: '700',
  },
  sectionHeading: {
    fontSize: 17,
    fontWeight: '800',
    marginBottom: 10,
  },
  analyticsBarTrack: {
    height: 8,
    borderRadius: 4,
    backgroundColor: 'rgba(128,128,128,0.2)',
    overflow: 'hidden',
  },
  analyticsBarFill: {
    height: '100%',
    borderRadius: 4,
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
  leaderboardRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderRadius: 8,
  },
  leaderboardRankCol: {
    width: 34,
    alignItems: 'center',
  },
  leaderboardRankText: {
    fontSize: 15,
    fontWeight: '800',
  },
  leaderboardName: {
    fontSize: 13,
    fontWeight: '700',
  },
  leaderboardSub: {
    fontSize: 11,
    marginTop: 2,
  },
  leaderboardScore: {
    fontSize: 13,
    fontWeight: '800',
  },
  followBtn: {
    backgroundColor: '#3B82F6',
    paddingVertical: 3,
    paddingHorizontal: 8,
    borderRadius: 6,
  },
  followBtnActive: {
    backgroundColor: '#6B7280',
  },
  followBtnText: {
    color: '#FFFFFF',
    fontSize: 10,
    fontWeight: '700',
  },
  followBtnTextActive: {
    color: '#E5E7EB',
  },
  calendarSubHeading: {
    fontSize: 12,
    marginTop: 2,
  },
  crownMilestoneBox: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(234, 179, 8, 0.15)',
    borderColor: 'rgba(234, 179, 8, 0.4)',
    borderWidth: 1,
    borderRadius: 10,
    padding: 10,
    marginBottom: 10,
  },
  crownMilestoneTitle: {
    fontSize: 13,
    fontWeight: '700',
  },
  crownMilestoneSub: {
    fontSize: 11,
    marginTop: 1,
  },
  calendarStreakBanner: {
    flexDirection: 'row',
    justifyContent: 'space-around',
    backgroundColor: 'rgba(128,128,128,0.1)',
    borderRadius: 10,
    paddingVertical: 10,
    marginVertical: 8,
  },
  calendarStreakItem: {
    alignItems: 'center',
  },
  calendarStreakVal: {
    fontSize: 16,
    fontWeight: '800',
    color: '#D97706',
  },
  calendarStreakLabel: {
    fontSize: 10,
    fontWeight: '600',
    color: '#6B7280',
    marginTop: 2,
  },
  calendarDaysHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 6,
  },
  calendarDayHeadText: {
    flex: 1,
    textAlign: 'center',
    fontSize: 11,
    fontWeight: '700',
  },
  calendarGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
  },
  calendarSlotEmpty: {
    width: `${100 / 7}%`,
    aspectRatio: 1,
  },
  calendarDaySlot: {
    width: `${100 / 7}%`,
    aspectRatio: 1,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 6,
    marginVertical: 2,
    position: 'relative',
  },
  calendarDayNum: {
    fontSize: 12,
    fontWeight: '700',
  },
  calendarStar: {
    fontSize: 10,
    position: 'absolute',
    bottom: 2,
  },
  avatarCircle: {
    width: 90,
    height: 90,
    borderRadius: 45,
    backgroundColor: '#9E9E9E',
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
    marginBottom: 10,
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
    marginBottom: 10,
  },
  editProfileBtn: {
    paddingVertical: 6,
    paddingHorizontal: 16,
    borderRadius: 20,
    borderWidth: 1,
    marginBottom: 16,
  },
  editProfileBtnText: {
    fontSize: 12,
    fontWeight: '700',
  },
  profileInput: {
    width: '100%',
    borderWidth: 1,
    borderRadius: 8,
    padding: 10,
    fontSize: 15,
    marginTop: 4,
  },
  avatarPresetBtn: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(128,128,128,0.15)',
  },
  achievementsCard: {
    width: '100%',
    maxWidth: 360,
    padding: 16,
    borderRadius: 12,
    marginBottom: 16,
    elevation: 2,
  },
  achievementsHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 12,
  },
  badgeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 10,
    borderBottomWidth: 1,
  },
  badgeIcon: {
    fontSize: 24,
  },
  badgeTitle: {
    fontSize: 14,
    fontWeight: '700',
  },
  badgeDesc: {
    fontSize: 11,
    marginTop: 2,
  },
  badgeTier: {
    fontSize: 10,
    fontWeight: '800',
    letterSpacing: 0.5,
  },
  profileCard: {
    width: '100%',
    maxWidth: 360,
    padding: 16,
    borderRadius: 12,
    marginBottom: 16,
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
  managementActionBtn: {
    width: '100%',
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderRadius: 8,
    alignItems: 'center',
    marginTop: 8,
  },
  managementActionText: {
    fontSize: 13,
    fontWeight: '700',
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
  gameHeaderCenterTitle: {
    fontSize: 13,
    fontWeight: '700',
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
    marginBottom: 12,
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
    fontSize: 13,
    textAlign: 'center',
    paddingVertical: 24,
    lineHeight: 18,
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
    gap: 8,
  },
  segmentBtn: {
    flex: 1,
    paddingVertical: 8,
    alignItems: 'center',
    borderRadius: 8,
    backgroundColor: '#E5E7EB',
  },
  segmentBtnActive: {
    backgroundColor: '#111827',
  },
  segmentText: {
    fontSize: 13,
    fontWeight: '700',
    color: '#374151',
  },
  segmentTextActive: {
    color: '#FFFFFF',
  },
  segmentBtnSmall: {
    flex: 1,
    paddingVertical: 6,
    alignItems: 'center',
    borderRadius: 6,
    backgroundColor: '#E5E7EB',
  },
  segmentBtnSmallActive: {
    backgroundColor: '#2563EB',
  },
  segmentSmallText: {
    fontSize: 11,
    fontWeight: '600',
    color: '#4B5563',
  },
  segmentSmallTextActive: {
    color: '#FFFFFF',
    fontWeight: '700',
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