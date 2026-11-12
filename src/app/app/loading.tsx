export default function WorkspaceLoading() {
  return <main className="app-content" role="status" aria-live="polite" aria-busy="true" aria-label="Loading workspace"><span className="sr-only">Loading your workspace…</span>
    <div className="skeleton" style={{ width: 170, height: 11, marginBottom: 13 }} />
    <div className="skeleton" style={{ width: 300, height: 38, marginBottom: 24 }} />
    <div className="app-grid">{Array.from({ length: 8 }, (_, index) => <div className="app-card" key={index} style={{ minHeight: 120 }}><div className="skeleton" style={{ width: "55%", height: 11 }} /><div className="skeleton" style={{ width: "32%", height: 28, marginTop: 21 }} /></div>)}</div>
  </main>;
}
