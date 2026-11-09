"use strict";
/* Reads a PowerPoint (.pptx) in the browser and turns it into a small JSON deck for the room module.
   No library: a .pptx is a zip of XML files. Staff-only: only the PK team uploads decks.
   Result: { deck: { meta, slides: [...] }, warnings: [...], tags: { activity: {name: [slide numbers]}, chart: {...} } } */
(function () {
  var NS = {
    a: "http://schemas.openxmlformats.org/drawingml/2006/main",
    p: "http://schemas.openxmlformats.org/presentationml/2006/main",
    r: "http://schemas.openxmlformats.org/officeDocument/2006/relationships",
    rel: "http://schemas.openxmlformats.org/package/2006/relationships"
  };

  // ---------- zip ----------
  async function inflateRaw(bytes) {
    var ds = new DecompressionStream("deflate-raw");
    var stream = new Blob([bytes]).stream().pipeThrough(ds);
    return new Uint8Array(await new Response(stream).arrayBuffer());
  }
  function readZip(buf) {
    var bytes = new Uint8Array(buf), dv = new DataView(buf), i;
    for (i = bytes.length - 22; i >= 0 && i > bytes.length - 70000; i--) if (dv.getUint32(i, true) === 0x06054b50) break;
    if (i < 0 || dv.getUint32(i, true) !== 0x06054b50) throw new Error("This file is not a PowerPoint (.pptx) file.");
    var count = dv.getUint16(i + 10, true), pos = dv.getUint32(i + 16, true), files = {}, dec = new TextDecoder();
    for (var n = 0; n < count; n++) {
      if (dv.getUint32(pos, true) !== 0x02014b50) throw new Error("The file looks damaged.");
      var method = dv.getUint16(pos + 10, true), csize = dv.getUint32(pos + 20, true), nlen = dv.getUint16(pos + 28, true),
        elen = dv.getUint16(pos + 30, true), clen = dv.getUint16(pos + 32, true), off = dv.getUint32(pos + 42, true);
      var name = dec.decode(bytes.subarray(pos + 46, pos + 46 + nlen));
      files[name] = { method: method, csize: csize, off: off };
      pos += 46 + nlen + elen + clen;
    }
    function read(name) {
      var f = files[name]; if (!f) return Promise.resolve(null);
      var lh = f.off, lnl = dv.getUint16(lh + 26, true), lel = dv.getUint16(lh + 28, true), start = lh + 30 + lnl + lel;
      var data = bytes.subarray(start, start + f.csize);
      if (f.method === 0) return Promise.resolve(data);
      if (f.method === 8) return inflateRaw(data);
      throw new Error("Unsupported zip method " + f.method);
    }
    return {
      has: function (n) { return !!files[n]; },
      names: function () { return Object.keys(files); },
      bytes: read,
      text: async function (n) { var b = await read(n); return b ? dec.decode(b) : null; }
    };
  }

  // ---------- xml helpers ----------
  function parseXml(text) {
    var d = new DOMParser().parseFromString(text, "application/xml");
    if (d.getElementsByTagName("parsererror").length) throw new Error("A slide could not be read.");
    return d;
  }
  function kids(n, ns, name) {
    var out = [];
    for (var c = n.firstElementChild; c; c = c.nextElementSibling) if (c.localName === name && (!ns || c.namespaceURI === NS[ns])) out.push(c);
    return out;
  }
  function kid(n, ns, name) { return kids(n, ns, name)[0] || null; }
  function allNs(n, ns, name) { return Array.prototype.slice.call(n.getElementsByTagNameNS(NS[ns], name)); }

  function xfrmOf(node) {
    var x = null, spPr = kid(node, "p", "spPr");
    if (spPr) x = kid(spPr, "a", "xfrm");
    if (!x) x = kid(node, "p", "xfrm");
    if (!x) return null;
    var off = kid(x, "a", "off"), ext = kid(x, "a", "ext");
    if (!off || !ext) return null;
    return { x: +off.getAttribute("x"), y: +off.getAttribute("y"), w: +ext.getAttribute("cx"), h: +ext.getAttribute("cy") };
  }
  function phOf(sp) {
    var nv = kid(sp, "p", "nvSpPr"), nvPr = nv && kid(nv, "p", "nvPr"), ph = nvPr && kid(nvPr, "p", "ph");
    return ph ? (ph.getAttribute("type") || "body") : null;
  }
  function paragraphsOf(txBody) {
    var out = [];
    kids(txBody, "a", "p").forEach(function (p) {
      var runs = [], pPr = kid(p, "a", "pPr");
      for (var c = p.firstElementChild; c; c = c.nextElementSibling) {
        if (c.localName === "r" || c.localName === "fld") {
          var t = kid(c, "a", "t"), txt = t ? t.textContent : "";
          if (!txt) continue;
          var rPr = kid(c, "a", "rPr"), f = 0;
          if (rPr) { if (rPr.getAttribute("b") === "1") f |= 1; if (rPr.getAttribute("i") === "1") f |= 2; }
          var last = runs[runs.length - 1];
          if (last && last[1] === f) last[0] += txt; else runs.push([txt, f]);
        } else if (c.localName === "br") {
          runs.push(["\n", 0]);
        }
      }
      if (!runs.length || !runs.some(function (r) { return r[0].trim(); })) return;
      var bullet = !!(pPr && (kid(pPr, "a", "buChar") || kid(pPr, "a", "buAutoNum")));
      out.push({ t: "p", runs: runs, bullet: bullet, lvl: pPr ? (+pPr.getAttribute("lvl") || 0) : 0 });
    });
    return out;
  }
  function plain(par) { return par.runs.map(function (r) { return r[0]; }).join(""); }

  // ---------- notes and tags ----------
  var TAG_RE = /\[\[\s*([A-Za-z-]+)\s*(?::\s*([^\]]*?))?\s*\]\]/g;
  function readTags(text) {
    var res = { activities: [], charts: [], noteColors: [], teamOnly: false, unknown: [] };
    var m; TAG_RE.lastIndex = 0;
    while ((m = TAG_RE.exec(text))) {
      var kind = m[1].toLowerCase(), body = (m[2] || "").trim();
      if (kind === "activity") {
        var parts = body.split(/\s+/).filter(Boolean), name = parts.shift(), attrs = {};
        parts.forEach(function (kv) { var q = kv.split("="); if (q[0]) attrs[q[0]] = q.slice(1).join("="); });
        if (name) res.activities.push({ name: name, attrs: attrs });
      } else if (kind === "chart") { if (body) res.charts.push(body.split(/\s+/)[0]); }
      else if (kind === "notes") { body.split(/\s+/).filter(Boolean).forEach(function (c) { if (res.noteColors.indexOf(c) < 0) res.noteColors.push(c); }); }
      else if (kind === "team-only") res.teamOnly = true;
      else res.unknown.push(m[0]);
    }
    return res;
  }

  // ---------- layout: turn positioned shapes into a reading flow ----------
  var ROW_TOL = 160000;
  function inside(inner, outer) {
    var cx = inner.x + inner.w / 2, cy = inner.y + inner.h / 2;
    return cx >= outer.x && cx <= outer.x + outer.w && cy >= outer.y && cy <= outer.y + outer.h;
  }
  function flow(entries) {
    // entries: {t:'text'|'table'|'img'|'card', x,y,w,h, items}
    entries.sort(function (p, q) { return p.y - q.y || p.x - q.x; });
    // join a lone number ("1", "2" ...) to the text beside it: a numbered step
    var used = new Set(), steps = [];
    entries.forEach(function (e, i) {
      if (e.t !== "text" || used.has(i)) return;
      if (e.items.length === 1 && /^\d{1,2}$/.test(plain(e.items[0]).trim()) && e.w <= 650000) {
        var best = -1;
        entries.forEach(function (o, j) {
          if (j === i || used.has(j) || o.t !== "text" || o === e) return;
          if (Math.abs(o.y - e.y) <= 230000 && o.x > e.x && (best < 0 || o.x < entries[best].x)) best = j;
        });
        if (best >= 0) { used.add(i); used.add(best); entries[best].num = plain(e.items[0]).trim(); entries[best].stepOf = true; entries[best].y = e.y; }
      }
    });
    var list = entries.filter(function (e, i) { return !used.has(i) || e.stepOf; });
    list.sort(function (p, q) { return p.y - q.y || p.x - q.x; });
    var rows = [];
    list.forEach(function (e) {
      var row = rows[rows.length - 1];
      if (row && Math.abs(e.y - row[0].y) <= ROW_TOL && !e.stepOf && !row[0].stepOf) row.push(e); else rows.push([e]);
    });
    var out = [];
    rows.forEach(function (row) {
      if (row.length === 1) {
        var e = row[0];
        if (e.stepOf) {
          var last = out[out.length - 1];
          var step = { n: e.num, items: e.items };
          if (last && last.t === "steps") last.items.push(step); else out.push({ t: "steps", items: [step] });
        } else if (e.t === "text") e.items.forEach(function (it) { out.push(it); });
        else out.push(entryItem(e));
      } else {
        out.push({ t: "row", cols: row.map(function (e) { return { w: Math.max(1, Math.round(e.w / 10000)), items: e.t === "text" ? e.items : [entryItem(e)] }; }) });
      }
    });
    return out;
  }
  function entryItem(e) {
    if (e.t === "card") return { t: "card", items: e.items };
    if (e.t === "table") return { t: "table", rows: e.rows };
    if (e.t === "img") return { t: "img", src: e.src, alt: e.alt || "" };
    return { t: "card", items: e.items };
  }

  // ---------- images ----------
  async function shrinkImage(bytes, type) {
    try {
      var blob = new Blob([bytes], { type: type });
      if (bytes.length < 350000 && (type === "image/jpeg" || type === "image/png")) return await toDataUrl(blob);
      var bmp = await createImageBitmap(blob), max = 1280, k = Math.min(1, max / bmp.width);
      var cv = document.createElement("canvas"); cv.width = Math.round(bmp.width * k); cv.height = Math.round(bmp.height * k);
      cv.getContext("2d").drawImage(bmp, 0, 0, cv.width, cv.height);
      return cv.toDataURL(type === "image/png" ? "image/png" : "image/jpeg", 0.82);
    } catch (e) { return null; }
  }
  function toDataUrl(blob) {
    return new Promise(function (res, rej) { var fr = new FileReader(); fr.onload = function () { res(fr.result); }; fr.onerror = rej; fr.readAsDataURL(blob); });
  }
  var MIME = { png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", gif: "image/gif", webp: "image/webp" };

  function relsOf(text) {
    var map = {};
    if (!text) return map;
    allNs(parseXml(text), "rel", "Relationship").forEach(function (r) { map[r.getAttribute("Id")] = { type: r.getAttribute("Type"), target: r.getAttribute("Target") }; });
    return map;
  }
  function resolve(base, target) {
    if (target.charAt(0) === "/") return target.slice(1);
    var parts = base.split("/"); parts.pop();
    target.split("/").forEach(function (seg) { if (seg === "..") parts.pop(); else if (seg !== ".") parts.push(seg); });
    return parts.join("/");
  }

  // ---------- one slide ----------
  async function readSlide(zip, path, index, sldId, slideSize, warnings) {
    var n = index + 1;
    var doc = parseXml(await zip.text(path));
    var root = doc.documentElement;
    if (root.getAttribute("show") === "0") { warnings.push("Slide " + n + " is hidden in PowerPoint, so it was skipped."); return null; }
    var rels = relsOf(await zip.text(path.replace("slides/", "slides/_rels/") + ".rels"));
    var cSld = kid(root, "p", "cSld"), tree = cSld && kid(cSld, "p", "spTree");
    var titleParas = [], texts = [], boxes = [], tables = [], pics = [], flags = { group: false, graphic: false };
    var lastY = 0;

    async function walk(container) {
      for (var node = container.firstElementChild; node; node = node.nextElementSibling) {
        var nm = node.localName;
        if (nm === "sp") {
          var ph = phOf(node), pos = xfrmOf(node), tx = kid(node, "p", "txBody");
          var pars = tx ? paragraphsOf(tx) : [];
          if (!pos) pos = { x: 0, y: ph === "title" || ph === "ctrTitle" ? 0 : lastY + 1, w: 10000000, h: 300000 };
          lastY = Math.max(lastY, pos.y);
          if (ph === "title" || ph === "ctrTitle") { if (pars.length) titleParas = pars; continue; }
          if (ph === "sldNum" || ph === "dt" || ph === "ftr") continue;
          if (pars.length) texts.push({ t: "text", x: pos.x, y: pos.y, w: pos.w, h: pos.h, items: pars });
          else {
            var spPr = kid(node, "p", "spPr");
            if (spPr && kid(spPr, "a", "solidFill") && pos.w >= 500000 && pos.h >= 300000) boxes.push({ t: "card", x: pos.x, y: pos.y, w: pos.w, h: pos.h, items: [] });
          }
        } else if (nm === "graphicFrame") {
          var gp = xfrmOf(node) || { x: 0, y: lastY + 1, w: 10000000, h: 300000 }, tbl = allNs(node, "a", "tbl")[0];
          if (tbl) {
            var rows = kids(tbl, "a", "tr").map(function (tr) {
              return kids(tr, "a", "tc").map(function (tc) {
                var tb = kid(tc, "a", "txBody"), ps = tb ? paragraphsOf(tb) : [], runs = [];
                ps.forEach(function (p, i) { if (i) runs.push([" ", 0]); p.runs.forEach(function (r) { runs.push(r); }); });
                return runs;
              });
            });
            tables.push({ t: "table", x: gp.x, y: gp.y, w: gp.w, h: gp.h, rows: rows });
          } else flags.graphic = true;
        } else if (nm === "pic") {
          var pp = xfrmOf(node) || { x: 0, y: lastY + 1, w: 5000000, h: 3000000 }, blip = allNs(node, "a", "blip")[0];
          var rid = blip && blip.getAttributeNS(NS.r, "embed"), rel = rid && rels[rid];
          if (rel) {
            var mpath = resolve(path, rel.target), ext = mpath.split(".").pop().toLowerCase(), data = await zip.bytes(mpath);
            var src = data && MIME[ext] ? await shrinkImage(data, MIME[ext]) : null;
            if (src) { var cNv = allNs(node, "p", "cNvPr")[0]; pics.push({ t: "img", x: pp.x, y: pp.y, w: pp.w, h: pp.h, src: src, alt: (cNv && cNv.getAttribute("descr")) || "" }); }
            else warnings.push("Slide " + n + ": a picture could not be read (" + ext + ").");
          }
        } else if (nm === "grpSp") {
          flags.group = true; await walk(node);
        }
      }
    }
    if (tree) await walk(tree);

    var H = slideSize.cy, kicker = null, footer = null, body = [];
    texts.sort(function (p, q) { return p.y - q.y || p.x - q.x; });
    var rest = [];
    texts.forEach(function (e) {
      if (!kicker && e.y <= H * 0.135 && e.items.length === 1) { kicker = e.items[0]; return; }
      if (e.y >= H * 0.9 && e.items.length === 1) { footer = e.items[0]; return; }
      rest.push(e);
    });
    // cards: put each text (and table or picture) into the smallest card that contains it
    var cards = boxes.filter(function (b) { return !boxes.some(function (o) { return o !== b && o.w * o.h > b.w * b.h && inside(b, o); }); });
    var loose = [];
    rest.concat(tables, pics).forEach(function (e) {
      var host = null;
      cards.forEach(function (c) { if (inside(e, c) && (!host || c.w * c.h < host.w * host.h)) host = c; });
      if (host) (host.children = host.children || []).push(e); else loose.push(e);
    });
    var top = loose.slice();
    cards.forEach(function (c) {
      if (c.children && c.children.length) { c.items = flow(c.children); top.push(c); }
    });
    body = flow(top);

    var title = titleParas.length ? titleParas.map(plain).join(" ").replace(/\s+/g, " ").trim() : "";
    if (!title) {
      var firstP = null;
      for (var i = 0; i < body.length && !firstP; i++) if (body[i].t === "p") firstP = body[i];
      if (firstP) { title = plain(firstP); body.splice(body.indexOf(firstP), 1); }
    }
    if (flags.graphic) warnings.push("Slide " + n + " (" + (title || "no title") + ") has a chart or diagram that cannot be shown. Replace it with a table or a picture.");
    if (flags.group) warnings.push("Slide " + n + " (" + (title || "no title") + ") has grouped shapes. Check the preview; they may look different.");

    // speaker notes and tags
    var notes = [], tags = { activities: [], charts: [], noteColors: [], teamOnly: false, unknown: [] };
    var nrel = Object.keys(rels).map(function (k) { return rels[k]; }).filter(function (r) { return /notesSlide$/.test(r.type); })[0];
    if (nrel) {
      var ntext = await zip.text(resolve(path, nrel.target));
      if (ntext) {
        var ndoc = parseXml(ntext), all = "";
        allNs(ndoc, "p", "sp").forEach(function (sp) {
          if (phOf(sp) !== "body") return;
          var tx = kid(sp, "p", "txBody"); if (!tx) return;
          kids(tx, "a", "p").forEach(function (p) {
            var line = allNs(p, "a", "t").map(function (t) { return t.textContent; }).join("");
            all += line + "\n";
            if (/^\s*TAGS:/i.test(line)) return;
            var clean = line.replace(TAG_RE, "").trim();
            if (clean) notes.push(clean);
          });
        });
        tags = readTags(all);
      }
    }
    var slide = { id: "s" + sldId, n: n, title: title, body: body };
    if (kicker) slide.kicker = plain(kicker).trim();
    if (footer) slide.footer = plain(footer).trim();
    if (notes.length) slide.notes = notes;
    if (tags.activities.length) slide.activities = tags.activities;
    if (tags.charts.length) slide.charts = tags.charts;
    if (tags.noteColors.length) slide.noteColors = tags.noteColors;
    if (tags.teamOnly) slide.teamOnly = true;
    tags.unknown.forEach(function (u) { warnings.push("Slide " + n + ": tag " + u + " is not one I know. It was ignored."); });
    return slide;
  }

  // ---------- the whole deck ----------
  async function parse(buf, fileName) {
    var zip = readZip(buf), warnings = [];
    var pres = await zip.text("ppt/presentation.xml");
    if (!pres) throw new Error("This does not look like a PowerPoint deck.");
    var pdoc = parseXml(pres), size = allNs(pdoc, "p", "sldSz")[0];
    var slideSize = size ? { cx: +size.getAttribute("cx"), cy: +size.getAttribute("cy") } : { cx: 12192000, cy: 6858000 };
    var rels = relsOf(await zip.text("ppt/_rels/presentation.xml.rels"));
    var ids = allNs(pdoc, "p", "sldId"), slides = [], tagMap = { activity: {}, chart: {} };
    for (var i = 0; i < ids.length; i++) {
      var rid = ids[i].getAttributeNS(NS.r, "id"), rel = rels[rid];
      if (!rel) continue;
      var s = await readSlide(zip, resolve("ppt/presentation.xml", rel.target), i, ids[i].getAttribute("id"), slideSize, warnings);
      if (!s) continue;
      (s.activities || []).forEach(function (a) { (tagMap.activity[a.name] = tagMap.activity[a.name] || []).push(s.n); });
      (s.charts || []).forEach(function (c) { (tagMap.chart[c] = tagMap.chart[c] || []).push(s.n); });
      slides.push(s);
    }
    if (!slides.length) throw new Error("No slides were found in this file.");
    return {
      deck: { meta: { source: fileName || "", parsed_at: new Date().toISOString(), slides: slides.length }, slides: slides },
      warnings: warnings, tags: tagMap
    };
  }

  window.PKPptx = { parse: parse };
})();
