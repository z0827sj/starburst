const NAV_ITEMS = [
  { label: 'Dashboard', path: 'dashboard' },
  { label: 'History', path: 'history' },
  { label: 'Rankings', path: 'rankings' },
] as const

export default function Navbar({ active, navigate, children }: { active: string; navigate: (p: string) => void; children?: React.ReactNode }) {
  return (
    <div style={{
      display: 'flex', alignItems: 'center', justifyContent: 'space-between',
      paddingBottom: 20, borderBottom: '1px solid var(--border)', marginBottom: 24,
      position: 'sticky', top: 0, zIndex: 40, background: 'var(--bg-secondary)',
      paddingTop: 16, marginTop: -16,
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
        <div className="logo" style={{ cursor: 'pointer' }} onClick={() => navigate('dashboard')}>
          <div className="logo-icon">✦</div>
          <span className="logo-text">Star<span className="logo-accent">Burst</span></span>
        </div>
        <div className="nav-tabs" style={{ display: 'flex', gap: 4 }}>
          {NAV_ITEMS.map(item => (
            <button
              key={item.path}
              className={`nav-tab${active === item.path ? ' active' : ''}`}
              onClick={() => navigate(item.path)}
            >{item.label}</button>
          ))}
        </div>
      </div>
      {children}
    </div>
  )
}
