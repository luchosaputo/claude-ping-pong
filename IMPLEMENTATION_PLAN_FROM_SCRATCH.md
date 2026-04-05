# Plan de Implementacion Desde Cero

Este plan asume que queremos construir `claude-ping-pong` desde cero como una aplicacion local para revisar documentos Markdown en el navegador, comentar inline y devolver esos comentarios a la sesion del agente. La estrategia es construir el sistema en incrementos muy chicos, siempre manteniendo una version ejecutable y verificable.

## Stack

- **Servidor**: Hono + Node.js (TypeScript)
- **Frontend**: Vite SPA (TypeScript)
- **Base de datos**: SQLite via `better-sqlite3` en `~/.claude-ping-pong/db.sqlite`
- **File watching**: chokidar
- **Tiempo real**: SSE (Server-Sent Events)
- **IDs**: nanoid
- **Distribucion**: `npm install -g claude-ping-pong`

## Scope

**In:**
- Servicio web local
- Vista de documentos Markdown
- Comentarios inline con hilos
- Modo revisión (draft batch, frontend-only, estilo GitLab)
- Visualizacion estilo Google Docs (highlight + tarjetas flotantes)
- Persistencia local en SQLite global
- Sincronizacion por cambios de archivo (chokidar) y comentarios (SSE)
- Comandos CLI de integracion con la sesion del agente
- Polling automatico via `/loop` 30s con flag `acknowledged`

**Out:**
- Multiusuario remoto
- Autenticacion
- Permisos complejos
- Edicion del documento desde el navegador
- Reacciones con emoji
- Persistencia de revisiones en base de datos
- Soporte para formatos que no sean Markdown

## Schema SQLite

```sql
files
  id            TEXT PRIMARY KEY   -- nanoid, asignado en open
  path          TEXT NOT NULL      -- ruta absoluta en disco
  registered_at INTEGER

threads
  id                TEXT PRIMARY KEY
  file_id           TEXT REFERENCES files(id)
  status            TEXT DEFAULT 'open'   -- open | resolved
  acknowledged      INTEGER DEFAULT 0     -- 0 | 1, para el sistema de polling
  selected_text     TEXT
  prefix_context    TEXT
  suffix_context    TEXT
  line_range_start  INTEGER
  line_range_end    INTEGER
  created_at        INTEGER

messages
  id          TEXT PRIMARY KEY
  thread_id   TEXT REFERENCES threads(id)
  author      TEXT    -- 'user' | 'agent'
  body        TEXT
  created_at  INTEGER
```

## CLI Commands

```bash
claude-ping-pong open <file>               # registra archivo → URL + file-id
claude-ping-pong comments <file-id>        # hilos pendientes (JSON) + auto-acknowledge
claude-ping-pong reply <thread-id> "text"  # agente responde un hilo
claude-ping-pong resolve <thread-id>       # cierra un hilo
```

`comments`, `reply` y `resolve` operan directamente sobre SQLite sin necesitar el servidor web.

## Principios del plan

- Cada etapa debe dejar el sistema en un estado utilizable.
- Cada etapa debe tener una verificacion concreta y corta.
- No avanzar a la siguiente etapa si la verificacion de la anterior falla.
- Evitar fases grandes; priorizar vertical slices pequenas.
- Al finalizar cada etapa validar:
  - Tests (tienen que pasar todos si los hay)
  - Typescript types (correr tsc --noEmit)
- Una vez validada la etapa satsifactoriamente commitear
  

## Orden de implementacion recomendado

1. Base tecnica ejecutable.
2. Apertura y visualizacion de documentos.
3. Comentarios inline basicos.
4. Hilos y resolucion.
5. Integracion con la sesion del agente.
6. Sincronizacion en tiempo real.
7. Modo revision.
8. Polling para el agente.
9. Navegacion, calidad y cierre.

---

## Bloque A: Base tecnica

