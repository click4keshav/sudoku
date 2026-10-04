import * as WebBrowser from 'expo-web-browser';
import { makeRedirectUri } from 'expo-auth-session';
import type { User } from '@supabase/supabase-js';
import { supabase } from './supabase';

WebBrowser.maybeCompleteAuthSession();

export async function getCurrentUser(): Promise<User | null> {
  const { data: { user } } = await supabase.auth.getUser();
  return user;
}

export async function signOutUser() {
  const { error } = await supabase.auth.signOut();
  if (error) throw error;
}

export async function signInWithGoogle() {
  try {
    const redirectUrl = makeRedirectUri({
      scheme: 'sudoku',
      path: 'auth/callback',
    });

    console.log('🔗 Redirect URI:', redirectUrl);

    const { data, error } = await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: {
        redirectTo: redirectUrl,
        skipBrowserRedirect: true,
      },
    });

    if (error) throw error;
    if (!data?.url) throw new Error('No authentication URL received.');

    const res = await WebBrowser.openAuthSessionAsync(data.url, redirectUrl);

    if (res.type === 'success' && res.url) {
      console.log('✅ Auth return URL:', res.url);
      const parsedUrl = new URL(res.url);

      const params = new URLSearchParams(
        parsedUrl.hash ? parsedUrl.hash.substring(1) : parsedUrl.search.substring(1)
      );

      const accessToken = params.get('access_token');
      const refreshToken = params.get('refresh_token');

      if (accessToken && refreshToken) {
        const { data: sessionData, error: sessionError } =
          await supabase.auth.setSession({
            access_token: accessToken,
            refresh_token: refreshToken,
          });

        if (sessionError) throw sessionError;
        return { success: true, session: sessionData.session };
      }
    }

    // Fallback: in case setSession was triggered directly by redirect listener
    const { data: currentSession } = await supabase.auth.getSession();
    if (currentSession?.session) {
      return { success: true, session: currentSession.session };
    }

    return { success: false, error: 'Authentication canceled or incomplete' };
  } catch (err: any) {
    console.error('Sign-in error:', err);
    return { success: false, error: err.message };
  }
}