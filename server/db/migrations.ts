// Schema migrations, applied in order. The index + 1 is stored in PRAGMA user_version.
// Never edit a shipped migration; append a new one instead.

export const migrations: string[] = [
  /* sql */ `
  CREATE TABLE users (
    id            INTEGER PRIMARY KEY,
    email         TEXT NOT NULL UNIQUE COLLATE NOCASE,
    name          TEXT NOT NULL,
    password_hash TEXT NOT NULL,
    is_admin      INTEGER NOT NULL DEFAULT 0,
    settings      TEXT NOT NULL DEFAULT '{}',
    created_at    INTEGER NOT NULL
  );

  CREATE TABLE sessions (
    id         TEXT PRIMARY KEY,            -- sha256 of the cookie token
    user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at INTEGER NOT NULL,
    expires_at INTEGER NOT NULL
  );
  CREATE INDEX sessions_user ON sessions(user_id);

  CREATE TABLE api_keys (
    id           INTEGER PRIMARY KEY,
    user_id      INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    name         TEXT NOT NULL,
    key_hash     TEXT NOT NULL UNIQUE,      -- sha256 of the key
    prefix       TEXT NOT NULL,
    created_at   INTEGER NOT NULL,
    last_used_at INTEGER
  );

  CREATE TABLE collection_groups (
    id         INTEGER PRIMARY KEY,
    user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    name       TEXT NOT NULL,
    position   REAL NOT NULL,
    collapsed  INTEGER NOT NULL DEFAULT 0,
    created_at INTEGER NOT NULL
  );
  CREATE INDEX collection_groups_user ON collection_groups(user_id);

  CREATE TABLE collections (
    id         INTEGER PRIMARY KEY,
    user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    group_id   INTEGER REFERENCES collection_groups(id) ON DELETE SET NULL, -- root collections only
    parent_id  INTEGER REFERENCES collections(id) ON DELETE CASCADE,
    name       TEXT NOT NULL,
    icon       TEXT,                        -- emoji
    color      TEXT,                        -- hex, tints the UI accent
    position   REAL NOT NULL,
    collapsed  INTEGER NOT NULL DEFAULT 0,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  );
  CREATE INDEX collections_user ON collections(user_id, parent_id);

  CREATE TABLE assets (
    id         INTEGER PRIMARY KEY,
    user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    kind       TEXT NOT NULL,               -- 'file' (upload) | 'cover' (cached preview image)
    mime       TEXT NOT NULL,
    size       INTEGER NOT NULL,
    filename   TEXT NOT NULL,
    created_at INTEGER NOT NULL
  );

  CREATE TABLE bookmarks (
    id             INTEGER PRIMARY KEY,
    user_id        INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    collection_id  INTEGER REFERENCES collections(id) ON DELETE SET NULL, -- NULL = Unsorted
    type           TEXT NOT NULL DEFAULT 'link',
    url            TEXT,
    normalized_url TEXT,                    -- for duplicate detection
    site           TEXT,
    title          TEXT NOT NULL DEFAULT '',
    description    TEXT NOT NULL DEFAULT '',
    note           TEXT NOT NULL DEFAULT '',
    cover_url      TEXT,                    -- remote preview image
    cover_asset_id INTEGER REFERENCES assets(id) ON DELETE SET NULL,
    favicon_url    TEXT,
    file_asset_id  INTEGER REFERENCES assets(id) ON DELETE SET NULL,
    content_html   TEXT,                    -- sanitized reader-view HTML
    content_text   TEXT,                    -- plain text, indexed for search
    favorite       INTEGER NOT NULL DEFAULT 0,
    position       REAL NOT NULL,           -- manual sort order within a collection
    fetch_status   TEXT NOT NULL DEFAULT 'pending',
    http_status    INTEGER,
    broken         INTEGER NOT NULL DEFAULT 0,
    fetched_at     INTEGER,
    created_at     INTEGER NOT NULL,
    updated_at     INTEGER NOT NULL,
    deleted_at     INTEGER                  -- set when moved to Trash
  );
  CREATE INDEX bookmarks_user_collection ON bookmarks(user_id, deleted_at, collection_id, position);
  CREATE INDEX bookmarks_user_created ON bookmarks(user_id, deleted_at, created_at);
  CREATE INDEX bookmarks_user_url ON bookmarks(user_id, normalized_url);
  CREATE INDEX bookmarks_fetch ON bookmarks(fetch_status);

  CREATE TABLE tags (
    id         INTEGER PRIMARY KEY,
    user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    name       TEXT NOT NULL COLLATE NOCASE,
    created_at INTEGER NOT NULL,
    UNIQUE (user_id, name)
  );

  CREATE TABLE bookmark_tags (
    bookmark_id INTEGER NOT NULL REFERENCES bookmarks(id) ON DELETE CASCADE,
    tag_id      INTEGER NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
    PRIMARY KEY (bookmark_id, tag_id)
  ) WITHOUT ROWID;
  CREATE INDEX bookmark_tags_tag ON bookmark_tags(tag_id);

  -- Full-text index. rowid = bookmarks.id; kept in sync by services/search-index.ts
  CREATE VIRTUAL TABLE bookmarks_fts USING fts5(
    title, description, note, content, url, tags,
    tokenize = 'porter unicode61 remove_diacritics 2'
  );

  CREATE TABLE backups (
    id             INTEGER PRIMARY KEY,
    user_id        INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    filename       TEXT NOT NULL,
    bookmark_count INTEGER NOT NULL,
    size           INTEGER NOT NULL,
    automatic      INTEGER NOT NULL DEFAULT 0,
    created_at     INTEGER NOT NULL
  );
  `,

  // Where each bookmark came from (web, bookmarklet, extension, api, import). NULL = saved before this was tracked.
  /* sql */ `ALTER TABLE bookmarks ADD COLUMN source TEXT;`,

  /* sql */ `
  -- Foreign-key actions (deleting an asset or collection) look rows up by these columns; without
  -- indexes every such delete scans the whole bookmarks table.
  CREATE INDEX bookmarks_cover_asset ON bookmarks(cover_asset_id) WHERE cover_asset_id IS NOT NULL;
  CREATE INDEX bookmarks_file_asset ON bookmarks(file_asset_id) WHERE file_asset_id IS NOT NULL;
  CREATE INDEX bookmarks_collection ON bookmarks(collection_id) WHERE collection_id IS NOT NULL;

  -- A hash of each backup's contents, so the daily backup can tell whether anything changed.
  ALTER TABLE backups ADD COLUMN hash TEXT;

  -- Site icons, cached locally once per user and icon URL (many bookmarks share one).
  CREATE TABLE favicons (
    user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    url        TEXT NOT NULL,
    asset_id   INTEGER NOT NULL REFERENCES assets(id) ON DELETE CASCADE,
    created_at INTEGER NOT NULL,
    PRIMARY KEY (user_id, url)
  ) WITHOUT ROWID;
  CREATE INDEX favicons_asset ON favicons(asset_id);
  `,
];
