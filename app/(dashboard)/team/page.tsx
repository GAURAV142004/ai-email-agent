'use client'
export default function RetiredPage() {
  return (
    <div className="flex flex-col items-center justify-center min-h-[60vh] gap-4 text-center">
      <h2 className="text-xl font-semibold text-muted-foreground">Feature Updated</h2>
      <p className="text-sm text-muted-foreground max-w-sm">
        This view has been replaced by the new Knowledge Base Agent. Use the <strong>Agent</strong> page to query project activity, tasks, and team status.
      </p>
    </div>
  )
}