### Etapa 1: Crear el proyecto base

[X] Inicializar proyecto con `pnpm` y `git`. Estructura:
```
src/server/   src/client/   src/cli/
dist/server/  dist/client/  dist/cli.js
```
Scripts: `dev`, `build`, `start`. El `bin` de `package.json` apunta a `dist/cli.js`.

Verificacion:
- `pnpm install` sin errores.
- `pnpm build` compila server (tsc) y client (vite build) sin errores.
- `pnpm dev` arranca el servidor.

### Etapa 2: Levantar una pagina minima

[X] Agregar una ruta raiz en Hono que sirva el `index.html` de Vite.

Verificacion:
- Abrir la URL local en el navegador.
- Confirmar HTTP 200.
- Sin errores en consola del navegador ni en logs del servidor.

### Etapa 3: Definir configuracion local y puertos

[X] Puerto configurable via `CLAUDE_REVIEW_PORT` con default fijo. Directorio de datos `~/.claude-ping-pong/`.

Verificacion:
- Arrancar con valores por defecto.
- Arrancar cambiando el puerto por variable de entorno.
- Ambas ejecuciones levantan correctamente.

### Etapa 4: Crear almacenamiento SQLite minimo

[X] Crear `~/.claude-ping-pong/db.sqlite` al arrancar. Crear las tres tablas del schema (`files`, `threads`, `messages`).

Verificacion:
- Arrancar con DB vacia.
- Reiniciar la aplicacion.
- DB se recrea sin corrupcion ni errores.

---

## Bloque B: Proyectos y apertura de archivos

### Etapa 5: Implementar `claude-ping-pong open`

[X] El comando hace un health check a `localhost:PORT/health`. Si no responde, arranca el servidor como proceso background (PID a `~/.claude-ping-pong/server.pid`), espera a que levante, y procede.

Luego registra el archivo en `files` con un nanoid como ID y devuelve:
```json
{ "fileId": "abc123", "url": "http://localhost:PORT/view/abc123" }
```

Verificacion:
- Ejecutar `open` con archivo valido → recibir URL + fileId.
- Ejecutar `open` de nuevo sobre el mismo archivo → mismo fileId, no duplica registro.
- Ejecutar con archivo inexistente → error controlado.

### Etapa 6: Servir el contenido de un archivo registrado

[X] Ruta `GET /api/files/:fileId/content` que lee el archivo del disco y devuelve el Markdown crudo.

Verificacion:
- Llamar a la ruta con fileId valido → contenido del archivo.
- Llamar con fileId invalido → 404 controlado.

### Etapa 7: Renderizar Markdown como HTML con metadatos de bloque

[X] Transformar el Markdown en HTML usando `marked` o `markdown-it` con un renderer personalizado que agregue `data-line-start` y `data-line-end` en cada bloque (parrafos, titulos, listas, code blocks).

Verificacion:
- Inspeccionar el HTML generado y confirmar que los bloques tienen los atributos `data-line-*`.
- Abrir un documento de varias secciones y confirmar que aparecen en multiples bloques.
- `pnpm build` sigue pasando.

### Etapa 8: Construir la pagina viewer

[X] Pagina de viewer en el frontend con layout base: area de documento (con margen derecho para las tarjetas de comentarios) y estructura fija.

Verificacion:
- Abrir el viewer de un archivo.
- Layout visible con area de contenido y margen derecho.
- Recargar mantiene el documento visible.

---

## Bloque C: Comentarios inline basicos

### Etapa 9: Detectar seleccion de texto dentro del documento

[X] Escuchar `mouseup` en el area del documento. Verificar que la seleccion este contenida dentro de un unico bloque con `data-line-*`. Si la seleccion cruza bloques, mostrar tooltip: "Los comentarios deben estar dentro de un mismo parrafo."

