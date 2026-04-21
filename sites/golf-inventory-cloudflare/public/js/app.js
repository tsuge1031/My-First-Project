/**
 * ゴルフ持ち物・ラウンド管理（Cloudflare Worker + D1）
 */
const CATEGORIES = [
  { id: "golf_wear", label: "ゴルフウェア" },
  { id: "non_golf_clothes", label: "ゴルフ以外の着替え" },
  { id: "items", label: "アイテム" },
  { id: "other", label: "その他" },
];

const MIN_COMPANIONS = 1;
const MAX_COMPANIONS = 3;

const LS_API_KEY = "golf_inventory_api_key";

function authHeaders() {
  try {
    const k = localStorage.getItem(LS_API_KEY);
    if (k) return { Authorization: `Bearer ${k}` };
  } catch {
    /* ignore */
  }
  return {};
}

async function readApiError(res) {
  const t = await res.text();
  try {
    const j = JSON.parse(t);
    return j.error || t;
  } catch {
    return t || res.statusText;
  }
}

/** @type {number} */
let syncDepth = 0;

function setSyncUi() {
  const el = document.getElementById("sync-badge");
  if (!el) return;
  if (syncDepth > 0) {
    el.textContent = "サーバーと同期中…";
    el.classList.add("busy");
  } else {
    el.textContent = "データは Cloudflare D1 に保存されます";
    el.classList.remove("busy");
  }
}

async function withSync(fn) {
  syncDepth += 1;
  setSyncUi();
  try {
    return await fn();
  } finally {
    syncDepth -= 1;
    setSyncUi();
  }
}

async function apiJson(path, options = {}) {
  const headers = {
    Accept: "application/json",
    ...authHeaders(),
    ...options.headers,
  };
  if (options.body && !headers["Content-Type"]) {
    headers["Content-Type"] = "application/json";
  }
  const res = await fetch(path, { ...options, headers });
  if (!res.ok) throw new Error(await readApiError(res));
  if (res.status === 204) return null;
  const ct = res.headers.get("content-type") || "";
  if (!ct.includes("application/json")) return null;
  return res.json();
}

/** JSON 以外も扱う生 fetch（画像 POST 等） */
async function apiFetch(path, options = {}) {
  const headers = { ...authHeaders(), ...options.headers };
  const res = await fetch(path, { ...options, headers });
  if (!res.ok) throw new Error(await readApiError(res));
  return res;
}

function defaultState() {
  return { masterItems: [], events: [] };
}

async function refreshState() {
  const data = await withSync(() => apiJson("/api/state", { method: "GET" }));
  state = {
    masterItems: Array.isArray(data.masterItems) ? data.masterItems : [],
    events: Array.isArray(data.events) ? data.events : [],
  };
}

/** @type {ReturnType<typeof defaultState>} */
let state = defaultState();
let view = { tab: "master", eventDate: null };
let message = { type: "", text: "" };
let bootError = "";

/**
 * ラウンド詳細の未保存入力（同伴者の行追加などでサーバー同期しない）
 * @type {null | {
 *   sourceDate: string;
 *   date: string;
 *   golfCourse: string;
 *   scoreText: string;
 *   scoreFieldError: string;
 *   companionNames: string[];
 *   itemIds: string[];
 *   notes: string;
 *   hasImage: boolean;
 * }}
 */
let detailDraft = null;

function initDetailDraftFromServer(date) {
  const ev = getEventByDate(date);
  if (!ev) {
    detailDraft = null;
    return;
  }
  detailDraft = {
    sourceDate: date,
    date: ev.date,
    golfCourse: ev.golfCourse || "",
    scoreText: ev.score != null && ev.score !== "" ? String(ev.score) : "",
    scoreFieldError: "",
    companionNames: [...(ev.companionNames && ev.companionNames.length ? ev.companionNames : [""])],
    itemIds: [...(ev.itemIds || [])],
    notes: typeof ev.notes === "string" ? ev.notes : "",
    hasImage: !!ev.hasImage,
  };
}

function mergeServerImageIntoDraft(sourceDate) {
  if (!detailDraft || detailDraft.sourceDate !== sourceDate) return;
  const ev2 = getEventByDate(sourceDate);
  if (!ev2) return;
  detailDraft.hasImage = !!ev2.hasImage;
}

async function uploadRoundImage(sourceDate, file) {
  const fd = new FormData();
  fd.append("file", file);
  await withSync(() =>
    apiFetch(`/api/events/${encodeURIComponent(sourceDate)}/image`, {
      method: "POST",
      body: fd,
    })
  );
  await refreshState();
  mergeServerImageIntoDraft(sourceDate);
}

