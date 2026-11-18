import {
  CAPABILITY_BY_KEY,
  describeConnectionState,
  translateIncident,
  translateEvent,
  aggregateCapabilities,
  bucketHourlyEvents,
  summarizeQueues,
  mergeHistoryPage,
  formatBkkHm,
  formatBkkTime,
  formatBkkDateTime,
  formatSec,
  formatAge,
  formatShortAge,
} from "./view-model.js";
import { mountWorkView } from "./work-view.js";

const SVG_NS = "http://www.w3.org/2000/svg";
const $ = (id) => document.getElementById(id);

const VIEW_HEADERS = {
  overview: ["Warroom / ภาพรวม", "สุขภาพบอทวันนี้"],
  work: ["Warroom / งานทีม", "งานของฉัน"],
  history: ["Warroom / ประวัติ", "ประวัติการทำงาน 30 วัน"],
  settings: ["Warroom / การแจ้งเตือน", "การแจ้งเตือนและช่วงพัก"],
  members: ["Warroom / สมาชิก", "สมาชิกและสิทธิ์เข้าใช้งาน"],
};

let user = null;
let activeView = "overview";
let lastStatus = null;
let historyEvents = [];
let historyNextBefore = null;
let historyNextCursor = null;
let membersCache = [];
let apiFailed = false;
let busy = false;
let refreshQueued = false;
let pollTimer = null;
const work = mountWorkView({
  api,
  setHeader(title, update) {
    $("page-title").textContent = title;
    $("updated").textContent = update;
  },
});

let selectedCapability = 0;
let rhythmCapFilter = "all";
let selectedPointIndex = null;
let historyFilter = "all";
let searchQuery = "";

function el(tag, attrs = {}, ...children) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v === undefined || v === null || v === false) continue;
    if (k === "class") node.className = v;
    else if (k === "text") node.textContent = v;
    else if (k === "hidden") node.hidden = Boolean(v);
    else if (k.startsWith("on")) node.addEventListener(k.slice(2), v);
    else node.setAttribute(k, v === true ? "" : String(v));
  }
  for (const child of children.flat()) {
    if (child !== null && child !== undefined && child !== false) {
      node.append(child instanceof Node ? child : document.createTextNode(String(child)));
    }
  }
  return node;
}

function svgEl(tag, attrs = {}, ...children) {
  const node = document.createElementNS(SVG_NS, tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v === undefined || v === null) continue;
    node.setAttribute(k, String(v));
  }
  for (const child of children.flat()) {
    if (child !== null && child !== undefined && child !== false) {
      node.append(child instanceof Node ? child : document.createTextNode(String(child)));
    }
  }
  return node;
}

function showFeedback(message, ok = false) {
  const box = $("feedback");
  box.hidden = false;
  box.className = `feedback${ok ? " success" : ""}`;
  box.textContent = message;
}

function clearFeedback() {
  const box = $("feedback");
  box.hidden = true;
  box.textContent = "";
}

function errorText(err) {
  return (
    {
      last_admin: "ต้องมีผู้ดูแลอย่างน้อยหนึ่งคน จึงเปลี่ยนสิทธิ์หรือลบบัญชีนี้ไม่ได้",
      forbidden: "บัญชีนี้ไม่มีสิทธิ์ทำรายการ กรุณาเข้าสู่ระบบใหม่",
      invalid_member: "กรุณาตรวจอีเมลและสิทธิ์สมาชิก",
      not_invited: "อีเมลนี้ยังไม่ได้รับสิทธิ์ กรุณาติดต่อผู้ดูแล",
      login_expired: "การเข้าสู่ระบบหมดเวลา กรุณารีเฟรชแล้วลองใหม่",
      invalid_identity: "ยืนยันบัญชี Google ไม่สำเร็จ กรุณาลองใหม่",
      service_unavailable: "บริการยังไม่พร้อม กรุณาลองใหม่อีกครั้ง",
    }[err?.message] || "เชื่อมต่อไม่สำเร็จ กรุณาลองใหม่ ข้อมูลที่แสดงอาจไม่ใช่สถานะปัจจุบัน"
  );
}

async function api(path, options = {}) {
  const res = await fetch(path, {
    ...options,
    headers: {
      "content-type": "application/json",
      ...(user?.csrf ? { "x-csrf-token": user.csrf } : {}),
      ...options.headers,
    },
    signal: AbortSignal.timeout(12000),
  });
  const data = await res.json();
  if (!res.ok) {
    if (res.status === 401 && user) {
      user = null;
      stopPolling();
      await login();
    }
    const error = new Error(data?.error || "request_failed");
    error.status = res.status;
    throw error;
  }
  return data;
}

function stopPolling() {
  if (pollTimer) {
    clearInterval(pollTimer);
    pollTimer = null;
  }
}

async function login() {
  stopPolling();
  work.clear();
  $("shell").hidden = true;
  $("login").hidden = false;
  $("login-message").textContent = "";
  try {
    const config = await api("/api/login");
    if (!config.configured) {
      $("login-message").textContent =
        "กำลังเตรียมระบบเข้าสู่ระบบสำหรับทีม ยังไม่เปิดเผยข้อมูลสถานะต่อสาธารณะ";
      return;
    }
    if (!window.google) {
      await new Promise((resolve, reject) => {
        const script = document.createElement("script");
        script.src = "https://accounts.google.com/gsi/client";
        script.onload = resolve;
        script.onerror = reject;
        document.head.append(script);
      });
    }
    window.google.accounts.id.initialize({
      client_id: config.clientId,
      nonce: config.nonce,
      callback: async (result) => {
        try {
          await api("/api/login", {
            method: "POST",
            body: JSON.stringify({ credential: result.credential }),
          });
          location.reload();
        } catch (err) {
          $("login-message").textContent = errorText(err);
        }
      },
    });
    $("google-button").replaceChildren();
    window.google.accounts.id.renderButton($("google-button"), {
      theme: "outline",
      size: "large",
      text: "signin_with",
      locale: "th",
    });
  } catch (err) {
    $("login-message").textContent = errorText(err);
  }
}

function isAdmin() {
  return user?.role === "admin";
}

function emptyChartBox(title, body, variantClass = "empty-chart-box") {
  return el(
    "div",
    { class: variantClass },
    el("div", {}, el("strong", { text: title }), body ? el("p", { text: body }) : null),
  );
}

function deriveBodyState(status) {
  if (!status?.snapshot) return "empty";
  if (status.stale || apiFailed) return "stale";
  const hasAiErr = status.incidents?.some((i) => i.key?.startsWith("ai:"));
  if (hasAiErr) return "ai";
  const conn = describeConnectionState(status.snapshot.connection?.state);
  if (status.incidents?.length || conn.warn) return "problem";
  return "healthy";
}

function renderChrome(status) {
  const admin = isAdmin();
  $("user-role").textContent = admin ? "ผู้ดูแล (Admin)" : "ทีมงาน (Team)";
  $("user-email").textContent = user?.email || "—";
  $("account-email").textContent = user?.email || "—";
  $("avatar-badge").textContent = user?.email ? user.email.charAt(0).toUpperCase() : "S";
  $("breadcrumb").textContent = VIEW_HEADERS[activeView][0];
  $("page-title").textContent = VIEW_HEADERS[activeView][1];

  for (const node of document.querySelectorAll(".admin-only")) {
    node.hidden = !admin;
  }

  for (const btn of document.querySelectorAll(".nav-btn")) {
    if (btn.dataset.view === activeView) btn.setAttribute("aria-current", "page");
    else btn.removeAttribute("aria-current");
  }

  $("view-overview").hidden = activeView !== "overview";
  $("view-history").hidden = activeView !== "history";
  $("view-settings").hidden = activeView !== "settings";
  $("view-members").hidden = activeView !== "members";
  $("view-work").hidden = activeView !== "work";
  $("work-nav").hidden = !["paired", "reauth"].includes(user?.workAccess);
  $("work-access-card").hidden = !user?.canManageWork;
  $("status-pulse").hidden = activeView === "work";
  $("search-input").closest(".search-box").hidden = activeView === "work";

  const stale = status?.stale || apiFailed;
  if (activeView !== "work") {
    $("updated").textContent = !status?.receivedAt
      ? "ยังไม่ได้รับสถานะ"
      : stale
        ? `ข้อมูลเก่า · ล่าสุด ${formatBkkTime(status.receivedAt)}`
        : `รับสถานะล่าสุด ${formatBkkTime(status.receivedAt)}`;
  } else {
    work.show();
  }

  const now = status?.now || Date.now();
  const paused = Boolean(status?.pause?.until && status.pause.until > now);
  $("pause-banner").hidden = !paused;
  $("alerts-dot").hidden = !(admin && (paused || (status?.incidents?.length || 0) > 0));
  if (paused) {
    $("pause-banner-title").textContent = `กำลังพักอีเมลแจ้งเตือน (ถึง ${formatBkkDateTime(status.pause.until)})`;
    $("pause-banner-desc").textContent = `พักโดย ${status.pause.actor || "ผู้ดูแล"} · เว็บยังแสดงปัญหาจริง และจะกลับมาแจ้งเตือนเมื่อครบเวลา`;
  }

  const stack = $("incidents-stack");
  const incidents = status?.incidents || [];
  if (!incidents.length) {
    stack.hidden = true;
    stack.replaceChildren();
  } else {
    stack.hidden = false;
    stack.replaceChildren(
      ...incidents.map((inc) => {
        const info = translateIncident(inc);
        return el(
          "div",
          { class: "incident-card" },
          el("div", {}, el("strong", { text: info.title }), el("p", { text: info.hint })),
          el("small", { text: `พบตั้งแต่ ${formatBkkDateTime(info.openedAt)}` }),
        );
      }),
    );
  }
}

