# Feature Overview

La feature principal de `claude-ping-pong` permite revisar un documento Markdown en el navegador, dejar comentarios inline sobre fragmentos específicos y devolver esos comentarios a la misma sesión del agente para que los atienda dentro del flujo normal de trabajo.

No es solo un visor de Markdown con comentarios. Funcionalmente, es un sistema que conecta revisión visual, conversación contextual y edición asistida sobre el mismo documento.

## Objetivo de la feature

El problema que resuelve es el siguiente:

- el usuario trabaja con el agente para generar un documento,
- luego necesita revisarlo visualmente,
- encuentra cosas para corregir,
- pero trasladar ese feedback al chat suele ser manual, ambiguo y repetitivo.

Sin esta feature, el usuario normalmente tiene que:

- leer el documento fuera del chat,
- ubicar el fragmento exacto que quiere cambiar,
- copiar o describir ese fragmento,
- volver a la conversación con el agente,
- explicar qué modificar,
- y esperar que el agente entienda correctamente el contexto.

La feature elimina esa fricción haciendo que el feedback nazca directamente sobre el documento renderizado, quede almacenado con contexto estructurado y pueda ser recuperado por el agente de forma precisa.

## Stack técnico

- **Servidor**: Hono + Node.js
- **Frontend**: Vite SPA (TypeScript)
- **Base de datos**: SQLite via `better-sqlite3` (global en `~/.claude-ping-pong/db.sqlite`)
- **File watching**: chokidar
- **Sincronización en tiempo real**: SSE (server → browser únicamente)
- **Distribución**: `npm install -g claude-ping-pong` — los assets del frontend se precompilan y se incluyen en el paquete npm

### Estructura del paquete

```
src/server/   src/client/   src/cli/
dist/server/  dist/client/  dist/cli.js   ← lo que se distribuye
```

## Vista general de la solución

La solución está organizada alrededor de un servicio local único que conecta cuatro piezas:

1. La sesión del agente.
2. La interfaz web de revisión.
3. El documento Markdown que se está revisando.
4. El estado persistente de comentarios e hilos.

Ese servicio local cumple dos papeles al mismo tiempo:

- sirve la experiencia web con la que el usuario revisa el documento,
- y actúa como backend compartido para almacenar y distribuir el estado de revisión.

## Componentes del sistema

### 1. Servicio local central

Existe un único servicio local que actúa como punto de coordinación. Sus responsabilidades son:

- exponer la interfaz web,
- entregar el contenido del documento renderizado,
- recibir creación y resolución de comentarios,
- mantener el estado compartido de archivos e hilos,
- y notificar cambios a los navegadores conectados via SSE.

El servicio arranca en un puerto fijo (configurable via `CLAUDE_REVIEW_PORT`). El CLI detecta si ya está corriendo con un health check antes de intentar levantarlo.

### 2. Registro de archivos con ID estable

Cada archivo registrado recibe un ID único (nanoid) en el momento del `open`. Ese ID se usa como clave primaria en todos los comandos posteriores, desacoplando el estado interno de las rutas del filesystem.

```bash
claude-ping-pong open <file>              # registra el archivo → devuelve URL + file-id
claude-ping-pong comments <file-id>       # hilos pendientes (JSON) + auto-acknowledge
claude-ping-pong reply <thread-id> "text" # el agente responde un hilo
claude-ping-pong resolve <thread-id>      # cierra un hilo
```

Los comandos `comments`, `reply` y `resolve` operan directamente sobre SQLite sin necesitar que el servidor web esté activo.

### 3. Renderizado navegable del documento

El documento Markdown se transforma en HTML con atributos `data-line-start` y `data-line-end` en cada bloque (párrafos, títulos, listas). Esto permite:

- que el usuario comente sobre lo que ve,
- y que el sistema pueda re-anclar comentarios a zonas específicas del documento cuando se recarga la página.

Las selecciones están restringidas a un único bloque. Seleccionar texto que cruce bloques muestra un tooltip explicativo.

### 4. Sistema de anclaje de comentarios

Cuando el usuario selecciona texto y crea un comentario, se almacena:

```
{ selectedText, prefixContext, suffixContext, lineRangeAtCreation }
```

Al cargar la página, el sistema intenta re-anclar en este orden:
1. Coincidencia exacta del texto seleccionado dentro del rango de líneas
2. Coincidencia fuzzy usando prefixContext y suffixContext
3. Si no hay match: el comentario se marca como "huérfano" y aparece solo en el panel lateral

### 5. Capa de comentarios e hilos

Los comentarios se modelan como hilos. Cada hilo tiene:

- un comentario raíz con el fragmento seleccionado y su contexto de anclaje,
- cero o más respuestas posteriores,
- un autor por mensaje (`user` o `agent`),
- un estado de resolución,
- y un flag `acknowledged` para el sistema de polling.

**Schema SQLite:**

```sql
files     { id, path, registered_at }
threads   { id, file_id, status, acknowledged,
            selected_text, prefix_context, suffix_context,
            line_range_start, line_range_end, created_at }
messages  { id, thread_id, author, body, created_at }
```

No existe una tabla de revisiones. Las revisiones son una feature puramente de frontend.

### 6. Visualización estilo Google Docs

Los comentarios se muestran como tarjetas flotantes a la derecha del documento, alineadas verticalmente con el fragmento comentado. El layout usa un algoritmo de dos pasadas:

