import { supabase } from './supabase';
import AsyncStorage from '@react-native-async-storage/async-storage';

const PENDING_RUNS_KEY = '@sudoku_pending_runs_v1';
const FAVORITES_KEY = '@sudoku_favorites_v1';
export const STATS_KEY = '@sudoku_stats_v4';

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

    // 1. ALWAYS update local AsyncStorage aggregate stats so offline/guest play reflects immediately
    const rawLocalStats = await AsyncStorage.getItem(STATS_KEY);
    const localStats = rawLocalStats ? JSON.parse(rawLocalStats) : {};
    const label = `${run.gridSize}x${run.gridSize}`;
    const diffKey = `${label} - ${run.difficulty.toUpperCase()}`;

    const currentCat = localStats[diffKey] || { started: 0, won: 0, bestTime: null, streak: 0 };
    currentCat.started += 1;
    if (run.status === 'won') {
      currentCat.won += 1;
      currentCat.streak += 1;
      if (currentCat.bestTime === null || run.timeSeconds < currentCat.bestTime) {
        currentCat.bestTime = run.timeSeconds;
      }
    } else {
      currentCat.streak = 0;
    }
    localStats[diffKey] = currentCat;
    await AsyncStorage.setItem(STATS_KEY, JSON.stringify(localStats));

    // 2. Queue for upload if guest, or insert directly if logged in
    if (!user) {
      console.log('👤 Guest game queued to pending runs and local stats preserved.');
      const existing = await AsyncStorage.getItem(PENDING_RUNS_KEY);
      const list = existing ? JSON.parse(existing) : [];
      list.push(run);
      await AsyncStorage.setItem(PENDING_RUNS_KEY, JSON.stringify(list));
      return { isGuest: true, localStats };
    }

    const { error } = await supabase.from('game_runs').insert([
      {
        user_id: user.id,
        grid_size: run.gridSize,
        difficulty: run.difficulty.toLowerCase(),
        time_seconds: run.timeSeconds,
        mistakes: run.mistakes,
        hints_used: run.hintsUsed,
        status: run.status,
        device_id: run.deviceId,
      },
    ]);

    if (error) {
      console.error('❌ Supabase insert error:', error.message);
    } else {
      console.log('✅ Game run synced to cloud');
    }

    return { isGuest: false, localStats };
  } catch (err) {
    console.error('Failed to sync game run:', err);
    return { isGuest: true, localStats: {} };
  }
}

// ---------------- ACTIVE GAME CLOUD PERSISTENCE ---------------- //

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

// ---------------- STATS & REHYDRATION ---------------- //

export async function fetchUserStatsFromCloud() {
  try {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      // Guest/Logged-out: Read directly from persistent local storage
      const raw = await AsyncStorage.getItem(STATS_KEY);
      return raw ? JSON.parse(raw) : null;
    }

    const { data, error } = await supabase
      .from('user_statistics')
      .select('grid_size, difficulty, started, won, streak, best_time_seconds')
      .eq('user_id', user.id);

    if (error || !data) {
      console.error('❌ Error fetching user statistics:', error?.message);
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

    const formatted: Record<string, { started: number; won: number; bestTime: number | null; streak: number }> = {};

    for (const row of data) {
      const label = sizeToLabel[row.grid_size] || `${row.grid_size}x${row.grid_size}`;
      const diff = (row.difficulty || 'easy').toUpperCase();
      const key = `${label} - ${diff}`;
      formatted[key] = {
        started: row.started,
        won: row.won,
        bestTime: row.best_time_seconds,
        streak: row.streak,
      };
    }

    // Persist cloud snapshot to local storage so it stays visible on logout
    await AsyncStorage.setItem(STATS_KEY, JSON.stringify(formatted));
    return formatted;
  } catch (err) {
    console.error('Failed to parse cloud statistics:', err);
    const raw = await AsyncStorage.getItem(STATS_KEY);
    return raw ? JSON.parse(raw) : null;
  }
}

export async function syncUserDataUponLogin(
  deviceId?: string,
  onStatsFetched?: (stats: any) => void,
  onFavoritesFetched?: (favorites: any[]) => void,
  onActiveGameFetched?: (game: any) => void,
) {
  try {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;

    // 1. Link anonymous runs matching this device ID in Postgres
    if (deviceId && deviceId !== 'guest-device') {
      await supabase.rpc('claim_guest_runs', { p_device_id: deviceId });
    }

    // 2. Flush offline pending runs saved locally AS A SINGLE BATCH
    const rawLocalRuns = await AsyncStorage.getItem(PENDING_RUNS_KEY);
    if (rawLocalRuns) {
      const localRuns: any[] = JSON.parse(rawLocalRuns);
      if (localRuns.length > 0) {
        console.log(`🔄 Uploading ${localRuns.length} pending runs to cloud...`);
        const rowsToInsert = localRuns.map((run) => ({
          user_id: user.id,
          grid_size: run.gridSize,
          difficulty: run.difficulty.toLowerCase(),
          time_seconds: run.timeSeconds,
          mistakes: run.mistakes,
          hints_used: run.hintsUsed,
          status: run.status,
          device_id: deviceId,
        }));

        const { error } = await supabase.from('game_runs').insert(rowsToInsert);
        if (!error) {
          await AsyncStorage.removeItem(PENDING_RUNS_KEY);
        } else {
          console.error('Error inserting pending runs batch:', error.message);
        }
      }
    }

    // 3. Refresh user statistics from Supabase
    const statsData = await fetchUserStatsFromCloud();
    if (statsData && onStatsFetched) {
      onStatsFetched(statsData);
    }

    // 4. Refresh cloud favorites
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

    // 5. Restore active paused game from cloud if present
    const remoteActive = await fetchActiveGameFromCloud();
    if (remoteActive && onActiveGameFetched) {
      onActiveGameFetched(remoteActive);
    }
  } catch (err) {
    console.error('Error during cloud synchronization:', err);
  }
}