async function deleteRoundImage(sourceDate) {
  await withSync(() =>
    apiFetch(`/api/events/${encodeURIComponent(sourceDate)}/image`, { method: "DELETE" })
  );
  await refreshState();
  mergeServerImageIntoDraft(sourceDate);
}

function syncDetailDraftFromForm(form) {
  if (!detailDraft) return;
  detailDraft.date = form.querySelector('[name="date"]')?.value ?? detailDraft.date;
  detailDraft.golfCourse = form.querySelector('[name="golfCourse"]')?.value ?? "";
  const notesEl = form.querySelector('[name="notes"]');
  if (notesEl) detailDraft.notes = notesEl.value;
  const scoreEl = form.querySelector('[name="score"]');
  if (scoreEl) {
    const raw = String(scoreEl.value ?? "");
    if (/^[0-9]*$/.test(raw)) {
      detailDraft.scoreText = raw;
      detailDraft.scoreFieldError = "";
    }
  }
  detailDraft.companionNames = [...form.querySelectorAll('[name="companion"]')].map((el) => el.value);
  detailDraft.itemIds = [...form.querySelectorAll('input[name="item"]:checked')].map((el) => el.value);
}

function detailFormEl() {
  return document.querySelector("#view-event-detail form");
}

function setMessage(type, text) {
  message = { type, text };
  renderMessage();
}

function renderMessage() {
  const el = document.getElementById("global-message");
  if (!el) return;
  el.className = "hidden";
  el.textContent = "";
  const text = bootError || message.text;
  if (!text) return;
  el.textContent = text;
  el.className = bootError || message.type === "error" ? "error-banner" : message.type === "success" ? "success-banner" : "hidden";
}

function setTab(tab) {
  if (tab === "event-detail" && !view.eventDate) {
    view = { ...view, tab: "events" };
  } else {
    if (tab === "events" && view.tab === "event-detail") {
      detailDraft = null;
    }
    view = { ...view, tab };
  }
  render();
}

function openEvent(date) {
  if (view.eventDate !== date) {
    detailDraft = null;
  }
  view = { tab: "event-detail", eventDate: date };
  render();
}

function getEventByDate(date) {
  return state.events.find((e) => e.date === date) || null;
}

function eventDatesSorted() {
  return [...state.events].sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));
}

function validateCompanions(names) {
  const trimmed = names.map((n) => String(n || "").trim()).filter(Boolean);
  if (trimmed.length < MIN_COMPANIONS) {
    return { ok: false, error: `同伴者は自分以外に最低${MIN_COMPANIONS}名（合計2名）入力してください。` };
  }
  if (trimmed.length > MAX_COMPANIONS) {
    return { ok: false, error: `同伴者は自分以外最大${MAX_COMPANIONS}名（合計4名）までです。` };
  }
  return { ok: true, names: trimmed };
}

function validateEventDate(date, excludeDate) {
  if (!date) return { ok: false, error: "日付を選択してください。" };
  if (excludeDate !== date && state.events.some((e) => e.date === date)) {
    return { ok: false, error: "その日付のラウンドは既に登録されています。" };
  }
  return { ok: true };
}

function parseScore(raw) {
  const s = String(raw ?? "").trim();
  if (s === "") return null;
  const n = Number(s);
  if (!Number.isFinite(n) || n < 0 || n > 200) return NaN;
  return Math.round(n);
}

async function addMasterItem(category, name) {
  const n = String(name || "").trim();
  if (!n) {
    setMessage("error", "持ち物名を入力してください。");
    return;
  }
  if (!CATEGORIES.some((c) => c.id === category)) {
    setMessage("error", "カテゴリが不正です。");
    return;
  }
  try {
    await withSync(() => apiJson("/api/master-items", { method: "POST", body: JSON.stringify({ category, name: n }) }));
    await refreshState();
    setMessage("success", "マスタに追加しました。");
  } catch (e) {
    setMessage("error", e instanceof Error ? e.message : String(e));
  }
  render();
}

async function deleteMasterItem(id) {
  if (!confirm("このマスタ項目を削除しますか？関連するラウンドのチェックも外れます。")) return;
  try {
    await withSync(() => apiJson(`/api/master-items/${encodeURIComponent(id)}`, { method: "DELETE" }));
    await refreshState();
    setMessage("success", "削除しました。");
  } catch (e) {
    setMessage("error", e instanceof Error ? e.message : String(e));
  }
  render();
}

async function createEvent(date) {
  const vd = validateEventDate(date, null);
  if (!vd.ok) {
    setMessage("error", vd.error);
    return;
  }
  try {
    await withSync(() => apiJson("/api/events", { method: "POST", body: JSON.stringify({ date }) }));
    await refreshState();
    setMessage("success", "ラウンドを作成しました。");
    openEvent(date);
  } catch (e) {
    setMessage("error", e instanceof Error ? e.message : String(e));
    render();
  }
}

