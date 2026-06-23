import { forwardRef, useRef, useEffect, type TextareaHTMLAttributes } from "react"
import { cn } from "../lib/utils"

interface TextareaProps extends TextareaHTMLAttributes<HTMLTextAreaElement> {
  label?: string
  error?: string
  autoResize?: boolean
  maxLength?: number
  showCharCount?: boolean
}

const Textarea = forwardRef<HTMLTextAreaElement, TextareaProps>(
  ({ className, label, error, autoResize, maxLength, showCharCount, id, disabled, value, onChange, ...props }, ref) => {
    const textareaId = id || (label ? label.toLowerCase().replace(/\s+/g, "-") : undefined)
    const internalRef = useRef<HTMLTextAreaElement | null>(null)

    const resolvedRef = ref || internalRef

    const resize = () => {
      const el = typeof resolvedRef === "function" ? null : resolvedRef?.current
      if (!el || !autoResize) return
      el.style.height = "auto"
      el.style.height = `${el.scrollHeight}px`
    }

    useEffect(() => {
      if (autoResize) resize()
    }, [value, autoResize])

    const charCount = typeof value === "string" ? value.length : 0

    return (
      <div className="flex flex-col gap-1.5">
        {label && (
          <label
            htmlFor={textareaId}
            className={cn(
              "text-sm font-medium",
              disabled && "opacity-50",
              error && "text-destructive"
            )}
          >
            {label}
          </label>
        )}
        <textarea
          ref={resolvedRef as React.Ref<HTMLTextAreaElement>}
          id={textareaId}
          disabled={disabled}
          onChange={(e) => {
            onChange?.(e)
            if (autoResize) setTimeout(resize, 0)
          }}
          maxLength={maxLength}
          className={cn(
            "flex min-h-[80px] w-full rounded-lg border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 resize-y",
            autoResize && "resize-none overflow-hidden",
            error && "border-destructive focus-visible:ring-destructive",
            className
          )}
          aria-invalid={!!error}
          aria-describedby={error ? `${textareaId}-error` : undefined}
          {...props}
        />
        <div className="flex items-center justify-between">
          {error && (
            <p id={`${textareaId}-error`} className="text-xs text-destructive" role="alert">
              {error}
            </p>
          )}
          {showCharCount && maxLength && (
            <span
              className={cn(
                "ml-auto text-xs text-muted-foreground",
                charCount >= maxLength && "text-destructive"
              )}
            >
              {charCount}/{maxLength}
            </span>
          )}
        </div>
      </div>
    )
  }
)
Textarea.displayName = "Textarea"

export { Textarea }
export type { TextareaProps }
