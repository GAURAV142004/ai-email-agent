'use client'

import { createContext, useContext, useState } from 'react'
import type { ReactNode } from 'react'
import { Sidebar } from './Sidebar'
import { cn } from '@/lib/utils'

interface MobileSidebarCtx {
  isOpen: boolean
  open:   () => void
  close:  () => void
}

const MobileSidebarContext = createContext<MobileSidebarCtx>({
  isOpen: false,
  open:   () => {},
  close:  () => {},
})

export function useMobileSidebar() {
  return useContext(MobileSidebarContext)
}

export function DashboardShell({ children }: { children: ReactNode }) {
  const [isOpen, setIsOpen] = useState(false)
  const open  = () => setIsOpen(true)
  const close = () => setIsOpen(false)

  return (
    <MobileSidebarContext.Provider value={{ isOpen, open, close }}>
      <div className="flex min-h-screen bg-slate-50 dark:bg-[oklch(0.108_0.028_255)]">
        {/* Mobile backdrop */}
        <div
          className={cn(
            'md:hidden fixed inset-0 z-40 bg-black/50 transition-opacity duration-300',
            isOpen ? 'opacity-100 pointer-events-auto' : 'opacity-0 pointer-events-none',
          )}
          onClick={close}
        />
        <Sidebar isMobileOpen={isOpen} onMobileClose={close} />
        <main className="flex-1 min-w-0 overflow-x-hidden">{children}</main>
      </div>
    </MobileSidebarContext.Provider>
  )
}