async function deleteEvent(date) {
  if (!confirm("このラウンドを削除しますか？")) return;
  const wasViewing = view.eventDate === date;
  try {
    await withSync(() => apiJson(`/api/events/${encodeURIComponent(date)}`, { method: "DELETE" }));
    await refreshState();
    if (wasViewing) {
      detailDraft = null;
      view = { ...view, eventDate: null, tab: "events" };
    }
    setMessage("success", "削除しました。");
  } catch (e) {
    setMessage("error", e instanceof Error ? e.message : String(e));
  }
  render();
}

function addCompanionField(sourceDate) {
  const form = detailFormEl();
  if (form) syncDetailDraftFromForm(form);
  if (!detailDraft || detailDraft.sourceDate !== sourceDate) return;
  const list = [...detailDraft.companionNames];
  if (list.length >= MAX_COMPANIONS) {
    setMessage("error", `同伴者は自分以外最大${MAX_COMPANIONS}名までです。`);
    return;
  }
  list.push("");
  detailDraft.companionNames = list;
  setMessage("", "");
  render();
}

function removeCompanionField(sourceDate, index) {
  const form = detailFormEl();
  if (form) syncDetailDraftFromForm(form);
  if (!detailDraft || detailDraft.sourceDate !== sourceDate) return;
  const list = [...detailDraft.companionNames];
  if (list.length <= MIN_COMPANIONS) {
    setMessage("error", `同伴者は自分以外最低${MIN_COMPANIONS}名必要です。`);
    return;
  }
  list.splice(index, 1);
  detailDraft.companionNames = list;
  setMessage("", "");
  render();
}

async function saveEventDetail(sourceDate, form) {
  syncDetailDraftFromForm(form);
  const newDate = form.querySelector('[name="date"]').value;
  const golfCourse = form.querySelector('[name="golfCourse"]').value.trim();
  const notes = form.querySelector('[name="notes"]')?.value ?? "";
  const scoreRaw = String(form.querySelector('[name="score"]')?.value ?? "").trim();
  if (!/^[0-9]*$/.test(scoreRaw)) {
    setMessage("error", "スコアは半角数字（0〜9）のみ入力できます。空欄は可です。");
    return;
  }
  const score = parseScore(scoreRaw);
  if (Number.isNaN(score)) {
    setMessage("error", "スコアは 0〜200 の半角数字、または空欄にしてください。");
    return;
  }
  const nameInputs = [...form.querySelectorAll('[name="companion"]')];
  const names = nameInputs.map((inp) => inp.value);
  const vc = validateCompanions(names);
  if (!vc.ok) {
    setMessage("error", vc.error);
    return;
  }
  const vd = validateEventDate(newDate, sourceDate);
  if (!vd.ok) {
    setMessage("error", vd.error);
    return;
  }
  const checkboxes = [...form.querySelectorAll('input[name="item"]:checked')];
  const itemIds = checkboxes.map((c) => c.value);

  try {
    const res = await withSync(() =>
      apiJson(`/api/events/${encodeURIComponent(sourceDate)}`, {
        method: "PUT",
        body: JSON.stringify({
          date: newDate,
          golfCourse,
          notes,
          score,
          companionNames: vc.names,
          itemIds,
        }),
      })
    );
    await refreshState();
    const savedDate = res && res.date ? res.date : newDate;
    initDetailDraftFromServer(savedDate);
    view = { ...view, eventDate: savedDate };
    setMessage("success", "保存しました。");
  } catch (e) {
    setMessage("error", e instanceof Error ? e.message : String(e));
  }
  render();
}

function renderNav() {
  const tabs = document.getElementById("nav-tabs");
  if (!tabs) return;
  tabs.innerHTML = "";
  const mk = (id, label) => {
    const b = document.createElement("button");
    b.type = "button";
    b.textContent = label;
    if (view.tab === id) b.classList.add("active");
    b.addEventListener("click", () => setTab(id));
    return b;
  };
  tabs.appendChild(mk("master", "持ち物マスタ"));
  tabs.appendChild(mk("events", "ラウンド一覧"));
  if (view.eventDate) {
    const b = document.createElement("button");
    b.type = "button";
    b.textContent = "ラウンド詳細";
    if (view.tab === "event-detail") b.classList.add("active");
    b.addEventListener("click", () => setTab("event-detail"));
    tabs.appendChild(b);
  }
  tabs.appendChild(mk("score-history", "スコア履歴"));
}

