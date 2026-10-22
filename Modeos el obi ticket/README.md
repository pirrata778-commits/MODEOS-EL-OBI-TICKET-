# MODEOS EL OBI TICKETS

Bot modular de tickets para Discord con comandos slash, modales de admisión, herramientas para el equipo, SQLite, transcripciones y proveedor opcional de IA. El bot no requiere una clave de IA para arrancar ni para abrir y administrar tickets.

## Requisitos

- Docker Engine y Docker Compose, o Node.js 20.11 o posterior.
- Una aplicación y un bot creados en el [Portal de desarrolladores de Discord](https://discord.com/developers/applications).
- Para respuestas IA, una clave de un proveedor compatible. OpenAI Responses es el proveedor predeterminado; una API compatible con Chat Completions se puede configurar con `AI_PROVIDER=openai-compatible`.

## Crear la aplicación de Discord

1. En el Portal de desarrolladores, crea una aplicación y añade un bot en **Bot**.
2. Copia el token del bot a `DISCORD_TOKEN` en `.env`. No lo pegues en el código ni lo compartas.
3. Copia el Application ID de **General Information** a `DISCORD_APPLICATION_ID`.
4. En **Bot → Privileged Gateway Intents**, activa **Message Content Intent**. El bot necesita leer mensajes solo para contestar en canales que estén registrados en su base de datos como tickets.
5. Invita la aplicación con los scopes `bot` y `applications.commands`. Dale estos permisos: **View Channels**, **Send Messages**, **Read Message History**, **Embed Links**, **Attach Files** y **Manage Channels**. Manage Channels permite crear los canales privados y sus permisos. No necesita Administrator.
6. Crea una categoría vacía de Discord para los tickets, un rol de soporte y un canal privado de registros. Asegúrate de que el rol de soporte y el bot puedan ver el canal de registros, y que `@everyone` no pueda verlo.

Las operaciones administrativas del bot requieren **Manage Server**. Los miembros del rol de soporte también pueden ejecutar las acciones del equipo dentro de los tickets.

## Preparar variables

En PowerShell, dentro de esta carpeta:

```powershell
Copy-Item .env.example .env
notepad .env
```

Rellena `DISCORD_TOKEN`, `DISCORD_APPLICATION_ID` y, para registrar comandos de prueba, `DISCORD_TEST_GUILD_ID`. No guardes el token ni la clave de IA en `config.json`; esos secretos se leen solo desde el entorno. `.env` queda excluido de Git y de la imagen Docker.

## Ejecutar con Docker Compose

Registra los comandos y arranca el bot:

```powershell
docker compose run --rm --no-deps bot node src/deploy-commands.js
docker compose up -d --build
docker compose logs -f bot
```

El primer comando publica los comandos en `DISCORD_TEST_GUILD_ID` si está definido; de lo contrario, los registra globalmente. El registro usa una sustitución completa de comandos para la aplicación y no crea duplicados al repetirlo. Los comandos de servidor de prueba suelen aparecer enseguida; los globales pueden tardar en propagarse.

Para actualizar después de cambiar el código:

```powershell
docker compose run --rm --no-deps bot node src/deploy-commands.js
docker compose up -d --build
```

La base SQLite y las transcripciones permanecen en el volumen Docker `ticket-data`. No ejecutes `docker compose down -v` si quieres conservarlas. El endpoint de salud interno es `/health` y `/ready`; no se publica ningún puerto al host.

## Desplegar en Render

El archivo `render.yaml` define un **Background Worker Docker** con disco persistente en `/app/data`, donde se guardan SQLite y las transcripciones. Requiere un plan de pago de Render: los servicios gratuitos no admiten disco persistente ni garantizan que un bot conectado por Gateway permanezca activo.

1. Sube este proyecto a un repositorio de GitHub (no incluyas `.env`, tokens, claves ni la carpeta `data`).
2. En Render, selecciona **New → Blueprint** y conecta el repositorio. Render detectará `render.yaml`.
3. Al crear el servicio, rellena `DISCORD_TOKEN` y `DISCORD_APPLICATION_ID`. En **Environment** puedes añadir `DISCORD_TEST_GUILD_ID` para registrar comandos en un servidor de pruebas y `AI_API_KEY` si quieres activar respuestas de IA.
4. Crea el servicio y espera a que termine el primer deploy.
5. En la Shell del servicio, ejecuta `node src/deploy-commands.js` para registrar los comandos slash.

El worker se mantiene conectado a Discord y no necesita tráfico HTTP entrante. El archivo de entorno local no se sube: los secretos se configuran en Render. El disco persistente tiene 1 GB inicialmente; puede ampliarse desde la configuración de Render.

## Ejecutar con Node.js sin Docker

```powershell
npm install
npm run deploy:commands
npm start
```

Configura `.env` antes de arrancar. Los datos aparecen en `data/tickets.sqlite` y `data/transcripts/`.

## Primera configuración dentro de Discord

1. Ejecuta `/ticket-setup` y selecciona rol de soporte, categoría de Discord para tickets, canal privado de registros y canal del panel.
2. Ejecuta `/ticket-config servidor` para describir MODEOS EL OBI y establecer preguntas de contexto separadas por `;`.
3. Opcionalmente, ajusta el saludo con `/ticket-config bienvenida`, el texto del panel con `/ticket-config panel`, y las reglas de duplicados con `/ticket-config duplicados`.
4. Ejecuta `/ticket-panel` en el canal de panel o especifica `canal` para publicarlo allí.
5. Abre un ticket de prueba desde el menú. El formulario pregunta por el motivo y detalles adicionales; el canal solo es visible para el solicitante, soporte y administradores de Discord.

Las siete categorías iniciales son soporte general, bots de Discord, problemas técnicos, compras y ventas, presupuestos, reportes y otros asuntos. `/ticket-config categoria` añade o actualiza una categoría, la pregunta del formulario y, opcionalmente, su propia categoría de Discord y rol de soporte. Después vuelve a publicar el panel. La categoría/rol específicos se pueden dejar sin indicar para usar los valores globales de `/ticket-setup`.

## Funciones del equipo

- `/ticket-claim` reclama o libera el ticket; los botones del panel permiten reclamar.
- `/ticket-add` y `/ticket-remove` administran participantes adicionales.
- `/ticket-note` guarda notas internas solo en SQLite.
- `/ticket-priority` establece prioridad baja, normal, alta o urgente.
- `/ticket-transfer` cambia la categoría registrada y, si están configurados, mueve el canal de Discord y asigna el rol de soporte correspondiente.
- `/ticket-info` consulta estado, notas y actividad; `/ticket-summary` crea un resumen privado para el relevo.
- `/ticket-transcript` genera una transcripción HTML y TXT bajo demanda.
- `/ticket-close` pide confirmación, archiva y bloquea mensajes nuevos del solicitante, guarda la transcripción y permite valorar el soporte. `/ticket-reopen` vuelve a habilitar el ticket.
- `/ticket-stats` muestra totales y valoración; `/ticket-blacklist` gestiona bloqueos de apertura.

Las transcripciones incluyen autor, fecha, texto y referencias a adjuntos. No se descargan archivos adjuntos. Los archivos guardados localmente se eliminan tras `TRANSCRIPT_RETENTION_DAYS` (90 días de forma predeterminada); el canal de registros de Discord conserva sus propias copias hasta que las elimines allí.

## IA opcional

OpenAI es el proveedor predeterminado. Crea una clave en [la página de claves de API](https://platform.openai.com/api-keys) y guárdala solo en `AI_API_KEY` dentro de `.env`. Este proveedor usa la [API Responses](https://platform.openai.com/docs/api-reference/responses). El uso de la API se factura según la cuenta y el modelo del proveedor; tener ChatGPT Plus no configura por sí mismo una clave de API.

- `AI_PROVIDER=openai`, `AI_BASE_URL=https://api.openai.com/v1`, `AI_MODEL=gpt-4.1-mini` usa la API Responses.
- Para un servicio compatible con Chat Completions, utiliza `AI_PROVIDER=openai-compatible`, su endpoint base en `AI_BASE_URL`, su modelo en `AI_MODEL` y la clave en `AI_API_KEY`.
- `AI_ENABLED=false` detiene globalmente la IA. `/ticket-config ia-global` activa o pausa cada servidor; `/ticket-ia pausar` o `activar` controla cada ticket.
- El modo `auto` responde a mensajes de usuarios. El modo `manual` responde cuando mencionan al bot o usan el botón **Preguntar a la IA**. Cuando un agente de soporte responde, la IA se pausa automáticamente en ese ticket.
- `/ticket-ia sugerir` prepara una respuesta privada para que el agente la revise. `/ticket-summary` resume la conversación para el equipo.
- `AI_USER_LIMIT_PER_HOUR`, `AI_TICKET_LIMIT_PER_HOUR`, `AI_TIMEOUT_MS` y `AI_HISTORY_LIMIT` limitan solicitudes, tiempo de espera e historial enviado al proveedor.

El mensaje del formulario y hasta el número de mensajes indicado en `AI_HISTORY_LIMIT` se envían al proveedor configurado para producir respuestas o resúmenes; los adjuntos no se descargan y solo se comparten sus nombres. El prompt trata el texto del usuario como contenido no confiable y le indica que no revele secretos, invente políticas o suplante al personal. Ningún filtro de prompt elimina por completo el riesgo de respuestas incorrectas: el equipo debe revisar decisiones de compras, políticas y acciones de cuenta.

## Comandos slash registrados

`/ticket-panel`, `/ticket-setup`, `/ticket-config`, `/ticket-add`, `/ticket-remove`, `/ticket-claim`, `/ticket-close`, `/ticket-reopen`, `/ticket-priority`, `/ticket-transfer`, `/ticket-info`, `/ticket-note`, `/ticket-summary`, `/ticket-transcript`, `/ticket-stats`, `/ticket-ia`, `/ticket-blacklist` y `/ticket-help`.

## Comprobaciones y límites

El proyecto incluye `npm run check` para revisar sintaxis JavaScript y una prueba automatizada de base de datos en `npm test`. Las interacciones, permisos efectivos y entrega de mensajes requieren una aplicación y un servidor privado de Discord; no se pueden validar completamente sin las credenciales y el servidor.

Cada categoría puede usar su propia categoría de Discord y rol de soporte. La base conserva metadatos, notas, acciones y valoraciones. Las transcripciones guardan la conversación hasta el periodo de retención indicado; no se mantiene una copia indefinida del contenido en SQLite.
