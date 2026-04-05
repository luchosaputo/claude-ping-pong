import Viewer from './Viewer.js'

const match = /^\/view\/([^/]+)/.exec(window.location.pathname)

export default function App() {
  if (match) return <Viewer fileId={match[1]} />
  return <div style={{ padding: '48px 24px', fontFamily: 'sans-serif', color: 'var(--muted)' }}>Not found</div>
}