1. Posición ideal: alinear la tarjeta con el anchor en el documento
2. Pasada de colisión: desplazar tarjetas hacia abajo cuando se solapan

La tarjeta activa (seleccionada) tiene prioridad de alineación. El recálculo de posiciones en scroll se debouncea via `requestAnimationFrame`.

### 7. Modo de revisión (Review Mode)

Por defecto, los comentarios son **inmediatos**: se persisten y quedan visibles para el agente en el momento de creación.

El usuario puede activar el **modo revisión** desde un botón en la interfaz (similar al flujo de Gitlab al revisar un MR). En este modo:

- los comentarios quedan en estado draft en el navegador,
- no son visibles para el agente hasta que el usuario hace "Submit Review",
- al hacer Submit, todos los drafts se envían al servidor en un único batch POST,
- si el usuario cierra el tab con una revisión en curso, recibe un warning de `beforeunload`.

El estado draft no se persiste en el servidor — vive únicamente en el frontend.

### 8. Estado persistente

Toda la información relevante vive en `~/.claude-ping-pong/db.sqlite`. Un único store global para todos los proyectos. Los comentarios no viajan con el repo — esta es una herramienta de desarrollo local.

### 9. Sincronización en tiempo real

SSE (Server-Sent Events) propaga dos tipos de eventos al navegador:

- cambios en el archivo Markdown (detectados por chokidar),
- cambios en el estado de hilos (respuestas o resoluciones del agente).

El navegador usa la API nativa `EventSource`, que reconecta automáticamente.

### 10. Integración con la sesión del agente y polling

La integración entra por el skill `/ping-pong`. Al ejecutarlo:

1. Llama a `claude-ping-pong open <file>` → obtiene URL + file-id
2. Abre la URL para que el usuario pueda revisar
3. Arranca `/loop 30s` apuntando a `claude-ping-pong comments <file-id>`

El comando `comments` devuelve JSON con los hilos que cumplen ambas condiciones:
- no tienen mensajes con `author: agent`
- tienen `acknowledged = false`

Al devolver los hilos, los marca como `acknowledged` de forma atómica. Esto evita que el siguiente tick del loop los re-procese si el agente tarda más de 30 segundos en responder.

## Flujo de los componentes del sistema

1. La sesión del agente ejecuta `/ping-pong` sobre un archivo.
2. El CLI hace un health check al servidor; si no responde, lo arranca en background.
3. El archivo se registra y recibe un file-id.
4. Se devuelve la URL y se inicia el loop de polling cada 30 segundos.
5. El usuario abre la URL y lee el documento renderizado.
6. El usuario selecciona texto dentro de un bloque y crea un comentario (inmediato o en modo revisión).
7. Si es modo revisión, acumula drafts y hace Submit al terminar.
8. El servidor persiste los hilos y notifica via SSE al navegador.
9. El loop detecta hilos nuevos → auto-acknowledge → el agente los recibe como JSON.
10. El agente responde o modifica el documento.
11. Si el agente modifica el archivo, chokidar lo detecta y SSE notifica al navegador.
12. El navegador recarga el contenido y re-ancla los comentarios existentes.
13. El agente resuelve el hilo cuando corresponde.

## User Flow

1. El usuario trabaja con el agente para crear o editar un documento Markdown.
2. Cuando quiere revisarlo, ejecuta `/ping-pong` sobre ese archivo.
3. El sistema devuelve una URL local y arranca el loop de polling.
4. El usuario abre la URL y lee el documento renderizado con estilo Google Docs.
5. Selecciona fragmentos y deja comentarios inline (inmediatos o en modo revisión).
6. Si usa modo revisión, hace Submit cuando termina de anotar.
7. El agente detecta los hilos automáticamente via polling y los atiende.
8. Si el agente modifica el documento, el navegador se actualiza en tiempo real.
9. El usuario revisa el resultado y puede responder en hilos existentes o crear nuevos.
10. El ciclo se repite hasta que el documento queda alineado con la intención del usuario.

## Scope

**In:**
- Servicio web local
- Vista de documentos Markdown con renderizado navegable
- Comentarios inline con hilos (inmediatos y modo revisión)
- Persistencia local en SQLite global
- Sincronización en tiempo real via SSE + chokidar
- Comandos CLI de integración con la sesión del agente
- Polling automático via `/loop` del skill
- Visualización estilo Google Docs (highlight + tarjetas flotantes con collision avoidance)

**Out:**
- Multiusuario remoto
- Autenticación
- Permisos complejos
- Edición del documento desde el navegador (edit mode)
- Reacciones con emoji
- Persistencia de revisiones en la base de datos
- Soporte para formatos que no sean Markdown

## Límites funcionales

La feature está optimizada para un caso muy específico:

- revisión iterativa de documentos Markdown,
- en una máquina local,
- con colaboración entre usuario y agente sobre el mismo archivo.

No está planteada como editor generalista, ni como plataforma multiusuario remota.

## Resumen

`claude-ping-pong` implementa un ciclo de revisión documental asistida:

- un servicio local coordina todo,
- el navegador ofrece la superficie de lectura y comentarios estilo Google Docs,
- el estado persistente en SQLite conserva archivos, hilos y mensajes,
- el polling automático mantiene al agente sincronizado con el feedback del usuario,
- y la sesión del agente consume ese feedback para seguir iterando el documento.

La feature funciona porque une tres cosas que normalmente están separadas:

- la lectura visual del documento,
- el feedback contextual del usuario,
- y la capacidad del agente de responder y editar sobre ese feedback.