function renderMaster() {
  const root = document.getElementById("view-master");
  if (!root) return;
  root.innerHTML = "";

  const hint = document.createElement("p");
  hint.className = "hint";
  hint.textContent =
    "カテゴリ別に持ち物マスタを登録します。ラウンドごとに、このマスタから持ち物を選べます。データは D1 に保存されます。";
  root.appendChild(hint);

  CATEGORIES.forEach((cat) => {
    const block = document.createElement("div");
    block.className = "category-block";
    const h3 = document.createElement("h3");
    h3.textContent = cat.label;
    block.appendChild(h3);

    const row = document.createElement("div");
    row.className = "row";
    const field = document.createElement("div");
    field.className = "field";
    const label = document.createElement("label");
    label.textContent = "新規追加";
    const input = document.createElement("input");
    input.type = "text";
    input.placeholder = "例：ポロシャツ";
    input.autocomplete = "off";
    field.appendChild(label);
    field.appendChild(input);
    const addBtn = document.createElement("button");
    addBtn.type = "button";
    addBtn.className = "btn btn-primary";
    addBtn.textContent = "追加";
    addBtn.addEventListener("click", async () => {
      await addMasterItem(cat.id, input.value);
      input.value = "";
      input.focus();
    });
    row.appendChild(field);
    row.appendChild(addBtn);
    block.appendChild(row);

    const items = state.masterItems.filter((m) => m.category === cat.id);
    if (items.length === 0) {
      const empty = document.createElement("p");
      empty.className = "empty-state";
      empty.textContent = "まだありません";
      block.appendChild(empty);
    } else {
      const ul = document.createElement("ul");
      ul.className = "item-list";
      items.forEach((m) => {
        const li = document.createElement("li");
        const span = document.createElement("span");
        span.className = "item-name";
        span.textContent = m.name;
        const del = document.createElement("button");
        del.type = "button";
        del.className = "btn btn-danger btn-small";
        del.textContent = "削除";
        del.addEventListener("click", () => deleteMasterItem(m.id));
        li.appendChild(span);
        li.appendChild(del);
        ul.appendChild(li);
      });
      block.appendChild(ul);
    }
    root.appendChild(block);
  });
}

