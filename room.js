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
    [].forEach.call(v.node.querySelectorAll("textarea"), function (x) { if (x._flush) x._flush(); });
    clear(v.node);
    var n = null; try { n = v.draw(v.data, v); } catch (e) { console.error(e); n = el("p", { class: "muted", text: "This part could not be drawn." }); }
    if (n) v.node.appendChild(n);
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
      if (pendingCell(parts[0], parts[1], k)) return;
      var v = sheetBody(parts[0], parts[1])[k];
      if (v === undefined) return;
      if (inp.type === "checkbox") inp.checked = !!v; else if (inp.value !== String(v)) inp.value = v;
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
  function resetView() { S.views = []; S.marks = {}; return clear($("view")); }
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
    rpc("room_save_sheet", { p_code: S.code, p_session: S.session, p_activity: parts[0], p_sheet: parts[1], p_patch: patch }).then(function (r) {
      S.sqBusy = false;
      if (r.ok) { S.sqSaved = true; lsSet(sqKey(), Object.keys(S.sq).length ? S.sq : undefined); flushSheets(); return; }
      lsSet(sqKey(), Object.keys(S.sq).length ? S.sq : undefined);
      toast(r.reason === "not_open" ? "The slide moved on. Your last change to the sheet was not saved." : "A change could not be saved (" + (r.reason || "unknown") + ").");
      setSave("fail"); flushSheets();
    }).catch(function () {
      // put the patch back and try again later
      S.sqBusy = false;
      var later = S.sq[q] || {};
      Object.keys(later).forEach(function (k) {
        if (/\._(add|del)$/.test(k)) patch[k] = [].concat(patch[k] || [], later[k]); else patch[k] = later[k];
      });
      S.sq[q] = patch; lsSet(sqKey(), S.sq); setSave("queued");
      clearTimeout(S.sqTimer); S.sqTimer = setTimeout(flushSheets, 5000);
    });
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
    var t; node.addEventListener("input", function () { clearTimeout(t); t = setTimeout(function () { queueCell(act, sheet, k, node.value); if (col.onSaved) col.onSaved(); }, 600); });
    // a redraw saves what is still waiting to be saved, so nothing typed is lost
    node._flush = function () { clearTimeout(t); if (String(sheetBody(act, sheet)[k] == null ? "" : sheetBody(act, sheet)[k]) !== node.value) queueCell(act, sheet, k, node.value); };
    node.addEventListener("blur", function () { clearTimeout(t); if (String(sheetBody(act, sheet)[k] == null ? "" : sheetBody(act, sheet)[k]) !== node.value) queueCell(act, sheet, k, node.value); if (col.onBlur) col.onBlur(); });
    return node;
  }
  function regMinNode(code) {
    var m = regionMin(code); if (!m) return el("div", { class: "regmin" });
    return el("div", { class: "regmin" }, el("span", { text: "Minimum to register: " }), el("b", { text: fmtN(m.register) }), el("span", { text: " · to screen: " }), el("b", { text: fmtN(m.screen) }));
  }
  // the sections of a sheet; the Session 7 indicator sheets build theirs from what Session 6 agreed
  var IND_COLS = [
    { id: "indicator", label: "What would show it is working (the indicator)" },
    { id: "level", label: "Level where it is measured", type: "multi", options: AG.levels },
    { id: "source", label: "Data source" },
    { id: "use", label: "Who uses it, to decide what" }];
  function agreedFor(clinicSheet) { var a = sheetBody("s6_merge", "ROOM")["agreed." + clinicSheet]; return Array.isArray(a) ? a : []; }
  function sectionsFor(act, def) {
    if (def.view !== "ind") return def.sections || [];
    var secs = agreedFor(def.from).map(function (c) {
      return { id: "k" + fnv(c.key), title: c.topic, note: [["Guide question", c.q], ["Agreed how", c.how], ["Who will implement", c.who]], type: "rows", add: "Add another indicator", preset: [""], presetCol: "indicator", cols: IND_COLS };
    });
    secs.push({ id: "add", title: "Components the clinic adds", type: "rows", add: "Add a component", cols: [{ id: "component", label: "Component" }].concat(IND_COLS) });
    return secs;
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
      if (sec.type === "rows") {
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
            var f = el("label", { class: "sfield" + (col.type === "check" ? " check" : "") + (col.type === "multi" ? " wide" : "") }, el("span", { class: "slab", text: col.label }), input(act, sheet, k, val, col, editable));
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
    return [act].concat({ choose: ["s2_start"], test: ["s2_start", "s2_choose"], merge2: ["s2_start", "s2_choose"], merge6: ["c6_1", "c6_2", "c6_3"], ind: ["s6_merge", "ref_ind"] }[def.view] || [],
      def.showDirection ? ["s2_merge"] : []);
  }
  function viewFor(act, sheet, editable, v) {
    var def = ACT[act];
    if (def.view === "start") return editable ? sheetView(act, def, sheet, true, v) : startList();
    if (def.view === "choose") return chooseView(sheet, editable, v);
    if (def.view === "test") return testView(sheet, editable, v);
    if (def.view === "merge2") return merge2View(editable, v);
    if (def.view === "merge6") return merge6View(editable, v);
    if (def.view === "refind" && !editable) return refPanel(true);
    return sheetView(act, def, sheet, editable, v);
  }
  function sheetLive(act, sheet, editable) {
    return liveView({ deps: depsOf(act), draw: function (d, v) { return viewFor(act, sheet, editable, v); } });
  }

  // =====================================================================================
  // SESSION 2: starting elements, the table's choice, the statement, the test, the merge grid
  // =====================================================================================
  function startModel() {
    var b = sheetBody("s2_start", "ROOM"), sec = ACT.s2_start.sections, m = { groups: [], stakes: [], roles: [], stakeTheme: clean(b["m.theme"]) };
    var byPhrase = {};
    rowIds(sec[0], b).forEach(function (r) {
      var ph = clean(b["e." + r + ".phrase"]), txt = clean(b["e." + r + ".element"]), th = String(b["e." + r + ".theme"] || "").trim();
      if (!txt) return;
      var g = byPhrase[ph];
      if (!g) { g = byPhrase[ph] = { phrase: ph, h: "x" + fnv(ph), theme: th, els: [] }; m.groups.push(g); }
      if (!g.theme && th) g.theme = th;
      g.els.push({ rid: r, text: txt });
    });
    rowIds(sec[1], b).forEach(function (r) { var n = clean(b["s." + r + ".name"]); if (n) m.stakes.push({ rid: r, name: n }); });
    rowIds(sec[2], b).forEach(function (r) { var n = clean(b["r." + r + ".role"]); if (n) m.roles.push({ rid: r, role: n }); });
    return m;
  }
  // what one table chose, as sentences
  function tableChoice(m, b) {
    var c = { groups: [], stakes: [], others: [] };
    m.groups.forEach(function (g) {
      var texts = g.els.filter(function (e) { return b["el." + e.rid]; }).map(function (e) { return e.text; });
      addedRows(b, g.h).forEach(function (r) { var t = clean(b[g.h + "." + r + ".t"]); if (t) texts.push(t); });
      c.groups.push({ phrase: g.phrase, texts: texts });
    });
    function rolesOf(pre) {
      var rs = m.roles.filter(function (r) { return b[pre + ".r_" + r.rid]; }).map(function (r) { return r.role; });
      var o = clean(b[pre + ".other"]); if (o) rs.push(o);
      return rs;
    }
    m.stakes.forEach(function (s) { if (b["st." + s.rid]) c.stakes.push({ name: s.name, roles: rolesOf("st." + s.rid) }); });
    addedRows(b, "ns").forEach(function (r) { var n = clean(b["ns." + r + ".name"]); if (n) c.stakes.push({ name: n, roles: rolesOf("ns." + r) }); });
    addedRows(b, "o").forEach(function (r) { var t = clean(b["o." + r + ".t"]); if (t) c.others.push(t); });
    return c;
  }
  function statementOf(c) {
    var out = [];
    c.groups.forEach(function (g) { if (g.texts.length) out.push(cap((g.phrase ? g.phrase + " " : "") + joinAnd(g.texts)) + "."); });
    var first = true;
    c.stakes.forEach(function (s) {
      if (!s.roles.length) return;
      out.push((first ? "In each community, " + s.name : cap(s.name)) + " will " + joinAnd(s.roles) + ".");
      first = false;
    });
    c.others.forEach(function (t) { out.push("It also " + lowFirst(t) + "."); });
    return out.join(" ");
  }
  function statementBox(title, text, empty) {
    return el("div", { class: "statement" }, el("div", { class: "slab", text: title }), el("p", { text: text || empty || "Nothing chosen yet." }));
  }
  function directionText() { return String(sheetBody("s2_merge", "ROOM").statement || ""); }
  function directionBanner() { return statementBox("The direction agreed in Session 2", directionText(), "Staff have not recorded the agreed direction yet."); }
  // the starting elements, read-only (slide 2.1, room screen and phones)
  function startList() {
    var m = startModel(), box = el("div", { class: "startlist" }), last = null;
    if (!m.groups.length && !m.stakes.length) return el("p", { class: "muted", text: "The starting elements have not been entered yet (Staff sheets tab)." });
    box.appendChild(el("p", { class: "help", text: ACT.s2_start.intro.replace(" Staff enter or paste these before the session.", "") }));
    m.groups.forEach(function (g) {
      if (g.theme && g.theme !== last) { box.appendChild(el("div", { class: "theme", text: g.theme })); last = g.theme; }
      box.appendChild(el("div", { class: "phrase" }, el("b", { text: (g.phrase || "") + " …" }), el("ul", null, g.els.map(function (e) { return el("li", { text: e.text }); }))));
    });
    if (m.stakes.length) {
      if (m.stakeTheme) box.appendChild(el("div", { class: "theme", text: m.stakeTheme }));
      box.appendChild(el("div", { class: "phrase" }, el("b", { text: "In each community, … will …" }),
        el("p", { class: "small", text: "Stakeholders: " + m.stakes.map(function (s) { return s.name; }).join(" · ") }),
        el("p", { class: "small", text: "Roles to choose from: " + m.roles.map(function (r) { return r.role; }).join(" · ") })));
    }
    return box;
  }
  function chk(q, k, checked, label, disabled, onChange) {
    var cb = el("input", { type: "checkbox", "data-k": k, "data-q": q, checked: !!checked, disabled: !!disabled });
    cb.addEventListener("change", function () { onChange(cb.checked); });
    return el("label", { class: "ck" + (checked ? " sel" : "") + (disabled ? " off" : "") }, cb, el("span", { text: label }));
  }
  // slide 2.2: tick the elements, add your own under any sentence, the stakeholder role grid, and the statement
  function chooseView(sheet, editable, v) {
    var act = "s2_choose", q = sheetKey(act, sheet), b = sheetBody(act, sheet), m = startModel(), box = el("div", { class: "sheet choose" }), last = null;
    if (!m.groups.length && !m.stakes.length) return el("p", { class: "muted", text: "The starting elements are not ready yet. Wait for your facilitator." });
    var redraw = function () { if (v) v.redraw(); };
    var set = function (k, val) { queueCell(act, sheet, k, val); redraw(); };
    // typing in an added line updates the statement as soon as it is saved, without redrawing the boxes
    var restate = function () { var p = box.querySelector(".statement p"); if (p) p.textContent = statementOf(tableChoice(m, sheetBody(act, sheet))) || "Nothing chosen yet."; };
    function addedList(secId, label) {
      var wrap = el("div");
      addedRows(b, secId).forEach(function (r) {
        var k = secId + "." + r + ".t";
        if (!editable) { if (clean(b[k])) wrap.appendChild(el("div", { class: "ck sel added" }, el("span", { text: "+ " + clean(b[k]) + " (added)" }))); return; }
        wrap.appendChild(el("div", { class: "addrow" }, input(act, sheet, k, b[k] || "", { label: label, placeholder: "Type it here", onBlur: redraw, onSaved: restate }, true),
          el("button", { type: "button", class: "linkbtn", text: "Remove", onclick: function () { queueRow(act, sheet, secId, "del", r); redraw(); } })));
      });
      if (editable) wrap.appendChild(el("button", { type: "button", class: "btn ghost small", text: "+ " + label, onclick: function () { queueRow(act, sheet, secId, "add", rid()); redraw(); } }));
      return wrap;
    }
    m.groups.forEach(function (g) {
      if (g.theme && g.theme !== last) { box.appendChild(el("div", { class: "theme", text: g.theme })); last = g.theme; }
      var sec = el("div", { class: "phrase" }, el("b", { text: (g.phrase || "") + " …" }));
      g.els.forEach(function (e) {
        var k = "el." + e.rid;
        if (!editable && !b[k]) { sec.appendChild(el("div", { class: "ck off", text: e.text })); return; }
        sec.appendChild(editable ? chk(q, k, b[k], e.text, false, function (on) { set(k, on); }) : el("div", { class: "ck sel", text: "✓ " + e.text }));
      });
      sec.appendChild(addedList(g.h, "Add to this sentence"));
      box.appendChild(sec);
    });
    // stakeholder role grid: tick a stakeholder first, then its roles
    if (m.stakes.length || addedRows(b, "ns").length) {
      if (m.stakeTheme) box.appendChild(el("div", { class: "theme", text: m.stakeTheme }));
      var grid = el("div", { class: "phrase" }, el("b", { text: "In each community, … will …" }), el("p", { class: "help", text: "Tick each stakeholder that has a role, then choose its roles." }));
      function rolesFor(pre, on) {
        var rbox = el("div", { class: "roles" + (on ? "" : " off") });
        m.roles.forEach(function (r) {
          var k = pre + ".r_" + r.rid;
          if (!editable) { if (b[k]) rbox.appendChild(el("span", { class: "rolechip", text: r.role })); return; }
          rbox.appendChild(chk(q, k, b[k], r.role, !on, function (x) { set(k, x); }));
        });
        var ok = pre + ".other";
        if (editable) rbox.appendChild(el("label", { class: "sfield" }, el("span", { class: "slab", text: "Another role" }), on ? input(act, sheet, ok, b[ok] || "", { label: "Another role", onBlur: redraw, onSaved: restate }, true) : el("div", { class: "cellro muted", text: "" })));
        else if (clean(b[ok])) rbox.appendChild(el("span", { class: "rolechip", text: clean(b[ok]) }));
        return rbox;
      }
      m.stakes.forEach(function (s) {
        var k = "st." + s.rid, on = !!b[k], row = el("div", { class: "stake" + (on ? " on" : "") });
        if (!editable && !on) return;
        row.appendChild(editable ? chk(q, k, on, s.name, false, function (x) {
          queueCell(act, sheet, k, x);
          if (!x) { m.roles.forEach(function (r) { if (b["st." + s.rid + ".r_" + r.rid]) queueCell(act, sheet, "st." + s.rid + ".r_" + r.rid, false); }); if (b["st." + s.rid + ".other"]) queueCell(act, sheet, "st." + s.rid + ".other", ""); }
          redraw();
        }) : el("b", { text: s.name }));
        row.appendChild(rolesFor("st." + s.rid, on));
        grid.appendChild(row);
      });
      addedRows(b, "ns").forEach(function (r) {
        var pre = "ns." + r, row = el("div", { class: "stake on" });
        if (editable) row.appendChild(el("div", { class: "addrow" }, input(act, sheet, pre + ".name", b[pre + ".name"] || "", { label: "Stakeholder you add", placeholder: "Stakeholder", onBlur: redraw, onSaved: restate }, true),
          el("button", { type: "button", class: "linkbtn", text: "Remove", onclick: function () { queueRow(act, sheet, "ns", "del", r); redraw(); } })));
        else row.appendChild(el("b", { text: clean(b[pre + ".name"]) + " (added)" }));
        row.appendChild(rolesFor(pre, true));
        grid.appendChild(row);
      });
      if (editable) grid.appendChild(el("button", { type: "button", class: "btn ghost small", text: "+ Add a stakeholder", onclick: function () { queueRow(act, sheet, "ns", "add", rid()); redraw(); } }));
      box.appendChild(grid);
    }
    var other = el("div", { class: "phrase" }, el("b", { text: "Anything that fits no sentence above" }));
    other.appendChild(addedList("o", "Add something else"));
    if (editable || addedRows(b, "o").length) box.appendChild(other);
    var stmt = statementBox(SHEET_NAMES[sheet] + (editable ? ": your direction" : ": the table's direction"), statementOf(tableChoice(m, b)));
    // read-only (presented on the screen): the statement first, then what was ticked
    if (editable) box.appendChild(stmt); else box.insertBefore(stmt, box.firstChild);
    return box;
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
    box.appendChild(statementBox(SHEET_NAMES[sheet] + ": the direction you are scoring", statementOf(tableChoice(startModel(), sheetBody("s2_choose", sheet))), "This table did not choose any elements on slide 2.2."));
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
  // the merge grid (staff): what each table chose; the final agreed column; push a row to a quick vote
  function merge2Rows() {
    var m = startModel(), rows = [];
    var tb = {}; TABLES.forEach(function (t) { tb[t] = sheetBody("s2_choose", t); });
    var lastTheme = null;
    m.groups.forEach(function (g) {
      rows.push({ head: g.phrase + " …", theme: g.theme !== lastTheme ? g.theme : "" }); lastTheme = g.theme;
      g.els.forEach(function (e) {
        rows.push({ key: "e_" + e.rid, kind: "el", phrase: g.phrase, text: e.text, ticks: TABLES.map(function (t) { return !!tb[t]["el." + e.rid]; }) });
      });
      TABLES.forEach(function (t) {
        addedRows(tb[t], g.h).forEach(function (r) {
          var txt = clean(tb[t][g.h + "." + r + ".t"]); if (!txt) return;
          rows.push({ key: "x_" + t + "_" + g.h + "_" + r, kind: "el", phrase: g.phrase, text: txt, by: t, ticks: TABLES.map(function (x) { return x === t; }) });
        });
      });
    });
    function roles(b, pre) {
      var rs = m.roles.filter(function (r) { return b[pre + ".r_" + r.rid]; }).map(function (r) { return r.role; });
      var o = clean(b[pre + ".other"]); if (o) rs.push(o); return rs;
    }
    var stakeRows = [];
    m.stakes.forEach(function (s) {
      stakeRows.push({ key: "s_" + s.rid, kind: "stake", text: s.name, roles: TABLES.map(function (t) { return tb[t]["st." + s.rid] ? roles(tb[t], "st." + s.rid) : null; }) });
    });
    TABLES.forEach(function (t) {
      addedRows(tb[t], "ns").forEach(function (r) {
        var n = clean(tb[t]["ns." + r + ".name"]); if (!n) return;
        stakeRows.push({ key: "ns_" + t + "_" + r, kind: "stake", text: n, by: t, roles: TABLES.map(function (x) { return x === t ? roles(tb[t], "ns." + r) : null; }) });
      });
    });
    if (stakeRows.length) { rows.push({ head: "In each community, … will …", theme: m.stakeTheme }); rows = rows.concat(stakeRows); }
    var others = [];
    TABLES.forEach(function (t) { addedRows(tb[t], "o").forEach(function (r) { var txt = clean(tb[t]["o." + r + ".t"]); if (txt) others.push({ key: "o_" + t + "_" + r, kind: "other", text: txt, by: t, ticks: TABLES.map(function (x) { return x === t; }) }); }); });
    if (others.length) { rows.push({ head: "Anything that fits no sentence (\"It also …\")" }); rows = rows.concat(others); }
    return rows;
  }
  function mergeStatement(rows, mb) {
    var c = { groups: [], stakes: [], others: [] }, gi = {};
    rows.forEach(function (r) {
      if (r.head) return;
      var f = clean(mb["f." + r.key]); if (!f) return;
      if (r.kind === "el") { if (!(r.phrase in gi)) { gi[r.phrase] = c.groups.length; c.groups.push({ phrase: r.phrase, texts: [] }); } c.groups[gi[r.phrase]].texts.push(f); }
      else if (r.kind === "stake") c.stakes.push({ name: r.text, roles: [f] });
      else c.others.push(f);
    });
    return statementOf(c);
  }
  function merge2View(editable, v) {
    var rows = merge2Rows(), mb = sheetBody("s2_merge", "ROOM"), q = sheetKey("s2_merge", "ROOM"), box = el("div", { class: "merge" });
    if (!rows.length) return el("p", { class: "muted", text: "No starting elements yet." });
    function saveFinal(k, val) {
      queueCell("s2_merge", "ROOM", "f." + k, val);
      var text = mergeStatement(rows, sheetBody("s2_merge", "ROOM"));
      queueCell("s2_merge", "ROOM", "statement", text);
      var p = box.querySelector(".merge > .statement p"); if (p) p.textContent = text || "Nothing chosen yet.";
    }
    var tb = el("table", { class: "restable mtable" }), head = el("tr", null, el("th", { text: "Element" }));
    TABLES.forEach(function (t) { head.appendChild(el("th", { text: SHEET_NAMES[t] })); });
    head.appendChild(el("th", { text: "Tables" })); head.appendChild(el("th", { text: "Final agreed element" }));
    tb.appendChild(head);
    rows.forEach(function (r) {
      if (r.head) { tb.appendChild(el("tr", { class: "mhead" }, el("td", { colspan: String(TABLES.length + 3) }, r.theme ? el("div", { class: "theme", text: r.theme }) : null, el("b", { text: r.head })))); return; }
      var tr = el("tr");
      tr.appendChild(el("td", null, el("div", { text: r.text }), r.by ? el("div", { class: "muted small", text: "added by " + SHEET_NAMES[r.by] }) : null));
      var n = 0;
      TABLES.forEach(function (t, i) {
        if (r.kind === "stake") { var rs = r.roles[i]; if (rs) n++; tr.appendChild(el("td", { class: "small" }, rs ? (rs.length ? rs.join(", ") : "ticked, no role") : "—")); }
        else { if (r.ticks[i]) n++; tr.appendChild(el("td", { class: "n", text: r.ticks[i] ? "✓" : "" })); }
      });
      tr.appendChild(el("td", { class: "n", text: String(n) }));
      var fk = "f." + r.key, fv = mb[fk] || "", fin = el("td", { class: "final" });
      if (editable) {
        var ta = el("textarea", { "data-k": fk, "data-q": q, rows: "2", value: fv, "aria-label": "Final agreed element", placeholder: r.kind === "stake" ? "Agreed roles, e.g. lead and coordinate" : "Leave empty to leave it out" });
        var t0; ta.addEventListener("input", function () { clearTimeout(t0); t0 = setTimeout(function () { saveFinal(r.key, ta.value); }, 600); });
        ta.addEventListener("blur", function () { clearTimeout(t0); if ((sheetBody("s2_merge", "ROOM")[fk] || "") !== ta.value) saveFinal(r.key, ta.value); if (v) v.redraw(); });
        fin.appendChild(ta);
        var acts = el("div", { class: "row tight" });
        if (r.kind === "stake") {
          TABLES.forEach(function (t, i) { var rs = r.roles[i]; if (rs && rs.length) acts.appendChild(el("button", { type: "button", class: "linkbtn", text: "Copy " + SHEET_NAMES[t], onclick: function () { saveFinal(r.key, joinAnd(rs)); if (v) v.redraw(); } })); });
        } else acts.appendChild(el("button", { type: "button", class: "linkbtn", text: "Copy the wording", onclick: function () { saveFinal(r.key, r.text); if (v) v.redraw(); } }));
        acts.appendChild(el("button", { type: "button", class: "linkbtn", text: "Push to poll", onclick: function () { S.pollDraft = r.key; if (v) v.redraw(); } }));
        fin.appendChild(acts);
        if (S.pollDraft === r.key) fin.appendChild(pollDraftForm(r.kind === "stake" ? r.text + " will …?" : "Include in the direction: " + (r.phrase ? r.phrase + " " : "") + r.text + "?",
          r.kind === "stake" ? r.roles.filter(function (x) { return x && x.length; }).map(joinAnd).concat(["Leave out"]).slice(0, 5) : ["Include", "Leave out"], v));
      } else fin.appendChild(el("div", { text: clean(fv) }));
      tr.appendChild(fin);
      tb.appendChild(tr);
    });
    box.appendChild(el("div", { class: "mscroll" }, tb));
    box.appendChild(statementBox("The one direction (from the final column)", String(mb.statement || mergeStatement(rows, mb))));
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
            var t = el("textarea", { "data-k": k, "data-q": q, rows: "2", value: mb[k] || "", "aria-label": label }), tm;
            t.addEventListener("input", function () { clearTimeout(tm); tm = setTimeout(function () { save(k, t.value); }, 600); });
            t.addEventListener("blur", function () { clearTimeout(tm); if ((sheetBody("s6_merge", "ROOM")[k] || "") !== t.value) save(k, t.value); if (v) v.redraw(); });
            return t;
          }
          var ans = el("td", { class: "small" }, r.how ? el("div", null, el("b", { text: "How: " }), r.how) : el("div", { class: "muted", text: "No answer" }),
            r.decide ? el("div", null, el("b", { text: "Still to decide: " }), r.decide) : null, r.who ? el("div", null, el("b", { text: "Who: " }), r.who) : null);
          var acts = el("div", { class: "row tight" },
            r.how ? el("button", { type: "button", class: "linkbtn", text: "Copy the how", onclick: function () { save(hk, r.how); if (v) v.redraw(); } }) : null,
            r.who ? el("button", { type: "button", class: "linkbtn", text: "Copy the who", onclick: function () { save(wk, r.who); if (v) v.redraw(); } }) : null,
            el("button", { type: "button", class: "linkbtn", text: "Push to poll", onclick: function () { S.pollDraft = r.key; if (v) v.redraw(); } }));
          var fin = el("td", { class: "final" }, ta(hk, "Agreed how"), acts);
          if (S.pollDraft === r.key) fin.appendChild(pollDraftForm("Agree: " + (r.how || r.q) + "?", ["Agree", "Change it", "Leave out"], v));
          tb.appendChild(el("tr", null, el("td", { class: "small" }, r.added ? el("span", { class: "muted", text: "Added: " }) : null, r.q || ""), ans, fin, el("td", { class: "final" }, ta(wk, "Agreed: who will implement"))));
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
    var any = false;
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
    view.appendChild(el("details", { class: "apanel locked small guide" }, el("summary", { text: "Table guide (D11)" }),
      AG.guide.map(function (g) { return el("div", null, el("b", { text: g[0] }), el("p", { text: g[1] })); })));
    view.appendChild(checkinPanel());
  }
  function render2() { S.sig = ""; renderPart(true); window.scrollTo(0, 0); }
  // a staff sheet shown on this slide (read-only on phones)
  function shownPanel(k) {
    var def = ACT[k], box = el("section", { class: "apanel locked" }, el("h3", { text: def.title }));
    if (def.view === "merge2") box.appendChild(liveView({ deps: ["s2_merge"], draw: function () { return statementBox("The one direction so far", directionText(), "Staff are recording what the tables agreed."); } }));
    else if (def.view === "merge6") box.appendChild(liveView({ deps: ["s6_merge"], draw: function () {
      var w = el("div");
      [1, 2, 3].forEach(function (n) { var sh = "C" + n, ag = agreedFor(sh); w.appendChild(el("div", { class: "statement" }, el("div", { class: "slab", text: SHEET_NAMES[sh] + ": agreed components" }), ag.length ? el("ol", null, ag.map(function (a) { return el("li", null, el("b", { text: a.topic + ": " }), a.how); })) : el("p", { class: "muted", text: "None recorded yet." }))); });
      return w;
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
  function checkinPanel() {
    var p = S.profile, box = el("section", { class: "apanel locked small" }, el("h3", { text: "You are checked in" }));
    box.appendChild(el("p", { style: "margin:0 0 10px", text: "Table " + p.table + " · " + p.grp + " · Pre-work: " + (p.prework === true ? "yes" : p.prework === false ? "no" : "not stated") }));
    box.appendChild(el("button", { type: "button", class: "btn ghost small", text: "Change this", onclick: function () {
      var holder = el("div"); box.appendChild(holder);
      profileForm(p, function (prof) { joinCall(prof).then(function (r) { if (r.ok) { S.profile = { session: S.session, grp: prof.grp, table: prof.table, prework: prof.prework }; lsSet(profileKey(S.code), S.profile); ssSet("pk_room_ps", JSON.stringify(S.profile)); updateLive(); render2(); toast("Saved."); } }); }, holder);
    } }));
    return box;
  }
  function linkPanel(def, state) {
    var u = evalUrl(), box = el("section", { class: "apanel" + (state === "open" ? "" : " locked") }, el("h3", { text: def.title }));
    if (u && state === "open") box.appendChild(el("p", null, el("a", { class: "btn", href: u, target: "_blank", rel: "noopener noreferrer", text: "Open the evaluation" })));
    else box.appendChild(el("p", { class: "help", style: "margin:0", text: "Your facilitator will share the evaluation link or QR code." }));
    return box;
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
    sbox.appendChild(el("p", { class: "help", text: state === "open" ? (def.intro || "") + " Anyone at the " + (def.clinic ? "clinic" : "table") + " can type here; changes appear on the other phones within a few seconds." : "Not open." }));
    sbox.appendChild(sheetLive(key, mine, state === "open"));
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
  function renderProj() {
    var s = curSlide(), sig = [s ? s.id : "wait", partSig(), JSON.stringify(setting("d2_weights") || {})].join("#");
    if (sig === S.sig) return;
    S.sig = sig;
    var view = resetView();
    if (!s || (!slideActs(s).length && !(s.shown || []).length)) { view.appendChild(el("div", { class: "standby", text: "PuroKalusugan · Direction Consultation" })); return; }
    var card = el("article", { class: "pcard" });
    card.appendChild(el("div", { class: "pkick", text: s.dayName.split(" · ")[0] + " · " + s.session }));
    card.appendChild(el("h2", { class: "ptitle", text: s.title }));
    (s.shown || []).forEach(function (k) {
      if (ACT[k].view === "merge2") card.appendChild(liveView({ deps: depsOf(k).concat(["s2_merge"]), draw: function () { return merge2View(false); } }));
      else if (ACT[k].view === "merge6") card.appendChild(liveView({ deps: depsOf(k).concat(["s6_merge"]), draw: function () { return merge6View(false); } }));
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
    var sig = [tab, S.st.slide_id, JSON.stringify(S.st.acts), JSON.stringify(S.st.settings), S.st.timer_end, S.openSheet, S.openReg, S.d10Each, S.pollDraft].join("~");
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
  function slideStaff(s, box) {
    box.appendChild(el("h3", { text: s.title }));
    if (!slideActs(s).length && !(s.shown || []).length) box.appendChild(el("p", { class: "muted", text: "Nothing on phones for this slide; phones show the waiting screen. " + (s.id === "s5_1" ? "Run the recap in plenary, with a show of hands if anything is contested." : "") }));
    (s.shown || []).forEach(function (k) {
      var def = ACT[k];
      box.appendChild(el("p", { class: "muted small", text: def.intro || "" }));
      if (def.view === "merge2" || def.view === "merge6") box.appendChild(sheetLive(k, "ROOM", true));
      else { box.appendChild(sheetLive(k, "ROOM", false)); box.appendChild(el("p", { class: "muted small", text: "Edit it on the Staff sheets tab." })); }
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
        box.appendChild(el("div", { class: "staffsheet" }, el("h4", { text: SHEET_NAMES[os[1]] + " · staff can edit at any time" }), sheetLive(os[0], os[1], true)));
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
    view.appendChild(el("p", { class: "muted", text: "Staff sheets. The starting elements and the pre-work indicators are entered here before the session, in both the trial and the live room." }));
    AG.registers.forEach(function (k) {
      var def = ACT[k], on = S.openReg === k, card = el("div", { class: "ctl" });
      card.appendChild(el("div", { class: "row" }, el("h3", { style: "margin:0", text: def.title }), el("button", { type: "button", class: "btn small" + (on ? "" : " ghost"), text: on ? "Close" : "Open", onclick: function () { S.openReg = on ? null : k; renderStaff(true); } })));
      if (on) {
        if (def.intro) card.appendChild(el("p", { class: "help", text: def.intro }));
        if (def.importable) card.appendChild(importBox(k));
        card.appendChild(sheetLive(k, "ROOM", true));
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
    c.appendChild(el("div", { class: "q" }, el("span", { class: "t", text: "How often devices check for changes" }), el("p", { class: "help", text: "Slower saves data on the free plan. Use 8 seconds or more if the usage page shows a high count." }), poll));
    c.appendChild(el("div", { class: "q" }, el("span", { class: "t", text: "Evaluation link (optional)" }), el("p", { class: "help", text: "The link your team provides. Phones show an Open button on the Evaluation slide. This link and the polling speed are shared with the " + (S.stage === "trial" ? "live" : "trial") + " room." }), url));
    c.appendChild(el("button", { type: "button", class: "btn", text: "Save settings", onclick: function () {
      var u = url.value.trim();
      if (u && !/^https:\/\/[^\s]+$/i.test(u)) { msg(out, "The evaluation link must start with https://", "err"); return; }
      staffSet({ settings: { poll_ms: +poll.value, eval_url: u } }).then(function () { msg(out, "Saved.", "ok"); });
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

  // ---------- menu ----------
  function bind() {
    $("codeGo").addEventListener("click", gateGo);
    $("code").addEventListener("keydown", function (e) { if (e.key === "Enter") gateGo(); });
    $("menuBtn").addEventListener("click", function (e) {
      e.stopPropagation();
      var old = document.querySelector(".menu"); if (old) { old.remove(); return; }
      var m = el("div", { class: "menu", role: "menu" });
      if (S.role === "participant") m.appendChild(el("button", { type: "button", text: "Refresh", onclick: function () { m.remove(); pollNow().then(function () { render2(); }); } }));
      m.appendChild(el("button", { type: "button", text: "Leave this session", onclick: leave }));
      document.body.appendChild(m);
    });
    document.addEventListener("click", function () { var m = document.querySelector(".menu"); if (m) m.remove(); });
  }
  function boot() { bind(); resume(); }
  if (MOCK) {
    var s = document.createElement("script"); s.src = "dev-room.js"; s.onload = boot; s.onerror = boot; document.head.appendChild(s);
  } else boot();
})();
