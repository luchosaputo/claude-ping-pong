# Plan: claude-ping-pong — MCP Server para Review Comments

## Context

El proyecto `claude-review` (Go) permite dejar comentarios sobre archivos Markdown via browser y que Claude los procese. El problema: Claude solo ve comentarios cuando el usuario ejecuta manualmente `/cr-address`. 

`claude-ping-pong` es un **reemplazo independiente** en TypeScript/Bun que:
1. Elimina la activación manual — Claude chequea automáticamente via `/loop`
2. Es un MCP server con tools nativas para Claude
3. Tiene su propio HTTP server, web UI, SSE, y SQLite DB
4. El browser se actualiza en real-time cuando Claude responde

### Por qué NO usar MCP Channels
La propuesta original se basaba en `notifications/claude/channel` — un feature que **no existe** en MCP. MCP es request-response. Los servers no pueden inyectar contenido en la conversación de Claude. La activación se resuelve con `/loop` (un comando al inicio de sesión, después todo es automático).

---

## Arquitectura

```
                    Bun process (single)
┌─────────────────────────────────────────────────┐
│                                                   │
│  ┌─────────────┐         ┌──────────────────┐   │
│  │ MCP Server   │         │ HTTP Server      │   │
│  │ (stdio)      │◄───────►│ (port 4780)      │   │
│  │              │  shared  │                  │   │
│  │ Tools:       │   db     │ REST API         │   │
│  │  - get_pending│  instance│ SSE broadcast   │   │
│  │  - reply     │         │ Static files     │   │
│  │  - resolve   │         └────────┬─────────┘   │
│  │  - get_thread│                  │              │
│  └──────┬───────┘                  │              │
│         │                          │              │
│         ▼                          ▼              │
│  ┌──────────────────────────────────────────┐    │
│  │          SQLite (better-sqlite3)           │    │
│  │   ~/.local/share/claude-ping-pong/db      │    │
│  └──────────────────────────────────────────┘    │
└─────────────────────────────────────────────────┘
       │ stdio                    │ HTTP
       ▼                          ▼
  Claude Code                  Browser
  (via /loop)                  (Web UI)
```

Un solo proceso Bun corre ambos transports. Comparten la instancia de SQLite en memoria (sin file locking issues).

---

## Estructura de archivos

```
claude-ping-pong/
├── package.json
├── tsconfig.json
├── .mcp.json                    # Registro MCP para Claude Code
├── CLAUDE.md
├── src/
│   ├── index.ts                 # Entry point: inicia MCP + HTTP
│   ├── types.ts                 # Interfaces compartidas
│   ├── db.ts                    # SQLite schema + data access
│   ├── mcp-server.ts            # MCP tools + resources + polling
│   ├── http-server.ts           # REST API + static serving
│   └── sse-hub.ts               # SSE client management + broadcast
├── frontend/
│   ├── index.html               # Home: lista de proyectos registrados
│   ├── viewer.html              # Markdown viewer con commenting
│   ├── components/
│   │   ├── App.tsx              # Root component, SSE connection, state
│   │   ├── MarkdownViewer.tsx   # Rendered markdown con line numbers
│   │   ├── CommentPanel.tsx     # Panel lateral: lista de threads
│   │   ├── Thread.tsx           # Thread individual: root + replies
│   │   ├── CommentForm.tsx      # Form para nuevo comment o reply
│   │   └── SelectionPopover.tsx # Botón flotante al seleccionar texto
│   ├── hooks/
│   │   ├── useComments.ts       # Fetch + SSE sync de comments
│   │   └── useTextSelection.ts  # Detección de selección sobre markdown
│   ├── types.ts                 # Tipos compartidos frontend (Comment, Thread, etc.)
│   ├── api.ts                   # Wrapper fetch para REST endpoints
│   ├── styles.css
│   └── dist/                    # Generado por `bun build` (gitignored)
│       └── app.js               # Bundle: Preact + HTM + componentes
└── slash-commands/
    ├── pp-start.md              # Inicia el monitoring loop
    └── pp-review.md             # Abre archivo en browser
```

---

## Implementación por fases

### Fase 1: Foundation
**Archivos**: `package.json`, `tsconfig.json`, `src/types.ts`, `src/db.ts`

**Schema SQLite**:
```sql
CREATE TABLE projects (
  directory TEXT PRIMARY KEY,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE comments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  project_directory TEXT NOT NULL,
  file_path TEXT NOT NULL,
  line_start INTEGER,
  line_end INTEGER,
  selected_text TEXT,
  comment_text TEXT NOT NULL,
  created_at TEXT DEFAULT (datetime('now')),
  resolved_at TEXT,
  root_id INTEGER REFERENCES comments(id) ON DELETE CASCADE,
  author TEXT NOT NULL CHECK(author IN ('user', 'agent')),
  resolved_by TEXT
);

CREATE TABLE settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

-- Default: monitoring activo
INSERT OR IGNORE INTO settings (key, value) VALUES ('monitoring_enabled', 'true');

-- Índices para las queries principales
CREATE INDEX idx_comments_lookup ON comments(project_directory, file_path, resolved_at);
CREATE INDEX idx_comments_thread ON comments(root_id, created_at);
CREATE INDEX idx_comments_pending ON comments(author, resolved_at, id);
```

