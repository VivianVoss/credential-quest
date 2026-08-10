/* ------------------------- state & storage ------------------------- */

const QUIZ_LENGTH = 50;
let state = { view: "home", examCode: null, tab: "study", quiz: null, catFilter: "all", quoteIdx: Math.floor(Math.random()*QUOTES.length) };

function loadProgress(code){
  try{ return JSON.parse(localStorage.getItem("credquest_" + code)) || { best: 0, attempts: 0, seenIdx: [] }; }
  catch(e){ return { best: 0, attempts: 0, seenIdx: [] }; }
}
function saveProgress(code, pct){
  const p = loadProgress(code);
  p.attempts += 1;
  if (pct > p.best) p.best = pct;
  localStorage.setItem("credquest_" + code, JSON.stringify(p));
}

/* Picks the next QUIZ_LENGTH questions from the exam's full pool, tracking
   which questions have already been surfaced (per exam, in localStorage) so
   retries circulate through the whole pool before anything repeats. Once the
   pool is exhausted, it wraps back around. */
function pickQuizQuestions(exam){
  const total = exam.questions.length;
  const take = Math.min(QUIZ_LENGTH, total);
  const progress = loadProgress(exam.code);
  let seen = new Set(progress.seenIdx || []);
  if (seen.size >= total) seen = new Set();

  let unseenIdx = [];
  for (let i = 0; i < total; i++) if (!seen.has(i)) unseenIdx.push(i);
  let batchIdx = shuffle(unseenIdx).slice(0, take);

  if (batchIdx.length < take){
    const excluded = new Set(batchIdx);
    let wrapPool = [];
    for (let i = 0; i < total; i++) if (!excluded.has(i)) wrapPool.push(i);
    batchIdx = batchIdx.concat(shuffle(wrapPool).slice(0, take - batchIdx.length));
  }

  batchIdx.forEach(i => seen.add(i));
  progress.seenIdx = Array.from(seen);
  localStorage.setItem("credquest_" + exam.code, JSON.stringify(progress));

  return shuffle(batchIdx.map(i => exam.questions[i]));
}

/* ------------------------------ render ------------------------------ */

function render(){
  const app = document.getElementById("app");
  if (state.view === "home") app.innerHTML = renderHome();
  else app.innerHTML = renderExam(state.examCode);
  wireEvents();
}

function badgesFor(entry){
  const built = !!EXAMS[entry.code];
  let out = [];
  out.push(built ? `<span class="miniBadge mb-ready">Practice ready</span>` : `<span class="miniBadge mb-soon">Coming soon</span>`);
  if (entry.beta) out.push(`<span class="miniBadge mb-beta">Beta</span>`);
  if (entry.isNew) out.push(`<span class="miniBadge mb-new">New</span>`);
  if (entry.expert) out.push(`<span class="miniBadge mb-expert">Expert</span>`);
  return out.join("");
}

