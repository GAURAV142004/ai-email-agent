'use client'

import React from 'react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useSession } from 'next-auth/react'
import { cn } from '@/lib/utils'
import { LayoutDashboard, CheckSquare, Settings, Zap, Users, BarChart2, UserCog, Sparkles } from 'lucide-react'
import { getNavItems, type TeamRole } from '@/lib/roles'

interface SidebarProps {
  isMobileOpen?: boolean
  onMobileClose?: () => void
}

export function Sidebar({ isMobileOpen = false, onMobileClose }: SidebarProps) {
  const pathname = usePathname()
  const { data: session } = useSession()
  const role = session?.user?.role as TeamRole | undefined
  const navItems = role ? getNavItems(role) : []

  const ICON_MAP: Record<string, React.ComponentType<{ className?: string }>> = {
    LayoutDashboard,
    CheckSquare,
    Settings,
    Users,
    BarChart2,
    UserCog,
    Sparkles,
  }

  return (
    <aside className={cn(
      'w-64 bg-[oklch(0.09_0.025_255)] flex flex-col border-r border-white/[0.06]',
      // mobile: fixed overlay, slides in/out
      'fixed inset-y-0 left-0 z-50 transition-transform duration-300 ease-in-out',
      isMobileOpen ? 'translate-x-0' : '-translate-x-full',
      // desktop: static in flex layout
      'md:static md:translate-x-0 md:shrink-0 md:min-h-screen',
    )}>
      {/* Brand */}
      <div className="flex items-center gap-3 px-5 h-16 border-b border-white/[0.06] shrink-0">
        <div className="w-8 h-8 bg-gradient-to-br from-blue-500 to-indigo-600 rounded-xl flex items-center justify-center shadow-lg shadow-blue-500/30 animate-float">
          <Zap className="w-4.5 h-4.5 text-white" />
        </div>
        <div>
          <span className="text-white font-bold text-sm tracking-tight">AI Email Agent</span>
          <div className="flex items-center gap-1.5 mt-0.5">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
            <span className="text-emerald-400/80 text-[10px] font-medium tracking-wide">Active</span>
          </div>
        </div>
      </div>

      {/* Nav */}
      <nav className="flex-1 px-3 py-5 space-y-1">
        {navItems.map(({ href, label, icon }, i) => {
          const Icon = ICON_MAP[icon] ?? LayoutDashboard
          const active = pathname === href
          return (
            <Link
              key={href}
              href={href}
              className={cn(
                'relative flex items-center gap-3 px-3.5 py-2.5 rounded-xl text-[13.5px] font-medium transition-all duration-200 group animate-slide-in-left',
                active
                  ? 'bg-white/10 text-white shadow-sm'
                  : 'text-slate-400 hover:text-slate-100 hover:bg-white/[0.06]'
              )}
              style={{ animationDelay: `${i * 60}ms` }}
            >
              {active && (
                <span className="absolute left-0 top-1/2 -translate-y-1/2 w-[3px] h-6 bg-blue-400 rounded-r-full" />
              )}
              <Icon className={cn(
                'w-5 h-5 shrink-0 transition-colors duration-200',
                active ? 'text-blue-400' : 'text-slate-500 group-hover:text-slate-300'
              )} />
              {label}
              {active && (
                <span className="ml-auto w-1.5 h-1.5 rounded-full bg-blue-400/60" />
              )}
            </Link>
          )
        })}
      </nav>

      {/* Footer */}
      <div className="px-4 py-4 border-t border-white/[0.06]">
        <div className="flex items-center gap-2">
          <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse shadow-sm shadow-emerald-400/50" />
          <p className="text-[11px] text-slate-500 font-medium">Real-time sync enabled</p>
        </div>
      </div>
    </aside>
  )
}
