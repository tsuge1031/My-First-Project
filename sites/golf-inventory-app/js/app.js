/**
 * ゴルフ持ち物・ラウンド管理（ブラウザ localStorage 永続化）
 */
const STORAGE_KEY = "golf-inventory-app-v1";

const CATEGORIES = [
  { id: "golf_wear", label: "ゴルフウェア" },
  { id: "non_golf_clothes", label: "ゴルフ以外の着替え" },
  { id: "items", label: "アイテム" },
  { id: "other", label: "その他" },
];

const MIN_COMPANIONS = 1;
const MAX_COMPANIONS = 3;

function uid() {
  if (typeof crypto !== "undefined" && crypto.randomUUID) {
    return crypto.randomUUID();
  }
  return `id_${Date.now()}_${Math.random().toString(16).slice(2)}`;
}

function defaultState() {
  return {
    masterItems: [],
    events: [],
  };
}

function loadState() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return defaultState();
    const parsed = JSON.parse(raw);
    return {
      masterItems: Array.isArray(parsed.masterItems) ? parsed.masterItems : [],
      events: Array.isArray(parsed.events) ? parsed.events : [],
    };
  } catch {
    return defaultState();
  }
}

function saveState(state) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

function categoryLabel(id) {
  const c = CATEGORIES.find((x) => x.id === id);
  return c ? c.label : id;
}

/** @type {ReturnType<typeof defaultState>} */
let state = loadState();
let view = { tab: "master", eventDate: null };
let message = { type: "", text: "" };

function setMessage(type, text) {
  message = { type, text };
  renderMessage();
}

function renderMessage() {
  const el = document.getElementById("global-message");
  if (!el) return;
  el.className = "hidden";
  el.textContent = "";
  if (!message.text) return;
  el.textContent = message.text;
  el.className =
    message.type === "error" ? "error-banner" : message.type === "success" ? "success-banner" : "hidden";
}

function setTab(tab) {
  if (tab === "event-detail" && !view.eventDate) {
    view = { ...view, tab: "events" };
  } else {
    view = { ...view, tab };
  }
  render();
}

function openEvent(date) {
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

// ——— マスタ ———
function addMasterItem(category, name) {
  const n = String(name || "").trim();
  if (!n) {
    setMessage("error", "持ち物名を入力してください。");
    return;
  }
  if (!CATEGORIES.some((c) => c.id === category)) {
    setMessage("error", "カテゴリが不正です。");
    return;
  }
  state = {
    ...state,
    masterItems: [...state.masterItems, { id: uid(), category, name: n }],
  };
  saveState(state);
  setMessage("success", "マスタに追加しました。");
  render();
}

function deleteMasterItem(id) {
  if (!confirm("このマスタ項目を削除しますか？関連するラウンドのチェックも外れます。")) return;
  state = {
    ...state,
    masterItems: state.masterItems.filter((m) => m.id !== id),
    events: state.events.map((e) => ({
      ...e,
      itemIds: (e.itemIds || []).filter((i) => i !== id),
    })),
  };
  saveState(state);
  setMessage("success", "削除しました。");
  render();
}

// ——— イベント ———
function createEvent(date) {
  const vd = validateEventDate(date, null);
  if (!vd.ok) {
    setMessage("error", vd.error);
    return;
  }
  const ev = {
    date,
    golfCourse: "",
    score: null,
    companionNames: [""],
    itemIds: [],
  };
  state = { ...state, events: [...state.events, ev] };
  saveState(state);
  setMessage("success", "ラウンドを作成しました。");
  openEvent(date);
}

function deleteEvent(date) {
  if (!confirm("このラウンドを削除しますか？")) return;
  const wasViewing = view.eventDate === date;
  state = { ...state, events: state.events.filter((e) => e.date !== date) };
  saveState(state);
  if (wasViewing) {
    view = { ...view, eventDate: null, tab: "events" };
  }
  setMessage("success", "削除しました。");
  render();
}

function updateEvent(date, patch) {
  const ev = getEventByDate(date);
  if (!ev) return;
  const next = { ...ev, ...patch };
  state = {
    ...state,
    events: state.events.map((e) => (e.date === date ? next : e)),
  };
  saveState(state);
  render();
}

function saveEventDetail(date, form) {
  const newDate = form.querySelector('[name="date"]').value;
  const golfCourse = form.querySelector('[name="golfCourse"]').value.trim();
  const scoreRaw = form.querySelector('[name="score"]').value;
  const score = parseScore(scoreRaw);
  if (Number.isNaN(score)) {
    setMessage("error", "スコアは 0〜200 の数値、または空欄にしてください。");
    return;
  }
  const nameInputs = [...form.querySelectorAll('[name="companion"]')];
  const names = nameInputs.map((inp) => inp.value);
  const vc = validateCompanions(names);
  if (!vc.ok) {
    setMessage("error", vc.error);
    return;
  }
  const vd = validateEventDate(newDate, date);
  if (!vd.ok) {
    setMessage("error", vd.error);
    return;
  }
  const checkboxes = [...form.querySelectorAll('input[name="item"]:checked')];
  const itemIds = checkboxes.map((c) => c.value);

  const others = state.events.filter((e) => e.date !== date);
  const updated = {
    ...getEventByDate(date),
    date: newDate,
    golfCourse,
    score,
    companionNames: vc.names,
    itemIds,
  };
  state = { ...state, events: [...others, updated] };
  saveState(state);
  setMessage("success", "保存しました。");
  if (newDate !== date) {
    view = { ...view, eventDate: newDate };
  }
  render();
}

function addCompanionField(date) {
  const ev = getEventByDate(date);
  if (!ev) return;
  const list = [...(ev.companionNames || [])];
  if (list.length >= MAX_COMPANIONS) {
    setMessage("error", `同伴者は自分以外最大${MAX_COMPANIONS}名までです。`);
    return;
  }
  list.push("");
  updateEvent(date, { companionNames: list });
}

function removeCompanionField(date, index) {
  const ev = getEventByDate(date);
  if (!ev) return;
  const list = [...(ev.companionNames || [])];
  if (list.length <= MIN_COMPANIONS) {
    setMessage("error", `同伴者は自分以外最低${MIN_COMPANIONS}名必要です。`);
    return;
  }
  list.splice(index, 1);
  updateEvent(date, { companionNames: list });
}

// ——— DOM ———
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
}

