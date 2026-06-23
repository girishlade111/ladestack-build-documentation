import { cn } from "../lib/utils"
import { useState } from "react"

type AvatarSize = "sm" | "md" | "lg" | "xl"
type StatusVariant = "online" | "offline" | "away" | "busy"

interface AvatarProps {
  src?: string
  alt: string
  size?: AvatarSize
  status?: StatusVariant
  fallback?: string
  className?: string
}

const sizeMap: Record<AvatarSize, { container: string; text: string }> = {
  sm: { container: "h-8 w-8", text: "text-xs" },
  md: { container: "h-10 w-10", text: "text-sm" },
  lg: { container: "h-12 w-12", text: "text-base" },
  xl: { container: "h-16 w-16", text: "text-lg" },
}

const statusColors: Record<StatusVariant, string> = {
  online: "bg-emerald-500",
  offline: "bg-muted-foreground",
  away: "bg-amber-500",
  busy: "bg-destructive",
}

function getInitials(name: string, fallback?: string): string {
  if (fallback) return fallback.slice(0, 2).toUpperCase()
  return name
    .split(" ")
    .map((n) => n[0])
    .filter(Boolean)
    .slice(0, 2)
    .join("")
    .toUpperCase()
}

export function Avatar({ src, alt, size = "md", status, fallback, className }: AvatarProps) {
  const [imgError, setImgError] = useState(false)
  const showInitials = !src || imgError

  return (
    <div className={cn("relative inline-flex shrink-0", className)}>
      <div
        className={cn(
          "relative flex items-center justify-center overflow-hidden rounded-full bg-muted",
          sizeMap[size].container
        )}
      >
        {showInitials ? (
          <span className={cn("font-medium text-muted-foreground", sizeMap[size].text)}>
            {getInitials(alt, fallback)}
          </span>
        ) : (
          <img
            src={src}
            alt={alt}
            className="h-full w-full object-cover"
            onError={() => setImgError(true)}
          />
        )}
      </div>
      {status && (
        <span
          className={cn(
            "absolute bottom-0 right-0 block h-2.5 w-2.5 rounded-full ring-2 ring-background",
            statusColors[status]
          )}
          aria-label={status}
        />
      )}
    </div>
  )
}

export type { AvatarProps, AvatarSize, StatusVariant }