Verificacion:
- Seleccionar texto dentro de un bloque → seleccion detectada.
- Seleccionar texto cruzando bloques → tooltip de restriccion.
- Seleccionar fuera del documento → sin interaccion.

### Etapa 10: Mostrar boton de "Agregar comentario"

[X] Cuando hay seleccion valida de bloque unico, mostrar un boton/affordance visual cerca de la seleccion.

Verificacion:
- Seleccionar texto valido → boton aparece.
- Limpiar seleccion → boton desaparece.
- No aparece sobre zonas no comentables.

### Etapa 11: Popup para capturar el comentario

[X] Popup con textarea y acciones de guardar/cancelar. Al guardar, extraer:
- `selectedText`: texto seleccionado
- `prefixContext`: ~50 chars antes de la seleccion dentro del bloque
- `suffixContext`: ~50 chars despues de la seleccion dentro del bloque
- `lineRangeStart` / `lineRangeEnd`: del atributo `data-line-*` del bloque padre

Verificacion:
- Abrir popup, cerrar sin guardar → sin efectos.
- Reabrir popup → flujo funciona.
- Los datos extraidos son correctos al inspeccionar.

### Etapa 12: Endpoint para crear un comentario (hilo raiz)

[X] `POST /api/threads` que valida el payload y crea una fila en `threads` + el primer mensaje en `messages` con `author: 'user'`.

Verificacion:
- POST valido → hilo creado, respuesta con thread-id.
- POST invalido (sin selectedText, etc.) → error de validacion claro.
- El hilo persiste luego de reiniciar la aplicacion.

### Etapa 13: Conectar el popup con el backend

[X] Guardar desde la interfaz llama al endpoint real. Confirmar persistencia.

Verificacion:
- Crear comentario desde el navegador.
- Backend persiste el hilo.
- Recargar la pagina → comentario sigue presente.

### Etapa 13.1: Cargar comentarios del backend

[ ] Endpoint `GET /api/threads?fileId=...` que devuelve todos los hilos para un archivo.

Renderizar las tarjetas de comentarios en el panel lateral.

Verificacion:
- Llamar al endpoint con fileId valido → devuelve hilos.
- Llamar con fileId invalido → 404 controlado.
- Recargar la pagina → comentarios aparecen.

### Etapa 14: Resaltar el texto comentado en el documento

[ ] Al cargar comentarios, re-anclar cada hilo al DOM:
1. Buscar coincidencia exacta de `selectedText` dentro del rango `data-line-*`
2. Si falla, buscar coincidencia fuzzy usando `prefixContext` y `suffixContext`
3. Si falla, marcar el hilo como huerfano (visible solo en panel lateral)

Cuando hay match, envolver el texto en un `<mark>` con `data-thread-id`.

Verificacion:
- Crear comentario → texto resaltado.
- Recargar → resaltado reaparece.
- Modificar el texto comentado levemente → fuzzy match re-ancla.
- Borrar el texto comentado → comentario aparece como huerfano en el panel.

### Etapa 15: Tarjetas flotantes estilo Google Docs

[ ] Renderizar tarjetas de comentario posicionadas absolutamente a la derecha del documento. Implementar el algoritmo de dos pasadas:
1. Calcular posicion ideal de cada tarjeta (alineada con su `<mark>` anchor via `getBoundingClientRect`)
2. Pasada de colision: iterar top-to-bottom y desplazar hacia abajo las que se solapan

Debounce del recalculo de posiciones via `requestAnimationFrame` en el evento `scroll`.

Verificacion:
- Crear multiples comentarios → tarjetas aparecen a la derecha alineadas con su fragmento.
- Con comentarios cercanos → tarjetas no se solapan.
- Scroll → posiciones se recalculan correctamente.

### Etapa 16: Interaccion activa entre highlight y tarjeta

[ ] Click en `<mark>` activa la tarjeta correspondiente (expanded, prominente). Click en tarjeta hace scroll al `<mark>` y lo activa. Las tarjetas inactivas se muestran compactas.

