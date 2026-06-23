"use client"

import { useState } from "react"
import { Settings, X, Eye, EyeOff } from "lucide-react"
import { useStore } from "@/lib/store"
import type { Provider } from "@/lib/types"

const PROVIDERS: { value: Provider; label: string }[] = [
  { value: "openai", label: "OpenAI" },
  { value: "anthropic", label: "Anthropic" },
  { value: "google", label: "Google Gemini" },
  { value: "openrouter", label: "OpenRouter" },
  { value: "custom", label: "Custom" },
]

const MODEL_PLACEHOLDERS: Record<Provider, string> = {
  openai: "gpt-4o",
  anthropic: "claude-sonnet-4-20250514",
  google: "gemini-2.5-pro",
  openrouter: "openai/gpt-4o",
  custom: "my-model-name",
}

export function SettingsTrigger() {
  const [open, setOpen] = useState(false)
  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className="p-1.5 rounded hover:bg-surface-lighter text-muted-foreground hover:text-foreground transition-colors"
        title="Settings"
      >
        <Settings className="h-3.5 w-3.5" />
      </button>
      {open && <SettingsDialog onClose={() => setOpen(false)} />}
    </>
  )
}

interface SettingsDialogProps {
  onClose: () => void
}

export function SettingsDialog({ onClose }: SettingsDialogProps) {
  const { provider, setProvider, model, setModel, apiKey, setApiKey } = useStore()
  const [showKey, setShowKey] = useState(false)
  const [saved, setSaved] = useState(false)

  const handleSave = () => {
    localStorage.setItem("lstk-provider", provider)
    localStorage.setItem("lstk-model", model)
    if (apiKey) localStorage.setItem("lstk-api-key", apiKey)
    setSaved(true)
    setTimeout(() => { setSaved(false); onClose() }, 800)
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60" onClick={onClose}>
      <div className="w-full max-w-sm rounded-xl border border-border/50 bg-surface p-5 shadow-xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-sm font-semibold text-foreground">Settings</h2>
          <button onClick={onClose} className="p-1 rounded hover:bg-surface-lighter text-muted-foreground hover:text-foreground transition-colors">
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="space-y-3">
          <div>
            <label className="text-[11px] font-medium text-muted-foreground mb-1.5 block">Provider</label>
            <select
              value={provider}
              onChange={(e) => { const p = e.target.value as Provider; setProvider(p); setModel("") }}
              className="w-full px-3 py-2 rounded-lg border border-border/50 bg-surface-light text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
            >
              {PROVIDERS.map((p) => (
                <option key={p.value} value={p.value}>{p.label}</option>
              ))}
            </select>
          </div>

          <div>
            <label className="text-[11px] font-medium text-muted-foreground mb-1.5 block">Model</label>
            <input
              value={model}
              onChange={(e) => setModel(e.target.value)}
              placeholder={MODEL_PLACEHOLDERS[provider]}
              className="w-full px-3 py-2 rounded-lg border border-border/50 bg-surface-light text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary"
            />
          </div>

          <div>
            <label className="text-[11px] font-medium text-muted-foreground mb-1.5 block">API Key</label>
            <div className="relative">
              <input
                type={showKey ? "text" : "password"}
                value={apiKey}
                onChange={(e) => setApiKey(e.target.value)}
                placeholder="sk-..."
                className="w-full px-3 py-2 pr-8 rounded-lg border border-border/50 bg-surface-light text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary"
              />
              <button
                onClick={() => setShowKey(!showKey)}
                className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
              >
                {showKey ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
              </button>
            </div>
          </div>

          <div className="pt-2">
            <button
              onClick={handleSave}
              className="w-full px-4 py-2 rounded-lg bg-brand-gold text-brand-navy text-sm font-medium hover:bg-brand-gold-light transition-colors"
            >
              {saved ? "Saved!" : "Save"}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