function renderHome(){
  const exampleCards = EXAMPLE_CODES.map(code => {
    const entry = CATALOG.find(e => e.code === code);
    const exam = EXAMS[code];
    const color = CAT_COLOR[entry.category] || "var(--accent)";
    return `
      <button class="exampleCard" style="--cat-color:${color}" data-goto="${code}">
        <div class="code">${code}</div>
        <div class="cert">${exam ? exam.cert : entry.title}</div>
        <div class="title">${exam ? exam.title : entry.category}</div>
        <span class="catChip" style="--cat-color:${color}">${entry.category.replace(" Platforms","").replace(" Solutions","")}</span>
      </button>
    `;
  }).join("");

  const quote = QUOTES[state.quoteIdx];

  const cats = ["all", ...Array.from(new Set(CATALOG.map(e => e.category)))];
  const filterChips = cats.map(c => `
    <button class="filterChip ${state.catFilter === c ? "active" : ""}" style="--cat-color:${CAT_COLOR[c] || "var(--accent)"}" data-catfilter="${c}">${c === "all" ? "All credentials" : c}</button>
  `).join("");

  const visible = state.catFilter === "all" ? CATALOG : CATALOG.filter(e => e.category === state.catFilter);
  const tierOrder = ["Fundamentals","Role-based","Specialty","Business"];
  const grouped = tierOrder.map(tier => {
    const items = visible.filter(e => e.tier === tier);
    if (!items.length) return "";
    const cards = items.map(e => {
      const color = CAT_COLOR[e.category] || "var(--accent)";
      return `
        <div class="catalogCard" style="--cat-color:${color}" data-goto="${e.code}">
          <div class="row1"><span class="code">${e.code}</span></div>
          <div class="title">${e.title}${e.provider === "GitHub" ? " (GitHub)" : ""}</div>
          <div class="miniBadges">${badgesFor(e)}</div>
        </div>
      `;
    }).join("");
    return `<div class="hint" style="margin:20px 2px 10px;font-weight:700;text-transform:uppercase;letter-spacing:.06em;font-size:.75rem;">${tier}</div><div class="catalogGrid">${cards}</div>`;
  }).join("");

  return `
    <div class="top">
      <div class="brand"><span class="dot"></span> Credential Quest</div>
      <span class="tagline">Free Microsoft certification trainer</span>
    </div>

    <div class="hero">
      <h1>Which certification are you chasing?</h1>
      <p>Search any exam from Microsoft's certification poster — every credential across Cloud &amp; AI Platforms, AI Business Solutions, Security, and GitHub. Get a Learn-grounded skills breakdown plus a practice quiz, free.</p>
      <div class="searchWrap">
        <div class="searchRow">
          <input id="examInput" placeholder="Try AZ-900, or 'security fundamentals'…" autocomplete="off">
          <button class="btn-primary" id="goBtn">Let's go →</button>
        </div>
        <div id="suggestBox"></div>
      </div>
      <div class="err" id="errMsg" style="text-align:center;"></div>
      <div class="hint">Based on Microsoft's official certification poster, last updated July 2026.</div>
    </div>

    <div class="sectionLabel">Popular starting points</div>
    <div class="sectionSub">The six Fundamentals credentials — the classic on-ramp into the Microsoft ecosystem.</div>
    <div class="exampleGrid">${exampleCards}</div>

    <div class="sectionLabel">While you're procrastinating studying</div>
    <div class="quoteCard">
      <span class="mark">“</span>
      <blockquote>${quote}</blockquote>
      <button class="btn-ghost refreshQuote" id="nextQuoteBtn">Another →</button>
    </div>

    <div class="sectionLabel">Browse every credential</div>
    <div class="sectionSub">Straight off Microsoft's official certification poster (aka.ms/CertificationsPoster, last updated July 2026).</div>
    <div class="filterRow">${filterChips}</div>
    ${grouped}

    <div class="disclaimer">
      Skills-measured outlines and resource links are pulled from the official Microsoft Learn study guides. Practice questions are original — not reproductions of real exam questions, which Microsoft never publishes; question pools for practice-ready exams are written from the actual content of each exam's real Microsoft Learn training modules. Each practice run surfaces 50 questions that rotate through the full pool before repeating. Credential names, codes, and categories are drawn directly from Microsoft's official certification poster — this is an independent community study tool, not an official Microsoft product.
    </div>
    <div class="footer">Not affiliated with or endorsed by Microsoft. All trademarks belong to their respective owners.</div>
  `;
}

