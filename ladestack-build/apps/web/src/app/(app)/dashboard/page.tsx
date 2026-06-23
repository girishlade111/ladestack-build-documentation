"use client"

import { useEffect, useState } from "react"
import Link from "next/link"
import { Plus, Folder, ExternalLink, Trash2 } from "lucide-react"
import { fetchProjects, createProject, deleteProject } from "@/lib/api"
import type { Project } from "@/lib/types"

export default function DashboardPage() {
  const [projects, setProjects] = useState<Project[]>([])
  const [loading, setLoading] = useState(true)
  const [showCreate, setShowCreate] = useState(false)
  const [name, setName] = useState("")
  const [description, setDescription] = useState("")

  const loadProjects = async () => {
    setLoading(true)
    try {
      const res = await fetchProjects()
      setProjects(Array.isArray(res) ? res : [])
    } catch {
      setProjects([])
    }
    setLoading(false)
  }

  useEffect(() => { loadProjects() }, [])

  const handleCreate = async () => {
    if (!name.trim()) return
    try {
      await createProject({ name: name.trim(), description: description.trim() })
      setName("")
      setDescription("")
      setShowCreate(false)
      loadProjects()
    } catch {
      alert("Failed to create project")
    }
  }

  const handleDelete = async (id: string) => {
    if (!confirm("Delete this project?")) return
    try {
      await deleteProject(id)
      loadProjects()
    } catch {
      alert("Failed to delete project")
    }
  }

  return (
    <div className="min-h-screen bg-background">
      <nav className="flex items-center justify-between px-6 py-4 border-b border-border/50">
        <div className="flex items-center gap-2">
          <div className="h-7 w-7 rounded-lg bg-brand-gold flex items-center justify-center">
            <span className="text-brand-navy text-xs font-bold">LB</span>
          </div>
          <span className="text-sm font-semibold text-foreground">LadeStack Build</span>
        </div>
        <Link href="/" className="text-xs text-muted-foreground hover:text-foreground transition-colors">
          Home
        </Link>
      </nav>

      <main className="max-w-4xl mx-auto px-6 pt-10 pb-16">
        <div className="flex items-center justify-between mb-8">
          <div>
            <h1 className="text-xl font-bold text-foreground">Projects</h1>
            <p className="text-xs text-muted-foreground mt-1">Manage your AI-built applications</p>
          </div>
          <button
            onClick={() => setShowCreate(!showCreate)}
            className="flex items-center gap-1.5 px-4 py-2 rounded-lg bg-brand-gold text-brand-navy text-sm font-medium hover:bg-brand-gold-light transition-colors"
          >
            <Plus className="h-4 w-4" />
            New Project
          </button>
        </div>

        {showCreate && (
          <div className="mb-6 rounded-lg border border-border/50 bg-surface p-5">
            <h2 className="text-sm font-semibold text-foreground mb-3">Create Project</h2>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Project name"
              className="w-full mb-2 px-3 py-2 rounded-lg border border-border/50 bg-surface-light text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary"
            />
            <input
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Description (optional)"
              className="w-full mb-3 px-3 py-2 rounded-lg border border-border/50 bg-surface-light text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary"
            />
            <div className="flex gap-2">
              <button
                onClick={handleCreate}
                disabled={!name.trim()}
                className="px-4 py-1.5 rounded-lg bg-brand-gold text-brand-navy text-xs font-medium hover:bg-brand-gold-light disabled:opacity-50 transition-colors"
              >
                Create
              </button>
              <button
                onClick={() => setShowCreate(false)}
                className="px-4 py-1.5 rounded-lg border border-border/50 text-xs text-muted-foreground hover:text-foreground transition-colors"
              >
                Cancel
              </button>
            </div>
          </div>
        )}

        {loading ? (
          <div className="text-center py-16 text-xs text-muted-foreground">Loading projects...</div>
        ) : projects.length === 0 ? (
          <div className="text-center py-16">
            <Folder className="h-10 w-10 text-muted-foreground/50 mx-auto mb-3" />
            <h3 className="text-sm font-semibold text-foreground mb-1">No projects yet</h3>
            <p className="text-xs text-muted-foreground mb-4">Create your first project to start building with AI.</p>
            <button
              onClick={() => setShowCreate(true)}
              className="px-4 py-2 rounded-lg bg-brand-gold text-brand-navy text-sm font-medium hover:bg-brand-gold-light transition-colors"
            >
              Create Project
            </button>
          </div>
        ) : (
          <div className="grid gap-3">
            {projects.map((project) => (
              <div
                key={project.id}
                className="flex items-center justify-between rounded-lg border border-border/50 bg-surface p-4 hover:border-border transition-colors"
              >
                <div className="flex items-center gap-3">
                  <div className="h-8 w-8 rounded-md bg-surface-light flex items-center justify-center">
                    <Folder className="h-4 w-4 text-brand-gold" />
                  </div>
                  <div>
                    <h3 className="text-sm font-semibold text-foreground">{project.name}</h3>
                    {project.description && (
                      <p className="text-[11px] text-muted-foreground mt-0.5">{project.description}</p>
                    )}
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <Link
                    href={`/build/${project.id}`}
                    className="flex items-center gap-1 px-3 py-1.5 rounded-lg bg-brand-gold text-brand-navy text-xs font-medium hover:bg-brand-gold-light transition-colors"
                  >
                    Open
                    <ExternalLink className="h-3 w-3" />
                  </Link>
                  <button
                    onClick={() => handleDelete(project.id)}
                    className="p-1.5 rounded-lg text-muted-foreground hover:text-red-400 hover:bg-surface-light transition-colors"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </main>
    </div>
  )
}