function renderEvents() {
  const root = document.getElementById("view-events");
  if (!root) return;
  root.innerHTML = "";

  const panel = document.createElement("div");
  panel.className = "panel";
  const h2 = document.createElement("h2");
  h2.textContent = "新規ラウンド（日付で一意）";
  panel.appendChild(h2);
  const row = document.createElement("div");
  row.className = "row";
  const field = document.createElement("div");
  field.className = "field";
  const label = document.createElement("label");
  label.textContent = "ラウンド日";
  const dateInp = document.createElement("input");
  dateInp.type = "date";
  field.appendChild(label);
  field.appendChild(dateInp);
  const createBtn = document.createElement("button");
  createBtn.type = "button";
  createBtn.className = "btn btn-primary";
  createBtn.textContent = "作成";
  createBtn.addEventListener("click", () => createEvent(dateInp.value));
  row.appendChild(field);
  row.appendChild(createBtn);
  panel.appendChild(row);
  root.appendChild(panel);

  const listPanel = document.createElement("div");
  listPanel.className = "panel";
  const h2b = document.createElement("h2");
  h2b.textContent = "登録済みラウンド";
  listPanel.appendChild(h2b);

  const rows = eventDatesSorted();
  if (rows.length === 0) {
    const p = document.createElement("p");
    p.className = "empty-state";
    p.textContent = "まだラウンドがありません。上のフォームから作成してください。";
    listPanel.appendChild(p);
  } else {
    const table = document.createElement("table");
    table.className = "event-table";
    table.innerHTML = `<thead><tr>
      <th>日付</th><th>ゴルフ場</th><th>スコア</th><th>同伴</th><th></th>
    </tr></thead>`;
    const tbody = document.createElement("tbody");
    rows.forEach((e) => {
      const tr = document.createElement("tr");
      const companions = (e.companionNames || []).filter(Boolean).join("、");
      tr.innerHTML = `<td>${e.date}</td><td>${escapeHtml(e.golfCourse || "—")}</td><td>${
        e.score != null ? escapeHtml(String(e.score)) : "—"
      }</td><td>${escapeHtml(companions || "—")}</td><td></td>`;
      const td = tr.lastElementChild;
      const open = document.createElement("button");
      open.type = "button";
      open.className = "link-button";
      open.textContent = "詳細";
      open.addEventListener("click", () => openEvent(e.date));
      td.appendChild(open);
      tbody.appendChild(tr);
    });
    table.appendChild(tbody);
    listPanel.appendChild(table);
  }
  root.appendChild(listPanel);
}

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function renderEventDetail() {
  const root = document.getElementById("view-event-detail");
  if (!root) return;
  root.innerHTML = "";
  const date = view.eventDate;
  const ev = date ? getEventByDate(date) : null;
  if (!ev) {
    detailDraft = null;
    const p = document.createElement("p");
    p.className = "empty-state";
    p.textContent = "ラウンドが見つかりません。一覧から選んでください。";
    root.appendChild(p);
    return;
  }

  if (!detailDraft || detailDraft.sourceDate !== date) {
    initDetailDraftFromServer(date);
  }
  if (!detailDraft) return;
  const d = detailDraft;

  const panel = document.createElement("div");
  panel.className = "panel";
  const h2 = document.createElement("h2");
  h2.textContent = `ラウンド詳細（自分＋同伴 合計2〜4名）`;
  panel.appendChild(h2);

  const form = document.createElement("form");
  form.addEventListener("submit", (e) => {
    e.preventDefault();
    void saveEventDetail(d.sourceDate, form);
  });
  form.addEventListener("input", (e) => {
    const t = e.target;
    if (t instanceof Element && t.matches('[name="score"]')) return;
    syncDetailDraftFromForm(form);
  });
  form.addEventListener("change", () => syncDetailDraftFromForm(form));

  const dField = document.createElement("div");
  dField.className = "field";
  dField.innerHTML = `<label>ラウンド日（一意）</label><input type="date" name="date" required value="${escapeHtml(
    d.date
  )}" />`;
  form.appendChild(dField);

  const cField = document.createElement("div");
  cField.className = "field";
  cField.innerHTML = `<label>ゴルフ場</label><input type="text" name="golfCourse" value="${escapeHtml(
    d.golfCourse
  )}" placeholder="例：霞ヶ関カンツリー倶楽部" autocomplete="off" />`;
  form.appendChild(cField);

  const sField = document.createElement("div");
  sField.className = "field";
  const sLabel = document.createElement("label");
  sLabel.textContent = "スコア（任意・0〜200・半角数字のみ）";
  sField.appendChild(sLabel);
  const scoreInp = document.createElement("input");
  scoreInp.type = "text";
  scoreInp.name = "score";
  scoreInp.className = "score-input-ime";
  scoreInp.setAttribute("inputmode", "latin");
  scoreInp.setAttribute("lang", "en");
  scoreInp.setAttribute("pattern", "[0-9]*");
  scoreInp.setAttribute("autocorrect", "off");
  scoreInp.setAttribute("autocapitalize", "off");
  scoreInp.setAttribute("spellcheck", "false");
  scoreInp.autocomplete = "off";
  scoreInp.placeholder = "例：88（空欄可）";
  scoreInp.value = d.scoreText;
  const scoreErrEl = document.createElement("p");
  scoreErrEl.className = "field-error";
  scoreErrEl.setAttribute("role", "alert");
  if (d.scoreFieldError) {
    scoreErrEl.textContent = d.scoreFieldError;
  } else {
    scoreErrEl.classList.add("hidden");
    scoreErrEl.textContent = "";
  }
  scoreInp.addEventListener("input", () => {
    const v = scoreInp.value;
    if (/^[0-9]*$/.test(v)) {
      d.scoreText = v;
      d.scoreFieldError = "";
      scoreErrEl.textContent = "";
      scoreErrEl.classList.add("hidden");
    } else {
      scoreInp.value = d.scoreText;
      d.scoreFieldError = "スコアは半角数字（0〜9）のみ入力できます。全角数字・記号・文字は入力できません。";
      scoreErrEl.textContent = d.scoreFieldError;
      scoreErrEl.classList.remove("hidden");
    }
  });
  sField.appendChild(scoreInp);
  sField.appendChild(scoreErrEl);
  form.appendChild(sField);

  const compWrap = document.createElement("div");
  compWrap.className = "field";
  const compLabel = document.createElement("label");
  compLabel.textContent = `同伴者（自分以外 ${MIN_COMPANIONS}〜${MAX_COMPANIONS} 名）`;
  compWrap.appendChild(compLabel);
  const hint = document.createElement("p");
  hint.className = "hint";
  hint.style.marginTop = 0;
  hint.textContent =
    "自分は常に含まれます。同伴者の追加・削除は保存前はこの画面内だけに反映され、ゴルフ場やスコアなどの入力は消えません。";
  compWrap.appendChild(hint);

  const names = d.companionNames.length ? d.companionNames : [""];
  names.forEach((name, index) => {
    const crow = document.createElement("div");
    crow.className = "companion-row";
    const inp = document.createElement("input");
    inp.type = "text";
    inp.name = "companion";
    inp.placeholder = `同伴者 ${index + 1}`;
    inp.value = name;
    inp.autocomplete = "name";
    crow.appendChild(inp);
    if (names.length > MIN_COMPANIONS) {
      const rm = document.createElement("button");
      rm.type = "button";
      rm.className = "btn btn-secondary btn-small";
      rm.textContent = "削除";
      rm.addEventListener("click", () => removeCompanionField(d.sourceDate, index));
      crow.appendChild(rm);
    }
    compWrap.appendChild(crow);
  });

  const addComp = document.createElement("button");
  addComp.type = "button";
  addComp.className = "btn btn-secondary btn-small";
  addComp.textContent = "同伴者を追加";
  addComp.addEventListener("click", () => addCompanionField(d.sourceDate));
  compWrap.appendChild(addComp);
  form.appendChild(compWrap);

  const notesField = document.createElement("div");
  notesField.className = "field";
  const notesLabel = document.createElement("label");
  notesLabel.textContent = "備考（自由記入）";
  notesField.appendChild(notesLabel);
  const notesTa = document.createElement("textarea");
  notesTa.name = "notes";
  notesTa.rows = 5;
  notesTa.placeholder = "メモ・反省・天気など";
  notesTa.value = d.notes;
  notesField.appendChild(notesTa);
  form.appendChild(notesField);

  const imageWrap = document.createElement("div");
  imageWrap.className = "field";
  const imageLabel = document.createElement("label");
  imageLabel.textContent = "写真（1枚・JPEG / PNG / GIF / WebP・2MB 以下）";
  imageWrap.appendChild(imageLabel);
  const imageHint = document.createElement("p");
  imageHint.className = "hint";
  imageHint.style.marginTop = 0;
  imageHint.textContent = "選択後すぐアップロードされます。保存ボタンは不要です。";
  imageWrap.appendChild(imageHint);
  const hasImg = !!d.hasImage;
  if (hasImg) {
    const img = document.createElement("img");
    img.className = "round-image-preview";
    img.alt = "ラウンド添付画像";
    img.src = `/api/events/${encodeURIComponent(d.sourceDate)}/image?cb=${Date.now()}`;
    imageWrap.appendChild(img);
  }
  const imgRow = document.createElement("div");
  imgRow.className = "row";
  imgRow.style.alignItems = "center";
  const fileInp = document.createElement("input");
  fileInp.type = "file";
  fileInp.accept = "image/jpeg,image/png,image/gif,image/webp";
  fileInp.className = "round-image-file";
  fileInp.addEventListener("change", async () => {
    const file = fileInp.files && fileInp.files[0];
    if (!file) return;
    try {
      await uploadRoundImage(d.sourceDate, file);
      fileInp.value = "";
      setMessage("success", "画像をアップロードしました。");
    } catch (e) {
      setMessage("error", e instanceof Error ? e.message : String(e));
    }
    render();
  });
  imgRow.appendChild(fileInp);
  if (hasImg) {
    const delImg = document.createElement("button");
    delImg.type = "button";
    delImg.className = "btn btn-danger btn-small";
    delImg.textContent = "画像を削除";
    delImg.addEventListener("click", async () => {
      if (!confirm("添付画像を削除しますか？")) return;
      try {
        await deleteRoundImage(d.sourceDate);
        setMessage("success", "画像を削除しました。");
      } catch (e) {
        setMessage("error", e instanceof Error ? e.message : String(e));
      }
      render();
    });
    imgRow.appendChild(delImg);
  }
  imageWrap.appendChild(imgRow);
  form.appendChild(imageWrap);

  const bagH = document.createElement("h2");
  bagH.style.marginTop = "1rem";
  bagH.textContent = "このラウンドの持ち物";
  form.appendChild(bagH);
  const bagHint = document.createElement("p");
  bagHint.className = "hint";
  bagHint.textContent = "マスタからチェックしたものが、この日の持ち物リストになります。";
  form.appendChild(bagHint);

  if (state.masterItems.length === 0) {
    const empty = document.createElement("p");
    empty.className = "empty-state";
    empty.textContent = "マスタに持ち物がありません。「持ち物マスタ」タブから登録してください。";
    form.appendChild(empty);
  } else {
    CATEGORIES.forEach((cat) => {
      const items = state.masterItems.filter((m) => m.category === cat.id);
      if (items.length === 0) return;
      const sub = document.createElement("div");
      sub.className = "category-block";
      const h3 = document.createElement("h3");
      h3.textContent = cat.label;
      sub.appendChild(h3);
      const grid = document.createElement("div");
      grid.className = "check-grid";
      items.forEach((m) => {
        const row = document.createElement("label");
        row.className = "check-row";
        const cb = document.createElement("input");
        cb.type = "checkbox";
        cb.name = "item";
        cb.value = m.id;
        if (d.itemIds.includes(m.id)) cb.checked = true;
        row.appendChild(cb);
        const span = document.createElement("span");
        span.textContent = m.name;
        row.appendChild(span);
        grid.appendChild(row);
      });
      sub.appendChild(grid);
      form.appendChild(sub);
    });
  }

  const actions = document.createElement("div");
  actions.className = "row";
  actions.style.marginTop = "1rem";
  const save = document.createElement("button");
  save.type = "submit";
  save.className = "btn btn-primary";
  save.textContent = "保存";
  const del = document.createElement("button");
  del.type = "button";
  del.className = "btn btn-danger";
  del.textContent = "このラウンドを削除";
  del.addEventListener("click", () => deleteEvent(d.sourceDate));
  const back = document.createElement("button");
  back.type = "button";
  back.className = "btn btn-secondary";
  back.textContent = "一覧へ";
  back.addEventListener("click", () => setTab("events"));
  actions.appendChild(save);
  actions.appendChild(back);
  actions.appendChild(del);
  form.appendChild(actions);

  panel.appendChild(form);
  root.appendChild(panel);
}

