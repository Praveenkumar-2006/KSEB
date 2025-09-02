import KseblDashboard from "@/components/ksebl-dashboard"

export default function Page() {
  return (
    <main className="min-h-dvh bg-neutral-950 text-neutral-100">
      <header className="border-b border-neutral-800">
        <div className="mx-auto max-w-6xl px-4 py-4 flex items-center justify-between">
          <h1 className="text-balance text-xl md:text-2xl font-bold">KSEBL LT Line Monitoring</h1>
          <span className="text-xs md:text-sm text-neutral-400">Demo Prototype</span>
        </div>
      </header>

      <KseblDashboard />

      <footer className="border-t border-neutral-800">
        <div className="mx-auto max-w-6xl px-4 py-4 text-xs text-neutral-500">
          This is a demo for visualization only. Data shown is mock and not real-time utility data.
        </div>
      </footer>
    </main>
  )
}