function renderKpis(status) {
  const grid = $("kpi-grid");
  const snap = status?.snapshot || null;
  const stale = Boolean(status?.stale || apiFailed);

  if (!snap) {
    const emptyCards = [
      { label: "เครื่องบอท", val: "ยังไม่ทราบ", sub: "รอข้อมูลแรก", tone: "is-unknown", icon: "comment" },
      { label: "WhatsApp", val: "ยังไม่ทราบ", sub: "รอข้อมูลแรก", tone: "is-unknown", icon: "list" },
      { label: "ส่งคำตอบล่าสุด", val: "ยังไม่มีข้อมูล", sub: "ไม่มีหลักฐานการส่ง", tone: "is-unknown", icon: "check" },
      { label: "งานในคิวรอ", val: "ยังไม่ทราบ", sub: "รอข้อมูลแรก", tone: "is-unknown", icon: "picture" },
      { label: "สถานะ AI ล่าสุด", val: "ยังไม่ทราบ", sub: "รอผลเรียก AI แรก", tone: "is-unknown", icon: "wand" },
    ];
    grid.replaceChildren(...emptyCards.map(buildKpiCard));
    return;
  }

  const conn = describeConnectionState(snap.connection?.state);
  const qSum = summarizeQueues(snap.queues, status.now);
  const qMain = qSum?.byName?.main || { waiting: 0, running: 0 };
  const qOtherWait = (qSum?.byName?.media?.waiting || 0) + (qSum?.byName?.render?.waiting || 0);
  const okModels = snap.models.filter((m) => m.lastResult === "ok").length;
  const errModels = snap.models.filter((m) => m.lastResult === "error").length;
  const knownModels = snap.models.filter((m) => m.lastResult !== null).length;

  const sentAt = snap.activity?.sent;
  const deliveredAt = snap.activity?.delivered;
  const inboundAt = snap.activity?.inbound;
  const sendSub = deliveredAt
    ? `ยืนยันส่งถึง ${formatBkkTime(deliveredAt)}`
    : inboundAt
      ? `รับข้อความล่าสุด ${formatBkkTime(inboundAt)}`
      : "ยังไม่ยืนยันส่งถึงผู้รับ";

  const cards = [
    {
      label: "เครื่องบอท",
      val: stale ? "ยังไม่ยืนยัน" : "ติดต่อได้",
      sub: stale ? `เก่า ${formatBkkTime(status.receivedAt)}` : `รับ ${formatBkkTime(status.receivedAt)}`,
      tone: stale ? "is-unknown" : "is-ok",
      icon: "comment",
    },
    {
      label: "WhatsApp",
      val: stale ? "ยังไม่ยืนยัน" : conn.label,
      sub: snap.connection?.since
        ? stale
          ? `เก่า ${formatBkkTime(snap.generatedAt)}`
          : `ตั้งแต่ ${formatBkkTime(snap.connection.since)}`
        : "สถานะล่าสุด",
      tone: stale ? "is-unknown" : conn.warn ? "is-warn" : conn.ok ? "is-ok" : "is-unknown",
      icon: "list",
    },
    {
      label: "ส่งคำตอบล่าสุด",
      val: sentAt ? formatBkkTime(sentAt) : "ยังไม่มีหลักฐาน",
      sub: stale ? "หลักฐานเก่า" : sendSub,
      tone: stale || !sentAt ? "is-unknown" : "is-ok",
      icon: "check",
    },
    {
      label: "งานในคิวรอ",
      val: `${qSum.waitingTotal} รอ`,
      sub: stale
        ? "ตัวเลขเก่า"
        : qSum.inFlightTotal === 0
          ? "ว่างพร้อมรับงาน"
          : `หลัก ${qMain.waiting} · ภาพ ${qOtherWait} · ทำอยู่ ${qSum.runningTotal}`,
      tone: stale ? "is-unknown" : qSum.waitingTotal > 0 && conn.warn ? "is-warn" : "is-ok",
      icon: "picture",
    },
    {
      label: "สถานะ AI ล่าสุด",
      val: stale
        ? "ข้อมูลเก่า"
        : knownModels === 0
          ? "รอผลเรียกแรก"
          : errModels > 0
            ? `${okModels}/${knownModels} · ${errModels} พลาด`
            : `${okModels}/${knownModels} พร้อม`,
      sub: stale
        ? `${okModels}/${knownModels} ครั้งก่อนสำเร็จ`
        : errModels > 0
          ? "พบงานที่ไม่สำเร็จล่าสุด"
          : knownModels < 5
            ? `ยังไม่เคยเรียก ${5 - knownModels} งาน`
            : "ล่าสุดสำเร็จทุกงาน",
      tone: stale || knownModels === 0 ? "is-unknown" : errModels > 0 ? "is-warn" : "is-ok",
      icon: "wand",
    },
  ];

  grid.replaceChildren(...cards.map(buildKpiCard));
}

function buildKpiCard(c) {
  return el(
    "div",
    { class: "kpi-card" },
    el("div", { class: `kpi-icon ${c.tone}`, "aria-hidden": "true" }, el("i", { class: `fi fi-${c.icon}` })),
    el(
      "div",
      { class: "kpi-text" },
      el("span", { class: "kpi-label", text: c.label }),
      el("strong", { class: "kpi-value", text: c.val }),
      el("span", { class: "kpi-sub", text: c.sub }),
    ),
  );
}

function renderRhythmFilters(status) {
  const container = $("rhythm-cap-filters");
  const caps = aggregateCapabilities(status);
  const filters = [["all", "ทั้งหมด"], ...caps.map((c) => [c.key, c.short])];

  container.replaceChildren(
    ...filters.map(([capKey, label]) =>
      el("button", {
        type: "button",
        class: "pill-filter",
        "data-rhythm-cap": capKey,
        "aria-pressed": String(rhythmCapFilter === capKey),
        text: label,
        onclick: () => {
          rhythmCapFilter = capKey;
          selectedPointIndex = null;
          if (capKey !== "all" && CAPABILITY_BY_KEY[capKey]) {
            selectedCapability = CAPABILITY_BY_KEY[capKey].idx;
          }
          renderRhythmCard(lastStatus);
          syncCapabilitySelection(lastStatus);
        },
      }),
    ),
  );
}

function renderConnStrip(status) {
  const strip = $("conn-strip");
  const connEvents = [...historyEvents]
    .filter((e) => e.type === "connection")
    .sort((a, b) => a.at - b.at)
    .slice(-5);

  const pills = [];
  const stale = Boolean(status?.stale || apiFailed);

  if (!status?.snapshot && !connEvents.length) {
    pills.push(el("span", { class: "conn-pill is-stale", text: "ยังรอสัญญาณแรก" }));
  } else {
    if (status?.snapshot?.connection) {
      const c = describeConnectionState(status.snapshot.connection.state);
      const cls = stale ? "is-stale" : c.warn ? "is-warn" : c.ok ? "is-ok" : "";
      pills.push(el("span", { class: `conn-pill ${cls}`, text: `${stale ? "เก่า: " : "สถานะล่าสุด: "}${c.label}` }));
    }
    for (const ev of connEvents) {
      if (ev.state !== undefined) {
        const c = describeConnectionState(ev.state);
        const cls = stale ? "is-stale" : c.warn ? "is-warn" : c.ok ? "is-ok" : "";
        pills.push(el("span", { class: `conn-pill ${cls}`, text: `${formatBkkHm(ev.at)} · ${c.label}` }));
      } else {
        pills.push(el("span", { class: "conn-pill", text: `${formatBkkHm(ev.at)} · เปลี่ยนสถานะเชื่อมต่อ` }));
      }
    }
  }

  strip.replaceChildren(
    el("span", { class: "conn-strip-label", text: "เหตุการณ์เชื่อมต่อ WhatsApp (แยกจากแกนเวลา AI):" }),
    ...pills,
  );
}

function assignTimelineX(items, padL, plotW) {
  if (!items.length) return [];
  if (items.length === 1) return [padL + plotW / 2];
  const minAt = items[0].at;
  const maxAt = items[items.length - 1].at;
  const span = Math.max(60_000, maxAt - minAt);
  const xs = items.map((item) => padL + ((item.at - minAt) / span) * plotW);
  const minGap = Math.min(24, plotW / Math.max(2, items.length));
  for (let i = 1; i < xs.length; i++) {
    if (xs[i] - xs[i - 1] < minGap) xs[i] = xs[i - 1] + minGap;
  }
  const overflow = xs[xs.length - 1] - (padL + plotW);
  if (overflow > 0) {
    const scale = plotW / (xs[xs.length - 1] - xs[0] || 1);
    return xs.map((x) => padL + (x - xs[0]) * scale);
  }
  return xs;
}

function renderRhythmCard(status) {
  renderRhythmFilters(status);
  renderConnStrip(status);

  const summary = $("rhythm-summary");
  const stage = $("rhythm-chart");
  const foot = $("rhythm-foot");
  const sub = $("rhythm-sub");

  if (!status?.snapshot && !historyEvents.length) {
    sub.textContent = "รอข้อมูลแรกจากเครื่องบอท";
    summary.replaceChildren(
      el("div", { class: "big-num", text: "—" }),
      el("div", { class: "sub-row" }, el("span", { text: "ยังไม่มีบันทึกเรียก AI" })),
      el("div", { class: "track-badge is-unknown" }, el("span", { class: "track-dot", text: "?" }), "รอข้อมูลแรก"),
    );
    stage.replaceChildren(emptyChartBox("ยังไม่มีบันทึกเหตุการณ์ AI", "เมื่อบอทส่ง snapshot และ events เข้ามา กราฟแยกตามงานจริงจะปรากฏที่นี่"));
    foot.replaceChildren(el("span", { text: "รอสัญญาณแรกจากบอท" }));
    return;
  }

  const hasTimedCalls = Array.isArray(status?.calls) && status.calls.some((c) => typeof c.durationMs === "number");
  if (hasTimedCalls) {
    renderAdminLatencyChart(status);
  } else {
    renderEventTimeline(status, Array.isArray(status?.calls));
  }
}