Verificacion:
- Click en texto resaltado → tarjeta correspondiente se expande y recibe foco.
- Click en tarjeta → documento hace scroll al fragmento y lo resalta.
- Solo una tarjeta activa a la vez.

### Etapa 17: Cargar comentarios existentes al abrir el viewer

[ ] `GET /api/files/:fileId/threads` devuelve hilos no resueltos con sus mensajes. El viewer los carga al montar.

Verificacion:
- Crear comentarios, cerrar y reabrir la pagina.
- Highlights y tarjetas reaparecen correctamente.

### Etapa 18: Editar y borrar comentario sin respuestas

[ ] Agregar accion para editar el texto del comentario raiz cuando el hilo no tiene respuestas del agente. Agregar accion para borrar el hilo completo bajo la misma condicion.

Verificacion:
- Editar comentario → nuevo texto persiste y se ve al recargar.
- Borrar comentario → desaparece del documento y del panel.
- No se puede editar ni borrar un hilo que ya tiene respuestas del agente.

---

## Bloque D: Hilos y resolucion

### Etapa 19: Crear respuestas dentro de un hilo

[ ] `POST /api/threads/:threadId/messages` crea una nueva fila en `messages`. El autor es `user` cuando viene del navegador.

Verificacion:
- Responder un hilo desde el navegador.
- Respuesta queda asociada al hilo correcto con orden estable.
- Se muestra en la tarjeta del comentario.

### Etapa 20: Diferenciar autor en los mensajes

[ ] Los mensajes con `author: 'agent'` se muestran con estilo visual distinto al de `author: 'user'`.

Verificacion:
- Crear mensajes de ambos autores (via endpoint directo para simular agente).
- La interfaz los distingue visualmente.
- La informacion persiste y reaparece al recargar.

### Etapa 21: Resolver un hilo desde la interfaz

[ ] `PATCH /api/threads/:threadId/resolve` marca `status = 'resolved'`. Agregar boton en la tarjeta del hilo.

Verificacion:
- Resolver un hilo → desaparece del viewer (solo se muestran hilos abiertos).
- El hilo sigue existiendo en SQLite con `status = 'resolved'`.

---

## Bloque E: Integracion con la sesion del agente

### Etapa 22: Implementar `claude-ping-pong comments`

[ ] Lee directamente de SQLite. Devuelve JSON con hilos que cumplen:
- `status = 'open'`
- `acknowledged = 0`
- No tienen mensajes con `author = 'agent'`

Al devolver, marca todos esos hilos como `acknowledged = 1` de forma atomica (en una transaccion).

Formato de salida:
```json
[
  {
    "threadId": "abc123",
    "fragment": "el texto seleccionado",
    "lineRange": { "start": 12, "end": 12 },
    "messages": [
      { "author": "user", "body": "Esto necesita mas detalle", "createdAt": 1234567890 }
    ]
  }
]
```

Verificacion:
- Crear hilos abiertos y uno resuelto.
- `comments <fileId>` devuelve solo los abiertos sin mensajes de agente.
- Segunda llamada inmediata devuelve array vacio (ya acknowledged).
- Hilo resuelto nunca aparece.

### Etapa 23: Implementar `claude-ping-pong reply`

[ ] Lee directamente de SQLite. Crea un mensaje en `messages` con `author = 'agent'`.

Verificacion:
- Responder un hilo via CLI.
- Mensaje persiste con `author = 'agent'`.
- El navegador lo muestra al refrescar.

### Etapa 24: Implementar `claude-ping-pong resolve`

[ ] Lee directamente de SQLite. Marca `status = 'resolved'` en el hilo indicado.

Verificacion:
- Resolver un hilo via CLI.
- El viewer deja de mostrarlo como pendiente al refrescar.

---

## Bloque F: Sincronizacion en tiempo real

