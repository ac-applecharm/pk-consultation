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
    stubText: "The text for this part has not been published yet.",
    exit: "Exit Pre-work Module", exitSaving: "Your last answers are still being saved. Please wait until you see Saved, then try again.",
    overLimit: "Please keep each answer to {max} words or fewer.", langSwitch: "Language", studyHelp: "The links open the full paper on the publisher’s website. Some journals may ask you to sign in.",
    internalDoc: "Internal DOH document", submit: "Submit", submitting: "Submitting...",
    exclusiveHint: "Choosing {x} clears your other choices.", orWord: "or", backToStart: "Back to the first question",
    tableShow: "Show the numbers as a table",
    submitFail: "Your answers could not be sent yet. They are saved on this device. Please check your connection and press Submit again."
  };
  var S = { code: null, hash: null, forms: [], form: null, content: null, variants: null, lang: null, session: null, answers: {}, order: {}, pos: null, furthest: 0, completed: false, queue: [] };
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
    String(text == null ? "" : text).split(/(\*\*.+?\*\*|\{\{.+?\}\}|\[[^\]]+\]\(https?:\/\/[^)\s]+\))/g).forEach(function (part) {
      if (!part) return;
      var lk = /^\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)$/.exec(part);
      if (lk) frag.appendChild(el("a", { href: lk[2], target: "_blank", rel: "noopener noreferrer", text: lk[1] }));
      else if (part.slice(0, 2) === "**") frag.appendChild(el("b", { text: part.slice(2, -2) }));
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
  // The definition opens as a callout next to the tapped word, below it or above it, kept inside the screen.
  var glossFor = null;
  function closeGloss(refocus) {
    var g = $("gloss"); g.classList.remove("on", "up");
    if (refocus && glossFor && document.body.contains(glossFor)) glossFor.focus({ preventScroll: true });
    glossFor = null;
  }
  function openGloss(b, ev, quiet) {
    var g = $("gloss"), k = b.getAttribute("data-term");
    g.innerHTML = ""; g.setAttribute("aria-label", k);
    g.appendChild(el("button", { type: "button", class: "gx", id: "glx", "aria-label": "Close", text: "×" }));
    g.appendChild(el("b", { text: k })); g.appendChild(el("span", { class: "gd", text: S.content.glossary[k] }));
    g.style.left = "0px"; g.style.top = "0px"; g.classList.remove("up"); g.classList.add("on");
    var rects = b.getClientRects(), r = rects[0];
    for (var i = 0; i < rects.length; i++) if (ev && ev.clientX >= rects[i].left && ev.clientX <= rects[i].right && ev.clientY >= rects[i].top && ev.clientY <= rects[i].bottom) r = rects[i];
    var vw = document.documentElement.clientWidth, vh = window.innerHeight, w = g.offsetWidth, h = g.offsetHeight, gap = 10;
    var left = Math.max(12, Math.min(r.left + r.width / 2 - w / 2, vw - w - 12));
    var below = r.bottom + gap + h <= vh || r.top - gap - h < 0;
    g.style.left = (left + window.scrollX) + "px";
    g.style.top = ((below ? r.bottom + gap : r.top - gap - h) + window.scrollY) + "px";
    g.style.setProperty("--ax", Math.max(18, Math.min(r.left + r.width / 2 - left, w - 18)) + "px");
    g.classList.toggle("up", !below);
    glossFor = b; if (!quiet) $("glx").focus({ preventScroll: true });
  }
  document.addEventListener("click", function (e) {
    var b = e.target.closest ? e.target.closest(".term") : null;
    if (b) { if (glossFor === b && $("gloss").classList.contains("on")) closeGloss(false); else openGloss(b, e); return; }
    if (e.target.id === "glx") { closeGloss(true); return; }
    if (!e.target.closest("#gloss")) closeGloss(false);
  });
  document.addEventListener("keydown", function (e) { if (e.key === "Escape") closeGloss(true); });
  // on a phone the address bar hides and shows while scrolling, which fires "resize": place the callout again instead of closing it
  window.addEventListener("resize", function () { if (glossFor && $("gloss").classList.contains("on") && document.body.contains(glossFor)) openGloss(glossFor, null, true); else closeGloss(false); });

  // ---------- conditions ----------
  function cond(c) {
    if (!c) return true;
    var v = S.answers[c.q];
    if (c.answered) return v != null && v !== "" && !(Array.isArray(v) && !v.length);
    if (c.in) return Array.isArray(v) ? v.some(function (x) { return c.in.indexOf(x) >= 0; }) : c.in.indexOf(v) >= 0;
    if (c.notIn) return v != null && v !== "" && c.notIn.indexOf(v) < 0;
    if (c.len) return Array.isArray(v) && v.length >= c.len;
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
  var MAXW = 1500;
  function otherBox(id, q, selected) {
    if (!q.other) return null;
    var max = q.otherMaxWords || MAXW, counter = el("div", { class: "counter" });
    function upd(val) { counter.textContent = wc(val) + " / " + max + " " + UI.words; counter.className = "counter" + (wc(val) > max ? " over" : ""); }
    var ta = el("textarea", { id: "ot_" + id, rows: "2", placeholder: UI.otherSpecify, "aria-label": UI.otherSpecify,
      oninput: function () { setAns(id + "_text", ta.value); upd(ta.value); updateNav(); } });
    ta.value = S.answers[id + "_text"] || ""; upd(ta.value);
    var wrap = el("div", { style: "margin:-2px 0 10px" }, ta, counter);
    wrap.hidden = !selected; return wrap;
  }
  // true when an "Other (specify)" choice is currently chosen for this question
  function otherChosen(id, q) {
    var v = S.answers[id];
    return !!q.other && (Array.isArray(v) ? q.other.some(function (x) { return v.indexOf(x) >= 0; }) : q.other.indexOf(v) >= 0);
  }
  function qSingle(id, q) {
    var cur = S.answers[id], opts = optList(q);
    if (q.shuffle) opts = shuffled(id, opts, q.fixedLast || 0);
    // a list built from an earlier answer: drop an answer that is no longer on the list
    if (q.optionsOf && cur != null && !opts.some(function (o) { return o.v === cur; })) { delete S.answers[id]; cur = undefined; persist(); }
    var seg = q.type === "scale";
    var wrap = el("div", { class: "q", role: "radiogroup" }, qLabel(id, q), q.help ? el("p", { class: "help" }, rich(q.help)) : null);
    var box = el("div", { class: seg ? "seg" : "" });
    opts.forEach(function (o) {
      var inp = el("input", { type: "radio", name: id, value: o.v, "data-k": id + "|" + o.v, checked: cur === o.v,
        onchange: function () { setAns(id, o.v); redraw(id + "|" + o.v); } });
      var lab = el("label", { class: (seg ? (o.v.length > 12 ? "wide " : "") : "opt ") + (cur === o.v ? "sel" : "") }, inp, seg ? document.createTextNode(o.l) : el("span", {}, rich(o.l), o.h ? el("span", { class: "help", style: "display:block;margin:0" }, rich(o.h)) : null));
      box.appendChild(lab);
      if (q.other && q.other.indexOf(o.v) >= 0) { var ob = otherBox(id, q, cur === o.v); if (ob) box.appendChild(ob); }
    });
    wrap.appendChild(box);
    return wrap;
  }
  // A choice such as "None of these" or "Don't know" is exclusive: while it is chosen, every other choice
  // (and the Other text) is cleared and locked. Un-ticking it unlocks the list again.
  function qMulti(id, q) {
    var cur = S.answers[id] || [], opts = optList(q), ex = q.exclusive || [];
    if (q.shuffle) opts = shuffled(id, opts, q.fixedLast || 0);
    var exOn = cur.filter(function (x) { return ex.indexOf(x) >= 0; })[0];
    if (exOn != null && cur.length > 1) { cur = [exOn]; S.answers[id] = cur; delete S.answers[id + "_text"]; persist(); }
    var hint = null;
    if (ex.length) {
      var names = ex.map(function (v) { var o = opts.filter(function (x) { return x.v === v; })[0]; return "“" + (o ? o.l : v) + "”"; });
      hint = el("p", { class: "help ex-hint", text: T("exclusiveHint", { x: names.join(" " + T("orWord") + " ") }) });
    }
    var wrap = el("div", { class: "q" }, qLabel(id, q), q.help ? el("p", { class: "help" }, rich(q.help)) : null, hint);
    var full = q.max && cur.length >= q.max;
    opts.forEach(function (o) {
      var on = cur.indexOf(o.v) >= 0, isEx = ex.indexOf(o.v) >= 0, off = !on && (exOn != null || (full && !isEx));
      var inp = el("input", { type: "checkbox", value: o.v, "data-k": id + "|" + o.v, checked: on, disabled: off,
        onchange: function () {
          var a = (S.answers[id] || []).slice(), i = a.indexOf(o.v);
          if (i >= 0) a.splice(i, 1);
          else if (isEx) { a = [o.v]; delete S.answers[id + "_text"]; }
          else a.push(o.v);
          setAns(id, a); redraw(id + "|" + o.v);
        } });
      wrap.appendChild(el("label", { class: "opt" + (on ? " sel" : "") + (off ? " off" : "") }, inp, el("span", {}, rich(o.l), o.h ? el("span", { class: "help", style: "display:block;margin:0" }, rich(o.h)) : null)));
      if (q.other && q.other.indexOf(o.v) >= 0) { var ob = otherBox(id, q, on); if (ob) wrap.appendChild(ob); }
    });
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
      if (q.display === "stars") { wrap.appendChild(starRow(id, q, r, cur)); return; }
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
  // One row of a rating question shown as stars (stored answers stay "1" to "5", and the "don't know" value).
  function starRow(id, q, r, cur) {
    var chosen = cur[r.key], num = Number(chosen) || 0;
    var nums = q.values.filter(function (v) { return /^[1-5]$/.test(typeof v === "string" ? v : v.v); });
    var others = q.values.filter(function (v) { return !/^[1-5]$/.test(typeof v === "string" ? v : v.v); });
    var grp = el("div", { class: "stars", role: "radiogroup", "aria-label": r.plain || r.key });
    function setv(val) { var o = Object.assign({}, S.answers[id] || {}); o[r.key] = val; setAns(id, o); redraw(id + "_" + r.key + "|" + val); }
    nums.forEach(function (v, k) {
      var val = typeof v === "string" ? v : v.v, inp = el("input", { type: "radio", name: id + "_" + r.key, value: val, "data-k": id + "_" + r.key + "|" + val, checked: chosen === val, onchange: function () { setv(val); } });
      grp.appendChild(el("label", { class: "star" + (num >= k + 1 ? " on" : ""), title: (k + 1) + (k ? " stars" : " star") }, inp, el("span", { "aria-hidden": "true", text: num >= k + 1 ? "★" : "☆" }), el("span", { class: "sr", text: (k + 1) + (k ? " stars" : " star") })));
    });
    others.forEach(function (v) {
      var val = typeof v === "string" ? v : v.v, lab = typeof v === "string" ? v : (v.l || v.v);
      var inp = el("input", { type: "radio", name: id + "_" + r.key, value: val, "data-k": id + "_" + r.key + "|" + val, checked: chosen === val, onchange: function () { setv(val); } });
      grp.appendChild(el("label", { class: "dk" + (chosen === val ? " sel" : "") }, inp, document.createTextNode(lab)));
    });
    return el("div", { class: "rate" }, el("div", { class: "name" }, rich(r.label)), grp);
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
      var shown = (q.other && q.other.indexOf(g) >= 0 && (S.answers[q.source + "_text"] || "").trim()) ? S.answers[q.source + "_text"].trim() : g;
      var lab = el("label", { class: "t", style: "font-weight:500", for: "t_" + id + "_" + g }, rich((q.itemLabel || "{g}").replace("{g}", shown)));
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
  // The word limit that this question's answer goes over, or 0 when it is within its limits.
  function overBy(id, q) {
    var v = S.answers[id], mx = q.maxWords || 0;
    if (q.other && otherChosen(id, q) && wc(S.answers[id + "_text"]) > (q.otherMaxWords || MAXW)) return q.otherMaxWords || MAXW;
    if (!mx) return 0;
    if ((q.type === "open" || q.type === "text") && wc(v) > mx) return mx;
    if ((q.type === "perGroup" || q.type === "condText") && v && Object.keys(v).some(function (k) { return wc(v[k]) > mx; })) return mx;
    return 0;
  }
  function overLimit(id, q) { return overBy(id, q) > 0; }
  function canContinue(sc) {
    return screenQuestions(sc.blocks).every(function (id) {
      var q = S.content.questions[id];
      if (q.type === "consent") return S.answers[id] === true;
      if (overLimit(id, q)) return false;
      if (!isRequired(q)) return true;
      return answered(id, q);
    }) && (!sc.consent || S.answers[sc.consent] === true);
  }
  function limitMsg(sc) {
    var max = 0;
    screenQuestions(sc.blocks).forEach(function (id) { var q = S.content.questions[id], b = overBy(id, q); if (b) max = b; });
    return max ? T("overLimit", { max: max }) : "";
  }

  // ---------- blocks ----------
  function optCard(id) {
    var o = S.content.options.filter(function (x) { return x.k === id; })[0];
    var studies = S.content.studies.filter(function (s) { return s.opt === id; });
    function f(k, t) { return el("div", { class: "field" }, el("p", { class: "k", text: k }), el("p", {}, rich(t))); }
    function stop(e) { e.stopPropagation(); }
    function paperLink(href, text) { return el("a", { class: "doi", href: href, target: "_blank", rel: "noopener noreferrer", onclick: stop, text: text }); }
    function study(c) {
      var refs = (c.doi || []).map(function (d) { return paperLink("https://doi.org/" + d, "doi:" + d); });
      if (!refs.length && c.url) refs.push(paperLink(c.url, c.urlLabel || "Full text"));
      if (!refs.length && c.internal) refs.push(el("span", { class: "doi", text: T("internalDoc") }));
      return el("details", { class: "study" }, el("summary", {}, document.createTextNode(c.who + " "), refs, el("span", { class: "chip " + c.tag, text: c.tag })),
        el("p", { class: "k", text: "What they wanted to find out" }), el("p", { text: c.aim }),
        el("p", { class: "k", text: "What they found" }), el("p", { text: c.found }),
        el("p", { class: "k", text: "What it means for Option " + id }), el("p", {}, el("b", { text: c.tag + ". " }), document.createTextNode(c.means)),
        el("p", { class: "k", text: "Limits" }), el("p", { text: c.limits }));
    }
    var L = S.content.labels || {};
    return el("div", { class: "card opt-card" }, el("span", { class: "pill" }, el("b"), document.createTextNode("Option " + id)),
      el("h2", { style: "margin-top:12px" }, el("span", { class: "letter", text: id }), document.createTextNode(o.name)),
      f(L.line || "In one line", o.line), f(L.ilaya || "In the example", o.ilaya), f(L.reach || "Who it reaches", o.reach),
      f(L.strength || "Main strength", o.strength), f(L.risk || "Main risk", o.risk), f(L.una || "Where it fits", o.una), o.req ? f(L.req || "Required under any option", o.req) : null,
      el("details", {}, el("summary", { text: L.deeper || "Go deeper" }),
        el("p", { class: "help", text: (L.deeperHelp || "Each study below is summarized in the same way. Tap a study to open it.") + " " + T("studyHelp") }),
        el("p", { class: "sec-h", text: L.forH || "Studies that support this option" }), studies.filter(function (s) { return s.side === "for"; }).map(study),
        el("p", { class: "sec-h", text: L.againstH || "Studies that raise concerns or are uncertain" }), studies.filter(function (s) { return s.side === "against"; }).map(study)));
  }
  function compare() {
    var rows = [["In one line", "line"], ["Who it reaches", "reach"], ["Main strength", "strength"], ["Main risk", "risk"], ["Where it fits in UNA", "una"], ["Required under any option", "req"]];
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
      case "tiles": return el("div", { class: "tiles" }, b.items.map(function (i) { return el("div", { class: "tile" }, el("b", {}, rich(i.big)), el("span", {}, rich(i.small))); }));
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
      case "targetCard": return targetCard();
      case "dumbbell": return dumbbell(b);
      case "exit": return el("div", { class: "nav2", style: "justify-content:flex-start;margin-top:18px" },
        el("button", { type: "button", class: "btn", id: "exitBtn", text: T("exit"), onclick: exitModule }), el("div", { id: "exitMsg", style: "align-self:center" }));
      default: return null;
    }
  }
  // A dumbbell chart (one row per area, two dots joined by a line), in the style of equity-assessment charts.
  // The numbers come from the content: b.rows = [{ label, a, b, lo, hi }], with a = first group and b = second group.
  function dumbbell(b) {
    var W = b.words || {}, max = b.max || 100, aN = b.aLabel, bN = b.bLabel;
    function f1(n) { return (Math.round(n * 10) / 10).toFixed(1); }
    function sgn(n) { return (n > 0 ? "+" : n < 0 ? "−" : "") + f1(Math.abs(n)); }
    function pos(n) { return Math.max(0, Math.min(100, n / max * 100)); }
    var wrap = el("figure", { class: "dbl" }, b.title ? el("figcaption", { class: "dbl-t" }, rich(b.title)) : null,
      el("div", { class: "dbl-leg", "aria-hidden": "true" }, el("span", {}, el("i", { class: "dot a" }), aN), el("span", {}, el("i", { class: "dot b" }), bN)));
    var ticks = [0, 0.25, 0.5, 0.75, 1].map(function (t) { return Math.round(t * max); });
    var axis = el("div", { class: "dbl-axis", "aria-hidden": "true" }, el("span", {}), el("div", { class: "dbl-plot" }, ticks.map(function (t) { return el("em", { style: "left:" + pos(t) + "%", text: t + (b.unit || "") }); })), el("span", {}));
    wrap.appendChild(axis);
    b.rows.forEach(function (r) {
      var d = r.d != null ? r.d : r.b - r.a, none = r.lo <= 0 && r.hi >= 0;
      var aria = r.label + ": " + aN + " " + f1(r.a) + (b.unit || "") + ", " + bN + " " + f1(r.b) + (b.unit || "") + ", " + (W.diff || "difference") + " " + sgn(d) + " " + (W.pp || "points") + " (95% " + (W.ci || "interval") + " " + sgn(r.lo) + " " + (W.to || "to") + " " + sgn(r.hi) + ")" + (none ? ", " + (W.none || "no clear difference") : "");
      var lo = Math.min(r.a, r.b), hi = Math.max(r.a, r.b), aLeft = r.a <= r.b;
      var plot = el("div", { class: "dbl-plot" },
        el("i", { class: "grid", style: "left:0" }), el("i", { class: "grid", style: "left:50%" }), el("i", { class: "grid", style: "left:100%" }),
        el("i", { class: "bar", style: "left:" + pos(lo) + "%;width:" + (pos(hi) - pos(lo)) + "%" }),
        el("i", { class: "dot a", style: "left:" + pos(r.a) + "%" }), el("i", { class: "dot b", style: "left:" + pos(r.b) + "%" }),
        el("span", { class: "v " + (aLeft ? "l" : "r"), style: "left:" + pos(r.a) + "%", text: f1(r.a) }),
        el("span", { class: "v " + (aLeft ? "r" : "l"), style: "left:" + pos(r.b) + "%", text: f1(r.b) }));
      wrap.appendChild(el("div", { class: "dbl-row", role: "img", "aria-label": aria },
        el("div", { class: "dbl-l" }, rich(r.label), r.note ? el("small", { text: r.note }) : null), plot,
        el("div", { class: "dbl-d" + (none ? " none" : "") }, el("b", { text: sgn(d) }), el("small", { text: none ? (W.none || "no clear difference") : "(" + sgn(r.lo) + " " + (W.to || "to") + " " + sgn(r.hi) + ")" }))));
    });
    if (b.note) wrap.appendChild(el("p", { class: "help", style: "margin-top:12px" }, rich(b.note)));
    return wrap;
  }
  // The regional card: the region's share of the national targets, worked out here from the table in the content.
  function fmt(n) {
    if (n >= 100) return Math.round(n).toLocaleString("en-US");
    return (Math.round(n * 10) / 10).toLocaleString("en-US", { minimumFractionDigits: 1, maximumFractionDigits: 1 });
  }
  function dateText(iso) { var d = new Date(iso + "T00:00:00"); return d.toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" }); }
  function targetCard() {
    var T = S.content.targets; if (!T) return null;
    var d = T.data, pick = S.answers[T.qRegion], reg = null;
    d.regions.forEach(function (r) { if (r.name === pick) reg = r; });
    var nat = !reg, teams = nat ? d.regions.reduce(function (a, r) { return a + (r.teams || 0); }, 0) : reg.teams;
    var pop = nat ? d.nationalPop : reg.pop, share = pop / d.nationalPop;
    var regN = d.register * share, scrN = d.screen * share, days = d.workingDays;
    var v = { region: nat ? T.natName : reg.name, pop: fmt(pop), reg: fmt(regN), scr: fmt(scrN), days: days.toLocaleString("en-US"), asof: d.teamsAsOf || "",
      regDay: fmt(regN / days), scrDay: fmt(scrN / days), teams: teams ? teams.toLocaleString("en-US") : "",
      regTeam: teams ? fmt(regN / teams) : "", scrTeam: teams ? fmt(scrN / teams) : "", regTeamDay: teams ? fmt(regN / teams / days) : "", scrTeamDay: teams ? fmt(scrN / teams / days) : "",
      pctReg: (Math.round(d.register / d.nationalPop * 1000) / 10).toString(), pctScr: (Math.round(d.screen / d.nationalPop * 1000) / 10).toString(),
      perYear: String(d.daysPerYear), start: dateText(d.start), end: dateText(d.end) };
    function fill(t) { return String(t).replace(/\{(\w+)\}/g, function (m, k) { return v[k] != null ? v[k] : m; }); }
    var tiles = [{ big: v.reg, small: "to register under YAKAP (at least)" }, { big: v.scr, small: "to screen (at least)" }, { big: v.regDay, small: "registered each working day, whole region" }, { big: v.scrDay, small: "screened each working day, whole region" }];
    if (teams) { tiles.push({ big: v.regTeam, small: "registrations for each PK team" }, { big: v.scrTeam, small: "screenings for each PK team" }); }
    var out = el("div", {},
      el("div", { class: "tiles" }, tiles.map(function (i) { return el("div", { class: "tile" }, el("b", { text: i.big }), el("span", { text: i.small })); })),
      el("ul", { class: "plain" }, T.lines.filter(function (l) { return teams || (l.indexOf("{teams}") < 0 && l.indexOf("{regTeamDay}") < 0); }).map(function (l) { return el("li", {}, rich(fill(l))); })));
    if (!nat && reg.carried && T.carriedNote) out.appendChild(el("p", { class: "help", text: T.carriedNote }));
    out.appendChild(el("p", { class: "help", text: fill(T.note) }));
    out.appendChild(el("p", { class: "help", text: fill(T.source) }));
    return out;
  }
  // Leaves the module and returns to the access-code page. Saved answers stay saved.
  function exitModule() {
    if (S.queue.length) { flush(); msg($("exitMsg"), T("exitSaving"), ""); return; }
    closeGloss(false);
    S.code = null; S.hash = null; S.forms = []; S.form = null; S.cameFrom = null; S.carried = []; S.content = null; S.variants = null; S.lang = null; S.session = null;
    S.answers = {}; S.order = {}; S.pos = null; S.furthest = 0; S.completed = false; S.queue = [];
    $("main").innerHTML = ""; $("segs").innerHTML = ""; $("langBtn").hidden = true; document.documentElement.lang = "en";
    $("code").value = ""; msg($("gateMsg"), "", ""); status("");
    showOnly("gate"); window.scrollTo(0, 0); $("code").focus();
  }

  // ---------- saving ----------
  function persist() {
    if (!S.hash || !S.form) return;
    store("pk1_" + S.hash + "_" + S.form, { session: S.session, answers: S.answers, order: S.order, pos: S.pos, furthest: S.furthest, completed: S.completed, queue: S.queue, lang: S.lang, v: S.content && S.content.meta && S.content.meta.version });
  }
  function status(text, warn) {
    var s = $("saveState"); s.hidden = !text; s.textContent = text || ""; s.className = "save" + (warn ? " warn" : "");
  }
  function enqueue(item) {
    // the local preview (code DEV, content loaded from disk) never sends anything
    if (window.PK_DEV && S.code && S.code.toUpperCase() === "DEV") { S.queue = []; status(""); return; }
    S.queue.push(item); persist(); flush();
  }
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
    (S.carried || []).forEach(function (k) { if (S.answers[k] !== undefined && patch[k] === undefined) patch[k] = S.answers[k]; });
    var profile = {}; ["0.1", "0.2", "0.3", "B1"].forEach(function (k) { if (S.answers[k] != null) profile[k] = S.answers[k]; });
    if (S.lang) profile.lang = S.lang;
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
    if (nx) { var ok = canContinue(list[i].sc); nx.disabled = !ok; var h = $("needMsg"); if (h) { h.hidden = ok; h.textContent = limitMsg(list[i].sc) || T("pleaseAnswer"); } }
  }
  function render(keepScroll) {
    var list = flat(), i = posIndex(list), cur = list[i], sc = cur.sc, st = cur.st;
    S.pos = sc.id; if (i > S.furthest) S.furthest = i; persist();
    $("module").className = "layout";
    // progress bar: one segment for each stop, filled as the screens of that stop are passed
    var segs = $("segs"); segs.innerHTML = "";
    var seen = {}, order = [];
    list.forEach(function (x, idx) { if (seen[x.st.id]) { seen[x.st.id].last = idx; return; } seen[x.st.id] = { st: x.st, first: idx, last: idx }; order.push(seen[x.st.id]); });
    order.forEach(function (s) {
      var done = i > s.last, on = s.st.id === st.id, n = s.last - s.first + 1;
      var pct = done ? 100 : on ? Math.round((i - s.first + 1) / n * 100) : 0;
      var lbl = (s.st.num ? s.st.num + " · " : "") + s.st.label;
      var btn = el("button", { type: "button", class: "segbtn", "aria-current": on ? "step" : null, "aria-label": (s.st.num != null && S.content.meta && S.content.meta.stopCount ? T("stopOf", { n: s.st.num, total: S.content.meta.stopCount }) + ": " : "") + s.st.label, disabled: s.first > S.furthest || on,
        onclick: function () { S.pos = list[s.first].sc.id; render(); window.scrollTo(0, 0); } },
        el("span", { class: "track" }, el("i", { style: "width:" + pct + "%" })), el("span", { class: "lab", text: lbl }), el("span", { class: "labn", text: s.st.num != null && s.st.num !== 0 ? String(s.st.num) : s.st.label.charAt(0) }));
      segs.appendChild(el("li", { class: "seg" + (done ? " done" : on ? " cur" : "") }, btn));
    });
    // progress pills
    var total = S.content.meta && S.content.meta.stopCount;
    $("crumb").lastChild.textContent = (st.num != null && st.num !== 0 && total ? T("stopOf", { n: st.num, total: total }) : st.label);
    $("crumb2").textContent = sc.crumb || st.label; $("crumb2").hidden = !(sc.crumb || st.label) || (sc.crumb || st.label) === $("crumb").lastChild.textContent;
    // body
    var main = $("main"); main.innerHTML = "";
    var nodes = (sc.blocks || []).map(block).filter(Boolean);
    if (sc.bare) nodes.forEach(function (n) { main.appendChild(n); });
    else main.appendChild(el("div", { class: "card" }, nodes));
    var last = i === list.length - 1, ok = canContinue(sc);
    main.appendChild(el("div", { class: "nav2" },
      el("button", { type: "button", class: "btn ghost", disabled: i === 0 && !S.cameFrom, onclick: function () { if (S.cameFrom && S.pos === S.entryPos) backToStart(); else if (i === 0) backToStart(); else go(i - 1); }, text: T("back") }),
      last ? null : el("button", { type: "button", class: "btn", id: "nextBtn", disabled: !ok, onclick: function () { go(i + 1); }, text: sc.nextLabel || (list[i + 1] && list[i + 1].sc.final ? T("submit") : T("next")) })));
    main.appendChild(el("p", { class: "help", id: "needMsg", style: "text-align:right;margin-top:8px", hidden: ok, text: limitMsg(sc) || T("pleaseAnswer") }));
    closeGloss(false); langButton();
    if (!keepScroll) window.scrollTo(0, 0);
  }
  // Language switch for forms that carry more than one language (the Filipino short form).
  function pickLang(lang) {
    var v = S.variants, top = S.top || {};
    S.lang = lang;
    S.content = Object.assign({}, v[lang], { meta: Object.assign({}, top.meta || {}, v[lang].meta || {}) });
    UI = Object.assign({}, UI0, S.content.ui || {});
    document.documentElement.lang = lang;
  }
  function langButton() {
    var b = $("langBtn"), v = S.variants;
    if (!v || !S.lang) { b.hidden = true; return; }
    var other = Object.keys(v).filter(function (k) { return k !== S.lang; })[0];
    var names = (S.top && S.top.meta && S.top.meta.langNames) || {};
    b.hidden = !other; if (!other) return;
    b.textContent = names[other] || other; b.setAttribute("lang", other);
    b.setAttribute("aria-label", (names[other] || other) + " (" + T("langSwitch") + ")");
    b.onclick = function () { pickLang(other); persist(); render(true); };
  }
  // The last question screen sends everything, and the thank-you screen appears only after the database has it.
  function submitWait(finalId) {
    var btn = $("nextBtn"), msgEl = $("needMsg"), tries = 0;
    if (btn) { btn.disabled = true; btn.textContent = T("submitting"); }
    (function check() {
      if (!S.queue.length) { S.completed = true; S.pos = finalId; persist(); render(); return; }
      tries++; flush();
      if (tries > 40) { if (btn) { btn.disabled = false; btn.textContent = T("submit"); } if (msgEl) { msgEl.hidden = false; msgEl.textContent = T("submitFail"); } return; }
      setTimeout(check, 500);
    })();
  }
  // Question 0.1 decides the route: a group listed in its routeForm opens that form (the Filipino short form for BHWs).
  function routeFor(sc) {
    var r = null;
    screenQuestions(sc.blocks).forEach(function (id) {
      var q = S.content.questions[id], a = S.answers[id];
      if (q.routeForm && a != null && q.routeForm[a]) r = { to: q.routeForm[a], skip: (q.routeSkip || {})[q.routeForm[a]] || null, copy: q.routeCopy || {} };
    });
    return r;
  }
  // the answers given so far, up to and including the screen that decides the route (these go to the other form)
  function carryFrom(list, idx, copy) {
    var out = {};
    for (var j = 0; j <= idx; j++) {
      var sc = list[j].sc, ids = screenQuestions(sc.blocks);
      if (sc.consent) ids.push(sc.consent);
      ids.forEach(function (k) { [k, k + "_text"].forEach(function (kk) { if (S.answers[kk] !== undefined) out[kk] = S.answers[kk]; }); });
    }
    Object.keys(copy || {}).forEach(function (k) { if (out[k] !== undefined) out[copy[k]] = out[k]; });
    return out;
  }
  function formByName(n) { return S.forms.filter(function (f) { return f.form === n; })[0] || null; }
  function backToStart() {
    var f = formByName(S.cameFrom); if (!f) return;
    var pos = S.backPos || "about";
    store("pk1_" + S.hash + "_" + S.form, undefined);
    S.cameFrom = null; startForm(f, { pos: pos });
  }
  function go(idx) {
    var list = flat(), from = list[posIndex(list)];
    if (idx > posIndex(list)) {
      var rt = routeFor(from.sc), target = rt && rt.to !== S.form ? formByName(rt.to) : null;
      if (target) { var carry = carryFrom(list, posIndex(list), rt.copy), back = S.form; persist(); startForm(target, { carry: carry, from: back, backPos: from.sc.id, skipTo: rt.skip }); return; }
      var to = list[Math.min(idx, list.length - 1)];
      saveScreen(from.sc, !!to.sc.final);
      if (to.sc.final) { submitWait(to.sc.id); return; }
    }
    S.pos = list[Math.max(0, Math.min(idx, list.length - 1))].sc.id;
    render();
  }

  // ---------- starting ----------
  function showOnly(id) { ["gate", "module"].forEach(function (x) { $(x).hidden = x !== id; }); }
  function resetProg() { $("segs").innerHTML = ""; $("crumb").lastChild.textContent = ""; $("crumb2").hidden = true; }
  // opts: { carry } answers brought over from the form the person came from; { from } that form's name; { pos } open at that screen.
  function startForm(f, opts) {
    opts = opts || {};
    S.form = f.form; S.cameFrom = opts.from || null; S.backPos = opts.backPos || null; S.entryPos = opts.skipTo || null; S.carried = Object.keys(opts.carry || {});
    var key = "pk1_" + S.hash + "_" + S.form, saved = load(key);
    var fc = f.content || {};
    if (fc.variants && Object.keys(fc.variants).length) {
      S.top = fc; S.variants = fc.variants;
      var first = (fc.meta && fc.meta.defaultLang) || Object.keys(fc.variants)[0];
      pickLang(saved && saved.lang && fc.variants[saved.lang] ? saved.lang : first);
    } else { S.top = null; S.variants = null; S.lang = null; S.content = fc; UI = Object.assign({}, UI0, S.content.ui || {}); document.documentElement.lang = "en"; }
    if (!S.content.stops || !S.content.stops.length) {
      showOnly("module"); resetProg(); $("module").className = "layout";
      var m = $("main"); m.innerHTML = ""; m.appendChild(el("div", { class: "card" }, el("h2", { text: T("stubTitle") }), el("p", { text: T("stubText") })));
      return;
    }
    function fresh() { S.session = uuid(); S.answers = Object.assign({}, opts.carry || {}); S.order = {}; S.furthest = 0; S.completed = false; S.queue = []; S.pos = opts.skipTo || flat()[0].sc.id; var fl = flat(); S.furthest = Math.max(0, fl.map(function (x) { return x.sc.id; }).indexOf(S.pos)); persist(); showOnly("module"); render(); }
    S.session = S.session || null;
    var live = saved && saved.session && saved.answers && Object.keys(saved.answers).length && !saved.completed && saved.pos;
    if (live) { S.session = saved.session; S.answers = saved.answers; S.order = saved.order || {}; S.pos = saved.pos; S.furthest = saved.furthest || 0; S.completed = false; S.queue = saved.queue || []; }
    if (live && opts.carry) { Object.keys(opts.carry).forEach(function (k) { S.answers[k] = opts.carry[k]; }); persist(); }
    // coming back from the short form to the first question: open there at once, with the answers kept
    if (live && opts.pos) { S.pos = opts.pos; showOnly("module"); render(); return; }
    if (live) {
      showOnly("module"); resetProg(); langButton();
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
        if (!S.forms.length) { msg(out, "Nothing is open for this code yet.", "err"); return; }
        // everyone starts in the full form; question 0.1 sends BHWs to the short form. A BHW with unfinished answers goes straight back to it.
        var bhw = formByName("bhw"), sv = bhw && load("pk1_" + S.hash + "_bhw");
        if (bhw && sv && sv.session && sv.answers && Object.keys(sv.answers).length && !sv.completed && sv.pos) startForm(bhw);
        else startForm(formByName("full") || S.forms[0]);
      });
    }).catch(function () { $("codeGo").disabled = false; msg(out, "Could not reach the server. Please check your connection and try again.", "err"); });
  }
  $("codeGo").onclick = submitCode;
  $("code").addEventListener("keydown", function (e) { if (e.key === "Enter") submitCode(); });
  if (location.hash.indexOf("qnos") >= 0 || location.protocol === "file:") document.body.classList.add("qnos");
  if (location.protocol === "file:" || location.protocol === "data:" || location.hostname === "localhost") {
    var s = document.createElement("script"); s.src = "dev-content.js"; s.onerror = function () {}; document.head.appendChild(s);
  }
})();
