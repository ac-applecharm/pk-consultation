"use strict";
/* PK Direction Consultation: in-room module.
   One page for four kinds of code: participant phone, group device, staff, projector.
   Everything is read and written through database functions that check the access code (see 09_room.sql). */
(function () {
  var API = "https://drwmnzmvsjhlbixqcvew.supabase.co";
  var KEY = "sb_publishable_Vzh0zj3WvlhNqJg0wHV87w_bVwjmNdv";
  var MOCK = /^(localhost|127\.0\.0\.1)$/.test(location.hostname) && /[?&]mock=1/.test(location.search);
  var $ = function (id) { return document.getElementById(id); };

  var GROUPS = ["Regional", "Local implementers", "National level", "Other"];
  var COLORS = { yellow: "Idea", pink: "Concern", green: "Condition", blue: "Question for the Executive Committee" };
  var NOTE_WORDS = 100, TEXT_WORDS = 1500;
  var SHEETS = [["T1", "Table 1"], ["T2", "Table 2"], ["T3", "Table 3"], ["T4", "Table 4"], ["C1", "Clinic 1"], ["C2", "Clinic 2"], ["C3", "Clinic 3"]];
  var ABCD = [["A", "A"], ["B", "B"], ["C", "C"], ["D", "D"]];

  // What each tagged activity looks like on a phone. The tag in the slide's speaker notes picks the entry.
  // kind "form": answered on a phone. kind "sheet": a table or clinic sheet (built in a later step).
  var REG = {
    check_in: { title: "Check-in", kind: "checkin" },
    accept_contest: { title: "Accept or contest", kind: "form", perSlide: true, items: [
      { id: "answer", label: "Do you accept this result, or do you contest it?", type: "single", options: [["accept", "Accept"], ["contest", "Contest"]] }] },
    accept_contest_option: { title: "Accept or contest", kind: "form", perSlide: true, items: [
      { id: "answer", label: "Do you accept this result, or do you contest it?", type: "single", options: [["accept", "Accept"], ["contest", "Contest"]] },
      { id: "option", label: "If you contest, which option would you put forward instead?", type: "single", options: ABCD, showIf: { item: "answer", value: "contest" } }] },
    weights_choice: { title: "Weights", kind: "form", items: [
      { id: "weights", label: "Which weights do you prefer?", type: "single", options: [["prework", "Pre-work weights"], ["equal", "Equal weights"]] }] },
    ballot_d3: { title: "Ballot (D3)", kind: "form", items: [
      { id: "first", label: "My preferred option is", type: "single", options: ABCD.concat([["Hybrid", "Hybrid"]]) },
      { id: "hybrid_text", label: "Describe your hybrid", type: "text", showIf: { item: "first", value: "Hybrid" } },
      { id: "second", label: "My second choice is", type: "single", options: ABCD.concat([["None", "None"]]) },
      { id: "no_support", label: "An option I could not support under any conditions (choose any, or none)", type: "multi", options: ABCD },
      { id: "no_support_because", label: "Because", type: "text", showIf: { item: "no_support", filled: true } },
      { id: "condition", label: "A condition under which my first choice would work", type: "text" }] },
    consent_d4: { title: "Consent level (D4)", kind: "form", items: [
      { id: "level", label: "My level of consent", type: "scale", options: [
        ["1", "Cannot support; alternative proposed"], ["2", "Serious reservations; conditions needed"], ["3", "Can live with it; concerns recorded"],
        ["4", "Support with minor concerns"], ["5", "Fully support"]] },
      { id: "reason", label: "My reason, condition or alternative (needed for level 1 or 2)", type: "text" }] },
    evaluation: { title: "Evaluation", kind: "link" },
    d9_models: { title: "D9 models matrix", kind: "sheet" }, d2_score: { title: "D2 scoring", kind: "sheet" }, d2_table: { title: "D2 table summary", kind: "sheet" },
    departures: { title: "Departures", kind: "sheet" }, hybrid: { title: "Hybrid line", kind: "sheet" }, regional_worksheet: { title: "Regional worksheet (D10)", kind: "sheet" },
    correction: { title: "Corrections", kind: "sheet" }, case_for_against: { title: "Case for and against", kind: "sheet" }, clinic_d5: { title: "Clinic sheet (D5)", kind: "sheet" },
    indicators_d6: { title: "Indicators (D6)", kind: "sheet" }, gallery_walk: { title: "Gallery walk", kind: "sheet" }, partner_d7: { title: "Partner matrix (D7)", kind: "sheet" },
    action_register: { title: "Action register", kind: "sheet" }
  };

  var S = {
    code: null, role: null, session: null, profile: {}, st: null, ver: null, skew: 0, joined: null, counts: {},
    slides: [], byId: {}, deckVer: undefined, deckMsg: "", tab: "run", follow: true, localId: null, browse: false, browseId: null,
    mine: {}, queue: [], marks: {}, pollTimer: null, fails: 0, sig: "", showRes: {}, res: {}, wall: [], notesMine: [], menuOpen: false,
    upload: null, preview: null, versions: null, tallyPick: 0, running: false
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
      .then(function (r) { if (!r.ok) throw new Error("http " + r.status); return r.json(); });
  }
  function toast(text) {
    var t = $("toast"); t.textContent = text; t.hidden = false; clearTimeout(toast.t);
    toast.t = setTimeout(function () { t.hidden = true; }, 3800);
  }
  function msg(node, text, kind) { clear(node); if (text) node.appendChild(el("div", { class: "msg " + (kind || ""), text: text })); }
  function actKey(a) { return a.name + (a.attrs && a.attrs.clinic ? "_" + a.attrs.clinic : ""); }
  function actState(key) { return (S.st && S.st.acts && S.st.acts[key]) || "none"; }
  function stateLabel(v) { return { none: "Not open", open: "Open", closed: "Closed", revealed: "Revealed" }[v] || "Not open"; }
  function itemKeyFor(def, item, slide) { return def.perSlide && slide ? slide.id + "/" + item.id : item.id; }
  function pollMs() { var n = +(S.st && S.st.settings && S.st.settings.poll_ms) || 5000; return Math.max(2000, Math.min(30000, n)); }
  function setting(k) { return S.st && S.st.settings ? S.st.settings[k] : undefined; }
  function evalUrl() { var u = setting("eval_url"); return typeof u === "string" && /^https:\/\/[^\s]+$/i.test(u) ? u : ""; }
  function isStaff() { return S.role === "staff"; }
  function isProj() { return S.role === "projector"; }

  // ---------- slide drawing ----------
  function runsNode(runs) {
    var frag = document.createDocumentFragment();
    (runs || []).forEach(function (r) {
      String(r[0]).split(/(\[__\])/).forEach(function (part) {
        if (!part) return;
        var node = part === "[__]" ? el("span", { class: "blank", text: part }) : document.createTextNode(part);
        if (r[1] & 1) node = el("b", null, node);
        if (r[1] & 2) node = el("i", null, node);
        frag.appendChild(node);
      });
    });
    return frag;
  }
  function itemNode(it) {
    if (it.t === "p") {
      var p = el("p", { class: it.bullet ? "bl" : "" }, runsNode(it.runs));
      if (it.lvl) p.style.marginLeft = (it.lvl * 18) + "px";
      return p;
    }
    if (it.t === "steps") {
      var ol = el("ol", { class: "rsteps" });
      it.items.forEach(function (s) { ol.appendChild(el("li", null, el("span", { class: "num", text: s.n }), el("div", null, s.items.map(itemNode)))); });
      return ol;
    }
    if (it.t === "row") {
      var row = el("div", { class: "rrow" });
      row.style.setProperty("--cols", it.cols.map(function (c) { return c.w + "fr"; }).join(" "));
      it.cols.forEach(function (c) { row.appendChild(el("div", null, c.items.map(itemNode))); });
      return row;
    }
    if (it.t === "card") return el("div", { class: "rcard" }, (it.items || []).map(itemNode));
    if (it.t === "table") {
      var tb = el("table");
      it.rows.forEach(function (r, i) {
        var tr = el("tr");
        r.forEach(function (c) { tr.appendChild(el(i === 0 ? "th" : "td", null, runsNode(c))); });
        tb.appendChild(tr);
      });
      return el("div", { class: "cmp" }, tb);
    }
    if (it.t === "img") return el("img", { src: it.src, alt: it.alt || "" });
    return null;
  }
  function slideNode(slide) {
    var box = el("article", { class: "rslide" });
    if (slide.kicker) box.appendChild(el("div", { class: "rkicker", text: slide.kicker }));
    box.appendChild(el("h2", { class: "rtitle", text: slide.title || "" }));
    (slide.body || []).forEach(function (it) { var n = itemNode(it); if (n) box.appendChild(n); });
    if (slide.footer) box.appendChild(el("div", { class: "rfoot", text: slide.footer }));
    return box;
  }

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
      if (r.ok) { S.queue.shift(); S.hadSave = true; saveQueue(); setMark(key, "saved"); flush(); return; }
      if (r.reason === "not_joined" && !S.rejoined) {
        S.rejoined = true;
        joinCall(S.profile).then(function () { flush(); }).catch(function () { setSave("queued"); });
        return;
      }
      S.queue.shift(); saveQueue(); setMark(key, "closed");
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
      S.code = code; S.role = r.role;
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
      S.role = r.role;
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
    S.mine = {}; loadQueue(); S.ver = null; S.deckVer = undefined;
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
      S.ver = r.version; S.st = r;
      S.skew = Date.parse(r.now) - Date.now();
      var loadDeckFirst = r.deck_version !== S.deckVer ? loadDeck(r.deck_version) : Promise.resolve();
      return loadDeckFirst.then(function () { render(); updateLive(); return refreshLive(); });
    }, function () {
      // only a failed request lands here; a bug in drawing the page does not
      S.fails += 1;
      if (S.fails >= 2) { var n = $("saveState"); n.hidden = false; n.className = "save warn"; n.textContent = "Connection lost. Trying again..."; }
    });
  }
  function loadDeck(version) {
    return rpc("room_get_deck", { p_code: S.code, p_version: null }).then(function (r) {
      if (r.ok) {
        S.slides = r.deck.slides || []; S.byId = {}; S.slides.forEach(function (s) { S.byId[s.id] = s; }); S.deckMsg = "";
      } else { S.slides = []; S.byId = {}; S.deckMsg = r.reason === "no_deck" ? "The slides have not been published yet." : "The slides could not be loaded."; }
      S.deckVer = version;
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
    chip.textContent = ({ staff: "Staff", projector: "Projector", participant: S.profile.table ? "Table " + S.profile.table + " · " + S.profile.grp : "Participant", device: (SHEETS.filter(function (s) { return s[0] === S.profile.sheet; })[0] || [0, "Group device"])[1] })[S.role] + (isStaff() && S.joined != null ? " · " + S.joined + " online" : "");
    [].forEach.call(document.querySelectorAll("[data-count]"), function (n) {
      var c = S.counts[n.getAttribute("data-count")] || 0;
      n.textContent = isProj() ? c + (c === 1 ? " response received" : " responses received") : c + (c === 1 ? " response" : " responses");
    });
    if (S.fails === 0 && $("saveState").className.indexOf("warn") >= 0 && !S.queue.length) setSave(S.hadSave ? "saved" : null);
  }
  document.addEventListener("visibilitychange", function () { if (!document.hidden && S.running) pollNow(); });
  window.addEventListener("online", function () { if (S.running) { pollNow(); flush(); } });

  // ---------- which slide is showing ----------
  function curSlide() {
    if (!S.slides.length) return null;
    var roomId = S.st && S.st.slide_id;
    if (isStaff()) return S.byId[S.follow ? roomId : (S.localId || roomId)] || S.slides[0];
    if (S.role !== "projector" && S.browse) return S.byId[S.browseId] || S.byId[roomId] || null;
    return S.byId[roomId] || null;
  }
  function slideActs(slide) { return slide && slide.activities ? slide.activities : []; }

  // ---------- render dispatch ----------
  function render() {
    if (!S.running || !S.st) return;
    if (isStaff()) renderStaff(); else if (isProj()) renderProj(); else renderPart();
  }
  function buildTabs() {
    var nav = $("tabs"); clear(nav); nav.hidden = !isStaff();
    if (!isStaff()) return;
    [["run", "Run"], ["deck", "Deck"], ["notes", "Notes"], ["paper", "Paper entries"], ["settings", "Settings"]].forEach(function (t) {
      nav.appendChild(el("button", { type: "button", class: "rtab", role: "tab", "aria-selected": S.tab === t[0] ? "true" : "false", "data-tab": t[0], text: t[1], onclick: function () {
        S.tab = t[0];
        [].forEach.call(nav.children, function (b) { b.setAttribute("aria-selected", b.getAttribute("data-tab") === S.tab ? "true" : "false"); });
        S.sig = ""; renderStaff(true);
      } }));
    });
  }

  // ---------- participants and group devices ----------
  function partSig(slide) {
    var parts = [S.deckVer, slide ? slide.id : "none", S.browse ? "b" : "f", evalUrl()];
    slideActs(slide).forEach(function (a) { parts.push(actKey(a) + "=" + actState(actKey(a))); });
    if (slide && slide.noteColors) parts.push("n:" + slide.noteColors.join(","));
    return parts.join("~");
  }
  function renderPart(force) {
    var view = $("view"), slide = curSlide(), sig = partSig(slide);
    if (!force && sig === S.sig) return;
    S.sig = sig; S.marks = {};
    clear(view);
    var bar = el("div", { class: "slidebar" });
    if (S.slides.length) {
      var visible = S.slides;
      if (S.browse) {
        var i = visible.indexOf(slide);
        bar.appendChild(el("button", { type: "button", class: "btn ghost small", text: "Back", disabled: i <= 0, onclick: function () { S.browseId = visible[i - 1].id; render2(); } }));
        bar.appendChild(el("span", { class: "count", text: "Slide " + (i + 1) + " of " + visible.length }));
        bar.appendChild(el("button", { type: "button", class: "btn ghost small", text: "Next", disabled: i < 0 || i >= visible.length - 1, onclick: function () { S.browseId = visible[i + 1].id; render2(); } }));
        bar.appendChild(el("button", { type: "button", class: "btn small", text: "Back to the presenter", onclick: function () { S.browse = false; render2(); } }));
      } else {
        bar.appendChild(el("button", { type: "button", class: "btn ghost small", text: "Browse the slides on my own", onclick: function () {
          S.browse = true; S.browseId = (slide && slide.id) || (visible[0] && visible[0].id); render2();
        } }));
      }
    }
    view.appendChild(bar);
    if (!slide) {
      view.appendChild(el("div", { class: "card" }, el("h2", { text: S.deckMsg ? "Please wait" : "Please wait for the next slide" }),
        el("p", { text: S.deckMsg || "The facilitators will show the next slide shortly. This page updates by itself." })));
      return;
    }
    view.appendChild(slideNode(slide));
    slideActs(slide).forEach(function (a) { var n = activityPanel(a, slide); if (n) view.appendChild(n); });
    if (slide.noteColors && slide.noteColors.length) view.appendChild(notesPanel(slide));
  }
  function render2() { S.sig = ""; renderPart(true); window.scrollTo(0, 0); }

  function activityPanel(a, slide) {
    var def = REG[a.name], key = actKey(a), state = actState(key);
    if (!def) return el("section", { class: "apanel locked" }, el("h3", { text: a.name }), el("p", { class: "help", text: "Follow your facilitator for this activity." }));
    if (def.kind === "checkin") return checkinPanel();
    if (def.kind === "link") return linkPanel(def);
    if (def.kind === "sheet") {
      return el("section", { class: "apanel locked" }, el("h3", null, def.title), el("p", { class: "help", style: "margin:0",
        text: S.role === "device" ? "The group sheet for this activity is not ready yet. Follow your facilitator and record on paper for now." : "This activity is done at your table. Follow your facilitator." }));
    }
    var box = el("section", { class: "apanel" + (state === "open" ? "" : " locked") });
    box.appendChild(el("h3", null, def.title, " ", el("span", { class: "state " + state, text: stateLabel(state) })));
    if (state !== "open") {
      box.appendChild(el("p", { class: "help", style: "margin:0 0 10px", text: state === "closed" ? "This activity is closed." : state === "revealed" ? "The result is on the screen." : "Not open yet. Your facilitator will tell you when to start." }));
      var shown = false;
      def.items.forEach(function (it) {
        var m = S.mine[mk(key, itemKeyFor(def, it, slide))]; if (!m) return;
        if (!shown) { box.appendChild(el("div", { class: "help", style: "margin-top:6px", text: "Your saved answer:" })); shown = true; }
        box.appendChild(el("div", { text: it.label + ": " + answerText(it, m) }));
      });
      return box;
    }
    if (S.role === "device") { box.appendChild(el("p", { class: "help", text: "Personal answers are entered on each person's own phone. The facilitators will tell you how this table takes part." })); return box; }
    var holders = {};
    def.items.forEach(function (it) { var q = itemBlock(key, def, it, slide, holders); holders[it.id] = q; box.appendChild(q.node); });
    refreshShowIf(def, key, slide, holders);
    return box;
  }
  function answerText(it, payload) {
    if (it.type === "text") return payload.text || "";
    var v = payload.v, lab = function (x) { var o = (it.options || []).filter(function (p) { return p[0] === x; })[0]; return o ? (it.type === "scale" ? x : o[1]) : x; };
    return Array.isArray(v) ? (v.length ? v.map(lab).join(", ") : "none") : lab(v);
  }
  function refreshShowIf(def, key, slide, holders) {
    def.items.forEach(function (it) {
      if (!it.showIf) return;
      var m = S.mine[mk(key, itemKeyFor(def, def.items.filter(function (x) { return x.id === it.showIf.item; })[0], slide))], ok = false, v = m ? m.v : undefined;
      if (it.showIf.value !== undefined) ok = v === it.showIf.value;
      if (it.showIf.filled) ok = Array.isArray(v) ? v.length > 0 : !!v;
      holders[it.id].node.hidden = !ok;
    });
  }
  function itemBlock(key, def, it, slide, holders) {
    var ik = itemKeyFor(def, it, slide), mkey = mk(key, ik), cur = S.mine[mkey], mark = el("span", { class: "saved-mark" });
    S.marks[mkey] = mark;
    var q = el("div", { class: "q" }), lab = el("span", { class: "t" }, it.label, mark);
    q.appendChild(lab);
    function after() { refreshShowIf(def, key, slide, holders); }
    if (it.type === "single") {
      q.appendChild(radioGroup(mkey, it.options, cur ? cur.v : null, function (v) { saveItem(key, ik, { v: v }); after(); }));
    } else if (it.type === "scale") {
      var sc = el("div", { class: "scale" });
      it.options.forEach(function (o) {
        var inp = el("input", { type: "radio", name: mkey, value: o[0], checked: cur && cur.v === o[0] });
        var l = el("label", { class: cur && cur.v === o[0] ? "sel" : "" }, inp, el("span", { text: o[0] }));
        inp.addEventListener("change", function () { [].forEach.call(sc.children, function (x) { x.classList.remove("sel"); }); l.classList.add("sel"); saveItem(key, ik, { v: o[0] }); after(); });
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
          l.classList.toggle("sel", inp.checked); saveItem(key, ik, { v: chosen.slice() }); after();
        });
        wrap.appendChild(l);
      });
      q.appendChild(wrap);
    } else if (it.type === "text") {
      var ta = el("textarea", { value: cur ? cur.text || "" : "", "aria-label": it.label }), cnt = el("div", { class: "counter" }), timer;
      function count() { var n = wc(ta.value); cnt.textContent = n + " / " + TEXT_WORDS + " words"; cnt.className = "counter" + (n > TEXT_WORDS ? " over" : ""); return n; }
      ta.addEventListener("input", function () {
        if (count() > TEXT_WORDS) return;
        clearTimeout(timer); timer = setTimeout(function () { saveItem(key, ik, { text: ta.value }); }, 1200);
      });
      ta.addEventListener("blur", function () { clearTimeout(timer); if (wc(ta.value) <= TEXT_WORDS && (ta.value || cur)) { var prev = S.mine[mkey]; if (!prev || prev.text !== ta.value) saveItem(key, ik, { text: ta.value }); } });
      count(); q.appendChild(ta); q.appendChild(cnt);
    }
    return { node: q };
  }
  function checkinPanel() {
    var p = S.profile, box = el("section", { class: "apanel" }, el("h3", { text: "You are checked in" }));
    if (S.role === "device") box.appendChild(el("p", { text: "This device is set up as " + (SHEETS.filter(function (s) { return s[0] === p.sheet; })[0] || [0, "a group device"])[1] + "." }));
    else box.appendChild(el("p", { text: "Table " + p.table + " · " + p.grp + " · Pre-work: " + (p.prework === true ? "yes" : p.prework === false ? "no" : "not stated") }));
    box.appendChild(el("button", { type: "button", class: "btn ghost small", text: "Change this", onclick: function () {
      var holder = el("div"); box.appendChild(holder);
      var done = function (prof) { joinCall(prof).then(function (r) { if (r.ok) { S.profile = { session: S.session, grp: prof.grp, table: prof.table, sheet: prof.sheet, prework: prof.prework }; lsSet(profileKey(S.code), S.profile); updateLive(); render2(); toast("Saved."); } }); };
      (S.role === "device" ? sheetForm : profileForm)(p, done, holder);
    } }));
    return box;
  }
  function linkPanel(def) {
    var u = evalUrl(), box = el("section", { class: "apanel" }, el("h3", { text: def.title }));
    if (u) box.appendChild(el("p", null, el("a", { class: "btn", href: u, target: "_blank", rel: "noopener noreferrer", text: "Open the evaluation" })));
    else box.appendChild(el("p", { class: "help", text: "Your facilitator will share the evaluation link or QR code." }));
    return box;
  }
  function notesPanel(slide) {
    var colors = slide.noteColors.filter(function (c) { return COLORS[c]; });
    if (!colors.length) return null;
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
      rpc("room_add_note", { p_code: S.code, p_session: S.session, p_color: pick, p_body: ta.value.trim(), p_slide: slide.id }).then(function (r) {
        send.disabled = false;
        if (r.ok) { ta.value = ""; count(); msg(out, ""); toast("Note added."); loadMine(); } else msg(out, "The note could not be added. Please try again.", "err");
      }).catch(function () { send.disabled = false; msg(out, "No connection. Your note is still in the box. Try again in a moment.", "err"); });
    } });
    function loadMine() {
      rpc("room_get_notes", { p_code: S.code, p_session: S.session, p_slide: slide.id }).then(function (r) {
        clear(list); if (!r.ok || !r.notes.length) return;
        list.appendChild(el("div", { class: "help", text: r.wall ? "Notes on this slide" : "Your notes on this slide" }));
        r.notes.forEach(function (n) { list.appendChild(el("div", { class: "stick c-" + n.color }, n.body, el("small", { text: (COLORS[n.color] || "") + " · " + (n.label || "") }))); });
      }).catch(function () {});
    }
    box.appendChild(flow); box.appendChild(ta); box.appendChild(cnt); box.appendChild(el("div", { class: "row", style: "margin-top:8px" }, send)); box.appendChild(out); box.appendChild(list);
    loadMine();
    return box;
  }

  // ---------- results tables (staff and projector) ----------
  function resultsNode(act, slide, rows, role, onlyItem) {
    var def = REG[act.name], box = el("div"), byItem = {}, items = [];
    (rows || []).forEach(function (r) { (byItem[r.item] = byItem[r.item] || []).push(r); });
    var defs = def && def.items ? def.items.filter(function (it) { return it.type !== "text"; }) : [];
    defs.forEach(function (it) { var ik = itemKeyFor(def, it, slide); items.push({ it: it, ik: ik, label: it.label, options: it.options }); });
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

  // ---------- projector ----------
  function renderProj() {
    var view = $("view"), slide = curSlide(), sig = [S.deckVer, slide ? slide.id : "none", setting("show_wall") ? "w" : "", slideActs(slide).map(function (a) { return actKey(a) + actState(actKey(a)); }).join(",")].join("~");
    if (sig === S.sig) return;
    S.sig = sig; clear(view);
    if (!slide) { view.appendChild(el("div", { class: "standby", text: S.deckMsg || "PuroKalusugan · Direction Consultation" })); return; }
    view.appendChild(slideNode(slide));
    slideActs(slide).forEach(function (a) {
      var key = actKey(a), st = actState(key), def = REG[a.name];
      if (!def || def.kind !== "form") return;
      if (st === "open") view.appendChild(el("div", { class: "resblock" }, el("h3", { text: def.title }), el("div", { class: "counts", "data-count": key })));
      if (st === "revealed") {
        var holder = el("div", { class: "resblock", id: "res_" + key }, el("h3", { text: def.title + ": result" }), el("div", { id: "resbody_" + key }));
        view.appendChild(holder);
      }
    });
    if (setting("show_wall")) view.appendChild(el("div", { id: "wallbox", class: "resblock" }, el("h3", { text: "Notes" }), el("div", { id: "wallbody" })));
  }

  // data that is fetched while a result or the wall is on screen
  function refreshLive() {
    var jobs = [], slide = curSlide();
    if (isProj() && slide) {
      slideActs(slide).forEach(function (a) {
        var key = actKey(a);
        if (REG[a.name] && REG[a.name].kind === "form" && actState(key) === "revealed") jobs.push(fetchResults(a, slide, "projector"));
      });
      if (setting("show_wall")) jobs.push(fetchWall());
    }
    if (isStaff()) {
      Object.keys(S.showRes).forEach(function (key) { var a = S.showRes[key]; if (a && slide && S.byId[a.slideId]) jobs.push(fetchResults(a.act, S.byId[a.slideId], "staff")); });
      if (S.tab === "notes") jobs.push(fetchWall());
    }
    return Promise.all(jobs.map(function (j) { return j.catch(function () {}); }));
  }
  function fetchResults(act, slide, role) {
    var key = actKey(act);
    return rpc("room_results", { p_code: S.code, p_activity: key, p_mode: "votes" }).then(function (r) {
      var target = $(role === "projector" ? "resbody_" + key : "staffres_" + key);
      if (!target) return;
      clear(target);
      if (!r.ok) { target.appendChild(el("p", { class: "muted", text: r.reason === "hidden" ? "Not revealed yet." : "Could not load the result." })); return; }
      var rows = r.rows.filter(function (x) { return !REG[act.name].perSlide || x.item.indexOf(slide.id + "/") === 0; });
      target.appendChild(resultsNode(act, slide, rows, role));
    });
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
        var card = el("div", { class: "stick c-" + c + (n.hidden ? " hid" : "") }, n.body, el("small", { text: (n.label || "") + (n.cluster ? " · " + n.cluster : "") + (n.hidden ? " · hidden" : "") }));
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
    }).catch(function () { toast("No connection. Try again."); });
  }
  function renderStaff(force) {
    var view = $("view");
    if (S.tab !== "run") { if (force) { clear(view); ({ deck: tabDeck, notes: tabNotes, paper: tabPaper, settings: tabSettings })[S.tab](view); } return; }
    var slide = curSlide(), roomId = S.st.slide_id, sig = [S.deckVer, slide ? slide.id : "none", roomId, S.follow, JSON.stringify(S.st.acts), JSON.stringify(S.st.settings), S.st.timer_end].join("~");
    if (!force && sig === S.sig) return;
    S.sig = sig; clear(view);
    if (!S.slides.length) {
      view.appendChild(el("div", { class: "ctl" }, el("h3", { text: "No slides yet" }), el("p", { text: S.deckMsg || "Upload the deck on the Deck tab first." }),
        el("button", { type: "button", class: "btn small", text: "Go to the Deck tab", onclick: function () { S.tab = "deck"; buildTabs(); renderStaff(true); } })));
      return;
    }
    var idx = S.slides.indexOf(slide);
    var bar = el("div", { class: "ctl" });
    var row1 = el("div", { class: "slidebar", style: "margin:0" });
    var follow = el("input", { type: "checkbox", checked: S.follow, id: "followBox", style: "width:20px;height:20px" });
    follow.addEventListener("change", function () { S.follow = follow.checked; if (S.follow && slide) goSlide(slide.id); else { S.localId = slide && slide.id; S.sig = ""; renderStaff(true); } });
    row1.appendChild(el("label", { class: "row tight", for: "followBox", style: "cursor:pointer" }, follow, el("span", { text: "The room follows me" })));
    row1.appendChild(el("button", { type: "button", class: "btn ghost small", text: "Previous", disabled: idx <= 0, onclick: function () { stepSlide(-1); } }));
    var sel = el("select", { "aria-label": "Choose a slide" });
    S.slides.forEach(function (s) { sel.appendChild(el("option", { value: s.id, selected: s.id === slide.id, text: s.n + ". " + (s.teamOnly ? "[TEAM ONLY] " : "") + (s.title || "").slice(0, 70) })); });
    sel.addEventListener("change", function () { goSlide(sel.value); });
    row1.appendChild(sel);
    row1.appendChild(el("button", { type: "button", class: "btn ghost small", text: "Next", disabled: idx >= S.slides.length - 1, onclick: function () { stepSlide(1); } }));
    row1.appendChild(el("span", { class: "count", text: (idx + 1) + " of " + S.slides.length }));
    bar.appendChild(row1);
    if (slide.id !== roomId) {
      bar.appendChild(el("div", { class: "row", style: "margin-top:10px" }, el("span", { class: "muted small", text: roomId ? "The room is showing a different slide." : "The room is not showing a slide yet." }),
        el("button", { type: "button", class: "btn small", text: "Show this slide to the room", onclick: function () { staffSet({ slide_id: slide.id }); } })));
    }
    if (slide.teamOnly) bar.appendChild(el("div", { class: "msg", style: "margin-top:10px", text: "TEAM ONLY: participants and the projector will not see this slide." }));
    view.appendChild(bar);

    // timer
    var tm = el("div", { class: "ctl" }, el("h3", { text: "Timer" }));
    var trow = el("div", { class: "row tight" });
    [1, 3, 5, 10, 15, 20].forEach(function (m) { trow.appendChild(el("button", { type: "button", class: "btn ghost small", text: m + " min", onclick: function () { setTimerMin(m); } })); });
    trow.appendChild(el("button", { type: "button", class: "btn ghost small", text: "+1 min", onclick: function () { addMinute(); } }));
    trow.appendChild(el("button", { type: "button", class: "btn ghost small", text: "Clear", onclick: function () { staffSet({ timer_end: "" }); } }));
    tm.appendChild(trow); view.appendChild(tm);

    view.appendChild(slideNode(slide));

    var acts = slideActs(slide);
    if (acts.length) {
      var ac = el("div", { class: "ctl" }, el("h3", { text: "Activities on this slide" }));
      acts.forEach(function (a) { ac.appendChild(actControl(a, slide)); });
      view.appendChild(ac);
    }
    if (slide.noteColors && slide.noteColors.length) view.appendChild(el("div", { class: "ctl" }, el("h3", { text: "Sticky notes" }), el("p", { class: "muted", style: "margin:0", text: "Phones can add notes here: " + slide.noteColors.map(function (c) { return COLORS[c]; }).join(", ") + ". See them on the Notes tab." })));
    if (slide.notes && slide.notes.length) {
      var d = el("details", { open: true }, el("summary", { text: "Speaker notes (staff only)" }), el("div", { class: "notes" }, el("ul", null, slide.notes.map(function (n) { return el("li", { text: n }); }))));
      view.appendChild(d);
    }
    refreshLive();
  }
  function goSlide(id) {
    if (S.follow) { S.st.slide_id = id; S.sig = ""; renderStaff(true); staffSet({ slide_id: id }); }
    else { S.localId = id; S.sig = ""; renderStaff(true); }
  }
  function stepSlide(d) {
    var i = S.slides.indexOf(curSlide()), j = Math.max(0, Math.min(S.slides.length - 1, i + d));
    if (j !== i) goSlide(S.slides[j].id);
  }
  document.addEventListener("keydown", function (e) {
    if (!S.running || !isStaff() || S.tab !== "run" || /^(INPUT|TEXTAREA|SELECT)$/.test((e.target.tagName || ""))) return;
    if (e.key === "ArrowRight") stepSlide(1); if (e.key === "ArrowLeft") stepSlide(-1);
  });
  function setTimerMin(m) { staffSet({ timer_end: new Date(Date.now() + S.skew + m * 60000).toISOString() }); }
  function addMinute() {
    var end = S.st.timer_end ? Date.parse(S.st.timer_end) : 0, now = Date.now() + S.skew;
    staffSet({ timer_end: new Date((end > now ? end : now) + 60000).toISOString() });
  }
  function actControl(a, slide) {
    var key = actKey(a), def = REG[a.name], st = actState(key), box = el("div", { style: "margin-bottom:16px" });
    var title = (def ? def.title : a.name) + (a.attrs && a.attrs.clinic ? " " + a.attrs.clinic : "");
    var row = el("div", { class: "row" }, el("span", { class: "actname", text: title }), el("span", { class: "state " + st, text: stateLabel(st) }), el("span", { class: "counts", "data-count": key }));
    box.appendChild(row);
    if (!def || def.kind === "sheet" || def.kind === "checkin" || def.kind === "link") {
      if (def && def.kind === "link") box.appendChild(el("div", { class: "muted small", text: evalUrl() ? "Phones show the evaluation link." : "Add the evaluation link on the Settings tab." }));
      else if (def && def.kind === "sheet") box.appendChild(el("div", { class: "muted small", text: "Group sheet: not built yet. Open and close are saved so the sheet can use them later." }));
    }
    var btns = el("div", { class: "row tight", style: "margin-top:8px" });
    [["open", "Open"], ["closed", "Close"], ["revealed", "Reveal on the projector"], ["none", "Reset"]].forEach(function (b) {
      btns.appendChild(el("button", { type: "button", class: "btn small" + (st === b[0] ? "" : " ghost"), text: b[1], "aria-pressed": st === b[0] ? "true" : "false", onclick: function () { var p = { acts: {} }; p.acts[key] = b[0]; staffSet(p); } }));
    });
    if (def && def.kind === "form") {
      btns.appendChild(el("button", { type: "button", class: "btn ghost small", text: S.showRes[key] ? "Hide live result" : "Show live result", onclick: function () {
        if (S.showRes[key]) delete S.showRes[key]; else S.showRes[key] = { act: a, slideId: slide.id };
        S.sig = ""; renderStaff(true);
      } }));
    }
    box.appendChild(btns);
    if (def && def.kind === "form" && S.showRes[key]) box.appendChild(el("div", { id: "staffres_" + key, style: "margin-top:10px" }, el("p", { class: "muted", text: "Loading..." })));
    return box;
  }

  // ----- deck tab -----
  function tabDeck(view) {
    var live = el("div", { class: "ctl" }, el("h3", { text: "Slides" }),
      el("p", { class: "muted", style: "margin-top:0", text: "Live deck version: " + (S.st.deck_version || "none yet") + (S.slides.length ? " · " + S.slides.length + " slides for staff" : "") }));
    var file = el("input", { type: "file", accept: ".pptx", id: "pptxFile", "aria-label": "Choose a PowerPoint file" }), out = el("div");
    file.addEventListener("change", function () {
      var f = file.files[0]; if (!f) return;
      msg(out, "Reading " + f.name + "...");
      f.arrayBuffer().then(function (buf) { return window.PKPptx.parse(buf, f.name); }).then(function (res) {
        S.upload = { name: f.name, res: res }; S.preview = null; renderStaff(true);
      }).catch(function (e) { msg(out, "That file could not be read: " + (e && e.message ? e.message : "unknown problem"), "err"); });
    });
    live.appendChild(el("div", { class: "q", style: "margin-bottom:6px" }, el("span", { class: "t", text: "Upload a new version (.pptx)" }), file));
    live.appendChild(out);
    view.appendChild(live);
    if (S.upload) view.appendChild(uploadCard());
    var vc = el("div", { class: "ctl" }, el("h3", { text: "Saved versions" }), el("div", { id: "verbox" }, el("p", { class: "muted", text: "Loading..." })));
    view.appendChild(vc);
    loadVersions();
    if (S.preview) view.appendChild(previewCard(S.preview.deck, "Preview: " + S.preview.name));
  }
  function loadVersions() {
    rpc("room_list_decks", { p_code: S.code }).then(function (r) {
      var box = $("verbox"); if (!box) return; clear(box);
      if (!r.ok || !r.decks.length) { box.appendChild(el("p", { class: "muted", text: "No version has been saved yet." })); return; }
      var tb = el("table", { class: "verlist" }, el("tr", null, el("th", { text: "Version" }), el("th", { text: "Saved" }), el("th", { text: "Slides" }), el("th", { text: "" })));
      r.decks.forEach(function (d) {
        tb.appendChild(el("tr", null, el("td", { text: d.version + (d.live ? " (live)" : "") }), el("td", { text: new Date(d.uploaded_at).toLocaleString() }), el("td", { text: String(d.slides) }),
          el("td", null, el("div", { class: "row tight" },
            el("button", { type: "button", class: "btn ghost small", text: "Preview", onclick: function () {
              rpc("room_get_deck", { p_code: S.code, p_version: d.version }).then(function (g) { if (g.ok) { S.preview = { name: d.version, deck: g.deck }; S.upload = null; renderStaff(true); } }); } }),
            d.live ? null : el("button", { type: "button", class: "btn small", text: "Make live", onclick: function () { if (confirm("Switch every device to version " + d.version + " now?")) makeLive(d.version); } })))));
      });
      box.appendChild(tb);
    }).catch(function () {});
  }
  function makeLive(v) {
    return rpc("room_set_deck_live", { p_code: S.code, p_version: v }).then(function (r) {
      if (r.ok) { toast("Version " + v + " is live."); S.sig = ""; return pollNow().then(function () { renderStaff(true); }); }
      toast("Could not make it live.");
    }).catch(function () { toast("No connection."); });
  }
  function uploadCard() {
    var u = S.upload, res = u.res, box = el("div", { class: "ctl" }, el("h3", { text: "Checking " + u.name }));
    var known = Object.keys(REG), found = Object.keys(res.tags.activity);
    var problems = res.warnings.slice();
    found.forEach(function (n) { if (known.indexOf(n) < 0) problems.push("Activity tag \"" + n + "\" on slide " + res.tags.activity[n].join(", ") + " is not one the room knows. It will be ignored."); });
    known.forEach(function (n) { if (found.indexOf(n) < 0) problems.push("Activity \"" + n + "\" is not on any slide in this file."); });
    var teams = res.deck.slides.filter(function (s) { return s.teamOnly; }).map(function (s) { return s.n; });
    var size = JSON.stringify(res.deck).length;
    box.appendChild(el("p", { text: res.deck.slides.length + " slides read · " + found.length + " activity tags · " + Object.keys(res.tags.chart).length + " chart tags · team-only slides: " + (teams.join(", ") || "none") + " · size " + (size / 1048576).toFixed(2) + " MB" }));
    if (problems.length) { box.appendChild(el("div", { class: "help", text: "Please read these before you go live:" })); box.appendChild(el("ul", { class: "warnlist" }, problems.map(function (p) { return el("li", { text: p }); }))); }
    else box.appendChild(el("div", { class: "msg ok", text: "No problems found." }));
    var d = new Date(), pad = function (n) { return ("0" + n).slice(-2); };
    var base = u.name.replace(/\.pptx$/i, "").replace(/[^A-Za-z0-9 _.-]/g, "").slice(0, 50) + " " + d.getFullYear() + pad(d.getMonth() + 1) + pad(d.getDate()) + "-" + pad(d.getHours()) + pad(d.getMinutes());
    var name = el("input", { type: "text", value: base, "aria-label": "Version name", maxlength: "80" }), out = el("div"), liveBox = el("input", { type: "checkbox", checked: true, id: "liveBox", style: "width:20px;height:20px" });
    box.appendChild(el("div", { class: "q", style: "margin-top:14px" }, el("span", { class: "t", text: "Version name" }), name));
    box.appendChild(el("label", { class: "row tight", for: "liveBox", style: "margin-bottom:12px;cursor:pointer" }, liveBox, el("span", { text: "Make it live for everyone as soon as it is saved" })));
    var save = el("button", { type: "button", class: "btn", text: "Save this version", onclick: function () {
      if (size > 11500000) { msg(out, "This deck is too large (" + (size / 1048576).toFixed(1) + " MB). Remove large pictures and try again.", "err"); return; }
      var v = name.value.trim(); if (!v) { msg(out, "Please give the version a name.", "err"); return; }
      save.disabled = true; msg(out, "Saving...");
      rpc("room_publish_deck", { p_code: S.code, p_version: v, p_body: res.deck }).then(function (r) {
        if (!r.ok) { save.disabled = false; msg(out, r.reason === "too_large" ? "The deck is too large." : "It was not saved (" + (r.reason || "unknown") + ").", "err"); return; }
        var after = liveBox.checked ? makeLive(v) : Promise.resolve();
        return after.then(function () { toast("Saved."); S.upload = null; S.sig = ""; renderStaff(true); });
      }).catch(function () { save.disabled = false; msg(out, "No connection. Nothing was saved.", "err"); });
    } });
    box.appendChild(el("div", { class: "row" }, save, el("button", { type: "button", class: "btn ghost", text: "Cancel", onclick: function () { S.upload = null; renderStaff(true); } })));
    box.appendChild(out);
    box.appendChild(previewCard(res.deck, "Preview of the file"));
    return box;
  }
  function previewCard(deck, title) {
    var wrap = el("div", { class: "ctl" }, el("h3", { text: title })), holder = el("div"), sel = el("select", { "aria-label": "Preview slide" });
    deck.slides.forEach(function (s, i) { sel.appendChild(el("option", { value: String(i), text: s.n + ". " + (s.teamOnly ? "[TEAM ONLY] " : "") + (s.title || "").slice(0, 70) })); });
    function show() {
      clear(holder); var s = deck.slides[+sel.value]; if (!s) return;
      holder.appendChild(slideNode(s));
      var tags = [].concat((s.activities || []).map(function (a) { return "activity: " + a.name + (a.attrs && a.attrs.clinic ? " clinic " + a.attrs.clinic : ""); }), (s.charts || []).map(function (c) { return "chart: " + c; }), s.noteColors ? ["notes: " + s.noteColors.join(", ")] : [], s.teamOnly ? ["team-only"] : []);
      holder.appendChild(el("p", { class: "muted small", text: tags.length ? "Tags: " + tags.join(" · ") : "No tags on this slide." }));
    }
    sel.addEventListener("change", show);
    wrap.appendChild(el("div", { class: "slidebar" }, sel, el("button", { type: "button", class: "btn ghost small", text: "Previous", onclick: function () { if (+sel.value > 0) { sel.value = String(+sel.value - 1); show(); } } }),
      el("button", { type: "button", class: "btn ghost small", text: "Next", onclick: function () { if (+sel.value < deck.slides.length - 1) { sel.value = String(+sel.value + 1); show(); } } })));
    wrap.appendChild(holder); show();
    return wrap;
  }

  // ----- notes tab -----
  function tabNotes(view) {
    var on = !!setting("show_wall"), c = el("div", { class: "ctl" }, el("h3", { text: "Sticky notes" }));
    var box = el("input", { type: "checkbox", id: "wallBox", checked: on, style: "width:20px;height:20px" });
    box.addEventListener("change", function () { staffSet({ settings: { show_wall: box.checked } }); });
    c.appendChild(el("label", { class: "row tight", for: "wallBox", style: "cursor:pointer;margin-bottom:12px" }, box, el("span", { text: "Show the notes on the projector and let phones see all visible notes" })));
    c.appendChild(el("div", { id: "staffwall" }, el("p", { class: "muted", text: "Loading..." })));
    view.appendChild(c);
    fetchWall();
  }

  // ----- paper entries tab: staff log a tally by group -----
  function tallyList() {
    var out = [], seen = {};
    S.slides.forEach(function (s) {
      slideActs(s).forEach(function (a) {
        var def = REG[a.name]; if (!def || !def.items) return;
        def.items.filter(function (it) { return it.type !== "text"; }).forEach(function (it) {
          var key = actKey(a), ik = itemKeyFor(def, it, s), id = key + "|" + ik; if (seen[id]) return; seen[id] = 1;
          out.push({ key: key, ik: ik, label: "Slide " + s.n + " · " + def.title + " · " + it.label, options: it.options, act: a, slide: s });
        });
      });
    });
    return out;
  }
  function tabPaper(view) {
    var list = tallyList(), c = el("div", { class: "ctl" }, el("h3", { text: "Paper entries" }),
      el("p", { class: "muted", style: "margin-top:0", text: "Use this when people vote on paper or by show of hands. Enter how many people chose each answer, for one group at a time. Saving again for the same group replaces its numbers." }));
    if (!list.length) { c.appendChild(el("p", { text: "No votable activities were found in the live deck." })); view.appendChild(c); return; }
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
        resBox.appendChild(resultsNode(x.act, x.slide, rows, "staff", x.ik));
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
    c.appendChild(el("div", { class: "q" }, el("span", { class: "t", text: "Evaluation link (optional)" }), el("p", { class: "help", text: "The link your team provides. Phones show an Open button on the evaluation slide." }), url));
    c.appendChild(el("button", { type: "button", class: "btn", text: "Save settings", onclick: function () {
      var u = url.value.trim();
      if (u && !/^https:\/\/[^\s]+$/i.test(u)) { msg(out, "The evaluation link must start with https://", "err"); return; }
      staffSet({ settings: { poll_ms: +poll.value, eval_url: u } }).then(function () { msg(out, "Saved.", "ok"); });
    } }));
    c.appendChild(out);
    c.appendChild(el("hr", { class: "hr" }));
    var cc = el("div"), t = el("button", { type: "button", class: "btn ghost small", text: "Check the connection", onclick: function () {
      var t0 = performance.now(); msg(cc, "Checking...");
      rpc("room_get_state", { p_code: S.code, p_session: null, p_since: S.ver }).then(function (r) { msg(cc, r.ok ? "Connected. The server answered in " + Math.round(performance.now() - t0) + " ms." : "The server answered, but the code was refused.", r.ok ? "ok" : "err"); })
        .catch(function () { msg(cc, "Could not reach the server.", "err"); });
    } });
    c.appendChild(t); c.appendChild(cc);
    view.appendChild(c);
  }

  // ---------- menu ----------
  function bind() {
    $("codeGo").addEventListener("click", gateGo);
    $("code").addEventListener("keydown", function (e) { if (e.key === "Enter") gateGo(); });
    $("menuBtn").addEventListener("click", function (e) {
      e.stopPropagation();
      var old = document.querySelector(".menu"); if (old) { old.remove(); return; }
      var m = el("div", { class: "menu", role: "menu" });
      if (S.role === "participant" || S.role === "device") m.appendChild(el("button", { type: "button", text: "Refresh the slide", onclick: function () { m.remove(); pollNow().then(function () { render2(); }); } }));
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