function renderAdminLatencyChart(status) {
  const summary = $("rhythm-summary");
  const stage = $("rhythm-chart");
  const foot = $("rhythm-foot");
  const sub = $("rhythm-sub");
  const stale = Boolean(status?.stale || apiFailed);

  const allCalls = [...status.calls]
    .filter((c) => typeof c.durationMs === "number")
    .sort((a, b) => a.at - b.at);
  const singleCap = rhythmCapFilter !== "all";
  const calls = singleCap ? allCalls.filter((c) => c.capability === rhythmCapFilter) : allCalls;

  sub.textContent = singleCap
    ? `งาน "${CAPABILITY_BY_KEY[rhythmCapFilter].name}" (${calls.length} ครั้ง) · เชื่อมเส้นเฉพาะจุดที่ห่าง ≤ 30 นาที`
    : `แสดงทุกครั้งที่เรียก AI จริงใน ${allCalls.length} ครั้งล่าสุด · ไม่เฉลี่ยรวมต่างประเภท และแยกเหตุการณ์เชื่อมต่อออก`;

  if (!calls.length) {
    const capName = singleCap ? CAPABILITY_BY_KEY[rhythmCapFilter].name : "AI";
    summary.replaceChildren(
      el("div", { class: "big-num", text: "0 ครั้ง" }),
      el("div", { class: "sub-row" }, el("span", { text: "ยังไม่ถูกเรียกในช่วงล่าสุด" })),
      el("div", { class: "track-badge is-unknown" }, el("span", { class: "track-dot", text: "—" }), "ไม่มีประวัติ"),
    );
    stage.replaceChildren(
      emptyChartBox(
        `ยังไม่มีการเรียก "${capName}"`,
        singleCap ? `ใน ${allCalls.length} ครั้งล่าสุดไม่มีงานประเภทนี้ (ไม่สร้างค่าแทน)` : "ยังไม่มีบันทึกการเรียก AI ที่มีเวลาตอบในระบบ",
      ),
    );
    foot.replaceChildren(
      el("span", { text: singleCap ? 'ลองกดตัวกรอง "ทั้งหมด" เพื่อดูทุกงานที่ถูกเรียกจริง' : "รอผลเรียกใช้ AI รอบถัดไป" }),
    );
    return;
  }

  const errCount = calls.filter((c) => c.type === "ai_error").length;
  const okCount = calls.length - errCount;
  const badgeTone = stale ? "is-unknown" : errCount > 0 ? "is-warn" : "";
  const badgeWord = stale ? "ข้อมูลเก่า" : errCount > 0 ? "มีจุดต้องตรวจ" : "ทำงานปกติ";

  if (singleCap) {
    const avgMs = calls.reduce((sum, c) => sum + c.durationMs, 0) / calls.length;
    summary.replaceChildren(
      el("div", { class: "big-num", text: formatSec(avgMs) }),
      el(
        "div",
        { class: "sub-row" },
        el("span", { text: `เฉลี่ยเฉพาะ ${CAPABILITY_BY_KEY[rhythmCapFilter].short}` }),
        el("span", { class: errCount ? "delta-warn" : "delta-ok", text: `${calls.length} ครั้ง` }),
      ),
      el(
        "div",
        { class: `track-badge ${badgeTone}` },
        el("span", { class: "track-dot", "aria-hidden": "true", text: errCount ? "!" : stale ? "?" : "✓" }),
        badgeWord,
      ),
    );
  } else {
    summary.replaceChildren(
      el("div", { class: "big-num", text: `${calls.length} ครั้ง` }),
      el(
        "div",
        { class: "sub-row" },
        el("span", { text: `${okCount} สำเร็จ` }),
        el("span", { class: errCount ? "delta-warn" : "delta-ok", text: errCount ? `· ${errCount} ผิดพลาด` : "· พลาด 0" }),
      ),
      el(
        "div",
        { class: `track-badge ${badgeTone}` },
        el("span", { class: "track-dot", "aria-hidden": "true", text: errCount ? "!" : stale ? "?" : "✓" }),
        badgeWord,
      ),
    );
  }

  const W = 460;
  const H = 208;
  const padL = 48;
  const padR = 18;
  const padT = 36;
  const padB = 28;
  const plotW = W - padL - padR;
  const plotH = H - padT - padB;
  const yBase = padT + plotH;

  const maxSec = Math.max(4, Math.ceil((Math.max(...calls.map((c) => c.durationMs)) * 1.18) / 1000));
  const midSec = Math.round(maxSec / 2);
  const maxMs = maxSec * 1000;

  const xs = assignTimelineX(calls, padL, plotW);
  const coords = calls.map((c, idx) => {
    const y = yBase - Math.min(1, c.durationMs / maxMs) * plotH;
    const item = CAPABILITY_BY_KEY[c.capability];
    return { ...c, idx, x: xs[idx], y, capIndex: item ? item.idx : null, capShort: item ? item.short : c.capability };
  });

  if (selectedPointIndex === null || !coords[selectedPointIndex]) {
    const pick = coords.findLast((c) => c.type === "ai_error") || coords[coords.length - 1];
    selectedPointIndex = pick ? pick.idx : 0;
  }

  const svg = svgEl("svg", {
    class: "rhythm-svg",
    viewBox: `0 0 ${W} ${H}`,
    role: "img",
    "aria-label": "กราฟเวลาตอบ AI ตามจริงแยกตามงาน",
  });

  const defs = svgEl("defs");
  const pattern = svgEl("pattern", {
    id: "hz-gap-hatch",
    width: "8",
    height: "8",
    patternUnits: "userSpaceOnUse",
    patternTransform: "rotate(35)",
  });
  pattern.append(svgEl("line", { x1: "0", y1: "0", x2: "0", y2: "8", stroke: "var(--border-strong)", "stroke-width": "1.5", "stroke-opacity": "0.45" }));
  defs.append(pattern);
  svg.append(defs);

  for (const secVal of [0, midSec, maxSec]) {
    const y = yBase - (secVal / maxSec) * plotH;
    svg.append(svgEl("line", { class: "chart-grid-line", x1: padL, y1: y.toFixed(1), x2: W - padR, y2: y.toFixed(1) }));
    svg.append(svgEl("text", { class: "chart-axis-text", x: padL - 8, y: (y + 4).toFixed(1), "text-anchor": "end" }, `${secVal} วิ`));
  }

  const gapBandLimitMs = 30 * 60_000;
  const lineSegments = [];
  let curSeg = singleCap ? [coords[0]] : [];
  for (let i = 0; i < coords.length - 1; i++) {
    const a = coords[i];
    const b = coords[i + 1];
    const hasGap = b.at - a.at > gapBandLimitMs;
    if (hasGap) {
      svg.append(svgEl("rect", { class: "chart-gap-band", x: a.x.toFixed(1), y: padT, width: Math.max(12, b.x - a.x).toFixed(1), height: plotH, rx: "6" }));
      if (singleCap) {
        if (curSeg.length > 1) lineSegments.push(curSeg);
        curSeg = [b];
      }
    } else if (singleCap) {
      curSeg.push(b);
    }
  }
  if (singleCap && curSeg.length > 1) lineSegments.push(curSeg);

  for (const pt of coords) {
    const cls = ["chart-stem-bar", pt.type === "ai_error" ? "is-error" : stale ? "is-stale" : ""].filter(Boolean).join(" ");
    svg.append(svgEl("line", { class: cls, x1: pt.x.toFixed(1), y1: yBase.toFixed(1), x2: pt.x.toFixed(1), y2: pt.y.toFixed(1) }));
  }

  const linePaths = [];
  if (singleCap) {
    for (const seg of lineSegments) {
      const d = seg.map((p, i) => `${i === 0 ? "M" : "L"} ${p.x.toFixed(1)} ${p.y.toFixed(1)}`).join(" ");
      const path = svgEl("path", { class: "chart-line", d });
      svg.append(path);
      linePaths.push(path);
    }
  }

  let lastTickX = -999;
  coords.forEach((pt, idx) => {
    const pressed = selectedPointIndex === idx;
    const isErr = pt.type === "ai_error";
    const cls = ["chart-point-dot", isErr ? "is-error" : stale ? "is-stale" : ""].filter(Boolean).join(" ");
    const aria = `${formatBkkTime(pt.at)} · ${pt.capShort} · ${formatSec(pt.durationMs)} · ${isErr ? "ไม่สำเร็จ" : "สำเร็จ"}`;

    const g = svgEl("g", {
      class: "chart-point-btn",
      role: "button",
      tabindex: "0",
      "data-point": idx,
      "aria-pressed": String(pressed),
      "aria-label": aria,
    });
    const dot = svgEl("circle", { class: cls, cx: pt.x.toFixed(1), cy: pt.y.toFixed(1), r: "5" });
    dot.style.animationDelay = `${idx * 35}ms`;
    g.append(
      svgEl("circle", { class: "chart-point-hit", cx: pt.x.toFixed(1), cy: pt.y.toFixed(1), r: "14" }),
      svgEl("circle", { class: "chart-point-ring", cx: pt.x.toFixed(1), cy: pt.y.toFixed(1), r: "9.5" }),
      dot,
    );
    svg.append(g);

    if (pt.x - lastTickX >= 44 || (idx === coords.length - 1 && pt.x - lastTickX >= 36)) {
      svg.append(svgEl("text", { class: "chart-axis-text", x: pt.x.toFixed(1), y: (H - 6).toFixed(1), "text-anchor": "middle" }, formatBkkHm(pt.at)));
      lastTickX = pt.x;
    }
  });

  const active = coords[selectedPointIndex];
  if (active) {
    const pillText = `${formatSec(active.durationMs)} · ${active.capShort}`;
    const pillW = Math.max(84, pillText.length * 6.5 + 16);
    const pillX = Math.max(padL, Math.min(W - padR - pillW, active.x - pillW / 2));
    const pillY = 3;
    const isErr = active.type === "ai_error";
    const guideY1 = pillY + 21;
    const guideY2 = Math.max(guideY1 + 2, active.y - 7);
    const pillGroup = svgEl("g", { id: "rhythm-float-pill" });
    pillGroup.append(
      svgEl("line", {
        class: `guide-pill${isErr ? " is-error" : ""}`,
        x1: active.x.toFixed(1),
        y1: guideY1,
        x2: active.x.toFixed(1),
        y2: guideY2.toFixed(1),
      }),
      svgEl("rect", { class: `hover-pill-bg${isErr ? " is-error" : ""}`, x: pillX.toFixed(1), y: pillY, width: pillW, height: "21", rx: "10.5" }),
      svgEl("text", { class: "hover-pill-text", x: (pillX + pillW / 2).toFixed(1), y: (pillY + 14).toFixed(1), "text-anchor": "middle" }, pillText),
    );
    svg.append(pillGroup);
  }

  stage.replaceChildren(svg);

  for (const p of linePaths) {
    if (typeof p.getTotalLength === "function") {
      const len = Math.ceil(p.getTotalLength());
      p.style.setProperty("--path-len", String(len));
      p.style.strokeDasharray = String(len);
      p.style.strokeDashoffset = String(len);
    }
  }

  if (active) {
    const activeItem = CAPABILITY_BY_KEY[active.capability];
    const statusStr = active.type === "ai_error" ? `ไม่สำเร็จ (${active.error || "error"})` : "สำเร็จ";
    const summarySpan = el(
      "span",
      {},
      el("strong", { text: `${formatBkkTime(active.at)} · ${activeItem ? activeItem.name : active.capability}` }),
      ` · ${formatSec(active.durationMs)} · ${statusStr}`,
    );
    const jump = activeItem
      ? el("button", {
          type: "button",
          class: "chip-btn",
          id: "rhythm-sync-btn",
          text: `ดูงาน "${activeItem.name}" ↓`,
          onclick: () => {
            selectedCapability = activeItem.idx;
            syncCapabilitySelection(lastStatus);
            $("detail-card").scrollIntoView({ behavior: "smooth", block: "nearest" });
          },
        })
      : null;
    foot.replaceChildren(summarySpan, jump);
  }

  bindChartPointEvents(stage, coords);
}

