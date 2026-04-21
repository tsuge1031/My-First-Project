-- 持ち物マスタ
CREATE TABLE master_items (
  id TEXT PRIMARY KEY,
  category TEXT NOT NULL,
  name TEXT NOT NULL
);

-- ラウンド（日付が主キー）
CREATE TABLE events (
  date TEXT PRIMARY KEY,
  golf_course TEXT NOT NULL DEFAULT '',
  score INTEGER
);

-- 同伴者（表示順は idx）
CREATE TABLE event_companions (
  event_date TEXT NOT NULL,
  idx INTEGER NOT NULL,
  name TEXT NOT NULL,
  PRIMARY KEY (event_date, idx)
);

-- ラウンドに紐づく持ち物
CREATE TABLE event_items (
  event_date TEXT NOT NULL,
  item_id TEXT NOT NULL,
  PRIMARY KEY (event_date, item_id)
);

CREATE INDEX idx_event_companions_date ON event_companions (event_date);
CREATE INDEX idx_event_items_date ON event_items (event_date);
