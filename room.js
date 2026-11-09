"use strict";
/* PK Direction Consultation: in-room module (activities only).
   The PowerPoint is presented separately. This page runs the activities so that everything collected is transparent:
   participants answer on their phones, staff open, close and reveal each activity, and the room screen shows the
   prompt, the live count and the revealed result.
   One page for four kinds of code: participant phone, group device, staff, room screen (projector).
   Everything is read and written through database functions that check the access code (see 09_room.sql, 12_room_trial.sql).
   The activity list is in agenda.js. The database field "slide_id" now holds the FOCUS: the activity shown on the room screen. */
(function () {
  var API = "https://drwmnzmvsjhlbixqcvew.supabase.co";
  var KEY = "sb_publishable_Vzh0zj3WvlhNqJg0wHV87w_bVwjmNdv";
  var MOCK = /^(localhost|127\.0\.0\.1)$/.test(location.hostname) && /[?&]mock=1/.test(location.search);
  var $ = function (id) { return document.getElementById(id); };

  var GROUPS = ["Regional", "Local implementers", "National level", "Other"];
  var COLORS = { yellow: "Idea", pink: "Concern", green: "Condition", blue: "Question for the Executive Committee" };
  var NOTE_WORDS = 100, TEXT_WORDS = 1500;
  var SHEETS = [["T1", "Table 1"], ["T2", "Table 2"], ["T3", "Table 3"], ["T4", "Table 4"], ["C1", "Clinic 1"], ["C2", "Clinic 2"], ["C3", "Clinic 3"]];
  var AG = window.PK_AGENDA, ACT = AG.activities, PROGRAM = AG.program;

  // every activity in program order, with where it sits in the program
  var ORDER = [];
  PROGRAM.forEach(function (d, di) {
    d.blocks.forEach(function (b) { b.acts.forEach(function (k) { if (!whereIs(k)) ORDER.push({ key: k, def: ACT[k], day: di, dayName: d.day, block: b }); }); });
  });
  function whereIs(key) { for (var i = 0; i < ORDER.length; i++) if (ORDER[i].key === key) return ORDER[i]; return null; }
  function titleOf(key) { return ACT[key] ? ACT[key].title : (key === "general" ? "General" : key || ""); }

  var S = {
    code: null, role: null, session: null, profile: {}, st: null, ver: null, skew: 0, joined: null, counts: {},
    tab: "acts", day: 0, mine: {}, queue: [], marks: {}, pollTimer: null, fails: 0, sig: "", showRes: {}, wall: [],
    tallyPick: 0, running: false, stage: "live", sheetData: {}, sheetState: {}, sq: {}, openSheet: null
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
  function wc(s) { s = (s || "").trim(); return s ? s.split(/\s+/).length : 0; }
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
  function stateLabel(v) { return { none: "Not open", open: "Open", closed: "Closed", revealed: "Revealed" }[v] || "Not open"; }
  function focusKey() { return (S.st && S.st.slide_id) || ""; }
  function pollMs() { var n = +(S.st && S.st.settings && S.st.settings.poll_ms) || 5000; return Math.max(2000, Math.min(30000, n)); }
  function setting(k) { return S.st && S.st.settings ? S.st.settings[k] : undefined; }
  function evalUrl() { var u = setting("eval_url"); return typeof u === "string" && /^https:\/\/[^\s]+$/i.test(u) ? u : ""; }
  function notesOn() { return actState("notes") === "open"; }
  function noteColors() {
    var c = setting("note_colors");
    c = Array.isArray(c) ? c.filter(function (x) { return COLORS[x]; }) : ["yellow", "pink", "green", "blue"];
    return c;
  }
  function isStaff() { return S.role === "staff"; }
  function isProj() { return S.role === "projector"; }
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

  // ---------- save queue (answers survive a dropped connection) ----------
  function mk(act, item) { return act + "|" + item; }
  function setSave(state) {
    var n = $("saveState"); n.hidden = !state; n.className = "save" + (state === "queued" || state === "fail" ? " warn" : "");
    n.textContent = { saving: "Saving...", saved: "Saved", queued: "Saved here. Will send later.", fail: "Not saved. Tell the PK team." }[state] || "";
  }
  function setMark(key, state) {
    var n = S.marks[key]; if (!n || !document.body.contains(n)) return;
    n.textContent = { saving: "Saving...", saved: "Saved", queued: "Saved here. Will send later.", closed: "Not saved: closed" }[state] || "";
    n.className = "saved-mark" + (state === "saved" ? "" : " pending");
  }
  function loadQueue() { S.queue = lsGet("pk_room_q_" + fnv(S.code)) || []; }
  function saveQueue() { lsSet("pk_room_q_" + fnv(S.code), S.queue.length ? S.queue : undefined); }
  function saveItem(act, item, payload) {
    var key = mk(act, item);
    S.mine[key] = payload;
    S.queue = S.queue.filter(function (q) { return mk(q.act, q.item) !== key; });
    S.queue.push({ act: act, item: item, payload: payload });
    saveQueue(); setSave("saving"); setMark(key, "saving"); flush();
  }
  function flush() {
    if (S.flushing || !S.queue.length) { if (!S.queue.length && S.role === "participant") setSave(S.hadSave ? "saved" : null); return; }
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
      toast(r.reason === "not_open" ? "That activity closed before your answer was saved." : "Your answer could not be saved. Tell the PK team.");
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
      msg(out, "");
      S.code = code; S.role = r.role; applyStage(r.stage);
      var p = lsGet(profileKey(code)) || {};
      S.session = p.session || uuid(); S.profile = p;
      if (r.role === "participant") profileForm(p, function (prof) { startJoin(prof); });
      else if (r.role === "device") sheetForm(p, function (prof) { startJoin(prof); });
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
  function sheetForm(p, done, host) {
    var box = clear(host || $("joinForm")), sheet = p.sheet || null, out = el("div");
    box.appendChild(el("hr", { class: "hr" }));
    box.appendChild(el("h3", { text: "Which table or clinic is this device for?", style: "margin-top:0" }));
    box.appendChild(radioGroup("sheet", SHEETS, sheet, function (x) { sheet = x; }));
    box.appendChild(el("div", { style: "margin-top:14px" }, el("button", { type: "button", class: "btn", text: "Continue", onclick: function () {
      if (!sheet) { msg(out, "Please choose a table or clinic.", "err"); return; }
      done({ sheet: sheet });
    } })));
    box.appendChild(out);
  }
  function joinCall(prof) {
    return rpc("room_join", { p_code: S.code, p_session: S.session, p_grp: prof.grp || null, p_table: prof.table || null, p_sheet: prof.sheet || null, p_prework: prof.prework === undefined ? null : prof.prework });
  }
  function startJoin(prof) {
    joinCall(prof).then(function (r) {
      if (!r.ok) {
        var why = { need_group_and_table: "Please choose your table and your group.", need_sheet: "Please choose a table or clinic.", invalid: "That code is not open." }[r.reason] || "Could not join. Please try again.";
        msg($("gateMsg"), why, "err"); return;
      }
      S.profile = { session: S.session, grp: prof.grp, table: prof.table, sheet: prof.sheet, prework: prof.prework };
      lsSet(profileKey(S.code), S.profile); ssSet("pk_room_cur", S.code);
      startApp();
    }).catch(function () { msg($("gateMsg"), "Could not reach the server. Check the connection and try again.", "err"); });
  }
  function resume() {
    var cur = ssGet("pk_room_cur"); if (!cur) return;
    var p = lsGet(profileKey(cur)); if (!p || !p.session) return;
    S.code = cur; S.session = p.session; S.profile = p;
    rpc("room_get_state", { p_code: cur, p_session: null, p_since: null }).then(function (r) {
      if (!r.ok) { ssSet("pk_room_cur", null); return; }
      S.role = r.role; applyStage(r.stage);
      joinCall(p).then(function (j) { if (j.ok) startApp(); });
    }).catch(function () {});
  }
  function leave() {
    clearTimeout(S.pollTimer); S.running = false;
    ssSet("pk_room_cur", null);
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
    chip.textContent = ({ staff: "Staff", projector: "Room screen", participant: S.profile.table ? "Table " + S.profile.table + " · " + S.profile.grp : "Participant", device: (SHEETS.filter(function (s) { return s[0] === S.profile.sheet; })[0] || [0, "Group device"])[1] })[S.role] + (isStaff() && S.joined != null ? " · " + S.joined + " online" : "");
    [].forEach.call(document.querySelectorAll("[data-count]"), function (n) {
      var c = S.counts[n.getAttribute("data-count")] || 0;
      n.textContent = isProj() ? c + (c === 1 ? " response received" : " responses received") : c + (c === 1 ? " response" : " responses");
    });
    if (S.fails === 0 && $("saveState").className.indexOf("warn") >= 0 && !S.queue.length) setSave(S.hadSave ? "saved" : null);
  }
  document.addEventListener("visibilitychange", function () { if (!document.hidden && S.running) pollNow(); });
  window.addEventListener("online", function () { if (S.running) { pollNow(); flush(); flushSheets(); } });

  // ---------- render dispatch ----------
  function render() {
    if (!S.running || !S.st) return;
    if (isStaff()) renderStaff(); else if (isProj()) renderProj(); else renderPart();
  }
  function buildTabs() {
    var nav = $("tabs"); clear(nav); nav.hidden = !isStaff();
    if (!isStaff()) return;
    [["acts", "Activities"], ["notes", "Notes"], ["paper", "Paper entries"], ["settings", "Settings"]].forEach(function (t) {
      nav.appendChild(el("button", { type: "button", class: "rtab", role: "tab", "aria-selected": S.tab === t[0] ? "true" : "false", "data-tab": t[0], text: t[1], onclick: function () {
        S.tab = t[0];
        [].forEach.call(nav.children, function (b) { b.setAttribute("aria-selected", b.getAttribute("data-tab") === S.tab ? "true" : "false"); });
        S.sig = ""; renderStaff(true);
      } }));
    });
  }

  // ---------- participants and group devices: only the answer controls ----------
  function openKeys() {
    var acts = (S.st && S.st.acts) || {}, out = [];
    ORDER.forEach(function (o) { if (acts[o.key] === "open") out.push(o.key); });
    return out;
  }
  function partSig() {
    var f = focusKey(), parts = [openKeys().join(","), f + "=" + actState(f), notesOn() ? "n:" + noteColors().join(",") : "", evalUrl()];
    return parts.join("~");
  }
  function renderPart(force) {
    var view = $("view"), sig = partSig();
    if (!force && sig === S.sig) return;
    S.sig = sig; S.marks = {};
    clear(view);
    var shown = openKeys(), f = focusKey();
    if (f && shown.indexOf(f) < 0 && ACT[f] && (actState(f) === "closed" || actState(f) === "revealed")) shown.push(f);
    var any = false;
    shown.forEach(function (key) { var n = activityPanel(key); if (n) { view.appendChild(n); any = true; } });
    if (notesOn()) { view.appendChild(notesPanel()); any = true; }
    if (!any) {
      view.appendChild(el("div", { class: "card wait" }, el("h2", { text: "Waiting for the next activity" }),
        el("p", { class: "muted", style: "margin:0", text: "Your facilitators will tell you when to start. This page updates by itself." })));
    }
    if (S.role === "device") view.appendChild(el("details", { class: "apanel locked small guide" }, el("summary", { text: "Table guide (D11)" }),
      AG.guide.map(function (g) { return el("div", null, el("b", { text: g[0] }), el("p", { text: g[1] })); })));
    view.appendChild(checkinPanel());
  }
  function render2() { S.sig = ""; renderPart(true); window.scrollTo(0, 0); }

  function activityPanel(key) {
    var def = ACT[key], state = actState(key);
    if (!def) return null;
    if (def.kind === "link") return linkPanel(def, state);
    if (def.kind === "sheet") {
      if (def.staffOnly) return null;
      var head = el("h3", null, def.title, " ", el("span", { class: "state " + state, text: stateLabel(state) }));
      if (S.role === "device") {
        var mine = deviceSheetFor(def);
        if (!mine) return null;
        var sbox = el("section", { class: "apanel sheetpanel" + (state === "open" ? "" : " locked") }, head);
        sbox.appendChild(el("p", { class: "help", text: state === "open" ? def.intro : state === "closed" ? "Closed. The sheet is saved; staff can still correct it." : "This sheet is on the room screen." }));
        if (def.spreadOf) sbox.appendChild(el("div", { id: "spread_" + key }, el("p", { class: "muted small", text: "Loading your table's silent scores..." })));
        var holder = el("div");
        holder.appendChild(editorFor(key, def, mine, state === "open"));
        sbox.appendChild(holder);
        loadSheets(key).then(function () { redrawSheet(key, mine); }).catch(function () {});
        if (def.spreadOf) loadSpread(key, def);
        return sbox;
      }
      if (state !== "open") return null;
      return el("section", { class: "apanel locked" }, head, el("p", { class: "help", style: "margin:0", text: "This activity is done at your table, on the table's device. Follow your facilitator." }));
    }
    if (def.kind === "gallery") {
      var gbox = el("section", { class: "apanel" + (state === "open" ? "" : " locked") }, el("h3", null, def.title, " ", el("span", { class: "state " + state, text: stateLabel(state) })));
      if (S.role === "device") { gbox.appendChild(el("p", { class: "help", style: "margin:0", text: "Each person marks indicators on their own phone." })); return gbox; }
      if (state !== "open") { gbox.appendChild(el("p", { class: "help", style: "margin:0", text: state === "closed" ? "This activity is closed." : "The result is on the screen." })); return gbox; }
      galleryPanel(key, def, gbox);
      return gbox;
    }
    var box = el("section", { class: "apanel" + (state === "open" ? "" : " locked") });
    box.appendChild(el("h3", null, def.title, " ", el("span", { class: "state " + state, text: stateLabel(state) })));
    if (state !== "open") {
      box.appendChild(el("p", { class: "help", style: "margin:0 0 10px", text: state === "closed" ? "This activity is closed." : "The result is on the screen." }));
      var shown = false;
      if (def.grid) { box.appendChild(el("p", { class: "help", style: "margin:0", text: "Your scores are saved." })); return box; }
      def.items.forEach(function (it) {
        var m = S.mine[mk(key, it.id)]; if (!m) return;
        if (!shown) { box.appendChild(el("div", { class: "help", style: "margin-top:6px", text: "Your saved answer:" })); shown = true; }
        box.appendChild(el("div", { text: it.label + ": " + answerText(it, m) }));
      });
      return box;
    }
    if (S.role === "device") { box.appendChild(el("p", { class: "help", text: "Personal answers are entered on each person's own phone. The facilitators will tell you how this table takes part." })); return box; }
    if (def.grid) { box.appendChild(gridBlock(key, def)); return box; }
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
    } else if (it.type === "multi") {
      var chosen = (cur && Array.isArray(cur.v)) ? cur.v.slice() : [], wrap = el("div", { class: "opts" });
      it.options.forEach(function (o) {
        var inp = el("input", { type: "checkbox", value: o[0], checked: chosen.indexOf(o[0]) >= 0 });
        var l = el("label", { class: "opt" + (chosen.indexOf(o[0]) >= 0 ? " sel" : "") }, inp, el("span", { text: o[1] }));
        inp.addEventListener("change", function () {
          var i = chosen.indexOf(o[0]); if (inp.checked && i < 0) chosen.push(o[0]); if (!inp.checked && i >= 0) chosen.splice(i, 1);
          l.classList.toggle("sel", inp.checked); saveItem(key, it.id, { v: chosen.slice() }); after();
        });
        wrap.appendChild(l);
      });
      q.appendChild(wrap);
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
  function checkinPanel() {
    var p = S.profile, box = el("section", { class: "apanel locked small" }, el("h3", { text: "You are checked in" }));
    if (S.role === "device") box.appendChild(el("p", { style: "margin:0 0 10px", text: "This device is set up as " + (SHEETS.filter(function (s) { return s[0] === p.sheet; })[0] || [0, "a group device"])[1] + "." }));
    else box.appendChild(el("p", { style: "margin:0 0 10px", text: "Table " + p.table + " · " + p.grp + " · Pre-work: " + (p.prework === true ? "yes" : p.prework === false ? "no" : "not stated") }));
    box.appendChild(el("button", { type: "button", class: "btn ghost small", text: "Change this", onclick: function () {
      var holder = el("div"); box.appendChild(holder);
      var done = function (prof) { joinCall(prof).then(function (r) { if (r.ok) { S.profile = { session: S.session, grp: prof.grp, table: prof.table, sheet: prof.sheet, prework: prof.prework }; lsSet(profileKey(S.code), S.profile); updateLive(); render2(); toast("Saved."); } }); };
      (S.role === "device" ? sheetForm : profileForm)(p, done, holder);
    } }));
    return box;
  }
  function linkPanel(def, state) {
    var u = evalUrl(), box = el("section", { class: "apanel" + (state === "open" ? "" : " locked") }, el("h3", null, def.title, " ", el("span", { class: "state " + state, text: stateLabel(state) })));
    if (u && state === "open") box.appendChild(el("p", null, el("a", { class: "btn", href: u, target: "_blank", rel: "noopener noreferrer", text: "Open the evaluation" })));
    else box.appendChild(el("p", { class: "help", style: "margin:0", text: state === "open" ? "Your facilitator will share the evaluation link or QR code." : "Not open yet." }));
    return box;
  }
  function notesPanel() {
    var colors = noteColors();
    var pick = colors[0], box = el("section", { class: "apanel" }, el("h3", { text: "Sticky notes" }),
      el("p", { class: "help", text: "Write one idea per note, up to " + NOTE_WORDS + " words. Your facilitator reads them to the room." }));
    var flow = el("div", { class: "nflow", role: "group", "aria-label": "Note color" });
    colors.forEach(function (c) {
      flow.appendChild(el("button", { type: "button", class: "cpick c-" + c, "aria-pressed": c === pick ? "true" : "false", text: COLORS[c], onclick: function () {
        pick = c; [].forEach.call(flow.children, function (b) { b.setAttribute("aria-pressed", "false"); }); this.setAttribute("aria-pressed", "true"); } }));
    });
    var ta = el("textarea", { class: "nbody", "aria-label": "Note text" }), cnt = el("div", { class: "counter" }), list = el("div", { class: "mynotes" }), out = el("div");
    function count() { var n = wc(ta.value); cnt.textContent = n + " / " + NOTE_WORDS + " words"; cnt.className = "counter" + (n > NOTE_WORDS ? " over" : ""); return n; }
    ta.addEventListener("input", count); count();
    var send = el("button", { type: "button", class: "btn small", text: "Add note", onclick: function () {
      if (!ta.value.trim()) { msg(out, "Please write something first.", "err"); return; }
      if (wc(ta.value) > NOTE_WORDS) { msg(out, "Please keep a note to " + NOTE_WORDS + " words or fewer.", "err"); return; }
      send.disabled = true;
      rpc("room_add_note", { p_code: S.code, p_session: S.session, p_color: pick, p_body: ta.value.trim(), p_slide: focusKey() || "general" }).then(function (r) {
        send.disabled = false;
        if (r.ok) { ta.value = ""; count(); msg(out, ""); toast("Note added."); loadMine(); } else msg(out, "The note could not be added. Please try again.", "err");
      }).catch(function () { send.disabled = false; msg(out, "No connection. Your note is still in the box. Try again in a moment.", "err"); });
    } });
    function loadMine() {
      rpc("room_get_notes", { p_code: S.code, p_session: S.session, p_slide: null }).then(function (r) {
        clear(list); if (!r.ok || !r.notes.length) return;
        list.appendChild(el("div", { class: "help", text: r.wall ? "Notes so far" : "Your notes" }));
        r.notes.forEach(function (n) { list.appendChild(el("div", { class: "stick c-" + n.color }, n.body, el("small", { text: (COLORS[n.color] || "") + " · " + (n.label || "") }))); });
      }).catch(function () {});
    }
    box.appendChild(flow); box.appendChild(ta); box.appendChild(cnt); box.appendChild(el("div", { class: "row", style: "margin-top:8px" }, send)); box.appendChild(out); box.appendChild(list);
    loadMine();
    return box;
  }

  // ---------- group sheets (D9, D2, D10, D5, D6, D7, registers) ----------
  // A sheet is a flat set of cells: "section.row.column" = value. Rows that tables add are listed in "section._rows".
  // Changes are saved cell by cell, so two people editing different cells of one sheet do not overwrite each other.
  var SHEET_NAMES = { T1: "Table 1", T2: "Table 2", T3: "Table 3", T4: "Table 4", C1: "Clinic 1", C2: "Clinic 2", C3: "Clinic 3", ROOM: "Staff register" };
  function regionMin(code) {
    var r = AG.regions.filter(function (x) { return x[0] === code; })[0];
    if (!r) return null;
    return { name: r[1], register: Math.round(AG.nat.register * r[2] / AG.nat.pop), screen: Math.round(AG.nat.screen * r[2] / AG.nat.pop) };
  }
  function fmtN(n) { return Number(n).toLocaleString("en-US"); }
  function sheetKey(act, sheet) { return act + "|" + sheet; }
  function sheetBody(act, sheet) { return (S.sheetData[sheetKey(act, sheet)] || {}).body || {}; }
  function rowIds(sec, body) {
    if (sec.fixedRows) return sec.fixedRows.map(function (r) { return r[0]; });
    var pre = (sec.preset || []).map(function (p, i) { return "p" + i; });
    var dyn = Array.isArray(body[sec.id + "._rows"]) ? body[sec.id + "._rows"] : [];
    return pre.concat(dyn);
  }
  function cellVal(body, sec, rowId, col) {
    var k = sec.id + "." + rowId + "." + col.id;
    if (body[k] != null) return body[k];
    if (sec.preset && sec.presetCol === col.id && /^p\d+$/.test(rowId)) return sec.preset[+rowId.slice(1)] || "";
    return "";
  }
  // ----- the save queue for sheets (survives a dropped connection) -----
  function sqKey() { return "pk_room_sq_" + fnv(S.code); }
  function loadSheetQueue() { S.sq = lsGet(sqKey()) || {}; }
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
    if (!keys.length) { if (S.role === "device" || isStaff()) setSave(S.sqSaved ? "saved" : null); return; }
    S.sqBusy = true;
    var q = keys[0], parts = q.split("|"), patch = S.sq[q];
    S.sq[q] = {}; delete S.sq[q];
    rpc("room_save_sheet", { p_code: S.code, p_session: S.session, p_activity: parts[0], p_sheet: parts[1], p_patch: patch }).then(function (r) {
      S.sqBusy = false;
      if (r.ok) { S.sqSaved = true; lsSet(sqKey(), Object.keys(S.sq).length ? S.sq : undefined); flushSheets(); return; }
      lsSet(sqKey(), Object.keys(S.sq).length ? S.sq : undefined);
      toast(r.reason === "not_open" ? "This sheet is closed now. Your last change was not saved." : "A change could not be saved (" + (r.reason || "unknown") + ").");
      setSave("fail"); flushSheets();
    }).catch(function () {
      // put the patch back and try again later
      S.sqBusy = false; S.sq[q] = Object.assign(patch, S.sq[q] || {}); lsSet(sqKey(), S.sq); setSave("queued");
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
        var body = Object.assign({}, sh.body, mine || {});   // my unsent edits win
        S.sheetData[q] = { body: body, at: sh.updated_at };
      });
      return r;
    });
  }
  // ----- drawing one sheet: editable for its device (while open) and for staff; read-only otherwise -----
  function input(act, sheet, k, value, col, editable) {
    var node;
    if (col.type === "select" || col.type === "region") {
      var opts = col.type === "region" ? AG.regions.map(function (r) { return [r[0], r[1]]; }) : (col.options || []).map(function (o) { return [o, o]; });
      if (!editable) return el("div", { class: "cellro", text: col.type === "region" ? ((regionMin(value) || {}).name || "") : value });
      node = el("select", { "data-k": k, "aria-label": col.label }, [el("option", { value: "", text: "—" })].concat(opts.map(function (o) { return el("option", { value: o[0], selected: o[0] === value, text: o[1] }); })));
      node.addEventListener("change", function () { queueCell(act, sheet, k, node.value); if (col.type === "region") { var box = node.parentNode.parentNode.querySelector(".regmin"); if (box) fillRegMin(box, node.value); } });
      return node;
    }
    if (col.type === "check") {
      if (!editable) return el("div", { class: "cellro", text: value ? "Yes" : "" });
      node = el("input", { type: "checkbox", "data-k": k, checked: !!value, "aria-label": col.label, style: "width:22px;height:22px" });
      node.addEventListener("change", function () { queueCell(act, sheet, k, node.checked); });
      return node;
    }
    if (!editable) return el("div", { class: "cellro", text: value });
    node = el("textarea", { "data-k": k, rows: "2", value: value, "aria-label": col.label });
    var t; node.addEventListener("input", function () { clearTimeout(t); t = setTimeout(function () { queueCell(act, sheet, k, node.value); }, 600); });
    node.addEventListener("blur", function () { clearTimeout(t); if ((sheetBody(act, sheet)[k] || "") !== node.value) queueCell(act, sheet, k, node.value); });
    return node;
  }
  function fillRegMin(box, code) {
    clear(box); var m = regionMin(code); if (!m) return;
    box.appendChild(el("span", { text: "Minimum to register: " }, el("b", { text: fmtN(m.register) })));
    box.appendChild(el("span", { text: " · to screen: " }, el("b", { text: fmtN(m.screen) })));
  }
  function sheetView(act, def, sheet, editable) {
    var body = sheetBody(act, sheet), wrap = el("div", { class: "sheet", "data-sheet": sheetKey(act, sheet) });
    if (def.sideBySheet && def.sideBySheet[sheet]) wrap.appendChild(el("div", { class: "sidebar " + def.sideBySheet[sheet].toLowerCase(), text: "Your side: the case " + def.sideBySheet[sheet].toUpperCase() + " the carried direction" }));
    if (def.levelBySheet && def.levelBySheet[sheet]) wrap.appendChild(el("div", { class: "sidebar", text: "Your level: " + def.levelBySheet[sheet] }));
    def.sections.forEach(function (sec) {
      var box = el("section", { class: "ssec" }, el("h4", { text: sec.title }));
      if (sec.help) box.appendChild(el("p", { class: "help", text: sec.help }));
      if (sec.type === "rows") {
        var ids = rowIds(sec, body);
        ids.forEach(function (rid, i) {
          var card = el("div", { class: "srow" });
          var head = el("div", { class: "srowh" }, el("b", { text: sec.fixedRows ? sec.fixedRows[i][1] : (sec.preset && i < sec.preset.length ? "" : "") + "#" + (i + 1) }));
          if (def.flagMissing) {
            var miss = def.flagMissing.filter(function (c) { return !String(body[sec.id + "." + rid + "." + c] || "").trim(); });
            if (miss.length) head.appendChild(el("span", { class: "state closed", text: "Follow up: no " + miss.map(function (c) { return c === "when" ? "date" : c; }).join(" or ") }));
          }
          if (editable && !sec.fixedRows && !/^p\d+$/.test(rid)) head.appendChild(el("button", { type: "button", class: "linkbtn", text: "Remove", onclick: function () {
            if (!confirm("Remove this row?")) return;
            var list = (Array.isArray(sheetBody(act, sheet)[sec.id + "._rows"]) ? sheetBody(act, sheet)[sec.id + "._rows"] : []).filter(function (x) { return x !== rid; });
            queueCell(act, sheet, sec.id + "._rows", list); redrawSheet(act, sheet);
          } }));
          card.appendChild(head);
          var grid = el("div", { class: "sgrid" });
          sec.cols.forEach(function (col) {
            var k = sec.id + "." + rid + "." + col.id, v = cellVal(body, sec, rid, col);
            var f = el("label", { class: "sfield" + (col.type === "check" ? " check" : "") }, el("span", { class: "slab", text: col.label }), input(act, sheet, k, v, col, editable));
            grid.appendChild(f);
            if (col.type === "region") { var rm = el("div", { class: "regmin" }); fillRegMin(rm, v); f.appendChild(rm); }
          });
          card.appendChild(grid); box.appendChild(card);
        });
        if (!ids.length) box.appendChild(el("p", { class: "muted small", text: "No rows yet." }));
        if (editable && sec.add) box.appendChild(el("button", { type: "button", class: "btn ghost small", text: "+ " + sec.add, onclick: function () {
          var cur = sheetBody(act, sheet)[sec.id + "._rows"], list = Array.isArray(cur) ? cur.slice() : [];
          list.push("r" + Date.now().toString(36) + Math.random().toString(36).slice(2, 5));
          queueCell(act, sheet, sec.id + "._rows", list); redrawSheet(act, sheet);
        } }));
      } else if (sec.type === "matrix") {
        sec.rows.forEach(function (r) {
          var card = el("div", { class: "srow" }, el("div", { class: "srowh" }, el("b", { text: r[1] })));
          sec.opts.forEach(function (o) {
            var ks = sec.id + "." + r[0] + "." + o + ".s", kr = sec.id + "." + r[0] + "." + o + ".r";
            card.appendChild(el("div", { class: "mline" }, el("span", { class: "mopt", text: o }),
              input(act, sheet, ks, body[ks] || "", { type: "select", options: ["1", "2", "3", "4", "5"], label: r[1] + ", option " + o + ": score" }, editable),
              el("div", { class: "mreason" }, input(act, sheet, kr, body[kr] || "", { label: r[1] + ", option " + o + ": reason" }, editable))));
          });
          var kd = sec.id + "." + r[0] + ".dis";
          card.appendChild(el("label", { class: "sfield" }, el("span", { class: "slab", text: "Disagreements and minority positions" }), input(act, sheet, kd, body[kd] || "", { label: "Disagreements" }, editable)));
          box.appendChild(card);
        });
      } else if (sec.type === "perOption") {
        sec.opts.forEach(function (o) {
          var k = sec.id + "." + o;
          box.appendChild(el("label", { class: "sfield" }, el("span", { class: "slab", text: "Option " + o }), input(act, sheet, k, body[k] || "", { label: "Option " + o }, editable)));
        });
      } else if (sec.type === "fields") {
        sec.fields.forEach(function (fd) {
          var k = sec.id + "." + fd.id;
          box.appendChild(el("label", { class: "sfield" }, el("span", { class: "slab", text: fd.label }), input(act, sheet, k, body[k] || "", fd, editable)));
        });
      }
      wrap.appendChild(box);
    });
    if (def.weighted) wrap.appendChild(weightedNode([{ sheet: sheet, body: body }]));
    if (def.prompts) wrap.appendChild(el("details", { class: "prompts" }, el("summary", { text: "Prompts to test your top three" }), el("ul", null, def.prompts.map(function (p) { return el("li", { text: p }); }))));
    return wrap;
  }
  function redrawSheet(act, sheet) {
    var old = document.querySelector('.sheet[data-sheet="' + sheetKey(act, sheet) + '"]');
    if (!old) return;
    var editable = old.getAttribute("data-edit") === "1", nw = sheetView(act, ACT[act], sheet, editable);
    nw.setAttribute("data-edit", editable ? "1" : "0");
    old.parentNode.replaceChild(nw, old);
  }
  // fresh data from the server: update the cells nobody is typing in; redraw if rows were added elsewhere
  function syncSheet(act, sheet) {
    var node = document.querySelector('.sheet[data-sheet="' + sheetKey(act, sheet) + '"]');
    if (!node) return;
    var body = sheetBody(act, sheet), def = ACT[act], need = false;
    def.sections.forEach(function (sec) {
      if (sec.type !== "rows") return;
      var shown = node.querySelectorAll(".ssec")[def.sections.indexOf(sec)];
      if (shown && shown.querySelectorAll(".srow").length !== rowIds(sec, body).length) need = true;
    });
    if (need && !node.contains(document.activeElement)) { redrawSheet(act, sheet); return; }
    [].forEach.call(node.querySelectorAll("[data-k]"), function (inp) {
      var k = inp.getAttribute("data-k");
      if (inp === document.activeElement || pendingCell(act, sheet, k) || body[k] === undefined) return;
      if (inp.type === "checkbox") inp.checked = !!body[k];
      else if (inp.value !== String(body[k])) inp.value = body[k];
    });
  }
  function editorFor(act, def, sheet, editable) {
    var v = sheetView(act, def, sheet, editable); v.setAttribute("data-edit", editable ? "1" : "0"); return v;
  }
  // ----- D2 weighted totals: carried weights (Settings tab) and equal weights -----
  function weightsCarried() {
    var w = setting("d2_weights"), out = {}, any = false;
    AG.crit.forEach(function (c) { var n = w && +w[c[0]]; if (n > 0) { out[c[0]] = n; any = true; } });
    return any ? out : null;
  }
  function weightedFor(body) {
    var carried = weightsCarried(), res = {};
    AG.opts.forEach(function (o) {
      var sumE = 0, nE = 0, sumC = 0, wC = 0;
      AG.crit.forEach(function (c) {
        var s = +body["m." + c[0] + "." + o + ".s"]; if (!s) return;
        sumE += s; nE += 1;
        if (carried && carried[c[0]]) { sumC += s * carried[c[0]]; wC += carried[c[0]]; }
      });
      res[o] = { equal: nE ? sumE / nE : null, carried: wC ? sumC / wC : null, scored: nE };
    });
    return res;
  }
  function weightedNode(list) {
    var carried = weightsCarried(), tb = el("table", { class: "restable" });
    var head = el("tr", null, el("th", { text: list.length > 1 ? "Table" : "Weighted total (1 to 5)" }));
    AG.opts.forEach(function (o) { head.appendChild(el("th", { text: "Option " + o })); });
    tb.appendChild(head);
    var avg = {}; AG.opts.forEach(function (o) { avg[o] = { c: [], e: [] }; });
    list.forEach(function (x) {
      var w = weightedFor(x.body), tr = el("tr", null, el("td", { text: list.length > 1 ? SHEET_NAMES[x.sheet] : "This table" }));
      AG.opts.forEach(function (o) {
        var r = w[o]; if (r.carried != null) avg[o].c.push(r.carried); if (r.equal != null) avg[o].e.push(r.equal);
        tr.appendChild(el("td", { class: "n" }, carried ? el("div", { text: r.carried != null ? r.carried.toFixed(2) : "—" }) : null,
          el("div", { class: carried ? "muted small" : "", text: (r.equal != null ? r.equal.toFixed(2) : "—") + (carried ? " equal" : "") }),
          r.scored < 8 ? el("div", { class: "muted small", text: r.scored + " of 8 scored" }) : null));
      });
      tb.appendChild(tr);
    });
    if (list.length > 1) {
      var tr2 = el("tr", null, el("td", { text: "Average of tables" }));
      AG.opts.forEach(function (o) {
        var m = function (a) { return a.length ? (a.reduce(function (p, q) { return p + q; }, 0) / a.length).toFixed(2) : "—"; };
        tr2.appendChild(el("td", { class: "n" }, carried ? el("div", { text: m(avg[o].c) }) : null, el("div", { class: carried ? "muted small" : "", text: m(avg[o].e) + (carried ? " equal" : "") })));
      });
      tb.appendChild(tr2);
    }
    return el("div", { class: "ssec" }, el("h4", { text: "Weighted totals" }),
      el("p", { class: "help", text: carried ? "Top number: the carried weights. Below: equal weights. Both on the 1 to 5 scale." : "Equal weights, on the 1 to 5 scale. Staff can enter the carried weights on the Settings tab." }), tb);
  }
  // ----- D2: the table's own silent-score spread, shown on its group device -----
  function spreadNode(rows, title) {
    var by = {};
    (rows || []).forEach(function (r) { (by[r.item] = by[r.item] || []).push(r); });
    var tb = el("table", { class: "restable spread" }), head = el("tr", null, el("th", { text: "Question" }));
    AG.opts.forEach(function (o) { head.appendChild(el("th", { text: o })); }); tb.appendChild(head);
    AG.crit.forEach(function (c) {
      var tr = el("tr", null, el("td", { text: c[1] }));
      AG.opts.forEach(function (o) {
        var rs = by[c[0] + "_" + o] || [], vals = [];
        rs.forEach(function (r) { for (var i = 0; i < (r.n || 0); i++) vals.push(+r.val); });
        vals.sort(function (a, b) { return a - b; });
        var wide = vals.length && vals[vals.length - 1] - vals[0] >= 2;
        tr.appendChild(el("td", { class: "n" + (wide ? " flag" : "") }, vals.length ? vals.join(" ") : "—", wide ? el("div", { class: "small", text: "discuss" }) : null));
      });
      tb.appendChild(tr);
    });
    return el("div", { class: "ssec" }, el("h4", { text: title }), el("p", { class: "help", text: "Each number is one person's silent score. Discuss where scores differ by two points or more." }), tb);
  }
  // ----- D2 silent scores on a phone: one row of 1 to 5 per option, for each question -----
  function gridBlock(key, def) {
    var box = el("div");
    if (def.help) box.appendChild(el("p", { class: "help", text: def.help }));
    def.grid.rows.forEach(function (r) {
      var q = el("div", { class: "q gq" }, el("span", { class: "t", text: r[1] }));
      def.grid.cols.forEach(function (o) {
        var ik = r[0] + "_" + o, mkey = mk(key, ik), cur = S.mine[mkey];
        var sc = el("div", { class: "scale gscale" });
        def.grid.scale.forEach(function (v) {
          var inp = el("input", { type: "radio", name: mkey, value: v, checked: cur && cur.v === v });
          var l = el("label", { class: cur && cur.v === v ? "sel" : "" }, inp, el("span", { text: v }));
          inp.addEventListener("change", function () { [].forEach.call(sc.children, function (x) { x.classList.remove("sel"); }); l.classList.add("sel"); saveItem(key, ik, { v: v }); });
          sc.appendChild(l);
        });
        q.appendChild(el("div", { class: "gline" }, el("span", { class: "mopt", text: o }), sc));
      });
      box.appendChild(q);
    });
    return box;
  }
  function gridResultsNode(def, rows) {
    var by = {};
    (rows || []).forEach(function (r) { var a = by[r.item] = by[r.item] || []; for (var i = 0; i < (r.n || 0); i++) a.push(+r.val); });
    var tb = el("table", { class: "restable" }), head = el("tr", null, el("th", { text: "Question (room average)" }));
    def.grid.cols.forEach(function (o) { head.appendChild(el("th", { text: "Option " + o })); }); tb.appendChild(head);
    var means = {};
    def.grid.rows.forEach(function (r) {
      var tr = el("tr", null, el("td", { text: r[1] }));
      def.grid.cols.forEach(function (o) {
        var v = by[r[0] + "_" + o] || [];
        if (!v.length) { tr.appendChild(el("td", { class: "n", text: "—" })); return; }
        var m = v.reduce(function (a, b) { return a + b; }, 0) / v.length;
        (means[o] = means[o] || {})[r[0]] = m;
        tr.appendChild(el("td", { class: "n" }, el("div", { text: m.toFixed(1) }), el("div", { class: "muted small", text: Math.min.apply(null, v) + "–" + Math.max.apply(null, v) + " · n " + v.length })));
      });
      tb.appendChild(tr);
    });
    var carried = weightsCarried();
    [["Equal weights", null], ["Carried weights", carried]].forEach(function (w) {
      if (w[0] === "Carried weights" && !carried) return;
      var tr = el("tr", { class: "total" }, el("td", { text: w[0] }));
      def.grid.cols.forEach(function (o) {
        var s = 0, n = 0;
        def.grid.rows.forEach(function (r) { var m = means[o] && means[o][r[0]]; if (m == null) return; var wt = w[1] ? (w[1][r[0]] || 0) : 1; s += m * wt; n += wt; });
        tr.appendChild(el("td", { class: "n", text: n ? (s / n).toFixed(2) : "—" }));
      });
      tb.appendChild(tr);
    });
    return tb;
  }
  // ----- gallery walk: phones mark up to three indicators they support, from the revealed D6 matrices -----
  function galleryOptions(def) {
    var src = ACT[def.source], out = [];
    (src.sheets || []).forEach(function (sh) {
      var body = sheetBody(def.source, sh), sec = src.sections.filter(function (s) { return s.id === def.sourceSection; })[0];
      rowIds(sec, body).forEach(function (rid) {
        var txt = String(body[sec.id + "." + rid + "." + def.sourceCol] || "").trim();
        if (!txt) return;
        if (body[sec.id + "." + rid + ".accept"] === "Contest") return;
        out.push({ id: sh + ":" + rid, level: (src.levelBySheet || {})[sh] || SHEET_NAMES[sh], text: txt });
      });
    });
    return out;
  }
  function galleryPanel(key, def, box) {
    var holder = el("div", null, el("p", { class: "muted", text: "Loading the matrices..." }));
    box.appendChild(holder);
    loadSheets(def.source).then(function (r) {
      clear(holder);
      if (!r || !r.ok || r.state !== "revealed") { holder.appendChild(el("p", { class: "help", text: "The matrices are not shown yet. Your facilitator will put them on the room screen first." })); return; }
      var opts = galleryOptions(def);
      if (!opts.length) { holder.appendChild(el("p", { class: "help", text: "No indicators were written on the matrices." })); return; }
      if (def.help) holder.appendChild(el("p", { class: "help", text: def.help }));
      [["support", "Indicators I support (up to three)", 3], ["oppose", "Indicators I cannot support", 99]].forEach(function (part) {
        var mkey = mk(key, part[0]), cur = S.mine[mkey], chosen = cur && Array.isArray(cur.v) ? cur.v.slice() : [], mark = el("span", { class: "saved-mark" });
        S.marks[mkey] = mark;
        var q = el("div", { class: "q" }, el("span", { class: "t" }, part[1], mark)), last = null;
        opts.forEach(function (o) {
          if (o.level !== last) { q.appendChild(el("div", { class: "glevel", text: o.level })); last = o.level; }
          var inp = el("input", { type: "checkbox", value: o.id, checked: chosen.indexOf(o.id) >= 0 });
          var l = el("label", { class: "opt" + (chosen.indexOf(o.id) >= 0 ? " sel" : "") }, inp, el("span", { text: o.text }));
          inp.addEventListener("change", function () {
            var i = chosen.indexOf(o.id);
            if (inp.checked && i < 0) { if (chosen.length >= part[2]) { inp.checked = false; toast("You can choose up to " + part[2] + "."); return; } chosen.push(o.id); }
            if (!inp.checked && i >= 0) chosen.splice(i, 1);
            l.classList.toggle("sel", inp.checked); saveItem(key, part[0], { v: chosen.slice() });
          });
          q.appendChild(l);
        });
        holder.appendChild(q);
      });
    }).catch(function () { clear(holder); holder.appendChild(el("p", { class: "help", text: "Could not load the matrices. Use Menu, then Refresh." })); });
  }
  function galleryResultsNode(def, rows) {
    var opts = galleryOptions(def), label = {}, count = { support: {}, oppose: {} };
    opts.forEach(function (o) { label[o.id] = o; });
    (rows || []).forEach(function (r) { if (count[r.item]) count[r.item][r.val] = (count[r.item][r.val] || 0) + (r.n || 0); });
    var box = el("div"), levels = [];
    opts.forEach(function (o) { if (levels.indexOf(o.level) < 0) levels.push(o.level); });
    levels.forEach(function (lv) {
      var list = opts.filter(function (o) { return o.level === lv; });
      var sup = list.slice().sort(function (a, b) { return (count.support[b.id] || 0) - (count.support[a.id] || 0); }).slice(0, 3);
      var opp = list.slice().sort(function (a, b) { return (count.oppose[b.id] || 0) - (count.oppose[a.id] || 0); })[0];
      var sec = el("div", { class: "ssec" }, el("h4", { text: lv }));
      sup.forEach(function (o) { sec.appendChild(el("div", { class: "gres" }, el("b", { text: String(count.support[o.id] || 0) }), " ", o.text)); });
      if (opp && count.oppose[opp.id]) sec.appendChild(el("div", { class: "gres opp" }, el("b", { text: String(count.oppose[opp.id]) }), " cannot support: ", opp.text));
      box.appendChild(sec);
    });
    if (!levels.length) box.appendChild(el("p", { class: "muted", text: "No indicators to show." }));
    return box;
  }
  function loadSpread(key, def) {
    return rpc("room_table_spread", { p_code: S.code, p_session: S.session, p_activity: def.spreadOf }).then(function (r) {
      var box = $("spread_" + key); if (!box) return;
      clear(box);
      if (!r.ok) { box.appendChild(el("p", { class: "muted small", text: "Your table's silent scores are not available." })); return; }
      box.appendChild(spreadNode(r.rows, "Your table's silent scores"));
    }).catch(function () {});
  }
  // which sheets a group device can fill for an activity
  function deviceSheetFor(def) {
    var mine = S.profile.sheet;
    if (!def || def.kind !== "sheet" || def.staffOnly || !mine) return null;
    return (def.sheets || []).indexOf(mine) >= 0 ? mine : null;
  }

  // ---------- results tables (staff and room screen) ----------
  function resultsNode(key, rows, role, onlyItem) {
    var def = ACT[key], box = el("div"), byItem = {}, items = [];
    (rows || []).forEach(function (r) { (byItem[r.item] = byItem[r.item] || []).push(r); });
    var defs = def && def.items ? def.items.filter(function (it) { return it.type !== "text"; }) : [];
    defs.forEach(function (it) { items.push({ it: it, ik: it.id, label: it.label, options: it.options }); });
    if (!defs.length) Object.keys(byItem).forEach(function (ik) { items.push({ ik: ik, label: ik, options: null }); });
    if (onlyItem) items = items.filter(function (x) { return x.ik === onlyItem; });
    var any = false;
    items.forEach(function (x) {
      var rs = byItem[x.ik] || [];
      var vals = x.options ? x.options.map(function (o) { return o[0]; }) : Array.from(new Set(rs.map(function (r) { return r.val; }))).sort();
      var names = {}; (x.options || []).forEach(function (o) { names[o[0]] = x.it && x.it.type === "scale" ? o[0] + " · " + o[1] : o[1]; });
      var tb = el("table", { class: "restable" }), head = el("tr", null, el("th", { text: x.label }));
      GROUPS.forEach(function (g) { head.appendChild(el("th", { text: g })); }); head.appendChild(el("th", { text: "All groups" })); tb.appendChild(head);
      var maxAll = 1;
      vals.forEach(function (v) { var s = 0; GROUPS.forEach(function (g) { rs.forEach(function (r) { if (r.val === v && r.grp === g && r.n != null) s += r.n; }); }); if (s > maxAll) maxAll = s; });
      vals.forEach(function (v) {
        var tr = el("tr", null, el("td", { text: names[v] || v })), total = 0, hidden = false;
        GROUPS.forEach(function (g) {
          var cell = rs.filter(function (r) { return r.val === v && r.grp === g; })[0];
          if (role === "projector") {
            if (!cell || cell.small || cell.n == null) { tr.appendChild(el("td", { class: "small", text: "fewer than 5" })); hidden = true; }
            else { tr.appendChild(el("td", { class: "n", text: String(cell.n) })); total += cell.n; }
          } else { var n = cell && cell.n != null ? cell.n : 0; total += n; tr.appendChild(el("td", { class: "n", text: String(n) })); }
        });
        var all = el("td", { class: "n" });
        if (hidden) { all.textContent = "—"; } else { all.appendChild(document.createTextNode(String(total))); all.appendChild(el("span", { class: "bar", style: "width:" + Math.round(total / maxAll * 100) + "%" })); }
        tr.appendChild(all); tb.appendChild(tr);
      });
      if (role === "projector") {
        if (!rs.length) return;
        var shownNum = rs.some(function (r) { return r.n != null; });
        if (!shownNum) { box.appendChild(el("p", { text: x.label + ": every group has fewer than 5 answers, so no numbers are shown." })); any = true; return; }
      }
      box.appendChild(tb); any = true;
    });
    if (!any) box.appendChild(el("p", { class: "muted", text: "No answers yet." }));
    return box;
  }

  // ---------- room screen (the projector role) ----------
  function promptItems(def) {
    var box = el("div", { class: "pitems" });
    (def.items || []).forEach(function (it) {
      if (it.showIf && it.type === "text") return; // follow-up text boxes stay on the phone
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
    var view = $("view"), key = focusKey(), def = ACT[key], st = key ? actState(key) : "none", wall = !!setting("show_wall");
    var sig = [key, st, wall ? "w" : "", setting("focus_sheet") || "", JSON.stringify(setting("d2_weights") || {})].join("~");
    if (sig === S.sig) return;
    S.sig = sig; clear(view);
    if (!def || st === "none") {
      if (!wall) { view.appendChild(el("div", { class: "standby", text: "PuroKalusugan · Direction Consultation" })); return; }
    } else {
      var w = whereIs(key), card = el("article", { class: "pcard" });
      if (w) card.appendChild(el("div", { class: "pkick", text: w.dayName.split(" · ")[0] + " · " + w.block.session + " · " + w.block.name }));
      card.appendChild(el("h2", { class: "ptitle", text: def.title }));
      if (st === "open" || st === "closed") {
        if (def.kind === "form" && def.grid) card.appendChild(el("p", { class: "plabel", text: "Score each option from 1 to 5 on the eight questions, alone and in silence." }));
        else if (def.kind === "form") card.appendChild(promptItems(def));
        else if (def.kind === "sheet") card.appendChild(el("p", { class: "plabel", text: def.intro || "" }));
        else if (def.kind === "gallery") card.appendChild(el("p", { class: "plabel", text: def.help || "" }));
        else card.appendChild(el("p", { class: "muted", text: "Use the evaluation link or QR code shown by your facilitator." }));
        var showCount = def.kind === "form" || def.kind === "gallery";
        card.appendChild(el("div", { class: "pstate" }, st === "open" ? (showCount ? el("span", { class: "counts", "data-count": key }) : el("span", { class: "state open", text: "In progress" })) : el("span", { class: "state closed", text: "Closed. Thank you." })));
      } else if (st === "revealed") {
        if (def.kind === "link") card.appendChild(el("p", { class: "muted", text: "Revealed." }));
        else card.appendChild(el("div", { id: "resbody_" + key }, el("p", { class: "muted", text: "Loading..." })));
      }
      view.appendChild(card);
    }
    if (wall) view.appendChild(el("div", { id: "wallbox", class: "resblock" }, el("h3", { text: "Notes" }), el("div", { id: "wallbody" })));
  }

  // data that is fetched while a result or the wall is on screen
  function refreshLive() {
    var jobs = [], key = focusKey(), fdef = ACT[key];
    if (isProj()) {
      if (fdef && (fdef.kind === "form" || fdef.kind === "gallery") && actState(key) === "revealed") jobs.push(fetchResults(key, "projector"));
      if (fdef && fdef.kind === "sheet" && actState(key) === "revealed") jobs.push(drawRoomSheets(key));
      if (setting("show_wall")) jobs.push(fetchWall());
    }
    if (isStaff()) {
      Object.keys(S.showRes).forEach(function (k) { if (S.showRes[k]) jobs.push(fetchResults(k, "staff")); });
      if (S.tab === "notes") jobs.push(fetchWall());
      if (S.openSheet && S.tab === "acts") {
        var os = S.openSheet.split("|");
        jobs.push(loadSheets(os[0]).then(function () { syncSheet(os[0], os[1]); var d = ACT[os[0]]; if (d && d.spreadOf) staffSpread(os[0], os[1]); }));
      }
    }
    if (S.role === "device") {
      openKeys().forEach(function (k) {
        var d = ACT[k], mine = deviceSheetFor(d);
        if (!mine) return;
        jobs.push(loadSheets(k).then(function () { syncSheet(k, mine); }));
        if (d.spreadOf) jobs.push(loadSpread(k, d));
      });
    }
    return Promise.all(jobs.map(function (j) { return j.catch(function () {}); }));
  }
  function fetchResults(key, role) {
    var def = ACT[key] || {};
    var pre = def.kind === "gallery" ? loadSheets(def.source) : Promise.resolve();
    return pre.then(function () { return rpc("room_results", { p_code: S.code, p_activity: key, p_mode: def.resultMode || "votes" }); }).then(function (r) {
      var target = $(role === "projector" ? "resbody_" + key : "staffres_" + key);
      if (!target) return;
      clear(target);
      if (!r.ok) { target.appendChild(el("p", { class: "muted", text: r.reason === "hidden" ? "Not revealed yet." : "Could not load the result." })); return; }
      if (def.grid) target.appendChild(gridResultsNode(def, r.rows));
      else if (def.kind === "gallery") target.appendChild(galleryResultsNode(def, r.rows));
      else target.appendChild(resultsNode(key, r.rows, role));
    });
  }
  // the room screen: revealed sheets, all tables side by side or the one staff chose
  function drawRoomSheets(key) {
    var def = ACT[key];
    return loadSheets(key).then(function (r) {
      var target = $("resbody_" + key); if (!target || !r || !r.ok) return;
      var only = setting("focus_sheet");
      var list = (def.sheets || []).filter(function (sh) { return def.sheets.length === 1 || !only || only === sh; });
      clear(target);
      if (def.weighted) target.appendChild(weightedNode(list.map(function (sh) { return { sheet: sh, body: sheetBody(key, sh) }; })));
      var grid = el("div", { class: "roomsheets" + (list.length > 1 ? " multi" : "") });
      list.forEach(function (sh) { grid.appendChild(el("div", { class: "roomsheet" }, def.sheets.length > 1 ? el("h3", { text: SHEET_NAMES[sh] }) : null, sheetView(key, def, sh, false))); });
      target.appendChild(grid);
    });
  }
  function staffSpread(key, sheet) {
    var def = ACT[key];
    return rpc("room_results", { p_code: S.code, p_activity: def.spreadOf, p_mode: "spread" }).then(function (r) {
      var box = $("sspread_" + key); if (!box || !r.ok) return;
      var t = +sheet.slice(1);
      clear(box); box.appendChild(spreadNode(r.rows.filter(function (x) { return x.table_no === t; }), SHEET_NAMES[sheet] + ": silent scores"));
    }).catch(function () {});
  }
  function fetchWall() {
    return rpc("room_get_notes", { p_code: S.code, p_session: null, p_slide: null }).then(function (r) {
      if (!r.ok) return;
      S.wall = r.notes;
      var proj = $("wallbody"); if (proj) drawWall(proj, r.notes, false);
      var stf = $("staffwall"); if (stf) drawWall(stf, r.notes, true);
    });
  }
  function drawWall(target, notes, editable) {
    clear(target);
    var wrap = el("div", { class: "wall" });
    ["yellow", "pink", "green", "blue"].forEach(function (c) {
      var col = el("div", null, el("h4", { text: COLORS[c] }));
      notes.filter(function (n) { return n.color === c; }).forEach(function (n) {
        var topic = n.slide_id && n.slide_id !== "general" ? titleOf(n.slide_id) : "";
        var card = el("div", { class: "stick c-" + c + (n.hidden ? " hid" : "") }, n.body, el("small", { text: (n.label || "") + (topic ? " · " + topic : "") + (n.cluster ? " · " + n.cluster : "") + (n.hidden ? " · hidden" : "") }));
        if (editable) {
          var cl = el("input", { type: "text", placeholder: "Group name", value: n.cluster || "", "aria-label": "Group name", style: "margin-top:6px;min-height:36px;padding:4px 10px;font-size:14px" });
          cl.addEventListener("change", function () { updateNote(n.id, { cluster: cl.value.trim() || null }); });
          card.appendChild(cl);
          card.appendChild(el("div", { class: "row tight", style: "margin-top:6px" }, el("button", { type: "button", class: "btn ghost small", text: n.hidden ? "Show" : "Hide", onclick: function () { updateNote(n.id, { hidden: !n.hidden }); } })));
        }
        col.appendChild(card);
      });
      wrap.appendChild(col);
    });
    target.appendChild(wrap);
  }
  function updateNote(id, patch) { rpc("room_update_note", { p_code: S.code, p_id: id, p_patch: patch }).then(function () { fetchWall(); }).catch(function () { toast("Could not change the note."); }); }

  // ---------- staff ----------
  function staffSet(patch) {
    return rpc("room_set_state", { p_code: S.code, p_patch: patch }).then(function (r) {
      if (!r.ok) { toast("That was not accepted. Is the staff code still open?"); return r; }
      return pollNow().then(function () { return r; });
    }).catch(function (e) { toast(errText(e)); });
  }
  function renderStaff(force) {
    var view = $("view");
    if (S.tab !== "acts") { if (force) { clear(view); ({ notes: tabNotes, paper: tabPaper, settings: tabSettings })[S.tab](view); } return; }
    var sig = ["acts", S.day, focusKey(), JSON.stringify(S.st.acts), JSON.stringify(S.st.settings), S.st.timer_end, JSON.stringify(S.showRes), S.openSheet].join("~");
    if (!force && sig === S.sig) return;
    S.sig = sig; clear(view);
    tabActs(view);
    refreshLive();
  }
  function setTimerMin(m) { staffSet({ timer_end: new Date(Date.now() + S.skew + m * 60000).toISOString() }); }
  function addMinute() {
    var end = S.st.timer_end ? Date.parse(S.st.timer_end) : 0, now = Date.now() + S.skew;
    staffSet({ timer_end: new Date((end > now ? end : now) + 60000).toISOString() });
  }
  function tabActs(view) {
    // timer
    var tm = el("div", { class: "ctl" }, el("h3", { text: "Timer" })), trow = el("div", { class: "row tight" });
    [1, 3, 5, 10, 15, 20].forEach(function (m) { trow.appendChild(el("button", { type: "button", class: "btn ghost small", text: m + " min", onclick: function () { setTimerMin(m); } })); });
    trow.appendChild(el("button", { type: "button", class: "btn ghost small", text: "+1 min", onclick: function () { addMinute(); } }));
    trow.appendChild(el("button", { type: "button", class: "btn ghost small", text: "Clear", onclick: function () { staffSet({ timer_end: "" }); } }));
    tm.appendChild(trow); view.appendChild(tm);

    // sticky notes switch
    var on = notesOn(), sel = noteColors(), nc = el("div", { class: "ctl" }, el("div", { class: "row" }, el("h3", { style: "margin:0", text: "Sticky notes" }), el("span", { class: "state " + (on ? "open" : "none"), text: on ? "On" : "Off" })));
    var cb = el("div", { class: "row", style: "margin:10px 0" });
    Object.keys(COLORS).forEach(function (c) {
      var box = el("input", { type: "checkbox", id: "nc_" + c, checked: sel.indexOf(c) >= 0, style: "width:20px;height:20px" });
      box.addEventListener("change", function () {
        var now = Object.keys(COLORS).filter(function (k) { return $("nc_" + k).checked; });
        staffSet({ settings: { note_colors: now } });
      });
      cb.appendChild(el("label", { class: "row tight", for: "nc_" + c, style: "cursor:pointer" }, box, el("span", { class: "cswatch c-" + c, text: COLORS[c] })));
    });
    nc.appendChild(el("p", { class: "muted small", style: "margin:6px 0 0", text: "Choose the colors phones can use, then turn notes on. Notes are labeled with the activity on the room screen." }));
    nc.appendChild(cb);
    nc.appendChild(el("button", { type: "button", class: "btn small" + (on ? " ghost" : ""), text: on ? "Turn notes off" : "Turn notes on", onclick: function () { staffSet({ acts: { notes: on ? "closed" : "open" } }); } }));
    view.appendChild(nc);

    // day switch
    var seg = el("div", { class: "rtabs", role: "group", "aria-label": "Day" });
    PROGRAM.forEach(function (d, i) {
      seg.appendChild(el("button", { type: "button", class: "rtab", "aria-selected": S.day === i ? "true" : "false", text: d.day.split(" · ")[0], onclick: function () { S.day = i; S.sig = ""; renderStaff(true); } }));
    });
    view.appendChild(seg);
    var day = PROGRAM[S.day];
    view.appendChild(el("p", { class: "muted", style: "margin:0 0 10px", text: day.day + ". Open an activity to show it on phones and on the room screen." }));

    day.blocks.forEach(function (b) {
      var card = el("div", { class: "ctl" }, el("div", { class: "blockh" }, el("span", { class: "bsess", text: b.session }), el("span", { class: "bname", text: b.name }), el("span", { class: "btime", text: b.time })));
      b.acts.forEach(function (k) { card.appendChild(actControl(k)); });
      view.appendChild(card);
    });
  }
  function actControl(key) {
    var def = ACT[key], st = actState(key), onScreen = focusKey() === key, box = el("div", { class: "arow" + (onScreen ? " onscreen" : "") });
    var row = el("div", { class: "row" }, el("span", { class: "actname", text: def.title }), el("span", { class: "state " + st, text: stateLabel(st) }), onScreen ? el("span", { class: "focusbadge", text: "On the room screen" }) : null,
      (def.kind === "form" || def.kind === "gallery") ? el("span", { class: "counts", "data-count": key }) : null);
    box.appendChild(row);
    if (def.kind === "link") box.appendChild(el("div", { class: "muted small", text: evalUrl() ? "Phones show the evaluation link when this is open." : "Add the evaluation link on the Settings tab." }));
    else if (def.kind === "sheet" && !def.staffOnly) box.appendChild(el("div", { class: "muted small", text: "Open lets the " + (def.clinic ? "clinic's" : "tables'") + " group devices fill the sheet. Reveal shows the sheets on the room screen and on phones." }));
    else if (def.kind === "gallery") box.appendChild(el("div", { class: "muted small", text: "Reveal the D6 matrices first; phones then mark the indicators they support." }));
    var btns = el("div", { class: "row tight", style: "margin-top:8px" });
    function set(state, focus) { var p = { acts: {} }; p.acts[key] = state; if (focus) p.slide_id = key; staffSet(p); }
    btns.appendChild(el("button", { type: "button", class: "btn small" + (st === "open" ? "" : " ghost"), text: "Open", "aria-pressed": st === "open" ? "true" : "false", onclick: function () { set("open", true); } }));
    btns.appendChild(el("button", { type: "button", class: "btn small" + (st === "closed" ? "" : " ghost"), text: "Close", "aria-pressed": st === "closed" ? "true" : "false", onclick: function () { set("closed", false); } }));
    btns.appendChild(el("button", { type: "button", class: "btn small" + (st === "revealed" ? "" : " ghost"), text: "Reveal on the room screen", "aria-pressed": st === "revealed" ? "true" : "false", onclick: function () { set("revealed", true); } }));
    btns.appendChild(el("button", { type: "button", class: "btn small ghost", text: "Reset", onclick: function () { set("none", false); } }));
    if (!onScreen) btns.appendChild(el("button", { type: "button", class: "btn small ghost", text: "Show on the room screen", onclick: function () { staffSet({ slide_id: key }); } }));
    if (def.kind === "form" || def.kind === "gallery") {
      btns.appendChild(el("button", { type: "button", class: "btn ghost small", text: S.showRes[key] ? "Hide live result" : "Show live result", onclick: function () {
        if (S.showRes[key]) delete S.showRes[key]; else S.showRes[key] = true;
        S.sig = ""; renderStaff(true);
      } }));
    }
    box.appendChild(btns);
    if (def.kind === "sheet") {
      var srow = el("div", { class: "row tight", style: "margin-top:8px" }, el("span", { class: "muted small", text: def.staffOnly ? "Staff fill this in:" : "Open a sheet to read or fill in for a table:" }));
      def.sheets.forEach(function (sh) {
        var id = sheetKey(key, sh), on = S.openSheet === id;
        srow.appendChild(el("button", { type: "button", class: "btn small" + (on ? "" : " ghost"), text: (on ? "Close " : "") + (sh === "ROOM" ? "the register" : SHEET_NAMES[sh]), onclick: function () {
          S.openSheet = on ? null : id; S.sig = ""; renderStaff(true);
        } }));
      });
      if (def.sheets.length > 1) {
        var pick = el("select", { "aria-label": "What the room screen shows", style: "width:auto;min-height:38px;padding:4px 10px" },
          [el("option", { value: "", text: "Room screen shows: all tables" })].concat(def.sheets.map(function (sh) { return el("option", { value: sh, selected: setting("focus_sheet") === sh, text: "Room screen shows: " + SHEET_NAMES[sh] }); })));
        pick.addEventListener("change", function () { staffSet({ settings: { focus_sheet: pick.value } }); });
        srow.appendChild(pick);
      }
      box.appendChild(srow);
      if (S.openSheet && S.openSheet.split("|")[0] === key) {
        var sh2 = S.openSheet.split("|")[1], ed = el("div", { class: "staffsheet" }, el("h4", { text: (sh2 === "ROOM" ? def.title : SHEET_NAMES[sh2]) + " · staff can edit at any time" }));
        if (def.intro) ed.appendChild(el("p", { class: "help", text: def.intro }));
        if (def.spreadOf) ed.appendChild(el("div", { id: "sspread_" + key }));
        var hold = el("div"); hold.appendChild(editorFor(key, def, sh2, true)); ed.appendChild(hold);
        box.appendChild(ed);
        loadSheets(key).then(function () { if (!document.querySelector(".staffsheet").contains(document.activeElement)) redrawSheet(key, sh2); }).catch(function () {});
        if (def.spreadOf) staffSpread(key, sh2);
      }
    }
    if ((def.kind === "form" || def.kind === "gallery") && S.showRes[key]) box.appendChild(el("div", { id: "staffres_" + key, style: "margin-top:10px" }, el("p", { class: "muted", text: "Loading..." })));
    return box;
  }

  // ----- notes tab -----
  function tabNotes(view) {
    var on = !!setting("show_wall"), c = el("div", { class: "ctl" }, el("h3", { text: "Sticky notes" }));
    var box = el("input", { type: "checkbox", id: "wallBox", checked: on, style: "width:20px;height:20px" });
    box.addEventListener("change", function () { staffSet({ settings: { show_wall: box.checked } }); });
    c.appendChild(el("label", { class: "row tight", for: "wallBox", style: "cursor:pointer;margin-bottom:12px" }, box, el("span", { text: "Show the notes on the room screen and let phones see all visible notes" })));
    c.appendChild(el("div", { id: "staffwall" }, el("p", { class: "muted", text: "Loading..." })));
    view.appendChild(c);
    fetchWall();
  }

  // ----- paper entries tab: staff log a tally by group -----
  function tallyList() {
    var out = [];
    ORDER.forEach(function (o) {
      if (!o.def.items) return;
      o.def.items.filter(function (it) { return it.type !== "text"; }).forEach(function (it) {
        out.push({ key: o.key, ik: it.id, label: o.dayName.split(" · ")[0] + " · " + o.block.session + " · " + o.def.title + " · " + it.label, options: it.options });
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
        g.appendChild(el("div", null, el("label", { for: "tl_" + o[0], text: o[0].length > 1 || x.options.length > 6 ? o[1] : (x.ik.indexOf("level") >= 0 ? "Level " + o[0] : "Option " + o[0]) }), inp));
      });
      gridBox.appendChild(g); loadRes();
    }
    function loadRes() {
      var x = list[+sel.value]; clear(resBox);
      rpc("room_results", { p_code: S.code, p_activity: x.key, p_mode: "votes" }).then(function (r) {
        if (!r.ok) return;
        resBox.appendChild(el("h4", { text: "Totals so far (phones plus paper)", style: "margin:18px 0 4px" }));
        var rows = r.rows.filter(function (q) { return q.item === x.ik; });
        resBox.appendChild(resultsNode(x.key, rows, "staff", x.ik));
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
    c.appendChild(el("div", { class: "q" }, el("span", { class: "t", text: "Evaluation link (optional)" }), el("p", { class: "help", text: "The link your team provides. Phones show an Open button when the Evaluation activity is open. This link and the polling speed are shared with the " + (S.stage === "trial" ? "live" : "trial") + " room." }), url));
    c.appendChild(el("button", { type: "button", class: "btn", text: "Save settings", onclick: function () {
      var u = url.value.trim();
      if (u && !/^https:\/\/[^\s]+$/i.test(u)) { msg(out, "The evaluation link must start with https://", "err"); return; }
      staffSet({ settings: { poll_ms: +poll.value, eval_url: u } }).then(function () { msg(out, "Saved.", "ok"); });
    } }));
    c.appendChild(out);
    c.appendChild(el("hr", { class: "hr" }));
    var w = setting("d2_weights") || {}, wbox = el("div", { class: "tallygrid" }), wout = el("div");
    AG.crit.forEach(function (cr) { wbox.appendChild(el("div", null, el("label", { for: "w_" + cr[0], text: cr[1] }), el("input", { type: "number", min: "0", step: "any", id: "w_" + cr[0], value: w[cr[0]] != null ? String(w[cr[0]]) : "", placeholder: "weight" }))); });
    c.appendChild(el("div", { class: "q" }, el("span", { class: "t", text: "D2 weights carried from the pre-work (optional)" }),
      el("p", { class: "help", text: "Enter the weight agreed in plenary for each question, in any unit (for example percentages). The page also always shows equal weights for comparison. Leave empty if not yet known." }), wbox));
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
      tr.appendChild(el("p", { class: "muted", style: "margin-top:0", text: "Clears every trial answer, note and participant and puts the trial back at the start. The evaluation link and the live room are not touched." }));
      tr.appendChild(el("button", { type: "button", class: "btn warn small", text: "Reset the trial room", onclick: function () {
        if (!confirm("Clear all trial answers, notes and participants? The live room is not affected.")) return;
        rpc("room_reset_trial", { p_code: S.code }).then(function (r) {
          if (r.ok) { msg(tout, "The trial room is empty again.", "ok"); S.showRes = {}; pollNow(); } else msg(tout, "That was not accepted.", "err");
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
      if (S.role === "participant" || S.role === "device") m.appendChild(el("button", { type: "button", text: "Refresh", onclick: function () { m.remove(); pollNow().then(function () { render2(); }); } }));
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