function renderEventTimeline(status, adminUntimed = false) {
  const summary = $("rhythm-summary");
  const stage = $("rhythm-chart");
  const foot = $("rhythm-foot");
  const sub = $("rhythm-sub");
  const stale = Boolean(status?.stale || apiFailed);

  const singleCap = rhythmCapFilter !== "all";
  const allEvents = [...historyEvents].sort((a, b) => a.at - b.at);
  const events = singleCap ? allEvents.filter((e) => e.capability === rhythmCapFilter) : allEvents;

  sub.textContent = adminUntimed
    ? "ไทม์ไลน์เหตุการณ์จริงจากระบบ (ข้อมูลช่วงนี้ไม่มีตัวเลขเวลาตอบเป็นวินาที)"
    : "ไทม์ไลน์เหตุการณ์จริงจากระบบ · รายละเอียดเวลาตอบ (วินาที) และข้อความ error ดูได้เฉพาะผู้ดูแล";

  if (!events.length) {
    const capName = singleCap ? CAPABILITY_BY_KEY[rhythmCapFilter].name : "AI";
    summary.replaceChildren(
      el("div", { class: "big-num", text: "0 เหตุการณ์" }),
      el("div", { class: "sub-row" }, el("span", { text: "ไม่พบบันทึกสำหรับงานนี้" })),
      el("div", { class: "track-badge is-unknown" }, el("span", { class: "track-dot", text: "—" }), "ไม่มีประวัติ"),
    );
    stage.replaceChildren(
      emptyChartBox(
        `ยังไม่มีเหตุการณ์ "${capName}"`,
        singleCap ? "ไม่มีบันทึกเหตุการณ์สำหรับความสามารถนี้" : "รอเหตุการณ์จริงจากบอท",
      ),
    );
    foot.replaceChildren(
      el("span", { text: singleCap ? 'ลองเลือกตัวกรอง "ทั้งหมด" เพื่อดูทุกเหตุการณ์' : "รอสัญญาณเหตุการณ์ใหม่จากบอท" }),
    );
    return;
  }

  const parsed = events.map((e) => ({ ev: e, info: translateEvent(e, adminUntimed) }));
  const errCount = parsed.filter((x) => !x.info.ok).length;
  const okCount = parsed.length - errCount;
  const badgeTone = stale ? "is-unknown" : errCount > 0 || status?.incidents?.length ? "is-warn" : "";
  const badgeWord = stale ? "ข้อมูลเก่า" : errCount > 0 || status?.incidents?.length ? "มีจุดต้องตรวจ" : "ทำงานปกติ";

  summary.replaceChildren(
    el("div", { class: "big-num", text: `${parsed.length} เหตุการณ์` }),
    el(
      "div",
      { class: "sub-row" },
      el("span", { text: `ปกติ ${okCount}` }),
      el("span", { class: errCount ? "delta-warn" : "delta-ok", text: errCount ? `· ผิดพลาด ${errCount}` : "· พลาด 0" }),
    ),
    el(
      "div",
      { class: `track-badge ${badgeTone}` },
      el("span", { class: "track-dot", "aria-hidden": "true", text: errCount ? "!" : stale ? "?" : "✓" }),
      badgeWord,
    ),
  );

  const W = 460;
  const H = 190;
  const padL = 94;
  const padR = 18;
  const plotW = W - padL - padR;
  const yOk = 68;
  const yErr = 122;

  const xs = assignTimelineX(events, padL, plotW);
  const coords = parsed.map(({ ev, info }, idx) => {
    const item = ev.capability ? CAPABILITY_BY_KEY[ev.capability] : null;
    const isErr = !info.ok;
    const isConn = ev.type === "connection";
    const y = isErr || isConn ? yErr : yOk;
    return {
      ...ev,
      info,
      idx,
      x: xs[idx],
      y,
      isErr,
      isConn,
      capIndex: item ? item.idx : null,
      capShort: item ? item.short : "เชื่อมต่อ",
      capName: item ? item.name : info.cap,
    };
  });

  if (selectedPointIndex === null || !coords[selectedPointIndex]) {
    const pick = coords.findLast((c) => c.isErr || c.isConn) || coords[coords.length - 1];
    selectedPointIndex = pick ? pick.idx : 0;
  }

  const svg = svgEl("svg", {
    class: "rhythm-svg",
    viewBox: `0 0 ${W} ${H}`,
    role: "img",
    "aria-label": "ไทม์ไลน์เหตุการณ์จริงสำหรับสิทธิ์ทีมงาน",
  });
  svg.append(
    svgEl("line", { class: "chart-lane-line", x1: padL, y1: yOk, x2: W - padR, y2: yOk }),
    svgEl("line", { class: "chart-lane-line", x1: padL, y1: yErr, x2: W - padR, y2: yErr }),
    svgEl("text", { class: "chart-lane-label", x: padL - 12, y: yOk + 4, "text-anchor": "end" }, "ปกติ / ส่งงาน"),
    svgEl("text", { class: "chart-lane-label", x: padL - 12, y: yErr + 4, "text-anchor": "end" }, "พลาด / เชื่อมต่อ"),
  );

  let lastTickX = -999;
  coords.forEach((pt, idx) => {
    const pressed = selectedPointIndex === idx;
    const cls = ["chart-point-dot", pt.isErr ? "is-error" : pt.isConn || stale ? "is-stale" : ""].filter(Boolean).join(" ");
    const aria = `${formatBkkTime(pt.at)} · ${pt.capName} · ${pt.info.label}`;
    svg.append(svgEl("line", { class: "chart-stem", x1: pt.x.toFixed(1), y1: yOk, x2: pt.x.toFixed(1), y2: yErr }));

    const g = svgEl("g", {
      class: "chart-point-btn",
      role: "button",
      tabindex: "0",
      "data-point": idx,
      "aria-pressed": String(pressed),
      "aria-label": aria,
    });
    const dot = svgEl("circle", { class: cls, cx: pt.x.toFixed(1), cy: pt.y.toFixed(1), r: "5.5" });
    dot.style.animationDelay = `${idx * 35}ms`;
    g.append(
      svgEl("circle", { class: "chart-point-hit", cx: pt.x.toFixed(1), cy: pt.y.toFixed(1), r: "14" }),
      svgEl("circle", { class: "chart-point-ring", cx: pt.x.toFixed(1), cy: pt.y.toFixed(1), r: "9.5" }),
      dot,
    );
    svg.append(g);

    if (pt.x - lastTickX >= 44) {
      svg.append(svgEl("text", { class: "chart-axis-text", x: pt.x.toFixed(1), y: (H - 8).toFixed(1), "text-anchor": "middle" }, formatBkkHm(pt.at)));
      lastTickX = pt.x;
    }
  });

  const active = coords[selectedPointIndex];
  if (active) {
    const statusWord = active.isErr ? "ไม่สำเร็จ" : active.isConn ? "เชื่อมต่อ" : "สำเร็จ";
    const pillText = `${active.capShort} · ${statusWord}`;
    const pillW = Math.max(90, pillText.length * 6.5 + 16);
    const pillX = Math.max(padL, Math.min(W - padR - pillW, active.x - pillW / 2));
    const pillY = 4;
    const guideY1 = pillY + 21;
    const guideY2 = Math.max(guideY1 + 2, active.y - 7);
    const pillGroup = svgEl("g", { id: "rhythm-float-pill" });
    pillGroup.append(
      svgEl("line", {
        class: `guide-pill${active.isErr ? " is-error" : ""}`,
        x1: active.x.toFixed(1),
        y1: guideY1,
        x2: active.x.toFixed(1),
        y2: guideY2.toFixed(1),
      }),
      svgEl("rect", { class: `hover-pill-bg${active.isErr ? " is-error" : ""}`, x: pillX.toFixed(1), y: pillY, width: pillW, height: "21", rx: "10.5" }),
      svgEl("text", { class: "hover-pill-text", x: (pillX + pillW / 2).toFixed(1), y: (pillY + 14).toFixed(1), "text-anchor": "middle" }, pillText),
    );
    svg.append(pillGroup);
  }

  stage.replaceChildren(svg);

  if (active) {
    const statusWord = active.isErr ? "ไม่สำเร็จ" : active.isConn ? active.info.label : "สำเร็จ";
    const footSuffix = adminUntimed ? " (ยังไม่มีข้อมูลเวลาตอบ)" : " (สิทธิ์ทีมงานไม่แสดงเวลาเป็นวินาที)";
    const summarySpan = el(
      "span",
      {},
      el("strong", { text: `${formatBkkTime(active.at)} · ${active.capName}` }),
      ` · ${statusWord}${footSuffix}`,
    );
    const jump = active.capIndex !== null
      ? el("button", {
          type: "button",
          class: "chip-btn",
          id: "rhythm-sync-btn",
          text: `ดูงาน "${active.capName}" ↓`,
          onclick: () => {
            selectedCapability = active.capIndex;
            syncCapabilitySelection(lastStatus);
            $("detail-card").scrollIntoView({ behavior: "smooth", block: "nearest" });
          },
        })
      : null;
    foot.replaceChildren(summarySpan, jump);
  }

  bindChartPointEvents(stage, coords);
}

function bindChartPointEvents(stage, coords) {
  for (const btn of stage.querySelectorAll(".chart-point-btn")) {
    const activate = () => {
      selectedPointIndex = Number(btn.dataset.point);
      const pt = coords[selectedPointIndex];
      if (pt && typeof pt.capIndex === "number") selectedCapability = pt.capIndex;
      renderRhythmCard(lastStatus);
      syncCapabilitySelection(lastStatus);
      const refocused = stage.querySelector(`[data-point="${selectedPointIndex}"]`);
      if (refocused) refocused.focus();
    };
    btn.addEventListener("click", activate);
    btn.addEventListener("keydown", (ev) => {
      if (ev.key === "Enter" || ev.key === " ") {
        ev.preventDefault();
        activate();
      }
    });
  }
}

