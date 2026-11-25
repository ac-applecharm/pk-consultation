"use strict";
/* PK Direction Consultation: in-room module, slide by slide (like Slido or Mentimeter).
   The PowerPoint is presented separately. Staff move through the slides in agenda.js; whatever slide the staff
   screen shows is the slide the phones answer. Moving on locks the previous slide; going back reopens it.
   Results reach the room screen only when staff press Show results (the Session 4 national table is live).
   One page for three kinds of code: participant phone, staff, room screen (projector).
   Everything is read and written through database functions that check the access code (09 to 16 in the database folder).
   The database field "slide_id" holds the current slide ("wait" for the waiting screen). */
(function () {
  var API = "https://drwmnzmvsjhlbixqcvew.supabase.co";
  var KEY = "sb_publishable_Vzh0zj3WvlhNqJg0wHV87w_bVwjmNdv";
  var MOCK = /^(localhost|127\.0\.0\.1)$/.test(location.hostname) && /[?&]mock=1/.test(location.search);
  var $ = function (id) { return document.getElementById(id); };

  var GROUPS = ["Regional", "Local implementers", "National level", "Other"];
  var TEXT_WORDS = 1500;
  var AG = window.PK_AGENDA, ACT = AG.activities;
  var SHEET_NAMES = { T1: "Table 1", T2: "Table 2", T3: "Table 3", T4: "Table 4", C1: "Clinic 1", C2: "Clinic 2", C3: "Clinic 3", ROOM: "Staff sheet" };
  var TABLES = ["T1", "T2", "T3", "T4"];

  // the base slides, in order, with their day
  var BASE = [];
  AG.slides.forEach(function (d, di) { d.slides.forEach(function (s) { BASE.push(Object.assign({ day: di, dayName: d.day }, s)); }); });
  var LIVE = Object.keys(ACT).filter(function (k) { return ACT[k].live; });

  var S = {
    code: null, role: null, session: null, profile: {}, st: null, ver: null, skew: 0, joined: null, counts: {},
    tab: "slides", mine: {}, queue: [], marks: {}, pollTimer: null, fails: 0, sig: "", running: false, stage: "live",
    sheetData: {}, sheetState: {}, sq: {}, openSheet: null, openReg: null, views: [], cycle: {}, tallyPick: 0, pollDraft: null, d10Each: false
  };

  // ---------- helpers ----------
  function el(tag, attrs) {
    var e = document.createElement(tag);
    attrs = attrs || {};
    Object.keys(attrs).forEach(function (k) {
      var v = attrs[k];
      if (v == null || v === false) return;
      if (k === "class") e.className = v;
      else if (k === "text") e.textContent = v;
      else if (k.slice(0, 2) === "on") e.addEventListener(k.slice(2), v);
      else if (k === "checked" || k === "disabled" || k === "selected") e[k] = !!v;
      else if (k === "value") e.value = v;
      else e.setAttribute(k, v === true ? "" : v);
    });
    for (var i = 2; i < arguments.length; i++) {
      [].concat(arguments[i]).forEach(function (c) { if (c == null || c === false) return; e.appendChild(typeof c === "string" ? document.createTextNode(c) : c); });
    }
    return e;
  }
  function clear(n) { while (n.firstChild) n.removeChild(n.firstChild); return n; }
  function lsGet(k) { try { return JSON.parse(localStorage.getItem(k)); } catch (e) { return null; } }
  function lsSet(k, v) { try { if (v === undefined) localStorage.removeItem(k); else localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} }
  function ssGet(k) { try { return sessionStorage.getItem(k); } catch (e) { return null; } }
  function ssSet(k, v) { try { if (v == null) sessionStorage.removeItem(k); else sessionStorage.setItem(k, v); } catch (e) {} }
  function fnv(text) { var h = 2166136261; for (var i = 0; i < text.length; i++) { h ^= text.charCodeAt(i); h = Math.imul(h, 16777619); } return (h >>> 0).toString(16); }
  function profileKey(code) { return "pk_room_p_" + fnv(code); }
  function uuid() {
    if (window.crypto && crypto.randomUUID) return crypto.randomUUID();
    return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, function (c) { var r = Math.random() * 16 | 0; return (c === "x" ? r : (r & 3 | 8)).toString(16); });
  }
  function rid() { return "r" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6); }
  function wc(s) { s = (s || "").trim(); return s ? s.split(/\s+/).length : 0; }
  function fmtN(n) { return Number(Math.round(n)).toLocaleString("en-US"); }
  function rpc(name, body) {
    if (MOCK && window.PK_ROOM_MOCK) return window.PK_ROOM_MOCK.rpc(name, body);
    return fetch(API + "/rest/v1/rpc/" + name, { method: "POST", headers: { apikey: KEY, "Content-Type": "application/json" }, body: JSON.stringify(body) })
      .then(function (r) {
        if (r.ok) return r.json();
        return r.text().then(function (t) {
          var detail = ""; try { var j = JSON.parse(t); detail = j.message || j.hint || ""; } catch (e) { detail = String(t || "").slice(0, 120); }
          var err = new Error("http " + r.status); err.http = r.status; err.detail = detail; throw err;
        });
      });
  }
  // A short, honest reason for a failed request. Only a real network failure says "No connection".
  function errText(e) {
    if (e && e.http) return "The server refused it (" + e.http + (e.detail ? ": " + e.detail : "") + "). Tell the PK team.";
    if (e instanceof TypeError) return "No connection.";
    return "Something went wrong on this page: " + (e && e.message ? e.message : "unknown") + ".";
  }
  function toast(text) {
    var t = $("toast"); t.textContent = text; t.hidden = false; clearTimeout(toast.t);
    toast.t = setTimeout(function () { t.hidden = true; }, 3800);
  }
  function msg(node, text, kind) { clear(node); if (text) node.appendChild(el("div", { class: "msg " + (kind || ""), text: text })); }
  function actState(key) { return (S.st && S.st.acts && S.st.acts[key]) || "none"; }
  function pollMs() { var n = +(S.st && S.st.settings && S.st.settings.poll_ms) || 5000; return Math.max(2000, Math.min(30000, n)); }
  function setting(k) { return S.st && S.st.settings ? S.st.settings[k] : undefined; }
  function joinCode() { var c = setting("join_code"); return typeof c === "string" && /^[A-Z0-9-]{3,40}$/.test(c) ? c : ""; }
  function evalUrl() { var u = setting("eval_url"); return typeof u === "string" && /^https:\/\/[^\s]+$/i.test(u) ? u : ""; }
  function isStaff() { return S.role === "staff"; }
  function isProj() { return S.role === "projector"; }
  function clean(t) { return String(t == null ? "" : t).trim().replace(/[.;,]+$/, "").trim(); }
  function cap(t) { return t ? t.charAt(0).toUpperCase() + t.slice(1) : t; }
  function lowFirst(t) { return t && /^[A-Z][a-z]/.test(t) ? t.charAt(0).toLowerCase() + t.slice(1) : t; }
  function joinAnd(list) {
    list = list.filter(function (x) { return !!x; });
    if (list.length < 2) return list[0] || "";
    return list.slice(0, -1).join(", ") + " and " + list[list.length - 1];
  }
  // The trial room looks different on every screen, so nobody mistakes it for the live room.
  function applyStage(stage) {
    if (stage !== "trial" && stage !== "live") return;
    S.stage = stage;
    var bar = $("trialBar"), trial = stage === "trial";
    bar.hidden = !trial;
    bar.textContent = trial ? (isProj() ? "TRIAL ROOM: not the live consultation" : "TRIAL ROOM: answers here are not counted. The evaluation link and polling speed are shared with the live room.") : "";
    document.body.classList.toggle("trial", trial);
    document.title = (trial ? "TRIAL · " : "") + "PK Direction Consultation: Room";
    sizeRibbon();
  }
  function sizeRibbon() { var bar = $("trialBar"); document.documentElement.style.setProperty("--ribbon-h", (bar.hidden ? 0 : bar.offsetHeight) + "px"); }
  window.addEventListener("resize", sizeRibbon);

  // ---------- slides and quick votes ----------
  // quick votes are typed by staff during the session; they are kept in the stage setting "quick"
  function quickMap() { var q = setting("quick"); return q && typeof q === "object" ? q : {}; }
  function quickDef(id) {
    var q = quickMap()[id]; if (!q) return null;
    return { title: q.ballot ? "Anonymous ballot" : "Quick vote", kind: "form", quick: true, ballot: !!q.ballot,
      items: [{ id: "v", label: q.q, type: "single", options: (q.opts || []).map(function (o, i) { return ["o" + (i + 1), o]; }) }] };
  }
  function actDef(key) { return ACT[key] || quickDef(key); }
  function slideList() {
    var q = quickMap(), ids = Object.keys(q).sort(function (a, b) { return (q[a].at || 0) - (q[b].at || 0); }), out = [];
    BASE.forEach(function (s) {
      out.push(s);
      ids.forEach(function (id) {
        if (q[id].after !== s.id) return;
        out.push({ id: id, quick: true, day: s.day, dayName: s.dayName, session: s.session, title: (q[id].ballot ? "Ballot: " : "Quick vote: ") + q[id].q, acts: [id] });
      });
    });
    return out;
  }
  function slideById(id) { var l = slideList(); for (var i = 0; i < l.length; i++) if (l[i].id === id) return l[i]; return null; }
  function curSlide() { return S.st ? slideById(S.st.slide_id) : null; }
  function slideActs(s) { return s ? (s.acts || []) : []; }
  function slideRevealed(s) { var a = slideActs(s); return a.length > 0 && a.every(function (k) { return actState(k) === "revealed"; }); }
  function sheetActsOf(s) { return slideActs(s).filter(function (k) { return ACT[k] && ACT[k].kind === "sheet"; }); }
  function slideSheets(s) { var out = []; sheetActsOf(s).forEach(function (k) { (ACT[k].sheets || []).forEach(function (sh) { if (out.indexOf(sh) < 0) out.push(sh); }); }); return out; }
  function presentPick(s) { var p = setting("present"), all = slideSheets(s); return p === "all" ? "all" : (all.indexOf(p) >= 0 ? p : (all[0] || "all")); }

  // ---------- save queue for personal answers (answers survive a dropped connection) ----------
  function mk(act, item) { return act + "|" + item; }
  function setSave(state) {
    var n = $("saveState"); n.hidden = !state; n.className = "save" + (state === "queued" || state === "fail" ? " warn" : "");
    n.textContent = { saving: "Saving...", saved: "Saved", queued: "Saved here. Will send later.", fail: "Not saved. Tell the PK team." }[state] || "";
  }
  function setMark(key, state) {
    var n = S.marks[key]; if (!n || !document.body.contains(n)) return;
    n.textContent = { saving: "Saving...", saved: "Saved", queued: "Saved here. Will send later.", closed: "Not saved: the slide moved on" }[state] || "";
    n.className = "saved-mark" + (state === "saved" ? "" : " pending");
  }
  // queues are kept per person (code and session), so two people sharing one browser never send each other's answers
  function loadQueue() { S.queue = lsGet("pk_room_q_" + fnv(S.code + "|" + S.session)) || []; }
  function saveQueue() { lsSet("pk_room_q_" + fnv(S.code + "|" + S.session), S.queue.length ? S.queue : undefined); }
  function saveItem(act, item, payload) {
    var key = mk(act, item);
    S.mine[key] = payload;
    S.queue = S.queue.filter(function (q) { return mk(q.act, q.item) !== key; });
    S.queue.push({ act: act, item: item, payload: payload });
    saveQueue(); setSave("saving"); setMark(key, "saving"); flush();
  }
  function flush() {
    if (S.flushing || !S.queue.length) { if (!S.queue.length && S.role === "participant" && !Object.keys(S.sq || {}).length) setSave(S.hadSave || S.sqSaved ? "saved" : null); return; }
    S.flushing = true;
    var q = S.queue[0], key = mk(q.act, q.item);
    rpc("room_save_entry", { p_code: S.code, p_session: S.session, p_activity: q.act, p_item: q.item, p_payload: q.payload }).then(function (r) {
      S.flushing = false;
      // remove exactly the entry that was sent; a newer answer to the same question stays queued
      if (r.ok) { S.queue = S.queue.filter(function (x) { return x !== q; }); S.hadSave = true; saveQueue(); if (!S.queue.some(function (x) { return mk(x.act, x.item) === key; })) setMark(key, "saved"); flush(); return; }
      if (r.reason === "not_joined" && !S.rejoined) {
        S.rejoined = true;
        joinCall(S.profile).then(function () { flush(); }).catch(function () { setSave("queued"); });
        return;
      }
      S.queue = S.queue.filter(function (x) { return x !== q; }); saveQueue(); setMark(key, "closed");
      toast(r.reason === "not_open" ? "The slide moved on before your answer was saved." : "Your answer could not be saved. Tell the PK team.");
      setSave("fail"); flush();
    }).catch(function () {
      S.flushing = false; setSave("queued"); setMark(key, "queued");
      clearTimeout(S.retry); S.retry = setTimeout(flush, 5000);
    });
  }

  // ---------- sign-in ----------
  function normCode(v) { return String(v || "").trim().toUpperCase().replace(/\s+/g, ""); }
  function gateGo() {
    var code = normCode($("code").value), out = $("gateMsg");
    if (!code) { msg(out, "Please type your access code.", "err"); return; }
    msg(out, "Checking...");
    rpc("room_get_state", { p_code: code, p_session: null, p_since: null }).then(function (r) {
      if (!r.ok) { msg(out, "That code was not recognized, or it is not open yet. Check it and try again.", "err"); return; }
      if (r.role === "device") { msg(out, "Group-device codes are no longer used. Please use your participant code.", "err"); return; }
      msg(out, "");
      S.code = code; S.role = r.role; applyStage(r.stage);
      var p = lsGet(profileKey(code)) || {};
      S.session = p.session || uuid(); S.profile = p;
      // a different table or group on this browser means a different person: give them their own session
      if (r.role === "participant") profileForm(p, function (prof) { if (p.session && (prof.table !== p.table || prof.grp !== p.grp)) S.session = uuid(); startJoin(prof); });
      else startJoin({});
    }).catch(function () { msg(out, "Could not reach the server. Check the connection and try again.", "err"); });
  }
  function radioGroup(name, options, value, onChange) {
    var wrap = el("div", { class: "opts" });
    options.forEach(function (o) {
      var inp = el("input", { type: "radio", name: name, value: o[0], checked: value === o[0] });
      var lab = el("label", { class: "opt" + (value === o[0] ? " sel" : "") }, inp, el("span", { text: o[1] }));
      inp.addEventListener("change", function () {
        [].forEach.call(wrap.querySelectorAll(".opt"), function (l) { l.classList.remove("sel"); });
        lab.classList.add("sel"); onChange(o[0]);
      });
      wrap.appendChild(lab);
    });
    return wrap;
  }
  function profileForm(p, done, host) {
    var box = clear(host || $("joinForm")), v = { grp: p.grp || null, table: p.table || null, prework: p.prework === undefined ? undefined : p.prework }, out = el("div");
    box.appendChild(el("hr", { class: "hr" }));
    box.appendChild(el("h3", { text: "Where are you sitting?", style: "margin-top:0" }));
    box.appendChild(el("div", { class: "q" }, el("span", { class: "t", text: "Your table" }),
      radioGroup("tbl", [[1, "Table 1"], [2, "Table 2"], [3, "Table 3"], [4, "Table 4"]].map(function (x) { return [String(x[0]), x[1]]; }), v.table ? String(v.table) : null, function (x) { v.table = +x; })));
    box.appendChild(el("div", { class: "q" }, el("span", { class: "t", text: "Your group" }),
      el("p", { class: "help", text: "Development partners: choose National level." }),
      radioGroup("grp", GROUPS.map(function (g) { return [g, g]; }), v.grp, function (x) { v.grp = x; })));
    box.appendChild(el("div", { class: "q" }, el("span", { class: "t", text: "Did you finish the online pre-work?" }), el("p", { class: "help", text: "Only a count is kept. It is not linked to your answers." }),
      radioGroup("pw", [["yes", "Yes"], ["no", "No"], ["skip", "I prefer not to say"]], v.prework === true ? "yes" : v.prework === false ? "no" : v.prework === null ? "skip" : null, function (x) { v.prework = x === "yes" ? true : x === "no" ? false : null; })));
    box.appendChild(el("button", { type: "button", class: "btn", text: "Join", onclick: function () {
      if (!v.table || !v.grp) { msg(out, "Please choose your table and your group.", "err"); return; }
      done({ grp: v.grp, table: v.table, prework: v.prework === undefined ? null : v.prework });
    } }));
    box.appendChild(out);
  }
  function joinCall(prof) {
    return rpc("room_join", { p_code: S.code, p_session: S.session, p_grp: prof.grp || null, p_table: prof.table || null, p_sheet: null, p_prework: prof.prework === undefined ? null : prof.prework });
  }
  function startJoin(prof) {
    joinCall(prof).then(function (r) {
      if (!r.ok) {
        var why = { need_group_and_table: "Please choose your table and your group.", invalid: "That code is not open." }[r.reason] || "Could not join. Please try again.";
        msg($("gateMsg"), why, "err"); return;
      }
      S.profile = { session: S.session, grp: prof.grp, table: prof.table, prework: prof.prework };
      lsSet(profileKey(S.code), S.profile); ssSet("pk_room_cur", S.code); ssSet("pk_room_ps", JSON.stringify(S.profile));
      startApp();
    }).catch(function () { msg($("gateMsg"), "Could not reach the server. Check the connection and try again.", "err"); });
  }
  function resume() {
    var cur = ssGet("pk_room_cur"); if (!cur) return;
    // this tab's own sign-in first (several people may share one browser), then the one saved on this device
    var p = null; try { p = JSON.parse(ssGet("pk_room_ps") || "null"); } catch (e) {}
    p = p || lsGet(profileKey(cur)); if (!p || !p.session) return;
    S.code = cur; S.session = p.session; S.profile = p;
    rpc("room_get_state", { p_code: cur, p_session: null, p_since: null }).then(function (r) {
      if (!r.ok || r.role === "device") { ssSet("pk_room_cur", null); return; }
      S.role = r.role; applyStage(r.stage);
      joinCall(p).then(function (j) { if (j.ok) startApp(); });
    }).catch(function () {});
  }
  function leave() {
    clearTimeout(S.pollTimer); S.running = false;
    ssSet("pk_room_cur", null); ssSet("pk_room_ps", null);
    location.reload();
  }
  function kicked() {
    clearTimeout(S.pollTimer); S.running = false;
    $("app").hidden = true; $("gate").hidden = false; document.body.classList.remove("proj");
    msg($("gateMsg"), "This code is no longer open. Please check with the PK team.", "err");
  }

  // ---------- app start and polling ----------
  function startApp() {
    $("gate").hidden = true; $("app").hidden = false; S.running = true;
    document.body.classList.toggle("proj", isProj());
    $("roleChip").hidden = false; $("menuBtn").hidden = false;
    if (S.role === "participant" && !$("histBtn")) {
      var hb = el("button", { type: "button", id: "histBtn", class: "rchip histbtn", hidden: true, title: "History of your table's sheet", "aria-label": "History of your table's sheet" }, "\u21BA", el("span", { class: "hlabel", text: " History" }));
      hb.addEventListener("click", function (e) { e.stopPropagation(); toggleHistory(); });
      $("roleChip").parentNode.insertBefore(hb, $("roleChip"));
    }
    if (S.role === "participant") {
      var chip = $("roleChip");
      chip.classList.add("chipbtn"); chip.setAttribute("role", "button"); chip.setAttribute("tabindex", "0");
      chip.setAttribute("aria-label", "Your table and group: show or change");
      chip.addEventListener("click", function (e) { e.stopPropagation(); toggleCheckin(); });
      chip.addEventListener("keydown", function (e) { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); toggleCheckin(); } });
    }
    S.mine = {}; loadQueue(); loadSheetQueue(); S.ver = null;
    if (Object.keys(S.sq).length) setTimeout(flushSheets, 1500);
    buildTabs();
    var go = function () { loop(); };
    if (S.role === "participant") {
      rpc("room_my_entries", { p_code: S.code, p_session: S.session, p_activity: null }).then(function (r) {
        if (r.ok) r.entries.forEach(function (e) { S.mine[mk(e.activity, e.item)] = e.payload; });
      }).catch(function () {}).then(function () { go(); flush(); });
    } else go();
    setInterval(tick, 500);
  }
  function schedule() {
    clearTimeout(S.pollTimer);
    if (!S.running) return;
    var ms = pollMs() * Math.pow(2, Math.min(S.fails, 3));
    S.pollTimer = setTimeout(function () {
      if (document.hidden) { schedule(); return; }
      loop();
    }, Math.min(ms, 30000));
  }
  function loop() { return pollOnce().catch(function (e) { console.error(e); }).then(schedule); }
  function pollNow() { S.ver = null; clearTimeout(S.pollTimer); return loop(); }
  function pollOnce() {
    return rpc("room_get_state", { p_code: S.code, p_session: S.session, p_since: S.ver }).then(function (r) {
      S.fails = 0;
      if (S.queue.length) flush();
      if (!r.ok) { if (r.reason === "invalid") kicked(); return; }
      if (r.counts !== undefined && r.counts !== null) S.counts = r.counts;
      if (r.joined !== undefined && r.joined !== null) S.joined = r.joined;
      if (r.unchanged) { updateLive(); return refreshLive(); }
      S.ver = r.version; S.st = r; applyStage(r.stage);
      S.skew = Date.parse(r.now) - Date.now();
      render(); updateLive();
      return refreshLive();
    }, function () {
      // only a failed request lands here; a bug in drawing the page does not
      S.fails += 1;
      if (S.fails >= 2) { var n = $("saveState"); n.hidden = false; n.className = "save warn"; n.textContent = "Connection lost. Trying again..."; }
    });
  }
  function tick() {
    var t = $("timer"), end = S.st && S.st.timer_end ? Date.parse(S.st.timer_end) : 0;
    if (!end) { t.hidden = true; return; }
    var left = Math.round((end - (Date.now() + S.skew)) / 1000), late = left < 0, a = Math.abs(left);
    t.hidden = false; t.className = "rchip timer" + (late ? " late" : "");
    t.textContent = (late ? "-" : "") + Math.floor(a / 60) + ":" + ("0" + (a % 60)).slice(-2);
  }
  function updateLive() {
    var chip = $("roleChip");
    chip.textContent = ({ staff: "Staff", projector: "Room screen", participant: S.profile.table ? "Table " + S.profile.table + " · " + S.profile.grp : "Participant" })[S.role] + (isStaff() && S.joined != null ? " · " + S.joined + " online" : "");
    [].forEach.call(document.querySelectorAll("[data-count]"), function (n) {
      var c = S.counts[n.getAttribute("data-count")] || 0;
      n.textContent = isProj() ? c + (c === 1 ? " response received" : " responses received") : c + (c === 1 ? " response" : " responses");
    });
    if (S.fails === 0 && $("saveState").className.indexOf("warn") >= 0 && !S.queue.length) setSave(S.hadSave ? "saved" : null);
  }
  document.addEventListener("visibilitychange", function () { if (!document.hidden && S.running) pollNow(); });
  window.addEventListener("online", function () { if (S.running) { pollNow(); flush(); flushSheets(); } });

  // ---------- live views: parts of the page that redraw when their data changes ----------
  // Each view names the sheets it reads (deps) and may fetch other data. It redraws when the data changes,
  // unless someone is typing in it; then only the other boxes are updated, and it redraws once they stop.
  // text boxes grow with their text (no fixed height, nothing to drag)
  function fitBox(ta) {
    if (!ta || ta.tagName !== "TEXTAREA" || !ta.offsetParent) return;
    var cs = getComputedStyle(ta), edge = (parseFloat(cs.borderTopWidth) || 0) + (parseFloat(cs.borderBottomWidth) || 0);
    ta.style.height = "auto";
    ta.style.height = (ta.scrollHeight + edge) + "px";
  }
  function fitAll(root) { [].forEach.call((root || document).querySelectorAll("textarea"), fitBox); }
  function autoGrow() {
    document.addEventListener("input", function (e) { if (e.target && e.target.tagName === "TEXTAREA") fitBox(e.target); });
    document.addEventListener("toggle", function (e) { if (e.target && e.target.querySelectorAll) fitAll(e.target); }, true);
    var queued = false;
    var later = function () { if (queued) return; queued = true; requestAnimationFrame(function () { queued = false; fitAll(document); }); };
    if (window.MutationObserver) new MutationObserver(function (list) {
      for (var i = 0; i < list.length; i++) {
        var added = list[i].addedNodes;
        for (var j = 0; j < added.length; j++) {
          var n = added[j];
          if (n.nodeType === 1 && (n.tagName === "TEXTAREA" || n.querySelector("textarea"))) { later(); return; }
        }
      }
    }).observe(document.body, { childList: true, subtree: true });
    var rt; window.addEventListener("resize", function () { clearTimeout(rt); rt = setTimeout(function () { fitAll(document); }, 150); });
    later();
  }
  function liveView(o) {
    var v = { node: el("div", { class: "lv" }), deps: o.deps || [], fetch: o.fetch, draw: o.draw, sig: null, data: o.data };
    v.redraw = function () { drawView(v); };
    S.views.push(v);
    drawView(v);
    setTimeout(function () { refreshView(v); }, 0);
    return v.node;
  }
  function drawView(v) {
    var f = document.activeElement, fk = f && v.node.contains(f) ? f.getAttribute("data-k") : null, y = window.scrollY;
    // unsaved typing is carried into the redrawn boxes, still unsaved, so it is neither lost nor saved without Save
    var keep = {};
    [].forEach.call(v.node.querySelectorAll("textarea"), function (x) { if (x._dirty) keep[x.getAttribute("data-q") + "#" + x.getAttribute("data-k")] = x.value; });
    clear(v.node);
    var n = null; try { n = v.draw(v.data, v); } catch (e) { console.error(e); n = el("p", { class: "muted", text: "This part could not be drawn." }); }
    if (n) v.node.appendChild(n);
    [].forEach.call(v.node.querySelectorAll("textarea"), function (x) {
      var id = x.getAttribute("data-q") + "#" + x.getAttribute("data-k");
      if (id in keep && x._flush) { x.value = keep[id]; x._dirty = true; x.classList.add("unsaved"); }
    });
    updateSaveBars();
    if (fk) { var again = v.node.querySelector('[data-k="' + fk.replace(/"/g, '\\"') + '"]'); if (again) { try { again.focus({ preventScroll: true }); } catch (e) {} } }
    if (Math.abs(window.scrollY - y) > 2) window.scrollTo(0, y);
  }
  function depBodies(act) {
    var out = {}; Object.keys(S.sheetData).forEach(function (k) { if (k.split("|")[0] === act) out[k] = S.sheetData[k].body; }); return out;
  }
  function loadOnce(act) { if (!S.cycle[act]) S.cycle[act] = loadSheets(act).catch(function () {}); return S.cycle[act]; }
  function refreshView(v) {
    if (!document.body.contains(v.node)) return Promise.resolve();
    return Promise.all(v.deps.map(loadOnce)).then(function () { return v.fetch ? v.fetch() : v.data; }).then(function (data) {
      v.data = data;
      var sig = JSON.stringify([v.deps.map(depBodies), data == null ? null : data]);
      if (sig === v.sig) return;
      if (v.node.contains(document.activeElement) && /^(TEXTAREA|INPUT|SELECT)$/.test(document.activeElement.tagName) && document.activeElement.type !== "checkbox" && document.activeElement.type !== "radio") { syncInputs(v.node); return; }
      v.sig = sig; drawView(v);
    }).catch(function (e) { console.error(e); });
  }
  // update the boxes nobody is typing in, from the latest sheet data
  function syncInputs(node) {
    [].forEach.call(node.querySelectorAll("[data-k][data-q]"), function (inp) {
      if (inp === document.activeElement) return;
      var q = inp.getAttribute("data-q"), k = inp.getAttribute("data-k"), parts = q.split("|");
      if (pendingCell(parts[0], parts[1], k) || inp._dirty) return;
      var v = sheetBody(parts[0], parts[1])[k];
      if (v === undefined) return;
      if (inp.type === "checkbox") inp.checked = !!v; else if (inp.type === "radio") inp.checked = String(v) === inp.value; else if (inp.value !== String(v)) { inp.value = v; fitBox(inp); }
    });
  }
  function refreshLive() {
    S.cycle = {};
    S.views = S.views.filter(function (v) { return document.body.contains(v.node); });
    return Promise.all(S.views.map(refreshView));
  }

  // ---------- render dispatch ----------
  function render() {
    if (!S.running || !S.st) return;
    if (isStaff()) renderStaff(); else if (isProj()) renderProj(); else renderPart();
  }
  function saveTyped() { [].forEach.call(document.querySelectorAll("#view textarea"), function (x) { if (x._dirty && x._flush) x._flush(); }); }
  function resetView() { saveTyped(); S.views = []; S.marks = {}; return clear($("view")); }
  function buildTabs() {
    var nav = $("tabs"); clear(nav); nav.hidden = !isStaff();
    if (!isStaff()) return;
    [["slides", "Slides"], ["registers", "Staff sheets"], ["paper", "Paper entries"], ["settings", "Settings"]].forEach(function (t) {
      nav.appendChild(el("button", { type: "button", class: "rtab", role: "tab", "aria-selected": S.tab === t[0] ? "true" : "false", "data-tab": t[0], text: t[1], onclick: function () {
        S.tab = t[0];
        [].forEach.call(nav.children, function (b) { b.setAttribute("aria-selected", b.getAttribute("data-tab") === S.tab ? "true" : "false"); });
        S.sig = ""; renderStaff(true);
      } }));
    });
  }

  // =====================================================================================
  // GROUP SHEETS
  // A sheet is a flat set of cells: "section.row.column" = value. Rows people add are listed in "section._rows".
  // Changes are saved cell by cell, so two people editing different cells of one sheet do not overwrite each other.
  // =====================================================================================
  function regionMin(code) {
    var r = AG.regions.filter(function (x) { return x[0] === code; })[0];
    if (!r) return null;
    return { name: r[1], register: Math.round(AG.nat.register * r[2] / AG.nat.pop), screen: Math.round(AG.nat.screen * r[2] / AG.nat.pop) };
  }
  function sheetKey(act, sheet) { return act + "|" + sheet; }
  function sheetBody(act, sheet) { return (S.sheetData[sheetKey(act, sheet)] || {}).body || {}; }
  function rowIds(sec, body) {
    if (sec.fixedRows) return sec.fixedRows.map(function (r) { return r[0]; });
    var pre = (sec.preset || []).map(function (p, i) { return "p" + i; });
    var dyn = Array.isArray(body[sec.id + "._rows"]) ? body[sec.id + "._rows"] : [];
    return pre.concat(dyn);
  }
  function addedRows(body, secId) { return Array.isArray(body[secId + "._rows"]) ? body[secId + "._rows"] : []; }
  function cellVal(body, sec, rowId, col) {
    var k = sec.id + "." + rowId + "." + col.id;
    if (body[k] != null) return body[k];
    if (sec.preset && sec.presetCol === col.id && /^p\d+$/.test(rowId)) return sec.preset[+rowId.slice(1)] || "";
    return "";
  }
  // ----- the save queue for sheets (survives a dropped connection) -----
  function sqKey() { return "pk_room_sq_" + fnv(S.code + "|" + S.session); }
  function loadSheetQueue() { S.sq = lsGet(sqKey()) || {}; }
  // a change to one cell, or "section._add" / "section._del" with a list of row ids
  function applyPatch(body, patch) {
    Object.keys(patch || {}).forEach(function (k) {
      var end = k.slice(-5);
      if (end === "._add" || end === "._del") {
        var sec = k.slice(0, -5) + "._rows", lst = Array.isArray(body[sec]) ? body[sec].slice() : [];
        [].concat(patch[k]).forEach(function (id) {
          if (end === "._add") { if (lst.indexOf(id) < 0) lst.push(id); } else lst = lst.filter(function (x) { return x !== id; });
        });
        body[sec] = lst;
      } else body[k] = patch[k];
    });
    return body;
  }
  function queueRow(act, sheet, secId, op, rowId) {
    var q = sheetKey(act, sheet), k = secId + "._" + op;
    S.sq[q] = S.sq[q] || {};
    S.sq[q][k] = [].concat(S.sq[q][k] || [], [rowId]);
    var d = S.sheetData[q] = S.sheetData[q] || { body: {} }; var one = {}; one[k] = [rowId]; applyPatch(d.body, one);
    lsSet(sqKey(), S.sq); setSave("saving");
    clearTimeout(S.sqTimer); S.sqTimer = setTimeout(flushSheets, 300);
  }
  function queueCell(act, sheet, k, v) {
    var q = sheetKey(act, sheet);
    S.sq[q] = S.sq[q] || {}; S.sq[q][k] = v;
    var d = S.sheetData[q] = S.sheetData[q] || { body: {} }; d.body[k] = v;
    lsSet(sqKey(), S.sq); setSave("saving");
    clearTimeout(S.sqTimer); S.sqTimer = setTimeout(flushSheets, 700);
  }
  function flushSheets() {
    if (S.sqBusy) return;
    var keys = Object.keys(S.sq || {});
    if (!keys.length) { if (S.role !== "projector" && S.sqSaved) setSave("saved"); return; }
    S.sqBusy = true;
    var q = keys[0], parts = q.split("|"), patch = S.sq[q];
    S.sq[q] = {}; delete S.sq[q];
    var body = { p_code: S.code, p_session: S.session, p_activity: parts[0], p_sheet: parts[1], p_patch: patch };
    // staff: only a Save press goes into the history; phones are logged by the database as before
    var logIt = isStaff() && S.sqLog && S.sqLog[q];
    if (logIt && !S.noLogParam) body.p_log = true;
    rpc("room_save_sheet", body).then(function (r) {
      S.sqBusy = false;
      if (logIt && S.sqLog) delete S.sqLog[q];
      if (r.ok) { S.sqSaved = true; lsSet(sqKey(), Object.keys(S.sq).length ? S.sq : undefined); flushSheets(); return; }
      lsSet(sqKey(), Object.keys(S.sq).length ? S.sq : undefined);
      keepRefused(parts[0], parts[1], patch);
      toast(r.reason === "not_open" ? "The slide moved on. Your last change was not saved; it is kept at the top of your page." : "A change could not be saved (" + (r.reason || "unknown") + ").");
      setSave("fail"); flushSheets();
    }).catch(function (e) {
      // put the patch back and try again later
      S.sqBusy = false;
      // the database does not know p_log yet (19_room_log_staff_save.sql not run): save without it
      if (body.p_log && e && e.http === 404) { S.noLogParam = true; }
      var later = S.sq[q] || {};
      Object.keys(later).forEach(function (k) {
        if (/\._(add|del)$/.test(k)) patch[k] = [].concat(patch[k] || [], later[k]); else patch[k] = later[k];
      });
      S.sq[q] = patch; lsSet(sqKey(), S.sq); setSave("queued");
      clearTimeout(S.sqTimer); S.sqTimer = setTimeout(flushSheets, S.noLogParam && body.p_log ? 0 : 5000);
    });
  }
  // text a sheet refused (the slide had moved on), kept on this phone so the table can still read it out to staff
  function refusedKey() { return "pk_room_refused_" + fnv(S.code + "|" + S.session); }
  function keepRefused(act, sheet, patch) {
    var list = lsGet(refusedKey()) || [];
    Object.keys(patch || {}).forEach(function (k) {
      var v = patch[k]; if (typeof v !== "string" || !v.trim()) return;
      list.push({ act: act, sheet: sheet, k: k, text: v, at: Date.now() });
    });
    lsSet(refusedKey(), list.length ? list.slice(-30) : undefined);
    if (S.role === "participant") { S.sig = ""; renderPart(true); }
  }
  function refusedCard() {
    var list = lsGet(refusedKey()) || [];
    if (!list.length) return null;
    return el("section", { class: "apanel refused" }, el("h3", { text: "Not saved: the slide had moved on" }),
      el("p", { class: "help", text: "This text did not reach the sheet. Read it out to your facilitator, who can still add it." }),
      el("ul", null, list.map(function (x) { return el("li", null, el("b", { text: (SHEET_NAMES[x.sheet] || x.sheet) + " \u00B7 " + keyLabel(x.act, x.k) + ": " }), x.text); })),
      el("button", { type: "button", class: "btn ghost small", text: "Dismiss", onclick: function () { lsSet(refusedKey(), undefined); S.sig = ""; renderPart(true); } }));
  }
  // a readable name for a sheet cell, for the history and the not-saved list
  function keyLabel(act, k) {
    var def = ACT[act] || {}, parts = String(k).split("."), pick = function (list, id) { return (list || []).filter(function (x) { return (x.id || x[0]) === id; })[0]; };
    if (/\._(add|del)$/.test(k)) return "rows";
    if (def.view === "choose") {
      var cat = pick(AG.s2.cats, parts[1]);
      if (parts[0] === "pk" && cat) return cat.name + ": choice";
      if (parts[0] === "mix" && cat) return cat.name + ": own idea";
      if (parts[0] === "pw" && cat) { var idea = pick(cat.ideas, parts[2]); return cat.name + ": " + (idea ? idea.text : parts[2]); }
      if (parts[0] === "st") { var st = pick(AG.s2.stakes, parts[1]); var rl = pick(AG.s2.roles, parts[2]); return cap(st ? st[1] : parts[1]) + ": " + (parts[2] === "rem" ? "remarks" : parts[2] === "none" ? "no role" : (rl ? rl[1] : parts[2])); }
      if (parts[0] === "ns") { var rl2 = pick(AG.s2.roles, parts[2]); return "Added stakeholder: " + (parts[2] === "name" ? "name" : parts[2] === "rem" ? "remarks" : parts[2] === "none" ? "no role" : (rl2 ? rl2[1] : parts[2])); }
      return k;
    }
    var rest = String(k).slice(parts[0].length + 1), findIn = function (lists) { for (var i = 0; i < lists.length; i++) { var hit = lists[i].rows.filter(function (r) { return r.key === rest; })[0]; if (hit) return { list: lists[i], row: hit }; } return null; };
    if (def.view === "merge2") {
      if (k === "statement") return "The merged statement";
      if (parts[0] === "f" && parts[1] === "cat") { var c2 = pick(AG.s2.cats, parts[2]); return (c2 ? c2.name : parts[2]) + ": final agreed"; }
      if (parts[0] === "f" && parts[1] === "st") { var s2 = pick(AG.s2.stakes, parts[2]); return cap(s2 ? s2[1] : parts[2]) + ": agreed roles"; }
      if (parts[0] === "f" && parts[1] === "ns") { var nn = clean(sheetBody("s2_choose", parts[2])["ns." + parts[3] + ".name"]); return "Added stakeholder" + (nn ? " (" + nn + ")" : "") + ": agreed roles"; }
      return k;
    }
    if (def.view === "merge6") {
      var h6 = findIn([1, 2, 3].map(clinicRows)), w6 = { fh: "agreed how", fw: "agreed: who will implement" }[parts[0]];
      if (h6 && w6) return SHEET_NAMES[h6.list.sheet] + " \u00B7 " + (h6.row.q || h6.row.topic) + ": " + w6;
      return k;
    }
    if (def.view === "merge7") {
      var h7 = findIn([1, 2, 3].map(indRows)), w7 = { fi: "agreed indicator", fc: "agreed calculation", fl: "agreed level, data source and user" }[parts[0]];
      if (h7 && w7) return SHEET_NAMES[h7.list.sheet] + " \u00B7 " + h7.row.comp + (h7.row.ind ? " (" + h7.row.ind + ")" : "") + ": " + w7;
      return k;
    }
    if (def.view === "merge3") {
      var h3 = findIn(d9Rows()), w3 = { fc: "agreed core, adaptable or not yet settled", fw: "agreed reason", fp: "agreed UNA pillars" }[parts[0]];
      if (h3 && w3) return h3.row.name + ": " + w3;
      return k;
    }
    if (def.view === "test") { var cr = pick(AG.crit, parts[1]); return (cr ? cr[1] : parts[1]) + (parts[0] === "sc" ? ": score" : ": reason"); }
    var sec = pick(sectionsFor(act, def), parts[0]);
    if (sec && parts.length === 3) {
      var col = pick(sec.cols, parts[2]);
      var rowName = /^p\d+$/.test(parts[1]) && sec.preset ? sec.preset[+parts[1].slice(1)] : sec.fixedRows ? ((pick(sec.fixedRows, parts[1]) || [])[1]) : "added row";
      return sec.title + " \u00B7 " + (rowName || "row") + " \u00B7 " + (col ? (col.short || col.label) : parts[2]);
    }
    if (sec && parts.length === 2) { var fd = pick(sec.fields, parts[1]); return sec.title + " \u00B7 " + (fd ? fd.label : parts[1]); }
    return k;
  }
  function pendingCell(act, sheet, k) { var p = S.sq && S.sq[sheetKey(act, sheet)]; return !!(p && Object.prototype.hasOwnProperty.call(p, k)); }
  function loadSheets(act) {
    return rpc("room_get_sheets", { p_code: S.code, p_session: S.session, p_activity: act }).then(function (r) {
      if (!r.ok) return r;
      S.sheetState[act] = r.state;
      r.sheets.forEach(function (sh) {
        var q = sheetKey(act, sh.sheet), mine = S.sq && S.sq[q];
        var body = applyPatch(Object.assign({}, sh.body), mine || {});   // my unsent edits win
        S.sheetData[q] = { body: body, at: sh.updated_at };
      });
      return r;
    });
  }

  // ----- inputs bound to one sheet cell -----
  function input(act, sheet, k, value, col, editable) {
    var node, q = sheetKey(act, sheet);
    if (col.type === "select" || col.type === "region") {
      var opts = col.type === "region" ? AG.regions.map(function (r) { return [r[0], r[1]]; }) : (col.options || []).map(function (o) { return [o, o]; });
      if (!editable) return el("div", { class: "cellro", text: col.type === "region" ? ((regionMin(value) || {}).name || "") : value });
      node = el("select", { "data-k": k, "data-q": q, "aria-label": col.label }, [el("option", { value: "", text: "—" })].concat(opts.map(function (o) { return el("option", { value: o[0], selected: o[0] === value, text: o[1] }); })));
      node.addEventListener("change", function () { queueCell(act, sheet, k, node.value); });
      return node;
    }
    if (col.type === "check") {
      if (!editable) return el("div", { class: "cellro", text: value ? "Yes" : "" });
      node = el("input", { type: "checkbox", "data-k": k, "data-q": q, checked: !!value, "aria-label": col.label, style: "width:22px;height:22px" });
      node.addEventListener("change", function () { queueCell(act, sheet, k, node.checked); });
      return node;
    }
    if (col.type === "multidrop") {
      var picked = Array.isArray(value) ? value.slice() : [];
      var shortOf = function (o) { return String(o).split(":")[0]; };
      if (!editable) return el("div", { class: "cellro", text: picked.join("; ") });
      var sum = el("summary", { text: picked.length ? picked.map(shortOf).join(", ") : "Choose" });
      var dd = el("details", { class: "mdrop" }, sum), list = el("div", { class: "mdlist" });
      // stays open when the sheet redraws after a save, until the person closes it
      var dk = q + "#" + k;
      if (S.openDrop === dk) dd.open = true;
      sum.addEventListener("click", function () { S.openDrop = dd.open ? null : dk; });
      col.options.forEach(function (o) {
        var cb = el("input", { type: "checkbox", checked: picked.indexOf(o) >= 0 });
        cb.addEventListener("change", function () {
          var now = Array.isArray(sheetBody(act, sheet)[k]) ? sheetBody(act, sheet)[k].slice() : picked.slice();
          var i = now.indexOf(o); if (cb.checked && i < 0) now.push(o); if (!cb.checked && i >= 0) now.splice(i, 1);
          now.sort(function (a, b) { return col.options.indexOf(a) - col.options.indexOf(b); });
          picked = now; queueCell(act, sheet, k, now);
          sum.textContent = now.length ? now.map(shortOf).join(", ") : "Choose";
        });
        list.appendChild(el("label", null, cb, el("span", { text: o })));
      });
      dd.appendChild(list);
      return dd;
    }
    if (col.type === "multi") {
      var cur = Array.isArray(value) ? value.slice() : [];
      if (!editable) return el("div", { class: "cellro", text: cur.join(", ") });
      var wrap = el("div", { class: "multi" });
      col.options.forEach(function (o) {
        var cb = el("input", { type: "checkbox", checked: cur.indexOf(o) >= 0 });
        cb.addEventListener("change", function () {
          var now = Array.isArray(sheetBody(act, sheet)[k]) ? sheetBody(act, sheet)[k].slice() : cur.slice();
          var i = now.indexOf(o); if (cb.checked && i < 0) now.push(o); if (!cb.checked && i >= 0) now.splice(i, 1);
          now.sort(function (a, b) { return col.options.indexOf(a) - col.options.indexOf(b); });
          cur = now; queueCell(act, sheet, k, now);
        });
        wrap.appendChild(el("label", { class: "mchk" }, cb, el("span", { text: o })));
      });
      return wrap;
    }
    if (!editable) return el("div", { class: "cellro", text: value == null ? "" : String(value) });
    node = el("textarea", { "data-k": k, "data-q": q, rows: "2", value: value == null ? "" : String(value), "aria-label": col.label, placeholder: col.placeholder || "" });
    // _dirty: this person typed here and it is not saved yet. Only typed text is ever saved, so a box that still
    // shows older text never writes it over what another phone saved meanwhile.
    var t; node._dirty = false;
    var commit = function () { clearTimeout(t); if (!node._dirty) return; node._dirty = false; queueCell(act, sheet, k, node.value); if (col.onSaved) col.onSaved(); };
    node.addEventListener("input", function () { if (!node._dirty) { node._dirty = true; node.classList.add("unsaved"); updateSaveBars(); } });
    // _flush is the Save button's (and the safety saves') way to save this box
    node._flush = function () { var was = node._dirty; commit(); if (was) { node.classList.remove("unsaved"); } };
    node.addEventListener("blur", function () { if (col.onBlur) col.onBlur(); });
    return node;
  }
  // a typed box for the merge pages: typing marks it unsaved; Save (or a safety save) calls onSave
  function typedBox(k, q, value, label, placeholder, onSave) {
    var t = el("textarea", { "data-k": k, "data-q": q, rows: "2", value: value == null ? "" : String(value), "aria-label": label, placeholder: placeholder || "" });
    t._dirty = false;
    t.addEventListener("input", function () { if (!t._dirty) { t._dirty = true; t.classList.add("unsaved"); updateSaveBars(); } });
    t._flush = function () { if (!t._dirty) return; t._dirty = false; t.classList.remove("unsaved"); onSave(t.value); };
    return t;
  }
  // a Copy / Use button puts its text in the box (replacing anything unsaved there) before it saves
  function fillBox(root, k, val) {
    var t = root && root.querySelector('textarea[data-k="' + k + '"]'); if (!t) return;
    t.value = Array.isArray(val) ? val.join(", ") : (val == null ? "" : String(val)); t._dirty = false; t.classList.remove("unsaved"); fitBox(t); updateSaveBars();
  }
  function regMinNode(code) {
    var m = regionMin(code); if (!m) return el("div", { class: "regmin" });
    return el("div", { class: "regmin" }, el("span", { text: "Minimum to register: " }), el("b", { text: fmtN(m.register) }), el("span", { text: " · to screen: " }), el("b", { text: fmtN(m.screen) }));
  }
  // the sections of a sheet; the Session 7 indicator sheets build theirs from what Session 6 agreed
  var IND_COLS = [
    { id: "indicator", short: "Indicator", label: "What would show that the “how” is working?" },
    { id: "calc", short: "Calculation", label: "How do we calculate or determine success? (for example, number of … divided by …)" },
    { id: "level", label: "Level where it is measured", type: "multidrop", options: AG.levels },
    { id: "source", label: "Data source" },
    { id: "use", short: "Who uses it", label: "Who uses this indicator, and to decide what?" }];
  function agreedFor(clinicSheet) { var a = sheetBody("s6_merge", "ROOM")["agreed." + clinicSheet]; return Array.isArray(a) ? a : []; }
  function sectionsFor(act, def) {
    if (def.view !== "ind") return def.sections || [];
    var secs = agreedFor(def.from).map(function (c) {
      return { id: "k" + fnv(c.key), title: c.topic, note: [["Guide question", c.q], ["Agreed how", c.how], ["Who will implement", c.who]], type: "rows", layout: "table", add: "Add another indicator", preset: [""], presetCol: "indicator", cols: IND_COLS };
    });
    secs.push({ id: "add", title: "Components the clinic adds", type: "rows", layout: "table", add: "Add a component", cols: [{ id: "component", label: "Component" }].concat(IND_COLS) });
    return secs;
  }
  // a rows section drawn as a table: one header row of column labels, one row per entry; scrolls sideways on phones
  function rowsTable(act, sheet, sec, body, editable, v) {
    var ids = rowIds(sec, body), wrap = el("div");
    var tb = el("table", { class: "restable rolegrid sheetgrid" }), hd = el("tr");
    sec.cols.forEach(function (col, i) { hd.appendChild(el("th", { class: i === 0 ? "sname" : null, text: col.label })); });
    tb.appendChild(hd);
    ids.forEach(function (rowId) {
      var tr = el("tr"), preset = /^p\d+$/.test(rowId);
      sec.cols.forEach(function (col, i) {
        var k = sec.id + "." + rowId + "." + col.id, val = cellVal(body, sec, rowId, col), td = el("td", { class: i === 0 ? "sname" : null });
        // a preset element name is a label, not an answer
        if (preset && sec.presetCol === col.id && val && body[k] == null) td.appendChild(el("b", { text: val }));
        else td.appendChild(input(act, sheet, k, val, col, editable));
        if (i === 0 && editable && sec.add && !preset) td.appendChild(el("button", { type: "button", class: "linkbtn", text: "Remove this row", onclick: function () {
          if (!confirm("Remove this row?")) return;
          queueRow(act, sheet, sec.id, "del", rowId); if (v) v.redraw();
        } }));
        tr.appendChild(td);
      });
      if (!editable && !preset && sec.cols.every(function (col) { var x = cellVal(body, sec, rowId, col); return !x || (Array.isArray(x) && !x.length); })) return;
      tb.appendChild(tr);
    });
    if (ids.length) wrap.appendChild(el("div", { class: "mscroll" }, tb));
    else wrap.appendChild(el("p", { class: "muted small", text: "No rows yet." }));
    if (editable && sec.add) wrap.appendChild(el("button", { type: "button", class: "btn ghost small", text: "+ " + sec.add, onclick: function () {
      queueRow(act, sheet, sec.id, "add", rid()); if (v) v.redraw();
    } }));
    return wrap;
  }
  function sheetView(act, def, sheet, editable, v) {
    var body = sheetBody(act, sheet), wrap = el("div", { class: "sheet" });
    if (def.showDirection) wrap.appendChild(directionBanner());
    if (def.view === "ind") {
      wrap.appendChild(refPanel());
      if (!agreedFor(def.from).length) wrap.appendChild(el("p", { class: "help", text: "No agreed components from the Session 6 plenary yet. Add components below, or wait for staff to record them." }));
    }
    sectionsFor(act, def).forEach(function (sec) {
      var box = el("section", { class: "ssec" }, el("h4", { text: sec.title }));
      if (sec.note) box.appendChild(el("div", { class: "snote" }, sec.note.filter(function (n) { return n[1]; }).map(function (n) { return el("div", null, el("span", { class: "slab", text: n[0] }), el("div", { text: n[1] })); })));
      if (sec.help) box.appendChild(el("p", { class: "help", text: sec.help }));
      if (sec.type === "rows" && sec.layout === "table") box.appendChild(rowsTable(act, sheet, sec, body, editable, v));
      else if (sec.type === "rows") {
        var ids = rowIds(sec, body);
        ids.forEach(function (rowId, i) {
          var card = el("div", { class: "srow" });
          var head = el("div", { class: "srowh" }, el("b", { text: sec.fixedRows ? sec.fixedRows[i][1] : "#" + (i + 1) }));
          if (editable && !sec.fixedRows && !/^p\d+$/.test(rowId)) head.appendChild(el("button", { type: "button", class: "linkbtn", text: "Remove", onclick: function () {
            if (!confirm("Remove this row?")) return;
            queueRow(act, sheet, sec.id, "del", rowId); if (v) v.redraw();
          } }));
          card.appendChild(head);
          var grid = el("div", { class: "sgrid" });
          sec.cols.forEach(function (col) {
            var k = sec.id + "." + rowId + "." + col.id, val = cellVal(body, sec, rowId, col);
            var isText = ["select", "region", "check", "multidrop", "multi"].indexOf(col.type) < 0;
            var f = el("label", { class: "sfield" + (col.type === "check" ? " check" : "") + (col.type === "multi" || (isText && editable) ? " wide" : "") }, el("span", { class: "slab", text: col.label }), input(act, sheet, k, val, col, editable));
            grid.appendChild(f);
            if (col.type === "region") f.appendChild(regMinNode(val));
          });
          card.appendChild(grid); box.appendChild(card);
        });
        if (!ids.length) box.appendChild(el("p", { class: "muted small", text: "No rows yet." }));
        if (editable && sec.add) box.appendChild(el("button", { type: "button", class: "btn ghost small", text: "+ " + sec.add, onclick: function () {
          queueRow(act, sheet, sec.id, "add", rid()); if (v) v.redraw();
        } }));
      } else if (sec.type === "fields") {
        sec.fields.forEach(function (fd) {
          var k = sec.id + "." + fd.id;
          box.appendChild(el("label", { class: "sfield" }, el("span", { class: "slab", text: fd.label }), input(act, sheet, k, body[k] || "", fd, editable)));
        });
      }
      wrap.appendChild(box);
    });
    return wrap;
  }
  // which view draws a sheet, and which other sheets it reads
  function depsOf(act) {
    var def = ACT[act] || {};
    return [act].concat({ test: ["s2_choose"], merge2: ["s2_choose"], merge6: ["c6_1", "c6_2", "c6_3"], merge7: ["c7_1", "c7_2", "c7_3", "s6_merge"], merge3: ["d9_models"], ind: ["s6_merge", "ref_ind"] }[def.view] || [],
      def.showDirection ? ["s2_merge"] : []);
  }
  function viewFor(act, sheet, editable, v) {
    var def = ACT[act];
    if (def.view === "start") return startList();
    if (def.view === "choose") return chooseView(sheet, editable, v);
    if (def.view === "test") return testView(sheet, editable, v);
    if (def.view === "merge2") return merge2View(editable, v);
    if (def.view === "merge6") return merge6View(editable, v);
    if (def.view === "merge7") return merge7View(editable, v);
    if (def.view === "merge3") return merge3View(editable, v);
    if (def.view === "refind" && !editable) return refPanel(true);
    return sheetView(act, def, sheet, editable, v);
  }
  function sheetLive(act, sheet, editable) {
    var live = liveView({ deps: depsOf(act), draw: function (d, v) { return viewFor(act, sheet, editable, v); } });
    if (!editable) return live;
    var wrap = el("div", { class: "savewrap" }, live);
    wrap._view = S.views[S.views.length - 1];
    wrap.appendChild(saveBar(wrap));
    return wrap;
  }
  // Save: sends every box typed in since the last save, for this sheet. Ticks and lists save at once.
  function saveBar(scope) {
    var status = el("span", { class: "savestat" });
    var btn = el("button", { type: "button", class: "btn small", text: "Save", onclick: function () {
      var boxes = [].filter.call(scope.querySelectorAll("textarea"), function (x) { return x._dirty && x._flush; });
      if (!boxes.length) { toast("Nothing new to save."); return; }
      boxes.forEach(function (x) { x._flush(); });
      if (isStaff()) { S.sqLog = S.sqLog || {}; boxes.forEach(function (x) { var q = x.getAttribute("data-q"); if (q) S.sqLog[q] = true; }); }
      clearTimeout(S.sqTimer); flushSheets();
      // the merge pages rebuild their statement and agreed lists from what was just saved
      if (scope._view && scope.querySelector(".merge")) setTimeout(scope._view.redraw, 0);
      toast(boxes.length === 1 ? "Saving 1 answer." : "Saving " + boxes.length + " answers.");
      updateSaveBars();
    } });
    var bar = el("div", { class: "savebar" }, status, btn);
    bar._scope = scope;
    setTimeout(updateSaveBars, 0);
    return bar;
  }
  function updateSaveBars() {
    [].forEach.call(document.querySelectorAll(".savebar"), function (bar) {
      var n = [].filter.call((bar._scope || document).querySelectorAll("textarea"), function (x) { return x._dirty; }).length;
      bar.classList.toggle("dirty", n > 0);
      bar.firstChild.textContent = n ? n + (n === 1 ? " box not saved yet. Press Save." : " boxes not saved yet. Press Save.") : "All typed answers are saved.";
    });
  }

  // =====================================================================================
  // SESSION 2: for each part of the new PK, a table picks Option A, B, C or D, or makes a mix from the
  // pre-work ideas (one idea per line) and its own; then who does what (stakeholders x roles).
  // Sheet cells: pk.<part> = A|B|C|D|mix · pw.<part>.<idea> = ticked · mix.<part> = own text
  //              st.<stakeholder>.<role> / .none / .rem · rows a table adds: ns._rows, ns.<row>.name|<role>|none|rem
  // =====================================================================================
  var S2 = AG.s2;
  function themeText(th) { var t = S2.themes[th]; return t ? t.name + " · " + t.n + " answers · mostly " + t.mostly : ""; }
  function ideaTag(i) { return el("span", { class: "itag", text: themeText(i.th) }); }
  // the ideas of one part, in their sub-groups, in order
  function subGroups(ideas) {
    var out = [], at = {};
    ideas.forEach(function (i) { var s = i.sub || ""; if (!(s in at)) { at[s] = out.length; out.push({ sub: s, ideas: [] }); } out[at[s]].ideas.push(i); });
    return out;
  }
  function catChoice(cat, b) {
    return { pick: String(b["pk." + cat.id] || ""), ideas: cat.ideas.filter(function (i) { return b["pw." + cat.id + "." + i.id]; }), own: clean(b["mix." + cat.id]) };
  }
  // a mix as sentences: ideas that share a sentence start are joined into one sentence; then the table's own idea
  function mixText(cat, ch) {
    var out = [], at = {}, leads = [];
    ch.ideas.forEach(function (i) { var l = i.lead || ""; if (!(l in at)) { at[l] = leads.length; leads.push({ lead: l, texts: [] }); } leads[at[l]].texts.push(i.text); });
    leads.forEach(function (g) { out.push(cap((g.lead ? g.lead + " " : "") + joinAnd(g.texts)) + "."); });
    if (ch.own) out.push("For " + cat.name.toLowerCase() + ", the table " + (out.length ? "also " : "") + "proposes: " + lowFirst(ch.own) + ".");
    return out.join(" ");
  }
  function optSentence(cat, x) { return "For " + cat.name.toLowerCase() + ", the new PK takes Option " + x + ": " + lowFirst(clean(cat.opts[x])) + "."; }
  function catLine(cat, ch) {
    if (/^[ABCD]$/.test(ch.pick)) return optSentence(cat, ch.pick);
    if (ch.pick === "mix") return mixText(cat, ch);
    return "";
  }
  // the stakeholder rows of one table: the fixed list, then the rows it added
  function stakeRows(b) {
    var rows = S2.stakes.map(function (s) { return { pre: "st." + s[0], name: s[1] }; });
    addedRows(b, "ns").forEach(function (r) { rows.push({ pre: "ns." + r, rid: r, name: clean(b["ns." + r + ".name"]), added: true }); });
    return rows;
  }
  function stakeCell(b, pre) {
    return { roles: S2.roles.filter(function (r) { return b[pre + "." + r[0]]; }).map(function (r) { return r[1]; }), none: !!b[pre + ".none"], rem: clean(b[pre + ".rem"]) };
  }
  function stakeSentences(list) {
    var out = [], first = true;
    list.forEach(function (s) {
      if (!s.name || !s.text) return;
      out.push((first ? "In each community, " + s.name : cap(s.name)) + " will " + s.text + ".");
      first = false;
    });
    return out;
  }
  // what one table chose, as a statement
  function tableStatement(b) {
    var out = S2.cats.map(function (c) { return catLine(c, catChoice(c, b)); }).filter(Boolean);
    return out.concat(stakeSentences(stakeRows(b).map(function (s) { var c = stakeCell(b, s.pre); return { name: s.name, text: joinAnd(c.roles) }; }))).join(" ");
  }
  function statementBox(title, text, empty) {
    return el("div", { class: "statement" }, el("div", { class: "slab", text: title }), el("p", { text: text || empty || "Nothing chosen yet." }));
  }
  function directionText() { return String(sheetBody("s2_merge", "ROOM").statement || ""); }
  function directionBanner() { return statementBox("The direction agreed in Session 2", directionText(), "Staff have not recorded the agreed direction yet."); }
  function otag(x) { return el("span", { class: "otag" + (x === "Mix" ? " mix" : ""), text: x }); }
  function ideaLines(ideas, each) {
    var w = el("div");
    subGroups(ideas).forEach(function (g) {
      if (g.sub) w.appendChild(el("div", { class: "subh", text: g.sub }));
      g.ideas.forEach(function (i) { w.appendChild(each(i)); });
    });
    return w;
  }
  // slide 2.1, read-only (room screen and phones): each part with A to D and its pre-work ideas
  function startList() {
    var box = el("div", { class: "startlist" });
    box.appendChild(el("p", { class: "help", text: ACT.s2_start.intro.replace(" Built into the page; nothing to enter.", "") }));
    S2.cats.forEach(function (cat) {
      var sec = el("div", { class: "phrase s2cat" }, el("b", { text: cat.name }));
      S2.options.forEach(function (o) { sec.appendChild(el("div", { class: "optline" }, otag(o[0]), el("span", { text: cat.opts[o[0]] }))); });
      var pw = el("div", { class: "pwideas" }, el("div", { class: "slab", text: "Pre-work ideas for a mix" }));
      pw.appendChild(ideaLines(cat.ideas, function (i) { return el("div", { class: "idea" }, el("span", { text: cap(i.text) }), ideaTag(i)); }));
      sec.appendChild(pw);
      box.appendChild(sec);
    });
    box.appendChild(el("div", { class: "phrase s2cat" }, el("b", { text: "Who does what" }),
      el("p", { class: "small", text: "Stakeholders: " + S2.stakes.map(function (s) { return cap(s[1]); }).join(" · ") }),
      el("p", { class: "small", text: "Roles: " + S2.roles.map(function (r) { return r[1]; }).join(" · ") + " · or no role" }),
      el("p", { class: "small muted", text: "Pre-work: " + themeText(S2.stakeBasis) }),
      el("p", { class: "small muted", text: S2.basis })));
    return box;
  }
  function chk(q, k, checked, label, disabled, onChange) {
    var cb = el("input", { type: "checkbox", "data-k": k, "data-q": q, checked: !!checked, disabled: !!disabled });
    cb.addEventListener("change", function () { onChange(cb.checked); });
    return el("label", { class: "ck" + (checked ? " sel" : "") + (disabled ? " off" : "") }, cb, el("span", null, label));
  }
  function radio(q, k, value, checked, kids, onPick) {
    var r = el("input", { type: "radio", name: q + "~" + k, value: value, "data-k": k, "data-q": q, checked: !!checked });
    r.addEventListener("change", function () { if (r.checked) onPick(); });
    return el("label", { class: "ck opt" + (checked ? " sel" : "") }, r, el("span", { class: "cktext" }, kids));
  }
  // slide 2.2: each part (an option or a mix), then who does what, then the table's statement
  function chooseView(sheet, editable, v) {
    var act = "s2_choose", q = sheetKey(act, sheet), b = sheetBody(act, sheet), box = el("div", { class: "sheet choose" });
    var redraw = function () { if (v) v.redraw(); };
    var set = function (k, val) { queueCell(act, sheet, k, val); redraw(); };
    // typing in a box updates the statement as soon as it is saved, without redrawing the boxes
    var restate = function () { var p = box.querySelector(".statement p"); if (p) p.textContent = tableStatement(sheetBody(act, sheet)) || "Nothing chosen yet."; };
    if (editable) box.appendChild(el("p", { class: "help", text: S2.basis }));
    S2.cats.forEach(function (cat) {
      var ch = catChoice(cat, b), sec = el("div", { class: "phrase s2cat" }, el("b", { text: cat.name }));
      if (!editable) {
        var line = catLine(cat, ch);
        sec.appendChild(el("p", { class: line ? "" : "muted", text: line || "Not chosen." }));
        box.appendChild(sec); return;
      }
      var k = "pk." + cat.id;
      S2.options.forEach(function (o) {
        sec.appendChild(radio(q, k, o[0], ch.pick === o[0], [otag(o[0]), el("span", { text: cat.opts[o[0]] })], function () { set(k, o[0]); }));
      });
      sec.appendChild(radio(q, k, "mix", ch.pick === "mix", [otag("Mix"), el("span", { text: "A mix: choose from the pre-work ideas, and add your own" })], function () { set(k, "mix"); }));
      if (ch.pick === "mix") {
        var mx = el("div", { class: "mixbox" });
        mx.appendChild(ideaLines(cat.ideas, function (i) {
          var ik = "pw." + cat.id + "." + i.id;
          return chk(q, ik, b[ik], [el("span", { text: cap(i.text) }), ideaTag(i)], false, function (on) { set(ik, on); });
        }));
        mx.appendChild(el("label", { class: "sfield" }, el("span", { class: "slab", text: "Add your own" }),
          input(act, sheet, "mix." + cat.id, b["mix." + cat.id] || "", { label: cat.name + ": your own idea", placeholder: "Your table's own idea for " + cat.name.toLowerCase(), onSaved: restate, onBlur: redraw }, true)));
        sec.appendChild(mx);
      }
      box.appendChild(sec);
    });
    box.appendChild(stakeGrid(act, sheet, editable, redraw, restate));
    var stmt = statementBox(SHEET_NAMES[sheet] + (editable ? ": your direction" : ": the table's direction"), tableStatement(b));
    // read-only (presented on the screen): the statement first, then what was chosen
    if (editable) box.appendChild(stmt); else box.insertBefore(stmt, box.firstChild);
    return box;
  }
  // who does what: stakeholders as rows, the roles as columns, plus No role and Remarks
  function stakeGrid(act, sheet, editable, redraw, restate) {
    var q = sheetKey(act, sheet), b = sheetBody(act, sheet);
    var wrap = el("div", { class: "phrase s2cat" }, el("b", { text: "Who does what" }));
    if (editable) wrap.appendChild(el("p", { class: "help", text: "Tick every role each stakeholder will have, or No role. Add a remark where needed. Add any stakeholder that is missing. (Pre-work: " + themeText(S2.stakeBasis) + ".)" }));
    var tb = el("table", { class: "restable rolegrid" }), hd = el("tr", null, el("th", { class: "sname", text: "Stakeholder" }));
    S2.roles.forEach(function (r) { hd.appendChild(el("th", { class: "n", text: cap(r[1]) })); });
    hd.appendChild(el("th", { class: "n", text: "No role" })); hd.appendChild(el("th", { class: "rem", text: "Remarks" }));
    tb.appendChild(hd);
    var shown = 0;
    stakeRows(b).forEach(function (s) {
      var c = stakeCell(b, s.pre);
      if (!editable && !c.roles.length && !c.none && !c.rem) return;
      shown++;
      var tr = el("tr"), nm = el("td", { class: "sname" });
      if (s.added && editable) {
        nm.appendChild(input(act, sheet, s.pre + ".name", b[s.pre + ".name"] || "", { label: "Other stakeholder", placeholder: "Other (specify)", onSaved: restate, onBlur: redraw }, true));
        nm.appendChild(el("button", { type: "button", class: "linkbtn", text: "Remove", onclick: function () { queueRow(act, sheet, "ns", "del", s.rid); redraw(); } }));
      } else nm.appendChild(el("span", { text: s.added ? cap(s.name || "Other") + " (added)" : cap(s.name) }));
      tr.appendChild(nm);
      S2.roles.forEach(function (r) {
        var k = s.pre + "." + r[0], td = el("td", { class: "n" });
        if (editable) {
          var cb = el("input", { type: "checkbox", "data-k": k, "data-q": q, checked: c.roles.indexOf(r[1]) >= 0, disabled: c.none,
            title: c.none ? "Untick No role to choose roles" : null, "aria-label": cap(s.name || "Other") + ": " + r[1] + (c.none ? " (untick No role to choose roles)" : "") });
          cb.addEventListener("change", function () { queueCell(act, sheet, k, cb.checked); redraw(); });
          if (c.none) td.className = "n off";
          td.appendChild(cb);
        } else td.textContent = c.roles.indexOf(r[1]) >= 0 ? "✓" : "";
        tr.appendChild(td);
      });
      var nk = s.pre + ".none", ntd = el("td", { class: "n none" });
      if (editable) {
        var nb = el("input", { type: "checkbox", "data-k": nk, "data-q": q, checked: c.none, "aria-label": cap(s.name || "Other") + ": no role" });
        nb.addEventListener("change", function () {
          queueCell(act, sheet, nk, nb.checked);
          if (nb.checked) S2.roles.forEach(function (r) { if (sheetBody(act, sheet)[s.pre + "." + r[0]]) queueCell(act, sheet, s.pre + "." + r[0], false); });
          redraw();
        });
        ntd.appendChild(nb);
      } else ntd.textContent = c.none ? "✓" : "";
      tr.appendChild(ntd);
      tr.appendChild(el("td", { class: "rem" }, input(act, sheet, s.pre + ".rem", b[s.pre + ".rem"] || "", { label: "Remarks", placeholder: "Remarks" }, editable)));
      tb.appendChild(tr);
    });
    if (shown) wrap.appendChild(el("div", { class: "mscroll" }, tb));
    else wrap.appendChild(el("p", { class: "muted", text: "No roles marked." }));
    if (editable) wrap.appendChild(el("button", { type: "button", class: "btn ghost small", text: "+ Other (specify)", onclick: function () { queueRow(act, sheet, "ns", "add", rid()); redraw(); } }));
    return wrap;
  }
  // slide 2.3: the table's direction on top, then a score and reason for each of the eight questions
  function weightsCarried() {
    var w = setting("d2_weights"), out = {}, any = false;
    AG.crit.forEach(function (c) { var n = w && +w[c[0]]; if (n > 0) { out[c[0]] = n; any = true; } });
    return any ? out : null;
  }
  function testTotals(b) {
    var carried = weightsCarried(), sumE = 0, nE = 0, sumC = 0, wC = 0;
    AG.crit.forEach(function (c) {
      var s = +b["sc." + c[0]]; if (!s) return;
      sumE += s; nE += 1;
      if (carried && carried[c[0]]) { sumC += s * carried[c[0]]; wC += carried[c[0]]; }
    });
    return { equal: nE ? sumE / nE : null, carried: wC ? sumC / wC : null, scored: nE, hasW: !!carried };
  }
  function testView(sheet, editable, v) {
    var act = "s2_test", b = sheetBody(act, sheet), box = el("div", { class: "sheet" });
    box.appendChild(statementBox(SHEET_NAMES[sheet] + ": the direction you are scoring", tableStatement(sheetBody("s2_choose", sheet)), "This table did not choose anything on slide 2.2."));
    AG.crit.forEach(function (c) {
      var ks = "sc." + c[0], kr = "re." + c[0];
      var sel = input(act, sheet, ks, b[ks] || "", { type: "select", options: ["1", "2", "3", "4", "5"], label: c[1] + ": score" }, editable);
      if (editable) sel.addEventListener("change", function () { if (v) setTimeout(v.redraw, 0); });
      box.appendChild(el("div", { class: "srow" }, el("div", { class: "srowh" }, el("b", { text: c[1] })),
        el("div", { class: "mline2" }, el("label", { class: "sfield" }, el("span", { class: "slab", text: "Score (1 to 5)" }), sel),
          el("label", { class: "sfield" }, el("span", { class: "slab", text: "Reason" }), input(act, sheet, kr, b[kr] || "", { label: c[1] + ": reason" }, editable)))));
    });
    var t = testTotals(b);
    box.appendChild(el("div", { class: "statement" }, el("div", { class: "slab", text: "Weighted total (1 to 5)" }),
      el("p", null, t.hasW ? el("b", { text: (t.carried != null ? t.carried.toFixed(2) : "—") + " with the Session 1 weights" }) : null, t.hasW ? " · " : null,
        el("span", { text: (t.equal != null ? t.equal.toFixed(2) : "—") + " with equal weights" }), " · ", el("span", { class: "muted", text: t.scored + " of 8 scored" }))));
    return box;
  }
  // ----- the merge (staff): per part, what each table chose; a table's mix becomes an option once slide 2.2 has closed -----
  function chooseClosed() { return actState("s2_choose") !== "open"; }
  function tableBodies() { var tb = {}; TABLES.forEach(function (t) { tb[t] = sheetBody("s2_choose", t); }); return tb; }
  function mergeStakes(tb) {
    var rows = S2.stakes.map(function (s) { return { key: "st." + s[0], name: s[1], per: TABLES.map(function (t) { return stakeCell(tb[t], "st." + s[0]); }) }; });
    TABLES.forEach(function (t) {
      addedRows(tb[t], "ns").forEach(function (r) {
        var n = clean(tb[t]["ns." + r + ".name"]); if (!n) return;
        rows.push({ key: "ns." + t + "." + r, name: n, by: t, per: TABLES.map(function (x) { return x === t ? stakeCell(tb[t], "ns." + r) : null; }) });
      });
    });
    return rows;
  }
  function mergeStatement(mb) {
    var out = [];
    S2.cats.forEach(function (c) { var f = String(mb["f.cat." + c.id] || "").trim(); if (f) out.push(/[.!?]$/.test(f) ? f : f + "."); });
    return out.concat(stakeSentences(mergeStakes(tableBodies()).map(function (s) { return { name: s.name, text: clean(mb["f." + s.key]) }; }))).join(" ");
  }
  function merge2View(editable, v) {
    var mb = sheetBody("s2_merge", "ROOM"), q = sheetKey("s2_merge", "ROOM"), tb = tableBodies(), closed = chooseClosed(), box = el("div", { class: "merge" });
    function saveFinal(k, val) {
      queueCell("s2_merge", "ROOM", k, val);
      var text = mergeStatement(sheetBody("s2_merge", "ROOM"));
      queueCell("s2_merge", "ROOM", "statement", text);
      var p = box.querySelector(".merge > .statement p"); if (p) p.textContent = text || "Nothing chosen yet.";
    }
    function finalBox(k, label, placeholder) {
      var fv = mb[k] || "";
      if (!editable) return el("div", { class: "finalro" + (clean(fv) ? "" : " muted"), text: clean(fv) || "Not agreed yet." });
      return typedBox(k, q, fv, label, placeholder, function (val) { saveFinal(k, val); });
    }
    function useBtn(k, text, label) { return el("button", { type: "button", class: "linkbtn", text: label || "Use this", onclick: function () { fillBox(box, k, text); saveFinal(k, text); if (v) v.redraw(); } }); }
    function pollBox(key, question, opts) {
      var w = el("div");
      if (!editable) return w;
      w.appendChild(el("button", { type: "button", class: "linkbtn", text: "Push to poll", onclick: function () { S.pollDraft = key; if (v) v.redraw(); } }));
      if (S.pollDraft === key) w.appendChild(pollDraftForm(question, opts.slice(0, 5), v));
      return w;
    }
    S2.cats.forEach(function (cat) {
      var fk = "f.cat." + cat.id, blk = el("section", { class: "mblock" }, el("h4", { text: cat.name }));
      var choices = TABLES.map(function (t) { return catChoice(cat, tb[t]); }), pollOpts = [];
      var t = el("table", { class: "restable mtable" }), head = el("tr", null, el("th", { text: "Choice" }));
      TABLES.forEach(function (x) { head.appendChild(el("th", { class: "n", text: SHEET_NAMES[x] })); });
      head.appendChild(el("th", { class: "n", text: "Tables" }));
      t.appendChild(head);
      function row(kids, ticks, useText) {
        var tr = el("tr", null, el("td", null, kids, editable && useText ? el("div", null, useBtn(fk, useText)) : null)), n = 0;
        ticks.forEach(function (on) { if (on) n++; tr.appendChild(el("td", { class: "n", text: on ? "✓" : "" })); });
        tr.appendChild(el("td", { class: "n", text: String(n) }));
        t.appendChild(tr);
        return n;
      }
      S2.options.forEach(function (o) {
        var n = row([otag(o[0]), " ", el("span", { text: cat.opts[o[0]] })], choices.map(function (c) { return c.pick === o[0]; }), optSentence(cat, o[0]));
        if (n) pollOpts.push("Option " + o[0]);
      });
      var mixing = 0;
      TABLES.forEach(function (x, i) {
        var c = choices[i]; if (c.pick !== "mix") return;
        mixing++;
        if (!closed) return;
        var mt = mixText(cat, c); if (!mt) return;
        row([otag("Mix"), " ", el("b", { text: SHEET_NAMES[x] + "'s mix. " }), el("span", { text: mt })], TABLES.map(function (y) { return y === x; }), mt);
        pollOpts.push(SHEET_NAMES[x] + "'s mix");
      });
      if (!closed && mixing) t.appendChild(el("tr", { class: "mhead" }, el("td", { colspan: String(TABLES.length + 2), class: "muted small", text: "Tables are still choosing. Each table's mix appears here as an option when the slide moves on." })));
      blk.appendChild(el("div", { class: "mscroll" }, t));
      if (closed && mixing) {
        var tally = cat.ideas.map(function (i) { var n = choices.filter(function (c) { return c.pick === "mix" && c.ideas.indexOf(i) >= 0; }).length; return n ? cap(i.text) + " (" + n + ")" : ""; }).filter(Boolean);
        if (tally.length) blk.appendChild(el("p", { class: "muted small", text: "Pre-work ideas in the tables' mixes: " + tally.join(" · ") }));
      }
      blk.appendChild(el("div", { class: "final" }, el("span", { class: "slab", text: "Final agreed: " + cat.name }),
        finalBox(fk, "Final agreed: " + cat.name, "Press Use this on a row above, or type a combined version as full sentences"),
        pollBox("c_" + cat.id, "Which should the one direction take for " + cat.name.toLowerCase() + "?", pollOpts.length >= 2 ? pollOpts : ["Option A", "Option B", "Option C", "Option D"])));
      box.appendChild(blk);
    });
    // who does what
    var srows = mergeStakes(tb), sb = el("section", { class: "mblock" }, el("h4", { text: "Who does what" }));
    var st = el("table", { class: "restable mtable" }), sh = el("tr", null, el("th", { text: "Stakeholder" }));
    TABLES.forEach(function (x) { sh.appendChild(el("th", { text: SHEET_NAMES[x] })); });
    sh.appendChild(el("th", { class: "final", text: "Final agreed roles" }));
    st.appendChild(sh);
    var any = 0;
    srows.forEach(function (r) {
      var used = r.per.some(function (c) { return c && (c.roles.length || c.none || c.rem); });
      if (!used && !editable) return;
      any++;
      var tr = el("tr", null, el("td", null, el("div", { text: cap(r.name) }), r.by ? el("div", { class: "muted small", text: "added by " + SHEET_NAMES[r.by] }) : null));
      r.per.forEach(function (c) {
        tr.appendChild(el("td", { class: "small" }, !c ? "—" : (c.roles.length ? joinAnd(c.roles) : (c.none ? "No role" : "—")), c && c.rem ? el("div", { class: "muted", text: "Remark: " + c.rem }) : null));
      });
      var fin = el("td", { class: "final" }, finalBox("f." + r.key, "Final agreed roles: " + r.name, "Agreed roles, e.g. plan, lead and fund"));
      if (editable) {
        var acts = el("div", { class: "row tight" });
        TABLES.forEach(function (x, i) { var c = r.per[i]; if (c && c.roles.length) acts.appendChild(useBtn("f." + r.key, joinAnd(c.roles), "Copy " + SHEET_NAMES[x])); });
        var distinct = []; r.per.forEach(function (c) { if (c && c.roles.length && distinct.indexOf(joinAnd(c.roles)) < 0) distinct.push(joinAnd(c.roles)); });
        acts.appendChild(pollBox("s_" + r.key, cap(r.name) + " will …?", distinct.concat(["No role"])));
        fin.appendChild(acts);
      }
      tr.appendChild(fin);
      st.appendChild(tr);
    });
    sb.appendChild(any ? el("div", { class: "mscroll" }, st) : el("p", { class: "muted", text: "No roles marked yet." }));
    box.appendChild(sb);
    box.appendChild(statementBox("The one direction (from the final agreed boxes)", String(mb.statement || mergeStatement(mb))));
    if (editable) box.appendChild(el("div", { class: "row tight", style: "margin-top:10px" }, el("button", { type: "button", class: "btn ghost small", text: "Start the agreement check (only if needed)", onclick: function () { goTo("s2_4"); } })));
    return box;
  }
  // a small form to start a quick vote from a merge row; staff can change the question and options first
  function pollDraftForm(question, options, v) {
    var f = el("div", { class: "pdraft" }), qi = el("textarea", { rows: "2", value: question, "aria-label": "Question" });
    var opts = [0, 1, 2, 3, 4].map(function (i) { return el("input", { type: "text", value: options[i] || "", "aria-label": "Option " + (i + 1), placeholder: "Option " + (i + 1) + (i > 1 ? " (optional)" : "") }); });
    var ballot = el("input", { type: "checkbox", style: "width:20px;height:20px" }), out = el("div");
    f.appendChild(el("span", { class: "slab", text: "Question" })); f.appendChild(qi);
    f.appendChild(el("span", { class: "slab", text: "Options (2 to 5)" })); opts.forEach(function (o) { f.appendChild(o); });
    f.appendChild(el("label", { class: "row tight", style: "margin:6px 0" }, ballot, el("span", { text: "Anonymous ballot (totals only)" })));
    f.appendChild(el("div", { class: "row tight" },
      el("button", { type: "button", class: "btn small", text: "Start the vote", onclick: function () {
        var o = opts.map(function (x) { return x.value.trim(); }).filter(function (x) { return x; });
        if (!qi.value.trim() || o.length < 2) { msg(out, "Write a question and at least two options.", "err"); return; }
        S.pollDraft = null; createQuick(qi.value.trim(), o, ballot.checked);
      } }),
      el("button", { type: "button", class: "btn ghost small", text: "Cancel", onclick: function () { S.pollDraft = null; if (v) v.redraw(); else renderStaff(true); } })));
    f.appendChild(out);
    return f;
  }

  // =====================================================================================
  // SESSION 6 MERGE AND SESSION 7 REFERENCE
  // =====================================================================================
  function clinicRows(n) {
    var act = "c6_" + n, def = ACT[act], sh = def.sheets[0], b = sheetBody(act, sh), rows = [];
    def.sections.forEach(function (sec) {
      rowIds(sec, b).forEach(function (r, i) {
        var topic = sec.fixedRows ? sec.title : clean(b[sec.id + "." + r + ".topic"]) || "Added by the clinic";
        var qtext = sec.fixedRows ? sec.fixedRows[i][1] : clean(b[sec.id + "." + r + ".topic"]);
        rows.push({ key: sh + "_" + sec.id + "_" + r, topic: topic, q: qtext, how: clean(b[sec.id + "." + r + ".how"]), decide: clean(b[sec.id + "." + r + ".decide"]), who: clean(b[sec.id + "." + r + ".who"]), added: !sec.fixedRows });
      });
    });
    return { sheet: sh, title: def.title, rows: rows };
  }
  function agreedList(c, mb) {
    return c.rows.map(function (r) { return { key: r.key, topic: r.topic, q: r.q, how: clean(mb["fh." + r.key]), who: clean(mb["fw." + r.key]) }; }).filter(function (x) { return x.how; });
  }
  function merge6View(editable, v) {
    var mb = sheetBody("s6_merge", "ROOM"), q = sheetKey("s6_merge", "ROOM"), box = el("div", { class: "merge" });
    [1, 2, 3].forEach(function (n) {
      var c = clinicRows(n), sec = el("section", { class: "ssec" }, el("h4", { text: c.title }));
      function save(k, val) {
        queueCell("s6_merge", "ROOM", k, val);
        queueCell("s6_merge", "ROOM", "agreed." + c.sheet, agreedList(c, sheetBody("s6_merge", "ROOM")));
      }
      if (editable) {
        var tb = el("table", { class: "restable mtable" }, el("tr", null, el("th", { text: "Guide question" }), el("th", { text: "The clinic's answer" }), el("th", { text: "Agreed how" }), el("th", { text: "Agreed: who will implement" })));
        var lastT = null;
        c.rows.forEach(function (r) {
          if (!r.added && r.topic !== lastT) { tb.appendChild(el("tr", { class: "mhead" }, el("td", { colspan: "4" }, el("b", { text: r.topic })))); lastT = r.topic; }
          if (r.added && !r.how && !r.q) return;
          var hk = "fh." + r.key, wk = "fw." + r.key;
          function ta(k, label) {
            return typedBox(k, q, mb[k] || "", label, "", function (val) { save(k, val); });
          }
          var ans = el("td", { class: "small" }, r.how ? el("div", null, el("b", { text: "How: " }), r.how) : el("div", { class: "muted", text: "No answer" }),
            r.decide ? el("div", null, el("b", { text: "Still to decide: " }), r.decide) : null, r.who ? el("div", null, el("b", { text: "Who: " }), r.who) : null);
          // each agreed column has its own Copy and Push to poll
          function finCol(k, label, copyText, copyLabel, pollKey, pollQ) {
            var td = el("td", { class: "final" }, ta(k, label), el("div", { class: "row tight" },
              copyText ? el("button", { type: "button", class: "linkbtn", text: copyLabel, onclick: function () { fillBox(box, k, copyText); save(k, copyText); if (v) v.redraw(); } }) : null,
              el("button", { type: "button", class: "linkbtn", text: "Push to poll", onclick: function () { S.pollDraft = pollKey; if (v) v.redraw(); } })));
            if (S.pollDraft === pollKey) td.appendChild(pollDraftForm(pollQ(), ["Agree", "Change it", "Leave out"], v));
            return td;
          }
          var mbNow = function () { return sheetBody("s6_merge", "ROOM"); };
          var finH = finCol(hk, "Agreed how", r.how, "Copy the how", r.key + "~h", function () { return "Agree: " + (clean(mbNow()[hk]) || r.how || r.q) + "?"; });
          var finW = finCol(wk, "Agreed: who will implement", r.who, "Copy the who", r.key + "~w", function () { return "Agree that " + (clean(mbNow()[wk]) || r.who || "\u2026") + " will implement this: " + (clean(mbNow()[hk]) || r.q || r.topic) + "?"; });
          tb.appendChild(el("tr", null, el("td", { class: "small" }, r.added ? el("span", { class: "muted", text: "Added: " }) : null, r.q || ""), ans, finH, finW));
        });
        sec.appendChild(el("div", { class: "mscroll" }, tb));
      }
      var ag = agreedList(c, mb);
      sec.appendChild(el("div", { class: "statement" }, el("div", { class: "slab", text: c.title.split(":")[0] + ": agreed components" }),
        ag.length ? el("ol", null, ag.map(function (a) { return el("li", null, el("b", { text: a.topic + ": " }), a.how, a.who ? el("span", { class: "muted", text: " (who: " + a.who + ")" }) : null); })) : el("p", { class: "muted", text: "None recorded yet." })));
      box.appendChild(sec);
    });
    return box;
  }
  // ----- 7.2: the indicators each clinic proposed, and what the plenary agreed -----
  function indRows(n) {
    var act = "c7_" + n, def = ACT[act], sh = def.sheets[0], b = sheetBody(act, sh), rows = [];
    sectionsFor(act, def).forEach(function (sec) {
      rowIds(sec, b).forEach(function (r) {
        var g = function (id) { var x = cellVal(b, sec, r, { id: id }); return Array.isArray(x) ? x.join(", ") : clean(x); };
        var row = { key: sh + "_" + sec.id + "_" + r, comp: sec.id === "add" ? (g("component") || "Added by the clinic") : sec.title,
          ind: g("indicator"), calc: g("calc"), level: g("level"), source: g("source"), use: g("use") };
        if (row.ind || row.calc) rows.push(row);
      });
    });
    return { sheet: sh, title: def.title, rows: rows };
  }
  function agreedInd(c, mb) {
    return c.rows.map(function (r) { return { comp: r.comp, ind: clean(mb["fi." + r.key]), calc: clean(mb["fc." + r.key]), lsu: clean(mb["fl." + r.key]) }; }).filter(function (x) { return x.ind; });
  }
  function agreedIndBox(c, ag) {
    return el("div", { class: "statement" }, el("div", { class: "slab", text: c.title.split(":")[0] + ": agreed indicators" }),
      ag.length ? el("ol", null, ag.map(function (a) { return el("li", null, el("b", { text: a.comp + ": " }), a.ind, a.calc ? el("span", { class: "muted", text: " (" + a.calc + ")" }) : null, a.lsu ? el("div", { class: "muted small", text: a.lsu }) : null); }))
        : el("p", { class: "muted", text: "None recorded yet." }));
  }
  function merge7View(editable, v) {
    var mb = sheetBody("s7_merge", "ROOM"), q = sheetKey("s7_merge", "ROOM"), box = el("div", { class: "merge" });
    [1, 2, 3].forEach(function (n) {
      var c = indRows(n), sec = el("section", { class: "mblock" }, el("h4", { text: c.title }));
      function save(k, val) { queueCell("s7_merge", "ROOM", k, val); }
      if (!c.rows.length) { sec.appendChild(el("p", { class: "muted", text: "No indicators from this clinic yet." })); box.appendChild(sec); return; }
      var tb = el("table", { class: "restable mtable flat" }), hd = el("tr");
      ["Component", "Indicator", "Calculation", "Level", "Data source", "Who uses it"].forEach(function (h) { hd.appendChild(el("th", { text: h })); });
      ["Agreed indicator", "Agreed calculation", "Agreed level, data source and user"].forEach(function (h) { hd.appendChild(el("th", { class: "final", text: h })); });
      tb.appendChild(hd);
      var now = function (k, dflt) { return clean(sheetBody("s7_merge", "ROOM")[k]) || dflt; };
      c.rows.forEach(function (r, i) {
        var lsu = [r.level ? "Level: " + r.level : "", r.source ? "Source: " + r.source : "", r.use ? "Used by: " + r.use : ""].filter(Boolean).join(". ");
        function col(k, label, copyText, pollKey, pollQ) {
          var td = el("td", { class: "final" });
          if (!editable) { td.appendChild(el("div", { class: "finalro" + (clean(mb[k]) ? "" : " muted"), text: clean(mb[k]) || "\u2014" })); return td; }
          td.appendChild(typedBox(k, q, mb[k] || "", label, "", function (val) { save(k, val); }));
          td.appendChild(el("div", { class: "row tight" },
            copyText ? el("button", { type: "button", class: "linkbtn", text: "Copy", onclick: function () { fillBox(box, k, copyText); save(k, copyText); if (v) v.redraw(); } }) : null,
            el("button", { type: "button", class: "linkbtn", text: "Push to poll", onclick: function () { S.pollDraft = pollKey; if (v) v.redraw(); } })));
          if (S.pollDraft === pollKey) td.appendChild(pollDraftForm(pollQ(), ["Agree", "Change it", "Leave out"], v));
          return td;
        }
        var first = i === 0 || c.rows[i - 1].comp !== r.comp;
        tb.appendChild(el("tr", { class: first ? "newcomp" : null },
          el("td", { class: "small" }, first ? el("b", { text: r.comp }) : el("span", { class: "muted", text: "\u2033" })),
          el("td", { class: "small", text: r.ind || "\u2014" }), el("td", { class: "small", text: r.calc || "\u2014" }), el("td", { class: "small", text: r.level || "\u2014" }),
          el("td", { class: "small", text: r.source || "\u2014" }), el("td", { class: "small", text: r.use || "\u2014" }),
          col("fi." + r.key, "Agreed indicator", r.ind, r.key + "~i", function () { return "Agree on this indicator for " + lowFirst(r.comp) + ": " + now("fi." + r.key, r.ind) + "?"; }),
          col("fc." + r.key, "Agreed calculation", r.calc, r.key + "~c", function () { return "Agree on this calculation: " + now("fc." + r.key, r.calc || "\u2026") + "?"; }),
          col("fl." + r.key, "Agreed level, data source and user", lsu, r.key + "~l", function () { return "Agree: " + now("fl." + r.key, lsu || "\u2026") + "?"; })));
      });
      sec.appendChild(el("div", { class: "mscroll" }, tb));
      sec.appendChild(agreedIndBox(c, agreedInd(c, mb)));
      box.appendChild(sec);
    });
    return box;
  }
  // ----- 3.4: what the tables said about each D9 element, and what the plenary agreed -----
  var D9_CLASSES = ["Core", "Adaptable", "Not yet settled"];
  function d9Rows() {
    var def = ACT.d9_models, bodies = {}, out = [];
    TABLES.forEach(function (t) { bodies[t] = sheetBody("d9_models", t); });
    def.sections.forEach(function (sec) {
      var rows = (sec.preset || []).map(function (name, i) { return { key: sec.id + "_p" + i, rid: "p" + i, name: name }; });
      TABLES.forEach(function (t) {
        addedRows(bodies[t], sec.id).forEach(function (r) {
          var name = clean(bodies[t][sec.id + "." + r + ".element"]); if (!name) return;
          rows.push({ key: sec.id + "_" + t + "_" + r, rid: r, name: name, by: t });
        });
      });
      rows.forEach(function (row) {
        row.per = TABLES.map(function (t) {
          if (row.by && row.by !== t) return null;
          var b = bodies[t], pre = sec.id + "." + row.rid + ".", u = b[pre + "una"];
          return { cls: clean(b[pre + "class"]), why: clean(b[pre + "why"]), una: Array.isArray(u) ? u : [], rem: clean(b[pre + "rem"]) };
        });
      });
      out.push({ id: sec.id, title: sec.title, rows: rows });
    });
    return out;
  }
  function pillarShort(list) { return (list || []).map(function (x) { return String(x).split(":")[0]; }).join(", "); }
  function d9Agreed(mb) {
    var groups = {}; D9_CLASSES.forEach(function (c) { groups[c] = []; });
    d9Rows().forEach(function (a) { a.rows.forEach(function (r) {
      var c = mb["fc." + r.key]; if (!groups[c]) return;
      groups[c].push({ area: a.title, name: r.name, why: clean(mb["fw." + r.key]), una: pillarShort(mb["fp." + r.key]) });
    }); });
    return groups;
  }
  function d9AgreedBox(mb) {
    var g = d9Agreed(mb), w = el("div");
    [["Core", "Core: the same everywhere"], ["Adaptable", "Adaptable: may vary locally, within limits"], ["Not yet settled", "Not yet settled: to the Day 2 clinics"]].forEach(function (x) {
      var list = g[x[0]];
      w.appendChild(el("div", { class: "statement" }, el("div", { class: "slab", text: x[1] }),
        list.length ? el("ol", null, list.map(function (a) { return el("li", null, el("b", { text: a.name }), el("span", { class: "muted", text: " (" + a.area + ")" }), a.why ? ": " + a.why : "", a.una ? el("div", { class: "muted small", text: "UNA: " + a.una }) : null); }))
          : el("p", { class: "muted", text: "None recorded yet." })));
    });
    return w;
  }
  function merge3View(editable, v) {
    var mb = sheetBody("s3_merge", "ROOM"), q = sheetKey("s3_merge", "ROOM"), box = el("div", { class: "merge" });
    var save = function (k, val) { queueCell("s3_merge", "ROOM", k, val); };
    d9Rows().forEach(function (area) {
      var sec = el("section", { class: "mblock" }, el("h4", { text: area.title }));
      var tb = el("table", { class: "restable mtable flat" }), hd = el("tr", null, el("th", { text: "Element" }));
      TABLES.forEach(function (t) { hd.appendChild(el("th", { text: SHEET_NAMES[t] })); });
      ["Agreed: core, adaptable or not yet settled", "Agreed: why, or what may vary and within what limits", "Agreed UNA pillar(s)"].forEach(function (h) { hd.appendChild(el("th", { class: "final", text: h })); });
      tb.appendChild(hd);
      var shown = 0;
      area.rows.forEach(function (r) {
        var used = r.per.some(function (c) { return c && (c.cls || c.why || c.una.length || c.rem); });
        if (!editable && !used && !mb["fc." + r.key]) return;
        shown++;
        var tr = el("tr", null, el("td", null, el("b", { text: r.name }), r.by ? el("div", { class: "muted small", text: "added by " + SHEET_NAMES[r.by] }) : null));
        r.per.forEach(function (c) {
          tr.appendChild(el("td", { class: "small" }, !c ? "\u2014" : [
            c.cls ? el("div", null, el("b", { text: c.cls })) : el("div", { class: "muted", text: "\u2014" }),
            c.why ? el("div", { text: c.why }) : null,
            c.una.length ? el("div", { class: "muted", text: "UNA: " + pillarShort(c.una) }) : null,
            c.rem ? el("div", { class: "muted", text: "Remark: " + c.rem }) : null]));
        });
        function actions(k, copies, pollKey, pollQ, pollOpts) {
          var d = el("div", { class: "row tight" });
          copies.forEach(function (cp) { d.appendChild(el("button", { type: "button", class: "linkbtn", text: cp[0], onclick: function () {
            // fill the box first, so the redraw does not save its old text back
            fillBox(box, k, cp[1]);
            save(k, cp[1]); if (v) v.redraw();
          } })); });
          d.appendChild(el("button", { type: "button", class: "linkbtn", text: "Push to poll", onclick: function () { S.pollDraft = pollKey; if (v) v.redraw(); } }));
          var w = el("div", null, d);
          if (S.pollDraft === pollKey) w.appendChild(pollDraftForm(pollQ(), pollOpts, v));
          return w;
        }
        var ck = "fc." + r.key, wk = "fw." + r.key, pk = "fp." + r.key;
        var tdC = el("td", { class: "final" }, input("s3_merge", "ROOM", ck, mb[ck] || "", { type: "select", options: D9_CLASSES, label: "Agreed: " + r.name }, editable));
        var tdW = el("td", { class: "final" }, input("s3_merge", "ROOM", wk, mb[wk] || "", { label: "Agreed reason: " + r.name }, editable));
        var tdP = el("td", { class: "final" }, input("s3_merge", "ROOM", pk, mb[pk] || [], { type: "multidrop", options: AG.pillars, label: "Agreed UNA pillars: " + r.name }, editable));
        if (editable) {
          var sel = tdC.querySelector("select"); if (sel) sel.addEventListener("change", function () { if (v) setTimeout(v.redraw, 0); });
          tdC.appendChild(actions(ck, [], r.key + "~c", function () { return "Is \u201c" + r.name + "\u201d core, adaptable or not yet settled?"; }, D9_CLASSES));
          tdW.appendChild(actions(wk, TABLES.map(function (t, i) { var c = r.per[i]; return c && c.why ? ["Copy " + SHEET_NAMES[t], c.why] : null; }).filter(Boolean), r.key + "~w",
            function () { return "Agree for \u201c" + r.name + "\u201d: " + (clean(sheetBody("s3_merge", "ROOM")[wk]) || "\u2026") + "?"; }, ["Agree", "Change it", "Leave out"]));
          tdP.appendChild(actions(pk, TABLES.map(function (t, i) { var c = r.per[i]; return c && c.una.length ? ["Copy " + SHEET_NAMES[t], c.una] : null; }).filter(Boolean), r.key + "~p",
            function () { return "Which UNA pillar does \u201c" + r.name + "\u201d serve?"; }, AG.pillars.map(function (x) { return String(x).split(":")[0]; })));
        }
        tr.appendChild(tdC); tr.appendChild(tdW); tr.appendChild(tdP);
        tb.appendChild(tr);
      });
      if (!shown) sec.appendChild(el("p", { class: "muted", text: "No answers in this area yet." }));
      else sec.appendChild(el("div", { class: "mscroll" }, tb));
      box.appendChild(sec);
    });
    box.appendChild(el("h4", { text: "What the plenary agreed" }));
    box.appendChild(d9AgreedBox(mb));
    return box;
  }
  function refPanel(open) {
    var b = sheetBody("ref_ind", "ROOM"), secs = ACT.ref_ind.sections;
    var parts = secs.map(function (sec) {
      var items = rowIds(sec, b).map(function (r) { return { t: clean(b[sec.id + "." + r + ".text"]), n: clean(b[sec.id + "." + r + ".n"]) }; }).filter(function (x) { return x.t; });
      if (!items.length) return null;
      return el("div", null, el("b", { text: sec.title.replace(/ \(Table \d+\)$/, "") }), el("ul", null, items.map(function (x) { return el("li", null, x.t, x.n ? el("span", { class: "muted", text: " (" + x.n + ")" }) : null); })));
    }).filter(function (x) { return x; });
    if (!parts.length) return el("div");
    return el("details", { class: "refpanel", open: open ? "" : null }, el("summary", { text: "For reference: indicators the pre-work found most useful" }),
      el("p", { class: "help", text: "These are general. Write your own specific indicators for each agreed component." }), parts);
  }

  // =====================================================================================
  // RESULTS: votes, written answers, the D10 national table
  // =====================================================================================
  function textItems(def) { return (def.items || []).filter(function (it) { return it.type === "text"; }); }
  function fetchResults(key, role) {
    var def = actDef(key) || {};
    var jobs = [rpc("room_results", { p_code: S.code, p_activity: key, p_mode: role === "projector" || def.ballot ? "spread" : "votes" })];
    if (textItems(def).length) jobs.push(rpc("room_answers", { p_code: S.code, p_activity: key }));
    return Promise.all(jobs).then(function (r) { return { votes: r[0], texts: r[1] || null }; });
  }
  function resultsNode(key, data, role) {
    var def = actDef(key), box = el("div");
    if (!data) return el("p", { class: "muted", text: "Loading..." });
    if (!data.votes || !data.votes.ok) return el("p", { class: "muted", text: data.votes && data.votes.reason === "hidden" ? "Not shown yet." : "Could not load the result." });
    var rows = data.votes.rows || [], byGroup = role === "staff" && !def.ballot;
    (def.items || []).filter(function (it) { return it.type !== "text"; }).forEach(function (it) {
      var rs = rows.filter(function (r) { return r.item === it.id; });
      var tot = {}, grp = {}, max = 1;
      rs.forEach(function (r) { var n = r.n || 0; tot[r.val] = (tot[r.val] || 0) + n; if (r.grp) { grp[r.grp + "|" + r.val] = (grp[r.grp + "|" + r.val] || 0) + n; } });
      it.options.forEach(function (o) { if ((tot[o[0]] || 0) > max) max = tot[o[0]]; });
      var tb = el("table", { class: "restable" }), head = el("tr", null, el("th", { text: it.label }));
      if (byGroup) GROUPS.forEach(function (g) { head.appendChild(el("th", { text: g })); });
      head.appendChild(el("th", { text: "Total" })); tb.appendChild(head);
      it.options.forEach(function (o) {
        var tr = el("tr", null, el("td", { text: it.type === "scale" ? o[0] + " · " + o[1] : o[1] }));
        if (byGroup) GROUPS.forEach(function (g) { tr.appendChild(el("td", { class: "n", text: String(grp[g + "|" + o[0]] || 0) })); });
        var n = tot[o[0]] || 0;
        tr.appendChild(el("td", { class: "n" }, String(n), el("span", { class: "bar", style: "width:" + Math.round(n / max * 100) + "%" })));
        tb.appendChild(tr);
      });
      box.appendChild(tb);
    });
    textItems(def).forEach(function (it) {
      var list = data.texts && data.texts.ok ? data.texts.answers.filter(function (a) { return a.item === it.id && a.payload && String(a.payload.text || "").trim(); }) : [];
      box.appendChild(el("div", { class: "texts" }, el("h4", { text: it.label + " (" + list.length + ")" }),
        list.length ? el("ul", null, list.map(function (a) { return el("li", { text: String(a.payload.text).trim() }); })) : el("p", { class: "muted", text: data.texts && !data.texts.ok ? "Not shown yet." : "No written answers yet." })));
    });
    if (!box.childNodes.length) box.appendChild(el("p", { class: "muted", text: "No answers yet." }));
    return box;
  }
  function resultsLive(key, role) { return liveView({ fetch: function () { return fetchResults(key, role); }, draw: function (d) { return resultsNode(key, d, role); } }); }
  // D10: every answer is one entry: region and the shares of each route
  function d10Answers() { return rpc("room_answers", { p_code: S.code, p_activity: "d10" }); }
  function d10Table(data, each) {
    if (!data) return el("p", { class: "muted", text: "Loading..." });
    if (!data.ok) return el("p", { class: "muted", text: "Not shown yet." });
    var ans = (data.answers || []).map(function (a) { return a.payload || {}; }).filter(function (p) { return p.region && regionMin(p.region); });
    var box = el("div");
    if (each) {
      var tb2 = el("table", { class: "restable" }, el("tr", null, el("th", { text: "Region" }), AG.routes.map(function (r) { return el("th", { text: r[1] + " %" }); }), el("th", { text: "Other, specified" }), el("th", { text: "What the region would need" })));
      ans.sort(function (a, b) { return a.region < b.region ? -1 : 1; }).forEach(function (p) {
        tb2.appendChild(el("tr", null, el("td", { text: regionMin(p.region).name }), AG.routes.map(function (r) { return el("td", { class: "n", text: String(+p[r[0]] || 0) }); }), el("td", { text: p.oth_txt || "" }), el("td", { text: p.needs || "" })));
      });
      box.appendChild(el("div", { class: "mscroll" }, tb2));
      return box;
    }
    var by = {};
    ans.forEach(function (p) { (by[p.region] = by[p.region] || []).push(p); });
    var tb = el("table", { class: "restable d10" }), head = el("tr", null, el("th", { text: "Region" }), el("th", { text: "Answers" }), el("th", { text: "Minimum (registered / screened)" }));
    AG.routes.forEach(function (r) { head.appendChild(el("th", { text: r[1] })); }); tb.appendChild(head);
    var natR = {}, natS = {}, any = false;
    AG.regions.forEach(function (reg) {
      var list = by[reg[0]] || [], m = regionMin(reg[0]), tr = el("tr", { class: list.length ? "" : "empty" }, el("td", { text: reg[1] }), el("td", { class: "n", text: list.length ? String(list.length) : "" }),
        el("td", { class: "n mins", text: fmtN(m.register) + " / " + fmtN(m.screen) }));
      AG.routes.forEach(function (r) {
        if (!list.length) { tr.appendChild(el("td")); return; }
        var avg = list.reduce(function (s, p) { return s + (+p[r[0]] || 0); }, 0) / list.length, er = m.register * avg / 100, es = m.screen * avg / 100;
        natR[r[0]] = (natR[r[0]] || 0) + er; natS[r[0]] = (natS[r[0]] || 0) + es; any = true;
        tr.appendChild(el("td", { class: "n" }, el("div", { text: (Math.round(avg * 10) / 10) + "%" }), el("div", { class: "muted small", text: "≈ " + fmtN(er) + " / " + fmtN(es) })));
      });
      tb.appendChild(tr);
    });
    var tot = el("tr", { class: "total" }, el("td", { text: "All regions that answered" }), el("td", { class: "n", text: String(ans.length) }), el("td"));
    AG.routes.forEach(function (r) { tot.appendChild(el("td", { class: "n" }, any ? el("div", { class: "small", text: "≈ " + fmtN(natR[r[0]] || 0) + " / " + fmtN(natS[r[0]] || 0) }) : "")); });
    tb.appendChild(tot);
    box.appendChild(el("p", { class: "help", text: "Average share of each route, by region; under it the estimated count (registered / screened) = the region's minimum × the share." }));
    box.appendChild(el("div", { class: "mscroll" }, tb));
    var others = ans.filter(function (p) { return (+p.oth > 0) && p.oth_txt; });
    if (others.length) box.appendChild(el("div", { class: "texts" }, el("h4", { text: "Others, specified" }), el("ul", null, others.map(function (p) { return el("li", { text: regionMin(p.region).name + ": " + p.oth_txt }); }))));
    return box;
  }

  // =====================================================================================
  // PHONES
  // =====================================================================================
  function clinicKey() { return "pk_room_clinic_" + fnv(S.code + "|" + S.session); }
  function myClinic() { var c = lsGet(clinicKey()); return /^C[123]$/.test(c || "") ? c : null; }
  function regionKey() { return "pk_room_region_" + fnv(S.code + "|" + S.session); }
  function mySheetFor(def) {
    if (!def || def.kind !== "sheet" || def.staffOnly) return null;
    var mine = def.clinic ? myClinic() : (S.profile.table ? "T" + S.profile.table : null);
    return mine && (def.sheets || []).indexOf(mine) >= 0 ? mine : null;
  }
  function modeBadge(def, sheet) {
    if (def && def.kind === "sheet") return el("div", { class: "mode group", text: "Answer as " + (SHEET_NAMES[sheet] || "a table") });
    if (def && def.ballot) return el("div", { class: "mode solo", text: "Anonymous ballot: answer on your own" });
    return el("div", { class: "mode solo", text: "Answer on your own" });
  }
  function partSig() {
    var s = curSlide(), parts = [s ? s.id : "wait", myClinic() || "", setting("present") || "", evalUrl()];
    if (s) { slideActs(s).concat(s.shown || []).forEach(function (k) { parts.push(k + "=" + actState(k)); }); if (s.quick) parts.push(JSON.stringify(quickMap()[s.id])); }
    return parts.join("~");
  }
  function waitCard() {
    return el("div", { class: "card wait" }, el("h2", { text: "Waiting for the next activity" }),
      el("p", { class: "muted", style: "margin:0", text: "Your facilitators will tell you when to start. This page updates by itself." }));
  }
  function renderPart(force) {
    var sig = partSig();
    if (!force && sig === S.sig) return;
    S.sig = sig;
    var view = resetView(), s = curSlide();
    var any = false, rc = refusedCard();
    if (rc) view.appendChild(rc);
    if (s) {
      (s.shown || []).forEach(function (k) { view.appendChild(shownPanel(k)); any = true; });
      var acts = slideActs(s), clinics = acts.filter(function (k) { return ACT[k] && ACT[k].clinic; });
      acts.forEach(function (k) { if (clinics.indexOf(k) >= 0) return; var n = activityPanel(k); if (n) { view.appendChild(n); any = true; } });
      if (clinics.length) {
        view.appendChild(clinicPicker(clinics)); any = true;
        var ck = clinics.filter(function (k) { return ACT[k].sheets[0] === myClinic(); })[0];
        if (ck) view.appendChild(activityPanel(ck));
      }
    }
    if (!any) view.appendChild(waitCard());
    if ($("histBtn")) $("histBtn").hidden = !mySheetsNow().length;
  }
  function render2() { S.sig = ""; renderPart(true); window.scrollTo(0, 0); }
  // a staff sheet shown on this slide (read-only on phones)
  function shownPanel(k) {
    var def = ACT[k], box = el("section", { class: "apanel locked" }, el("h3", { text: def.title }));
    if (def.view === "merge2") {
      box.appendChild(el("p", { class: "help", text: "Follow the merge live: staff are recording what the tables agreed." }));
      box.appendChild(liveView({ deps: ["s2_merge", "s2_choose"], draw: function () { return merge2View(false); } }));
    }
    else if (def.view === "merge6") box.appendChild(liveView({ deps: ["s6_merge"], draw: function () {
      var w = el("div");
      [1, 2, 3].forEach(function (n) { var sh = "C" + n, ag = agreedFor(sh); w.appendChild(el("div", { class: "statement" }, el("div", { class: "slab", text: SHEET_NAMES[sh] + ": agreed components" }), ag.length ? el("ol", null, ag.map(function (a) { return el("li", null, el("b", { text: a.topic + ": " }), a.how); })) : el("p", { class: "muted", text: "None recorded yet." }))); });
      return w;
    } }));
    else if (def.view === "merge3") box.appendChild(liveView({ deps: depsOf(k), draw: function () { return d9AgreedBox(sheetBody("s3_merge", "ROOM")); } }));
    else if (def.view === "merge7") box.appendChild(liveView({ deps: depsOf(k), draw: function () {
      var w = el("div"); [1, 2, 3].forEach(function (n) { var c = indRows(n); w.appendChild(agreedIndBox(c, agreedInd(c, sheetBody("s7_merge", "ROOM")))); }); return w;
    } }));
    else box.appendChild(liveView({ deps: [k], draw: function () { return viewFor(k, "ROOM", false); } }));
    return box;
  }
  function activityPanel(key) {
    var def = actDef(key), state = actState(key);
    if (!def) return null;
    if (def.kind === "link") return linkPanel(def, state);
    if (def.kind === "sheet") { var mine = mySheetFor(def); return mine ? sheetPanel(key, def, mine) : null; }
    var box = el("section", { class: "apanel" + (state === "open" ? "" : " locked") });
    if (state === "open") box.appendChild(modeBadge(def));
    box.appendChild(el("h3", { text: def.title }));
    if (state !== "open") {
      box.appendChild(el("p", { class: "help", style: "margin:0 0 10px", text: state === "revealed" ? "The result is on the screen." : "Not open." }));
      if (def.d10) { var p = S.mine[mk("d10", "d10")]; if (p && p.region) box.appendChild(el("div", { class: "help", text: "Your saved answer: " + regionMin(p.region).name + " · " + AG.routes.map(function (r) { return r[1] + " " + (+p[r[0]] || 0) + "%"; }).join(" · ") })); return box; }
      var shown = false;
      (def.items || []).forEach(function (it) {
        var m = S.mine[mk(key, it.id)]; if (!m) return;
        if (!shown) { box.appendChild(el("div", { class: "help", style: "margin-top:6px", text: "Your saved answer:" })); shown = true; }
        box.appendChild(el("div", { text: it.label + ": " + answerText(it, m) }));
      });
      return box;
    }
    if (def.d10) { box.appendChild(d10Panel()); return box; }
    var holders = {};
    def.items.forEach(function (it) { var q = itemBlock(key, def, it, holders); holders[it.id] = q; box.appendChild(q.node); });
    refreshShowIf(def, key, holders);
    return box;
  }
  function answerText(it, payload) {
    if (it.type === "text") return payload.text || "";
    var v = payload.v, lab = function (x) { var o = (it.options || []).filter(function (p) { return p[0] === x; })[0]; return o ? (it.type === "scale" ? x : o[1]) : x; };
    return Array.isArray(v) ? (v.length ? v.map(lab).join(", ") : "none") : lab(v);
  }
  function refreshShowIf(def, key, holders) {
    def.items.forEach(function (it) {
      if (!it.showIf) return;
      var m = S.mine[mk(key, it.showIf.item)], ok = false, v = m ? m.v : undefined;
      if (it.showIf.value !== undefined) ok = v === it.showIf.value;
      if (it.showIf.values) ok = it.showIf.values.indexOf(v) >= 0;
      if (it.showIf.filled) ok = Array.isArray(v) ? v.length > 0 : !!v;
      holders[it.id].node.hidden = !ok;
    });
  }
  function itemBlock(key, def, it, holders) {
    var mkey = mk(key, it.id), cur = S.mine[mkey], mark = el("span", { class: "saved-mark" });
    S.marks[mkey] = mark;
    var q = el("div", { class: "q" }), lab = el("span", { class: "t" }, it.label, mark);
    q.appendChild(lab);
    function after() { refreshShowIf(def, key, holders); }
    if (it.type === "single") {
      q.appendChild(radioGroup(mkey, it.options, cur ? cur.v : null, function (v) { saveItem(key, it.id, { v: v }); after(); }));
    } else if (it.type === "scale") {
      var sc = el("div", { class: "scale" });
      it.options.forEach(function (o) {
        var inp = el("input", { type: "radio", name: mkey, value: o[0], checked: cur && cur.v === o[0] });
        var l = el("label", { class: cur && cur.v === o[0] ? "sel" : "" }, inp, el("span", { text: o[0] }));
        inp.addEventListener("change", function () { [].forEach.call(sc.children, function (x) { x.classList.remove("sel"); }); l.classList.add("sel"); saveItem(key, it.id, { v: o[0] }); after(); });
        sc.appendChild(l);
      });
      q.appendChild(sc);
      var lg = el("div", { class: "legend" });
      it.options.forEach(function (o) { lg.appendChild(el("div", null, el("b", { text: o[0] }), el("span", { text: o[1] }))); });
      q.appendChild(lg);
    } else if (it.type === "text") {
      var ta = el("textarea", { value: cur ? cur.text || "" : "", "aria-label": it.label }), cnt = el("div", { class: "counter" }), timer;
      var count = function () { var n = wc(ta.value); cnt.textContent = n + " / " + TEXT_WORDS + " words"; cnt.className = "counter" + (n > TEXT_WORDS ? " over" : ""); return n; };
      ta.addEventListener("input", function () {
        if (count() > TEXT_WORDS) return;
        clearTimeout(timer); timer = setTimeout(function () { saveItem(key, it.id, { text: ta.value }); }, 1200);
      });
      ta.addEventListener("blur", function () { clearTimeout(timer); if (wc(ta.value) <= TEXT_WORDS && (ta.value || cur)) { var prev = S.mine[mkey]; if (!prev || prev.text !== ta.value) saveItem(key, it.id, { text: ta.value }); } });
      count(); q.appendChild(ta); q.appendChild(cnt);
    }
    return { node: q };
  }
  // Session 4: one answer per person, for their region; shares must add up to 100
  function d10Panel() {
    var cur = S.mine[mk("d10", "d10")] || {}, v = { region: cur.region || lsGet(regionKey()) || "", needs: cur.needs || "", oth_txt: cur.oth_txt || "" };
    AG.routes.forEach(function (r) { v[r[0]] = cur[r[0]] != null ? +cur[r[0]] : ""; });
    var box = el("div"), mark = el("span", { class: "saved-mark" }), status = el("div", { class: "help" }), minBox = el("div"), timer;
    S.marks[mk("d10", "d10")] = mark;
    box.appendChild(el("p", { class: "help", text: ACT.d10.help }));
    var sel = el("select", { "aria-label": "Your region" }, [el("option", { value: "", text: "Choose your region" })].concat(AG.regions.map(function (r) { return el("option", { value: r[0], selected: r[0] === v.region, text: r[1] }); })));
    box.appendChild(el("div", { class: "q" }, el("span", { class: "t" }, "Your region", mark), sel, minBox));
    var rows = {}, oth = el("div", { class: "q" }, el("span", { class: "t", text: "What are the others? Specify" })), othIn = el("textarea", { rows: "2", value: v.oth_txt, "aria-label": "Others, specified" });
    oth.appendChild(othIn);
    var routes = el("div", { class: "q" }, el("span", { class: "t", text: "How will your region reach its minimum numbers? (shares in %)" }));
    AG.routes.forEach(function (r) {
      var inp = el("input", { type: "number", min: "0", max: "100", step: "1", inputmode: "numeric", value: v[r[0]] === "" ? "" : String(v[r[0]]), "aria-label": r[1] + " %" }), est = el("div", { class: "muted small" });
      rows[r[0]] = { inp: inp, est: est };
      inp.addEventListener("input", function () { v[r[0]] = inp.value === "" ? "" : Math.max(0, Math.min(100, Math.round(+inp.value || 0))); update(true); });
      routes.appendChild(el("div", { class: "route" }, el("label", { text: r[1] }), el("div", { class: "pct" }, inp, el("span", { text: "%" })), est));
    });
    box.appendChild(routes); box.appendChild(status); box.appendChild(oth);
    var needs = el("textarea", { rows: "3", value: v.needs, "aria-label": "What would your region need?" });
    box.appendChild(el("div", { class: "q" }, el("span", { class: "t", text: "What would your region need to reach them?" }), needs));
    function total() { return AG.routes.reduce(function (s, r) { return s + (+v[r[0]] || 0); }, 0); }
    function update(save) {
      var m = regionMin(v.region), t = total();
      clear(minBox); if (m) minBox.appendChild(regMinNode(v.region));
      AG.routes.forEach(function (r) {
        var p = +v[r[0]] || 0; rows[r[0]].est.textContent = m && p ? "≈ " + fmtN(m.register * p / 100) + " registered · " + fmtN(m.screen * p / 100) + " screened" : "";
      });
      oth.hidden = !(+v.oth > 0);
      status.className = "help total" + (t === 100 ? " ok" : "");
      status.textContent = !v.region ? "Choose your region first." : t === 100 ? "Adds up to 100%." : "Adds up to " + t + "%. It must add up to 100% before it is saved.";
      if (!save) return;
      clearTimeout(timer);
      if (v.region && t === 100) timer = setTimeout(function () {
        var p = { region: v.region, needs: v.needs, oth_txt: +v.oth > 0 ? v.oth_txt : "" }; AG.routes.forEach(function (r) { p[r[0]] = +v[r[0]] || 0; });
        saveItem("d10", "d10", p);
      }, 700);
    }
    sel.addEventListener("change", function () { v.region = sel.value; lsSet(regionKey(), sel.value); update(true); });
    othIn.addEventListener("input", function () { v.oth_txt = othIn.value; update(true); });
    needs.addEventListener("input", function () { v.needs = needs.value; update(true); });
    update(false);
    return box;
  }
  // the sheets this phone belongs to on the current slide (its table's sheet, or its clinic's)
  function mySheetsNow() {
    var s = curSlide(), out = [];
    sheetActsOf(s).forEach(function (k) { var mine = mySheetFor(ACT[k]); if (mine && actState(k) !== "none") out.push({ act: k, sheet: mine }); });
    return out;
  }
  function toggleHistory() {
    var old = document.querySelector(".histmenu"); if (old) { old.remove(); return; }
    [].forEach.call(document.querySelectorAll(".menu"), function (m) { m.remove(); });
    var list = mySheetsNow(), panel = el("div", { class: "menu histmenu", role: "dialog", "aria-label": "History of your table's sheet" });
    panel.appendChild(el("button", { type: "button", class: "jclose", "aria-label": "Close", text: "\u00D7", onclick: function () { panel.remove(); } }));
    if (!list.length) panel.appendChild(el("p", { class: "muted", text: "No sheet on this slide." }));
    list.forEach(function (x) {
      panel.appendChild(el("h3", { text: SHEET_NAMES[x.sheet] + ": " + ACT[x.act].title }));
      panel.appendChild(historyPanel(x.act, x.sheet, isEncoder(x.sheet) && actState(x.act) === "open"));
    });
    panel.addEventListener("click", function (e) { e.stopPropagation(); });
    document.body.appendChild(panel);
  }
  // the check-in details open from the table chip in the header
  function toggleCheckin() {
    var old = document.querySelector(".chippanel"); if (old) { old.remove(); return; }
    var m = document.querySelector(".menu"); if (m) m.remove();
    var panel = el("div", { class: "menu chippanel", role: "dialog", "aria-label": "You are checked in" }, checkinPanel());
    panel.addEventListener("click", function (e) { e.stopPropagation(); });
    document.body.appendChild(panel);
  }
  function checkinPanel() {
    var p = S.profile, box = el("section", { class: "apanel locked small" }, el("h3", { text: "You are checked in" }));
    box.appendChild(el("p", { style: "margin:0 0 10px", text: "Table " + p.table + " · " + p.grp + " · Pre-work: " + (p.prework === true ? "yes" : p.prework === false ? "no" : "not stated") }));
    box.appendChild(el("button", { type: "button", class: "btn ghost small", text: "Change this", onclick: function () {
      var holder = el("div"); box.appendChild(holder);
      profileForm(p, function (prof) { joinCall(prof).then(function (r) { if (r.ok) { S.profile = { session: S.session, grp: prof.grp, table: prof.table, prework: prof.prework }; lsSet(profileKey(S.code), S.profile); ssSet("pk_room_ps", JSON.stringify(S.profile)); var cp = document.querySelector(".chippanel"); if (cp) cp.remove(); updateLive(); render2(); toast("Saved."); } }); }, holder);
    } }));
    return box;
  }
  function linkPanel(def, state) {
    var u = evalUrl(), box = el("section", { class: "apanel" + (state === "open" ? "" : " locked") }, el("h3", { text: def.title }));
    if (u && state === "open") box.appendChild(el("p", null, el("a", { class: "btn", href: u, target: "_blank", rel: "noopener noreferrer", text: "Open the evaluation" })));
    else box.appendChild(el("p", { class: "help", style: "margin:0", text: "Your facilitator will share the evaluation link or QR code." }));
    return box;
  }
  // which sheets this person types for (one phone per table or clinic); kept per person on this device
  function encKey() { return "pk_room_enc_" + fnv(S.code + "|" + S.session); }
  function isEncoder(sheet) { var m = lsGet(encKey()) || {}; return !!m[sheet]; }
  function setEncoder(sheet, on) {
    var m = lsGet(encKey()) || {}; if (on) m[sheet] = true; else delete m[sheet];
    lsSet(encKey(), m); S.sig = "";
    if (isStaff()) renderStaff(true); else renderPart(true);
  }
  // staff: each sheet is view only on a device until someone presses "I type on this device" (kept per device)
  function staffSheet(act, sheet, name, cls) {
    var id = sheetKey(act, sheet), enc = isEncoder(id), hOn = S.histOpen === id;
    var wrap = el("div", { class: cls || "staffwrap" });
    wrap.appendChild(el("div", { class: "encbar" + (enc ? " on" : "") },
      el("span", { text: enc ? "This device types in " + name + "." : "View only on this device: " + name + " updates by itself." }),
      el("button", { type: "button", class: "btn small" + (enc ? " ghost" : ""), text: enc ? "Switch to view only" : "I type on this device", onclick: function () {
        if (!enc && !confirm("Only one device should type in " + name + ". Type in it on this device?")) return;
        setEncoder(id, !enc);
      } })));
    wrap.appendChild(el("div", { class: "row tight", style: "margin:0 0 8px" },
      el("button", { type: "button", class: "btn ghost small", text: hOn ? "Hide history" : "History of this sheet", onclick: function () { S.histOpen = hOn ? null : id; renderStaff(true); } }),
      enc ? el("span", { class: "muted small", text: "Press Save after typing; ticks and lists save at once." }) : null));
    if (hOn) wrap.appendChild(historyPanel(act, sheet, enc));
    wrap.appendChild(sheetLive(act, sheet, enc));
    return wrap;
  }
  function sheetPanel(key, def, mine) {
    var state = actState(key);
    var sbox = el("section", { class: "apanel sheetpanel" + (state === "open" ? "" : " locked") });
    if (state === "open") sbox.appendChild(modeBadge(def, mine));
    sbox.appendChild(el("h3", { text: def.title }));
    if (state === "revealed") {
      var s = curSlide(), pick = presentPick(s);
      sbox.appendChild(el("p", { class: "help", text: "The sheets are on the screen." }));
      sbox.appendChild(presentedLive(s, key, pick));
      return sbox;
    }
    var enc = state === "open" && isEncoder(mine), nm = SHEET_NAMES[mine] || "your table", grp = def.clinic ? "clinic" : "table";
    if (state === "open") {
      sbox.appendChild(el("div", { class: "encbar" + (enc ? " on" : "") },
        el("span", { text: enc ? "This phone types for " + nm + "." : "View only: you see " + nm + "\u2019s sheet as it is filled in." }),
        el("button", { type: "button", class: "btn small" + (enc ? " ghost" : ""), text: enc ? "Switch to view only" : "I type for " + nm, onclick: function () {
          if (!enc && !confirm("Only one phone per " + grp + " should type. Type for " + nm + " on this phone?")) return;
          setEncoder(mine, !enc);
        } })));
    }
    sbox.appendChild(el("p", { class: "help", text: state === "open" ? (def.intro || "") + (enc ? " Press Save after typing; ticks and lists save at once. Saved answers appear on the other phones within a few seconds." : " One phone at your " + grp + " types; this page updates by itself.") : "Not open." }));
    sbox.appendChild(sheetLive(key, mine, enc));
    return sbox;
  }
  // one clinic per person, chosen on the phone (Session 6 and Session 7 use the same choice)
  function clinicPicker(keys) {
    var cur = myClinic(), box = el("section", { class: "apanel" }, el("div", { class: "mode group", text: "Answer as a clinic" }), el("h3", { text: "Which clinic are you in?" }));
    box.appendChild(radioGroup("clinicpick", keys.map(function (k) { return [ACT[k].sheets[0], ACT[k].title]; }), cur, function (v) { lsSet(clinicKey(), v); render2(); }));
    if (!cur) box.appendChild(el("p", { class: "help", style: "margin:10px 0 0", text: "Choose your clinic to see its sheet." }));
    return box;
  }
  // a revealed slide's sheets, as staff present them (one table or clinic, or all)
  function presentedLive(s, onlyAct, pick) {
    var acts = sheetActsOf(s).filter(function (k) { return !onlyAct || k === onlyAct; }), deps = [];
    acts.forEach(function (k) { depsOf(k).forEach(function (d) { if (deps.indexOf(d) < 0) deps.push(d); }); });
    return liveView({ deps: deps, draw: function () {
      var grid = el("div", { class: "roomsheets" + (pick === "all" ? " multi" : "") });
      acts.forEach(function (k) {
        (ACT[k].sheets || []).forEach(function (sh) {
          if (pick !== "all" && pick !== sh) return;
          grid.appendChild(el("div", { class: "roomsheet" }, el("h3", { text: SHEET_NAMES[sh] + (acts.length > 1 ? "" : "") }), viewFor(k, sh, false)));
        });
      });
      if (!grid.childNodes.length) grid.appendChild(el("p", { class: "muted", text: "Nothing to show." }));
      return grid;
    } });
  }

  // =====================================================================================
  // ROOM SCREEN
  // =====================================================================================
  function promptItems(def) {
    var box = el("div", { class: "pitems" });
    (def.items || []).forEach(function (it) {
      if (it.showIf) return; // follow-up boxes stay on the phone
      var row = el("div", { class: "pitem" }, el("div", { class: "plabel", text: it.label }));
      if (it.type === "scale") {
        var lg = el("div", { class: "plegend" });
        it.options.forEach(function (o) { lg.appendChild(el("div", null, el("b", { text: o[0] }), el("span", { text: o[1] }))); });
        row.appendChild(lg);
      } else if (it.options) {
        var opts = el("div", { class: "popts" });
        it.options.forEach(function (o) { opts.appendChild(el("span", { class: "popt", text: o[1] })); });
        row.appendChild(opts);
      }
      box.appendChild(row);
    });
    return box;
  }
  // the join drawer on the room screen: a tab on the right edge slides out the QR code of the room page
  // and the participant code typed in Settings. It lives outside the redrawn view, so it stays as it is between slides.
  function joinDrawer() {
    var d = $("joinDrawer"), code = joinCode();
    if (!d) {
      var open = lsGet("pk_room_join_open") === true;
      d = el("aside", { id: "joinDrawer", class: "joindrawer" + (open ? " open" : ""), "aria-label": "Join on your phone" });
      var setOpen = function (on) {
        d.classList.toggle("open", on); lsSet("pk_room_join_open", on);
        tab.setAttribute("aria-expanded", on ? "true" : "false");
      };
      var tab = el("button", { type: "button", class: "jtab", "aria-expanded": open ? "true" : "false", "aria-controls": "joinPanel", onclick: function () { setOpen(!d.classList.contains("open")); } },
        el("span", { class: "jarrow", "aria-hidden": "true", text: "\u25C2" }), el("span", { class: "jtabtext", text: "Join" }));
      var img = el("img", { src: "join-qr.png", alt: "QR code: open the room page on your phone", width: "260", height: "260" });
      img.addEventListener("error", function () { img.remove(); });
      var panel = el("div", { id: "joinPanel", class: "jpanel" },
        el("button", { type: "button", class: "jclose", "aria-label": "Close", text: "\u00D7", onclick: function () { setOpen(false); } }),
        el("div", { class: "jlab", text: "Join on your phone" }), img,
        el("div", { class: "jurl", text: location.host + location.pathname }),
        el("div", { class: "jlab jcodelab", text: "Access code" }), el("div", { class: "jcode" }));
      d.appendChild(tab); d.appendChild(panel);
      document.body.appendChild(d);
    }
    d.querySelector(".jcode").textContent = code;
    d.querySelector(".jcode").hidden = !code; d.querySelector(".jcodelab").hidden = !code;
  }
  function renderProj() {
    var s = curSlide(), sig = [s ? s.id : "wait", partSig(), JSON.stringify(setting("d2_weights") || {}), joinCode()].join("#");
    if (sig === S.sig) return;
    S.sig = sig;
    var view = resetView();
    joinDrawer();
    if (!s || (!slideActs(s).length && !(s.shown || []).length)) { view.appendChild(el("div", { class: "standby", text: "PuroKalusugan · Direction Consultation" })); return; }
    var card = el("article", { class: "pcard" });
    card.appendChild(el("div", { class: "pkick", text: s.dayName.split(" · ")[0] + " · " + s.session }));
    card.appendChild(el("h2", { class: "ptitle", text: s.title }));
    (s.shown || []).forEach(function (k) {
      if (ACT[k].view === "merge2") card.appendChild(liveView({ deps: depsOf(k).concat(["s2_merge"]), draw: function () { return merge2View(false); } }));
      else if (ACT[k].view === "merge6") card.appendChild(liveView({ deps: depsOf(k).concat(["s6_merge"]), draw: function () { return merge6View(false); } }));
      else if (ACT[k].view === "merge7") card.appendChild(liveView({ deps: depsOf(k), draw: function () { return merge7View(false); } }));
      else if (ACT[k].view === "merge3") card.appendChild(liveView({ deps: depsOf(k), draw: function () { return merge3View(false); } }));
      else card.appendChild(liveView({ deps: [k], draw: function () { return viewFor(k, "ROOM", false); } }));
    });
    var acts = slideActs(s), sheets = sheetActsOf(s);
    if (sheets.length) {
      var st = actState(sheets[0]);
      if (st === "revealed") card.appendChild(presentedLive(s, null, presentPick(s)));
      else {
        var d0 = ACT[sheets[0]];
        card.appendChild(el("p", { class: "plabel", text: d0.clinic ? "Each clinic fills its sheet on their phones." : (d0.intro || "Each table fills its sheet on their phones.") }));
        if (d0.view === "ind") card.appendChild(liveView({ deps: ["ref_ind"], draw: function () { return refPanel(true); } }));
        if (d0.showDirection || d0.view === "test" || d0.view === "choose") {
          if (d0.showDirection) card.appendChild(liveView({ deps: ["s2_merge"], draw: function () { return directionBanner(); } }));
        }
        card.appendChild(el("div", { class: "pstate" }, el("span", { class: "state open", text: st === "open" ? "In progress" : "Closed" })));
      }
    }
    acts.forEach(function (k) {
      var def = actDef(k); if (!def || def.kind === "sheet") return;
      var st2 = actState(k);
      if (def.kind === "link") { card.appendChild(el("p", { class: "plabel", text: "Use the evaluation link or QR code shown by your facilitator." })); return; }
      if (def.d10) { card.appendChild(liveView({ fetch: d10Answers, draw: function (d) { return d10Table(d, false); } })); if (st2 === "open") card.appendChild(el("div", { class: "pstate" }, el("span", { class: "counts", "data-count": k }))); return; }
      if (st2 === "revealed") { card.appendChild(resultsLive(k, "projector")); return; }
      if (def.ballot) card.appendChild(el("p", { class: "plabel", text: "Anonymous ballot: only the totals are shown." }));
      card.appendChild(promptItems(def));
      card.appendChild(el("div", { class: "pstate" }, st2 === "open" ? el("span", { class: "counts", "data-count": k }) : el("span", { class: "state closed", text: "Closed. Thank you." })));
    });
    view.appendChild(card);
    updateLive();
  }

  // =====================================================================================
  // STAFF
  // =====================================================================================
  function staffSet(patch) {
    return rpc("room_set_state", { p_code: S.code, p_patch: patch }).then(function (r) {
      if (!r.ok) { toast("That was not accepted. Is the staff code still open?"); return r; }
      return pollNow().then(function () { return r; });
    }).catch(function (e) { toast(errText(e)); });
  }
  // move to a slide: its activities open, anything else open closes (revealed stays revealed)
  function goTo(id, extraSettings) {
    var fresh = extraSettings && extraSettings.quick && extraSettings.quick[id];
    var t = id === "wait" ? null : (slideById(id) || (fresh ? { id: id, quick: true, acts: [id] } : null));
    if (id !== "wait" && !t) return;
    var cur = (S.st && S.st.acts) || {}, acts = {}, open = t ? (t.acts || []) : [];
    Object.keys(cur).forEach(function (k) { if (cur[k] === "open" && open.indexOf(k) < 0) acts[k] = "closed"; });
    open.forEach(function (k) { acts[k] = "open"; });
    if (t) (t.shown || []).concat(t.reveal || []).forEach(function (k) { if (open.indexOf(k) < 0 && cur[k] !== "revealed") acts[k] = "revealed"; });
    var settings = Object.assign({ live_acts: LIVE, present: "" }, extraSettings || {});
    if (t && !t.quick) settings.last_slide = id;
    S.pollDraft = null; S.openSheet = null;
    return staffSet({ slide_id: id, acts: acts, settings: settings });
  }
  function stepSlide(dir) {
    var list = slideList(), s = curSlide(), i;
    if (!s) {
      var last = setting("last_slide"), li = -1;
      list.forEach(function (x, j) { if (x.id === last) li = j; });
      if (dir < 0) { if (li >= 0) goTo(list[li].id); return; }
      i = li;
    } else list.forEach(function (x, j) { if (x.id === s.id) i = j; });
    for (var j = i + dir; j >= 0 && j < list.length; j += dir) { if (!list[j].optional) { goTo(list[j].id); return; } }
    toast(dir > 0 ? "This is the last slide." : "This is the first slide.");
  }
  function showResults(on) {
    var s = curSlide(); if (!s) return;
    if (on && sheetActsOf(s).some(function (k) { return actState(k) === "open"; }) &&
        !confirm("Tables can no longer type while the results are shown. Show the results now?")) return;
    var acts = {}; slideActs(s).forEach(function (k) { acts[k] = on ? "revealed" : "open"; });
    var settings = {}; if (on) settings.present = slideSheets(s)[0] || "";
    staffSet({ acts: acts, settings: settings });
  }
  function createQuick(q, opts, ballot) {
    var base = curSlide(), after = base ? (base.quick ? (quickMap()[base.id] || {}).after : base.id) : (setting("last_slide") || BASE[0].id);
    var id = "qv" + Date.now().toString(36), all = Object.assign({}, quickMap());
    all[id] = { q: q, opts: opts, ballot: !!ballot, after: after || BASE[0].id, at: Date.now() };
    goTo(id, { quick: all });
  }
  function renderStaff(force) {
    var tab = S.tab;
    if (tab !== "slides" && tab !== "registers") { if (force) { resetView(); ({ paper: tabPaper, settings: tabSettings })[tab]($("view")); } return; }
    var sig = [tab, S.st.slide_id, JSON.stringify(S.st.acts), JSON.stringify(S.st.settings), S.st.timer_end, S.openSheet, S.openReg, S.d10Each, S.pollDraft, S.histOpen].join("~");
    if (!force && sig === S.sig) return;
    // someone typing in a staff box keeps their text: redraw once they leave it
    var a = document.activeElement;
    if (!force && a && $("view").contains(a) && /^(TEXTAREA|INPUT)$/.test(a.tagName) && a.type !== "checkbox") { clearTimeout(S.later); S.later = setTimeout(function () { renderStaff(); }, 1500); return; }
    S.sig = sig;
    var view = resetView();
    if (tab === "slides") tabSlides(view); else tabRegisters(view);
    refreshLive();
  }
  function setTimerMin(m) { staffSet({ timer_end: new Date(Date.now() + S.skew + m * 60000).toISOString() }); }
  function addMinute() {
    var end = S.st.timer_end ? Date.parse(S.st.timer_end) : 0, now = Date.now() + S.skew;
    staffSet({ timer_end: new Date((end > now ? end : now) + 60000).toISOString() });
  }
  function tabSlides(view) {
    var s = curSlide(), list = slideList(), idx = -1;
    list.forEach(function (x, j) { if (s && x.id === s.id) idx = j; });
    // presenter bar
    var bar = el("div", { class: "ctl presenter" });
    var nav = el("div", { class: "row" },
      el("button", { type: "button", class: "btn small ghost", text: "◀ Previous", onclick: function () { stepSlide(-1); } }),
      el("div", { class: "grow pnow" }, el("div", { class: "muted small", text: s ? "Slide " + (idx + 1) + " of " + list.length + " · " + s.dayName.split(" · ")[0] + " · " + s.session : "Waiting screen" }), el("b", { text: s ? s.title : "Phones show “Waiting for the next activity”" })),
      el("button", { type: "button", class: "btn small", text: "Next ▶", onclick: function () { stepSlide(1); } }));
    bar.appendChild(nav);
    var ctl = el("div", { class: "row tight", style: "margin-top:10px" });
    ctl.appendChild(el("button", { type: "button", class: "btn small ghost", text: "Waiting screen", "aria-pressed": s ? "false" : "true", onclick: function () { goTo("wait"); } }));
    if (s && slideActs(s).length && slideActs(s).some(function (k) { var d = actDef(k); return d && d.kind !== "link"; })) {
      var rev = slideRevealed(s);
      ctl.appendChild(el("button", { type: "button", class: "btn small" + (rev ? "" : " ghost"), text: rev ? "Hide results" : "Show results", onclick: function () { showResults(!rev); } }));
    }
    ctl.appendChild(el("button", { type: "button", class: "btn small ghost", text: "New quick vote", onclick: function () { S.pollDraft = S.pollDraft === "_new" ? null : "_new"; renderStaff(true); } }));
    [1, 3, 5, 10, 15, 20].forEach(function (m) { ctl.appendChild(el("button", { type: "button", class: "btn ghost small", text: m + " min", onclick: function () { setTimerMin(m); } })); });
    ctl.appendChild(el("button", { type: "button", class: "btn ghost small", text: "+1 min", onclick: addMinute }));
    ctl.appendChild(el("button", { type: "button", class: "btn ghost small", text: "Clear timer", onclick: function () { staffSet({ timer_end: "" }); } }));
    bar.appendChild(ctl);
    if (S.pollDraft === "_new") bar.appendChild(pollDraftForm("", ["", ""], null));
    view.appendChild(bar);

    // the current slide, as staff see it
    var cur = el("div", { class: "ctl" });
    if (!s) cur.appendChild(el("p", { class: "muted", style: "margin:0", text: "Phones show the waiting screen; the room screen shows the title. Press Next to continue from “" + ((slideById(setting("last_slide")) || {}).title || "the start") + "”." }));
    else slideStaff(s, cur);
    view.appendChild(cur);

    // the slide list
    var lst = el("div", { class: "ctl slidelist" }, el("h3", { text: "All slides" }), el("p", { class: "muted small", style: "margin-top:0", text: "Tap a slide to go there. Optional slides are skipped by Next and Previous. Arrow keys also move." }));
    var lastDay = null, lastSess = null;
    list.forEach(function (x, j) {
      if (x.day !== lastDay) { lst.appendChild(el("h4", { class: "sday", text: x.dayName })); lastDay = x.day; lastSess = null; }
      if (x.session !== lastSess) { lst.appendChild(el("div", { class: "bsess", text: x.session })); lastSess = x.session; }
      var on = s && s.id === x.id;
      var b = el("button", { type: "button", class: "slidebtn" + (on ? " on" : "") + (x.quick ? " quick" : ""), onclick: function () { goTo(x.id); } }, el("span", { class: "num", text: String(j + 1) }), el("span", { text: x.title }), x.optional ? el("span", { class: "opttag", text: "optional" }) : null);
      var row = el("div", { class: "row tight" }, b);
      if (x.quick) row.appendChild(el("button", { type: "button", class: "linkbtn", text: "Remove", onclick: function () {
        if (!confirm("Remove this quick vote from the list? Its answers are kept.")) return;
        var all = Object.assign({}, quickMap()); delete all[x.id]; staffSet({ settings: { quick: all } });
      } }));
      lst.appendChild(row);
    });
    view.appendChild(lst);
  }
  // the merge sheets keep a built statement or agreed list; rebuild it after a Restore
  function rederive(act) {
    if (act === "s2_merge") queueCell("s2_merge", "ROOM", "statement", mergeStatement(sheetBody("s2_merge", "ROOM")));
    if (act === "s6_merge") [1, 2, 3].forEach(function (n) { var c = clinicRows(n); queueCell("s6_merge", "ROOM", "agreed." + c.sheet, agreedList(c, sheetBody("s6_merge", "ROOM"))); });
  }
  // every change saved to one sheet, newest first (18_room_sheet_log.sql); staff can put back any earlier text
  function historyPanel(act, sheet, canRestore) {
    var box = el("div", { class: "histpanel" }, el("p", { class: "muted small", text: "Loading the history\u2026" }));
    var show = function (val) { return Array.isArray(val) ? val.join(", ") : val === true ? "ticked" : val === false ? "unticked" : String(val == null ? "" : val); };
    rpc("room_sheet_history", { p_code: S.code, p_session: S.session || null, p_activity: act, p_sheet: sheet }).then(function (r) {
      clear(box);
      if (!r.ok) { box.appendChild(el("p", { class: "muted small", text: "The history is not available (" + (r.reason || "error") + ")." })); return; }
      var derived = function (k) { return k === "statement" || /^agreed\./.test(k); };
      r.rows = r.rows.filter(function (row) { return Object.keys(row.patch || {}).some(function (k) { return !derived(k); }); });
      box.appendChild(el("div", { class: "row tight" }, el("b", { text: "History: " + r.rows.length + " saved changes" }),
        el("button", { type: "button", class: "linkbtn", text: "Refresh", onclick: function () { box.replaceWith(historyPanel(act, sheet, canRestore)); } })));
      if (!r.rows.length) { box.appendChild(el("p", { class: "muted small", text: "No changes saved yet." })); return; }
      var list = el("ol", { class: "histlist" });
      r.rows.forEach(function (row) {
        var when = new Date(row.at), time = ("0" + when.getHours()).slice(-2) + ":" + ("0" + when.getMinutes()).slice(-2) + ":" + ("0" + when.getSeconds()).slice(-2);
        Object.keys(row.patch || {}).filter(function (k) { return !derived(k); }).forEach(function (k) {
          var val = row.patch[k], isRows = /\._(add|del)$/.test(k);
          var li = el("li", null, el("span", { class: "muted", text: time + " \u00B7 " + (row.by || "") + " \u00B7 " }), el("b", { text: keyLabel(act, k) + ": " }),
            isRows ? (k.slice(-4) === "_add" ? "row added" : "row removed") : (show(val) ? el("span", { class: "histval", text: show(val) }) : el("i", { class: "muted", text: "(emptied)" })));
          if (!isRows && canRestore) li.appendChild(el("button", { type: "button", class: "linkbtn", text: "Restore", onclick: function () {
            if (!confirm("Put this back in the sheet?\n\n" + keyLabel(act, k) + ": " + show(val))) return;
            queueCell(act, sheet, k, val); rederive(act); toast("Restored.");
            if (isStaff()) renderStaff(true); else { S.sig = ""; renderPart(true); }
          } }));
          list.appendChild(li);
        });
      });
      box.appendChild(list);
    }).catch(function (e) { clear(box); box.appendChild(el("p", { class: "muted small", text: errText(e) })); });
    return box;
  }
  function slideStaff(s, box) {
    box.appendChild(el("h3", { text: s.title }));
    if (!slideActs(s).length && !(s.shown || []).length) box.appendChild(el("p", { class: "muted", text: "Nothing on phones for this slide; phones show the waiting screen. " + (s.id === "s5_1" ? "Run the recap in plenary, with a show of hands if anything is contested." : "") }));
    (s.shown || []).forEach(function (k) {
      var def = ACT[k];
      if (def.view !== "start") box.appendChild(el("p", { class: "muted small", text: def.intro || "" }));
      if (def.view === "merge2" || def.view === "merge6" || def.view === "merge7" || def.view === "merge3") box.appendChild(staffSheet(k, "ROOM", "this merge sheet"));
      else { box.appendChild(sheetLive(k, "ROOM", false)); if (def.view !== "start") box.appendChild(el("p", { class: "muted small", text: "Edit it on the Staff sheets tab." })); }
    });
    var sheets = sheetActsOf(s);
    if (sheets.length) {
      var d0 = ACT[sheets[0]], st = actState(sheets[0]);
      box.appendChild(el("p", { class: "muted small", text: (d0.clinic ? "Each person picks their clinic on the phone; anyone in a clinic can type." : "Anyone at a table can type on their phone.") + " Staff can read and correct any sheet here." }));
      if (st === "revealed") {
        var pick = presentPick(s), all = slideSheets(s), pc = el("div", { class: "row tight present" }, el("span", { class: "muted small", text: "Present:" }));
        var i = all.indexOf(pick);
        pc.appendChild(el("button", { type: "button", class: "btn ghost small", text: "◀", "aria-label": "Previous sheet", onclick: function () { staffSet({ settings: { present: all[Math.max(0, i - 1)] } }); } }));
        all.forEach(function (sh) { pc.appendChild(el("button", { type: "button", class: "btn small" + (pick === sh ? "" : " ghost"), text: SHEET_NAMES[sh], onclick: function () { staffSet({ settings: { present: sh } }); } })); });
        pc.appendChild(el("button", { type: "button", class: "btn small" + (pick === "all" ? "" : " ghost"), text: "All", onclick: function () { staffSet({ settings: { present: "all" } }); } }));
        pc.appendChild(el("button", { type: "button", class: "btn ghost small", text: "▶", "aria-label": "Next sheet", onclick: function () { staffSet({ settings: { present: all[Math.min(all.length - 1, i + 1)] || all[0] } }); } }));
        box.appendChild(pc);
      }
      var srow = el("div", { class: "row tight", style: "margin:8px 0" }, el("span", { class: "muted small", text: "Open a sheet:" }));
      sheets.forEach(function (k) {
        ACT[k].sheets.forEach(function (sh) {
          var id = sheetKey(k, sh), on = S.openSheet === id;
          srow.appendChild(el("button", { type: "button", class: "btn small" + (on ? "" : " ghost"), text: (on ? "Close " : "") + SHEET_NAMES[sh], onclick: function () { S.openSheet = on ? null : id; renderStaff(true); } }));
        });
      });
      box.appendChild(srow);
      if (S.openSheet && sheets.indexOf(S.openSheet.split("|")[0]) >= 0) {
        var os = S.openSheet.split("|");
        var ss = staffSheet(os[0], os[1], SHEET_NAMES[os[1]] + "\u2019s sheet", "staffsheet");
        ss.insertBefore(el("h4", { style: "margin:0 0 8px", text: SHEET_NAMES[os[1]] + " \u00B7 " + ACT[os[0]].title }), ss.firstChild);
        box.appendChild(ss);
      }
    }
    slideActs(s).forEach(function (k) {
      var def = actDef(k); if (!def || def.kind === "sheet") return;
      if (def.kind === "link") { box.appendChild(el("p", { class: "muted small", text: evalUrl() ? "Phones show the evaluation link on this slide." : "Add the evaluation link on the Settings tab." })); return; }
      var blk = el("div", { class: "staffres" });
      blk.appendChild(el("div", { class: "row" }, el("b", { text: def.title }), el("span", { class: "counts", "data-count": k }), def.ballot ? el("span", { class: "state revealed", text: "ballot: totals only" }) : null));
      if (def.d10) {
        blk.appendChild(el("label", { class: "row tight" }, el("input", { type: "checkbox", checked: S.d10Each, style: "width:20px;height:20px", onchange: function () { S.d10Each = !S.d10Each; renderStaff(true); } }), el("span", { text: "Show each answer" })));
        blk.appendChild(liveView({ fetch: d10Answers, draw: function (d) { return d10Table(d, S.d10Each); } }));
      } else {
        blk.appendChild(promptItems(def));
        blk.appendChild(el("div", { class: "muted small", text: "Live result (staff only until you press Show results):" }));
        blk.appendChild(resultsLive(k, "staff"));
        if (def.quick && actState(k) === "revealed" && !def.ballot) blk.appendChild(el("button", { type: "button", class: "btn ghost small", text: "Still split: run it again as an anonymous ballot", onclick: function () {
          var q = quickMap()[k]; createQuick(q.q, q.opts, true);
        } }));
      }
      box.appendChild(blk);
    });
  }
  // keyboard: arrow keys move the slides (not while typing)
  document.addEventListener("keydown", function (e) {
    if (!S.running || !isStaff() || S.tab !== "slides") return;
    var a = document.activeElement; if (a && /^(TEXTAREA|INPUT|SELECT)$/.test(a.tagName)) return;
    if (e.key === "ArrowRight") { e.preventDefault(); stepSlide(1); } else if (e.key === "ArrowLeft") { e.preventDefault(); stepSlide(-1); }
  });

  // ----- staff sheets tab: the registers and the lists staff enter -----
  function tabRegisters(view) {
    view.appendChild(el("p", { class: "muted", text: "Staff sheets. The pre-work indicators (Session 7) are entered here before Day 2, in both the trial and the live room. The Session 2 starting elements are built into the page." }));
    AG.registers.forEach(function (k) {
      var def = ACT[k], on = S.openReg === k, card = el("div", { class: "ctl" });
      card.appendChild(el("div", { class: "row" }, el("h3", { style: "margin:0", text: def.title }), el("button", { type: "button", class: "btn small" + (on ? "" : " ghost"), text: on ? "Close" : "Open", onclick: function () { S.openReg = on ? null : k; renderStaff(true); } })));
      if (on) {
        if (def.intro) card.appendChild(el("p", { class: "help", text: def.intro }));
        if (def.importable && isEncoder(sheetKey(k, "ROOM"))) card.appendChild(importBox(k));
        card.appendChild(staffSheet(k, "ROOM", "this staff sheet"));
      }
      view.appendChild(card);
    });
  }
  // paste a list: one row per line, "section | column 1 | column 2 ..." (section ids are shown in the help)
  function importBox(k) {
    var def = ACT[k], ta = el("textarea", { rows: "6", "aria-label": "Rows to add", placeholder: def.sections.filter(function (s) { return s.type === "rows"; }).map(function (s) { return s.id + " | " + s.cols.map(function (c) { return c.label; }).join(" | "); }).join("\n") });
    var rep = el("input", { type: "checkbox", style: "width:20px;height:20px" }), out = el("div");
    return el("details", { class: "importbox" }, el("summary", { text: "Paste a list" }),
      el("p", { class: "help", text: "One row per line: the section letter, then the columns, separated by |. For example: " + (def.sections[0].id) + " | " + def.sections[0].cols.map(function (c) { return c.label; }).join(" | ") + ". Lines starting with m | set the heading fields." }),
      ta, el("label", { class: "row tight", style: "margin:6px 0" }, rep, el("span", { text: "Replace the rows that are there now" })),
      el("button", { type: "button", class: "btn small", text: "Add these rows", onclick: function () {
        var body = sheetBody(k, "ROOM"), n = 0, bad = 0;
        if (rep.checked) def.sections.forEach(function (sec) { if (sec.type === "rows") { var old = addedRows(body, sec.id); if (old.length) old.forEach(function (r) { queueRow(k, "ROOM", sec.id, "del", r); }); } });
        ta.value.split(/\r?\n/).forEach(function (line) {
          if (!line.trim()) return;
          var parts = line.split("|").map(function (x) { return x.trim(); }), sec = def.sections.filter(function (s) { return s.id === parts[0]; })[0];
          if (!sec) { bad++; return; }
          if (sec.type === "fields") { sec.fields.forEach(function (f, i) { if (parts[i + 1] != null) queueCell(k, "ROOM", sec.id + "." + f.id, parts[i + 1]); }); n++; return; }
          var r = rid() + n; queueRow(k, "ROOM", sec.id, "add", r);
          sec.cols.forEach(function (c, i) { if (parts[i + 1] != null && parts[i + 1] !== "") queueCell(k, "ROOM", sec.id + "." + r + "." + c.id, parts[i + 1]); });
          n++;
        });
        msg(out, n + " row" + (n === 1 ? "" : "s") + " added" + (bad ? "; " + bad + " line" + (bad === 1 ? "" : "s") + " skipped (unknown section)" : "") + ".", bad ? "err" : "ok");
        ta.value = ""; setTimeout(function () { S.sig = ""; renderStaff(true); }, 400);
      } }), out);
  }

  // ----- paper entries tab: staff log a tally by group -----
  function tallyList() {
    var out = [];
    BASE.forEach(function (s) {
      slideActs(s).forEach(function (k) {
        var def = ACT[k]; if (!def || !def.items) return;
        def.items.filter(function (it) { return it.type !== "text"; }).forEach(function (it) {
          out.push({ key: k, ik: it.id, label: s.dayName.split(" · ")[0] + " · " + s.title + " · " + it.label, options: it.options });
        });
      });
    });
    return out;
  }
  function tabPaper(view) {
    var list = tallyList(), c = el("div", { class: "ctl" }, el("h3", { text: "Paper entries" }),
      el("p", { class: "muted", style: "margin-top:0", text: "Use this when people vote on paper or by show of hands. Enter how many people chose each answer, for one group at a time. Saving again for the same group replaces its numbers." }));
    var sel = el("select", { "aria-label": "What was voted on" });
    list.forEach(function (x, i) { sel.appendChild(el("option", { value: String(i), selected: i === S.tallyPick, text: x.label })); });
    var grp = el("select", { "aria-label": "Group" }, GROUPS.map(function (g) { return el("option", { value: g, text: g }); }));
    var tbl = el("select", { "aria-label": "Table" }, [el("option", { value: "", text: "All tables / not recorded" })].concat([1, 2, 3, 4].map(function (n) { return el("option", { value: String(n), text: "Table " + n }); })));
    var gridBox = el("div"), out = el("div"), resBox = el("div"), inputs = {};
    function drawGrid() {
      var x = list[+sel.value]; S.tallyPick = +sel.value; clear(gridBox); inputs = {};
      var g = el("div", { class: "tallygrid" });
      x.options.forEach(function (o) {
        var inp = el("input", { type: "number", min: "0", step: "1", inputmode: "numeric", placeholder: "0", id: "tl_" + o[0] }); inputs[o[0]] = inp;
        g.appendChild(el("div", null, el("label", { for: "tl_" + o[0], text: o[1] }), inp));
      });
      gridBox.appendChild(g); loadRes();
    }
    function loadRes() {
      var x = list[+sel.value]; clear(resBox);
      fetchResults(x.key, "staff").then(function (d) {
        resBox.appendChild(el("h4", { text: "Totals so far (phones plus paper)", style: "margin:18px 0 4px" }));
        resBox.appendChild(resultsNode(x.key, d, "staff"));
      }).catch(function () {});
    }
    sel.addEventListener("change", drawGrid);
    c.appendChild(el("div", { class: "q", style: "margin-bottom:10px" }, el("span", { class: "t", text: "What was voted on" }), sel));
    c.appendChild(el("div", { class: "row" }, el("div", { class: "grow" }, el("span", { class: "t", style: "font-weight:600;display:block", text: "Group" }), grp), el("div", { class: "grow" }, el("span", { class: "t", style: "font-weight:600;display:block", text: "Table (optional)" }), tbl)));
    c.appendChild(gridBox);
    c.appendChild(el("button", { type: "button", class: "btn", text: "Save these numbers", onclick: function () {
      var x = list[+sel.value], counts = {}, bad = false, any = false;
      x.options.forEach(function (o) { var raw = inputs[o[0]].value.trim(), n = raw === "" ? 0 : Number(raw); if (!Number.isInteger(n) || n < 0) bad = true; counts[o[0]] = n; if (n > 0) any = true; });
      if (bad) { msg(out, "Please use whole numbers, zero or more.", "err"); return; }
      rpc("room_staff_tally", { p_code: S.code, p_activity: x.key, p_item: x.ik, p_grp: grp.value, p_table: tbl.value ? +tbl.value : null, p_counts: counts }).then(function (r) {
        if (r.ok) { msg(out, "Saved for " + grp.value + (tbl.value ? ", table " + tbl.value : "") + (any ? "." : ". All zero."), "ok"); loadRes(); } else msg(out, "Not saved (" + (r.reason || "unknown") + ").", "err");
      }).catch(function () { msg(out, "No connection. Not saved. Try again.", "err"); });
    } }));
    c.appendChild(out); c.appendChild(resBox);
    view.appendChild(c); drawGrid();
  }

  // ----- settings tab -----
  function tabSettings(view) {
    var c = el("div", { class: "ctl" }, el("h3", { text: "Settings" })), out = el("div");
    var poll = el("select", { "aria-label": "How often devices check for changes" }, [[3000, "Every 3 seconds"], [5000, "Every 5 seconds (default)"], [8000, "Every 8 seconds"], [12000, "Every 12 seconds"], [20000, "Every 20 seconds"]]
      .map(function (o) { return el("option", { value: String(o[0]), selected: pollMs() === o[0], text: o[1] }); }));
    var url = el("input", { type: "text", value: evalUrl(), placeholder: "https://...", "aria-label": "Evaluation link" });
    var jc = el("input", { type: "text", value: joinCode(), placeholder: "PK-XXXX-XXXX", maxlength: "40", autocapitalize: "characters", "aria-label": "Participant code shown on the room screen" });
    c.appendChild(el("div", { class: "q" }, el("span", { class: "t", text: "How often devices check for changes" }), el("p", { class: "help", text: "Slower saves data on the free plan. Use 8 seconds or more if the usage page shows a high count." }), poll));
    c.appendChild(el("div", { class: "q" }, el("span", { class: "t", text: "Evaluation link (optional)" }), el("p", { class: "help", text: "The link your team provides. Phones show an Open button on the Evaluation slide. This link and the polling speed are shared with the " + (S.stage === "trial" ? "live" : "trial") + " room." }), url));
    c.appendChild(el("div", { class: "q" }, el("span", { class: "t", text: "Participant code shown on the room screen (optional)" }), el("p", { class: "help", text: "Type the participant code of this " + (S.stage === "trial" ? "trial" : "live") + " room. The room screen shows it under the join QR code. The other room keeps its own." }), jc));
    c.appendChild(el("button", { type: "button", class: "btn", text: "Save settings", onclick: function () {
      var u = url.value.trim(), code = jc.value.trim().toUpperCase();
      if (u && !/^https:\/\/[^\s]+$/i.test(u)) { msg(out, "The evaluation link must start with https://", "err"); return; }
      if (code && !/^[A-Z0-9-]{3,40}$/.test(code)) { msg(out, "The code can only have letters, numbers and dashes.", "err"); return; }
      staffSet({ settings: { poll_ms: +poll.value, eval_url: u, join_code: code } }).then(function () { msg(out, "Saved.", "ok"); });
    } }));
    c.appendChild(out);
    c.appendChild(el("hr", { class: "hr" }));
    var w = setting("d2_weights") || {}, wbox = el("div", { class: "tallygrid" }), wout = el("div");
    AG.crit.forEach(function (cr) { wbox.appendChild(el("div", null, el("label", { for: "w_" + cr[0], text: cr[1] }), el("input", { type: "number", min: "0", step: "any", id: "w_" + cr[0], value: w[cr[0]] != null ? String(w[cr[0]]) : "", placeholder: "weight" }))); });
    c.appendChild(el("div", { class: "q" }, el("span", { class: "t", text: "The weights agreed in Session 1 (optional)" }),
      el("p", { class: "help", text: "Enter the weight for each of the eight questions, in any unit (for example percentages). The Session 2 test also always shows equal weights. Leave empty if equal weights were chosen." }), wbox));
    c.appendChild(el("button", { type: "button", class: "btn ghost small", text: "Save the weights", onclick: function () {
      var obj = {}, bad = false;
      AG.crit.forEach(function (cr) { var v = $("w_" + cr[0]).value.trim(); if (v === "") return; var n = Number(v); if (!(n >= 0)) bad = true; obj[cr[0]] = n; });
      if (bad) { msg(wout, "Please use numbers of zero or more.", "err"); return; }
      staffSet({ settings: { d2_weights: obj } }).then(function () { msg(wout, "Saved.", "ok"); });
    } }), wout);
    c.appendChild(el("hr", { class: "hr" }));
    var cc = el("div"), t = el("button", { type: "button", class: "btn ghost small", text: "Check the connection", onclick: function () {
      var t0 = performance.now(); msg(cc, "Checking...");
      rpc("room_get_state", { p_code: S.code, p_session: null, p_since: S.ver }).then(function (r) { msg(cc, r.ok ? "Connected. The server answered in " + Math.round(performance.now() - t0) + " ms." : "The server answered, but the code was refused.", r.ok ? "ok" : "err"); })
        .catch(function () { msg(cc, "Could not reach the server.", "err"); });
    } });
    c.appendChild(t); c.appendChild(cc);
    view.appendChild(c);
    view.appendChild(exportCard());
    if (S.stage === "trial") {
      var tr = el("div", { class: "ctl" }, el("h3", { text: "Trial room" })), tout = el("div");
      tr.appendChild(el("p", { class: "muted", style: "margin-top:0", text: "Clears every trial answer, sheet and participant and puts the trial back at the start. The evaluation link and the live room are not touched." }));
      tr.appendChild(el("button", { type: "button", class: "btn warn small", text: "Reset the trial room", onclick: function () {
        if (!confirm("Clear all trial answers, sheets and participants? The live room is not affected.")) return;
        rpc("room_reset_trial", { p_code: S.code }).then(function (r) {
          if (r.ok) { msg(tout, "The trial room is empty again.", "ok"); S.sheetData = {}; pollNow(); } else msg(tout, "That was not accepted.", "err");
        }).catch(function (e) { msg(tout, errText(e), "err"); });
      } }));
      tr.appendChild(tout); view.appendChild(tr);
    }
  }

  // ----- download the data of this room (staff): an Excel file to read, and a full backup -----
  var PAGE_VER = "20261126f";
  function exportCard() {
    var out = el("div"), card = el("div", { class: "ctl" }, el("h3", { text: "Download the data of this room (" + S.stage + ")" }),
      el("p", { class: "muted", style: "margin-top:0", text: "Everything saved in this room so far: every table, clinic and staff sheet, every personal answer (without who gave it; the database keeps no names) and the vote totals. The Excel file is for reading; the backup keeps the data exactly as stored." }));
    var b1 = el("button", { type: "button", class: "btn small", text: "Download answers (Excel)", onclick: function () { run("xlsx"); } });
    var b2 = el("button", { type: "button", class: "btn ghost small", text: "Download full backup (.json)", onclick: function () { run("json"); } });
    card.appendChild(el("div", { class: "row tight" }, b1, b2));
    card.appendChild(out);
    function run(kind) {
      b1.disabled = b2.disabled = true;
      collectRoom(function (i, n) { msg(out, "Reading " + i + " of " + n + " activities\u2026"); }).then(function (data) {
        if (kind === "json") {
          saveBlob(new Blob([JSON.stringify(data, null, 1)], { type: "application/json" }), exportName("backup", "json"));
          msg(out, "Backup downloaded." + (data.history_note ? " " + data.history_note : ""), "ok"); return;
        }
        return loadXlsx().then(function (X) {
          X.writeFile(exportWorkbook(X, data), exportName("answers", "xlsx"));
          msg(out, "Excel file downloaded.", "ok");
        });
      }).catch(function (e) {
        msg(out, e && e.xlsx ? "The Excel tool could not be loaded (no internet?). Use the backup button instead." : errText(e), "err");
      }).then(function () { b1.disabled = b2.disabled = false; });
    }
    return card;
  }
  function exportName(kind, ext) {
    var d = new Date(), two = function (n) { return ("0" + n).slice(-2); };
    return "PK room " + kind + " (" + S.stage + ") " + d.getFullYear() + "-" + two(d.getMonth() + 1) + "-" + two(d.getDate()) + " " + two(d.getHours()) + two(d.getMinutes()) + "." + ext;
  }
  function saveBlob(blob, name) {
    var a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = name;
    document.body.appendChild(a); a.click();
    setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 1500);
  }
  function loadXlsx() {
    if (window.XLSX) return Promise.resolve(window.XLSX);
    return new Promise(function (resolve, reject) {
      var sc = document.createElement("script");
      sc.src = "https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js";
      sc.onload = function () { if (window.XLSX) resolve(window.XLSX); else reject({ xlsx: true }); };
      sc.onerror = function () { reject({ xlsx: true }); };
      document.head.appendChild(sc);
    });
  }
  // every activity: those on slides in running order, then the rest (old slides, staff registers), then quick votes
  function exportActs() {
    var order = [], seen = {};
    var add = function (k) { if (k && !seen[k]) { seen[k] = true; order.push(k); } };
    slideList().forEach(function (sl) { (sl.acts || []).concat(sl.shown || [], sl.reveal || []).forEach(add); });
    Object.keys(ACT).forEach(add);
    Object.keys(quickMap()).forEach(add);
    return order;
  }
  function collectRoom(progress) {
    var acts = exportActs(), i = 0, histOk = true;
    var data = { exported_at: new Date().toISOString(), room: S.stage, page_version: PAGE_VER,
      state: { slide_id: S.st.slide_id, acts: S.st.acts, settings: S.st.settings }, sheets: {}, answers: {}, results: {}, history: {} };
    var chain = Promise.resolve();
    acts.forEach(function (k) {
      chain = chain.then(function () {
        progress(++i, acts.length);
        var def = actDef(k) || {};
        if (def.kind === "sheet") {
          return rpc("room_get_sheets", { p_code: S.code, p_session: S.session, p_activity: k }).then(function (r) {
            if (!r.ok || !r.sheets.length) return;
            data.sheets[k] = r.sheets;
            // the change history (18_room_sheet_log.sql); skipped when that file has not been run
            return r.sheets.reduce(function (pr, sh) {
              return pr.then(function () {
                if (!histOk) return;
                return rpc("room_sheet_history", { p_code: S.code, p_session: S.session || null, p_activity: k, p_sheet: sh.sheet }).then(function (h) {
                  if (h.ok && h.rows.length) (data.history[k] = data.history[k] || {})[sh.sheet] = h.rows;
                }).catch(function () { histOk = false; });
              });
            }, Promise.resolve());
          });
        }
        if (def.kind === "form") {
          return Promise.all([
            rpc("room_answers", { p_code: S.code, p_activity: k }).then(function (r) { if (r.ok && r.answers.length) data.answers[k] = r.answers; }),
            rpc("room_results", { p_code: S.code, p_activity: k, p_mode: "votes" }).then(function (r) { if (r.ok && r.rows.length) data.results[k] = r.rows; })
          ]);
        }
      });
    });
    return chain.then(function () {
      if (!histOk) data.history_note = "The change history is not included: 18_room_sheet_log.sql has not been run yet.";
      return data;
    });
  }
  function exportWorkbook(X, data) {
    var sessOf = {};
    slideList().forEach(function (sl) { (sl.acts || []).concat(sl.shown || []).forEach(function (k) { if (!sessOf[k]) sessOf[k] = sl.session || ""; }); });
    var title = function (k) { return (actDef(k) || {}).title || k; };
    var show = function (v) { return Array.isArray(v) ? v.join(", ") : v === true ? "Yes" : v === false ? "No" : v == null ? "" : String(v); };
    var when = function (t) { return t ? new Date(t).toLocaleString() : ""; };
    var itemOf = function (def, id) { return (def.items || []).filter(function (x) { return x.id === id; })[0]; };
    var optLabel = function (it, v) { var o = it && it.options ? it.options.filter(function (x) { return String(x[0]) === String(v); })[0] : null; return o ? o[1] : show(v); };

    var g = [["Session", "Activity", "Sheet", "Box", "Answer", "Sheet last saved"]];
    Object.keys(data.sheets).forEach(function (k) {
      data.sheets[k].forEach(function (sh) {
        var body = sh.body || {};
        Object.keys(body).filter(function (key) { return !/\._rows$/.test(key) && body[key] !== false && show(body[key]).trim() !== ""; })
          .map(function (key) {
            var val = show(body[key]);
            // Session 2: the choice per part reads as "Option B" or "A mix"
            if ((actDef(k) || {}).view === "choose" && /^pk\./.test(key)) val = val === "mix" ? "A mix" : "Option " + val;
            return [keyLabel(k, key), val];
          })
          .sort(function (a, b) { return a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0; })
          .forEach(function (x) { g.push([sessOf[k] || "", title(k), SHEET_NAMES[sh.sheet] || sh.sheet, x[0], x[1], when(sh.updated_at)]); });
      });
    });

    var pa = [["Session", "Activity", "Question", "Answer"]];
    Object.keys(data.answers).forEach(function (k) {
      var def = actDef(k) || {};
      data.answers[k].forEach(function (a) {
        var pl = a.payload || {}, it = itemOf(def, a.item), ans;
        if (def.d10) {
          var m = regionMin(pl.region);
          ans = (m ? m.name : show(pl.region)) + ": " + AG.routes.map(function (r) { return r[1] + " " + (+pl[r[0]] || 0) + "%"; }).join("; ") +
            (pl.oth_txt ? " (others: " + pl.oth_txt + ")" : "") + (pl.needs ? ". Needs: " + pl.needs : "");
          pa.push([sessOf[k] || "", title(k), "Region and routes", ans]); return;
        }
        ans = pl.text != null ? String(pl.text) : pl.v != null ? optLabel(it, pl.v) : JSON.stringify(pl);
        if (ans.trim() !== "") pa.push([sessOf[k] || "", title(k), it ? it.label : a.item, ans]);
      });
    });

    var vt = [["Session", "Activity", "Question", "Option", "Count"]];
    Object.keys(data.results).forEach(function (k) {
      var def = actDef(k) || {}, sum = {}, keys = [];
      data.results[k].forEach(function (r) { var key = r.item + "\u0001" + r.val; if (!(key in sum)) { sum[key] = 0; keys.push(key); } sum[key] += +r.n || 0; });
      keys.forEach(function (key) {
        var parts = key.split("\u0001"), it = itemOf(def, parts[0]);
        vt.push([sessOf[k] || "", title(k), it ? it.label : parts[0], optLabel(it, parts[1]), sum[key]]);
      });
    });

    var about = [["Room", data.room], ["Exported", when(data.exported_at)], ["Page version", data.page_version],
      ["Note", "Answers carry no names: the database does not record who gave them. Group sheets are per table, clinic or staff sheet."],
      ["History", data.history_note || "Included in the full backup (.json)."]];

    var wb = X.utils.book_new();
    var addSheet = function (rows, name, widths) { var ws = X.utils.aoa_to_sheet(rows); ws["!cols"] = widths.map(function (w) { return { wch: w }; }); X.utils.book_append_sheet(wb, ws, name); };
    addSheet(g, "Group sheets", [30, 36, 14, 60, 80, 20]);
    addSheet(pa, "Personal answers", [30, 36, 60, 80]);
    addSheet(vt, "Vote totals", [30, 36, 60, 40, 8]);
    addSheet(about, "About", [14, 100]);
    return wb;
  }

  // ---------- menu ----------
  function bind() {
    $("codeGo").addEventListener("click", gateGo);
    $("code").addEventListener("keydown", function (e) { if (e.key === "Enter") gateGo(); });
    $("menuBtn").addEventListener("click", function (e) {
      e.stopPropagation();
      var old = document.querySelector(".menu:not(.chippanel)"), cp = document.querySelector(".chippanel"); if (cp) cp.remove(); if (old) { old.remove(); return; }
      var m = el("div", { class: "menu", role: "menu" });
      if (S.role === "participant") m.appendChild(el("button", { type: "button", text: "Refresh", onclick: function () { m.remove(); pollNow().then(function () { render2(); }); } }));
      m.appendChild(el("button", { type: "button", text: "Leave this session", onclick: leave }));
      document.body.appendChild(m);
    });
    document.addEventListener("click", function () { [].forEach.call(document.querySelectorAll(".menu"), function (m) { m.remove(); }); });
  }
  function boot() {
    autoGrow(); bind(); resume();
    var saveNow = function () { if (!S.running) return; saveTyped(); clearTimeout(S.sqTimer); flushSheets(); };
    document.addEventListener("visibilitychange", function () { if (document.hidden) saveNow(); });
    window.addEventListener("pagehide", saveNow);
    window.addEventListener("beforeunload", function (e) {
      var typing = [].some.call(document.querySelectorAll("textarea"), function (x) { return x._dirty; });
      if (!S.running || (!typing && !Object.keys(S.sq || {}).length && !(S.queue || []).length)) return;
      e.preventDefault(); e.returnValue = "";
    });
  }
  if (MOCK) {
    var s = document.createElement("script"); s.src = "dev-room.js"; s.onload = boot; s.onerror = boot; document.head.appendChild(s);
  } else boot();
})();