/** スコアが入っているラウンドのみ、日付の古い順 */
function scoreHistorySeries() {
  return state.events
    .filter((e) => e.score != null && e.score !== "" && Number.isFinite(Number(e.score)))
    .map((e) => ({
      date: e.date,
      score: Number(e.score),
      golfCourse: (e.golfCourse || "").trim(),
    }))
    .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
}

function formatChartDate(ymd) {
  const p = String(ymd).split("-");
  if (p.length !== 3) return ymd;
  return `${Number(p[1])}/${Number(p[2])}`;
}

/**
 * @param {HTMLCanvasElement} canvas
 * @param {{ date: string; score: number; golfCourse: string }[]} series
 */
function drawScoreChart(canvas, series) {
  const wrap = canvas.parentElement;
  if (!wrap || series.length === 0) return;

  const dpr = window.devicePixelRatio || 1;
  const wCss = Math.max(300, Math.floor(wrap.clientWidth || wrap.getBoundingClientRect().width || 640));
  const hCss = 320;
  canvas.width = Math.floor(wCss * dpr);
  canvas.height = Math.floor(hCss * dpr);
  canvas.style.width = `${wCss}px`;
  canvas.style.height = `${hCss}px`;

  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.scale(dpr, dpr);

  const padL = 44;
  const padR = 16;
  const padT = 20;
  const padB = 52;
  const cw = wCss - padL - padR;
  const ch = hCss - padT - padB;

  const scores = series.map((p) => p.score);
  let yMin = Math.min(...scores);
  let yMax = Math.max(...scores);
  if (yMin === yMax) {
    yMin = Math.max(0, yMin - 5);
    yMax = Math.min(200, yMax + 5);
  } else {
    const pad = Math.max(2, Math.round((yMax - yMin) * 0.12));
    yMin = Math.max(0, yMin - pad);
    yMax = Math.min(200, yMax + pad);
  }
  if (yMax <= yMin) yMax = yMin + 1;

  ctx.fillStyle = "#0f1419";
  ctx.fillRect(0, 0, wCss, hCss);

  ctx.strokeStyle = "#2f3d4d";
  ctx.lineWidth = 1;
  ctx.font = "11px system-ui, sans-serif";
  ctx.fillStyle = "#8fa3b8";

  const tickCount = 5;
  for (let i = 0; i <= tickCount; i += 1) {
    const t = i / tickCount;
    const val = Math.round(yMax - t * (yMax - yMin));
    const y = padT + t * ch;
    ctx.beginPath();
    ctx.moveTo(padL, y);
    ctx.lineTo(padL + cw, y);
    ctx.stroke();
    ctx.textAlign = "right";
    ctx.textBaseline = "middle";
    ctx.fillText(String(val), padL - 8, y);
  }

  ctx.strokeStyle = "#2f3d4d";
  ctx.beginPath();
  ctx.moveTo(padL, padT);
  ctx.lineTo(padL, padT + ch);
  ctx.lineTo(padL + cw, padT + ch);
  ctx.stroke();

  const n = series.length;
  const xAt = (i) => {
    if (n <= 1) return padL + cw / 2;
    return padL + (cw * i) / (n - 1);
  };
  const yAt = (score) => padT + ch * (1 - (score - yMin) / (yMax - yMin));

  ctx.strokeStyle = "#3d9a6a";
  ctx.lineWidth = 2;
  ctx.beginPath();
  series.forEach((p, i) => {
    const x = xAt(i);
    const y = yAt(p.score);
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  });
  ctx.stroke();

  ctx.fillStyle = "#e8eef4";
  series.forEach((p, i) => {
    const x = xAt(i);
    const y = yAt(p.score);
    ctx.beginPath();
    ctx.arc(x, y, 4, 0, Math.PI * 2);
    ctx.fill();
  });

  ctx.fillStyle = "#8fa3b8";
  ctx.textAlign = "center";
  ctx.textBaseline = "top";
  const labelEvery = n <= 8 ? 1 : Math.ceil(n / 8);
  series.forEach((p, i) => {
    if (i % labelEvery !== 0 && i !== n - 1) return;
    const x = xAt(i);
    ctx.save();
    ctx.translate(x, padT + ch + 10);
    ctx.rotate(-Math.PI / 6);
    ctx.fillText(formatChartDate(p.date), 0, 0);
    ctx.restore();
  });

  ctx.save();
  ctx.translate(14, padT + ch / 2);
  ctx.rotate(-Math.PI / 2);
  ctx.fillStyle = "#8fa3b8";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.font = "12px system-ui, sans-serif";
  ctx.fillText("スコア", 0, 0);
  ctx.restore();
}