function renderExam(code){
  const exam = EXAMS[code];
  if (!exam) { state.view = "home"; return renderHome(); }
  const progress = loadProgress(code);

  const domainsHtml = exam.domains.map(d => `
    <div class="domainCard">
      <div class="domainHead"><span class="name">${d.name}</span><span class="weight">${d.weight}</span></div>
      <div class="barTrack"><div class="barFill" style="width:${d.mid * 2}%"></div></div>
      <div class="hint" style="margin:-6px 0 10px;"><a href="${d.link}" target="_blank" rel="noopener">🎓 Take the free Microsoft Learn training for this skill →</a></div>
      <ul class="skillList">${d.skills.map(s => `<li>${s}</li>`).join("")}</ul>
    </div>
  `).join("");

  const resourcesHtml = exam.resources.map(r => `<li><a href="${r.url}" target="_blank" rel="noopener">${r.label}</a></li>`).join("");
  const prereqHtml = exam.prereqs.map(p => `<li>${p}</li>`).join("");

  let studyTab = `
    <div class="metaRow">
      <span class="pill">Level: ${exam.level}</span>
      <span class="pill">Pass score: ${exam.passScore}</span>
      ${exam.beta ? '<span class="pill">Beta exam</span>' : ''}
    </div>
    <div class="linkRow">
      <a href="${exam.studyGuideUrl}" target="_blank" rel="noopener">📘 Official study guide</a>
      <a href="${exam.certUrl}" target="_blank" rel="noopener">🎓 Certification page</a>
    </div>
    <div class="sectionLabel">Skills measured</div>
    ${domainsHtml}
    <div class="resBox">
      <h4>Prerequisites</h4>
      <ul>${prereqHtml}</ul>
      <h4>Resources</h4>
      <ul>${resourcesHtml}</ul>
    </div>
  `;

  let quizTab = renderQuiz(exam);

  return `
    <button class="backBtn" id="backBtn">← All credentials</button>
    <div class="examHeader">
      <div class="code">${exam.code}</div>
      <h2>${exam.cert}</h2>
      <div class="hint">${exam.title}</div>
      ${progress.attempts > 0 ? `<div class="hint" style="margin-top:6px;">Best score: <strong>${progress.best}%</strong> · ${progress.attempts} attempt${progress.attempts>1?'s':''}</div>` : ''}
    </div>
    <div class="tabs">
      <button class="tab ${state.tab === 'study' ? 'active' : ''}" data-tab="study">📘 Study Guide</button>
      <button class="tab ${state.tab === 'quiz' ? 'active' : ''}" data-tab="quiz">🎮 Practice Quiz</button>
    </div>
    <div id="tabContent">${state.tab === 'study' ? studyTab : quizTab}</div>
  `;
}

/* -------------------------------- quiz ------------------------------- */

