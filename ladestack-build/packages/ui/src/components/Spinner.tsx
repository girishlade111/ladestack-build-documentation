import { cn } from "../lib/utils"

interface SpinnerProps {
  size?: "sm" | "md" | "lg"
  label?: string
  className?: string
}

const sizeMap = {
  sm: "h-4 w-4 border-2",
  md: "h-6 w-6 border-2",
  lg: "h-10 w-10 border-3",
}

export function Spinner({ size = "md", label, className }: SpinnerProps) {
  return (
    <div role="status" className={cn("inline-flex items-center gap-3", className)}>
      <svg
        className={cn("animate-spin text-foreground/30", sizeMap[size])}
        xmlns="http://www.w3.org/2000/svg"
        fill="none"
        viewBox="0 0 24 24"
      >
        <circle
          className="opacity-25"
          cx="12"
          cy="12"
          r="10"
          stroke="currentColor"
          strokeWidth="4"
        />
        <path
          className="opacity-75"
          fill="currentColor"
          d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"
        />
      </svg>
      {label && (
        <span className="text-sm text-muted-foreground">{label}</span>
      )}
    </div>
  )
}
