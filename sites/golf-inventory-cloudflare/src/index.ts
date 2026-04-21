import { Hono } from "hono";

const ALLOWED_CATEGORIES = new Set([
  "golf_wear",
  "non_golf_clothes",
  "items",
  "other",
]);

export type Env = {
  golf_inventory: D1Database;
  /** wrangler.toml に [[r2_buckets]] があるときのみ付与 */
  golf_uploads?: R2Bucket;
  ASSETS: Fetcher;
  API_KEY?: string;
  /** R2 追跡バイト合計のソフト上限（文字列の数値）。未設定時は 8 GiB */
  R2_SOFT_LIMIT_BYTES?: string;
};

const MAX_NOTES_LEN = 20_000;
const MAX_IMAGE_BYTES_R2 = 5 * 1024 * 1024;
const MAX_IMAGE_BYTES_D1 = 2 * 1024 * 1024;
const ALLOWED_IMAGE_TYPES = new Set(["image/jpeg", "image/png", "image/gif", "image/webp"]);
/** 無料枠手前のデフォルト（10GB ストレージ想定のバッファ）。実課金は Cloudflare 側の真値と一致しない場合あり */
const DEFAULT_R2_SOFT_LIMIT_BYTES = 8 * 1024 * 1024 * 1024;
const R2_PRICING_URL = "https://developers.cloudflare.com/r2/pricing/";

type MasterRow = { id: string; category: string; name: string };
type EventRow = {
  date: string;
  golf_course: string;
  score: number | null;
  notes: string | null;
  image_key: string | null;
  image_content_type: string | null;
  has_image: number;
};

function err(c: { json: (b: unknown, s: number) => Response }, status: number, message: string) {
  return c.json({ error: message }, status);
}

function parseR2SoftLimitBytes(raw: string | undefined): number {
  const n = raw != null && raw !== "" ? Number(raw) : NaN;
  if (!Number.isFinite(n) || n <= 0) return DEFAULT_R2_SOFT_LIMIT_BYTES;
  return Math.floor(n);
}

function errR2Quota(c: { json: (b: unknown, s: number) => Response }) {
  return c.json(
    {
      error:
        "このアプリで追跡している R2 保存量が設定上限を超えるためアップロードできません。無料枠・従量課金は Cloudflare の公式（pricing / terms）を確認してください。",
      pricingUrl: R2_PRICING_URL,
      termsUrl: "https://www.cloudflare.com/terms/",
    },
    403
  );
}

function u8ToBase64(u8: Uint8Array): string {
  let bin = "";
  const chunk = 0x8000;
  for (let i = 0; i < u8.length; i += chunk) {
    bin += String.fromCharCode.apply(null, u8.subarray(i, i + chunk) as unknown as number[]);
  }
  return btoa(bin);
}

function base64ToU8(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

async function loadEvents(db: D1Database) {
  const { results: eventRows } = await db
    .prepare(
      `SELECT date, golf_course, score, notes, image_key, image_content_type,
        CASE
          WHEN (image_base64 IS NOT NULL AND length(image_base64) > 0)
            OR (image_key IS NOT NULL AND image_key != '') THEN 1
          ELSE 0
        END AS has_image
       FROM events ORDER BY date DESC`
    )
    .all<EventRow>();

  const out: {
    date: string;
    golfCourse: string;
    score: number | null;
    notes: string;
    hasImage: boolean;
    companionNames: string[];
    itemIds: string[];
  }[] = [];

  for (const row of eventRows || []) {
    const date = row.date;
    const comp = await db
      .prepare("SELECT name FROM event_companions WHERE event_date = ? ORDER BY idx ASC")
      .bind(date)
      .all<{ name: string }>();
    let companionNames = (comp.results || []).map((r) => r.name);
    if (companionNames.length === 0) companionNames = [""];

    const items = await db
      .prepare("SELECT item_id FROM event_items WHERE event_date = ?")
      .bind(date)
      .all<{ item_id: string }>();
    const itemIds = (items.results || []).map((r) => r.item_id);

    out.push({
      date,
      golfCourse: row.golf_course ?? "",
      score: row.score === null || row.score === undefined ? null : Number(row.score),
      notes: row.notes ?? "",
      hasImage: Number(row.has_image) === 1,
      companionNames,
      itemIds,
    });
  }
  return out;
}

async function buildState(db: D1Database) {
  const { results: masters } = await db
    .prepare("SELECT id, category, name FROM master_items ORDER BY category ASC, name ASC")
    .all<MasterRow>();
  const events = await loadEvents(db);
  return {
    masterItems: masters || [],
    events,
  };
}

function validateCompanions(names: unknown): { ok: true; names: string[] } | { ok: false; error: string } {
  if (!Array.isArray(names)) return { ok: false, error: "companionNames は配列である必要があります。" };
  const trimmed = names.map((n) => String(n ?? "").trim()).filter(Boolean);
  if (trimmed.length < 1) return { ok: false, error: "同伴者は自分以外に最低1名（合計2名）入力してください。" };
  if (trimmed.length > 3) return { ok: false, error: "同伴者は自分以外最大3名（合計4名）までです。" };
  return { ok: true, names: trimmed };
}

function parseScore(raw: unknown): number | null | "invalid" {
  if (raw === null || raw === undefined || raw === "") return null;
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 0 || n > 200) return "invalid";
  return Math.round(n);
}

