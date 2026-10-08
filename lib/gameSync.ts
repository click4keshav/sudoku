import { supabase } from './supabase';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Share } from 'react-native';

const PENDING_RUNS_KEY = '@sudoku_pending_runs_v1';
const FAVORITES_KEY = '@sudoku_favorites_v1';
export const STATS_KEY = '@sudoku_stats_v4';
export const DAILY_LOCAL_KEY = '@sudoku_daily_challenges_v1';
export const DAILY_STREAK_KEY = '@sudoku_daily_streak_v1';
export const ACHIEVEMENTS_KEY = '@sudoku_achievements_v1';
export const CUSTOM_PROFILE_KEY = '@sudoku_custom_profile_v1';
export const LOGIN_STREAK_KEY = '@sudoku_login_streak_v1';

const SCORING_RULES: Record<number, Record<string, { base: number; avgTime: number }>> = {
  3: { easy: { base: 100, avgTime: 18 }, medium: { base: 200, avgTime: 36 }, hard: { base: 300, avgTime: 60 }, expert: { base: 400, avgTime: 90 } },
  4: { easy: { base: 200, avgTime: 54 }, medium: { base: 300, avgTime: 108 }, hard: { base: 400, avgTime: 180 }, expert: { base: 500, avgTime: 270 } },
  6: { easy: { base: 300, avgTime: 126 }, medium: { base: 400, avgTime: 252 }, hard: { base: 500, avgTime: 420 }, expert: { base: 600, avgTime: 630 } },
  8: { easy: { base: 400, avgTime: 288 }, medium: { base: 500, avgTime: 576 }, hard: { base: 600, avgTime: 960 }, expert: { base: 700, avgTime: 1440 } },
  9: { easy: { base: 500, avgTime: 360 }, medium: { base: 600, avgTime: 720 }, hard: { base: 700, avgTime: 1200 }, expert: { base: 800, avgTime: 1800 } },
};

export const ACHIEVEMENTS_METADATA = [
  { id: 'speed_demon', title: 'Speed Demon', description: 'Solve 9x9 Medium in < 5 mins', icon: '⚡', tier: 'silver' },
  { id: 'flawless', title: 'Flawless', description: 'Win with 0 mistakes & 0 hints', icon: '🎯', tier: 'bronze' },
  { id: 'all_rounder', title: 'All-Rounder', description: 'Win on all 5 board sizes', icon: '🧩', tier: 'gold' },
  { id: 'consistent_7', title: 'Consistency Champion', description: '7-day Daily Challenge streak', icon: '🔥', tier: 'silver' },
  { id: 'grandmaster', title: 'Grandmaster', description: 'Reach 10,000 Career XP', icon: '👑', tier: 'diamond' },
];

