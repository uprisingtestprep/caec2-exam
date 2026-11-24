/* CAEC Exam Simulator. All 13 official CAEC answer formats. Tap-to-place AND mouse drag. */
"use strict";

const ACCESS_CODE = "CAEC29000";
const PASSING_PCT = 55;
const STORAGE_KEY = "caec2_exam_state_v2";
const SUBJECT_LABELS = { mathematics: "Mathematics", reading: "Reading", science: "Science", social_studies: "Social Studies" };
const LET = ["A", "B", "C", "D", "E", "F", "G", "H"];

// The real sittings (Alberta CAEC Test Outcomes and Evaluation Plan by Subject).
const PLAN = {
  reading: [{ key: "reading", subject: "reading", part: null, n: 50, min: 75, calc: false, label: "Reading" }],
  mathematics: [
    { key: "math1", subject: "mathematics", part: 1, n: 12, min: 30, calc: false, label: "Mathematics Part I (no calculator)", weight: 0.25 },
    { key: "math2", subject: "mathematics", part: 2, n: 30, min: 90, calc: true, label: "Mathematics Part II (calculator)", weight: 0.75 },
  ],
  science: [{ key: "science", subject: "science", part: null, n: 35, min: 90, calc: false, label: "Science" }],
  social_studies: [{ key: "social", subject: "social_studies", part: null, n: 40, min: 90, calc: false, label: "Social Studies" }],
};
function sectionsFor(mode) {
  if (mode === "full") return [].concat(PLAN.reading, PLAN.mathematics, PLAN.science, PLAN.social_studies);
  return PLAN[mode];
}

const POOL = (window.EXAM_QUESTIONS || []).slice();
const BY_ID = new Map(POOL.map(q => [q.id, q]));
const POOL_TEXT = POOL.length.toLocaleString() + " Questions Available";

let S = null;            // sitting state, persisted
let HELD = null;         // item picked up for tap-to-place: {kind, idx}
let timerHandle = null;
let reviewMode = false;
let reviewList = [];
let reviewPos = 0;