### Etapa 25: Implementar canal SSE

[ ] Endpoint `GET /api/events/:fileId` que mantiene una conexion SSE abierta. El servidor mantiene un registro de conexiones activas por fileId.

Verificacion:
- Abrir el viewer y confirmar que la conexion SSE se establece.
- Navegador recibe al menos un evento inicial de conexion (`ping` o similar).

### Etapa 26: Notificar cambios de hilos al navegador

[ ] Cuando `reply` o `resolve` se ejecutan via CLI (escriben en SQLite directamente), el servidor necesita saber. Opciones: el CLI hace un POST al servidor ademas de escribir en SQLite, o el servidor hace polling interno a la DB cada pocos segundos.

Recomendacion: el CLI hace `POST /api/events/:fileId/notify` con el tipo de evento. El servidor emite el SSE correspondiente a los viewers conectados.

Verificacion:
- Abrir dos viewers del mismo documento.
- Resolver un hilo via CLI.
- Ambas ventanas reflejan el cambio sin recarga manual.

### Etapa 27: Vigilar cambios del archivo con chokidar

[ ] Al registrar un archivo en `open`, el servidor inicia un watcher con chokidar sobre esa ruta. Cuando detecta un cambio, emite un evento SSE `file:changed` a los viewers conectados de ese fileId.

Verificacion:
- Abrir el viewer de un archivo.
- Modificar el archivo desde un editor externo.
- El sistema detecta el cambio y lo notifica al viewer.

### Etapa 28: Refrescar la vista cuando cambia el documento

[ ] El viewer escucha el evento `file:changed` via SSE. Al recibirlo, hace fetch del nuevo contenido renderizado y re-renderiza el documento re-anclando los comentarios existentes.

Verificacion:
- Editar el archivo en otra terminal.
- El navegador muestra la nueva version sin recarga manual.
- Los comentarios existentes se re-anclan correctamente (o se marcan huerfanos si el fragmento desaparecio).

---

## Bloque G: Modo revision

### Etapa 29: Agregar boton "Start Review" en el viewer

[ ] Boton en el header del viewer que activa el modo revision. En modo revision:
- El header muestra un indicador visual claro ("Review in progress — N comments")
- Hay un boton "Submit Review" y un boton "Cancel"

El estado de revision vive en el frontend (React state o similar).

Verificacion:
- Activar modo revision → header cambia.
- Cancelar → vuelve al modo normal sin comentarios enviados.
- Sin modo revision activo → flujo normal de comentarios inmediatos.

### Etapa 30: Acumular comentarios draft en modo revision

[ ] En modo revision, guardar en el navegador → no llama al backend. El comentario entra a un array de drafts en el estado local. Los drafts se muestran en la interfaz con un estilo visual diferente (pendiente de envio).

Verificacion:
- En modo revision, crear varios comentarios.
- Confirmar que no se han guardado en SQLite todavia.
- Los drafts son visibles en la interfaz con estilo "pendiente".

### Etapa 31: Submit Review

[ ] Al hacer "Submit Review", el frontend hace un POST batch con todos los drafts:
`POST /api/files/:fileId/threads/batch`

El servidor los inserta en una transaccion. El modo revision se desactiva.

Verificacion:
- Crear 3 drafts, hacer Submit.
- Los 3 hilos aparecen en SQLite.
- El viewer sale del modo revision y muestra los hilos como normales.

### Etapa 32: Warning de beforeunload en revision activa

[ ] Si el usuario intenta cerrar el tab con una revision en curso, mostrar el dialogo nativo de `beforeunload`.

Verificacion:
- Iniciar revision, crear un draft, intentar cerrar el tab.
- Dialogo de confirmacion aparece.
- Si acepta cerrar → drafts se pierden (comportamiento esperado).

---

## Bloque H: Polling para el agente

### Etapa 33: Actualizar el skill `cr-review`

