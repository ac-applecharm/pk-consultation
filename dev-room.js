"use strict";
/* Local test backend for the room page. It is used only on localhost with ?mock=1.
   It copies what the database functions in 09_room.sql and 12_room_trial.sql do, and keeps its data in this browser's
   localStorage, so a staff tab, a projector tab and a participant tab on the same computer can see each other.
   Codes: MOCK-STAFF, MOCK-PROJ, MOCK-PART, MOCK-DEV (live room) and TRIAL-STAFF, TRIAL-PROJ, TRIAL-PART, TRIAL-DEV (trial room).
   The live and trial rooms keep their own slide, timer, open activities, members, answers and notes.
   The deck and two settings (evaluation link, polling speed) are shared. It contains no consultation content. */
(function () {
  var KEY = "pk_room_mock2";
  var CODES = {
    "MOCK-STAFF": ["staff", "live"], "MOCK-PROJ": ["projector", "live"], "MOCK-PART": ["participant", "live"], "MOCK-DEV": ["device", "live"],
    "TRIAL-STAFF": ["staff", "trial"], "TRIAL-PROJ": ["projector", "trial"], "TRIAL-PART": ["participant", "trial"], "TRIAL-DEV": ["device", "trial"]
  };
  var GROUPS = ["Regional", "Local implementers", "National level", "Other"];
  var SHARED_KEYS = ["eval_url", "poll_ms"];
  function room() { return { state: { version: 1, slide_id: null, acts: {}, settings: {}, timer_end: null }, members: {}, entries: [], notes: [], sheets: {} }; }
  function load() {
    try { var d = JSON.parse(localStorage.getItem(KEY)); if (d) return d; } catch (e) {}
    return { shared: { deck_version: null, settings: {} }, decks: {}, live: room(), trial: room() };
  }
  function save(d) { localStorage.setItem(KEY, JSON.stringify(d)); }
  function who(code, allowed) {
    var x = CODES[String(code || "").trim().toUpperCase()];
    return x && allowed.indexOf(x[0]) >= 0 ? { role: x[0], stage: x[1] } : null;
  }
  var ALL = ["staff", "projector", "participant", "device"];
  function bump(R) { R.state.version += 1; }
  function counts(R) {
    var c = {};
    R.entries.forEach(function (e) {
      if (e.kind === "person") c[e.activity] = (c[e.activity] || 0) + 1;
      else Object.keys(e.payload.counts || {}).forEach(function (k) { c[e.activity] = (c[e.activity] || 0) + (+e.payload.counts[k] || 0); });
    });
    return c;
  }
  var F = {
    room_join: function (b, d) {
      var a = who(b.p_code, ALL);
      if (!b.p_session) return { ok: false, reason: "no_session" };
      if (!a) return { ok: false, reason: "invalid" };
      if (a.role === "participant" && (!b.p_grp || !b.p_table)) return { ok: false, reason: "need_group_and_table" };
      if (a.role === "device" && !b.p_sheet) return { ok: false, reason: "need_sheet" };
      d[a.stage].members[b.p_session] = { role: a.role, grp: a.role === "participant" ? b.p_grp : null, table_no: a.role === "participant" ? b.p_table : null,
        sheet: a.role === "device" ? b.p_sheet : null, prework: a.role === "participant" ? b.p_prework : null, seen: Date.now() };
      return { ok: true, role: a.role, stage: a.stage, label: "Mock " + a.role };
    },
    room_get_state: function (b, d) {
      var a = who(b.p_code, ALL);
      if (!a) return { ok: false, reason: "invalid" };
      var R = d[a.stage];
      if (b.p_session && R.members[b.p_session]) R.members[b.p_session].seen = Date.now();
      var s = R.state, cn = null, jn = null;
      if (a.role === "staff" || a.role === "projector") {
        cn = counts(R);
        jn = Object.keys(R.members).filter(function (k) { return R.members[k].role === "participant" && Date.now() - R.members[k].seen < 60000; }).length;
      }
      if (b.p_since != null && +b.p_since === s.version) return { ok: true, unchanged: true, version: s.version, counts: cn, joined: jn };
      var merged = {};
      Object.keys(s.settings).forEach(function (k) { if (SHARED_KEYS.indexOf(k) < 0) merged[k] = s.settings[k]; });
      SHARED_KEYS.forEach(function (k) { if (d.shared.settings[k] != null) merged[k] = d.shared.settings[k]; });
      return { ok: true, version: s.version, role: a.role, stage: a.stage, slide_id: s.slide_id, acts: s.acts, settings: merged, timer_end: s.timer_end,
        deck_version: d.shared.deck_version, now: new Date().toISOString(), counts: cn, joined: jn };
    },
    room_set_state: function (b, d) {
      var a = who(b.p_code, ["staff"]);
      if (!a) return { ok: false, reason: "invalid" };
      var R = d[a.stage], s = R.state, p = b.p_patch || {}, shared = false;
      if (p.slide_id != null) s.slide_id = p.slide_id;
      if (p.acts) Object.keys(p.acts).forEach(function (k) { s.acts[k] = p.acts[k]; });
      if (p.settings) Object.keys(p.settings).forEach(function (k) {
        if (SHARED_KEYS.indexOf(k) >= 0) { if (p.settings[k] != null) { d.shared.settings[k] = p.settings[k]; shared = true; } } else s.settings[k] = p.settings[k];
      });
      if ("timer_end" in p) s.timer_end = p.timer_end || null;
      bump(R);
      if (shared) bump(d[a.stage === "live" ? "trial" : "live"]);
      return { ok: true, version: s.version };
    },
    room_publish_deck: function (b, d) {
      if (!who(b.p_code, ["staff"])) return { ok: false, reason: "invalid" };
      if (!b.p_version || b.p_version.length > 80) return { ok: false, reason: "bad_version" };
      d.decks[b.p_version] = { body: b.p_body, live: false, at: new Date().toISOString() };
      return { ok: true };
    },
    room_set_deck_live: function (b, d) {
      if (!who(b.p_code, ["staff"])) return { ok: false, reason: "invalid" };
      if (!d.decks[b.p_version]) return { ok: false, reason: "no_such_version" };
      Object.keys(d.decks).forEach(function (k) { d.decks[k].live = k === b.p_version; });
      d.shared.deck_version = b.p_version; bump(d.live); bump(d.trial);
      return { ok: true };
    },
    room_list_decks: function (b, d) {
      if (!who(b.p_code, ["staff"])) return { ok: false, reason: "invalid" };
      return { ok: true, decks: Object.keys(d.decks).map(function (k) { return { version: k, live: d.decks[k].live, uploaded_at: d.decks[k].at, slides: (d.decks[k].body.slides || []).length }; })
        .sort(function (p, q) { return q.uploaded_at < p.uploaded_at ? -1 : 1; }) };
    },
    room_get_deck: function (b, d) {
      var a = who(b.p_code, ALL);
      if (!a) return { ok: false, reason: "invalid" };
      var v = null;
      if (a.role === "staff" && b.p_version) v = b.p_version;
      else Object.keys(d.decks).forEach(function (k) { if (d.decks[k].live) v = k; });
      if (!v || !d.decks[v]) return { ok: false, reason: "no_deck" };
      var body = d.decks[v].body;
      if (a.role === "staff") return { ok: true, version: v, deck: body };
      var copy = JSON.parse(JSON.stringify(body));
      copy.slides = copy.slides.filter(function (s) { return !s.teamOnly; }).map(function (s) { delete s.notes; return s; });
      return { ok: true, version: v, deck: copy };
    },
    room_save_entry: function (b, d) {
      var a = who(b.p_code, ["participant"]);
      if (!a) return { ok: false, reason: "invalid" };
      var R = d[a.stage], m = R.members[b.p_session];
      if (!m) return { ok: false, reason: "not_joined" };
      if (R.state.acts[b.p_activity] !== "open") return { ok: false, reason: "not_open" };
      var item = b.p_item || "", found = null;
      R.entries.forEach(function (e) { if (e.kind === "person" && e.session === b.p_session && e.activity === b.p_activity && e.item === item) found = e; });
      if (found) { found.payload = b.p_payload; found.grp = m.grp; found.table_no = m.table_no; }
      else R.entries.push({ kind: "person", session: b.p_session, activity: b.p_activity, item: item, grp: m.grp, table_no: m.table_no, payload: b.p_payload });
      return { ok: true };
    },
    room_my_entries: function (b, d) {
      var a = who(b.p_code, ["participant"]);
      if (!a) return { ok: false, reason: "invalid" };
      return { ok: true, entries: d[a.stage].entries.filter(function (e) { return e.kind === "person" && e.session === b.p_session && (!b.p_activity || e.activity === b.p_activity); })
        .map(function (e) { return { activity: e.activity, item: e.item, payload: e.payload }; }) };
    },
    room_staff_tally: function (b, d) {
      var a = who(b.p_code, ["staff"]);
      if (!a) return { ok: false, reason: "invalid" };
      if (b.p_grp != null && GROUPS.indexOf(b.p_grp) < 0) return { ok: false, reason: "bad_group" };
      var R = d[a.stage], item = b.p_item || "", found = null;
      R.entries.forEach(function (e) { if (e.kind === "tally" && e.activity === b.p_activity && e.item === item && (e.grp || "") === (b.p_grp || "") && (e.table_no || 0) === (b.p_table || 0)) found = e; });
      if (found) found.payload = { counts: b.p_counts || {} };
      else R.entries.push({ kind: "tally", activity: b.p_activity, item: item, grp: b.p_grp, table_no: b.p_table, payload: { counts: b.p_counts || {} } });
      return { ok: true };
    },
    room_results: function (b, d) {
      var a = who(b.p_code, ["staff", "projector"]);
      if (!a) return { ok: false, reason: "invalid" };
      var R = d[a.stage];
      if (a.role === "projector" && R.state.acts[b.p_activity] !== "revealed") return { ok: false, reason: "hidden" };
      var mode = b.p_mode || "votes", agg = {};
      R.entries.filter(function (e) { return e.activity === b.p_activity; }).forEach(function (e) {
        var vals = [];
        if (e.kind === "person") {
          var v = e.payload && e.payload.v;
          if (Array.isArray(v)) v.forEach(function (x) { vals.push([String(x), 1]); }); else if (v != null) vals.push([String(v), 1]);
        } else Object.keys(e.payload.counts || {}).forEach(function (k) { vals.push([k, +e.payload.counts[k] || 0]); });
        vals.forEach(function (p) {
          var g = mode === "spread" ? null : e.grp, t = mode === "spread" ? e.table_no : null, key = [e.item, p[0], g, t].join("|");
          agg[key] = agg[key] || { item: e.item, val: p[0], grp: g, table_no: t, n: 0 };
          agg[key].n += p[1];
        });
      });
      var rows = Object.keys(agg).map(function (k) {
        var x = agg[k], hide = a.role === "projector" && mode !== "spread" && x.n < 5;
        return { item: x.item, val: x.val, grp: x.grp, table_no: x.table_no, n: hide ? null : x.n, small: hide };
      }).sort(function (p, q) { return (p.item + p.val) < (q.item + q.val) ? -1 : 1; });
      return { ok: true, mode: mode, rows: rows };
    },
    room_add_note: function (b, d) {
      var a = who(b.p_code, ["participant", "device", "staff"]);
      if (!a) return { ok: false, reason: "invalid" };
      if (!b.p_body || !b.p_body.trim() || b.p_body.length > 3000) return { ok: false, reason: "bad_text" };
      var R = d[a.stage], m = R.members[b.p_session] || {}, label = a.role === "participant" ? "Table " + (m.table_no || "?") : a.role === "device" ? (m.sheet || "?") : "Staff";
      R.notes.push({ id: "n" + (R.notes.length + 1) + "-" + Date.now(), color: b.p_color, body: b.p_body.trim(), slide_id: b.p_slide, label: label, session: b.p_session, hidden: false, cluster: null, at: new Date().toISOString() });
      return { ok: true };
    },
    room_get_notes: function (b, d) {
      var a = who(b.p_code, ALL);
      if (!a) return { ok: false, reason: "invalid" };
      var R = d[a.stage], wall = !!R.state.settings.show_wall;
      if (a.role === "projector" && !wall) return { ok: true, notes: [], wall: false };
      var out = R.notes.filter(function (n) {
        if (b.p_slide && n.slide_id !== b.p_slide) return false;
        if (a.role === "staff") return true;
        if (a.role === "projector") return !n.hidden;
        return n.session === b.p_session || (wall && !n.hidden);
      }).map(function (n) { return { id: n.id, color: n.color, body: n.body, slide_id: n.slide_id, label: n.label, hidden: n.hidden, cluster: n.cluster, at: n.at }; });
      return { ok: true, wall: wall, notes: out };
    },
    room_update_note: function (b, d) {
      var a = who(b.p_code, ["staff"]);
      if (!a) return { ok: false, reason: "invalid" };
      d[a.stage].notes.forEach(function (n) {
        if (n.id !== b.p_id) return;
        var p = b.p_patch || {};
        if ("hidden" in p) n.hidden = !!p.hidden;
        if ("cluster" in p) n.cluster = p.cluster;
        if (p.color) n.color = p.color;
        if (p.body) n.body = p.body;
      });
      return { ok: true };
    },
    room_get_sheets: function (b, d) {
      var a = who(b.p_code, ALL);
      if (!a) return { ok: false, reason: "invalid" };
      var R = d[a.stage]; R.sheets = R.sheets || {};
      var st = R.state.acts[b.p_activity] || "none", mine = null;
      if (a.role === "device") { var m = R.members[b.p_session]; if (!m) return { ok: false, reason: "not_joined" }; mine = m.sheet; }
      var out = Object.keys(R.sheets).filter(function (k) { return k.split("|")[0] === b.p_activity; }).map(function (k) { return { sheet: k.split("|")[1], body: R.sheets[k].body, updated_at: R.sheets[k].at }; })
        .filter(function (x) { return a.role === "staff" || st === "revealed" || (a.role === "device" && x.sheet === mine); })
        .sort(function (p, q) { return p.sheet < q.sheet ? -1 : 1; });
      return { ok: true, state: st, mine: mine, sheets: out };
    },
    room_save_sheet: function (b, d) {
      var a = who(b.p_code, ["staff", "device"]);
      if (!a) return { ok: false, reason: "invalid" };
      if (["T1", "T2", "T3", "T4", "C1", "C2", "C3", "ROOM"].indexOf(b.p_sheet) < 0) return { ok: false, reason: "bad_sheet" };
      var R = d[a.stage]; R.sheets = R.sheets || {};
      var whoLabel = "Staff";
      if (a.role === "device") {
        var m = R.members[b.p_session];
        if (!m) return { ok: false, reason: "not_joined" };
        if (m.sheet !== b.p_sheet) return { ok: false, reason: "not_your_sheet" };
        if (R.state.acts[b.p_activity] !== "open") return { ok: false, reason: "not_open" };
        whoLabel = (b.p_sheet.charAt(0) === "C" ? "Clinic " : "Table ") + b.p_sheet.slice(1);
      }
      var k = b.p_activity + "|" + b.p_sheet, cur = R.sheets[k] || { body: {} };
      Object.keys(b.p_patch || {}).forEach(function (x) { cur.body[x] = b.p_patch[x]; });
      cur.at = new Date().toISOString(); cur.by = whoLabel; R.sheets[k] = cur;
      return { ok: true };
    },
    room_table_spread: function (b, d) {
      var a = who(b.p_code, ["device"]);
      if (!a) return { ok: false, reason: "invalid" };
      var R = d[a.stage], m = R.members[b.p_session];
      if (!m || !m.sheet || m.sheet.charAt(0) !== "T") return { ok: false, reason: "not_a_table" };
      var t = +m.sheet.slice(1), agg = {};
      R.entries.forEach(function (e) {
        if (e.kind !== "person" || e.activity !== b.p_activity || e.table_no !== t || !e.payload || e.payload.v == null) return;
        var key = e.item + "|" + e.payload.v; agg[key] = (agg[key] || 0) + 1;
      });
      return { ok: true, table_no: t, rows: Object.keys(agg).map(function (k) { return { item: k.split("|")[0], val: k.split("|")[1], n: agg[k] }; }) };
    },
    room_reset_trial: function (b, d) {
      var a = who(b.p_code, ["staff"]);
      if (!a || a.stage !== "trial") return { ok: false, reason: "invalid" };
      var v = d.trial.state.version + 1;
      d.trial = room(); d.trial.state.version = v;
      return { ok: true };
    }
  };
  window.PK_ROOM_MOCK = {
    rpc: function (name, body) {
      return new Promise(function (resolve, reject) {
        setTimeout(function () {
          if (localStorage.getItem("pk_room_mock_offline") === "1") { reject(new TypeError("offline")); return; }
          var d = load(), fn = F[name];
          if (!fn) { var e = new Error("http 404"); e.http = 404; reject(e); return; }
          var res = fn(body || {}, d);
          save(d);
          resolve(JSON.parse(JSON.stringify(res)));
        }, 30);
      });
    },
    reset: function () { localStorage.removeItem(KEY); }
  };
})();