function shuffle(arr){
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--){
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function startQuiz(exam){
  state.quiz = {
    order: pickQuizQuestions(exam),
    idx: 0,
    score: 0,
    answered: false,
    selected: null,
    multiSelected: [],
    orderShuffled: null,
    orderPickedIdx: [],
    missedDomains: []
  };
}

const TYPE_LABEL = { single: "Single choice", multi: "Select all that apply", order: "Put in order" };
const DIFF_LABEL = { easy: "🟢 Quick", medium: "🟡 Medium", hard: "🔴 Scenario" };

function recordAnswer(isCorrect, domain){
  const quiz = state.quiz;
  quiz.answered = true;
  if (isCorrect){ quiz.score += 1; burstConfetti(); }
  else { quiz.missedDomains.push(domain); }
}

function renderExplain(isCorrect, explain, idx, total){
  return `
    <div class="explainBox">${isCorrect ? "✅ " : "💡 "}${explain}</div>
    <div class="nextRow"><button class="btn-primary" id="nextBtn">${idx + 1 === total ? "See results" : "Next question →"}</button></div>
  `;
}

function renderSingle(q, quiz){
  const optsHtml = q.options.map((opt, i) => {
    let cls = "opt";
    if (quiz.answered){
      if (i === q.correct) cls += " correct";
      else if (i === quiz.selected) cls += " wrong";
    }
    return `<button class="${cls}" data-opt="${i}" ${quiz.answered ? "disabled" : ""}>${opt}</button>`;
  }).join("");
  return `
    <div class="options">${optsHtml}</div>
    ${quiz.answered ? renderExplain(quiz.selected === q.correct, q.explain, quiz.idx, quiz.order.length) : ''}
  `;
}

function renderMulti(q, quiz){
  const pickCount = q.correct.length;
  const optsHtml = q.options.map((opt, i) => {
    let cls = "opt";
    const isSelected = quiz.multiSelected.includes(i);
    const isCorrect = q.correct.includes(i);
    if (quiz.answered){
      if (isCorrect) cls += " correct";
      else if (isSelected) cls += " wrong";
    } else if (isSelected){
      cls += " selected";
    }
    const mark = quiz.answered ? "" : (isSelected ? "☑ " : "☐ ");
    return `<button class="${cls}" data-multiopt="${i}" ${quiz.answered ? "disabled" : ""}>${mark}${opt}</button>`;
  }).join("");
  const isCorrectAnswer = quiz.multiSelected.length === q.correct.length && quiz.multiSelected.every(i => q.correct.includes(i));
  return `
    <div class="hint" style="margin-bottom:10px;">Select ${pickCount}.</div>
    <div class="options">${optsHtml}</div>
    ${quiz.answered
      ? renderExplain(isCorrectAnswer, q.explain, quiz.idx, quiz.order.length)
      : `<div class="nextRow"><button class="btn-primary" id="submitMultiBtn" ${quiz.multiSelected.length === 0 ? "disabled" : ""}>Check answer</button></div>`}
  `;
}

function renderOrder(q, quiz){
  if (!quiz.orderShuffled){ quiz.orderShuffled = shuffle(q.items); quiz.orderPickedIdx = []; }
  const pickedHtml = quiz.orderPickedIdx.map((shuffledIdx, pos) => {
    const item = quiz.orderShuffled[shuffledIdx];
    let cls = "opt orderPicked";
    if (quiz.answered) cls += (q.items[pos] === item) ? " correct" : " wrong";
    return `<div class="${cls}"><span class="pill" style="margin-right:8px;">${pos + 1}</span>${item}</div>`;
  }).join("");
  const remainingHtml = quiz.orderShuffled.map((item, i) => {
    if (quiz.orderPickedIdx.includes(i)) return "";
    return `<button class="opt" data-orderidx="${i}" ${quiz.answered ? "disabled" : ""}>${item}</button>`;
  }).join("");
  const allPicked = quiz.orderPickedIdx.length === q.items.length;
  const isCorrectAnswer = allPicked && quiz.orderPickedIdx.every((shuffledIdx, pos) => quiz.orderShuffled[shuffledIdx] === q.items[pos]);
  return `
    <div class="hint" style="margin-bottom:10px;">Click each item, in the order you think is correct.</div>
    <div class="orderPickedList">${pickedHtml || '<div class="hint">Nothing picked yet — click an item below to start.</div>'}</div>
    <div class="options">${remainingHtml}</div>
    ${allPicked
      ? (quiz.answered
          ? renderExplain(isCorrectAnswer, q.explain, quiz.idx, quiz.order.length)
          : `<div class="nextRow"><button class="btn-primary" id="submitOrderBtn">Check order</button></div>`)
      : (quiz.orderPickedIdx.length > 0 ? `<div class="nextRow"><button class="btn-ghost" id="resetOrderBtn">Reset</button></div>` : '')}
  `;
}

function renderQuiz(exam){
  if (!state.quiz) startQuiz(exam);
  const quiz = state.quiz;

  if (quiz.idx >= quiz.order.length){
    const pct = Math.round((quiz.score / quiz.order.length) * 100);
    saveProgress(exam.code, pct);
    let msg = pct === 100 ? "Flawless. You're exam-ready. 🏆"
      : pct >= 80 ? "So close — polish the domains below and you're set. 💪"
      : pct >= 50 ? "Solid start. Give the flagged domains another pass. 📘"
      : "Good foundation to build on — revisit the study guide and try again. 🌱";
    const missed = [...new Set(quiz.missedDomains)];
    return `
      <div class="scoreScreen">
        <div class="hint">You scored</div>
        <div class="big">${pct}%</div>
        <div class="msg">${msg}</div>
        ${missed.length ? `<div class="missedList"><strong>Domains to revisit:</strong><ul>${missed.map(m=>`<li>${m}</li>`).join("")}</ul></div>` : ''}
        <div class="actions">
          <button class="btn-primary" id="retryBtn">Retry quiz</button>
          <button class="btn-ghost" id="studyAgainBtn">Back to study guide</button>
        </div>
      </div>
    `;
  }

  const q = quiz.order[quiz.idx];
  const total = quiz.order.length;
  const type = q.type || "single";
  const body = type === "multi" ? renderMulti(q, quiz) : type === "order" ? renderOrder(q, quiz) : renderSingle(q, quiz);

  return `
    <div class="quizTop">
      <span>Question ${quiz.idx + 1} / ${total}</span>
      <div class="progressTrack"><div class="progressFill" style="width:${(quiz.idx / total) * 100}%"></div></div>
      <span>Score: ${quiz.score}</span>
    </div>
    <div class="domainTag">${q.domain}<span class="typeTag">${TYPE_LABEL[type]}</span>${q.difficulty ? `<span class="typeTag">${DIFF_LABEL[q.difficulty]}</span>` : ''}</div>
    <div class="qText">${q.q}</div>
    ${body}
  `;
}

function burstConfetti(){
  const colors = ["#00ef98","#00c67d","#ffb84d","#ff5d6c","#eef2f4"];
  const el = document.createElement("div");
  el.className = "confetti";
  for (let i = 0; i < 26; i++){
    const s = document.createElement("span");
    s.style.left = Math.random() * 100 + "vw";
    s.style.background = colors[Math.floor(Math.random()*colors.length)];
    s.style.animationDuration = (1.6 + Math.random()*1.2) + "s";
    s.style.animationDelay = (Math.random()*0.3) + "s";
    el.appendChild(s);
  }
  document.body.appendChild(el);
  setTimeout(() => el.remove(), 3200);
}

/* ------------------------------- events ------------------------------ */

function matchCatalog(query){
  const q = query.trim().toLowerCase();
  if (!q) return [];
  return CATALOG.filter(e => e.code.toLowerCase().includes(q) || e.title.toLowerCase().includes(q) || e.category.toLowerCase().includes(q)).slice(0, 8);
}

function goToExam(code){
  code = (code || "").trim().toUpperCase();
  const errEl = document.getElementById("errMsg");
  if (!code) return;
  if (EXAMS[code]){
    state.view = "exam"; state.examCode = code; state.tab = "study"; state.quiz = null;
    render();
    return;
  }
  const entry = CATALOG.find(e => e.code === code);
  if (errEl){
    if (entry) errEl.textContent = `${code} — ${entry.title} — is on the poster but not built out yet. Ask to have it added!`;
    else errEl.textContent = `"${code}" isn't on the certification poster. Try a code like AZ-900 or a keyword like "security".`;
  }
}

function wireEvents(){
  const goBtn = document.getElementById("goBtn");
  const input = document.getElementById("examInput");
  const suggestBox = document.getElementById("suggestBox");

  function renderSuggest(){
    if (!input || !suggestBox) return;
    const matches = matchCatalog(input.value);
    if (!matches.length){ suggestBox.innerHTML = ""; return; }
    suggestBox.innerHTML = `<div class="suggestBox">${matches.map(e => `
      <div class="suggestItem" data-goto="${e.code}">
        <span class="code">${e.code}</span>
        <span class="title">${e.title}</span>
        <span class="tag">${EXAMS[e.code] ? "Ready" : "Soon"}</span>
      </div>
    `).join("")}</div>`;
    suggestBox.querySelectorAll("[data-goto]").forEach(el => {
      el.addEventListener("click", () => {
        suggestBox.innerHTML = "";
        goToExam(el.getAttribute("data-goto"));
      });
    });
  }

  if (input){
    input.addEventListener("input", renderSuggest);
    input.addEventListener("keydown", e => { if (e.key === "Enter") goToExam(input.value); });
    input.addEventListener("focus", renderSuggest);
    document.addEventListener("click", e => {
      if (suggestBox && !suggestBox.contains(e.target) && e.target !== input) suggestBox.innerHTML = "";
    });
  }
  if (goBtn) goBtn.addEventListener("click", () => goToExam(input.value));

  document.querySelectorAll("[data-goto]").forEach(el => {
    el.addEventListener("click", () => goToExam(el.getAttribute("data-goto")));
  });

  document.querySelectorAll("[data-catfilter]").forEach(el => {
    el.addEventListener("click", () => { state.catFilter = el.getAttribute("data-catfilter"); render(); });
  });

  const nextQuoteBtn = document.getElementById("nextQuoteBtn");
  if (nextQuoteBtn) nextQuoteBtn.addEventListener("click", () => {
    let next = Math.floor(Math.random() * QUOTES.length);
    if (QUOTES.length > 1) while (next === state.quoteIdx) next = Math.floor(Math.random() * QUOTES.length);
    state.quoteIdx = next;
    render();
  });

  const backBtn = document.getElementById("backBtn");
  if (backBtn) backBtn.addEventListener("click", () => { state.view = "home"; render(); });

  document.querySelectorAll(".tab").forEach(el => {
    el.addEventListener("click", () => { state.tab = el.getAttribute("data-tab"); render(); });
  });

  document.querySelectorAll("[data-opt]").forEach(el => {
    el.addEventListener("click", () => {
      const quiz = state.quiz;
      const i = parseInt(el.getAttribute("data-opt"), 10);
      const q = quiz.order[quiz.idx];
      quiz.selected = i;
      recordAnswer(i === q.correct, q.domain);
      render();
    });
  });

  document.querySelectorAll("[data-multiopt]").forEach(el => {
    el.addEventListener("click", () => {
      const quiz = state.quiz;
      const i = parseInt(el.getAttribute("data-multiopt"), 10);
      const pos = quiz.multiSelected.indexOf(i);
      if (pos === -1) quiz.multiSelected.push(i); else quiz.multiSelected.splice(pos, 1);
      render();
    });
  });

  const submitMultiBtn = document.getElementById("submitMultiBtn");
  if (submitMultiBtn) submitMultiBtn.addEventListener("click", () => {
    const quiz = state.quiz;
    const q = quiz.order[quiz.idx];
    const isCorrect = quiz.multiSelected.length === q.correct.length && quiz.multiSelected.every(i => q.correct.includes(i));
    recordAnswer(isCorrect, q.domain);
    render();
  });

  document.querySelectorAll("[data-orderidx]").forEach(el => {
    el.addEventListener("click", () => {
      const quiz = state.quiz;
      quiz.orderPickedIdx.push(parseInt(el.getAttribute("data-orderidx"), 10));
      render();
    });
  });

  const resetOrderBtn = document.getElementById("resetOrderBtn");
  if (resetOrderBtn) resetOrderBtn.addEventListener("click", () => {
    state.quiz.orderPickedIdx = [];
    render();
  });

  const submitOrderBtn = document.getElementById("submitOrderBtn");
  if (submitOrderBtn) submitOrderBtn.addEventListener("click", () => {
    const quiz = state.quiz;
    const q = quiz.order[quiz.idx];
    const isCorrect = quiz.orderPickedIdx.every((shuffledIdx, pos) => quiz.orderShuffled[shuffledIdx] === q.items[pos]);
    recordAnswer(isCorrect, q.domain);
    render();
  });

  const nextBtn = document.getElementById("nextBtn");
  if (nextBtn) nextBtn.addEventListener("click", () => {
    state.quiz.idx += 1;
    state.quiz.answered = false;
    state.quiz.selected = null;
    state.quiz.multiSelected = [];
    state.quiz.orderShuffled = null;
    state.quiz.orderPickedIdx = [];
    render();
  });

  const retryBtn = document.getElementById("retryBtn");
  if (retryBtn) retryBtn.addEventListener("click", () => {
    startQuiz(EXAMS[state.examCode]);
    render();
  });
  const studyAgainBtn = document.getElementById("studyAgainBtn");
  if (studyAgainBtn) studyAgainBtn.addEventListener("click", () => {
    state.tab = "study"; state.quiz = null; render();
  });
}

render();