function renderMaster() {
  const root = document.getElementById("view-master");
  if (!root) return;
  root.innerHTML = "";

  const hint = document.createElement("p");
  hint.className = "hint";
  hint.textContent =
    "カテゴリ別に持ち物マスタを登録します。ラウンドごとに、このマスタから持ち物を選べます。";
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
    addBtn.addEventListener("click", () => {
      addMasterItem(cat.id, input.value);
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
    const p = document.createElement("p");
    p.className = "empty-state";
    p.textContent = "ラウンドが見つかりません。一覧から選んでください。";
    root.appendChild(p);
    return;
  }

  const panel = document.createElement("div");
  panel.className = "panel";
  const h2 = document.createElement("h2");
  h2.textContent = `ラウンド詳細（自分＋同伴 合計2〜4名）`;
  panel.appendChild(h2);

  const form = document.createElement("form");
  form.addEventListener("submit", (e) => {
    e.preventDefault();
    saveEventDetail(ev.date, form);
  });

  const dField = document.createElement("div");
  dField.className = "field";
  dField.innerHTML = `<label>ラウンド日（一意）</label><input type="date" name="date" required value="${ev.date}" />`;
  form.appendChild(dField);

  const cField = document.createElement("div");
  cField.className = "field";
  cField.innerHTML = `<label>ゴルフ場</label><input type="text" name="golfCourse" value="${escapeHtml(
    ev.golfCourse || ""
  )}" placeholder="例：霞ヶ関カンツリー倶楽部" autocomplete="off" />`;
  form.appendChild(cField);

  const sField = document.createElement("div");
  sField.className = "field";
  sField.innerHTML = `<label>スコア（任意・0〜200）</label><input type="number" name="score" min="0" max="200" step="1" value="${
    ev.score != null ? escapeHtml(String(ev.score)) : ""
  }" />`;
  form.appendChild(sField);

  const compWrap = document.createElement("div");
  compWrap.className = "field";
  const compLabel = document.createElement("label");
  compLabel.textContent = `同伴者（自分以外 ${MIN_COMPANIONS}〜${MAX_COMPANIONS} 名）`;
  compWrap.appendChild(compLabel);
  const hint = document.createElement("p");
  hint.className = "hint";
  hint.style.marginTop = 0;
  hint.textContent = "自分は常に含まれます。ここには同伴者の名前だけを入れてください。";
  compWrap.appendChild(hint);

  const names = ev.companionNames && ev.companionNames.length ? ev.companionNames : [""];
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
      rm.addEventListener("click", () => removeCompanionField(ev.date, index));
      crow.appendChild(rm);
    }
    compWrap.appendChild(crow);
  });

  const addComp = document.createElement("button");
  addComp.type = "button";
  addComp.className = "btn btn-secondary btn-small";
  addComp.textContent = "同伴者を追加";
  addComp.addEventListener("click", () => addCompanionField(ev.date));
  compWrap.appendChild(addComp);
  form.appendChild(compWrap);

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
        if ((ev.itemIds || []).includes(m.id)) cb.checked = true;
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
  del.addEventListener("click", () => deleteEvent(ev.date));
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

function render() {
  renderNav();
  renderMessage();
  document.getElementById("view-master")?.classList.toggle("hidden", view.tab !== "master");
  document.getElementById("view-events")?.classList.toggle("hidden", view.tab !== "events");
  document.getElementById("view-event-detail")?.classList.toggle("hidden", view.tab !== "event-detail");

  if (view.tab === "master") renderMaster();
  if (view.tab === "events") renderEvents();
  if (view.tab === "event-detail") renderEventDetail();
}

document.addEventListener("DOMContentLoaded", () => {
  render();
});
