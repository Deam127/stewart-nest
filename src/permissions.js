// The Stewart Nest — per-person permissions.
// Everyone can always: see the calendar & menu, do and tick their OWN tasks and workouts, rate meals,
// upload photos, read notifications and change their own password.
// Everything else is a permission the admin can switch on or off per person (Family profiles → Edit).
// The admin always has everything. Grown-ups start with everything; children start with nothing extra.

export const PERMS = {
  chat: 'Family chat',
  assign_tasks: 'Give tasks to others, tick or remove other people\'s tasks, repeating chores',
  edit_menu: 'Change meals, menu builder, rotation, plan ahead, rain-out switch',
  edit_recipes: 'Add and edit recipes',
  edit_calendar: 'Add/edit events, day plans and notes',
  shopping: 'Stock take, shopping list & trolley, inventory',
  fun: 'Family fun ideas (add, vote, plan)',
  baby_lists: "Madilea's bags & buy lists",
  workouts_manage: 'Create and stop workouts for anyone',
  approve_rewards: 'Approve rewards and set reward goals',
  settings: 'App settings, budgets and baby due date',
};

export function permsFor(u) {
  const all = Object.fromEntries(Object.keys(PERMS).map((k) => [k, true]));
  if (u.is_admin) return all;
  let saved = null;
  try { saved = u.permissions ? JSON.parse(u.permissions) : null; } catch { /* bad JSON: fall back */ }
  const base = Object.fromEntries(Object.keys(PERMS).map((k) => [k, !!u.is_parent]));
  return saved ? { ...base, ...Object.fromEntries(Object.keys(PERMS).map((k) => [k, !!saved[k]])) } : base;
}

// Which permission an API call needs (null = allowed for everyone logged in; handlers still check ownership)
export function requiredPerm(path, parts, method) {
  const write = method !== 'GET';
  const p0 = parts[0];
  if (p0 === 'chat') return 'chat';
  if (['stock-takes', 'trips', 'shop-lines'].includes(p0)) return 'shopping';
  if (p0 === 'items' && write) return 'shopping';
  if (p0 === 'plan') return 'edit_menu';
  if (['menu', 'rotation'].includes(p0) && write) return 'edit_menu';
  if (path === 'menu/generate' || path === 'menu/backup' || path === 'menu/swap') return 'edit_menu';
  if (p0 === 'recipes' && write) return 'edit_menu';
  if (p0 === 'catalog' && write) return 'edit_recipes';
  if (['events', 'plans', 'notes'].includes(p0) && write) return 'edit_calendar';
  if (p0 === 'fun' && write) return 'fun';
  if (['lists', 'list-items'].includes(p0) && write) return 'baby_lists';
  if (p0 === 'templates' && write) return 'assign_tasks';
  if (p0 === 'workouts' && write && path !== 'workouts/log') return 'workouts_manage';
  if (path === 'rewards/goal' || path === 'rewards/claim') return 'approve_rewards';
  if (path === 'settings' && write) return 'settings';
  return null;
}