const app = new Hono<{ Bindings: Env }>();

app.use("/api/*", async (c, next) => {
  const path = new URL(c.req.url).pathname;
  const publicImageGet = c.req.method === "GET" && /^\/api\/events\/[^/]+\/image$/.test(path);
  if (!publicImageGet) {
    const key = c.env.API_KEY;
    if (key) {
      const auth = c.req.header("Authorization");
      if (auth !== `Bearer ${key}`) return c.json({ error: "Unauthorized" }, 401);
    }
  }
  await next();
});

app.get("/api/state", async (c) => {
  const data = await buildState(c.env.golf_inventory);
  return c.json(data);
});

app.get("/api/events/:date/image", async (c) => {
  const date = c.req.param("date");
  const row = await c.env.golf_inventory
    .prepare("SELECT image_key, image_base64, image_content_type FROM events WHERE date = ?")
    .bind(date)
    .first<{
      image_key: string | null;
      image_base64: string | null;
      image_content_type: string | null;
    }>();
  if (!row) return err(c, 404, "ラウンドが見つかりません。");

  if (row.image_key && row.image_key.length > 0) {
    if (!c.env.golf_uploads) {
      return err(c, 503, "画像は R2 に保存されていますが、Worker に R2 バインディングがありません。wrangler.toml を確認してください。");
    }
    const obj = await c.env.golf_uploads.get(row.image_key);
    if (!obj?.body) return err(c, 404, "画像を取得できませんでした。");
    const ct = row.image_content_type || obj.httpMetadata?.contentType || "application/octet-stream";
    return new Response(obj.body, {
      headers: {
        "Content-Type": ct,
        "Cache-Control": "private, max-age=3600",
      },
    });
  }

  if (row.image_base64 && row.image_base64.length > 0) {
    let bytes: Uint8Array;
    try {
      bytes = base64ToU8(row.image_base64);
    } catch {
      return err(c, 500, "画像データが壊れています。");
    }
    const ct = row.image_content_type || "application/octet-stream";
    return new Response(bytes, {
      headers: {
        "Content-Type": ct,
        "Cache-Control": "private, max-age=3600",
      },
    });
  }
  return err(c, 404, "画像がありません。");
});

app.post("/api/master-items", async (c) => {
  let body: { category?: string; name?: string };
  try {
    body = await c.req.json();
  } catch {
    return err(c, 400, "JSON が不正です。");
  }
  const category = body.category;
  const name = String(body.name ?? "").trim();
  if (!category || !ALLOWED_CATEGORIES.has(category)) return err(c, 400, "カテゴリが不正です。");
  if (!name) return err(c, 400, "持ち物名を入力してください。");
  const id = crypto.randomUUID();
  await c.env.golf_inventory.prepare("INSERT INTO master_items (id, category, name) VALUES (?, ?, ?)").bind(id, category, name).run();
  return c.json({ id, category, name });
});

app.delete("/api/master-items/:id", async (c) => {
  const id = c.req.param("id");
  await c.env.golf_inventory.batch([
    c.env.golf_inventory.prepare("DELETE FROM event_items WHERE item_id = ?").bind(id),
    c.env.golf_inventory.prepare("DELETE FROM master_items WHERE id = ?").bind(id),
  ]);
  return c.json({ ok: true });
});

app.post("/api/events", async (c) => {
  let body: { date?: string };
  try {
    body = await c.req.json();
  } catch {
    return err(c, 400, "JSON が不正です。");
  }
  const date = body.date;
  if (!date) return err(c, 400, "日付を指定してください。");
  const exists = await c.env.golf_inventory.prepare("SELECT 1 FROM events WHERE date = ?").bind(date).first();
  if (exists) return err(c, 409, "その日付のラウンドは既に登録されています。");
  await c.env.golf_inventory.batch([
    c.env.golf_inventory.prepare("INSERT INTO events (date, golf_course, score, notes) VALUES (?, '', NULL, '')").bind(date),
    c.env.golf_inventory.prepare("INSERT INTO event_companions (event_date, idx, name) VALUES (?, 0, '')").bind(date),
  ]);
  return c.json({ date });
});

