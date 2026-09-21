import * as React from "react"

import { cn } from "@/lib/utils"

const Input = React.forwardRef<HTMLInputElement, React.ComponentProps<"input">>(
  ({ className, type, ...props }, ref) => {
    return (
      <input
        type={type}
        className={cn(
          "flex h-11 w-full rounded-xl border border-[color:var(--border-strong)] bg-[color:var(--field-bg)] px-3.5 py-2 text-base text-[color:var(--text-primary)] shadow-sm ring-offset-[color:var(--field-bg)] transition-[border-color,box-shadow,background-color] placeholder:text-[color:var(--text-placeholder)] hover:border-[color:var(--border-strong)] focus-visible:border-primary/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/30 focus-visible:ring-offset-0 disabled:cursor-not-allowed disabled:opacity-50 md:text-sm",
          className
        )}
        ref={ref}
        {...props}
      />
    )
  }
)
Input.displayName = "Input"

export { Input }
