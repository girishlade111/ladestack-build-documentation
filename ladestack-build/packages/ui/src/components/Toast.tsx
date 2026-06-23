import { useState, useEffect, useCallback, type ReactNode } from "react"
import { cn } from "../lib/utils"
import { X, AlertCircle, CheckCircle2, AlertTriangle, Info } from "lucide-react"

type ToastType = "success" | "error" | "warning" | "info"

interface ToastProps {
  type?: ToastType
  title: string
  description?: string
  duration?: number
  onClose?: () => void
  className?: string
}

const typeStyles: Record<ToastType, { container: string; icon: ReactNode }> = {
  success: {
    container: "border-emerald-200 bg-emerald-50 dark:bg-emerald-950 dark:border-emerald-800",
    icon: <CheckCircle2 className="h-5 w-5 text-emerald-600 dark:text-emerald-400" />,
  },
  error: {
    container: "border-red-200 bg-red-50 dark:bg-red-950 dark:border-red-800",
    icon: <AlertCircle className="h-5 w-5 text-red-600 dark:text-red-400" />,
  },
  warning: {
    container: "border-amber-200 bg-amber-50 dark:bg-amber-950 dark:border-amber-800",
    icon: <AlertTriangle className="h-5 w-5 text-amber-600 dark:text-amber-400" />,
  },
  info: {
    container: "border-blue-200 bg-blue-50 dark:bg-blue-950 dark:border-blue-800",
    icon: <Info className="h-5 w-5 text-blue-600 dark:text-blue-400" />,
  },
}

export function Toast({
  type = "info",
  title,
  description,
  duration = 5000,
  onClose,
  className,
}: ToastProps) {
  const [visible, setVisible] = useState(false)

  useEffect(() => {
    const showTimer = requestAnimationFrame(() => setVisible(true))
    return () => cancelAnimationFrame(showTimer)
  }, [])

  useEffect(() => {
    if (duration <= 0) return
    const timer = setTimeout(() => {
      setVisible(false)
      setTimeout(() => onClose?.(), 300)
    }, duration)
    return () => clearTimeout(timer)
  }, [duration, onClose])

  const handleClose = useCallback(() => {
    setVisible(false)
    setTimeout(() => onClose?.(), 300)
  }, [onClose])

  const { container, icon } = typeStyles[type]

  return (
    <div
      role="alert"
      className={cn(
        "pointer-events-auto flex w-full max-w-sm items-start gap-3 rounded-lg border p-4 shadow-lg transition-all duration-300",
        visible
          ? "translate-x-0 opacity-100"
          : "translate-x-full opacity-0",
        container,
        className
      )}
    >
      <span className="shrink-0 mt-0.5">{icon}</span>
      <div className="flex-1 min-w-0">
        <p className="text-sm font-semibold text-foreground">{title}</p>
        {description && (
          <p className="mt-0.5 text-sm text-muted-foreground">{description}</p>
        )}
      </div>
      <button
        onClick={handleClose}
        className="shrink-0 rounded-md p-1 text-muted-foreground hover:text-foreground hover:bg-black/5 dark:hover:bg-white/10 transition-colors"
        aria-label="Close"
      >
        <X className="h-4 w-4" />
      </button>
    </div>
  )
}

export type { ToastProps, ToastType }
