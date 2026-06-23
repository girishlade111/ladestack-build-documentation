import Link from "next/link"

export default function LandingPage() {
  return (
    <div className="min-h-screen bg-background">
      <nav className="flex items-center justify-between px-6 py-4 border-b border-border/50">
        <div className="flex items-center gap-2">
          <div className="h-7 w-7 rounded-lg bg-brand-gold flex items-center justify-center">
            <span className="text-brand-navy text-xs font-bold">LB</span>
          </div>
          <span className="text-sm font-semibold text-foreground">LadeStack Build</span>
        </div>
        <div className="flex items-center gap-3">
          <Link href="/dashboard" className="text-xs text-muted-foreground hover:text-foreground transition-colors px-3 py-1.5">
            Dashboard
          </Link>
          <Link
            href="/build/demo"
            className="text-xs px-4 py-1.5 rounded-lg bg-brand-gold text-brand-navy font-medium hover:bg-brand-gold-light transition-colors"
          >
            Start Building
          </Link>
        </div>
      </nav>

      <main>
        <section className="px-6 pt-24 pb-16 text-center max-w-4xl mx-auto">
          <h1 className="text-4xl md:text-5xl font-bold text-foreground leading-tight">
            Build full-stack apps with{" "}
            <span className="text-brand-gold">AI assistance</span>
          </h1>
          <p className="mt-4 text-base text-muted-foreground max-w-2xl mx-auto leading-relaxed">
            An open-core AI-powered development workspace. Chat with agents, edit code in Monaco,
            preview live changes &mdash; all with your own API key.
          </p>
          <div className="mt-8 flex items-center justify-center gap-4">
            <Link
              href="/build/demo"
              className="px-6 py-2.5 rounded-lg bg-brand-gold text-brand-navy font-medium text-sm hover:bg-brand-gold-light transition-colors"
            >
              Start Building
            </Link>
            <Link
              href="/dashboard"
              className="px-6 py-2.5 rounded-lg border border-border/50 text-foreground text-sm hover:bg-surface-light transition-colors"
            >
              My Projects
            </Link>
          </div>
        </section>

        <section className="px-6 pb-24 max-w-5xl mx-auto">
          <div className="grid md:grid-cols-3 gap-4">
            {[
              { title: "Multi-Agent Loop", description: "Orchestrator, planner, builder, debugger &mdash; agents collaborate to build your app." },
              { title: "Monaco Editor", description: "Full-featured code editor with syntax highlighting, multi-cursor, and language support." },
              { title: "Live Preview", description: "See changes instantly in an integrated iframe preview panel." },
              { title: "BYO API Key", description: "Bring your own Anthropic, OpenAI, or Google API key. No lock-in." },
              { title: "File Explorer", description: "Browse and edit project files directly in the workspace." },
              { title: "Open Core", description: "Free and open-source. Self-host or use our hosted version." },
            ].map((feature) => (
              <div key={feature.title} className="rounded-lg border border-border/50 bg-surface p-5">
                <h3 className="text-sm font-semibold text-foreground mb-1">{feature.title}</h3>
                <p className="text-xs text-muted-foreground leading-relaxed" dangerouslySetInnerHTML={{ __html: feature.description }} />
              </div>
            ))}
          </div>
        </section>
      </main>
    </div>
  )
}