function renderCapsuleBars(status) {
  const container = $("capsule-chart");
  const title = $("capsule-title");
  const sub = $("capsule-sub");
  const admin = Array.isArray(status?.calls);
  const stale = Boolean(status?.stale || apiFailed);
  const caps = aggregateCapabilities(status);

  if (!status?.snapshot && !admin) {
    title.textContent = "ความเร็วและสถานะ 5 งาน AI";
    sub.textContent = "รอข้อมูลแรกจากบอท";
    container.replaceChildren(emptyChartBox("ยังไม่มีข้อมูลความเร็ว", "รอผลเรียกใช้ AI แรกจากบอท", "empty-chart-box empty-chart-box-full"));
    return;
  }

  if (admin && status.calls.some((c) => typeof c.durationMs === "number")) {
    const timedCalls = status.calls.filter((c) => typeof c.durationMs === "number");
    title.textContent = `ความเร็วเฉลี่ย 5 งาน AI (${status.calls.length} ครั้งล่าสุด)`;
    sub.textContent = `เฉลี่ยจาก ${status.calls.length} ครั้งล่าสุดที่เรียกจริง (งานที่ไม่ถูกเรียกแสดง 0 ครั้ง)`;

    const maxAvg = Math.max(4000, ...caps.filter((c) => c.avgMs !== null).map((c) => c.avgMs));

    container.replaceChildren(
      ...caps.map((x, idx) => {
        if (x.count === 0 || x.avgMs === null) {
          const fill = el("span", { class: "capsule-fill is-empty" });
          fill.style.height = "0%";
          return el(
            "button",
            {
              type: "button",
              class: "capsule-col is-empty",
              "data-cap-capsule": idx,
              "aria-pressed": String(selectedCapability === idx),
              onclick: () => {
                selectedCapability = idx;
                syncCapabilitySelection(lastStatus);
              },
            },
            el("span", { class: "capsule-val", text: x.count > 0 ? `${x.count} ครั้ง` : "0 ครั้ง" }),
            el("span", { class: "capsule-track", "aria-hidden": "true" }, fill),
            el("span", { class: "capsule-name", text: x.short }),
            el("span", { class: "capsule-count", text: x.count > 0 ? `${x.count} ครั้ง` : "ยังไม่เรียก" }),
          );
        }

        const pct = Math.min(100, Math.max(18, Math.round((x.avgMs / maxAvg) * 100)));
        const fillCls = ["capsule-fill", x.hasErr ? "is-warn" : "", stale ? "is-stale" : ""].filter(Boolean).join(" ");
        const fill = el("span", { class: fillCls });
        fill.style.height = `${pct}%`;
        fill.style.animationDelay = `${idx * 55}ms`;

        return el(
          "button",
          {
            type: "button",
            class: "capsule-col",
            "data-cap-capsule": idx,
            "aria-pressed": String(selectedCapability === idx),
            title: `เฉลี่ย ${formatSec(x.avgMs)} · ${x.count} ครั้ง`,
            onclick: () => {
              selectedCapability = idx;
              syncCapabilitySelection(lastStatus);
            },
          },
          el("span", { class: "capsule-val", text: formatSec(x.avgMs) }),
          el("span", { class: "capsule-track", "aria-hidden": "true" }, fill),
          el("span", { class: "capsule-name", text: x.short }),
          el("span", { class: "capsule-count", text: `${x.count} ครั้ง` }),
        );
      }),
    );
    return;
  }

  title.textContent = "สถานะล่าสุด 5 งาน AI";
  sub.textContent = admin
    ? "อ้างอิงสถานะล่าสุดที่รายงาน (ยังไม่มีข้อมูลเวลาตอบเป็นวินาที)"
    : "อ้างอิงสถานะล่าสุดที่รายงาน (สิทธิ์ทีมงานไม่แสดงเวลาเป็นวินาที)";
  if (!status?.snapshot) {
    container.replaceChildren(emptyChartBox("ยังไม่มีข้อมูลงาน AI", "รอผลเรียกใช้ AI แรกจากบอท", "empty-chart-box empty-chart-box-full"));
    return;
  }

  container.replaceChildren(
    ...caps.map((x, idx) => {
      if (!x.lastAt) {
        const fill = el("span", { class: "capsule-fill is-empty" });
        fill.style.height = "0%";
        return el(
          "button",
          {
            type: "button",
            class: "capsule-col is-empty",
            "data-cap-capsule": idx,
            "aria-pressed": String(selectedCapability === idx),
            onclick: () => {
              selectedCapability = idx;
              syncCapabilitySelection(lastStatus);
            },
          },
          el("span", { class: "capsule-val", text: "—" }),
          el("span", { class: "capsule-track", "aria-hidden": "true" }, fill),
          el("span", { class: "capsule-name", text: x.short }),
          el("span", { class: "capsule-count", text: "ยังไม่เรียก" }),
        );
      }

      const isErr = x.lastResult === "error";
      const pct = isErr ? 78 : stale ? 56 : 88;
      const fillCls = ["capsule-fill", isErr ? "is-warn" : "", stale ? "is-stale" : ""].filter(Boolean).join(" ");
      const fill = el("span", { class: fillCls });
      fill.style.height = `${pct}%`;
      fill.style.animationDelay = `${idx * 55}ms`;
      const rel = formatShortAge((status.now || Date.now()) - x.lastAt);
      const valText = stale ? "เก่า" : isErr ? "พลาด" : "พร้อม";

      return el(
        "button",
        {
          type: "button",
          class: "capsule-col",
          "data-cap-capsule": idx,
          "aria-pressed": String(selectedCapability === idx),
          onclick: () => {
            selectedCapability = idx;
            syncCapabilitySelection(lastStatus);
          },
        },
        el("span", { class: "capsule-val", text: valText }),
        el("span", { class: "capsule-track", "aria-hidden": "true" }, fill),
        el("span", { class: "capsule-name", text: x.short }),
        el("span", { class: "capsule-count", text: rel }),
      );
    }),
  );
}

function renderComplexTable(status) {
  const tbody = $("complex-table-body");
  const snap = status?.snapshot || null;
  const admin = Array.isArray(status?.calls);
  const stale = Boolean(status?.stale || apiFailed);
  const q = searchQuery.trim().toLowerCase();

  const caps = aggregateCapabilities(status);
  const hasAnyDuration = admin && caps.some((c) => c.latestDurationMs !== null);
  $("table-col4-head").textContent = hasAnyDuration ? "เวลาตอบล่าสุด" : "เรียกใช้ล่าสุด";

  const visible = caps
    .map((cap, idx) => ({ cap, idx }))
    .filter(({ cap }) => {
      if (!q) return true;
      const modelStr = (cap.responseModel || cap.requestedModel || "").toLowerCase();
      const providerStr = (cap.provider || "").toLowerCase();
      return (
        cap.name.toLowerCase().includes(q) ||
        cap.groupName.toLowerCase().includes(q) ||
        modelStr.includes(q) ||
        providerStr.includes(q)
      );
    });

  $("table-count-chip").textContent = q ? `พบ ${visible.length}/5` : "5 ความสามารถ";

  if (!visible.length) {
    tbody.replaceChildren(el("tr", {}, el("td", { colspan: "4", text: `ไม่พบงานหรือโมเดลที่ตรงกับ "${searchQuery.trim()}"` })));
    return;
  }

  const refScaleMs = Math.max(6000, ...caps.filter((c) => c.latestDurationMs !== null).map((c) => c.latestDurationMs));

  tbody.replaceChildren(
    ...visible.map(({ cap, idx }) => {
      const isUnknown = !snap || cap.lastResult === null;
      const isErr = cap.lastResult === "error";
      const statusDot = isUnknown || stale ? "" : isErr ? "is-warn" : "is-ok";
      const statusGlyph = isUnknown || stale ? "?" : isErr ? "!" : "✓";
      const statusWord = !snap ? "รอข้อมูล" : isUnknown ? "ยังไม่เรียก" : stale ? "ข้อมูลเก่า" : isErr ? "ไม่สำเร็จ" : "สำเร็จ";

      let col4Node;
      if (admin && cap.latestDurationMs !== null) {
        const pct = Math.min(100, Math.max(14, Math.round((cap.latestDurationMs / refScaleMs) * 100)));
        const fillCls = ["prog-fill", cap.latestCallType === "ai_error" ? "is-warn" : "", stale ? "is-stale" : ""].filter(Boolean).join(" ");
        const fill = el("span", { class: fillCls });
        fill.style.width = `${pct}%`;
        fill.style.animationDelay = `${idx * 50}ms`;
        col4Node = el("div", { class: "prog-wrap" }, el("span", { class: "prog-track", "aria-hidden": "true" }, fill), el("span", { text: formatSec(cap.latestDurationMs) }));
      } else if (cap.lastAt) {
        const ageText = ` (${formatShortAge((status?.now || Date.now()) - cap.lastAt)})`;
        col4Node = el("span", {}, formatBkkTime(cap.lastAt), el("small", { class: "muted-note", text: ageText }));
      } else {
        col4Node = el("span", { class: "muted-note", text: "ยังไม่ถูกเรียก" });
      }

      const providerName = cap.provider === "anthropic" ? "Anthropic" : cap.provider === "openai" ? "OpenAI" : cap.provider || "—";
      const modelLabel = !snap ? "ยังไม่ทราบ" : `${providerName} · ${cap.responseModel || cap.requestedModel || "—"}`;

      return el(
        "tr",
        {
          class: "cap-row",
          "data-row-cap": idx,
          "aria-selected": String(selectedCapability === idx),
          onclick: () => {
            selectedCapability = idx;
            syncCapabilitySelection(lastStatus);
          },
        },
        el(
          "td",
          {},
          el(
            "button",
            { type: "button", class: "cap-row-btn", "data-btn-cap": idx },
            el("i", { class: `fi fi-${cap.icon} cap-icon-accent`, "aria-hidden": "true" }),
            el("span", { text: cap.name }),
          ),
        ),
        el(
          "td",
          {},
          el(
            "span",
            { class: "status-inline" },
            el("span", { class: `status-badge-dot ${statusDot}`, "aria-hidden": "true", text: statusGlyph }),
            statusWord,
          ),
        ),
        el("td", { text: modelLabel }),
        el("td", {}, col4Node),
      );
    }),
  );
}

function renderDailyTraffic(status) {
  const stat = $("traffic-stat");
  const bars = $("traffic-bars");
  const badge = $("traffic-badge");
  const stale = Boolean(status?.stale || apiFailed);

  if (!status?.snapshot && !historyEvents.length) {
    badge.textContent = "รอข้อมูล";
    stat.replaceChildren(el("strong", { text: "0" }), el("span", { text: "เหตุการณ์ (7 ชม.ล่าสุด)" }));
    bars.replaceChildren(emptyChartBox("รอเหตุการณ์แรก", null, "empty-chart-box empty-chart-box-compact"));
    return;
  }

  const buckets = bucketHourlyEvents(historyEvents, status?.now || Date.now(), 7);
  const totalInWindow = buckets.reduce((sum, b) => sum + b.ok + b.err, 0);
  const maxTotal = Math.max(1, ...buckets.map((b) => b.ok + b.err));
  const stackMaxPx = 124;

  badge.textContent = stale ? "ข้อมูลเก่า" : "7 ชม.ล่าสุด";
  stat.replaceChildren(el("strong", { text: String(totalInWindow) }), el("span", { text: "เหตุการณ์รวม (AI + เชื่อมต่อ)" }));

  bars.replaceChildren(
    ...buckets.map((b, idx) => {
      const total = b.ok + b.err;
      if (total === 0) {
        return el(
          "div",
          { class: "t-col", title: `${b.label}: 0 เหตุการณ์` },
          el("span", { class: "t-count" }),
          el("div", { class: "t-bar-stack" }, el("span", { class: "t-bar-empty" })),
          el("span", { class: "t-time", text: b.label }),
        );
      }

      const barTotalPx = Math.max(18, Math.round((total / maxTotal) * stackMaxPx));
      let errPx = b.err > 0 ? Math.max(8, Math.round((b.err / total) * barTotalPx)) : 0;
      let okPx = b.ok > 0 ? Math.max(8, barTotalPx - errPx) : 0;
      if (errPx + okPx > stackMaxPx) {
        if (errPx > okPx) errPx = stackMaxPx - okPx;
        else okPx = stackMaxPx - errPx;
      }

      const stack = el("div", { class: "t-bar-stack" });
      if (errPx > 0) {
        const errBar = el("span", { class: "t-bar-err" });
        errBar.style.height = `${errPx}px`;
        errBar.style.animationDelay = `${idx * 18}ms`;
        stack.append(errBar);
      }
      if (okPx > 0) {
        const okBar = el("span", { class: "t-bar-ok" });
        okBar.style.height = `${okPx}px`;
        okBar.style.animationDelay = `${idx * 18}ms`;
        stack.append(okBar);
      }

      return el(
        "div",
        { class: "t-col", title: `${b.label}: ปกติ ${b.ok} · มีปัญหา/หลุด ${b.err}` },
        el("span", { class: "t-count", text: String(total) }),
        stack,
        el("span", { class: "t-time", text: b.label }),
      );
    }),
  );
}

