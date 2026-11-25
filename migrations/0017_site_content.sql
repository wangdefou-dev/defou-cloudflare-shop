-- Site copy, images, words and module switches edited in the admin ("网站内容").
-- config/store.json supplies defaults; this row holds the full edited document.
CREATE TABLE site_content (
 id INTEGER PRIMARY KEY CHECK(id=1),data TEXT NOT NULL,version INTEGER NOT NULL,
 actor TEXT NOT NULL,updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
-- Every published version, so any earlier one can be restored.
CREATE TABLE site_content_history (
 version INTEGER PRIMARY KEY,data TEXT NOT NULL,actor TEXT NOT NULL,note TEXT NOT NULL DEFAULT '',
 created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
