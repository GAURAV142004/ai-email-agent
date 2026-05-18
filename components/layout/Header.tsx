'use client'

import { useSession, signOut } from 'next-auth/react'
import { useRouter } from 'next/navigation'
import { useTheme } from 'next-themes'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { LogOut, Settings, User, Sun, Moon, Menu } from 'lucide-react'
import { TeamRole, ROLE_LABELS, ROLE_COLORS } from '@/lib/roles'
import { useMobileSidebar } from './DashboardShell'
import { NotificationBell } from '@/components/dashboard/NotificationBell'

interface HeaderProps {
  title: string
  subtitle?: string
}

function RoleTag({ role }: { role: TeamRole }) {
  const colors = ROLE_COLORS[role]
  const label  = ROLE_LABELS[role]
  return (
    <span className={`
      text-xs font-medium px-2 py-0.5 rounded-full
      ${colors.bg} ${colors.text}
    `}>
      {label}
    </span>
  )
}

export function Header({ title, subtitle }: HeaderProps) {
  const { data: session } = useSession()
  const router = useRouter()
  const { theme, setTheme } = useTheme()
  const role = session?.user?.role as TeamRole | undefined
  const { open: openSidebar } = useMobileSidebar()

  const initials = session?.user?.name
    ?.split(' ')
    .map((n) => n[0])
    .join('')
    .toUpperCase()
    .slice(0, 2) ?? 'U'

  return (
    <header className="h-16 border-b border-slate-200 dark:border-slate-800 bg-white/90 dark:bg-slate-900/90 backdrop-blur-md flex items-center justify-between px-6 sticky top-0 z-20">
      <div className="flex items-center gap-2 animate-fade-in">
        <button
          className="md:hidden w-9 h-9 rounded-xl flex items-center justify-center text-slate-500 dark:text-slate-400 hover:text-slate-800 dark:hover:text-white hover:bg-slate-100 dark:hover:bg-slate-800 transition-all duration-200"
          onClick={openSidebar}
          aria-label="Open menu"
        >
          <Menu className="w-5 h-5" />
        </button>
        <div>
          <h1 className="text-xl font-semibold text-slate-900 dark:text-white leading-tight tracking-tight">{title}</h1>
          {subtitle && <p className="text-xs text-slate-400 dark:text-slate-500 mt-0.5">{subtitle}</p>}
        </div>
      </div>

      <div className="flex items-center gap-2">
        {/* User name + role badge */}
        {session?.user?.name && (
          <div className="hidden sm:flex items-center gap-2 mr-1">
            <span className="text-sm font-medium text-slate-700 dark:text-slate-300">{session.user.name}</span>
            {role && <RoleTag role={role} />}
          </div>
        )}

        {/* Notification bell */}
        <NotificationBell />

        {/* Theme toggle */}
        <button
          onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
          className="w-9 h-9 rounded-xl flex items-center justify-center text-slate-500 dark:text-slate-400 hover:text-slate-800 dark:hover:text-white hover:bg-slate-100 dark:hover:bg-slate-800 transition-all duration-200 hover:scale-105 active:scale-95"
          aria-label="Toggle theme"
        >
          <Sun className="w-4.5 h-4.5 hidden dark:block transition-transform duration-300 rotate-0 dark:rotate-0" />
          <Moon className="w-4.5 h-4.5 block dark:hidden transition-transform duration-300" />
        </button>

        {/* Avatar dropdown */}
        <DropdownMenu>
          <DropdownMenuTrigger className="rounded-full outline-none focus-visible:ring-2 focus-visible:ring-blue-500 transition-transform duration-150 hover:scale-105 active:scale-95">
            <Avatar className="h-9 w-9 ring-2 ring-slate-200 dark:ring-slate-700 hover:ring-blue-300 dark:hover:ring-blue-600 transition-all duration-200">
              <AvatarImage src={session?.user?.image ?? undefined} />
              <AvatarFallback className="bg-gradient-to-br from-blue-500 to-indigo-600 text-white text-xs font-bold">
                {initials}
              </AvatarFallback>
            </Avatar>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-56">
            <div className="px-3 py-3">
              <div className="flex items-center gap-2 mb-0.5">
                <User className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                <p className="text-sm font-semibold text-slate-800 dark:text-slate-200 truncate">{session?.user?.name}</p>
              </div>
              <p className="text-xs text-slate-400 truncate pl-5">{session?.user?.email}</p>
            </div>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              className="cursor-pointer text-sm"
              onClick={() => router.push('/settings')}
            >
              <Settings className="w-3.5 h-3.5 mr-2 text-slate-400" />
              Settings
            </DropdownMenuItem>
            <DropdownMenuItem
              className="cursor-pointer text-sm text-red-600 focus:text-red-600 focus:bg-red-50 dark:focus:bg-red-950"
              onClick={() => signOut({ callbackUrl: '/login' })}
            >
              <LogOut className="w-3.5 h-3.5 mr-2" />
              Sign out
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </header>
  )
}