function renderPieCard(status) {
  const ring = $("pie-ring");
  const stats = $("pie-stats");
  const badge = $("pie-badge");
  const snap = status?.snapshot || null;
  const stale = Boolean(status?.stale || apiFailed);

  if (!snap) {
    badge.textContent = "รอข้อมูล";
    const svg = svgEl("svg", { class: "pie-svg", viewBox: "0 0 138 138", "aria-hidden": "true" });
    svg.append(svgEl("circle", { class: "pie-track", cx: "69", cy: "69", r: "50" }));
    ring.replaceChildren(svg, el("div", { class: "pie-middle" }, el("strong", { text: "—" }), el("span", { text: "รอข้อมูล" })));

    stats.replaceChildren(
      el("div", { class: "pie-stat" }, el("span", {}, el("i", { class: "dot-swatch swatch-wood" }), " รอทำ"), el("strong", { text: "—" })),
      el("div", { class: "pie-sep", "aria-hidden": "true" }),
      el("div", { class: "pie-stat" }, el("span", {}, el("i", { class: "dot-swatch swatch-accent" }), " กำลังทำ"), el("strong", { text: "—" })),
      el("div", { class: "pie-age" }, el("span", { text: "งานค้างนานสุด" }), el("strong", { text: "ยังไม่มีข้อมูล" })),
    );
    return;
  }

  const qSum = summarizeQueues(snap.queues, status.now);
  const qMain = qSum.byName.main || { waiting: 0, running: 0 };
  const qMedia = qSum.byName.media || { waiting: 0, running: 0 };
  const qRender = qSum.byName.render || { waiting: 0, running: 0 };
  const conn = describeConnectionState(snap.connection?.state);
  const waitTone = stale ? "var(--unknown)" : conn.warn ? "var(--warning)" : "var(--wood)";
  const waitSwatchCls = stale ? "" : conn.warn ? "swatch-warn" : "swatch-wood";
  const oldestText = qSum.oldestAt === null
    ? "ไม่มีงานค้าง"
    : `${formatAge(qSum.oldestAgeMs)} (${formatBkkTime(qSum.oldestAt)})`;

  badge.textContent = stale ? "ข้อมูลเก่า" : qSum.inFlightTotal === 0 ? "ว่าง" : `ในคิว ${qSum.inFlightTotal}`;

  const r = 50;
  const circ = 2 * Math.PI * r;
  const svg = svgEl("svg", { class: "pie-svg", viewBox: "0 0 138 138", role: "img", "aria-label": "สัดส่วนงานที่รอและกำลังทำในคิว" });
  svg.append(svgEl("circle", { class: "pie-track", cx: "69", cy: "69", r: String(r) }));

  if (qSum.inFlightTotal === 0) {
    const seg = svgEl("circle", { class: "pie-seg", cx: "69", cy: "69", r: String(r), stroke: "var(--ok)", "stroke-dasharray": circ.toFixed(1) });
    seg.style.setProperty("--ring-circ", circ.toFixed(1));
    seg.style.setProperty("--ring-offset", "0");
    svg.append(seg);
  } else {
    const waitLen = (qSum.waitingTotal / qSum.inFlightTotal) * circ;
    const runLen = (qSum.runningTotal / qSum.inFlightTotal) * circ;
    if (qSum.waitingTotal > 0) {
      const waitSeg = svgEl("circle", {
        class: "pie-seg",
        cx: "69",
        cy: "69",
        r: String(r),
        stroke: waitTone,
        "stroke-dasharray": `${waitLen.toFixed(1)} ${circ.toFixed(1)}`,
        "stroke-dashoffset": "0",
      });
      waitSeg.style.setProperty("--ring-circ", circ.toFixed(1));
      waitSeg.style.setProperty("--ring-offset", "0");
      svg.append(waitSeg);
    }
    if (qSum.runningTotal > 0) {
      const runSeg = svgEl("circle", {
        class: "pie-seg",
        cx: "69",
        cy: "69",
        r: String(r),
        stroke: "var(--accent)",
        "stroke-dasharray": `${runLen.toFixed(1)} ${circ.toFixed(1)}`,
        "stroke-dashoffset": (-waitLen).toFixed(1),
      });
      runSeg.style.setProperty("--ring-circ", circ.toFixed(1));
      runSeg.style.setProperty("--ring-offset", (-waitLen).toFixed(1));
      svg.append(runSeg);
    }
  }

  ring.replaceChildren(
    svg,
    el("div", { class: "pie-middle" }, el("strong", { text: String(qSum.inFlightTotal) }), el("span", { text: qSum.inFlightTotal === 0 ? "คิวว่าง" : "รอ + กำลังทำ" })),
  );

  stats.replaceChildren(
    el(
      "div",
      { class: "pie-stat" },
      el("span", {}, el("i", { class: `dot-swatch ${waitSwatchCls}` }), " รอทำ"),
      el("strong", { text: `${qSum.waitingTotal} งาน` }),
      el("small", { class: "pie-sub", text: `main ${qMain.waiting} · ภาพ ${qMedia.waiting + qRender.waiting}` }),
    ),
    el("div", { class: "pie-sep", "aria-hidden": "true" }),
    el(
      "div",
      { class: "pie-stat" },
      el("span", {}, el("i", { class: "dot-swatch swatch-accent" }), " กำลังทำ"),
      el("strong", { text: `${qSum.runningTotal} งาน` }),
      el("small", { class: "pie-sub", text: `main ${qMain.running} · ภาพ ${qMedia.running + qRender.running}` }),
    ),
    el("div", { class: "pie-age" }, el("span", { text: "งานค้างนานสุด" }), el("strong", { text: oldestText })),
  );
}

function renderDetailCard(status) {
  const card = $("detail-card");
  const snap = status?.snapshot || null;
  const stale = Boolean(status?.stale || apiFailed);
  const admin = isAdmin();
  const caps = aggregateCapabilities(status);
  const cap = caps[selectedCapability] || caps[0];
  const unknown = !snap || cap.lastResult === null;
  const isErr = cap.lastResult === "error";

  const resultText = !snap
    ? "ยังไม่มีข้อมูล"
    : unknown
      ? "ยังไม่เคยถูกเรียก"
      : stale
        ? "ครั้งก่อนสำเร็จ · ข้อมูลเก่า"
        : isErr
          ? "ครั้งล่าสุดไม่สำเร็จ"
          : "ครั้งล่าสุดสำเร็จ";
  const pillCls = unknown || stale ? "" : isErr ? "is-warn" : "is-ok";

  const qSum = summarizeQueues(snap?.queues, status?.now);
  const q = qSum?.byName?.[cap.queueKey];
  const queueText = !q
    ? "ยังไม่ทราบ"
    : stale
      ? `เก่า: ${q.waiting} รอ · ${q.running} ทำ`
      : `${q.waiting} รอ · ${q.running} กำลังทำ`;

  const respNote = !snap
    ? "ยังไม่มีผลตอบกลับจากบริการ AI"
    : !cap.lastAt
      ? "ยังไม่มีผลเรียกใช้สำหรับความสามารถนี้"
      : cap.responseModel
        ? `โมเดลจากผลตอบกลับ: ${cap.responseModel}`
        : "ยังไม่มีชื่อโมเดลยืนยันจากผลตอบกลับ";

  const adminHint = admin && cap.latestDurationMs !== null
    ? cap.latestCallType === "ai_error"
      ? ` · ผู้ดูแล: ${cap.latestError || "error"} (${formatSec(cap.latestDurationMs)})`
      : ` · ล่าสุด ${formatSec(cap.latestDurationMs)}`
    : "";

  const incMatch = status?.incidents?.find((i) => i.key === `ai:${cap.key}`) || status?.incidents?.[0];
  const adviceInfo = incMatch ? translateIncident(incMatch) : null;
  const adviceTitle = !snap
    ? "รอสถานะแรกจากเครื่องบอท"
    : stale
      ? "ไม่ได้รับสถานะใหม่ — ข้อมูลอาจเก่า"
      : adviceInfo
        ? adviceInfo.title
        : "ทำงานได้ตามปกติจากหลักฐานล่าสุด";
  const adviceNote = !snap
    ? "เมื่อบอทส่งข้อมูลเข้ามา รายละเอียดแต่ละงานจะปรากฏที่นี่"
    : adviceInfo
      ? adviceInfo.hint
      : "ไม่มีข้อความใหม่ไม่ได้แปลว่าบอทเสีย · โมเดลที่ขอใช้กับโมเดลตอบจริงอาจต่างกัน";

  const checkBtn = !snap || (!stale && !status?.incidents?.length && describeConnectionState(snap.connection?.state).ok)
    ? null
    : el("button", { type: "button", class: "button", id: "detail-advice-btn", text: "สิ่งที่ควรตรวจ →", onclick: openGuidanceDialog });

  card.replaceChildren(
    el(
      "div",
      { class: "card-head" },
      el("div", {}, el("h2", { text: cap.name }), el("p", { text: `ผลการใช้ AI ล่าสุด · ${cap.lastAt ? formatBkkDateTime(cap.lastAt) : "ยังไม่ทราบเวลา"}` })),
      el("span", { class: `status-pill ${pillCls}`, text: resultText }),
    ),
    el(
      "div",
      { class: "facts" },
      el("div", { class: "fact-box" }, el("span", { text: "ผู้ให้บริการ" }), el("strong", { text: !snap ? "ยังไม่ทราบ" : cap.provider === "anthropic" ? "Anthropic" : cap.provider === "openai" ? "OpenAI" : cap.provider || "—" })),
      el("div", { class: "fact-box" }, el("span", { text: "โมเดลที่ขอใช้" }), el("strong", { text: !snap ? "ยังไม่ทราบ" : cap.requestedModel || "—" })),
      el("div", { class: "fact-box" }, el("span", { text: `คิว ${cap.queueLabel}` }), el("strong", { text: queueText })),
      el("div", { class: "fact-box" }, el("span", { text: "หมายเหตุหลักฐาน" }), el("strong", { text: `${respNote}${adminHint}` })),
    ),
    el("div", { class: "guidance-callout" }, el("div", {}, el("strong", { text: adviceTitle }), el("p", { text: adviceNote })), checkBtn),
  );
}

function renderRecentCard() {
  const container = $("recent-events");
  const admin = isAdmin();
  if (!historyEvents.length) {
    container.replaceChildren(emptyChartBox("ยังไม่มีบันทึกเหตุการณ์", null, "empty-chart-box empty-chart-box-compact"));
    return;
  }

  container.replaceChildren(
    ...historyEvents.slice(0, 4).map((ev) => {
      const info = translateEvent(ev, admin);
      return el(
        "div",
        { class: "event-row" },
        el("span", { class: `status-badge-dot ${info.ok ? "is-ok" : "is-warn"}`, "aria-hidden": "true", text: info.ok ? "✓" : "!" }),
        el("div", {}, el("strong", { text: `${info.label} · ${info.cap}` }), el("span", { text: `${formatBkkDateTime(ev.at)} · ${info.detail}` })),
      );
    }),
  );
}

