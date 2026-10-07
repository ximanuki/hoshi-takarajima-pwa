// AI総務さん — minimal UI. No framework, no build step.
// All server text is inserted with textContent (never innerHTML) so document
// content cannot inject markup into the page.
"use strict";

const EXAMPLES = [
  "有給休暇を時間単位で取れるのは年に何日分まで？",
  "月60時間を超える残業の割増率は？",
  "定年後も働き続けられますか？",
  "出張の日当はいくらですか？",
  "社員食堂の営業時間は？", // not in the documents → abstains
];

const $ = (id) => document.getElementById(id);

function el(tag, attrs = {}, ...children) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === "class") node.className = v;
    else if (k.startsWith("on")) node.addEventListener(k.slice(2), v);
    else node.setAttribute(k, v);
  }
  for (const c of children) node.append(c instanceof Node ? c : document.createTextNode(String(c)));
  return node;
}

function setStatus(text, isError = false) {
  const s = $("status");
  s.textContent = text;
  s.hidden = !text;
  s.classList.toggle("error", isError);
}

// Replace [n] markers in the answer with links to the citation cards.
function renderAnswer(container, text, markers) {
  container.replaceChildren();
  const re = /\[(\d+)\]/g;
  let last = 0;
  let m;
  while ((m = re.exec(text)) !== null) {
    container.append(text.slice(last, m.index));
    const n = Number(m[1]);
    if (markers.has(n)) {
      container.append(el("a", { class: "ref", href: `#cite-${n}`, "aria-label": `出典${n}`,
        onclick: () => flash(n) }, String(n)));
    }
    last = re.lastIndex;
  }
  container.append(text.slice(last));
}

function flash(n) {
  const li = $(`cite-${n}`);
  if (!li) return;
  li.classList.add("flash");
  setTimeout(() => li.classList.remove("flash"), 1200);
}

function compact(text) {
  // Join PDF-wrapped Japanese lines for display.
  return text.replace(/([^\x00-\x7f])[ \t　]*\n[ \t　]*(?=[^\x00-\x7f])/g, "$1")
    .replace(/\s+/g, " ").trim();
}

function renderCitation(c) {
  const loc = [c.page ? `p.${c.page}` : null, c.heading].filter(Boolean).join("　");
  const source = el("div", { class: "source", hidden: "" },
    c.chunk_text.slice(0, c.chunk_start),
    el("mark", {}, c.chunk_text.slice(c.chunk_start, c.chunk_end)),
    c.chunk_text.slice(c.chunk_end));
  const toggle = el("button", { type: "button", class: "toggle", "aria-expanded": "false" },
    "原文で確認する");
  toggle.addEventListener("click", () => {
    const open = source.hidden;
    source.hidden = !open;
    toggle.setAttribute("aria-expanded", String(open));
    toggle.textContent = open ? "原文を閉じる" : "原文で確認する";
    if (open) source.querySelector("mark")?.scrollIntoView({ block: "center", behavior: "smooth" });
  });
  const docTitle = c.source_url
    ? el("a", { href: c.source_url, target: "_blank", rel: "noopener noreferrer", class: "cite-doc" }, c.doc_title)
    : el("span", { class: "cite-doc" }, c.doc_title);
  return el("li", { id: `cite-${c.marker}` },
    el("div", { class: "cite-head" }, el("span", { class: "cite-num" }, `[${c.marker}]`), docTitle,
      el("span", { class: "cite-loc" }, loc)),
    el("blockquote", { class: "cite-quote" }, compact(c.quote)),
    toggle, source);
}

function renderResult(r) {
  $("result").hidden = false;
  const card = $("answer-card");
  card.classList.toggle("abstained", r.abstained);
  $("answer-title").textContent = r.abstained ? "回答できませんでした" : "回答";
  renderAnswer($("answer"), r.answer, new Set(r.citations.map((c) => c.marker)));
  $("abstain-note").hidden = !r.abstained;

  const provider = r.provider === "gate" ? "検索段階で判定" : r.provider === "claude" ? `Claude (${r.model})` : "抽出型（LLMなし）";
  const total = r.timings_ms && r.timings_ms.total ? `${Math.round(r.timings_ms.total)} ms` : "";
  $("meta").textContent = [`回答方式: ${provider}${r.degraded ? "（LLM障害のため代替）" : ""}`,
    `根拠スコア: ${r.support.toFixed(2)}`, total].filter(Boolean).join(" ・ ");

  $("citations").replaceChildren(...r.citations.map(renderCitation));
  $("citations-section").hidden = r.citations.length === 0;

  $("retrieved").replaceChildren(...r.retrieved.map((h) => el("tr", {},
    el("td", {}, String(h.rank)), el("td", {}, h.heading || h.chunk_id),
    el("td", {}, h.page_start ?? "—"), el("td", {}, h.bm25_rank ?? "—"),
    el("td", {}, h.dense_rank ?? "—"))));
}

async function ask(question) {
  const button = $("ask-button");
  button.disabled = true;
  setStatus("資料を検索しています…");
  try {
    const res = await fetch("/ask", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ question }),
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) {
      const detail = typeof body.detail === "string" ? body.detail : "エラーが発生しました。";
      setStatus(detail, true);
      return;
    }
    setStatus("");
    renderResult(body);
  } catch {
    setStatus("サーバーに接続できませんでした。", true);
  } finally {
    button.disabled = false;
  }
}

async function loadDocuments() {
  const list = $("documents");
  try {
    const res = await fetch("/documents");
    if (!res.ok) throw new Error(String(res.status));
    const docs = await res.json();
    list.replaceChildren(...docs.map((d) => el("li", {},
      d.source_url ? el("a", { href: d.source_url, target: "_blank", rel: "noopener noreferrer" }, d.title) : d.title,
      ` — ${d.pages ? `${d.pages}ページ、` : ""}${d.chunks}チャンク`,
      d.attribution ? el("div", {}, d.attribution) : "",
      d.license ? el("div", {}, `ライセンス: ${d.license}`) : "")));
  } catch {
    list.replaceChildren(el("li", {}, "資料一覧を取得できませんでした。"));
  }
}

document.addEventListener("DOMContentLoaded", () => {
  const q = $("question");
  $("examples").replaceChildren(...EXAMPLES.map((text) =>
    el("button", { type: "button", class: "chip", onclick: () => { q.value = text; ask(text); } }, text)));
  $("ask-form").addEventListener("submit", (e) => {
    e.preventDefault();
    const text = q.value.trim();
    if (text) ask(text);
  });
  q.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) $("ask-form").requestSubmit();
  });
  loadDocuments();
});
