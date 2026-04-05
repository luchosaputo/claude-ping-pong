import { useEffect, useState } from 'react'
import ReactMarkdown from 'react-markdown'
import { remarkLineData } from './markdown.js'

interface Props {
  fileId: string
}

type State =
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'ready'; content: string }

export default function Viewer({ fileId }: Props) {
  const [state, setState] = useState<State>({ status: 'loading' })

  useEffect(() => {
    fetch(`/api/files/${fileId}/content`)
      .then((res) => {
        if (!res.ok) return res.json().then((b) => Promise.reject(b.error ?? res.statusText))
        return res.text()
      })
      .then((content) => setState({ status: 'ready', content }))
      .catch((err) => setState({ status: 'error', message: String(err) }))
  }, [fileId])

  if (state.status === 'loading') return <div style={styles.message}>Loading…</div>
  if (state.status === 'error') return <div style={styles.message}>Error: {state.message}</div>

  return (
    <div style={styles.layout}>
      <article style={styles.document}>
        <ReactMarkdown remarkPlugins={[remarkLineData]}>
          {state.content}
        </ReactMarkdown>
      </article>
      <aside style={styles.sidebar} />
    </div>
  )
}

const styles = {
  layout: {
    display: 'flex',
    alignItems: 'flex-start',
    minHeight: '100vh',
    padding: '48px 24px',
    boxSizing: 'border-box' as const,
    gap: '24px',
  },
  document: {
    flex: '0 1 720px',
    minWidth: 0,
    fontFamily: 'Georgia, serif',
    fontSize: '16px',
    lineHeight: '1.7',
    color: '#1a1a1a',
  },
  sidebar: {
    flex: '0 0 320px',
  },
  message: {
    padding: '48px 24px',
    color: '#666',
    fontFamily: 'sans-serif',
  },
} as const
