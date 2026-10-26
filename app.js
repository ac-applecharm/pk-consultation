"use strict";
(function () {
  var API = "https://drwmnzmvsjhlbixqcvew.supabase.co";
  var KEY = "sb_publishable_Vzh0zj3WvlhNqJg0wHV87w_bVwjmNdv";
  var $ = function (id) { return document.getElementById(id); };
  var UI0 = {
    back: "Back", next: "Continue", finish: "Finish", pleaseAnswer: "Please answer the questions above to continue.",
    saved: "Saved", savedLocal: "Saved here. Will send later.", sending: "Saving...", notSaved: "Not saved. Tell the PK team.",
    stopOf: "Stop {n} of {total}", otherSpecify: "Please describe", words: "words", resumeTitle: "Welcome back",
    resumeText: "You started this form on this device. Would you like to carry on where you stopped?",
    resumeYes: "Carry on", resumeNo: "Start again", doneTitle: "Thank you",
    doneText: "Your answers are saved. You can close this page.", stubTitle: "Content coming",
    stubText: "The text for this part has not been published yet."
  };
  var S = { code: null, hash: null, forms: [], form: null, content: null, session: null, answers: {}, order: {}, pos: null, furthest: 0, completed: false, queue: [] };
  var UI = UI0;

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
      else if (k === "checked" || k === "disabled" || k === "open") e[k] = !!v;
      else e.setAttribute(k, v === true ? "" : v);
    });
    for (var i = 2; i < arguments.length; i++) {
      var kids = [].concat(arguments[i]);
      kids.forEach(function (c) { if (c == null || c === false) return; e.appendChild(typeof c === "string" ? document.createTextNode(c) : c); });
    }
    return e;
  }
  function rich(text) {
    var frag = document.createDocumentFragment();
    String(text == null ? "" : text).split(/(\*\*.+?\*\*|\{\{.+?\}\})/g).forEach(function (part) {
      if (!part) return;
      if (part.slice(0, 2) === "**") frag.appendChild(el("b", { text: part.slice(2, -2) }));
      else if (part.slice(0, 2) === "{{") {
        var key = part.slice(2, -2).trim();
        var g = S.content && S.content.glossary;
        if (g && g[key]) frag.appendChild(el("button", { type: "button", class: "term", "data-term": key, text: key }));
        else frag.appendChild(document.createTextNode(key));
      } else frag.appendChild(document.createTextNode(part));
    });
    return frag;
  }
  function store(k, v) { try { if (v === undefined) localStorage.removeItem(k); else localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} }
  function load(k) { try { return JSON.parse(localStorage.getItem(k)); } catch (e) { return null; } }
  function sha(text) {
    if (!(window.crypto && crypto.subtle)) {
      var h = 2166136261;
      for (var i = 0; i < text.length; i++) { h ^= text.charCodeAt(i); h = Math.imul(h, 16777619); }
      return Promise.resolve("x" + (h >>> 0).toString(16));
    }
    return crypto.subtle.digest("SHA-256", new TextEncoder().encode(text)).then(function (buf) {
      return Array.prototype.map.call(new Uint8Array(buf), function (b) { return ("0" + b.toString(16)).slice(-2); }).join("");
    });
  }
  function uuid() {
    if (window.crypto && crypto.randomUUID) return crypto.randomUUID();
    return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, function (c) { var r = Math.random() * 16 | 0; return (c === "x" ? r : (r & 3 | 8)).toString(16); });
  }
  function wc(s) { s = (s || "").trim(); return s ? s.split(/\s+/).length : 0; }
  function msg(node, text, kind) { node.innerHTML = ""; if (text) node.appendChild(el("div", { class: "msg " + (kind || ""), text: text })); }
  function rpc(name, body) {
    return fetch(API + "/rest/v1/rpc/" + name, { method: "POST", headers: { apikey: KEY, "Content-Type": "application/json" }, body: JSON.stringify(body) })
      .then(function (r) { if (!r.ok) throw new Error("http " + r.status); return r.json(); });
  }
  function T(key, vars) {
    var s = (UI[key] != null ? UI[key] : UI0[key]) || key;
    Object.keys(vars || {}).forEach(function (k) { s = s.replace("{" + k + "}", vars[k]); });
    return s;
  }

  // ---------- glossary ----------
  document.addEventListener("click", function (e) {
    var b = e.target.closest ? e.target.closest(".term") : null;
    var g = $("gloss");
    if (b) {
      var k = b.getAttribute("data-term");
      g.innerHTML = "";
      g.appendChild(el("button", { type: "button", class: "btn ghost", id: "glx", style: "min-height:36px;padding:4px 14px", text: "Close" }));
      g.appendChild(el("b", { text: k })); g.appendChild(el("br")); g.appendChild(document.createTextNode(S.content.glossary[k]));
      g.classList.add("on"); $("glx").focus();
    } else if (!e.target.closest("#gloss")) g.classList.remove("on");
    if (e.target.id === "glx") g.classList.remove("on");
  });
  document.addEventListener("keydown", function (e) { if (e.key === "Escape") $("gloss").classList.remove("on"); });

  // ---------- conditions ----------
  function cond(c) {
    if (!c) return true;
    var v = S.answers[c.q];
    if (c.answered) return v != null && v !== "" && !(Array.isArray(v) && !v.length);
    if (c.in) return Array.isArray(v) ? v.some(function (x) { return c.in.indexOf(x) >= 0; }) : c.in.indexOf(v) >= 0;
    if (c.notIn) return v != null && v !== "" && c.notIn.indexOf(v) < 0;
    return true;
  }
  function flat() {
    var out = [];
    S.content.stops.forEach(function (st, si) {
      if (!cond(st.showIf)) return;
      st.screens.forEach(function (sc) { if (cond(sc.showIf)) out.push({ si: si, st: st, sc: sc }); });
    });
    return out;
  }
  function posIndex(list) {
    for (var i = 0; i < list.length; i++) if (list[i].sc.id === S.pos) return i;
    return 0;
  }

  // ---------- questions ----------
  function optList(q) {
    var base = q.options;
    if (q.optionsOf) {
      base = S.content.questions[q.optionsOf].options;
      var ex = S.answers[q.excludeAnswerOf] || [];
      base = base.filter(function (o) { return ex.indexOf(typeof o === "string" ? o : o.v) < 0; });
    }
    return base.map(function (o) { return typeof o === "string" ? { v: o, l: o } : { v: o.v, l: o.l || o.v, h: o.h }; });
  }
  function shuffled(id, items, fixedLast) {
    if (!S.order[id] || S.order[id].length !== items.length) {
      var n = items.length - (fixedLast || 0), idx = [], i;
      for (i = 0; i < n; i++) idx.push(i);
      for (i = n - 1; i > 0; i--) { var j = Math.floor(Math.random() * (i + 1)); var t = idx[i]; idx[i] = idx[j]; idx[j] = t; }
      for (i = n; i < items.length; i++) idx.push(i);
      S.order[id] = idx; persist();
    }
    return S.order[id].map(function (i) { return items[i]; });
  }
  function setAns(id, v) { S.answers[id] = v; persist(); }
  function qLabel(id, q) {
    return el("div", { class: "t" }, el("span", { class: "qno", text: id }), rich(q.label));
  }
  function answered(id, q) {
    var v = S.answers[id];
    switch (q.type) {
      case "single": case "scale":
        if (v == null || v === "") return false;
        if (q.other && q.other.indexOf(v) >= 0) return !!(S.answers[id + "_text"] || "").trim();
        return true;
      case "multi":
        if (!Array.isArray(v) || !v.length) return false;
        if (q.other) for (var i = 0; i < q.other.length; i++) if (v.indexOf(q.other[i]) >= 0 && !(S.answers[id + "_text"] || "").trim()) return false;
        return true;
      case "rank": return Array.isArray(v) && v.length === (q.pick || optList(q).length);
      case "matrix": return !!v && q.rows.every(function (r) { return v[r.key]; });
      case "text": case "open": return (v || "").trim() !== "";
      default: return true;
    }
  }
  function isRequired(q) {
    if (q.required != null) return q.required;
    return ["single", "scale", "multi", "rank", "matrix"].indexOf(q.type) >= 0;
  }
  function otherBox(id, q, selected) {
    if (!q.other) return null;
    var show = selected;
    var inp = el("input", { type: "text", id: "ot_" + id, placeholder: UI.otherSpecify, value: S.answers[id + "_text"] || "", "aria-label": UI.otherSpecify,
      oninput: function () { setAns(id + "_text", inp.value); updateNav(); } });
    var wrap = el("div", { style: "margin:-2px 0 10px" }, inp);
    wrap.hidden = !show; return wrap;
  }
  function qSingle(id, q) {
    var cur = S.answers[id], opts = optList(q);
    if (q.shuffle) opts = shuffled(id, opts, q.fixedLast || 0);
    var seg = q.type === "scale";
    var wrap = el("div", { class: "q", role: "radiogroup" }, qLabel(id, q), q.help ? el("p", { class: "help" }, rich(q.help)) : null);
    var box = el("div", { class: seg ? "seg" : "" });
    opts.forEach(function (o) {
      var inp = el("input", { type: "radio", name: id, value: o.v, "data-k": id + "|" + o.v, checked: cur === o.v,
        onchange: function () { setAns(id, o.v); redraw(id + "|" + o.v); } });
      var lab = el("label", { class: (seg ? (o.v.length > 12 ? "wide " : "") : "opt ") + (cur === o.v ? "sel" : "") }, inp, seg ? document.createTextNode(o.l) : el("span", {}, rich(o.l), o.h ? el("span", { class: "help", style: "display:block;margin:0" }, rich(o.h)) : null));
      box.appendChild(lab);
    });
    wrap.appendChild(box);
    var ob = otherBox(id, q, q.other && q.other.indexOf(cur) >= 0); if (ob) wrap.appendChild(ob);
    return wrap;
  }
  function qMulti(id, q) {
    var cur = S.answers[id] || [], opts = optList(q);
    if (q.shuffle) opts = shuffled(id, opts, q.fixedLast || 0);
    var wrap = el("div", { class: "q" }, qLabel(id, q), q.help ? el("p", { class: "help" }, rich(q.help)) : null);
    var full = q.max && cur.length >= q.max;
    opts.forEach(function (o) {
      var on = cur.indexOf(o.v) >= 0, off = full && !on;
      var inp = el("input", { type: "checkbox", value: o.v, "data-k": id + "|" + o.v, checked: on, disabled: off,
        onchange: function () {
          var a = (S.answers[id] || []).slice(), i = a.indexOf(o.v);
          if (i >= 0) a.splice(i, 1); else a.push(o.v);
          setAns(id, a); redraw(id + "|" + o.v);
        } });
      wrap.appendChild(el("label", { class: "opt" + (on ? " sel" : "") + (off ? " off" : "") }, inp, el("span", {}, rich(o.l), o.h ? el("span", { class: "help", style: "display:block;margin:0" }, rich(o.h)) : null)));
    });
    var anyOther = q.other && q.other.some(function (x) { return cur.indexOf(x) >= 0; });
    var ob = otherBox(id, q, anyOther); if (ob) wrap.appendChild(ob);
    return wrap;
  }
  function qRank(id, q) {
    var cur = S.answers[id] || [], opts = optList(q), pick = q.pick || opts.length;
    if (q.shuffle) opts = shuffled(id, opts, q.fixedLast || 0);
    var wrap = el("div", { class: "q" }, qLabel(id, q), q.help ? el("p", { class: "help" }, rich(q.help)) : null);
    var list = el("div", { class: "rank" });
    opts.forEach(function (o) {
      var pos = cur.indexOf(o.v);
      var btn = el("button", { type: "button", class: "item" + (pos >= 0 ? " on" : ""), "data-k": id + "|" + o.v, "aria-pressed": pos >= 0 ? "true" : "false",
        onclick: function () {
          var a = (S.answers[id] || []).slice(), i = a.indexOf(o.v);
          if (i >= 0) a.splice(i, 1); else if (a.length < pick) a.push(o.v);
          setAns(id, a); redraw(id + "|" + o.v);
        } }, el("span", { class: "n", text: pos >= 0 ? String(pos + 1) : "" }), el("span", {}, rich(o.l)));
      list.appendChild(btn);
    });
    wrap.appendChild(list);
    wrap.appendChild(el("p", { class: "help", style: "margin-top:8px" }, (q.rankHelp || ("Tap to choose in order. Tap again to remove. " + cur.length + " of " + pick + " chosen."))));
    return wrap;
  }
  function qMatrix(id, q) {
    var cur = S.answers[id] || {};
    var rows = q.rows.slice();
    if (q.shuffleRows) rows = shuffled(id, rows, 0);
    var wrap = el("div", { class: "q" }, qLabel(id, q), q.help ? el("p", { class: "help" }, rich(q.help)) : null);
    if (q.scaleNote) wrap.appendChild(el("div", { class: "scale-note" }, el("span", { text: q.scaleNote[0] }), el("span", { text: q.scaleNote[1] })));
    rows.forEach(function (r) {
      var seg = el("div", { class: "seg", role: "radiogroup", "aria-label": r.plain || r.key });
      q.values.forEach(function (v) {
        var val = typeof v === "string" ? v : v.v, lab = typeof v === "string" ? v : (v.l || v.v);
        var inp = el("input", { type: "radio", name: id + "_" + r.key, value: val, "data-k": id + "_" + r.key + "|" + val, checked: cur[r.key] === val,
          onchange: function () { var o = Object.assign({}, S.answers[id] || {}); o[r.key] = val; setAns(id, o); redraw(id + "_" + r.key + "|" + val); } });
        seg.appendChild(el("label", { class: (lab.length > 10 ? "wide " : "") + (cur[r.key] === val ? "sel" : "") }, inp, document.createTextNode(lab)));
      });
      wrap.appendChild(el("div", { class: "rate" }, el("div", { class: "name" }, rich(r.label)), seg));
    });
    return wrap;
  }
  function textarea(id, label, max, help, unit, key) {
    var v = key ? ((S.answers[id] || {})[key] || "") : (S.answers[id] || "");
    var counter = el("div", { class: "counter" });
    function upd(val) { counter.textContent = max ? (wc(val) + " / " + max + " " + (unit || UI.words)) : ""; counter.className = "counter" + (max && wc(val) > max ? " over" : ""); }
    var ta = el("textarea", { id: "t_" + id + (key ? "_" + key : ""), oninput: function () {
      if (key) { var o = Object.assign({}, S.answers[id] || {}); o[key] = ta.value; setAns(id, o); } else setAns(id, ta.value);
      upd(ta.value); updateNav();
    } });
    ta.value = v; upd(v);
    return [label, help ? el("p", { class: "help" }, rich(help)) : null, ta, counter];
  }
  function qOpen(id, q) {
    var lab = el("label", { class: "t", for: "t_" + id }, el("span", { class: "qno", text: id }), rich(q.label));
    return el("div", { class: "q" }, textarea(id, lab, q.maxWords, q.help, q.unit));
  }
  function qText(id, q) {
    var inp = el("input", { type: "text", id: "s_" + id, value: S.answers[id] || "", placeholder: q.placeholder || "", oninput: function () { setAns(id, inp.value); updateNav(); } });
    return el("div", { class: "q" }, el("label", { class: "t", for: "s_" + id }, el("span", { class: "qno", text: id }), rich(q.label)), q.help ? el("p", { class: "help" }, rich(q.help)) : null, inp);
  }
  function qPerGroup(id, q) {
    var picked = (S.answers[q.source] || []).filter(function (x) { return (q.exclude || []).indexOf(x) < 0 && !(q.other && q.other.indexOf(x) >= 0 && false); });
    var wrap = el("div", { class: "q" }, el("div", { class: "t" }, el("span", { class: "qno", text: id }), rich(q.label)));
    if (!picked.length) { wrap.hidden = true; return wrap; }
    picked.forEach(function (g) {
      var lab = el("label", { class: "t", style: "font-weight:500", for: "t_" + id + "_" + g }, rich((q.itemLabel || "{g}").replace("{g}", g)));
      textarea(id, lab, q.maxWords, null, q.unit, g).forEach(function (n) { if (n) wrap.appendChild(n); });
    });
    return wrap;
  }
  function qCondText(id, q) {
    var m = S.answers[q.source] || {};
    var keys = Object.keys(m).filter(function (k) { return m[k] === q.when; });
    var wrap = el("div", { class: "q" });
    if (!keys.length) { wrap.hidden = true; return wrap; }
    keys.forEach(function (k) {
      var lab = el("label", { class: "t", for: "t_" + id + "_" + k }, el("span", { class: "qno", text: id }), rich((q.itemLabel || "{k}").replace("{k}", k)));
      textarea(id, lab, q.maxWords, null, q.unit, k).forEach(function (n) { if (n) wrap.appendChild(n); });
    });
    return wrap;
  }
  function question(id) {
    var q = S.content.questions[id];
    if (!q) return el("p", { class: "msg err", text: "Missing question " + id });
    if (q.showIf && !cond(q.showIf)) return null;
    switch (q.type) {
      case "single": case "scale": return qSingle(id, q);
      case "multi": return qMulti(id, q);
      case "rank": return qRank(id, q);
      case "matrix": return qMatrix(id, q);
      case "open": return qOpen(id, q);
      case "text": return qText(id, q);
      case "perGroup": return qPerGroup(id, q);
      case "condText": return qCondText(id, q);
      default: return null;
    }
  }
  function screenQuestions(blocks, out) {
    out = out || [];
    (blocks || []).forEach(function (b) {
      if (b.t === "q") { var q = S.content.questions[b.id]; if (q && (!q.showIf || cond(q.showIf))) out.push(b.id); }
      if (b.t === "details" || b.t === "card") screenQuestions(b.blocks, out);
    });
    return out;
  }
  function canContinue(sc) {
    return screenQuestions(sc.blocks).every(function (id) {
      var q = S.content.questions[id];
      if (q.type === "consent") return S.answers[id] === true;
      if (!isRequired(q)) return true;
      return answered(id, q);
    }) && (!sc.consent || S.answers[sc.consent] === true);
  }

  // ---------- blocks ----------
  function optCard(id) {
    var o = S.content.options.filter(function (x) { return x.k === id; })[0];
    var studies = S.content.studies.filter(function (s) { return s.opt === id; });
    function f(k, t) { return el("div", { class: "field" }, el("p", { class: "k", text: k }), el("p", {}, rich(t))); }
    function study(c) {
      return el("details", { class: "study" }, el("summary", {}, document.createTextNode(c.who + " "), el("span", { class: "chip " + c.tag, text: c.tag })),
        el("p", { class: "k", text: "What they wanted to find out" }), el("p", { text: c.aim }),
        el("p", { class: "k", text: "What they found" }), el("p", { text: c.found }),
        el("p", { class: "k", text: "What it means for Option " + id }), el("p", {}, el("b", { text: c.tag + ". " }), document.createTextNode(c.means)),
        el("p", { class: "k", text: "Limits" }), el("p", { text: c.limits }));
    }
    var L = S.content.labels || {};
    return el("div", { class: "card opt-card" }, el("span", { class: "pill" }, el("b"), document.createTextNode("Option " + id)),
      el("h2", { style: "margin-top:12px" }, el("span", { class: "letter", text: id }), document.createTextNode(o.name)),
      f(L.line || "In one line", o.line), f(L.ilaya || "In the example", o.ilaya), f(L.reach || "Who it reaches", o.reach),
      f(L.strength || "Main strength", o.strength), f(L.risk || "Main risk", o.risk), f(L.una || "Where it fits", o.una),
      el("details", {}, el("summary", { text: L.deeper || "Go deeper" }),
        el("p", { class: "help", text: L.deeperHelp || "Each study below is summarized in the same way. Tap a study to open it." }),
        el("p", { class: "sec-h", text: L.forH || "Studies that support this option" }), studies.filter(function (s) { return s.side === "for"; }).map(study),
        el("p", { class: "sec-h", text: L.againstH || "Studies that raise concerns or are uncertain" }), studies.filter(function (s) { return s.side === "against"; }).map(study),
        el("p", { class: "help", text: L.refs || "Full references are in the Literature Review, Part B." })));
  }
  function compare() {
    var rows = [["In one line", "line"], ["Who it reaches", "reach"], ["Main strength", "strength"], ["Main risk", "risk"], ["Where it fits in UNA", "una"]];
    var thead = el("tr", {}, el("th"), S.content.options.map(function (o) { return el("th", { text: o.k + ". " + o.name }); }));
    var body = rows.map(function (r) { return el("tr", {}, el("td", { text: r[0] }), S.content.options.map(function (o) { return el("td", {}, rich(o[r[1]])); })); });
    return el("div", { class: "cmp" }, el("table", {}, el("thead", {}, thead), el("tbody", {}, body)));
  }
  function block(b) {
    if (b.showIf && !cond(b.showIf)) return null;
    switch (b.t) {
      case "h": return el("h2", {}, rich(b.text));
      case "h3": return el("h3", {}, rich(b.text));
      case "lead": return el("p", { class: "lead" }, rich(b.text));
      case "p": return el("p", {}, rich(b.text));
      case "help": return el("p", { class: "help" }, rich(b.text));
      case "pill": return el("span", { class: "pill" }, el("b"), document.createTextNode(b.text));
      case "ul": return el("ul", { class: "plain" }, b.items.map(function (i) { return el("li", {}, rich(i)); }));
      case "note": return el("div", { class: "note" }, rich(b.text));
      case "legal": return el("blockquote", { class: "legal" }, rich(b.text));
      case "tiles": return el("div", { class: "tiles" }, b.items.map(function (i) { return el("div", { class: "tile" }, el("b", { text: i.big }), el("span", { text: i.small })); }));
      case "two": return el("div", { class: "two" },
        el("div", { class: "box yes" }, el("h3", { text: b.left.title }), el("ul", {}, b.left.items.map(function (i) { return el("li", {}, rich(i)); }))),
        el("div", { class: "box no" }, el("h3", { text: b.right.title }), el("ul", {}, b.right.items.map(function (i) { return el("li", {}, rich(i)); }))));
      case "q": return question(b.id);
      case "consent":
        var cur = S.answers[b.id] === true;
        var inp = el("input", { type: "checkbox", checked: cur, onchange: function () { setAns(b.id, inp.checked); redraw(); } });
        return el("label", { class: "opt" + (cur ? " sel" : "") }, inp, el("span", {}, rich(b.text)));
      case "details": return el("details", {}, el("summary", { text: b.summary }), b.blocks.map(block));
      case "optionCard": return optCard(b.id);
      case "compare": return compare();
      default: return null;
    }
  }

  // ---------- saving ----------
  function persist() {
    if (!S.hash || !S.form) return;
    store("pk1_" + S.hash + "_" + S.form, { session: S.session, answers: S.answers, order: S.order, pos: S.pos, furthest: S.furthest, completed: S.completed, queue: S.queue, v: S.content && S.content.meta && S.content.meta.version });
  }
  function status(text, warn) {
    var s = $("saveState"); s.hidden = !text; s.textContent = text || ""; s.className = "save" + (warn ? " warn" : "");
  }
  function enqueue(item) { S.queue.push(item); persist(); flush(); }
  var flushing = false;
  function flush() {
    if (flushing || !S.queue.length) { if (!S.queue.length) status(T("saved")); return; }
    flushing = true; status(T("sending"));
    (function next() {
      if (!S.queue.length) { flushing = false; status(T("saved")); persist(); return; }
      var it = S.queue[0];
      rpc("save_response", { p_code: S.code, p_session: S.session, p_form: S.form, p_patch: it.patch, p_profile: it.profile, p_order: it.order, p_complete: !!it.complete })
        .then(function (r) {
          if (r && r.ok) { S.queue.shift(); persist(); next(); }
          else { flushing = false; status(T("notSaved"), true); }
        })
        .catch(function () { flushing = false; status(T("savedLocal"), true); });
    })();
  }
  window.addEventListener("online", flush);
  setInterval(function () { if (S.queue.length) flush(); }, 20000);
  function saveScreen(sc, complete) {
    var patch = {}, ids = screenQuestions(sc.blocks), ord = {};
    ids.forEach(function (id) {
      if (S.answers[id] !== undefined) patch[id] = S.answers[id];
      if (S.answers[id + "_text"] !== undefined) patch[id + "_text"] = S.answers[id + "_text"];
      if (S.order[id]) ord[id] = S.order[id];
    });
    if (sc.consent && S.answers[sc.consent] !== undefined) patch[sc.consent] = S.answers[sc.consent];
    var profile = {}; ["0.1", "0.2", "B1"].forEach(function (k) { if (S.answers[k] != null) profile[k] = S.answers[k]; });
    if (!Object.keys(patch).length && !complete) return;
    enqueue({ patch: patch, profile: profile, order: ord, complete: !!complete });
  }

  // ---------- rendering ----------
  var lastFocus = null;
  function redraw(focusKey) {
    var y = window.scrollY; lastFocus = focusKey || null;
    render(true);
    window.scrollTo(0, y);
    if (lastFocus) { var f = document.querySelector('[data-k="' + lastFocus.replace(/"/g, '\\"') + '"]'); if (f) f.focus({ preventScroll: true }); }
  }
  function updateNav() {
    var list = flat(), i = posIndex(list), nx = $("nextBtn");
    if (nx) { var ok = canContinue(list[i].sc); nx.disabled = !ok; var h = $("needMsg"); if (h) h.hidden = ok; }
  }
  function render(keepScroll) {
    var list = flat(), i = posIndex(list), cur = list[i], sc = cur.sc, st = cur.st;
    S.pos = sc.id; if (i > S.furthest) S.furthest = i; persist();
    $("module").className = "layout" + (S.content.meta && S.content.meta.sidebar === false ? "" : " side");
    $("side").hidden = S.content.meta && S.content.meta.sidebar === false;
    // sidebar
    var stops = $("stops"); stops.innerHTML = "";
    var seen = {};
    list.forEach(function (x, idx) { if (seen[x.st.id]) { seen[x.st.id].last = idx; return; } seen[x.st.id] = { st: x.st, first: idx, last: idx }; });
    Object.keys(seen).forEach(function (k) {
      var s = seen[k], done = i > s.last, on = s.st.id === st.id;
      var btn = el("button", { type: "button", class: done ? "done" : "", "aria-current": on ? "step" : null, disabled: s.first > S.furthest,
        onclick: function () { S.pos = list[s.first].sc.id; render(); window.scrollTo(0, 0); } },
        el("span", { class: "dot", text: done ? "✓" : String(s.st.num != null ? s.st.num : "") }), document.createTextNode(s.st.label));
      stops.appendChild(el("li", {}, btn));
    });
    // crumb and bar
    var total = S.content.meta && S.content.meta.stopCount;
    $("crumb").lastChild.textContent = (st.num != null && total ? T("stopOf", { n: st.num, total: total }) + " · " : "") + (sc.crumb || st.label);
    $("barfill").style.width = Math.round((i + 1) / list.length * 100) + "%";
    // body
    var main = $("main"); main.innerHTML = "";
    var nodes = (sc.blocks || []).map(block).filter(Boolean);
    if (sc.bare) nodes.forEach(function (n) { main.appendChild(n); });
    else main.appendChild(el("div", { class: "card" }, nodes));
    var last = i === list.length - 1, ok = canContinue(sc);
    main.appendChild(el("div", { class: "nav2" },
      el("button", { type: "button", class: "btn ghost", disabled: i === 0, onclick: function () { go(i - 1); }, text: T("back") }),
      last ? null : el("button", { type: "button", class: "btn", id: "nextBtn", disabled: !ok, onclick: function () { go(i + 1); }, text: sc.nextLabel || T("next") })));
    main.appendChild(el("p", { class: "help", id: "needMsg", style: "text-align:right;margin-top:8px", hidden: ok, text: T("pleaseAnswer") }));
    if (!keepScroll) window.scrollTo(0, 0);
  }
  function go(idx) {
    var list = flat(), from = list[posIndex(list)];
    if (idx > posIndex(list)) {
      var to = list[Math.min(idx, list.length - 1)];
      saveScreen(from.sc, !!to.sc.final);
      if (to.sc.final) { S.completed = true; }
    }
    S.pos = list[Math.max(0, Math.min(idx, list.length - 1))].sc.id;
    render();
  }

  // ---------- starting ----------
  function showOnly(id) { ["gate", "chooser", "module"].forEach(function (x) { $(x).hidden = x !== id; }); }
  function startForm(f) {
    S.form = f.form; S.content = f.content || {}; UI = Object.assign({}, UI0, S.content.ui || {});
    var key = "pk1_" + S.hash + "_" + S.form, saved = load(key);
    if (!S.content.stops || !S.content.stops.length) {
      showOnly("module"); $("side").hidden = true; $("module").className = "layout";
      $("crumb").lastChild.textContent = ""; $("barfill").style.width = "0%";
      var m = $("main"); m.innerHTML = ""; m.appendChild(el("div", { class: "card" }, el("h2", { text: T("stubTitle") }), el("p", { text: T("stubText") })));
      return;
    }
    function fresh() { S.session = uuid(); S.answers = {}; S.order = {}; S.furthest = 0; S.completed = false; S.queue = []; S.pos = flat()[0].sc.id; persist(); showOnly("module"); render(); }
    S.session = S.session || null;
    if (saved && saved.session && saved.answers && Object.keys(saved.answers).length && !saved.completed && saved.pos) {
      S.session = saved.session; S.answers = saved.answers; S.order = saved.order || {}; S.pos = saved.pos; S.furthest = saved.furthest || 0; S.completed = false; S.queue = saved.queue || [];
      showOnly("module"); $("side").hidden = true;
      $("crumb").lastChild.textContent = ""; $("barfill").style.width = "0%";
      var main = $("main"); main.innerHTML = "";
      main.appendChild(el("div", { class: "card" }, el("h2", { text: T("resumeTitle") }), el("p", { text: T("resumeText") }),
        el("div", { class: "nav2", style: "justify-content:flex-start;gap:12px" },
          el("button", { type: "button", class: "btn", text: T("resumeYes"), onclick: function () { showOnly("module"); render(); flush(); } }),
          el("button", { type: "button", class: "btn ghost", text: T("resumeNo"), onclick: function () { fresh(); } }))));
      return;
    }
    if (saved && saved.completed) { S.session = saved.session; S.answers = saved.answers || {}; S.completed = true; }
    fresh();
  }
  function showChooser() {
    var list = $("choiceList"); list.innerHTML = ""; showOnly("chooser");
    S.forms.forEach(function (f) {
      var c = f.content && f.content.meta || {};
      var title = c.chooserTitle || (f.form === "bhw" ? "Maikling porma para sa mga barangay health worker (Filipino)" : "Full form (English)");
      var text = c.chooserText || (f.form === "bhw" ? "Para sa mga barangay health worker. Mga 5 minuto." : "For people who cannot attend, and for LGU staff. About 15 minutes.");
      list.appendChild(el("button", { type: "button", onclick: function () { startForm(f); } }, el("b", { text: title }), document.createTextNode(text)));
    });
  }
  function submitCode() {
    var code = $("code").value.trim(), out = $("gateMsg");
    if (!code) return;
    $("codeGo").disabled = true; msg(out, "Checking...", "");
    var local = window.PK_DEV && code.toUpperCase() === "DEV";
    var p = local ? Promise.resolve({ ok: true, open: true, forms: window.PK_DEV.forms, attendance: "unknown" }) : rpc("open_space", { p_code: code });
    p.then(function (r) {
      $("codeGo").disabled = false;
      if (!r.ok) { msg(out, r.reason === "closed" ? "This module has closed. Thank you for your interest." : "That code was not recognized. Please check it and try again.", "err"); return; }
      if (r.open === false) {
        var d = new Date(r.opens_at), when = d.toLocaleString("en-PH", { timeZone: "Asia/Manila", dateStyle: "long", timeStyle: "short" });
        msg(out, "The module opens on " + when + " (Manila time). Please come back then.", ""); return;
      }
      msg(out, "", ""); S.code = code; S.forms = r.forms || [];
      if (window.PK_DEV && !local) {
        // local testing only: use the draft content on this computer with a real code
        S.forms = S.forms.map(function (f) { var d = window.PK_DEV.forms.filter(function (x) { return x.form === f.form; })[0]; return d ? { form: f.form, lang: f.lang, content: d.content } : f; });
      }
      return sha(code.toUpperCase().trim()).then(function (h) {
        S.hash = h;
        if (S.forms.length > 1) showChooser(); else if (S.forms.length === 1) startForm(S.forms[0]); else msg(out, "Nothing is open for this code yet.", "err");
      });
    }).catch(function () { $("codeGo").disabled = false; msg(out, "Could not reach the server. Please check your connection and try again.", "err"); });
  }
  $("codeGo").onclick = submitCode;
  $("code").addEventListener("keydown", function (e) { if (e.key === "Enter") submitCode(); });
  if (location.hash.indexOf("qnos") >= 0) document.body.classList.add("qnos");
  if (location.protocol === "file:" || location.protocol === "data:" || location.hostname === "localhost") {
    var s = document.createElement("script"); s.src = "dev-content.js"; s.onerror = function () {}; document.head.appendChild(s);
  }
})();