// ───────────────────────── tiny helpers ─────────────────────────
function el(tag, cls, html) { const e = document.createElement(tag); if (cls) e.className = cls; if (html != null) e.innerHTML = html; return e; }
function esc(s) { return String(s == null ? "" : s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;"); }
function txt(s) { return esc(s).replace(/\n/g, "<br>"); }
function show(id, on, disp) { const n = document.getElementById(id); if (n) n.style.display = on ? (disp || "block") : "none"; }
function $(id) { return document.getElementById(id); }
function optHTML(o) {
  if (typeof o === "string") return txt(o);
  let h = "";
  if (o.img) h += `<img class="opt-img" src="${esc(o.img)}" alt="">`;
  if (o.text) h += `<span>${txt(o.text)}</span>`;
  return h;
}
function eqArr(a, b) { if (!a || !b || a.length !== b.length) return false; for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false; return true; }
function sameSet(a, b) { const x = (a || []).slice().sort(), y = (b || []).slice().sort(); return eqArr(x, y); }
function toast(msg) { const t = $("toast"); t.textContent = msg; t.style.display = "block"; clearTimeout(toast._h); toast._h = setTimeout(() => { t.style.display = "none"; }, 2600); }

// ───────────────────────── boot ─────────────────────────
window.addEventListener("DOMContentLoaded", () => {
  $("gate-pool-note").textContent = `Each subject is a separate timed sitting at the real length. Questions are drawn at random from a pool of ${POOL.length.toLocaleString()}. Choose a new sitting anytime for a fresh mix.`;
  $("mode-pool-note").textContent = `${POOL_TEXT}. Every sitting draws a fresh random set from this pool.`;
  $("q-pool-chip").textContent = POOL_TEXT;
  $("q-pool-chip").title = "Each sitting is drawn at random from this pool. Choose a new sitting for a fresh mix.";
  $("res-pool-note").textContent = `This sitting was drawn from a pool of ${POOL.length.toLocaleString()} questions. Choose another sitting for a fresh mix.`;
  loadState();
  $("access-gate").style.display = "flex";
  const attempt = () => {
    const v = $("access-code-input").value.trim().toUpperCase();
    if (v === ACCESS_CODE) { try { localStorage.setItem("caec2_access_ok", "1"); } catch (e) { } show("access-gate", false); showModes(); }
    else { $("access-error").textContent = "Incorrect access code. Please try again."; $("access-code-input").value = ""; $("access-code-input").focus(); }
  };
  $("access-btn").addEventListener("click", attempt);
  $("access-code-input").addEventListener("keydown", e => { if (e.key === "Enter") attempt(); });
  $("submit-btn").addEventListener("click", finishSectionPrompt);
  $("flag-btn").addEventListener("click", toggleFlag);
  $("prev-btn").addEventListener("click", () => navigate(-1));
  $("next-btn").addEventListener("click", () => navigate(1));
  $("map-btn").addEventListener("click", openMap);
  $("map-close").addEventListener("click", closeMap);
  $("map-backdrop").addEventListener("click", closeMap);
  $("calc-btn").addEventListener("click", () => { $("calc-panel").style.display = $("calc-panel").style.display === "none" ? "block" : "none"; });
  $("calc-close").addEventListener("click", () => show("calc-panel", false));
  $("res-review-btn").addEventListener("click", startReview);
  $("res-restart-btn").addEventListener("click", () => { clearState(); show("results-screen", false); showModes(); });
  $("btw-go").addEventListener("click", startNextSection);
  document.addEventListener("keydown", keyHandler);
  buildCalc();
});

// ───────────────────────── state ─────────────────────────
function saveState() { try { localStorage.setItem(STORAGE_KEY, JSON.stringify(S)); } catch (e) { /* storage may be blocked */ } }
function loadState() { try { const r = localStorage.getItem(STORAGE_KEY); S = r ? JSON.parse(r) : null; } catch (e) { S = null; } if (S && (S.finished || !S.secs)) S = null; }
function clearState() { S = null; try { localStorage.removeItem(STORAGE_KEY); } catch (e) { } }

// ───────────────────────── mode screen ─────────────────────────
function showModes() {
  stopTimer(); show("app", false); show("results-screen", false); show("between-screen", false); show("calc-panel", false);
  show("mode-screen", true);
  const grid = $("mode-grid"); grid.innerHTML = "";
  const cards = [
    ["full", "Full practice day", "All four subjects in order, each with its own timer: Reading, Math Part I and II, Science, Social Studies. 167 questions."],
    ["reading", "Reading", "50 questions, 75 minutes."],
    ["mathematics", "Mathematics", "Part I: 12 questions, 30 minutes, no calculator. Part II: 30 questions, 90 minutes, calculator allowed."],
    ["science", "Science", "35 questions, 90 minutes."],
    ["social_studies", "Social Studies", "40 questions, 90 minutes."],
  ];
  cards.forEach(([m, t, d]) => {
    const b = el("button", "mode-card", `<div class="mode-card-t">${t}</div><div class="mode-card-d">${d}</div>`);
    b.addEventListener("click", () => beginSitting(m));
    grid.appendChild(b);
  });
  const w = el("a", "mode-card mode-card-w", `<div class="mode-card-t">Writing practice</div><div class="mode-card-d">One persuasive task, 75 minutes, with the official scoring guide and model essays.</div>`);
  w.href = "writing.html"; grid.appendChild(w);
  const rb = $("resume-box");
  if (S && S.secs && !S.finished) {
    rb.style.display = "block";
    rb.innerHTML = `You have a sitting in progress. <button class="res-btn" id="resume-go">Resume it</button>`;
    $("resume-go").addEventListener("click", resumeSitting);
  } else rb.style.display = "none";
}

// ───────────────────────── building a sitting ─────────────────────────
function clusterOf(q) { return q.cluster_id || null; }
function shuffle(a) { for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; }

function pickFor(def) {
  const cand = POOL.filter(q => q.domain === def.subject && (def.part == null || q.part === def.part));
  const units = [], byC = new Map();
  for (const q of cand) {
    const c = clusterOf(q);
    if (!c) { units.push([q]); continue; }
    if (!byC.has(c)) { const u = []; byC.set(c, u); units.push(u); }
    byC.get(c).push(q);
  }
  shuffle(units);
  const out = [];
  for (const u of units) { if (out.length + u.length > def.n) continue; for (const q of u) out.push(q.id); if (out.length >= def.n) break; }
  return out;
}

function makePerm(q) {
  const typed = ["mcq", "pick_multi", "select_place"];
  if (!typed.includes(q.type) || q.fixed_order || !q.options) return null;
  const idx = q.options.map((_, i) => i); shuffle(idx); return idx;     // idx[newPos] = oldIdx
}

function beginSitting(mode) {
  const defs = sectionsFor(mode);
  const secs = defs.map(d => ({ def: d, qids: pickFor(d), deadline: null, done: false }));
  if (secs.every(s => s.qids.length === 0)) { alert("This sitting has no questions in the pool yet."); return; }
  const perms = {};
  secs.forEach(s => s.qids.forEach(id => { const p = makePerm(BY_ID.get(id)); if (p) perms[id] = p; }));
  S = { mode, secs, si: 0, cur: 0, answers: {}, flags: {}, perms, finished: false };
  saveState();
  enterSection(0);
}
function resumeSitting() { enterSection(S.si, true); }

function enterSection(i, resume) {
  S.si = i;
  const sec = S.secs[i];
  if (!sec.deadline) sec.deadline = Date.now() + sec.def.min * 60000;
  if (!resume) S.cur = 0;
  saveState();
  show("mode-screen", false); show("between-screen", false); show("results-screen", false);
  show("app", true, "flex");
  reviewMode = false;
  $("sec-title").textContent = sec.def.label;
  $("calc-btn").style.display = sec.def.calc ? "inline-block" : "none";
  if (!sec.def.calc) show("calc-panel", false);
  $("submit-btn").style.display = "";
  $("flag-btn").style.display = "";
  startTimer();
  renderQuestion();
}

// ───────────────────────── timer ─────────────────────────
function stopTimer() { if (timerHandle) { clearInterval(timerHandle); timerHandle = null; } }
function startTimer() {
  stopTimer(); tick();
  timerHandle = setInterval(tick, 1000);
}
function tick() {
  if (!S || reviewMode) return;
  const sec = S.secs[S.si];
  const left = Math.max(0, Math.ceil((sec.deadline - Date.now()) / 1000));
  const h = Math.floor(left / 3600), m = Math.floor((left % 3600) / 60), s = left % 60;
  $("timer-display").textContent = (h ? h + ":" : "") + String(m).padStart(2, "0") + ":" + String(s).padStart(2, "0");
  $("timer-display").classList.toggle("timer-low", left <= 300);
  if (left === 0) finishSection(true);
}

// ───────────────────────── question view (option shuffling) ─────────────────────────
function viewOf(q) {
  const perm = S && S.perms && S.perms[q.id];
  if (!perm) return q;
  const v = Object.assign({}, q);
  v.options = perm.map(i => q.options[i]);
  const inv = {}; perm.forEach((oldIdx, newPos) => { inv[oldIdx] = newPos; });
  if (Array.isArray(q.correct)) v.correct = q.correct.map(c => inv[c]); else v.correct = inv[q.correct];
  return v;
}
function currentQ() { const sec = S.secs[S.si]; return BY_ID.get(sec.qids[S.cur]); }
function listForUI() { return reviewMode ? reviewList : S.secs[S.si].qids; }

// ───────────────────────── answered / grading ─────────────────────────
function isAnswered(q, a) {
  if (a == null) return false;
  switch (q.type) {
    case "mcq": case "select_paragraph": return typeof a === "number";
    case "pick_multi": return Array.isArray(a) && a.length === q.correct.length;
    case "select_place": return Array.isArray(a) && a.length === (Array.isArray(q.correct) ? q.correct.length : 1);
    case "match": case "puzzle": case "classify": return Array.isArray(a) && a.every(x => x != null);
    case "sort_groups": return Array.isArray(a) && a.some(x => x != null);
    case "order": return Array.isArray(a);
    case "table_check": return q.mode === "free" ? (Array.isArray(a) && a.length > 0) : (Array.isArray(a) && a.length === q.rows.length && a.every(x => x != null));
    case "dropdown": return Array.isArray(a) && a.every(x => x != null);
    case "fill_number": return String(a).length > 0;
  }
  return false;
}

function parseNum(s) {
  s = String(s).trim().replace(/,/g, "");
  if (/^-?\d+\s*\/\s*-?\d+$/.test(s)) { const [n, d] = s.split("/").map(Number); return d === 0 ? NaN : n / d; }
  if (/^-?\d*\.?\d+$/.test(s)) return parseFloat(s);
  return NaN;
}
function grade(q, a) {
  if (!isAnswered(q, a) && q.type !== "sort_groups") return false;
  switch (q.type) {
    case "mcq": case "select_paragraph": return a === q.correct;
    case "pick_multi": return sameSet(a, q.correct);
    case "select_place": return sameSet(a, Array.isArray(q.correct) ? q.correct : [q.correct]);
    case "match": case "puzzle": case "classify": case "dropdown": case "order": return eqArr(a, q.correct);
    case "sort_groups": return Array.isArray(a) && q.correct.every((c, i) => (a[i] == null ? null : a[i]) === (c == null ? null : c));
    case "table_check":
      if (q.mode === "free") return sameSet(a, q.correct.map(p => p[0] + ":" + p[1]));
      return eqArr(a, q.correct);
    case "fill_number": {
      const x = parseNum(a); if (isNaN(x)) return false;
      const targets = [q.correct].concat(q.accept || []).map(parseNum);
      const tol = q.tol == null ? 1e-6 : q.tol;
      return targets.some(t => Math.abs(x - t) <= tol);
    }
  }
  return false;
}
function getAns(q) { return S.answers[q.id]; }
function setAns(q, v) { S.answers[q.id] = v; saveState(); renderAnswer(); updateNavState(); }

// ───────────────────────── rendering a question ─────────────────────────
function renderQuestion() {
  HELD = null;
  const ids = listForUI();
  if (!ids.length) { $("question-text").textContent = "No questions in the pool for this section yet."; $("answer-area").innerHTML = ""; return; }
  const q = BY_ID.get(ids[reviewMode ? reviewPos : S.cur]);
  const n = reviewMode ? reviewPos : S.cur;
  $("q-counter").textContent = `Question ${n + 1} of ${ids.length}`;
  $("q-domain").textContent = (SUBJECT_LABELS[q.domain] || q.domain) + (q.part ? ` (Part ${q.part})` : "");
  const flagged = !!S.flags[q.id];
  $("q-flag-indicator").style.display = flagged ? "inline-block" : "none";
  $("flag-btn").textContent = flagged ? "Unflag" : "Flag";
  // shared source (email, article, infographic, table of data)
  const wrap = $("q-cluster-wrap");
  let src = "";
  if (q.source_html) src = q.source_html;
  else if (q.source) src = (q.source.title ? `<div class="src-title">${txt(q.source.title)}</div>` : "") + (q.source.paragraphs || []).map(p => `<p>${txt(p)}</p>`).join("");
  if (src && q.type !== "select_paragraph") { wrap.innerHTML = `<div class="cluster-label">Source</div><div class="cluster-body">${src}</div>`; wrap.style.display = "block"; }
  else { wrap.innerHTML = ""; wrap.style.display = "none"; }
  const v = viewOf(q);
  const stemHTML = q.type === "dropdown" ? "" : txt(v.stem);
  $("question-text").innerHTML = stemHTML;
  $("question-text").style.display = q.type === "dropdown" ? "none" : "block";
  const iw = $("q-image-wrap");
  if (q.image) { iw.innerHTML = `<img src="${esc(q.image)}" alt="" class="q-image">`; iw.style.display = "block"; } else { iw.innerHTML = ""; iw.style.display = "none"; }
  renderAnswer();
  updateNavState();
  renderReviewExtras(q);
}

function renderAnswer() {
  const q = currentQAny();
  const v = viewOf(q);
  const a = (reviewMode ? S.answers[q.id] : getAns(q));
  const ro = reviewMode;
  const area = $("answer-area"); area.innerHTML = "";
  const set = val => setAns(q, val);
  const R = RENDER[q.type];
  if (!R) { area.textContent = "Unsupported question type: " + q.type; return; }
  R(v, a, set, ro, area);
}
function currentQAny() { const ids = listForUI(); return BY_ID.get(ids[reviewMode ? reviewPos : S.cur]); }

// ───────────────────────── drag + tap layer ─────────────────────────
function refresh() { renderAnswer(); }
function pickUp(node, kind, idx, ro) {
  if (ro) return;
  node.draggable = true;
  node.addEventListener("dragstart", e => { HELD = { kind, idx }; try { e.dataTransfer.setData("text/plain", String(idx)); } catch (x) { } node.classList.add("dragging"); });
  node.addEventListener("dragend", () => node.classList.remove("dragging"));
  node.addEventListener("click", ev => {
    // Holding something of a DIFFERENT kind: this tap is meant for the container underneath (drop it there).
    if (HELD && HELD.kind !== kind) return;
    ev.stopPropagation(); HELD = (HELD && HELD.kind === kind && HELD.idx === idx) ? null : { kind, idx }; refresh();
  });
}
function dropOn(node, onHeld, onTapEmpty, ro) {
  if (ro) return;
  node.addEventListener("dragover", e => { e.preventDefault(); node.classList.add("over"); });
  node.addEventListener("dragleave", () => node.classList.remove("over"));
  node.addEventListener("drop", e => { e.preventDefault(); node.classList.remove("over"); if (HELD) { const h = HELD; HELD = null; onHeld(h); } });
  node.addEventListener("click", () => { if (HELD) { const h = HELD; HELD = null; onHeld(h); } else if (onTapEmpty) onTapEmpty(); });
}
function chip(o, kind, idx, held, ro) {
  const c = el("div", "chip" + (held ? " held" : ""), optHTML(o));
  pickUp(c, kind, idx, ro); return c;
}
function isHeld(kind, idx) { return HELD && HELD.kind === kind && HELD.idx === idx; }

// ───────────────────────── the 13 renderers ─────────────────────────
const RENDER = {};

// 1 + 8: select one (text or graphic options)
RENDER.mcq = (q, a, set, ro, area) => {
  const box = el("div", "options-list");
  q.options.forEach((o, i) => {
    const d = el("div", "option" + (a === i ? " selected" : ""), `<span class="opt-letter">${LET[i]}</span><span class="opt-text">${optHTML(o)}</span>`);
    if (!ro) d.addEventListener("click", () => set(a === i ? null : i));
    box.appendChild(d);
  });
  area.appendChild(box);
};

// 3 + 8: select several (exactly the required number)
RENDER.pick_multi = (q, a, set, ro, area) => {
  const need = q.correct.length, cur = Array.isArray(a) ? a : [];
  area.appendChild(el("div", "hint", `Select ${need}.`));
  const box = el("div", "options-list");
  q.options.forEach((o, i) => {
    const on = cur.includes(i);
    const d = el("div", "option" + (on ? " selected" : ""), `<span class="opt-letter">${on ? "&#10003;" : LET[i]}</span><span class="opt-text">${optHTML(o)}</span>`);
    if (!ro) d.addEventListener("click", () => {
      if (on) set(cur.filter(x => x !== i));
      else if (cur.length >= need) toast(`You have reached the maximum of ${need}. Remove one answer to choose another.`);
      else set(cur.concat([i]));
    });
    box.appendChild(d);
  });
  area.appendChild(box);
};

// 2: select a box, then place it in the answer window
RENDER.select_place = (q, a, set, ro, area) => {
  const need = Array.isArray(q.correct) ? q.correct.length : 1, placed = Array.isArray(a) ? a : [];
  const win = el("div", "answer-window" + (placed.length ? "" : " empty"));
  win.appendChild(el("div", "aw-label", q.target || "Answer window"));
  placed.forEach(i => { const c = chip(q.options[i], "placed", i, isHeld("placed", i), ro); win.appendChild(c); });
  if (!placed.length) win.appendChild(el("div", "aw-empty", "Select an answer, then drag it here or tap here."));
  dropOn(win, h => { let n = placed.filter(x => x !== h.idx); n.push(h.idx); if (n.length > need) n = n.slice(n.length - need); set(n); },
    null, ro);
  const bank = el("div", "bank");
  q.options.forEach((o, i) => { if (!placed.includes(i)) bank.appendChild(chip(o, "bank", i, isHeld("bank", i), ro)); });
  dropOn(bank, h => { if (h.kind === "placed") set(placed.filter(x => x !== h.idx)); }, null, ro);
  area.appendChild(bank); area.appendChild(win);
};

// 4 + 5: match items to places (graphics or text), one item per place
RENDER.match = (q, a, set, ro, area) => {
  const cur = Array.isArray(a) ? a.slice() : q.slots.map(() => null);
  const slots = el("div", "match-slots");
  q.slots.forEach((s, si) => {
    const row = el("div", "match-row");
    row.appendChild(el("div", "match-label", optHTML(s)));
    const z = el("div", "slot" + (cur[si] == null ? " empty" : ""));
    if (cur[si] != null) z.appendChild(chip(q.items[cur[si]], "placed", cur[si], isHeld("placed", cur[si]), ro)); else z.appendChild(el("span", "slot-hint", "Drop here"));
    dropOn(z, h => { const n = cur.map(x => (x === h.idx ? null : x)); n[si] = h.idx; set(n); }, () => { if (cur[si] != null) { const n = cur.slice(); n[si] = null; set(n); } }, ro);
    row.appendChild(z); slots.appendChild(row);
  });
  const bank = el("div", "bank");
  q.items.forEach((it, i) => { if (!cur.includes(i)) bank.appendChild(chip(it, "bank", i, isHeld("bank", i), ro)); });
  dropOn(bank, h => { set(cur.map(x => (x === h.idx ? null : x))); }, null, ro);
  area.appendChild(slots); area.appendChild(bank);
};

// 6: classify statements with one of two words, answers reusable
RENDER.classify = (q, a, set, ro, area) => {
  const cur = Array.isArray(a) ? a.slice() : q.statements.map(() => null);
  const t = el("table", "ctable");
  const head = el("tr", "", `<th></th>` + q.categories.map(c => `<th>${txt(c)}</th>`).join(""));
  t.appendChild(head);
  q.statements.forEach((s, i) => {
    const tr = el("tr"); tr.appendChild(el("td", "ctext", txt(s)));
    q.categories.forEach((c, ci) => {
      const td = el("td", "ccell"); const b = el("button", "radio" + (cur[i] === ci ? " on" : ""), cur[i] === ci ? "&#9679;" : "&#9675;");
      b.setAttribute("aria-label", c);
      if (!ro) b.addEventListener("click", () => { const n = cur.slice(); n[i] = n[i] === ci ? null : ci; set(n); });
      td.appendChild(b); tr.appendChild(td);
    });
    t.appendChild(tr);
  });
  area.appendChild(t);
};

// ordering
RENDER.order = (q, a, set, ro, area) => {
  const cur = Array.isArray(a) ? a.slice() : q.items.map((_, i) => i);
  area.appendChild(el("div", "hint", "Put the items in the correct order. Use the arrows, or drag an item onto another."));
  const list = el("div", "order-list");
  cur.forEach((itemIdx, pos) => {
    const row = el("div", "order-row", `<span class="order-n">${pos + 1}</span><span class="order-t">${optHTML(q.items[itemIdx])}</span>`);
    if (!ro) {
      const up = el("button", "arrow", "&#9650;"), dn = el("button", "arrow", "&#9660;");
      up.disabled = pos === 0; dn.disabled = pos === cur.length - 1;
      up.addEventListener("click", e => { e.stopPropagation(); const n = cur.slice();[n[pos - 1], n[pos]] = [n[pos], n[pos - 1]]; set(n); });
      dn.addEventListener("click", e => { e.stopPropagation(); const n = cur.slice();[n[pos + 1], n[pos]] = [n[pos], n[pos + 1]]; set(n); });
      row.appendChild(up); row.appendChild(dn);
      row.draggable = true;
      row.addEventListener("dragstart", () => { HELD = { kind: "row", idx: pos }; });
      dropOn(row, h => { if (h.kind !== "row") return; const n = cur.slice(); const [m] = n.splice(h.idx, 1); n.splice(pos, 0, m); set(n); }, null, ro);
    }
    list.appendChild(row);
  });
  area.appendChild(list);
};

// 9: sort items into groups
RENDER.sort_groups = (q, a, set, ro, area) => {
  const cur = Array.isArray(a) ? a.slice() : q.items.map(() => null);
  const groups = el("div", "groups");
  q.groups.forEach((g, gi) => {
    const box = el("div", "group-box"); if (q.group_colors && q.group_colors[gi]) box.style.borderColor = q.group_colors[gi];
    box.appendChild(el("div", "group-t", txt(g)));
    q.items.forEach((it, i) => { if (cur[i] === gi) box.appendChild(chip(it, "placed", i, isHeld("placed", i), ro)); });
    dropOn(box, h => { const n = cur.slice(); n[h.idx] = gi; set(n); }, null, ro);
    groups.appendChild(box);
  });
  const bank = el("div", "bank");
  q.items.forEach((it, i) => { if (cur[i] == null) { const c = chip(it, "bank", i, isHeld("bank", i), ro); if (q.item_colors && q.item_colors[i]) c.style.borderColor = q.item_colors[i]; bank.appendChild(c); } });
  dropOn(bank, h => { const n = cur.slice(); n[h.idx] = null; set(n); }, null, ro);
  area.appendChild(bank); area.appendChild(groups);
};

// 7: select a paragraph in a longer text
RENDER.select_paragraph = (q, a, set, ro, area) => {
  area.appendChild(el("div", "hint", "Click the paragraph that answers the question."));
  const box = el("div", "para-box");
  if (q.source && q.source.title) box.appendChild(el("div", "src-title", txt(q.source.title)));
  (q.paragraphs || []).forEach((p, i) => {
    const d = el("div", "para" + (a === i ? " selected" : ""), txt(p));
    if (!ro) d.addEventListener("click", () => set(a === i ? null : i));
    box.appendChild(d);
  });
  area.appendChild(box);
};

// 10: place coloured squares on a puzzle board
RENDER.puzzle = (q, a, set, ro, area) => {
  const cur = Array.isArray(a) ? a.slice() : q.locations.map(() => null);
  const board = el("div", "puzzle-board");
  q.locations.forEach((L, li) => {
    const wrap = el("div", "puzzle-loc"); wrap.appendChild(el("div", "puzzle-lab", txt(L)));
    const sq = el("div", "puzzle-sq" + (cur[li] == null ? " empty" : ""));
    if (cur[li] != null) { sq.style.background = q.colors[cur[li]].hex; sq.title = q.colors[cur[li]].name; sq.appendChild(el("span", "sq-name", esc(q.colors[cur[li]].name))); }
    dropOn(sq, h => { const n = cur.slice(); n[li] = h.idx; set(n); }, () => { if (cur[li] != null) { const n = cur.slice(); n[li] = null; set(n); } }, ro);
    wrap.appendChild(sq); board.appendChild(wrap);
  });
  const pal = el("div", "palette");
  q.colors.forEach((c, i) => {
    const s = el("div", "pal-sq" + (isHeld("color", i) ? " held" : ""), `<span class="sq-name">${esc(c.name)}</span>`); s.style.background = c.hex;
    pickUp(s, "color", i, ro); pal.appendChild(s);
  });
  area.appendChild(board); area.appendChild(el("div", "hint", "Pick a colour, then drag or tap it onto a spot. Tap a placed square to remove it.")); area.appendChild(pal);
};

// 11: tick boxes in a table (one per row, or unlimited)
RENDER.table_check = (q, a, set, ro, area) => {
  const free = q.mode === "free";
  const cur = Array.isArray(a) ? a.slice() : (free ? [] : q.rows.map(() => null));
  area.appendChild(el("div", "hint", free ? "Tick every box that applies." : "Tick one box in each row."));
  const t = el("table", "ctable");
  t.appendChild(el("tr", "", `<th></th>` + q.cols.map(c => `<th>${txt(c)}</th>`).join("")));
  q.rows.forEach((r, ri) => {
    const tr = el("tr"); tr.appendChild(el("td", "ctext", txt(r)));
    q.cols.forEach((c, ci) => {
      const key = ri + ":" + ci, on = free ? cur.includes(key) : cur[ri] === ci;
      const td = el("td", "ccell"); const b = el("button", "check" + (on ? " on" : ""), on ? "&#10003;" : "");
      b.setAttribute("aria-label", r + " " + c);
      if (!ro) b.addEventListener("click", () => {
        if (free) set(on ? cur.filter(x => x !== key) : cur.concat([key]));
        else { const n = cur.slice(); n[ri] = on ? null : ci; set(n); }
      });
      td.appendChild(b); tr.appendChild(td);
    });
    t.appendChild(tr);
  });
  area.appendChild(t);
};

// 12: one or more drop-down lists inside a sentence
RENDER.dropdown = (q, a, set, ro, area) => {
  const cur = Array.isArray(a) ? a.slice() : q.blanks.map(() => null);
  let html = txt(q.stem);
  q.blanks.forEach((b, i) => { html = html.replace("{" + (i + 1) + "}", `<span class="ddslot" data-i="${i}"></span>`); });
  const p = el("div", "dd-text q-text", html);
  p.querySelectorAll(".ddslot").forEach(sp => {
    const i = +sp.dataset.i, sel = el("select", "dd"); sel.disabled = ro;
    sel.appendChild(new Option("Select...", ""));
    q.blanks[i].options.forEach((o, oi) => sel.appendChild(new Option(typeof o === "string" ? o : (o.text || ""), String(oi))));
    sel.value = cur[i] == null ? "" : String(cur[i]);
    sel.addEventListener("change", () => { const n = cur.slice(); n[i] = sel.value === "" ? null : +sel.value; set(n); });
    sp.appendChild(sel);
  });
  area.appendChild(p);
};

// 13: type a number
RENDER.fill_number = (q, a, set, ro, area) => {
  const row = el("div", "fill-row");
  if (q.prefix) row.appendChild(el("span", "fill-fix", esc(q.prefix)));
  const inp = el("input", "fill-in"); inp.type = "text"; inp.inputMode = q.allow_decimal || q.allow_fraction ? "decimal" : "numeric";
  inp.autocomplete = "off"; inp.spellcheck = false; inp.value = a == null ? "" : a; inp.disabled = ro; inp.setAttribute("aria-label", "Your answer");
  const maxD = q.max_digits || 6;
  inp.addEventListener("input", () => {
    let v = inp.value, out = "";
    for (const ch of v) {
      if (/\d/.test(ch)) out += ch;
      else if (ch === "-" && q.allow_negative && out === "") out += ch;
      else if (ch === "." && q.allow_decimal && !out.includes(".") && !out.includes("/")) out += ch;
      else if (ch === "/" && q.allow_fraction && !out.includes("/") && !out.includes(".") && /\d$/.test(out)) out += ch;
    }
    while ((out.match(/\d/g) || []).length > maxD) out = out.slice(0, -1);
    if (out !== inp.value) inp.value = out;
    S.answers[q.id] = out === "" ? null : out; saveState(); updateNavState();
  });
  row.appendChild(inp);
  if (q.unit) row.appendChild(el("span", "fill-fix", esc(q.unit)));
  area.appendChild(row);
  area.appendChild(el("div", "hint", "Type your answer in the box." + (q.allow_negative ? " You may use a minus sign." : "")));
};

// ───────────────────────── describing the right answer (review) ─────────────────────────
function plain(o) { return typeof o === "string" ? esc(o) : esc(o.text || (o.img ? "[picture]" : "")); }
function describeCorrect(q) {
  const v = viewOf(q);
  switch (q.type) {
    case "mcq": return `${LET[v.correct]}. ${plain(v.options[v.correct])}`;
    case "pick_multi": return v.correct.slice().sort().map(i => `${LET[i]}. ${plain(v.options[i])}`).join("<br>");
    case "select_place": return (Array.isArray(v.correct) ? v.correct : [v.correct]).map(i => plain(v.options[i])).join("<br>");
    case "match": return q.slots.map((s, i) => `${plain(s)} &rarr; ${plain(q.items[q.correct[i]])}`).join("<br>");
    case "classify": return q.statements.map((s, i) => `${plain(s)} &rarr; ${plain(q.categories[q.correct[i]])}`).join("<br>");
    case "order": return q.correct.map((idx, p) => `${p + 1}. ${plain(q.items[idx])}`).join("<br>");
    case "sort_groups": return q.items.map((it, i) => `${plain(it)} &rarr; ${q.correct[i] == null ? "(not placed)" : plain(q.groups[q.correct[i]])}`).join("<br>");
    case "select_paragraph": return `Paragraph ${q.correct + 1}`;
    case "puzzle": return q.locations.map((L, i) => `${plain(L)} &rarr; ${esc(q.colors[q.correct[i]].name)}`).join("<br>");
    case "table_check": return q.mode === "free" ? q.correct.map(p => `${plain(q.rows[p[0]])}: ${plain(q.cols[p[1]])}`).join("<br>") : q.rows.map((r, i) => `${plain(r)} &rarr; ${plain(q.cols[q.correct[i]])}`).join("<br>");
    case "dropdown": return q.blanks.map((b, i) => `Blank ${i + 1}: ${plain(b.options[q.correct[i]])}`).join("<br>");
    case "fill_number": return esc(String(q.correct)) + (q.unit ? " " + esc(q.unit) : "");
  }
  return "";
}
function renderReviewExtras(q) {
  const rb = $("review-box"), eb = $("explanation-box");
  if (!reviewMode) { rb.style.display = "none"; eb.style.display = "none"; return; }
  const ok = grade(viewOf(q), S.answers[q.id]);
  rb.innerHTML = `<div class="rv-status ${ok ? "rv-ok" : "rv-bad"}">${ok ? "Correct" : (isAnswered(q, S.answers[q.id]) ? "Incorrect" : "Not answered")}</div><div class="rv-label">Correct answer</div><div class="rv-body">${describeCorrect(q)}</div>`;
  rb.style.display = "block";
  $("explanation-text").innerHTML = txt(q.explanation || "");
  eb.style.display = q.explanation ? "block" : "none";
}

// ───────────────────────── navigation, flags, map ─────────────────────────
function updateNavState() {
  const ids = listForUI(), n = reviewMode ? reviewPos : S.cur;
  $("prev-btn").disabled = n === 0; $("next-btn").disabled = n === ids.length - 1;
  const answered = ids.filter(id => isAnswered(BY_ID.get(id), S.answers[id])).length;
  $("progress-bar").style.width = (ids.length ? (answered / ids.length) * 100 : 0) + "%";
}
function navigate(d) {
  const ids = listForUI();
  if (reviewMode) reviewPos = Math.max(0, Math.min(ids.length - 1, reviewPos + d));
  else S.cur = Math.max(0, Math.min(ids.length - 1, S.cur + d));
  saveState(); renderQuestion(); window.scrollTo(0, 0);
}
function toggleFlag() { const q = currentQAny(); S.flags[q.id] = !S.flags[q.id]; saveState(); renderQuestion(); }
function openMap() {
  const ids = listForUI(), grid = $("q-grid"); grid.innerHTML = "";
  ids.forEach((id, i) => {
    const q = BY_ID.get(id), n = reviewMode ? reviewPos : S.cur;
    let cls = "grid-btn";
    if (reviewMode) cls += grade(viewOf(q), S.answers[id]) ? " answered" : "";
    else { if (isAnswered(q, S.answers[id])) cls += " answered"; if (S.flags[id]) cls += " flagged"; }
    if (i === n) cls += " active";
    const b = el("button", cls, String(i + 1));
    b.addEventListener("click", () => { if (reviewMode) reviewPos = i; else S.cur = i; saveState(); closeMap(); renderQuestion(); });
    grid.appendChild(b);
  });
  show("map-modal", true);
}
function closeMap() { show("map-modal", false); }
function keyHandler(e) {
  if (!S || $("app").style.display === "none" || e.target.tagName === "INPUT" || e.target.tagName === "SELECT") return;
  if (e.key === "ArrowRight") navigate(1);
  else if (e.key === "ArrowLeft") navigate(-1);
  else if (!reviewMode) {
    const q = currentQAny(); if (!q || (q.type !== "mcq" && q.type !== "pick_multi")) return;
    const i = LET.indexOf(e.key.toUpperCase());
    if (i >= 0 && i < (q.options || []).length && e.key.length === 1) {
      const v = viewOf(q), a = getAns(q);
      if (q.type === "mcq") setAns(q, a === i ? null : i);
      else { const cur = Array.isArray(a) ? a : []; if (cur.includes(i)) setAns(q, cur.filter(x => x !== i)); else if (cur.length < v.correct.length) setAns(q, cur.concat([i])); else toast(`You have reached the maximum of ${v.correct.length}.`); }
    }
  }
}

// ───────────────────────── finishing sections ─────────────────────────
function finishSectionPrompt() {
  const sec = S.secs[S.si];
  const un = sec.qids.filter(id => !isAnswered(BY_ID.get(id), S.answers[id])).length;
  const msg = un ? `${un} question${un === 1 ? " is" : "s are"} still unanswered. Finish this section anyway? You cannot come back to it.` : "Finish this section? You cannot come back to it.";
  if (window.confirm(msg)) finishSection(false);
}
function finishSection(timedOut) {
  stopTimer();
  const sec = S.secs[S.si]; sec.done = true; saveState();
  if (S.si + 1 < S.secs.length) {
    const nx = S.secs[S.si + 1].def;
    show("app", false); show("calc-panel", false);
    $("btw-title").textContent = (timedOut ? "Time is up. " : "") + `${S.secs[S.si].def.label} is finished`;
    $("btw-text").textContent = `Next: ${nx.label}. ${nx.n} questions, ${nx.min} minutes.${nx.calc ? " A calculator is allowed." : ""}${nx.part === 1 ? " No calculator for this part." : ""}`;
    show("between-screen", true);
  } else showResults();
}
function startNextSection() { enterSection(S.si + 1); }

// ───────────────────────── results ─────────────────────────
function levelOf(p) { return p >= 80 ? ["Exceeds minimum standard", "ES"] : p >= 55 ? ["Meets minimum standard", "MS"] : p >= 40 ? ["Approaching minimum standard", "AS"] : ["Does not meet minimum standard", "DMS"]; }
function showResults() {
  stopTimer(); S.finished = true; saveState();
  show("app", false); show("between-screen", false); show("calc-panel", false); show("results-screen", true);
  const bySubject = {};
  S.secs.forEach(sec => {
    const ids = sec.qids; let right = 0; ids.forEach(id => { const q = BY_ID.get(id); if (grade(viewOf(q), S.answers[id])) right++; });
    const d = sec.def, o = bySubject[d.subject] || (bySubject[d.subject] = { parts: [] });
    o.parts.push({ label: d.label, right, n: ids.length, weight: d.weight || 1 });
  });
  const dom = $("res-domains"); dom.innerHTML = "";
  let lines = [];
  Object.keys(bySubject).forEach(sub => {
    const parts = bySubject[sub].parts; const wsum = parts.reduce((s, p) => s + p.weight, 0);
    const pct = Math.round(parts.reduce((s, p) => s + (p.n ? (p.right / p.n) * p.weight : 0), 0) / wsum * 1000) / 10;
    const [lab] = levelOf(pct);
    const detail = parts.length > 1 ? parts.map(p => `${p.label}: ${p.right}/${p.n}`).join(", ") : `${parts[0].right}/${parts[0].n}`;
    lines.push(`${SUBJECT_LABELS[sub]} ${pct}%`);
    dom.innerHTML += `<div class="res-domain-row"><div class="res-domain-name">${SUBJECT_LABELS[sub]}<br><small>${detail}</small></div><div class="res-domain-bar-wrap"><div class="res-domain-bar" style="width:${pct}%"></div></div><div class="res-domain-pct">${pct}%<br><small>${lab}</small></div></div>`;
    bySubject[sub].pct = pct;
  });
  const passAll = Object.values(bySubject).every(s => s.pct >= PASSING_PCT);
  $("res-status").textContent = Object.keys(bySubject).length === 1 ? (bySubject[Object.keys(bySubject)[0]].pct >= PASSING_PCT ? "PASSED (55% needed)" : "NOT YET (55% needed)") : (passAll ? "ALL SUBJECTS AT OR ABOVE 55%" : "SOME SUBJECTS BELOW 55%");
  $("res-score").textContent = lines.join("   |   ");
}

// ───────────────────────── review ─────────────────────────
function startReview() {
  reviewMode = true; reviewList = []; S.secs.forEach(s => s.qids.forEach(id => reviewList.push(id))); reviewPos = 0;
  show("results-screen", false); show("app", true, "flex");
  $("sec-title").textContent = "Review"; $("timer-display").textContent = "Review"; $("calc-btn").style.display = "none"; show("calc-panel", false);
  $("submit-btn").style.display = "none"; $("flag-btn").style.display = "none";
  renderQuestion();
}

// ───────────────────────── calculator (basic, Part II only) ─────────────────────────
function buildCalc() {
  const keys = ["C", "⌫", "%", "÷", "7", "8", "9", "×", "4", "5", "6", "−", "1", "2", "3", "+", "±", "0", ".", "="];
  let cur = "0", acc = null, op = null, fresh = true;
  const scr = $("calc-screen"), box = $("calc-keys");
  const fmt = n => { const r = Math.round(n * 1e10) / 1e10; return String(r); };
  const compute = (a, b, o) => o === "+" ? a + b : o === "−" ? a - b : o === "×" ? a * b : o === "÷" ? (b === 0 ? NaN : a / b) : b;
  keys.forEach(k => {
    const b = el("button", "ck" + (/[÷×−+=]/.test(k) ? " ck-op" : ""), k);
    b.addEventListener("click", () => {
      if (/\d/.test(k)) { cur = fresh ? k : (cur === "0" ? k : cur + k); fresh = false; }
      else if (k === ".") { if (fresh) { cur = "0."; fresh = false; } else if (!cur.includes(".")) cur += "."; }
      else if (k === "C") { cur = "0"; acc = null; op = null; fresh = true; }
      else if (k === "⌫") { cur = cur.length > 1 ? cur.slice(0, -1) : "0"; }
      else if (k === "±") { cur = cur.startsWith("-") ? cur.slice(1) : (cur === "0" ? cur : "-" + cur); }
      else if (k === "%") { cur = fmt(parseFloat(cur) / 100); fresh = true; }
      else if (k === "=") { if (op != null && acc != null) { cur = fmt(compute(acc, parseFloat(cur), op)); acc = null; op = null; fresh = true; } }
      else { if (op != null && acc != null && !fresh) { acc = compute(acc, parseFloat(cur), op); cur = fmt(acc); } else acc = parseFloat(cur); op = k; fresh = true; }
      scr.textContent = cur === "NaN" ? "Error" : cur;
    });
    box.appendChild(b);
  });
}