[ ] El skill `/ping-pong <file>`:
1. Llama a `claude-ping-pong open <file>` → obtiene URL + fileId
2. Muestra la URL al usuario
3. Arranca `/loop 30s` con el comando `claude-ping-pong comments <fileId>`

Verificacion:
- Ejecutar `/ping-pong` sobre un archivo.
- Confirmar que la URL se muestra.
- Confirmar que el loop arranca correctamente.

### Etapa 34: Probar el ciclo completo de polling

[ ] Validar el loop completo end-to-end.

Verificacion:
1. Arrancar el loop via `/ping-pong`.
2. Crear un comentario en el navegador.
3. Confirmar que el loop lo detecta en el siguiente tick.
4. El agente lo procesa, responde via `claude-ping-pong reply`.
5. El viewer muestra la respuesta via SSE.

---

## Bloque I: Navegacion, calidad y cierre

### Etapa 36: Manejar errores comunes de forma clara

[ ] Cubrir errores funcionales: archivo inexistente, hilo inexistente, fileId invalido, payload incompleto en POST.

Verificacion:
- Forzar cada error manualmente.
- El sistema responde con mensajes claros y sin romper la app.

### Etapa 37: Agregar pruebas de los flujos criticos

[ ] Cubrir con tests automatizados los flujos principales: registro de archivo, creacion de hilo, respuesta, resolucion, auto-acknowledge, re-anclaje de comentarios.

Verificacion:
- Suite de tests pasa completa.
- Una regresion intencional hace fallar al menos una prueba relevante.

### Etapa 38: Cerrar con smoke test de punta a punta

[ ] Validar el flujo completo real como usuario final.

Verificacion:
1. Crear un archivo Markdown de prueba.
2. Ejecutar `/ping-pong` → obtener URL, loop activo.
3. Abrir el viewer en el navegador.
4. Crear un comentario inmediato.
5. Confirmar que el loop lo detecta y el agente lo recibe.
6. Responder el hilo via `claude-ping-pong reply`.
7. Confirmar que el viewer muestra la respuesta via SSE.
8. Modificar el archivo → confirmar refresco en el navegador.
9. Activar modo revision → crear 3 comentarios draft → Submit.
10. Confirmar que los 3 hilos aparecen y el loop los detecta.
11. Resolver un hilo → desaparece del viewer.

---

## Riesgos a vigilar durante la implementacion

- Que el re-anclaje sea fragil cuando el agente reescribe el fragmento comentado. Mitigacion: prefixContext + suffixContext + fallback a huerfano.
- Que el estado entre navegador y backend se desincronice. Mitigacion: SSE con reconexion automatica via EventSource.
- Que la experiencia sea lenta con muchos comentarios y documento largo. Mitigacion: debounce via rAF para el recalculo de posiciones de tarjetas.
- Que el loop genere procesamiento duplicado si el agente tarda mas de 30s. Mitigacion: flag `acknowledged` marcado atomicamente en el fetch.
- Que el modo revision confunda al usuario. Mitigacion: indicador visual claro en header + warning de beforeunload.
- Que el CLI falle si el servidor no responde al health check. Mitigacion: timeout corto, mensaje de error claro, no dejar procesos zombie.

## Criterio de terminado del MVP

El MVP puede considerarse completo cuando este flujo funciona de punta a punta sin pasos manuales extra:

1. Ejecutar `/ping-pong` sobre un archivo Markdown.
2. Abrir la URL en el navegador.
3. Comentar un fragmento inline (inmediato).
4. El agente detecta el comentario automaticamente via polling.
5. El agente responde via `claude-ping-pong reply`.
6. Ver la respuesta reflejada en el navegador via SSE.
7. Activar modo revision, crear comentarios, hacer Submit.
8. Agente detecta el batch y los atiende.
9. Modificar el documento y ver el refresco en tiempo real.
10. Resolver un hilo y confirmar que desaparece del viewer.
