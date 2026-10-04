import { supabase } from './supabase';
import AsyncStorage from '@react-native-async-storage/async-storage';

const PENDING_RUNS_KEY = '@sudoku_pending_runs_v1';
const FAVORITES_KEY = '@sudoku_favorites_v1';

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
    
    if (!user) {
      console.log('👤 Guest game saved to pending queue.');
      const existing = await AsyncStorage.getItem(PENDING_RUNS_KEY);
      const list = existing ? JSON.parse(existing) : [];
      list.push(run);
      await AsyncStorage.setItem(PENDING_RUNS_KEY, JSON.stringify(list));
      return;
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
      },
    ]);

    if (error) {
      console.error('❌ Supabase insert error:', error.message);
    } else {
      console.log('✅ Game run synced to cloud');
    }
  } catch (err) {
    console.error('Failed to sync game run:', err);
  }
}

// Uploads queued local games and syncs cloud stats and favorites to the device
export async function syncUserDataUponLogin(
  onStatsFetched?: (stats: any) => void,
  onFavoritesFetched?: (favorites: any[]) => void,
) {
  try {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;

    // 1. Upload any pending runs created while offline/guest on this device
    const rawLocalRuns = await AsyncStorage.getItem(PENDING_RUNS_KEY);
    if (rawLocalRuns) {
      const localRuns: any[] = JSON.parse(rawLocalRuns);
      if (localRuns.length > 0) {
        console.log(`🔄 Syncing ${localRuns.length} pending runs from this device...`);
        for (const run of localRuns) {
          await supabase.from('game_runs').insert([
            {
              user_id: user.id,
              grid_size: run.gridSize,
              difficulty: run.difficulty.toLowerCase(),
              time_seconds: run.timeSeconds,
              mistakes: run.mistakes,
              hints_used: run.hintsUsed,
              status: run.status,
            },
          ]);
        }
        await AsyncStorage.removeItem(PENDING_RUNS_KEY);
      }
    }

    // 2. Fetch aggregated user statistics
    const { data: statsData } = await supabase
      .from('user_statistics')
      .select('*')
      .eq('user_id', user.id)
      .maybeSingle();

    if (statsData && onStatsFetched) {
      onStatsFetched(statsData);
    }

    // 3. Fetch cloud favorites
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
  } catch (err) {
    console.error('Error during cloud synchronization:', err);
  }
}