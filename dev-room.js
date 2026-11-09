"use strict";
/* Local test backend for the room page. It is used only on localhost with ?mock=1.
   It copies what the database functions in 09_room.sql do, and keeps its data in this browser's localStorage,
   so a staff tab, a projector tab and a participant tab on the same computer can see each other.
   It contains no consultation content and is never used on the real site. */
(function () {
  var KEY = "pk_room_mock";
  var CODES = { "MOCK-STAFF": "staff", "MOCK-PROJ": "projector", "MOCK-PART": "participant", "MOCK-DEV": "device" };
  var GROUPS = ["Regional", "Local implementers", "National level", "Other"];
  function load() {
    try { var d = JSON.parse(localStorage.getItem(KEY)); if (d) return d; } catch (e) {}
    return { state: { version: 1, slide_id: null, acts: {}, settings: {}, timer_end: null, deck_version: null }, decks: {}, members: {}, entries: [], notes: [] };
  }
  function save(d) { localStorage.setItem(KEY, JSON.stringify(d)); }
  function role(code, allowed) { var r = CODES[String(code || "").trim().toUpperCase()]; return r && allowed.indexOf(r) >= 0 ? r : null; }
  var ALL = ["staff", "projector", "participant", "device"];
  function bump(d) { d.state.version += 1; }
  function counts(d) {
    var c = {};
    d.entries.forEach(function (e) {
      if (e.kind === "person") c[e.activity] = (c[e.activity] || 0) + 1;
      else Object.keys(e.payload.counts || {}).forEach(function (k) { c[e.activity] = (c[e.activity] || 0) + (+e.payload.counts[k] || 0); });
    });
    return c;
  }
  var F = {
    room_join: function (b, d) {
      var r = role(b.p_code, ALL);
      if (!b.p_session) return { ok: false, reason: "no_session" };
      if (!r) return { ok: false, reason: "invalid" };
      if (r === "participant" && (!b.p_grp || !b.p_table)) return { ok: false, reason: "need_group_and_table" };
      if (r === "device" && !b.p_sheet) return { ok: false, reason: "need_sheet" };
      d.members[b.p_session] = { role: r, grp: r === "participant" ? b.p_grp : null, table_no: r === "participant" ? b.p_table : null,
        sheet: r === "device" ? b.p_sheet : null, prework: r === "participant" ? b.p_prework : null, seen: Date.now(), code: b.p_code.trim().toUpperCase() };
      return { ok: true, role: r, label: "Mock " + r };
    },
    room_get_state: function (b, d) {
      var r = role(b.p_code, ALL);
      if (!r) return { ok: false, reason: "invalid" };
      if (b.p_session && d.members[b.p_session]) d.members[b.p_session].seen = Date.now();
      var s = d.state, cn = null, jn = null;
      if (r === "staff" || r === "projector") {
        cn = counts(d);
        jn = Object.keys(d.members).filter(function (k) { return d.members[k].role === "participant" && Date.now() - d.members[k].seen < 60000; }).length;
      }
      if (b.p_since != null && +b.p_since === s.version) return { ok: true, unchanged: true, version: s.version, counts: cn, joined: jn };
      return { ok: true, version: s.version, role: r, slide_id: s.slide_id, acts: s.acts, settings: s.settings, timer_end: s.timer_end,
        deck_version: s.deck_version, now: new Date().toISOString(), counts: cn, joined: jn };
    },
    room_set_state: function (b, d) {
      if (!role(b.p_code, ["staff"])) return { ok: false, reason: "invalid" };
      var p = b.p_patch || {}, s = d.state;
      if (p.slide_id != null) s.slide_id = p.slide_id;
      if (p.acts) Object.keys(p.acts).forEach(function (k) { s.acts[k] = p.acts[k]; });
      if (p.settings) Object.keys(p.settings).forEach(function (k) { s.settings[k] = p.settings[k]; });
      if ("timer_end" in p) s.timer_end = p.timer_end || null;
      bump(d);
      return { ok: true, version: s.version };
    },
    room_publish_deck: function (b, d) {
      if (!role(b.p_code, ["staff"])) return { ok: false, reason: "invalid" };
      if (!b.p_version || b.p_version.length > 80) return { ok: false, reason: "bad_version" };
      d.decks[b.p_version] = { body: b.p_body, live: false, at: new Date().toISOString() };
      return { ok: true };
    },
    room_set_deck_live: function (b, d) {
      if (!role(b.p_code, ["staff"])) return { ok: false, reason: "invalid" };
      if (!d.decks[b.p_version]) return { ok: false, reason: "no_such_version" };
      Object.keys(d.decks).forEach(function (k) { d.decks[k].live = k === b.p_version; });
      d.state.deck_version = b.p_version; bump(d);
      return { ok: true };
    },
    room_list_decks: function (b, d) {
      if (!role(b.p_code, ["staff"])) return { ok: false, reason: "invalid" };
      return { ok: true, decks: Object.keys(d.decks).map(function (k) { return { version: k, live: d.decks[k].live, uploaded_at: d.decks[k].at, slides: (d.decks[k].body.slides || []).length }; })
        .sort(function (p, q) { return q.uploaded_at < p.uploaded_at ? -1 : 1; }) };
    },
    room_get_deck: function (b, d) {
      var r = role(b.p_code, ALL);
      if (!r) return { ok: false, reason: "invalid" };
      var v = null;
      if (r === "staff" && b.p_version) v = b.p_version;
      else Object.keys(d.decks).forEach(function (k) { if (d.decks[k].live) v = k; });
      if (!v || !d.decks[v]) return { ok: false, reason: "no_deck" };
      var body = d.decks[v].body;
      if (r === "staff") return { ok: true, version: v, deck: body };
      var copy = JSON.parse(JSON.stringify(body));
      copy.slides = copy.slides.filter(function (s) { return !s.teamOnly; }).map(function (s) { delete s.notes; return s; });
      return { ok: true, version: v, deck: copy };
    },
    room_save_entry: function (b, d) {
      if (!role(b.p_code, ["participant"])) return { ok: false, reason: "invalid" };
      var m = d.members[b.p_session];
      if (!m) return { ok: false, reason: "not_joined" };
      if (d.state.acts[b.p_activity] !== "open") return { ok: false, reason: "not_open" };
      var item = b.p_item || "", found = null;
      d.entries.forEach(function (e) { if (e.kind === "person" && e.session === b.p_session && e.activity === b.p_activity && e.item === item) found = e; });
      if (found) { found.payload = b.p_payload; found.grp = m.grp; found.table_no = m.table_no; }
      else d.entries.push({ kind: "person", session: b.p_session, activity: b.p_activity, item: item, grp: m.grp, table_no: m.table_no, payload: b.p_payload });
      return { ok: true };
    },
    room_my_entries: function (b, d) {
      if (!role(b.p_code, ["participant"])) return { ok: false, reason: "invalid" };
      return { ok: true, entries: d.entries.filter(function (e) { return e.kind === "person" && e.session === b.p_session && (!b.p_activity || e.activity === b.p_activity); })
        .map(function (e) { return { activity: e.activity, item: e.item, payload: e.payload }; }) };
    },
    room_staff_tally: function (b, d) {
      if (!role(b.p_code, ["staff"])) return { ok: false, reason: "invalid" };
      if (b.p_grp != null && GROUPS.indexOf(b.p_grp) < 0) return { ok: false, reason: "bad_group" };
      var item = b.p_item || "", found = null;
      d.entries.forEach(function (e) { if (e.kind === "tally" && e.activity === b.p_activity && e.item === item && (e.grp || "") === (b.p_grp || "") && (e.table_no || 0) === (b.p_table || 0)) found = e; });
      if (found) found.payload = { counts: b.p_counts || {} };
      else d.entries.push({ kind: "tally", activity: b.p_activity, item: item, grp: b.p_grp, table_no: b.p_table, payload: { counts: b.p_counts || {} } });
      return { ok: true };
    },
    room_results: function (b, d) {
      var r = role(b.p_code, ["staff", "projector"]);
      if (!r) return { ok: false, reason: "invalid" };
      if (r === "projector" && d.state.acts[b.p_activity] !== "revealed") return { ok: false, reason: "hidden" };
      var mode = b.p_mode || "votes", agg = {};
      d.entries.filter(function (e) { return e.activity === b.p_activity; }).forEach(function (e) {
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
        var a = agg[k], hide = r === "projector" && mode !== "spread" && a.n < 5;
        return { item: a.item, val: a.val, grp: a.grp, table_no: a.table_no, n: hide ? null : a.n, small: hide };
      }).sort(function (p, q) { return (p.item + p.val) < (q.item + q.val) ? -1 : 1; });
      return { ok: true, mode: mode, rows: rows };
    },
    room_add_note: function (b, d) {
      var r = role(b.p_code, ["participant", "device", "staff"]);
      if (!r) return { ok: false, reason: "invalid" };
      if (!b.p_body || !b.p_body.trim() || b.p_body.length > 3000) return { ok: false, reason: "bad_text" };
      var m = d.members[b.p_session] || {}, label = r === "participant" ? "Table " + (m.table_no || "?") : r === "device" ? (m.sheet || "?") : "Staff";
      d.notes.push({ id: "n" + (d.notes.length + 1) + "-" + Date.now(), color: b.p_color, body: b.p_body.trim(), slide_id: b.p_slide, label: label, session: b.p_session, hidden: false, cluster: null, at: new Date().toISOString() });
      return { ok: true };
    },
    room_get_notes: function (b, d) {
      var r = role(b.p_code, ALL);
      if (!r) return { ok: false, reason: "invalid" };
      var wall = !!d.state.settings.show_wall;
      if (r === "projector" && !wall) return { ok: true, notes: [], wall: false };
      var out = d.notes.filter(function (n) {
        if (b.p_slide && n.slide_id !== b.p_slide) return false;
        if (r === "staff") return true;
        if (r === "projector") return !n.hidden;
        return n.session === b.p_session || (wall && !n.hidden);
      }).map(function (n) { return { id: n.id, color: n.color, body: n.body, slide_id: n.slide_id, label: n.label, hidden: n.hidden, cluster: n.cluster, at: n.at }; });
      return { ok: true, wall: wall, notes: out };
    },
    room_update_note: function (b, d) {
      if (!role(b.p_code, ["staff"])) return { ok: false, reason: "invalid" };
      d.notes.forEach(function (n) {
        if (n.id !== b.p_id) return;
        var p = b.p_patch || {};
        if ("hidden" in p) n.hidden = !!p.hidden;
        if ("cluster" in p) n.cluster = p.cluster;
        if (p.color) n.color = p.color;
        if (p.body) n.body = p.body;
      });
      return { ok: true };
    }
  };
  window.PK_ROOM_MOCK = {
    rpc: function (name, body) {
      return new Promise(function (resolve, reject) {
        setTimeout(function () {
          if (localStorage.getItem("pk_room_mock_offline") === "1") { reject(new Error("offline")); return; }
          var d = load(), fn = F[name];
          if (!fn) { reject(new Error("http 404")); return; }
          var res = fn(body || {}, d);
          save(d);
          resolve(JSON.parse(JSON.stringify(res)));
        }, 30);
      });
    },
    reset: function () { localStorage.removeItem(KEY); }
  };
})();