function renderTeamPreview() {
  const container = $("team-preview");
  const admin = isAdmin();
  if (!admin) {
    $("team-card-sub").textContent = "บัญชีที่คุณเข้าใช้งานอยู่ตอนนี้";
    const initial = user?.email ? user.email.charAt(0).toUpperCase() : "T";
    container.replaceChildren(
      el(
        "div",
        { class: "member-mini" },
        el("div", { class: "member-avatar", "aria-hidden": "true", text: initial }),
        el("div", {}, el("strong", { text: user?.email || "—" }), el("small", { text: "ทีมงาน (Team) · ดูภาพรวมและประวัติ" })),
      ),
      el("p", { class: "panel-note", text: "การดูรายชื่อทั้งหมดและจัดการสิทธิ์สงวนไว้สำหรับผู้ดูแลเท่านั้น" }),
    );
    return;
  }

  $("team-card-sub").textContent = "บัญชีที่มีสิทธิ์เข้าดู Warroom";
  if (!membersCache.length) {
    container.replaceChildren(emptyChartBox("กำลังโหลดรายชื่อทีม…", null, "empty-chart-box empty-chart-box-compact"));
    return;
  }

  container.replaceChildren(
    ...membersCache.slice(0, 3).map((m) =>
      el(
        "div",
        { class: "member-mini" },
        el("div", { class: "member-avatar", "aria-hidden": "true", text: m.email.charAt(0).toUpperCase() }),
        el("div", {}, el("strong", { text: m.email }), el("small", { text: m.role === "admin" ? "ผู้ดูแล (Admin)" : "ทีมงาน (Team)" })),
      ),
    ),
  );
}

function syncCapabilitySelection(status) {
  for (const b of document.querySelectorAll("[data-cap-capsule]")) {
    b.setAttribute("aria-pressed", String(Number(b.dataset.capCapsule) === selectedCapability));
  }
  for (const r of document.querySelectorAll("[data-row-cap]")) {
    r.setAttribute("aria-selected", String(Number(r.dataset.rowCap) === selectedCapability));
  }
  renderDetailCard(status);
}

function renderOverviewAll(status) {
  document.body.dataset.state = deriveBodyState(status);
  renderChrome(status);
  renderKpis(status);
  renderRhythmCard(status);
  renderCapsuleBars(status);
  renderComplexTable(status);
  renderDailyTraffic(status);
  renderPieCard(status);
  renderDetailCard(status);
  renderRecentCard();
  renderTeamPreview();
}

function renderHistoryView() {
  const filters = [["all", "ทั้งหมด"], ["ai", "งาน AI"], ["send", "การส่งข้อความ"], ["connection", "การเชื่อมต่อ"]];
  $("history-filters").replaceChildren(
    ...filters.map(([id, label]) =>
      el("button", {
        type: "button",
        class: "pill-filter",
        "data-filter": id,
        "aria-pressed": String(historyFilter === id),
        text: label,
        onclick: () => {
          historyFilter = id;
          renderHistoryView();
        },
      }),
    ),
  );

  const admin = isAdmin();
  const q = searchQuery.trim().toLowerCase();
  const rows = historyEvents
    .map((ev) => ({ raw: ev, ...translateEvent(ev, admin) }))
    .filter((row) => {
      if (historyFilter !== "all" && row.kind !== historyFilter) return false;
      if (!q) return true;
      return (
        row.label.toLowerCase().includes(q) ||
        row.cap.toLowerCase().includes(q) ||
        row.detail.toLowerCase().includes(q) ||
        row.adminHint.toLowerCase().includes(q)
      );
    });

  $("history-count-chip").textContent = `${rows.length} รายการ`;
  const tbody = $("history-rows");

  if (!rows.length) {
    tbody.replaceChildren(
      el("tr", {}, el("td", { colspan: "4", text: q ? `ไม่พบเหตุการณ์ที่ตรงกับ "${searchQuery.trim()}"` : "ยังไม่มีเหตุการณ์ในช่วงนี้" })),
    );
  } else {
    tbody.replaceChildren(
      ...rows.map((row) =>
        el(
          "tr",
          {},
          el("td", { text: formatBkkDateTime(row.raw.at) }),
          el("td", {}, el("span", { class: `status-pill ${row.ok ? "is-ok" : "is-warn"}`, text: row.label })),
          el("td", { text: row.cap }),
          el(
            "td",
            {},
            row.detail,
            admin && row.adminHint ? el("small", { class: "hint-block", text: row.adminHint }) : null,
          ),
        ),
      ),
    );
  }

  $("history-note").textContent = admin
    ? "ผู้ดูแลเห็นเวลาตอบ (วินาที), ชื่อโมเดล และแนวทางตรวจเมื่อมีปัญหา (ไม่รวมเนื้อหาแชท)"
    : "มุมมองทีมงานแสดงเฉพาะเวลา ประเภทเหตุการณ์ และความสามารถตามสิทธิ์";

  const loadMoreBtn = $("history-load-more");
  loadMoreBtn.hidden = !historyNextBefore;
}

async function loadHistory(more = false) {
  const query = more && historyNextBefore
    ? `?before=${encodeURIComponent(String(historyNextBefore))}&cursor=${encodeURIComponent(historyNextCursor || "")}`
    : "";
  const data = await api(`/api/history${query}`);
  historyEvents = more ? mergeHistoryPage(historyEvents, data.events || []) : (data.events || []);
  historyNextBefore = data.nextBefore || null;
  historyNextCursor = data.nextCursor || null;
  renderHistoryView();
}

async function pauseAlerts(minutes, buttonToDisable) {
  if (buttonToDisable) buttonToDisable.disabled = true;
  try {
    await api("/api/pause", {
      method: "POST",
      body: JSON.stringify({ minutes }),
    });
    showFeedback(minutes ? "พักอีเมลแจ้งเตือนเรียบร้อยแล้ว" : "กลับมาเปิดอีเมลแจ้งเตือนตามปกติแล้ว", true);
    await refresh();
  } catch (err) {
    showFeedback(errorText(err));
  } finally {
    if (buttonToDisable) buttonToDisable.disabled = false;
  }
}

async function loadSettings() {
  if (!isAdmin()) return;
  const [status, audit] = await Promise.all([api("/api/status"), api("/api/audit")]);
  lastStatus = status;
  renderChrome(status);

  const now = status.now || Date.now();
  const isPaused = Boolean(status.pause?.until && status.pause.until > now);
  const pauseMsg = isPaused
    ? `กำลังพักแจ้งเตือนถึง ${formatBkkDateTime(status.pause.until)} โดย ${status.pause.actor || "ผู้ดูแล"}`
    : "กำลังใช้เงื่อนไขแจ้งเตือนตามปกติ";

  const select = el(
    "select",
    { id: "pause-duration", "aria-label": "ระยะเวลาพักแจ้งเตือน" },
    el("option", { value: "30" }, "30 นาที"),
    el("option", { value: "60", selected: true }, "1 ชั่วโมง"),
    el("option", { value: "240" }, "4 ชั่วโมง"),
  );
  const applyBtn = el("button", { type: "button", class: "button button-primary", id: "pause-apply", text: "พักแจ้งเตือน" });
  const resumeBtn = el("button", { type: "button", class: "button", id: "pause-resume", text: "กลับมาแจ้งตอนนี้", disabled: !isPaused });
  applyBtn.addEventListener("click", () => pauseAlerts(Number(select.value), applyBtn));
  resumeBtn.addEventListener("click", () => pauseAlerts(0, resumeBtn));

  const pauseCard = el(
    "section",
    { class: "bento-card" },
    el("h2", { text: "พักอีเมลแจ้งเตือนชั่วคราว" }),
    el("p", { text: pauseMsg }),
    el("div", { class: "form-row" }, select, applyBtn, resumeBtn),
    el("p", { class: "panel-note", text: "ขณะพัก เว็บยังแสดงปัญหาจริง เมื่อหมดเวลา หากปัญหายังเข้าเงื่อนไขจะกลับมาแจ้งเอง" }),
  );

  const n = status.notification || {};
  const mailText = !n.configured
    ? "ยังตั้งค่าผู้ส่งหรือผู้รับอีเมลไม่ครบ"
    : n.enabled
      ? "เปิดส่งอีเมลแล้ว"
      : "ตั้งค่าแล้ว แต่ยังไม่เปิดส่งอีเมล";
  const mailPillCls = !n.configured ? "" : n.enabled ? "is-ok" : "is-warn";

  const mailCard = el(
    "section",
    { class: "bento-card" },
    el("h2", { text: "สถานะการส่งอีเมลแจ้งเตือน" }),
    el("p", {}, el("span", { class: `status-pill ${mailPillCls}`, text: mailText })),
    el("p", { class: "panel-note", text: `รอส่ง ${n.pending || 0} รายการ · ส่งไม่สำเร็จและรอลองใหม่ ${n.failed || 0} รายการ` }),
    el("p", { class: "panel-note", text: "ครบ 5 นาทีแจ้งครั้งแรก · เตือนซ้ำทุก 1 ชั่วโมง · เหตุที่ต้องให้คนช่วยแจ้งทันที" }),
  );

  const auditRows = (audit.events || []).map((a) => {
    const actionName = {
      pause: "พักแจ้งเตือน",
      resume: "กลับมาแจ้งเตือน",
      member_set: "ตั้งสิทธิ์สมาชิก",
      member_remove: "ถอดสมาชิก",
    }[a.action] || a.action;
    const suffix = a.detail?.minutes
      ? ` ${a.detail.minutes} นาที`
      : a.detail?.email
        ? ` · ${a.detail.email}`
        : "";
    return el("tr", {}, el("td", { text: formatBkkDateTime(a.at) }), el("td", { text: a.actor }), el("td", { text: `${actionName}${suffix}` }));
  });

  const auditCard = el(
    "section",
    { class: "bento-card" },
    el("h2", { text: "ประวัติผู้ดูแล (เก็บย้อนหลัง 30 วัน)" }),
    el(
      "div",
      { class: "table-wrap" },
      el(
        "table",
        {},
        el("thead", {}, el("tr", {}, el("th", { scope: "col", text: "เวลา (Bangkok)" }), el("th", { scope: "col", text: "ผู้ดำเนินการ" }), el("th", { scope: "col", text: "รายการ" }))),
        el("tbody", {}, ...(auditRows.length ? auditRows : [el("tr", {}, el("td", { colspan: "3", text: "ยังไม่มีรายการ" }))])),
      ),
    ),
  );

  $("settings-content").replaceChildren(el("div", { class: "admin-grid" }, pauseCard, mailCard), auditCard);
}

async function mutateMember(method, payload, btn) {
  if (btn) btn.disabled = true;
  try {
    await api("/api/members", {
      method,
      body: JSON.stringify(payload),
    });
    showFeedback(method === "DELETE" ? `ถอดสิทธิ์ ${payload.email} แล้ว` : `บันทึกสิทธิ์ ${payload.email} แล้ว`, true);
    await loadMembers();
  } catch (err) {
    showFeedback(errorText(err));
  } finally {
    if (btn) btn.disabled = false;
  }
}

