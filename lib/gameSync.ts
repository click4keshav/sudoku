import { supabase } from './supabase';

export async function recordGameRunToSupabase(run: {
  gridSize: number;
  difficulty: string;
  timeSeconds: number;
  mistakes: number;
  hintsUsed: number;
  status: 'won' | 'lost';
  deviceId: string;
}) {
  console.log('🚀 Attempting to sync game run to Supabase:', run);
  try {
    const { data: { user: activeUser } } = await supabase.auth.getUser();

    const { data, error } = await supabase.from('game_runs').insert([
      {
        user_id: activeUser?.id ?? null,
        device_id: run.deviceId,
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
      console.log('✅ Game run successfully saved to Supabase!', data);
    }
  } catch (err) {
    console.error('Failed to record run to Supabase:', err);
  }
}