function getTodayString(): string {
  const d = new Date();
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export async function processDailyLogin() {
  const today = getTodayString();
  const raw = await AsyncStorage.getItem(LOGIN_STREAK_KEY);
  const data = raw ? JSON.parse(raw) : { lastLogin: '', streak: 0 };

  if (data.lastLogin === today) return null;

  let newStreak = 1;
  if (data.lastLogin) {
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    const yesterdayStr = `${yesterday.getFullYear()}-${String(yesterday.getMonth() + 1).padStart(2, '0')}-${String(yesterday.getDate()).padStart(2, '0')}`;
    
    if (data.lastLogin === yesterdayStr) {
      newStreak = data.streak + 1;
    }
  }

  await AsyncStorage.setItem(LOGIN_STREAK_KEY, JSON.stringify({ lastLogin: today, streak: newStreak }));
  
  const rawStats = await AsyncStorage.getItem(STATS_KEY);
  const localStats = rawStats ? JSON.parse(rawStats) : {};
  if (!localStats['Rewards - DAILY']) {
    localStats['Rewards - DAILY'] = { started: 0, won: 0, totalScore: 0, streak: 0, bestScore: 0, perfectGames: 0, bestTime: null };
  }
  localStats['Rewards - DAILY'].totalScore = (localStats['Rewards - DAILY'].totalScore || 0) + 50;
  await AsyncStorage.setItem(STATS_KEY, JSON.stringify(localStats));

  return { streak: newStreak, hintsAwarded: 1, xpAwarded: 50 }; 
}

export function calculateLocalRunScore(
  gridSize: number,
  difficulty: string,
  timeSeconds: number,
  status: 'won' | 'lost',
  mistakes: number = 0,
  hintsUsed: number = 0,
): number {
  if (status !== 'won') return 0;
  const config = SCORING_RULES[gridSize]?.[difficulty.toLowerCase()];
  if (!config) return 100;
  const ratio = timeSeconds / config.avgTime;
  let multiplier = 1.0;
  if (ratio <= 0.5) multiplier = 2.0;
  else if (ratio <= 1.0) multiplier = 1.5;
  else if (ratio <= 2.0) multiplier = 1.0;
  else multiplier = 0.5;

  let penalty = 1.0 - (mistakes * 0.10) - (hintsUsed * 0.15);
  if (penalty < 0.20) penalty = 0.20;

  return Math.round(config.base * multiplier * penalty);
}

export type Timeframe = 'all_time' | 'monthly' | 'weekly';

export type LeaderboardEntry = {
  userId: string;
  displayName: string;
  avatarUrl: string | null;
  totalScore: number;
  peakScore: number;
  gamesWon: number;
  isFollowing?: boolean;
  rank?: number;
};

export async function fetchGlobalTelemetry() {
  await new Promise(resolve => setTimeout(resolve, 800));
  return {
    activePlayers: Math.floor(1200 + Math.random() * 500),
    dailyCompletionPercentage: 68,
  };
}

export function computeProfileSummaryMetrics(stats: Record<string, any>) {
  let totalWins = 0;
  let perfectGames = 0;
  let bestStreakOverall = 0;

  Object.values(stats).forEach((item: any) => {
    totalWins += item.won || 0;
    perfectGames += item.perfectGames || 0;
    bestStreakOverall = Math.max(bestStreakOverall, item.streak || 0);
  });

  return { totalWins, perfectGames, bestStreakOverall };
}

export async function fetchGlobalLeaderboard(
  type: 'career' | 'peak' = 'career',
  timeframe: Timeframe = 'all_time',
  friendsOnly: boolean = false,
): Promise<LeaderboardEntry[]> {
  try {
    const { data: { user } } = await supabase.auth.getUser();

    const { data, error } = await supabase.rpc('get_leaderboard_ranked', {
      p_timeframe: timeframe,
      p_metric: type,
      p_friends_only: friendsOnly,
      p_current_user_id: user?.id || null,
    });

    if (error || !data) return [];

    return data.map((item: any, idx: number) => ({
      userId: item.user_id,
      displayName: item.display_name || 'RamCraft Player',
      avatarUrl: item.avatar_url || null,
      totalScore: Number(item.total_score) || 0,
      peakScore: Number(item.peak_score) || 0,
      gamesWon: Number(item.games_won) || 0,
      isFollowing: Boolean(item.is_following),
      rank: idx + 1,
    }));
  } catch (err) {
    console.error('Leaderboard query error:', err);
    return [];
  }
}

export async function toggleFollowUser(targetUserId: string, follow: boolean): Promise<boolean> {
  try {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return false;

    if (follow) {
      const { error } = await supabase.from('user_follows').insert({
        follower_id: user.id,
        following_id: targetUserId,
      });
      return !error;
    } else {
      const { error } = await supabase
        .from('user_follows')
        .delete()
        .eq('follower_id', user.id)
        .eq('following_id', targetUserId);
      return !error;
    }
  } catch (err) {
    console.error('Failed to toggle follow:', err);
    return false;
  }
}

export async function updateCustomProfile(displayName: string, avatarUrl: string | null): Promise<boolean> {
    try {
      const localProfile = { displayName, avatarUrl };
      await AsyncStorage.setItem(CUSTOM_PROFILE_KEY, JSON.stringify(localProfile));
  
      const { data: { user } } = await supabase.auth.getUser();
      if (user) {
        const { error } = await supabase.from('profiles').upsert({
          id: user.id,
          display_name: displayName,
          avatar_url: avatarUrl,
          updated_at: new Date().toISOString(),
        });
        return !error;
      }
      return true;
    } catch (err) {
      console.error('Profile update error:', err);
      return false;
    }
  }

export async function getCustomProfile(): Promise<{ displayName: string; avatarUrl: string | null } | null> {
  try {
    const raw = await AsyncStorage.getItem(CUSTOM_PROFILE_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

export async function exportUserDataJson(): Promise<void> {
  try {
    const [stats, settings, daily, streak, achievements, favs] = await Promise.all([
      AsyncStorage.getItem(STATS_KEY),
      AsyncStorage.getItem('@sudoku_settings_v4'),
      AsyncStorage.getItem(DAILY_LOCAL_KEY),
      AsyncStorage.getItem(DAILY_STREAK_KEY),
      AsyncStorage.getItem(ACHIEVEMENTS_KEY),
      AsyncStorage.getItem(FAVORITES_KEY),
    ]);

    const archive = {
      app: 'RamCraft Sudoku',
      exportedAt: new Date().toISOString(),
      statistics: stats ? JSON.parse(stats) : {},
      settings: settings ? JSON.parse(settings) : {},
      dailyChallenges: daily ? JSON.parse(daily) : {},
      dailyStreak: streak ? JSON.parse(streak) : {},
      achievements: achievements ? JSON.parse(achievements) : [],
      favorites: favs ? JSON.parse(favs) : [],
    };

    await Share.share({
      title: 'RamCraft Sudoku - Data Export',
      message: JSON.stringify(archive, null, 2),
    });
  } catch (err) {
    console.error('Data export error:', err);
  }
}

export async function deleteUserCloudDataRpc(): Promise<boolean> {
  try {
    const { error } = await supabase.rpc('delete_user_cloud_data');
    if (!error) {
      await AsyncStorage.multiRemove([
        STATS_KEY,
        DAILY_LOCAL_KEY,
        DAILY_STREAK_KEY,
        ACHIEVEMENTS_KEY,
        PENDING_RUNS_KEY,
        FAVORITES_KEY,
      ]);
      return true;
    }
    return false;
  } catch (err) {
    console.error('Wipe data error:', err);
    return false;
  }
}

export async function evaluateLocalAchievements(
  run: { gridSize: number; difficulty: string; timeSeconds: number; mistakes: number; hintsUsed: number; status: 'won' | 'lost' },
  allStats: any,
  streak: number
): Promise<string[]> {
  try {
    const raw = await AsyncStorage.getItem(ACHIEVEMENTS_KEY);
    const unlocked: string[] = raw ? JSON.parse(raw) : [];
    const newlyUnlocked: string[] = [];

    const check = (id: string, condition: boolean) => {
      if (condition && !unlocked.includes(id)) {
        unlocked.push(id);
        newlyUnlocked.push(id);
      }
    };

    if (run.status === 'won') {
      check('speed_demon', run.gridSize === 9 && run.difficulty.toLowerCase() === 'medium' && run.timeSeconds <= 300);
      check('flawless', run.mistakes === 0 && run.hintsUsed === 0);
    }

    const sizes = [3, 4, 6, 8, 9];
    const wonAllSizes = sizes.every((sz) => {
      return ['EASY', 'MEDIUM', 'HARD', 'EXPERT'].some((d) => (allStats[`${sz}x${sz} - ${d}`]?.won || 0) > 0);
    });
    check('all_rounder', wonAllSizes);

    check('consistent_7', streak >= 7);

    let totalScore = 0;
    Object.values(allStats).forEach((item: any) => { totalScore += item.totalScore || 0; });
    check('grandmaster', totalScore >= 10000);

    if (newlyUnlocked.length > 0) {
      await AsyncStorage.setItem(ACHIEVEMENTS_KEY, JSON.stringify(unlocked));
    }
    return newlyUnlocked;
  } catch {
    return [];
  }
}

export async function fetchUserAchievements(): Promise<string[]> {
  try {
    const { data: { user } } = await supabase.auth.getUser();
    const raw = await AsyncStorage.getItem(ACHIEVEMENTS_KEY);
    let list: string[] = raw ? JSON.parse(raw) : [];

    if (user) {
      const { data } = await supabase.from('user_achievements').select('achievement_id').eq('user_id', user.id);
      if (data) {
        const remoteIds = data.map((r) => r.achievement_id);
        list = Array.from(new Set([...list, ...remoteIds]));
        await AsyncStorage.setItem(ACHIEVEMENTS_KEY, JSON.stringify(list));
      }
    }
    return list;
  } catch {
    return [];
  }
}

export async function recordGameRunToSupabase(run: {
  gridSize: number;
  difficulty: string;
  timeSeconds: number;
  mistakes: number;
  hintsUsed: number;
  status: 'won' | 'lost';
  deviceId?: string;
}) {
  try {
    const { data: { user } } = await supabase.auth.getUser();

    const earnedScore = calculateLocalRunScore(
      run.gridSize,
      run.difficulty,
      run.timeSeconds,
      run.status,
      run.mistakes,
      run.hintsUsed,
    );

    const rawLocalStats = await AsyncStorage.getItem(STATS_KEY);
    const localStats = rawLocalStats ? JSON.parse(rawLocalStats) : {};
    const label = `${run.gridSize}x${run.gridSize}`;
    const diffKey = `${label} - ${run.difficulty.toUpperCase()}`;

    const currentCat = localStats[diffKey] || {
      started: 0,
      won: 0,
      perfectGames: 0,
      bestTime: null,
      streak: 0,
      totalScore: 0,
      bestScore: 0,
    };

    currentCat.started += 1;
    if (run.status === 'won') {
      currentCat.won += 1;
      currentCat.streak += 1;
      if (run.mistakes === 0 && run.hintsUsed === 0) {
        currentCat.perfectGames = (currentCat.perfectGames || 0) + 1;
      }
      currentCat.totalScore = (currentCat.totalScore || 0) + earnedScore;
      currentCat.bestScore = Math.max(currentCat.bestScore || 0, earnedScore);
      if (currentCat.bestTime === null || run.timeSeconds < currentCat.bestTime) {
        currentCat.bestTime = run.timeSeconds;
      }
    } else {
      currentCat.streak = 0;
    }
    localStats[diffKey] = currentCat;
    await AsyncStorage.setItem(STATS_KEY, JSON.stringify(localStats));

    const rawStreak = await AsyncStorage.getItem(DAILY_STREAK_KEY);
    const streakData = rawStreak ? JSON.parse(rawStreak) : { bestStreak: 0 };
    const localNewBadges = await evaluateLocalAchievements(run, localStats, streakData.bestStreak || 0);

    let newlyUnlockedBadges = [...localNewBadges];

    if (!user) {
      const existing = await AsyncStorage.getItem(PENDING_RUNS_KEY);
      const list = existing ? JSON.parse(existing) : [];
      list.push({ ...run, score: earnedScore });
      await AsyncStorage.setItem(PENDING_RUNS_KEY, JSON.stringify(list));
      return { isGuest: true, localStats, earnedScore, newlyUnlockedBadges };
    }

    await supabase.from('game_runs').insert([
      {
        user_id: user.id,
        grid_size: run.gridSize,
        difficulty: run.difficulty.toLowerCase(),
        time_seconds: run.timeSeconds,
        mistakes: run.mistakes,
        hints_used: run.hintsUsed,
        status: run.status,
        device_id: run.deviceId,
        score: earnedScore,
      },
    ]);

    const { data: dbBadges } = await supabase.rpc('evaluate_user_achievements', { p_user_id: user.id });
    if (dbBadges && dbBadges.length > 0) {
      const dbIds = dbBadges.map((b: any) => b.newly_unlocked);
      newlyUnlockedBadges = Array.from(new Set([...newlyUnlockedBadges, ...dbIds]));
    }

    return { isGuest: false, localStats, earnedScore, newlyUnlockedBadges };
  } catch (err) {
    console.error('Failed to sync game run:', err);
    return { isGuest: true, localStats: {}, earnedScore: 0, newlyUnlockedBadges: [] };
  }
}

export type DailyChallengeRun = {
  challengeDate: string;
  status: 'won' | 'lost';
  timeSeconds: number;
  mistakes: number;
  hintsUsed: number;
  score: number;
};

export type DailyStreakData = {
  currentStreak: number;
  bestStreak: number;
  totalCompleted: number;
  lastCompletedDate?: string;
};

export async function recordDailyChallengeRun(run: DailyChallengeRun) {
  try {
    const rawLocal = await AsyncStorage.getItem(DAILY_LOCAL_KEY);
    const localDaily: Record<string, DailyChallengeRun> = rawLocal ? JSON.parse(rawLocal) : {};
    
    const wasAlreadyCompleted = localDaily[run.challengeDate] && localDaily[run.challengeDate].status === 'won';
    localDaily[run.challengeDate] = run;
    await AsyncStorage.setItem(DAILY_LOCAL_KEY, JSON.stringify(localDaily));

    const rawStreak = await AsyncStorage.getItem(DAILY_STREAK_KEY);
    const streak: DailyStreakData = rawStreak
      ? JSON.parse(rawStreak)
      : { currentStreak: 0, bestStreak: 0, totalCompleted: 0 };

    if (run.status === 'won') {
      const lastDateStr = streak.lastCompletedDate;
      
      if (!lastDateStr) {
        streak.currentStreak = 1;
        streak.lastCompletedDate = run.challengeDate;
      } else if (run.challengeDate > lastDateStr) {
        const runDate = new Date(run.challengeDate);
        const lastDate = new Date(lastDateStr);
        const diffDays = Math.round((runDate.getTime() - lastDate.getTime()) / (1000 * 3600 * 24));
        
        if (diffDays === 1) {
          streak.currentStreak += 1;
        } else {
          streak.currentStreak = 1; 
        }
        streak.lastCompletedDate = run.challengeDate;
      }

      streak.bestStreak = Math.max(streak.bestStreak, streak.currentStreak);
      if (!wasAlreadyCompleted) {
        streak.totalCompleted += 1;
      }
      
      await AsyncStorage.setItem(DAILY_STREAK_KEY, JSON.stringify(streak));
    }

    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return streak;

    await supabase.from('daily_challenges').upsert({
      user_id: user.id,
      challenge_date: run.challengeDate,
      status: run.status,
      time_seconds: run.timeSeconds,
      mistakes: run.mistakes,
      hints_used: run.hintsUsed,
      score: run.score,
      completed_at: new Date().toISOString(),
    });

    const refreshedStreak = await fetchUserDailyStreak();
    return refreshedStreak || streak;
  } catch (err) {
    console.error('Failed to record daily challenge:', err);
    return null;
  }
}

export async function fetchMonthlyDailyChallenges(
  year: number,
  month: number,
): Promise<Record<string, DailyChallengeRun>> {
  try {
    const rawLocal = await AsyncStorage.getItem(DAILY_LOCAL_KEY);
    const localMap: Record<string, DailyChallengeRun> = rawLocal ? JSON.parse(rawLocal) : {};

    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return localMap;

    const startDate = `${year}-${String(month).padStart(2, '0')}-01`;
    const lastDay = new Date(year, month, 0).getDate();
    const endDate = `${year}-${String(month).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`;

    const { data, error } = await supabase
      .from('daily_challenges')
      .select('challenge_date, status, time_seconds, mistakes, hints_used, score')
      .eq('user_id', user.id)
      .gte('challenge_date', startDate)
      .lte('challenge_date', endDate);

    if (error || !data) return localMap;

    for (const row of data) {
      localMap[row.challenge_date] = {
        challengeDate: row.challenge_date,
        status: row.status,
        timeSeconds: row.time_seconds,
        mistakes: row.mistakes,
        hintsUsed: row.hints_used,
        score: row.score,
      };
    }

    await AsyncStorage.setItem(DAILY_LOCAL_KEY, JSON.stringify(localMap));
    return localMap;
  } catch (err) {
    console.error('Failed to fetch monthly challenges:', err);
    return {};
  }
}

export async function fetchUserDailyStreak(): Promise<DailyStreakData | null> {
  try {
    const rawStreak = await AsyncStorage.getItem(DAILY_STREAK_KEY);
    const localStreak: DailyStreakData = rawStreak
      ? JSON.parse(rawStreak)
      : { currentStreak: 0, bestStreak: 0, totalCompleted: 0 };

    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return localStreak;

    const { data, error } = await supabase
      .from('user_daily_streaks')
      .select('current_streak, best_streak, total_completed')
      .eq('user_id', user.id)
      .maybeSingle();

    if (error || !data) return localStreak;

    const updated: DailyStreakData = {
      ...localStreak,
      currentStreak: data.current_streak || 0,
      bestStreak: data.best_streak || 0,
      totalCompleted: data.total_completed || 0,
    };

    await AsyncStorage.setItem(DAILY_STREAK_KEY, JSON.stringify(updated));
    return updated;
  } catch (err) {
    console.error('Failed to fetch daily streak:', err);
    return null;
  }
}

export async function syncActiveGameToCloud(payload: any) {
  try {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;

    await supabase.from('active_games').upsert({
      user_id: user.id,
      game_payload: payload,
      updated_at: new Date().toISOString(),
    });
  } catch (err) {
    console.error('Failed to sync active game:', err);
  }
}

export async function fetchActiveGameFromCloud() {
  try {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return null;

    const { data, error } = await supabase
      .from('active_games')
      .select('game_payload')
      .eq('user_id', user.id)
      .maybeSingle();

    if (error || !data) return null;
    return data.game_payload;
  } catch (err) {
    console.error('Failed to fetch active game from cloud:', err);
    return null;
  }
}

export async function clearActiveGameFromCloud() {
  try {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;

    await supabase.from('active_games').delete().eq('user_id', user.id);
  } catch (err) {
    console.error('Failed to delete active game from cloud:', err);
  }
}

export async function fetchUserStatsFromCloud() {
  try {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      const raw = await AsyncStorage.getItem(STATS_KEY);
      return raw ? JSON.parse(raw) : null;
    }

    const { data, error } = await supabase
      .from('user_statistics')
      .select('grid_size, difficulty, started, won, perfect_games, streak, best_time_seconds, total_score, best_score')
      .eq('user_id', user.id);

    if (error || !data) {
      const raw = await AsyncStorage.getItem(STATS_KEY);
      return raw ? JSON.parse(raw) : null;
    }

    const sizeToLabel: Record<number, string> = {
      3: '3x3',
      4: '4x4',
      6: '6x6',
      8: '8x8',
      9: '9x9',
    };

    const formatted: Record<string, { started: number; won: number; perfectGames: number; bestTime: number | null; streak: number; totalScore: number; bestScore: number }> = {};

    for (const row of data) {
      const label = sizeToLabel[row.grid_size] || `${row.grid_size}x${row.grid_size}`;
      const diff = (row.difficulty || 'easy').toUpperCase();
      const key = `${label} - ${diff}`;
      formatted[key] = {
        started: row.started,
        won: row.won,
        perfectGames: row.perfect_games || 0,
        bestTime: row.best_time_seconds,
        streak: row.streak,
        totalScore: row.total_score || 0,
        bestScore: row.best_score || 0,
      };
    }

    await AsyncStorage.setItem(STATS_KEY, JSON.stringify(formatted));
    return formatted;
  } catch (err) {
    const raw = await AsyncStorage.getItem(STATS_KEY);
    return raw ? JSON.parse(raw) : null;
  }
}

export async function syncUserDataUponLogin(
  deviceId?: string,
  onStatsFetched?: (stats: any) => void,
  onFavoritesFetched?: (favorites: any[]) => void,
  onActiveGameFetched?: (game: any) => void,
  onDailySynced?: () => void,
) {
  try {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;

    if (deviceId && deviceId !== 'guest-device') {
      await supabase.rpc('claim_guest_runs', { p_device_id: deviceId });
    }

    const rawLocalRuns = await AsyncStorage.getItem(PENDING_RUNS_KEY);
    if (rawLocalRuns) {
      const localRuns: any[] = JSON.parse(rawLocalRuns);
      if (localRuns.length > 0) {
        const rowsToInsert = localRuns.map((run) => ({
          user_id: user.id,
          grid_size: run.gridSize,
          difficulty: run.difficulty.toLowerCase(),
          time_seconds: run.timeSeconds,
          mistakes: run.mistakes,
          hints_used: run.hintsUsed,
          status: run.status,
          device_id: deviceId,
          score: run.score || 0,
        }));

        const { error } = await supabase.from('game_runs').insert(rowsToInsert);
        if (!error) {
          await AsyncStorage.removeItem(PENDING_RUNS_KEY);
        }
      }
    }

    const statsData = await fetchUserStatsFromCloud();
    if (statsData && onStatsFetched) {
      onStatsFetched(statsData);
    }

    const { data: favData } = await supabase
      .from('user_favorites')
      .select('game_payload')
      .eq('user_id', user.id);

    if (favData && favData.length > 0) {
      const remoteFavorites = favData.map((f) => f.game_payload);
      await AsyncStorage.setItem(FAVORITES_KEY, JSON.stringify(remoteFavorites));
      if (onFavoritesFetched) {
        onFavoritesFetched(remoteFavorites);
      }
    }

    const remoteActive = await fetchActiveGameFromCloud();
    if (remoteActive && onActiveGameFetched) {
      onActiveGameFetched(remoteActive);
    }

    if (onDailySynced) {
      onDailySynced();
    }
  } catch (err) {
    console.error('Error during cloud synchronization:', err);
  }
}