/** @type {ResizeObserver | null} */
let scoreChartResizeObserver = null;

function renderScoreHistory() {
  const root = document.getElementById("view-score-history");
  if (!root) return;

  if (scoreChartResizeObserver) {
    scoreChartResizeObserver.disconnect();
    scoreChartResizeObserver = null;
  }

  root.innerHTML = "";
  const panel = document.createElement("div");
  panel.className = "panel score-chart-panel";
  const h2 = document.createElement("h2");
  h2.textContent = "スコア履歴";
  panel.appendChild(h2);

  const hint = document.createElement("p");
  hint.className = "hint";
  hint.textContent = "ラウンド詳細で登録したスコアを、日付の古い順（左→右）に表示します。スコア未入力のラウンドはグラフに含みません。";
  panel.appendChild(hint);

  const series = scoreHistorySeries();
  if (series.length === 0) {
    const p = document.createElement("p");
    p.className = "empty-state";
    p.textContent = "スコアが登録されたラウンドがありません。ラウンド詳細でスコアを保存してください。";
    panel.appendChild(p);
    root.appendChild(panel);
    return;
  }

  const wrap = document.createElement("div");
  wrap.className = "score-chart-wrap";
  const canvas = document.createElement("canvas");
  canvas.className = "score-chart-canvas";
  canvas.setAttribute("role", "img");
  canvas.setAttribute(
    "aria-label",
    `スコアの推移。${series.length}件のラウンド。左が古い日付。`
  );
  wrap.appendChild(canvas);
  panel.appendChild(wrap);

  const redraw = () => drawScoreChart(canvas, series);
  redraw();
  scoreChartResizeObserver = new ResizeObserver(() => redraw());
  scoreChartResizeObserver.observe(wrap);

  const tbl = document.createElement("table");
  tbl.className = "score-history-table";
  tbl.innerHTML = "<thead><tr><th>日付</th><th>スコア</th><th>ゴルフ場</th></tr></thead>";
  const tbody = document.createElement("tbody");
  [...series].reverse().forEach((row) => {
    const tr = document.createElement("tr");
    tr.innerHTML = `<td>${escapeHtml(row.date)}</td><td class="num">${escapeHtml(String(row.score))}</td><td>${escapeHtml(
      row.golfCourse || "—"
    )}</td>`;
    tbody.appendChild(tr);
  });
  tbl.appendChild(tbody);
  panel.appendChild(tbl);

  root.appendChild(panel);
}

function render() {
  renderNav();
  renderMessage();
  document.getElementById("view-master")?.classList.toggle("hidden", view.tab !== "master");
  document.getElementById("view-events")?.classList.toggle("hidden", view.tab !== "events");
  document.getElementById("view-score-history")?.classList.toggle("hidden", view.tab !== "score-history");
  document.getElementById("view-event-detail")?.classList.toggle("hidden", view.tab !== "event-detail");

  if (view.tab === "master") renderMaster();
  if (view.tab === "events") renderEvents();
  if (view.tab === "score-history") renderScoreHistory();
  if (view.tab === "event-detail") renderEventDetail();
}

document.addEventListener("DOMContentLoaded", async () => {
  setSyncUi();
  try {
    await refreshState();
    bootError = "";
  } catch (e) {
    bootError = `データの読み込みに失敗しました: ${e instanceof Error ? e.message : String(e)}`;
  }
  render();
});
