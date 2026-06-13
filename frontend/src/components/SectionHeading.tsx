import type { ReactNode } from 'react'

export default function SectionHeading({ children, action }: { children: ReactNode; action?: ReactNode }) {
  return (
    <div className="mb-3 flex items-center justify-between gap-4">
      <h2 className="flex items-center gap-2 text-lg font-semibold text-slate-900">
        <span className="h-5 w-1.5 rounded-full bg-rose-500" />
        {children}
      </h2>
      {action}
    </div>
  )
}