**Data access** (`db.ts`): Usa `better-sqlite3`. Funciones:
- `initDB()` — crea DB + tablas
- `createComment(comment)` → Comment
- `getComments(projectDir, filePath, resolved)` → Comment[]
- `getPendingUserComments(sinceId?)` → Comment[] — query clave para polling
- `getThread(rootId)` → Comment[]
- `resolveThread(rootId, by)` → count
- `createProject(directory)`

**Dependencias server**: `@modelcontextprotocol/sdk`, `better-sqlite3`, `marked`, `zod`.
**Dependencias frontend**: `preact` (bundleado con `bun build` → `frontend/dist/`). JSX nativo, sin HTM.
**Dev deps**: `@types/better-sqlite3`, `@types/bun`, `typescript`.

> **Nota distribución**: Se usa `better-sqlite3` (no `bun:sqlite`) para compatibilidad Node+Bun. Frontend se bundlea en vez de CDN para funcionar offline/detrás de firewalls.

### Fase 2: HTTP Server + SSE
**Archivos**: `src/http-server.ts`, `src/sse-hub.ts`

**Endpoints**:
| Method | Path | Qué hace |
|--------|------|----------|
| GET | `/` | Home: lista proyectos registrados |
| GET | `/projects/*` | Viewer de Markdown |
| GET | `/api/comments` | Listar comentarios (query: project_directory, file_path) |
| POST | `/api/comments` | Crear comentario |
| PATCH | `/api/comments/:id/resolve` | Resolver thread |
| GET | `/api/events` | SSE stream (query: project_directory, file_path) |
| POST | `/api/projects` | Registrar proyecto |

**SSE Hub**: Clase que mantiene Set<SSEClient>, broadcast por project+file. Usa `ReadableStream` de Bun. Cuando alguien crea/responde/resuelve un comment, se broadcastea a todos los browsers viendo ese archivo.

### Fase 3: Web UI (Preact + TypeScript)
**Archivos**: `frontend/components/*.tsx`, `frontend/hooks/*.ts`, `frontend/types.ts`, `frontend/api.ts`, `frontend/viewer.html`, `frontend/styles.css`

**Stack**: Preact con JSX nativo (no HTM) + TypeScript. `bun build` transpila TSX→JS y bundlea todo en `frontend/dist/app.js`.

```html
<!-- En viewer.html — carga el bundle generado por bun build -->
<script type="module" src="/dist/app.js"></script>
```

**Build**: `bun build frontend/components/App.tsx --outdir frontend/dist --bundle --jsx-factory=h --jsx-fragment=Fragment` genera un solo archivo con Preact incluido. El server sirve `frontend/dist/` como estáticos.

**Componentes**:
- `App.tsx` — Root: inicializa SSE connection, mantiene state global de comments, pasa props a hijos
- `MarkdownViewer.tsx` — Renderiza HTML del markdown (generado server-side con `marked`), cada línea en `<div data-source-line="N">`. Detecta selección de texto
- `SelectionPopover.tsx` — Botón flotante "Comment" que aparece al seleccionar texto. Calcula posición desde Selection API
- `CommentPanel.tsx` — Panel lateral derecho: lista threads agrupados por archivo/línea
- `Thread.tsx` — Thread individual: comment raíz + replies con labels (user/agent), reply form inline
- `CommentForm.tsx` — Form reutilizable para nuevo comment o reply

**Hooks custom**:
- `useComments(projectDir, filePath)` — Fetch inicial + escucha SSE events → actualiza state automáticamente
- `useTextSelection()` — Detecta selección sobre el markdown, extrae line_start/line_end y selected_text

**Estado**: Se maneja con `useState`/`useReducer` en App.tsx. Los SSE events triggerean re-fetch desde la API, lo que causa re-render automático de los componentes afectados. No se necesita state management externo (Redux, signals, etc.) porque el estado es simple: lista de threads + selected text.

### Fase 4: MCP Server
**Archivos**: `src/mcp-server.ts`, `src/index.ts`

**Tools**:
1. `get_pending_comments` — Threads no resueltos donde el último mensaje es de "user". Input opcional: project_directory, file_path. **Chequea monitoring_enabled antes de consultar** — si está off, devuelve `{ monitoring: false, message: "Monitoring is paused" }`
2. `reply` — Responder a un thread. Input: comment_id, message. Crea comment con author='agent', triggerea SSE broadcast
3. `resolve` — Resolver thread. Input: comment_id. Sets resolved_at, triggerea SSE
4. `get_thread` — Thread completo. Input: comment_id
5. `list_files_with_comments` — Archivos con comments pendientes
6. `set_monitoring` — Activa/desactiva el polling. Input: `enabled: boolean`. Guarda estado en tabla `settings` de SQLite. Cuando `enabled=false`, `get_pending_comments` devuelve no-op

