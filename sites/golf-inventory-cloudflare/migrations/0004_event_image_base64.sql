-- R2 未利用環境向け: 画像を D1 に Base64 で保持（一覧 API では hasImage のみ返却）
ALTER TABLE events ADD COLUMN image_base64 TEXT;
