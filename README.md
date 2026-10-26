# Magpie

A minimal, self-hosted bookmark manager: nested collections in a sidebar, filters and tags underneath, and a fast list of bookmarks on the right.

It runs as **one Node process with one SQLite file**. There's no separate search engine, queue, or headless browser to operate.

## Features

- **Bookmarks, notes and files.** Save links, Markdown notes, or upload images, PDFs, audio and video.
- **Automatic metadata.** Each link's title, description, preview image and favicon are fetched in the background. A clean reader view of the article text is also saved, and that text is searchable.
- **Collections.** Unlimited nesting, icons from the [Phosphor](https://phosphoricons.com) set (search them by name) and colours, grouped into sidebar sections such as "My Collections" or "Side Hustles". Drag to reorder or nest them.
- **Tags.** Autocomplete, rename/merge, and drop bookmarks onto a tag to apply it.
- **Filters.** Favorites, notes, links, articles, videos, images, audio, documents, broken links, duplicates, and bookmarks without tags.
- **Full-text search.** Searches title, description, notes, URL, tags and page text, with operators:
  `#tag` `-#tag` `is:fav` `type:video` `site:github.com` `"exact phrase"` `-word` `-"exact phrase"` `before:2024-01-01` `after:2024-01-01` (dates are days in your time zone)
- **Four views per collection.** List, cards, headlines and moodboard. Sort manually by drag and drop, by date, by name, or by site.
- **Bulk actions.** Select many bookmarks, then move, tag, favourite, refresh or delete them.
- **Drag and drop.** Drag bookmarks to collections, Unsorted, Trash or tags. Drop links or files from other apps onto the list. Paste a URL anywhere to save it.
- **Reader view.** Covers articles, notes (rendered Markdown), images, PDFs, video and YouTube embeds.
- **Trash.** Deleted bookmarks can be restored or deleted permanently.
- **Import.** Accepts browser HTML (Chrome, Firefox, Safari, Edge), HTML and JSON exports from other bookmark managers, Pocket/Instapaper-style CSV, and Magpie JSON. Folders become collections, and duplicates can be skipped.
- **Export.** HTML (Netscape bookmark format), CSV or JSON, for everything or a single collection.
- **Backups.** A daily backup of each account's bookmarks, collections, notes and tags whenever something changed (the last 14 are kept), plus on-demand backups. Each one downloads as HTML, CSV or JSON. The server also keeps a daily copy of the whole database, and another before applying an update that changes it.
- **Browser extension.** Works in Chrome, Edge, Brave, Arc and Firefox. One click saves the current page, and you can then set its collection, tags and note from the popup. Right-click saves links, images, or selected text as a note. There's also a keyboard shortcut. See [below](#browser-extension).
- **Bookmarklet.** Saves the current page from any browser, with nothing to install.
- **REST API.** Uses personal API keys (`Authorization: Bearer mp_…`).
- **Statistics.** Settings → Statistics shows:
  - your bookmark total with a 12-month trend, and this week, month and year against the previous period
  - a calendar heatmap of the past year, with saving streaks
  - when you save, by day of the week and by hour, in your own time zone
  - bookmark types, top sites, tags and collections
  - how you save (web app, extension, bookmarklet, API, import)
  - storage, estimated reading time, and library health (broken links, duplicates, untagged)

  Charts respond to hover and keyboard focus, and can switch to a table view.
- **Themes.** Light, dark, dark sidebar and sepia, or follow the system setting. There's also a large-font option.
- **Accounts.** Multiple users with email/password sign-in. You can disable sign-ups once you've created yours.

### Left out on purpose

AI tagging/summaries, RSS feeds, mobile apps (the API and bookmarklet cover most of this), full-page archives and screenshots (which need a headless browser), highlights, smart lists, rules and webhooks.

## Quick start (Docker)

```bash
docker compose up -d
```

Open http://localhost:3000 and create your account. The first account is the administrator. Data lives in `./data`: `magpie.db`, uploaded files and cached preview images in `assets/`, and backups in `backups/` (database copies in `backups/database/`). Backups on the same disk don't protect against losing that disk, so copy the whole data folder somewhere else from time to time.

Once you've signed up, set `DISABLE_SIGNUPS: "true"` in `docker-compose.yml` and run `docker compose up -d` again.

## Unraid

`unraid/magpie.xml` is an Unraid container template for the published image, `ghcr.io/bstrangleman/magpie`.

1. **Add the template.** In the Unraid terminal, run:

   ```bash
   wget -O /boot/config/plugins/dockerMan/templates-user/my-Magpie.xml https://raw.githubusercontent.com/bstrangleman/magpie/master/unraid/magpie.xml
   ```

2. **Create the container.** Go to **Docker → Add Container**, pick **Magpie** from the Template list, check the port and data path, and click **Apply**. Then open the Web UI and create your account.
3. **Lock it down.** Edit the container and set **Disable sign-ups** to `true`.

When a new image is published, the Docker tab shows **update ready** next to Magpie. Click it to update.

Notes:

- The container runs as `nobody:users` (PUID 99, PGID 100), like other Unraid apps, and takes ownership of its data folder on start.
- SQLite is safest off Unraid's `/mnt/user` FUSE layer. The template's default, `/mnt/user/appdata/magpie`, is fine when appdata is an exclusive share (Unraid 6.12 and later); otherwise point it at the pool directly, such as `/mnt/cache/appdata/magpie`.
- Port 3000 is also Grafana's default. Change the host port in the template if it's already in use.
- **Trying a local build:** `npm run docker:unraid` builds the x86 image under the same name into `dist/magpie-docker-amd64.tar.gz`. Copy it to the server, run `docker load -i magpie-docker-amd64.tar.gz`, and restart the container. Unraid will then offer the published image as an update.

### Publishing the image

`.github/workflows/docker.yml` runs the typecheck and tests, then builds the image for x86 and ARM:

- Every push to `master` publishes `ghcr.io/bstrangleman/magpie:latest` and `:sha-<commit>`.
- A tag such as `v1.2.3` also publishes `:1.2.3` and `:1.2`.
- Pull requests build the image without publishing it.

## Browser extension

The extension lives in `extension/` and is a Manifest V3 extension that works in both Chromium browsers and Firefox (128+). There's a separate package for each, because the two browsers need different background settings in `manifest.json`. Your Magpie server serves both: open **Settings → Integrations** and download the one for your browser. You can also build them with `npm run build:extension`, which writes `dist/extension-chrome/` and `dist/extension-firefox/` plus a zip of each. `/api/extension.zip` serves the package for the browser that opens it, or the one named by `?browser=chrome` or `?browser=firefox`.

1. **Install it.**
   - Chrome, Edge, Brave or Arc: open `chrome://extensions`, turn on **Developer mode**, click **Load unpacked**, and choose the unzipped Chrome package (or `dist/extension-chrome`).
   - Firefox: open `about:debugging#/runtime/this-firefox`, click **Load Temporary Add-on**, and pick `manifest.json` from the Firefox package (or `dist/extension-firefox`). Firefox removes temporary add-ons on restart. To keep it installed, sign it as an unlisted add-on through [addons.mozilla.org](https://addons.mozilla.org/developers/).
2. **Connect it.** The settings page opens when you install. Enter your Magpie address, email and password. The extension exchanges them once for an API key (`POST /api/auth/token`) and doesn't store the password. You can paste an API key from Settings → Integrations instead. The browser asks permission to reach your server's address and nothing else.
3. **Use it.**
   - **Toolbar button** (default shortcut <kbd>Alt</kbd>+<kbd>Shift</kbd>+<kbd>M</kbd>): saves the page straight away, or finds it if it's already saved. You can then change the title, collection, tags, note or favourite, or remove it, without leaving the page.
   - **Right-click menu:** *Save page*, *Save link*, *Save image*, or *Save selection as a note*. The selection is saved as a quote that links back to the page.

When you disconnect, the extension revokes the API key it created. Keys can also be revoked from Magpie's Integrations page.

**Developing the extension:** `npm run dev:extension` serves the popup and settings pages at http://localhost:5174 with hot reload. A stand-in for the browser API (`extension/src/dev-shim.ts`) is used there, and the API is proxied to `:3000`, so use `http://localhost:5174` as the server address. Open `popup.html?url=https://example.com&title=Example` to simulate clicking the button on a page. After changing the logo, run `npm run icons` to regenerate the PNG icons.

## Local development

Requires Node.js 24 or newer. There are no native modules: SQLite is Node's built-in `node:sqlite`.

```bash
npm install
npm run dev          # API on :3000, web app with hot reload on :5173
```

Open http://localhost:5173. To get some sample data, run this while the dev server is up:

```bash
node scripts/seed.ts
```

The seed script creates a demo account (credentials are at the top of the script), with collections and links that get their metadata fetched for real. Add `--history` to also import about a year of sample bookmarks, so the Statistics page has something to show. The history is deterministic, and running it again skips anything already imported.

| Command                   | What it does                                                                 |
| ------------------------- | ---------------------------------------------------------------------------- |
| `npm run dev`             | API server (restarts on change) + Vite dev server                            |
| `npm run dev:extension`   | Extension popup/settings pages with hot reload on :5174                      |
| `npm run build`           | Build the web client into `dist/web` and the Chrome and Firefox extensions   |
| `npm run build:extension` | Build just the extension, as `dist/extension-chrome` and `-firefox`, plus zips |
| `npm start`               | Production server, serving the API and `dist/web` on one port               |
| `npm run docker:unraid`   | Build the x86 Docker image locally into `dist/magpie-docker-amd64.tar.gz`    |
| `npm test`                | Server and extension tests (`node --test`)                                   |
| `npm run typecheck`       | TypeScript checks for the server, web client and extension                   |
| `npm run icons`           | Regenerate the extension's PNG icons from the logo                           |

## Configuration

All settings are environment variables.

| Variable                       | Default        | Description                                                                                                                                                                   |
| ------------------------------ | -------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `PORT`                         | `3000`         | HTTP port                                                                                                                                                                      |
| `HOST`                         | `0.0.0.0`      | Interface to listen on                                                                                                                                                        |
| `DATA_DIR`                     | `./data`       | Database, uploads, cached covers and backups                                                                                                                                  |
| `DISABLE_SIGNUPS`              | `false`        | Block new accounts once one exists                                                                                                                                            |
| `TRUST_PROXY`                  | `false`        | Set to `true` behind a reverse proxy, so sign-in rate limits use the client's address from the last `X-Forwarded-For` entry (the one your proxy adds) rather than the proxy's. Leave it off otherwise: the header is easy to fake. |
| `FETCH_ALLOW_PRIVATE_NETWORKS` | `false`        | Allow metadata fetches to private/LAN addresses (e.g. `http://tower.local`). Off by default so the server can't be used to probe your network. Such links are still saved, just without metadata. |
| `FETCH_TIMEOUT_MS`             | `15000`        | Per-page fetch timeout                                                                                                                                                        |
| `FETCH_CONCURRENCY`            | `3`            | Pages fetched in parallel                                                                                                                                                     |
| `FETCH_USER_AGENT`             | Chrome-like UA | User agent for metadata requests                                                                                                                                              |
| `MAX_UPLOAD_MB`                | `50`           | Upload size limit                                                                                                                                                             |
| `BACKUP_RETENTION`             | `14`           | Automatic backups to keep per user, and daily database copies to keep                                                                                                         |
| `PUID` / `PGID`                | `1000`         | Docker only: user and group the server runs as and that own `DATA_DIR` (Unraid: `99` / `100`)                                                                                 |
| `UMASK`                        | `022`          | Docker only: permissions mask for new files                                                                                                                                   |

When running behind a reverse proxy over HTTPS, make sure it sends `X-Forwarded-Proto: https` so session cookies are marked `Secure`, and set `TRUST_PROXY=true`.

Failed sign-ins are limited to 10 per account and 50 per client address every 15 minutes, and sign-ups to 10 per address an hour.

## How it works

| Piece          | Choice                                                                                                                              |
| -------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| Server         | [Hono](https://hono.dev) on Node. TypeScript runs directly through Node's built-in type stripping, so there's no server build step. |
| Database       | SQLite via `node:sqlite`, WAL mode, with migrations in `server/db/migrations.ts`                                                    |
| Search         | SQLite **FTS5** (porter stemming, prefix matching, bm25 ranking with title > tags > description/notes > URL > page text), so no separate search server is needed. |
| Metadata       | `fetch` (undici) with SSRF checks on every redirect and at connect time (so DNS rebinding can't slip past), Open Graph/Twitter tags, oEmbed for YouTube/Vimeo, and Mozilla Readability + `sanitize-html` for the reader view, run in a worker thread. Covers and site icons are cached locally. |
| Background jobs | An in-process queue. Pending fetches are stored as `fetch_status = 'pending'`, so they resume after a restart.                     |
| Web client     | React, Vite, TanStack Query, React Router, Tailwind CSS and Lucide icons. Collection icons are [Phosphor](https://phosphoricons.com) (MIT), stored as `ph:<name>`; the set loads as one lazily loaded chunk |

### Data model

```
users ──< sessions, api_keys, backups
users ──< collection_groups ──< collections (root)      collections ──< collections (parent_id, nested)
users ──< bookmarks >── collections (NULL = Unsorted)    bookmarks >──< tags (bookmark_tags)
bookmarks ── assets (uploaded file, cached cover)       bookmarks_fts (FTS5, rowid = bookmarks.id)
```

- A bookmark's `type` is one of `link`, `article`, `video`, `image`, `audio`, `document` or `note`. It's detected from the page or the upload's MIME type.
- `position` is a fractional sort key for manual ordering. When neighbours get too close, the collection is renumbered.
- Trash is a soft delete (`deleted_at`). Emptying the Trash removes the rows and any stored files.
- Per-view preferences (view mode, sort) live in `users.settings` as JSON.
- A bookmark's `source` records where it was saved from. Requests made with an API key count as `extension` (if the extension says so in the `X-Magpie-Client` header) or `api`. Signed-in web requests count as `web` or `bookmarklet`, and imports as `import`. Bookmarks saved before this was added have no source.

### Project layout

```
server/
  index.ts            entry: open DB, start fetch worker + backup schedule, serve
  app.ts              routes, auth middleware, static files
  db/                 node:sqlite helpers + migrations
  lib/                auth (scrypt, sessions, API keys), search parser, URLs, sort positions
  services/           bookmarks, collections, tags, fetcher (+ extract and its worker-thread pool), fetch queue, import/export, backups, assets
  routes/             HTTP handlers (zod-validated)
  test/               node:test suites
shared/types.ts       types shared by server and client
web/src/
  pages/              Main (sidebar + list + panels), Settings, Auth, Save (bookmarklet)
  components/         Sidebar, TopBar, BookmarkList/Item, edit panel, reader, dialogs, UI primitives
  lib/                API client, React Query hooks, view routing, drag & drop
extension/
  public/manifest.json  Manifest V3, with both browsers' background keys (each package keeps its own)
  src/                popup, settings page, background (context menus), API client, dev shim
  test/               node:test suites
scripts/
  seed.ts             demo data
  icons.ts            renders the logo to the extension's PNG icons
  package-extension.ts  packages the extension for Chrome and Firefox (manifests from extension-manifest.ts)
  zip.ts              dependency-free zip writer
```

## API

Every endpoint the web app uses is available with an API key. Create one under **Settings → Integrations**.

```bash
curl -X POST http://localhost:3000/api/bookmarks \
  -H "Authorization: Bearer mp_…" -H "Content-Type: application/json" \
  -d '{"url": "https://example.com", "tags": ["reading"], "collectionId": 3}'
```

| Endpoint                                                         | Purpose                                                                                                                     |
| ---------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| `POST /api/auth/token`                                           | Exchange `{email, password, name}` for an API key, without a session (used by the extension)                               |
| `GET /api/bookmarks`                                             | List or search. Params: `view` (all, unsorted, trash, collection, filter, tag), `collection`, `filter`, `tag`, `q`, `sort`, `offset`, `limit`, and `tz` (IANA time zone for `before:`/`after:`, default UTC) |
| `GET /api/bookmarks/ids`                                         | Every id the same query matches, in order (used for "select all")                                                           |
| `POST /api/bookmarks`                                            | Create (`url` or `note`, plus `title`, `description`, `collectionId`, `tags`, `favorite`)                                   |
| `GET / PATCH / DELETE /api/bookmarks/:id`                        | Read, update, or move to Trash (`?permanent=true` deletes)                                                                  |
| `GET /api/bookmarks/:id/content`                                 | Reader-view HTML and text                                                                                                    |
| `GET /api/assets/:id`                                            | An uploaded file, cached cover or site icon. Supports `Range` requests                                                      |
| `GET /api/bookmarks/lookup?url=`                                 | Find an existing bookmark by URL                                                                                            |
| `POST /api/bookmarks/upload`                                     | Multipart file upload (`file`, `collectionId`)                                                                              |
| `POST /api/bookmarks/bulk`                                       | `{ids, action}` (up to 5,000 ids), where action is move, addTags, removeTags, favorite, trash, restore, delete or refetch  |
| `POST /api/bookmarks/:id/reorder`                                | `{prevId, nextId}` for manual sort                                                                                           |
| `GET /api/sidebar`                                               | Counts, groups, collections and tags                                                                                         |
| `GET /api/stats?tz=Europe/London`                                | Usage statistics. Activity is grouped into days and hours in the given IANA time zone (default UTC).                       |
| `POST /api/collections`, `PATCH/DELETE /api/collections/:id`     | Manage collections                                                                                                           |
| `POST /api/collections/:id/move`                                 | `{parentId, groupId, prevId, nextId}`                                                                                        |
| `POST /api/groups`, `PATCH/DELETE /api/groups/:id`               | Manage sidebar groups                                                                                                        |
| `PATCH/DELETE /api/tags/:id`                                     | Rename/merge or delete a tag                                                                                                 |
| `POST /api/import`                                               | Multipart import (`file`, `skipDuplicates`, `fetchMetadata`)                                                                 |
| `GET /api/export?format=html\|csv\|json&collection=`             | Export                                                                                                                       |
| `GET/POST /api/backups`, `GET /api/backups/:id/download?format=` | Backups                                                                                                                      |