app.post("/api/events/:date/image", async (c) => {
  const date = c.req.param("date");
  const prev = await c.env.golf_inventory
    .prepare("SELECT image_key, image_size_bytes FROM events WHERE date = ?")
    .bind(date)
    .first<{ image_key: string | null; image_size_bytes: number | null }>();
  if (!prev) return err(c, 404, "ラウンドが見つかりません。");

  let formData: FormData;
  try {
    formData = await c.req.formData();
  } catch {
    return err(c, 400, "multipart 形式で file を送ってください。");
  }
  const fileField = formData.get("file");
  if (!fileField || typeof fileField === "string") return err(c, 400, "file が必要です。");
  const file = fileField as File;
  if (!ALLOWED_IMAGE_TYPES.has(file.type)) {
    return err(c, 400, "画像は JPEG / PNG / GIF / WebP のみです。");
  }
  const uploads = c.env.golf_uploads;
  const useR2 = !!uploads;
  const maxBytes = useR2 ? MAX_IMAGE_BYTES_R2 : MAX_IMAGE_BYTES_D1;
  if (file.size > maxBytes) {
    return err(c, 400, useR2 ? "画像は 5MB 以下にしてください。" : "画像は 2MB 以下にしてください。（R2 有効化で 5MB まで）");
  }

  if (useR2) {
    const others = await c.env.golf_inventory
      .prepare("SELECT COALESCE(SUM(image_size_bytes), 0) AS s FROM events WHERE date != ?")
      .bind(date)
      .first<{ s: number | string | null }>();
    const othersSum = Number(others?.s ?? 0);
    const projectedTotal = othersSum + file.size;
    const limit = parseR2SoftLimitBytes(c.env.R2_SOFT_LIMIT_BYTES);
    if (projectedTotal > limit) {
      return errR2Quota(c);
    }
  }

  if (prev.image_key && uploads) {
    try {
      await uploads.delete(prev.image_key);
    } catch {
      /* ignore */
    }
  }

  if (useR2 && uploads) {
    const newKey = `round/${crypto.randomUUID()}`;
    await uploads.put(newKey, file.stream(), {
      httpMetadata: { contentType: file.type },
    });
    await c.env.golf_inventory
      .prepare(
        "UPDATE events SET image_key = ?, image_content_type = ?, image_base64 = NULL, image_size_bytes = ? WHERE date = ?"
      )
      .bind(newKey, file.type, file.size, date)
      .run();
  } else {
    const buf = new Uint8Array(await file.arrayBuffer());
    const b64 = u8ToBase64(buf);
    await c.env.golf_inventory
      .prepare(
        "UPDATE events SET image_base64 = ?, image_content_type = ?, image_key = NULL, image_size_bytes = NULL WHERE date = ?"
      )
      .bind(b64, file.type, date)
      .run();
  }

  return c.json({ ok: true, contentType: file.type, storage: useR2 ? "r2" : "d1" });
});

app.delete("/api/events/:date/image", async (c) => {
  const date = c.req.param("date");
  const row = await c.env.golf_inventory
    .prepare("SELECT image_key FROM events WHERE date = ?")
    .bind(date)
    .first<{ image_key: string | null }>();
  if (!row) return err(c, 404, "ラウンドが見つかりません。");
  if (row.image_key && c.env.golf_uploads) {
    try {
      await c.env.golf_uploads.delete(row.image_key);
    } catch {
      /* ignore */
    }
  }
  await c.env.golf_inventory
    .prepare(
      "UPDATE events SET image_base64 = NULL, image_content_type = NULL, image_key = NULL, image_size_bytes = NULL WHERE date = ?"
    )
    .bind(date)
    .run();
  return c.json({ ok: true });
});

app.delete("/api/events/:date", async (c) => {
  const date = c.req.param("date");
  const img = await c.env.golf_inventory
    .prepare("SELECT image_key FROM events WHERE date = ?")
    .bind(date)
    .first<{ image_key: string | null }>();
  if (img?.image_key && c.env.golf_uploads) {
    try {
      await c.env.golf_uploads.delete(img.image_key);
    } catch {
      /* ignore */
    }
  }
  await c.env.golf_inventory.batch([
    c.env.golf_inventory.prepare("DELETE FROM event_items WHERE event_date = ?").bind(date),
    c.env.golf_inventory.prepare("DELETE FROM event_companions WHERE event_date = ?").bind(date),
    c.env.golf_inventory.prepare("DELETE FROM events WHERE date = ?").bind(date),
  ]);
  return c.json({ ok: true });
});

