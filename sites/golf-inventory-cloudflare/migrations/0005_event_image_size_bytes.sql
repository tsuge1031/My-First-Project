-- R2 保存時のオブジェクトサイズ（バイト）。D1 Base64 行では NULL のまま。
ALTER TABLE events ADD COLUMN image_size_bytes INTEGER;
