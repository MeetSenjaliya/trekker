// Achievement catalog — display metadata for the badges awarded server-side by
// award_user_achievements() (see supabase/migrations/20260619030000_user_achievements.sql).
// `key` MUST match the keys inserted by that function. Criteria text here is
// purely descriptive; the real thresholds live in the SQL.

export interface Achievement {
  key: string;
  name: string;
  icon: string;
  description: string;
}

export const ACHIEVEMENTS: Achievement[] = [
  { key: 'trailblazer',      name: 'Trailblazer',       icon: '🚩', description: 'Joined your first trek' },
  { key: 'first_steps',      name: 'First Steps',       icon: '🥾', description: 'Completed your first trek' },
  { key: 'trail_regular',    name: 'Trail Regular',     icon: '🏕️', description: 'Completed 5 treks' },
  { key: 'seasoned_trekker', name: 'Seasoned Trekker',  icon: '🧗', description: 'Completed 10 treks' },
  { key: 'mountain_master',  name: 'Mountain Master',   icon: '🏔️', description: 'Completed 25 treks' },
  { key: 'trail_legend',     name: 'Trail Legend',      icon: '👑', description: 'Completed 50 treks' },
  { key: 'warming_up',       name: 'Warming Up',        icon: '📏', description: 'Trekked 10 km in total' },
  { key: 'centurion',        name: 'Centurion',         icon: '🎯', description: 'Trekked 100 km in total' },
  { key: 'ultra_explorer',   name: 'Ultra Explorer',    icon: '🌍', description: 'Trekked 500 km in total' },
  { key: 'explorer',         name: 'Explorer',          icon: '🧭', description: 'Trekked 5 different locations' },
  { key: 'globetrotter',     name: 'Globetrotter',      icon: '✈️', description: 'Trekked 10 different locations' },
  { key: 'peak_conqueror',   name: 'Peak Conqueror',    icon: '⛰️', description: 'Completed a Hard or Expert trek' },
  { key: 'dedicated',        name: 'Dedicated',         icon: '📅', description: 'Trekked across 6 different months' },
  { key: 'storyteller',      name: 'Storyteller',       icon: '✍️', description: 'Wrote 5 trek reviews' },
  { key: 'shutterbug',       name: 'Shutterbug',        icon: '📸', description: 'Shared 25 trek photos' },
];

export const ACHIEVEMENTS_BY_KEY: Record<string, Achievement> = Object.fromEntries(
  ACHIEVEMENTS.map((a) => [a.key, a]),
);
