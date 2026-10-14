import { useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';
import { buildReaderSnapshot, todayUtcStr } from './readerSnapshot';

// Načte úroveň čtenáře pro lištu nad hrou. Když se něco nepovede, lišta úroveň prostě neukáže (hra jede dál).
export function useReaderSnapshot(userId) {
  const [snapshot, setSnapshot] = useState(null);

  useEffect(() => {
    if (!userId) { setSnapshot(null); return undefined; }
    let cancelled = false;
    (async () => {
      try {
        const today = todayUtcStr();
        const [profileRes, readRes, activityRes, streakRes] = await Promise.all([
          supabase.from('profiles').select('fake_xp, bonus_xp, unlocked_badges, highest_goal_completed, current_streak, coins').eq('id', userId).maybeSingle(),
          supabase.from('user_books').select('book_id').eq('user_id', userId).eq('is_read', true),
          supabase.from('user_daily_activity').select('activity_date').eq('user_id', userId).eq('activity_date', today).limit(1),
          supabase.rpc('resolve_streak'),
        ]);
        if (cancelled) return;
        if (profileRes.error || readRes.error) throw (profileRes.error || readRes.error);
        const next = buildReaderSnapshot({
          profile: profileRes.data,
          totalRead: (readRes.data || []).length,
          todayActive: !activityRes.error && (activityRes.data || []).length > 0,
          resolvedStreak: streakRes?.data?.streak,
        });
        setSnapshot(next);
      } catch (err) {
        console.error('Nepodařilo se načíst úroveň pro lištu hry:', err?.message || err);
      }
    })();
    return () => { cancelled = true; };
  }, [userId]);

  return snapshot;
}
