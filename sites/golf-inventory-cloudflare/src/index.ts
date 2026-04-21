import { Hono } from "hono";

const ALLOWED_CATEGORIES = new Set([
  "golf_wear",
  "non_golf_clothes",
  "items",
  "other",
]);

export type Env = {
  golf_inventory: D1Database;
  ASSETS: Fetcher;
  API_KEY?: string;
};

type MasterRow = { id: string; category: string; name: string };
type EventRow = { date: string; golf_course: string; score: number | null };

function err(c: { json: (b: unknown, s: number) => Response }, status: number, message: string) {
  return c.json({ error: message }, status);
}

async function loadEvents(db: D1Database) {
  const { results: eventRows } = await db
    .prepare("SELECT date, golf_course, score FROM events ORDER BY date DESC")
    .all<EventRow>();

  const out: {
    date: string;
    golfCourse: string;
    score: number | null;
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
  const key = c.env.API_KEY;
  if (key) {
    const auth = c.req.header("Authorization");
    if (auth !== `Bearer ${key}`) return c.json({ error: "Unauthorized" }, 401);
  }
  await next();
});

app.get("/api/state", async (c) => {
  const data = await buildState(c.env.golf_inventory);
  return c.json(data);
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
    c.env.golf_inventory.prepare("INSERT INTO events (date, golf_course, score) VALUES (?, '', NULL)").bind(date),
    c.env.golf_inventory.prepare("INSERT INTO event_companions (event_date, idx, name) VALUES (?, 0, '')").bind(date),
  ]);
  return c.json({ date });
});

app.delete("/api/events/:date", async (c) => {
  const date = c.req.param("date");
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
      c.env.golf_inventory.prepare("UPDATE events SET date = ?, golf_course = ?, score = ? WHERE date = ?").bind(newDate, golfCourse, score, oldDate)
    );
  } else {
    stmts.push(c.env.golf_inventory.prepare("UPDATE events SET golf_course = ?, score = ? WHERE date = ?").bind(golfCourse, score, oldDate));
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