app.patch("/api/events/:date/companions", async (c) => {
  const oldDate = c.req.param("date");
  let body: { companionNames?: unknown };
  try {
    body = await c.req.json();
  } catch {
    return err(c, 400, "JSON が不正です。");
  }
  if (!Array.isArray(body.companionNames)) return err(c, 400, "companionNames は配列である必要があります。");
  const names = body.companionNames.map((n) => String(n ?? ""));
  if (names.length < 1 || names.length > 3) {
    return err(c, 400, "同伴者欄は自分以外 1〜3 行である必要があります。");
  }
  const ev = await c.env.golf_inventory.prepare("SELECT date FROM events WHERE date = ?").bind(oldDate).first();
  if (!ev) return err(c, 404, "ラウンドが見つかりません。");

  const stmts: D1PreparedStatement[] = [
    c.env.golf_inventory.prepare("DELETE FROM event_companions WHERE event_date = ?").bind(oldDate),
  ];
  names.forEach((name, idx) => {
    stmts.push(
      c.env.golf_inventory.prepare("INSERT INTO event_companions (event_date, idx, name) VALUES (?, ?, ?)").bind(oldDate, idx, name)
    );
  });
  await c.env.golf_inventory.batch(stmts);
  return c.json({ ok: true });
});

app.put("/api/events/:date", async (c) => {
  const oldDate = c.req.param("date");
  let body: {
    date?: string;
    golfCourse?: string;
    score?: unknown;
    notes?: unknown;
    companionNames?: unknown;
    itemIds?: unknown;
  };
  try {
    body = await c.req.json();
  } catch {
    return err(c, 400, "JSON が不正です。");
  }
  const newDate = body.date;
  const golfCourse = String(body.golfCourse ?? "").trim();
  const notes = String(body.notes ?? "").slice(0, MAX_NOTES_LEN);
  const score = parseScore(body.score);
  if (score === "invalid") return err(c, 400, "スコアは 0〜200 の数値、または null/空欄にしてください。");
  const vc = validateCompanions(body.companionNames);
  if (!vc.ok) return err(c, 400, vc.error);
  if (!newDate) return err(c, 400, "日付を指定してください。");

  const itemIds = Array.isArray(body.itemIds) ? body.itemIds.map((x) => String(x)) : [];
  const masterRows = await c.env.golf_inventory.prepare("SELECT id FROM master_items").all<{ id: string }>();
  const masterIds = new Set((masterRows.results || []).map((r) => r.id));
  for (const iid of itemIds) {
    if (!masterIds.has(iid)) return err(c, 400, "存在しないマスタ項目が itemIds に含まれています。");
  }

  const ev = await c.env.golf_inventory.prepare("SELECT date FROM events WHERE date = ?").bind(oldDate).first();
  if (!ev) return err(c, 404, "ラウンドが見つかりません。");

  if (newDate !== oldDate) {
    const clash = await c.env.golf_inventory.prepare("SELECT 1 FROM events WHERE date = ?").bind(newDate).first();
    if (clash) return err(c, 409, "変更先の日付には既に別のラウンドが存在します。");
  }

  const stmts: D1PreparedStatement[] = [];
  const dateKey = newDate;

  if (newDate !== oldDate) {
    stmts.push(c.env.golf_inventory.prepare("UPDATE event_companions SET event_date = ? WHERE event_date = ?").bind(newDate, oldDate));
    stmts.push(c.env.golf_inventory.prepare("UPDATE event_items SET event_date = ? WHERE event_date = ?").bind(newDate, oldDate));
    stmts.push(
      c.env.golf_inventory
        .prepare("UPDATE events SET date = ?, golf_course = ?, score = ?, notes = ? WHERE date = ?")
        .bind(newDate, golfCourse, score, notes, oldDate)
    );
  } else {
    stmts.push(
      c.env.golf_inventory.prepare("UPDATE events SET golf_course = ?, score = ?, notes = ? WHERE date = ?").bind(golfCourse, score, notes, oldDate)
    );
  }

  stmts.push(c.env.golf_inventory.prepare("DELETE FROM event_companions WHERE event_date = ?").bind(dateKey));
  vc.names.forEach((name, idx) => {
    stmts.push(
      c.env.golf_inventory.prepare("INSERT INTO event_companions (event_date, idx, name) VALUES (?, ?, ?)").bind(dateKey, idx, name)
    );
  });

  stmts.push(c.env.golf_inventory.prepare("DELETE FROM event_items WHERE event_date = ?").bind(dateKey));
  for (const iid of itemIds) {
    stmts.push(c.env.golf_inventory.prepare("INSERT INTO event_items (event_date, item_id) VALUES (?, ?)").bind(dateKey, iid));
  }

  await c.env.golf_inventory.batch(stmts);
  return c.json({ ok: true, date: dateKey });
});

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname.startsWith("/api")) {
      return app.fetch(request, env, ctx);
    }
    return env.ASSETS.fetch(request);
  },
};
