export function LoomLogo({ size = 48, className = '', variant = 'dark' }: { size?: number; className?: string; variant?: 'dark' | 'light' }) {
  const ink = variant === 'dark' ? 'var(--color-ink)' : '#FFFFFF';
  
  return (
    <div className={`loom-logo ${className}`} style={{ display: 'flex', alignItems: 'center', gap: size * 0.3 }}>
      <svg width={size} height={size} viewBox="0 0 48 48" fill="none" xmlns="http://www.w3.org/2000/svg">
        <rect x="1.5" y="1.5" width="45" height="45" rx="11" stroke={ink} strokeWidth="2.5" />
        <path d="M13 13V35M23 13V35M33 13V35" stroke={ink} strokeWidth="2.5" strokeLinecap="round" />
        <path d="M13 19C23 19 23 29 33 29" stroke="var(--color-brand)" strokeWidth="3" strokeLinecap="round" />
        <circle cx="13" cy="19" r="3.2" fill="var(--color-brand)" />
        <circle cx="33" cy="29" r="3.2" fill="var(--color-brand)" />
      </svg>
      <span style={{
        fontFamily: 'var(--font-heading)',
        fontWeight: 800,
        fontSize: size * 0.65,
        letterSpacing: '-0.03em',
        lineHeight: 1,
        color: ink,
      }}>
        loom<span style={{ color: 'var(--color-brand)' }}>JS</span>
      </span>
    </div>
  )
}
