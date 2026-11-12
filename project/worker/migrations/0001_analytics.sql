-- Counts are server-dated in UTC. No names, IP addresses, full URLs, or
-- persistent visitor IDs belong in this database.
CREATE TABLE IF NOT EXISTS analytics_meta (
  name TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS analytics_daily (
  day TEXT PRIMARY KEY,
  visits INTEGER NOT NULL DEFAULT 0,
  page_views INTEGER NOT NULL DEFAULT 0,
  plays INTEGER NOT NULL DEFAULT 0,
  completions INTEGER NOT NULL DEFAULT 0,
  downloads INTEGER NOT NULL DEFAULT 0,
  offer_clicks INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS analytics_pages (
  day TEXT NOT NULL,
  path TEXT NOT NULL,
  views INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (day, path)
);

CREATE TABLE IF NOT EXISTS analytics_tracks (
  day TEXT NOT NULL,
  track_id TEXT NOT NULL,
  plays INTEGER NOT NULL DEFAULT 0,
  completions INTEGER NOT NULL DEFAULT 0,
  downloads INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (day, track_id)
);

CREATE TABLE IF NOT EXISTS analytics_offers (
  day TEXT NOT NULL,
  offer_id TEXT NOT NULL,
  clicks INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (day, offer_id)
);

-- Hashed, random, tab-session IDs only. These rows expire after two days.
CREATE TABLE IF NOT EXISTS analytics_sessions (
  session_key TEXT PRIMARY KEY,
  day TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS analytics_sessions_day ON analytics_sessions(day);

CREATE TABLE IF NOT EXISTS analytics_events (
  event_key TEXT PRIMARY KEY,
  dedupe_key TEXT NOT NULL UNIQUE,
  session_key TEXT NOT NULL,
  day TEXT NOT NULL,
  type TEXT NOT NULL CHECK(type IN ('page_view','track_play','track_complete','track_download','offer_click')),
  path TEXT NOT NULL,
  target TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS analytics_events_session_type_target ON analytics_events(session_key, type, target);
CREATE INDEX IF NOT EXISTS analytics_events_day ON analytics_events(day);

-- A single conditional INSERT owns idempotency and aggregation. Trigger writes
-- share that statement's transaction, including when simultaneous retries race.
CREATE TRIGGER IF NOT EXISTS analytics_count_event AFTER INSERT ON analytics_events
BEGIN
  INSERT OR IGNORE INTO analytics_meta(name, value) VALUES ('startedAt', NEW.day);
  INSERT INTO analytics_daily(day, page_views, plays, completions, downloads, offer_clicks)
    VALUES (NEW.day, NEW.type='page_view', NEW.type='track_play', NEW.type='track_complete', NEW.type='track_download', NEW.type='offer_click')
    ON CONFLICT(day) DO UPDATE SET
      page_views=page_views+excluded.page_views,
      plays=plays+excluded.plays,
      completions=completions+excluded.completions,
      downloads=downloads+excluded.downloads,
      offer_clicks=offer_clicks+excluded.offer_clicks;

  INSERT INTO analytics_pages(day, path, views)
    SELECT NEW.day, NEW.path, 1 WHERE NEW.type='page_view'
    ON CONFLICT(day, path) DO UPDATE SET views=views+1;
  INSERT INTO analytics_tracks(day, track_id, plays, completions, downloads)
    SELECT NEW.day, NEW.target, NEW.type='track_play', NEW.type='track_complete', NEW.type='track_download'
      WHERE NEW.type IN ('track_play','track_complete','track_download')
    ON CONFLICT(day, track_id) DO UPDATE SET
      plays=plays+excluded.plays, completions=completions+excluded.completions, downloads=downloads+excluded.downloads;
  INSERT INTO analytics_offers(day, offer_id, clicks)
    SELECT NEW.day, NEW.target, 1 WHERE NEW.type='offer_click'
    ON CONFLICT(day, offer_id) DO UPDATE SET clicks=clicks+1;
  INSERT OR IGNORE INTO analytics_sessions(session_key, day)
    SELECT NEW.session_key, NEW.day WHERE NEW.type='page_view';
END;

CREATE TRIGGER IF NOT EXISTS analytics_count_visit AFTER INSERT ON analytics_sessions
BEGIN
  UPDATE analytics_daily SET visits=visits+1 WHERE day=NEW.day;
END;