async function loadMembers() {
  if (!isAdmin()) return;
  const { members } = await api("/api/members");
  membersCache = members || [];

  const emailInput = el("input", {
    type: "email",
    id: "new-member-email",
    required: true,
    placeholder: "name@gmail.com",
    autocomplete: "email",
    "aria-label": "อีเมลสมาชิกใหม่",
  });
  const roleSelect = el(
    "select",
    { id: "new-member-role", "aria-label": "สิทธิ์สมาชิกใหม่" },
    el("option", { value: "team" }, "ทีมงาน"),
    el("option", { value: "admin" }, "ผู้ดูแล"),
  );
  const addBtn = el("button", { type: "submit", class: "button button-primary", id: "add-member-btn", text: "เพิ่มสมาชิก" });

  const form = el(
    "form",
    { class: "bento-card settings-stack-gap" },
    el("h2", { text: "เพิ่มบัญชีเข้า Warroom" }),
    el("p", { class: "panel-note", text: "สมาชิกต้องใช้บัญชี Google ที่ตรงกับอีเมลนี้เข้าสู่ระบบ" }),
    el("div", { class: "form-row" }, emailInput, roleSelect, addBtn),
  );
  form.addEventListener("submit", async (ev) => {
    ev.preventDefault();
    const email = emailInput.value.trim().toLowerCase();
    if (!email || !email.includes("@")) {
      showFeedback("กรุณาใส่อีเมลให้ถูกต้อง");
      return;
    }
    await mutateMember("POST", { email, role: roleSelect.value }, addBtn);
  });

  const rows = membersCache.map((m) => {
    const select = el(
      "select",
      { class: "role-select-inline", "aria-label": `สิทธิ์ของ ${m.email}` },
      el("option", { value: "team" }, "ทีมงาน"),
      el("option", { value: "admin" }, "ผู้ดูแล"),
    );
    select.value = m.role;
    const saveBtn = el("button", { type: "button", class: "button btn-small", text: "บันทึก" });
    const removeBtn = el("button", { type: "button", class: "button btn-small btn-danger", text: "ถอดสิทธิ์" });
    saveBtn.addEventListener("click", () => mutateMember("POST", { email: m.email, role: select.value }, saveBtn));
    removeBtn.addEventListener("click", () => {
      if (window.confirm(`ถอดสิทธิ์ ${m.email} ใช่ไหม?`)) {
        mutateMember("DELETE", { email: m.email }, removeBtn);
      }
    });

    return el(
      "tr",
      {},
      el("td", {}, el("strong", { text: m.email }), m.email === user?.email ? el("small", { class: "hint-block", text: "บัญชีของคุณ" }) : null),
      el("td", {}, select),
      el("td", {}, el("div", { class: "member-actions-row" }, saveBtn, removeBtn)),
    );
  });

  const listCard = el(
    "section",
    { class: "bento-card" },
    el("h2", { text: `รายชื่อสมาชิก (${membersCache.length} บัญชี)` }),
    el(
      "div",
      { class: "table-wrap" },
      el(
        "table",
        {},
        el("thead", {}, el("tr", {}, el("th", { scope: "col", text: "บัญชี Google" }), el("th", { scope: "col", text: "สิทธิ์" }), el("th", { scope: "col", text: "จัดการ" }))),
        el("tbody", {}, ...rows),
      ),
    ),
  );

  $("members-content").replaceChildren(form, listCard);
  renderTeamPreview();
}

async function refresh(silent = false) {
  if (!user) return;
  if (activeView === "work") return work.refresh();
  if (busy) {
    refreshQueued = true;
    return;
  }
  const startedView = activeView;
  busy = true;
  $("refresh").disabled = true;
  if (!silent) clearFeedback();
  try {
    if (activeView === "overview") {
      const reqs = [api("/api/status"), api("/api/history")];
      if (isAdmin()) reqs.push(api("/api/members").catch(() => null));
      const [status, hist, membersRes] = await Promise.all(reqs);
      lastStatus = status;
      historyEvents = hist.events || [];
      historyNextBefore = hist.nextBefore || null;
      historyNextCursor = hist.nextCursor || null;
      if (membersRes?.members) membersCache = membersRes.members;
      apiFailed = false;
      if (user && activeView === startedView) renderOverviewAll(lastStatus);
    } else if (activeView === "history") {
      await loadHistory(false);
    } else if (activeView === "settings") {
      await loadSettings();
    } else if (activeView === "members") {
      await loadMembers();
    }
    $("fetch-time").textContent = `ตรวจหน้าเว็บ ${formatBkkDateTime(Date.now())}`;
  } catch (err) {
    if (!user || activeView !== startedView) return;
    apiFailed = true;
    showFeedback(errorText(err));
    if (lastStatus && activeView === "overview") {
      renderOverviewAll(lastStatus);
    }
  } finally {
    busy = false;
    $("refresh").disabled = false;
    if (refreshQueued) {
      refreshQueued = false;
      void refresh(true);
    }
  }
}

function switchView(viewName, keepUrl = false) {
  if ((viewName === "settings" || viewName === "members") && !isAdmin()) return;
  if (!keepUrl && viewName === "work" && location.pathname !== "/work") {
    history.pushState(null, "", "/work");
  } else if (!keepUrl && viewName !== "work" && location.pathname === "/work") {
    history.pushState(null, "", "/");
  }
  if (activeView === "work" && viewName !== "work") work.hide();
  activeView = viewName;
  clearFeedback();
  renderChrome(lastStatus);
  refresh(true);
}

function openGuidanceDialog() {
  const key = deriveBodyState(lastStatus);
  const incMatch = lastStatus?.incidents?.[0];
  $("dialog-description").textContent = incMatch
    ? translateIncident(incMatch).hint
    : "ตรวจสอบตามขั้นตอนด้านล่างแล้วดูผลเรียกใช้รอบถัดไป";
  const steps = key === "ai"
    ? ["ตรวจอินเทอร์เน็ตบนเครื่องบอท", "ให้ผู้ดูแลตรวจประวัติการเรียก AI และโควตา API", "รอดูผลเรียกครั้งต่อไป"]
    : ["ตรวจว่าเครื่องบอทเปิดอยู่ ไม่หลับ และมีอินเทอร์เน็ต", "ตรวจ WhatsApp และอุปกรณ์ที่ลิงก์", "หากยังมีปัญหา ให้ผู้ดูแลตรวจบันทึก 30 วัน"];
  $("steps").replaceChildren(...steps.map((text) => el("li", { text })));
  $("dialog-pause").hidden = !isAdmin();
  $("dialog").showModal();
}

function initTheme() {
  try {
    const saved = localStorage.getItem("warroom_theme");
    if (saved === "light" || saved === "dark") {
      document.documentElement.dataset.theme = saved;
    }
  } catch {
    // Ignore storage access errors under strict browser settings
  }
}

function toggleTheme() {
  const current = document.documentElement.dataset.theme || (window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light");
  const next = current === "dark" ? "light" : "dark";
  document.documentElement.dataset.theme = next;
  try {
    localStorage.setItem("warroom_theme", next);
  } catch {
    // Ignore storage access errors
  }
}

function initSidebar() {
  const key = "warroom-horizon-sidebar";
  const compact = matchMedia("(max-width: 1020px)");
  const toggle = $("sidebar-toggle");
  let preference;
  try {
    const saved = localStorage.getItem(key);
    if (["collapsed", "expanded"].includes(saved)) preference = saved;
  } catch { /* Use the responsive default. */ }
  const render = () => {
    const collapsed = preference ? preference === "collapsed" : compact.matches;
    $("shell").dataset.sidebar = collapsed ? "collapsed" : "expanded";
    toggle.setAttribute("aria-expanded", String(!collapsed));
    toggle.setAttribute("aria-label", collapsed ? "ขยายแถบเมนู" : "ย่อแถบเมนู");
    toggle.title = toggle.getAttribute("aria-label");
  };
  toggle.addEventListener("click", () => {
    preference = toggle.getAttribute("aria-expanded") === "true" ? "collapsed" : "expanded";
    try { localStorage.setItem(key, preference); } catch { /* Keep the choice for this page. */ }
    render();
  });
  compact.addEventListener("change", render);
  render();
}

async function signOut() {
  try {
    await api("/api/logout", { method: "POST", body: "{}" });
    work.clear();
    location.reload();
  } catch (err) {
    $("account-dialog").close();
    showFeedback(errorText(err));
  }
}

function bindEvents() {
  for (const btn of document.querySelectorAll(".nav-btn")) {
    btn.addEventListener("click", () => switchView(btn.dataset.view));
  }
  $("goto-history-btn").addEventListener("click", () => switchView("history"));
  $("goto-members-btn").addEventListener("click", () => switchView("members"));
  $("quick-alerts").addEventListener("click", () => switchView("settings"));
  $("quick-theme").addEventListener("click", toggleTheme);
  $("quick-help").addEventListener("click", openGuidanceDialog);
  $("refresh").addEventListener("click", () => refresh(false));
  $("pause-resume-quick").addEventListener("click", () => pauseAlerts(0, $("pause-resume-quick")));
  $("history-load-more").addEventListener("click", () => loadHistory(true).catch((e) => showFeedback(errorText(e))));

  $("search-input").addEventListener("input", (ev) => {
    searchQuery = ev.target.value;
    if (activeView === "overview" && lastStatus) renderComplexTable(lastStatus);
    if (activeView === "history") renderHistoryView();
  });

  $("avatar-badge").addEventListener("click", () => $("account-dialog").showModal());
  $("account-close").addEventListener("click", () => $("account-dialog").close());
  $("logout").addEventListener("click", signOut);
  $("work-sign-in").addEventListener("click", signOut);
  $("work-revoke").addEventListener("click", async () => {
    if (!window.confirm("ถอนสิทธิ์บัญชีทดลองและล้างรายการงานบนเว็บหรือไม่?")) return;
    try {
      await api("/api/work/access", { method: "DELETE" });
      work.clear();
      user.workAccess = "unpaired";
      renderChrome(lastStatus);
      showFeedback("ถอนสิทธิ์งานทีมและล้างสำเนาบนเว็บแล้ว", true);
    } catch (err) {
      showFeedback(errorText(err));
    }
  });
  window.addEventListener("popstate", () => {
    if (user) switchView(location.pathname === "/work" ? "work" : "overview", true);
  });
  document.addEventListener("visibilitychange", () => {
    if (!document.hidden && activeView === "work") void refresh(true);
  });

  $("dialog-history").addEventListener("click", () => {
    $("dialog").close();
    switchView("history");
  });
  $("dialog-pause").addEventListener("click", () => {
    $("dialog").close();
    switchView("settings");
  });
  $("close").addEventListener("click", () => $("dialog").close());
}

async function boot() {
  initTheme();
  initSidebar();
  bindEvents();
  try {
    user = await api("/api/session");
    $("login").hidden = true;
    $("shell").hidden = false;
    $("demo-banner").hidden = !user.demo;
    activeView = location.pathname === "/work" ? "work" : "overview";
    renderChrome(lastStatus);
    await refresh(true);
    stopPolling();
    pollTimer = setInterval(() => {
      if (!document.hidden && ["overview", "work"].includes(activeView)) refresh(true);
    }, 30000);
  } catch {
    await login();
  }
}

boot();
