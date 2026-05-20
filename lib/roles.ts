export type TeamRole =
  | 'delivery_lead' | 'senior_ba' | 'senior_mis' | 'senior_developer'
  | 'ba' | 'mis' | 'developer';

export const ROLE_LABELS: Record<TeamRole, string> = {
  delivery_lead: 'Delivery Lead', senior_ba: 'Senior BA',
  senior_mis: 'Senior MIS', senior_developer: 'Senior Developer',
  ba: 'Business Analyst', mis: 'MIS Executive', developer: 'Developer',
};

export const ROLE_COLORS: Record<TeamRole, { bg: string; text: string }> = {
  delivery_lead:    { bg: 'bg-blue-100 dark:bg-blue-900/30',    text: 'text-blue-700 dark:text-blue-300' },
  senior_ba:        { bg: 'bg-purple-100 dark:bg-purple-900/30', text: 'text-purple-700 dark:text-purple-300' },
  senior_mis:       { bg: 'bg-pink-100 dark:bg-pink-900/30',    text: 'text-pink-700 dark:text-pink-300' },
  senior_developer: { bg: 'bg-emerald-100 dark:bg-emerald-900/30', text: 'text-emerald-700 dark:text-emerald-300' },
  ba:               { bg: 'bg-violet-100 dark:bg-violet-900/30', text: 'text-violet-700 dark:text-violet-300' },
  mis:              { bg: 'bg-rose-100 dark:bg-rose-900/30',    text: 'text-rose-700 dark:text-rose-300' },
  developer:        { bg: 'bg-teal-100 dark:bg-teal-900/30',    text: 'text-teal-700 dark:text-teal-300' },
};

export const ROLE_GROUPS = [
  { label: 'Leadership',   roles: ['delivery_lead'] as TeamRole[] },
  { label: 'BA Stream',    roles: ['senior_ba', 'ba'] as TeamRole[] },
  { label: 'MIS Stream',   roles: ['senior_mis', 'mis'] as TeamRole[] },
  { label: 'Dev Stream',   roles: ['senior_developer', 'developer'] as TeamRole[] },
];

export const VISIBILITY_MAP: Record<TeamRole, TeamRole[]> = {
  delivery_lead:    ['delivery_lead','senior_ba','senior_mis','senior_developer','ba','mis','developer'],
  senior_ba:        ['senior_ba', 'ba'],
  senior_mis:       ['senior_mis', 'mis'],
  senior_developer: ['senior_developer', 'developer'],
  ba:               ['ba'],
  mis:              ['mis'],
  developer:        ['developer'],
};

export const REPLY_MAP = VISIBILITY_MAP;

export function canView(viewer: TeamRole, owner: TeamRole): boolean {
  return VISIBILITY_MAP[viewer].includes(owner);
}

export function canReply(replier: TeamRole, owner: TeamRole): boolean {
  return REPLY_MAP[replier].includes(owner);
}

export function hasTeam(role: TeamRole): boolean {
  return ['delivery_lead','senior_ba','senior_mis','senior_developer'].includes(role);
}

export const MANAGER_ROLES: TeamRole[] = [
  'delivery_lead',
  'senior_ba',
  'senior_mis',
  'senior_developer',
]

export function isManagerRole(role: TeamRole): boolean {
  return MANAGER_ROLES.includes(role)
}

export function getNavItems(role: TeamRole) {
  const agent    = { label: 'Agent',        href: '/',               icon: 'Sparkles' };
  const tasks    = { label: 'All Tasks',    href: '/tasks',          icon: 'CheckSquare' };
  const team     = { label: 'Team View',    href: '/team',           icon: 'Users' };
  const monitor  = { label: 'Monitor',      href: '/monitor',        icon: 'BarChart2' };
  const users    = { label: 'Manage Users', href: '/settings/users', icon: 'UserCog' };
  const settings = { label: 'Settings',     href: '/settings',       icon: 'Settings' };

  if (role === 'delivery_lead') return [agent, tasks, team, monitor, users, settings];
  if (hasTeam(role))            return [agent, tasks, team, users, settings];
  return [agent, tasks, settings];
}
