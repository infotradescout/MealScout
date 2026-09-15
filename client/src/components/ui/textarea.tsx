import * as React from "react"

import { cn } from "@/lib/utils"

const Textarea = React.forwardRef<
  HTMLTextAreaElement,
  React.ComponentProps<"textarea">
>(({ className, ...props }, ref) => {
  return (
    <textarea
      className={cn(
        "flex min-h-[112px] w-full rounded-xl border border-[color:var(--border-strong)] bg-[color:var(--field-bg)] px-3.5 py-3 text-base leading-6 text-[color:var(--text-primary)] shadow-sm ring-offset-[color:var(--field-bg)] transition-[border-color,box-shadow,background-color] placeholder:text-[color:var(--text-placeholder)] focus-visible:border-primary/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/30 focus-visible:ring-offset-0 disabled:cursor-not-allowed disabled:opacity-50 md:text-sm",
        className
      )}
      ref={ref}
      {...props}
    />
  )
})
Textarea.displayName = "Textarea"

export { Textarea }
