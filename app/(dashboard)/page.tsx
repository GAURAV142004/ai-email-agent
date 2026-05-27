'use client'

import { useEffect } from 'react'
import { useRouter } from 'next/navigation'

export default function DashboardPage() {
  const router = useRouter()

  useEffect(() => {
    router.replace('/agent')
  }, [router])

  return (
    <div className="flex items-center justify-center min-h-screen bg-slate-50 dark:bg-[oklch(0.108_0.028_255)]">
      <div className="w-8 h-8 border-2 border-blue-500 border-t-transparent rounded-full animate-spin" />
    </div>
  )
}