**Resource**: `pingpong://pending-comments` — summary de comments pendientes. Server envía `notifications/resources/updated` cuando cambian.

**Polling loop**: Cada 10s chequea nuevos comments con ID > lastSeenId. Si hay nuevos, envía resource updated notification.

**Entry point** (`index.ts`):
- Redirige `console.log` a `console.error` (stdout es exclusivo de MCP)
- Inicia HTTP server (Bun.serve, non-blocking)
- Inicia MCP server (StdioServerTransport, event loop)
- Comparten instancia de DB

### Fase 5: Integración
**Archivos**: `.mcp.json`, `slash-commands/ping-pong.md`, `slash-commands/pp-review.md`, `CLAUDE.md`

**`.mcp.json`**:
```json
{
  "mcpServers": {
    "claude-ping-pong": {
      "command": "bun",
      "args": ["run", "src/index.ts"],
      "env": { "PP_PORT": "4780" }
    }
  }
}
```

**`/ping-pong`**: Slash command que Claude usa con `/loop 15s /ping-pong`.
- `/ping-pong` (arg: filename)  — Chequea `get_pending_comments` con el path al archivo elegido por el usuario. Si hay threads pendientes: lee archivo, actúa, responde.

Instructions para Claude al procesar comments:
1. Llame `get_pending_comments`
2. Si hay threads pendientes, lea el archivo referenciado
3. Haga el cambio o responda pidiendo clarificación
4. Nunca resuelva threads sin que el usuario lo pida

---

## Decisiones técnicas clave

| Decisión | Por qué |
|----------|---------|
| Un solo proceso Bun | Evita SQLite concurrent write issues entre procesos |
| `better-sqlite3` (no `bun:sqlite`) | Compatible Node+Bun, distribuible via npm |
| Frontend bundleado (no CDN) | Funciona offline, detrás de firewalls, distribuible |
| stdout solo para MCP | Cualquier `console.log` rompería el protocol JSON-RPC |
| `/loop` para activación | Única forma realista de auto-polling. MCP no puede hacer push |
| Port 4780 (no 4779) | Evita conflicto con claude-review si ambos corren |
| DB separada en `~/.local/share/claude-ping-pong/` | Independencia total de claude-review |

---

## Verificación

1. **DB**: Crear proyecto, crear comment, verificar que se lee correctamente
2. **HTTP**: `curl POST /api/comments`, verificar response + que SSE recibe evento
3. **MCP**: Registrar en `.mcp.json`, verificar que Claude ve las tools con `/tools`
4. **E2E**: Crear comment en browser → `/loop` activo → Claude llama `get_pending_comments` → Claude llama `reply` → browser muestra respuesta via SSE
5. **SSE**: Abrir viewer en 2 tabs, crear comment en una, verificar que aparece en la otra

---

## Distribución (npm)

Preparado desde el día 1 para publicar como paquete npm:

**`package.json`** (campos clave):
```json
{
  "name": "claude-ping-pong",
  "bin": { "claude-ping-pong": "./src/index.ts" },
  "files": ["src/", "frontend/", "slash-commands/"],
  "scripts": {
    "build": "bun build frontend/components/App.tsx --outdir frontend/dist --bundle",
    "prepublishOnly": "bun run build"
  }
}
```

**Experiencia del usuario final**:
```bash
npm install -g claude-ping-pong
claude-ping-pong install   # Escribe .mcp.json + symlinkea slash commands
# Listo — Claude Code ve las tools
```

**`.mcp.json` generado por `install`**:
```json
{
  "mcpServers": {
    "claude-ping-pong": {
      "command": "claude-ping-pong",
      "args": ["serve"]
    }
  }
}
```

El comando `install` se implementa en Fase 5 como parte de la integración.

---

## Riesgos y mitigaciones

| Riesgo | Mitigación |
|--------|-----------|
| stdout contaminado rompe MCP | Override `console.log` → stderr en index.ts |
| Puerto en uso | Try 4780, fallback 4781-4789, log a stderr |
| `/loop` no está disponible | Documentar alternativa manual: ejecutar `/pp-start` periódicamente |
| Markdown rendering difiere de claude-review | Aceptable — proyecto independiente |

---

## Crítica de la propuesta original (spec.md)

### Problemas fatales
1. **`notifications/claude/channel` no existe** — Feature inventado. MCP es request-response
2. **Dos procesos escribiendo SQLite** — Go + Bun sin WAL mode = `SQLITE_BUSY`
3. **SSE roto** — MCP server escribe a DB pero nunca notifica al Go server → browser no se entera
4. **No resuelve el problema** — Sin channels, el usuario sigue necesitando activar manualmente

### Problemas serios
5. Polling con `lastSeenId` sin persistencia — se pierde en restart
6. Zero error handling en tools y polling
7. TypeScript con `any` everywhere — no type safety
8. Duplicación de responsabilidades entre Go server y Bun server
