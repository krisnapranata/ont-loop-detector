// Menu GenieACS: meniru UI GenieACS dengan merender konfigurasi ui.* milik server GenieACS sendiri.
(() => {
  "use strict";
  const { $, esc, call, json, toast, ask, form } = UI;
  const X = AcsExpr;
  const BASE = location.origin + location.pathname.replace(/[^/]*$/, "");
  const enc = encodeURIComponent;
  const get = (p) => call("acs/" + p);
  const post = (p, body) => call("acs/" + p, json("POST", body));
  const qs = (o) => Object.entries(o).filter(([, v]) => v !== undefined && v !== "").map(([k, v]) => `${k}=${enc(v)}`).join("&");
  const sorted = (o) => Object.keys(o || {}).sort((a, b) => a.localeCompare(b, "en", { numeric: true })).map((k) => o[k]);
  const svg = (d) => `<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${d}</svg>`;
  const ICON = {
    refresh: svg('<path d="M20 12a8 8 0 1 1-2.4-5.7"/><path d="M20 4v5h-5"/>'),
    power: svg('<path d="M12 3v9"/><path d="M6.3 6.3a8 8 0 1 0 11.4 0"/>'),
    more: svg('<circle cx="5" cy="12" r="1.2"/><circle cx="12" cy="12" r="1.2"/><circle cx="19" cy="12" r="1.2"/>'),
    back: svg('<path d="M15 6l-6 6 6 6"/>'),
    plus: svg('<path d="M12 5v14M5 12h14"/>'),
    trash: svg('<path d="M4 7h16"/><path d="M10 11v6M14 11v6"/><path d="M6 7l1 13h10l1-13"/><path d="M9 7V4h6v3"/>'),
    up: svg('<path d="M12 20V9"/><path d="m7 14 5-5 5 5"/><path d="M5 4h14"/>'),
    down: svg('<path d="M12 4v11"/><path d="m7 10 5 5 5-5"/><path d="M5 20h14"/>'),
    reset: svg('<path d="M3 12a9 9 0 1 0 3-6.7"/><path d="M3 4v5h5"/>'),
    x: svg('<path d="M6 6l12 12M18 6 6 18"/>'),
    wifi: svg('<path d="M2 8.5a15 15 0 0 1 20 0"/><path d="M5 12a10.5 10.5 0 0 1 14 0"/><path d="M8.5 15.5a5.5 5.5 0 0 1 7 0"/><circle cx="12" cy="19" r="1"/>'),
    globe: svg('<circle cx="12" cy="12" r="9"/><path d="M3 12h18"/><path d="M12 3a14 14 0 0 1 0 18a14 14 0 0 1 0-18Z"/>'),
    users: svg('<circle cx="9" cy="8" r="3.5"/><path d="M2.5 20a6.5 6.5 0 0 1 13 0"/><path d="M16 4.5a3.5 3.5 0 0 1 0 7"/><path d="M18 14a6 6 0 0 1 3.5 6"/>'),
    shield: svg('<path d="M12 3 4 6v6c0 4.5 3.4 8.3 8 9 4.6-.7 8-4.5 8-9V6l-8-3Z"/><path d="m9 12 2 2 4-4"/>'),
    alert: svg('<path d="M12 3 2 20h20L12 3Z"/><path d="M12 10v4"/><circle cx="12" cy="17" r=".6"/>'),
    list: svg('<path d="M9 6h11M9 12h11M9 18h11"/><circle cx="4.5" cy="6" r="1"/><circle cx="4.5" cy="12" r="1"/><circle cx="4.5" cy="18" r="1"/>'),
    info: svg('<circle cx="12" cy="12" r="9"/><path d="M12 11v6"/><circle cx="12" cy="7.5" r=".6"/>'),
    cpu: svg('<rect x="6" y="6" width="12" height="12" rx="2"/><path d="M9 2v4M15 2v4M9 18v4M15 18v4M2 9h4M2 15h4M18 9h4M18 15h4"/>'),
    signal: svg('<path d="M4 20v-3M9 20v-7M14 20V9M19 20V4"/>'),
    thermo: svg('<path d="M14 14.8V4a2 2 0 1 0-4 0v10.8a4 4 0 1 0 4 0Z"/>'),
    clock: svg('<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>'),
    link: svg('<path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1"/><path d="M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1"/>'),
    user: svg('<circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/>'),
    tag: svg('<path d="M3 12V4a1 1 0 0 1 1-1h8l9 9-9 9-9-9Z"/><circle cx="8" cy="8" r="1.5"/>'),
    pencil: svg('<path d="M4 20h4L19 9l-4-4L4 16v4Z"/><path d="m13.5 6.5 4 4"/>'),
    pin: svg('<path d="M12 21s-7-6.2-7-11a7 7 0 1 1 14 0c0 4.8-7 11-7 11Z"/><circle cx="12" cy="10" r="2.5"/>'),
  };
  // Warna serat optik (TIA-598): dipakai untuk membedakan lokasi
  const FIBERS = ["--f-blue", "--f-orange", "--f-green", "--f-brown", "--f-slate", "--f-red", "--f-yellow", "--f-violet", "--f-rose", "--f-aqua"];
  const calm = matchMedia("(prefers-reduced-motion: reduce)").matches;
  function countUp(el, target) {
    if (!el) return;
    if (calm || !target) { el.textContent = target; return; }
    const t0 = performance.now(), dur = 900;
    const step = (t) => { const k = Math.min(1, (t - t0) / dur); el.textContent = Math.round(target * (1 - (1 - k) ** 3)); if (k < 1) requestAnimationFrame(step); };
    requestAnimationFrame(step);
  }
  const SECRET = /password|passphrase|presharedkey|psk|secret/i;
  const WPA_PASS = /KeyPassphrase$/i;
  const SAFE_COLOR = /^(#[0-9a-f]{3,8}|[a-z]{3,20})$/i;
  const colorOf = (c) => (SAFE_COLOR.test(c || "") ? c : "#888");
  let CONF = null, DEV = null, apSearch = "";
  document.body.appendChild($("bulk"));
  const pendBarEl = Object.assign(document.createElement("div"), { id: "pendBar", className: "bulkbar pendbar", hidden: true });
  pendBarEl.setAttribute("role", "region");
  pendBarEl.setAttribute("aria-label", "Perubahan yang menunggu dikirim");
  document.body.appendChild(pendBarEl);

  // ------------------------------------------------------------------ dokumen perangkat
  const entry = (doc, p) => (doc && Object.prototype.hasOwnProperty.call(doc, p) ? doc[p] : undefined);
  const val = (doc, p) => { const x = entry(doc, p); return x && Array.isArray(x.value) ? x.value[0] : null; };
  const getter = (doc, prefix) => (name) => {
    if (prefix) { const v = val(doc, `${prefix}.${name}`); if (v != null) return v; }
    return val(doc, name);
  };
  const fmt = (v, t) => {
    if (v == null) return "";
    if (t === "xsd:dateTime" && typeof v === "number") return new Date(v).toLocaleString("id-ID");
    return String(v);
  };
  // Daftar interface (LAN BIND / LANInterface) ditampilkan ringkas: "LAN 1, LAN 2, WLAN 1"
  const IFACE = /^(?:(?:InternetGatewayDevice|Device)\.LANDevice\.\d+\.(LANEthernetInterfaceConfig|WLANConfiguration)|Device\.(Ethernet\.Interface|WiFi\.SSID))\.(\d+)\.?$/;
  const ifaceLabel = (p) => {
    const m = String(p).trim().match(IFACE);
    if (!m) return null;
    return (m[1] === "LANEthernetInterfaceConfig" || m[2] === "Ethernet.Interface" ? "LAN " : "WLAN ") + m[3];
  };
  const shortIfaces = (v) => {
    if (typeof v !== "string" || !v.includes(".")) return null;
    const labels = v.split(",").filter((x) => x.trim()).map(ifaceLabel);
    return labels.length && labels.every(Boolean) ? labels.join(", ") : null;
  };
  // Path ke koneksi WAN (mis. WANInterface di PortBinding ZTE) ditampilkan sebagai nama koneksinya:
  // "HOTSPOT · WAN IP 1.3 · VLAN 200"
  const WANPATH = /^InternetGatewayDevice\.WANDevice\.\d+\.WANConnectionDevice\.(\d+)\.(WANPPPConnection|WANIPConnection)\.(\d+)\.?$/;
  function wanLabel(doc, p) {
    const m = String(p ?? "").trim().match(WANPATH);
    if (!m) return null;
    const base = p.trim().replace(/\.$/, "");
    const name = val(doc, `${base}.Name`);
    const vk = Object.keys(doc || {}).find((k) => k.startsWith(base + ".") && /vlan_?id$|\.X_[\w-]*VLAN$/i.test(k) && val(doc, k) != null && val(doc, k) !== "");
    return `${name || "tanpa nama"} · ${m[2] === "WANPPPConnection" ? "WAN PPP" : "WAN IP"} ${m[1]}.${m[3]}${vk ? ` · VLAN ${val(doc, vk)}` : ""}`;
  }
  const wanConnections = (doc) => Object.keys(doc || {}).filter((k) => WANPATH.test(k) && doc[k]?.object)
    .sort((a, b) => a.localeCompare(b, "en", { numeric: true }));
  const tagsOf = (doc) => Object.keys(doc || {}).filter((k) => k.startsWith("Tags.")).map((k) => k.slice(5));
  const instances = (doc, base) => Object.keys(doc || {})
    .filter((k) => k.startsWith(base + ".") && /^\d+$/.test(k.slice(base.length + 1)))
    .sort((a, b) => +a.slice(base.length + 1) - +b.slice(base.length + 1));
  // sama dengan holds_mgmt di server: objek yang memuat koneksi manajemen TR069 tidak boleh dihapus
  function holdsMgmt(doc, obj) {
    const prefix = obj + ".", ip = String(val(doc, "VirtualParameters.IPTR069") ?? "");
    return Object.keys(doc).some((k) => {
      if (!k.startsWith(prefix)) return false;
      const tail = k.split(".").pop().toLowerCase(), v = String(val(doc, k) ?? "");
      return ((tail === "name" || tail.endsWith("servicelist")) && v.toUpperCase().includes("TR069")) || (tail === "externalipaddress" && ip && v === ip);
    });
  }
  const delBtn = (doc, path, cls) => holdsMgmt(doc, path)
    ? '<span class="flag" title="Koneksi manajemen TR069 tidak bisa dihapus dari sini">TR069</span>'
    : cls ? `<button type="button" class="btn small danger" data-delobj="${esc(path)}">Hapus</button>`
    : `<button type="button" class="ic danger" data-delobj="${esc(path)}" title="Hapus instance ini" aria-label="Hapus ${esc(path)}">✕</button>`;
  const labelOf = (l, ctx) => (Array.isArray(l) ? X.evaluate(l, getter(ctx.doc, ctx.prefix)) ?? "" : l ?? "");

  // ------------------------------------------------------------------ komponen tampilan GenieACS
  function paramHtml(expr, ctx) {
    if (expr === undefined) return "";
    if (Array.isArray(expr) && expr[0] === "PARAM" && typeof expr[1] === "string") {
      const full = ctx.prefix ? `${ctx.prefix}.${expr[1]}` : expr[1];
      const x = entry(ctx.doc, full);
      const v = x?.value?.[0];
      const title = x?.valueTimestamp ? `Dibaca ${new Date(x.valueTimestamp).toLocaleString("id-ID")}` : "Belum dibaca dari ONT";
      const edit = x?.writable && !x?.object && !ctx.ro
        ? `<button type="button" class="ic" data-edit="${esc(full)}" title="Ubah nilai" aria-label="Ubah ${esc(full)}">✎</button>` : "";
      // sebagian firmware tidak pernah mengirim password lewat TR-069: tampilkan keterangan, bukan sel kosong
      if (v === "" && SECRET.test(full.split(".").pop()))
        return `<span class="pv secret-empty" title="ONT mengirim nilai kosong. Password lama tidak bisa dibaca dari ONT ini; ganti lewat ✎.">tidak dikirim ONT</span>${edit}`;
      const pend = ctx.id ? pendingOf(ctx.id).get(full) : null;
      if (pend) return `<span class="pv pending" title="Menunggu dikirim (nilai di ONT: ${esc(fmt(v, x?.value?.[1]))})">${esc(WPA_PASS.test(full) ? "••••" : shortIfaces(String(pend[1])) ?? wanLabel(ctx.doc, pend[1]) ?? fmt(pend[1]))}</span>${edit}`;
      const short = shortIfaces(v) ?? wanLabel(ctx.doc, v);
      return `<span class="pv${v == null ? " none" : ""}" title="${esc(short ? `${v}\n${title}` : title)}">${esc(short ?? fmt(v, x?.value?.[1]))}</span>${edit}`;
    }
    if (!Array.isArray(expr)) return `<span class="pv">${esc(expr ?? "")}</span>`;
    return `<span class="pv">${esc(X.evaluate(expr, getter(ctx.doc, ctx.prefix)) ?? "")}</span>`;
  }

  function wrap(el, inner, ctx) {
    if (!el) return inner;
    let tag = "span", cls = [], attrs = "";
    if (typeof el === "string") {
      const [t, ...c] = el.split(".");
      tag = t || "div";
      cls = c;
    } else {
      tag = el.tag || "span";
      for (const [k, expr] of Object.entries(el.attributes || {})) {
        if (!/^[a-z][a-z-]*$/i.test(k) || /^on/i.test(k) || k === "style") continue;
        let s = X.evaluate(expr, getter(ctx.doc, ctx.prefix));
        if (s == null) continue;
        s = String(s);
        if ((k === "href" || k === "src") && !/^https?:\/\//i.test(s)) continue;
        attrs += ` ${k}="${esc(s)}"`;
      }
      if (tag === "a") attrs += ' rel="noopener noreferrer"';
    }
    if (!/^(span|div|a|h2|h3|h4|p|b|strong|em|small|code)$/.test(tag)) tag = "span";
    if (/^h[234]$/.test(tag)) { tag = "h3"; cls.push("sec"); }
    const c = cls.map((x) => "acs-" + x.replace(/[^\w-]/g, "")).join(" ");
    return `<${tag}${c ? ` class="${c}"` : ""}${attrs}>${inner}</${tag}>`;
  }

  const comps = (list, ctx) => (Array.isArray(list) ? list : sorted(list)).map((c) => comp(c, ctx)).join("");

  function comp(c, ctx) {
    if (c == null) return "";
    if (typeof c !== "object" || Array.isArray(c)) return paramHtml(c, ctx);
    if ("filter" in c && !X.truthy(X.evaluate(c.filter, getter(ctx.doc, ctx.prefix)))) return "";
    const sub = { ...ctx };
    if (c.parameter !== undefined) sub.param = c.parameter;
    if (c.writable === false) sub.ro = true;
    switch (c.type || "container") {
      case "container": {
        const kids = c.components ? comps(c.components, sub) : c.parameter !== undefined ? paramHtml(c.parameter, sub) : "";
        return wrap(c.element, kids, sub);
      }
      case "parameter": return paramHtml(c.parameter ?? ctx.param, sub);
      case "parameter-list": return plist(c, sub);
      case "parameter-table": return ptable(c, sub);
      case "summon-button": return summonBtn(c, sub);
      case "overview-dot": return dot(c.chart, sub);
      case "tags": return tagsHtml(sub, c.writable !== false && !ctx.ro);
      case "ping": return ctx.hero ? "" : pingHtml(sub);
      case "device-faults": return '<div class="dev-faults" data-faults><p class="empty">Membaca faults…</p></div>';
      case "all-parameters": return allParamsShell();
      case "device-actions": return ctx.hero ? "" : actionsHtml();
      case "device-link": {
        // nilai kosong tetap harus bisa diklik: pakai serial atau ID perangkat sebagai teks cadangan
        const v = c.parameter !== undefined ? X.evaluate(c.parameter, getter(ctx.doc, ctx.prefix)) : null;
        const inner = v == null || v === "" ? `<span class="pv">${esc(val(ctx.doc, "DeviceID.SerialNumber") || ctx.id)}</span>`
          : c.components ? comps(c.components, { ...sub, ro: true }) : paramHtml(c.parameter, { ...sub, ro: true });
        return `<a class="link" href="#device/${enc(ctx.id)}">${inner}</a>`;
      }
      default: return "";
    }
  }

  function plist(c, ctx) {
    // daftar berisi satu baris "judul + Summon" (pola umum di config GenieACS) -> subjudul
    const items = sorted(c.parameters);
    if (items.length === 1 && items[0] && typeof items[0] === "object" && !Array.isArray(items[0]) && items[0].parameter === undefined
      && items[0].components && sorted(items[0].components).every((x) => x?.type === "summon-button")
      && (!("filter" in items[0]) || X.truthy(X.evaluate(items[0].filter, getter(ctx.doc, ctx.prefix))))) {
      return `<div class="subhead"><h4>${esc(labelOf(items[0].label, ctx))}</h4>${comps(items[0].components, ctx)}</div>`;
    }
    const rows = sorted(c.parameters).map((p) => {
      if (Array.isArray(p)) {
        const label = p[0] === "PARAM" ? p[1] : X.stringify(p);
        return `<tr><th>${esc(label)}</th><td>${paramHtml(p, ctx)}</td></tr>`;
      }
      if (!p || typeof p !== "object") return "";
      if ("filter" in p && !X.truthy(X.evaluate(p.filter, getter(ctx.doc, ctx.prefix)))) return "";
      const { filter, label, ...rest } = p;
      return `<tr><th>${esc(labelOf(label, ctx))}</th><td>${comp({ ...rest, type: rest.type || "container" }, ctx)}</td></tr>`;
    }).join("");
    return rows ? `<table class="plist">${rows}</table>` : "";
  }

  function ptable(c, ctx) {
    const base = Array.isArray(c.parameter) && c.parameter[0] === "PARAM" ? c.parameter[1] : "";
    if (!base) return "";
    const cols = sorted(c.childParameters);
    const colDefs = cols.map((x) => [String(labelOf(x.label, ctx) || ""), Array.isArray(x.parameter) && x.parameter[0] === "PARAM" ? x.parameter[1] : ""]).filter(([, r]) => r);
    const node = entry(ctx.doc, base);
    const inst = instances(ctx.doc, base);
    const head = cols.map((x) => `<th>${esc(labelOf(x.label, ctx))}</th>`).join("") + "<th></th>";
    const body = inst.map((i) => {
      const cells = cols.map((x) => `<td>${paramHtml(x.parameter, { ...ctx, prefix: i })}</td>`).join("");
      const del = ctx.doc[i]?.writable && !ctx.ro ? delBtn(ctx.doc, i) : "";
      const nw = colDefs.filter(([, rel]) => ctx.doc[`${i}.${rel}`]?.writable && !ctx.doc[`${i}.${rel}`]?.object).length;
      const rowEdit = nw >= 2 && !ctx.ro ? `<button type="button" class="ic row-edit" data-editrow="${esc(i)}" data-cols="${esc(JSON.stringify(colDefs))}" title="Ubah beberapa kolom baris ini sekaligus" aria-label="Ubah baris ${esc(i)}">${ICON.pencil}</button>` : "";
      return `<tr><td class="inst" title="${esc(i)}">${esc(i.slice(base.length + 1))}</td>${cells}<td class="nowrap row-acts">${rowEdit}${del}</td></tr>`;
    }).join("");
    const empty = node ? "Belum ada instance." : "Belum terbaca dari ONT. Tekan Summon atau Ambil ulang.";
    const add = node?.writable && !ctx.ro ? `<button type="button" class="btn small" data-addobj="${esc(base)}">Tambah instance</button>` : "";
    return `<div class="ptable" title="${esc(base)}"><div class="xscroll"><table class="rows"><thead><tr><th>#</th>${head}</tr></thead>
      <tbody>${body || `<tr><td colspan="${cols.length + 2}" class="empty">${empty}</td></tr>`}</tbody></table></div>
      <div class="ptable-foot">${add}
      <button type="button" class="btn small" data-refresh="${esc(base)}" data-obj="1">Ambil ulang</button></div></div>`;
  }

  function summonBtn(c, ctx) {
    const names = sorted(c.parameters).map((p) => (Array.isArray(p) && p[0] === "PARAM" ? p[1] : null)).filter(Boolean);
    return `<button type="button" class="btn-chip summon" data-summon="${esc(JSON.stringify(names))}" data-id="${esc(ctx.id)}" title="Minta ONT mengirim nilai terbaru">${ICON.refresh}<span>Summon</span></button>`;
  }

  function dot(chartName, ctx) {
    const ch = CONF?.ui?.overview?.charts?.[chartName];
    if (!ch) return "";
    for (const s of sorted(ch.slices)) {
      if (X.truthy(X.evaluate(s.filter, getter(ctx.doc)))) {
        const l = labelOf(s.label, ctx);
        const live = /online|hidup|aktif|up\b/i.test(String(l)) ? " pulse" : "";
        return `<span class="odot led${live}" style="--c:${colorOf(s.color)}" title="${esc(l)}"><span class="sr">${esc(l)}</span></span>`;
      }
    }
    return "";
  }

  function tagsHtml(ctx, editable) {
    const tags = tagsOf(ctx.doc).map((t) => `<span class="flag">${esc(t)}${editable
      ? ` <button type="button" class="x" data-tag-del="${esc(t)}" data-id="${esc(ctx.id)}" aria-label="Hapus tag ${esc(t)}">×</button>` : ""}</span>`).join("");
    return `<span class="tagbox">${tags}${editable ? `<button type="button" class="ic" data-tag-add data-id="${esc(ctx.id)}" title="Tambah tag" aria-label="Tambah tag">+</button>` : ""}</span>`;
  }

  function pingHost(doc) {
    const url = val(doc, "InternetGatewayDevice.ManagementServer.ConnectionRequestURL") || val(doc, "Device.ManagementServer.ConnectionRequestURL");
    try { return url ? new URL(url).hostname : ""; } catch { return ""; }
  }
  function pingHtml(ctx) {
    const host = pingHost(ctx.doc);
    if (!host) return '<p class="hint">Ping: alamat connection request belum terbaca.</p>';
    return `<div class="ping" data-ping="${esc(host)}"><span class="hint">Ping ${esc(host)}:</span> <span class="ping-out">…</span>
      <button type="button" class="btn small" data-ping-run>Ping lagi</button></div>`;
  }

  const actionsHtml = () => `<div class="dev-actions">
      <button type="button" class="btn" data-act="reboot">Reboot</button>
      <button type="button" class="btn danger" data-act="factoryReset">Reset pabrik</button>
      <button type="button" class="btn" data-act="download">Push file</button>
      <button type="button" class="btn" data-act="refreshAll">Ambil ulang semua</button>
      <button type="button" class="btn danger" data-act="delete">Hapus perangkat</button></div>`;

  // ------------------------------------------------------------------ tugas ke ONT
  async function runTasks(id, tasks, what, quiet = false) {
    const d = await post("tasks", { id, tasks });
    const st = (d.tasks || []).map((t) => t.status);
    let ok = true, msg;
    if (st.length && st.every((s) => s === "done")) msg = `${what}: selesai.`;
    else if (st.includes("fault")) { ok = false; msg = `${what}: ${await faultText(id, d.tasks.find((t) => t.status === "fault")?._id)}`; }
    else { ok = false; msg = `${what}: ONT belum menjawab (${d.connectionRequest || "tanpa jawaban"}). Tugas menunggu ONT terhubung lagi.`; }
    if (!quiet) toast(msg, ok);
    return { ok, msg, fault: st.includes("fault"), taskIds: (d.tasks || []).map((t) => t._id).filter(Boolean) };
  }

  // Baca path dari ONT. Bila ONT menolak seluruhnya (mis. 9002 karena ada tabel kosong), baca per bagian:
  // path ber-* diuraikan jadi path nyata, bagian yang ditolak diturunkan ke sub-objeknya.
  const readTask = (doc, p) => (doc?.[p]?.object || p.includes("*") ? { name: "refreshObject", objectName: p } : { name: "getParameterValues", parameterNames: [p] });
  const childObjects = (doc, p) => Object.keys(doc).filter((k) => k.startsWith(p + ".") && !k.slice(p.length + 1).includes(".") && doc[k]?.object);
  function expand(doc, p) {
    if (!p.includes("*")) return [p];
    const rx = new RegExp("^" + p.split(".").map((x) => (x === "*" ? "\\d+" : x.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))).join("\\.") + "$");
    return Object.keys(doc).filter((k) => rx.test(k));
  }
  async function readSafe(id, paths, what) {
    // percobaan pertama sama dengan GenieACS: objek tunggal dibaca dengan refreshObject, selain itu getParameterValues
    const isObj = paths.length === 1 && DEV?.id === id && DEV.doc?.[paths[0]]?.object;
    const first = await runTasks(id, [isObj ? { name: "refreshObject", objectName: paths[0] } : { name: "getParameterValues", parameterNames: paths }], what, true);
    if (first.ok || !first.fault) { toast(first.msg, first.ok); return; }
    const doc = await get("device?id=" + enc(id));
    const faults = [...first.taskIds], done = [], bad = [];
    let queue = paths.flatMap((p) => (p.includes("*") ? expand(doc, p) : doc[p]?.object ? childObjects(doc, p) : []));
    if (!queue.length) bad.push(...paths);
    let budget = 30, stopped = false;
    while (queue.length && budget-- > 0) {
      const p = queue.shift();
      const r = await runTasks(id, [readTask(doc, p)], p, true);
      if (r.ok) done.push(p);
      else if (r.fault) {
        faults.push(...r.taskIds);
        const kids = childObjects(doc, p);
        kids.length ? queue.unshift(...kids) : bad.push(p);
      } else { stopped = true; bad.push(p); break; }
    }
    if (queue.length && !stopped) bad.push(`${queue.length} bagian lain belum dicoba`);
    await Promise.all(faults.map((t) => post("delete", { resource: "faults", id: `${id}:task_${t}` }).catch(() => {})));
    const short = (p) => p.replace(/^InternetGatewayDevice\./, "");
    toast(`${what}: ONT menolak permintaan utuh, jadi dibaca per bagian. ${done.length} bagian terbaca` +
      (bad.length ? `, ditolak atau dilewati: ${bad.slice(0, 3).map(short).join("; ")}${bad.length > 3 ? ` dan ${bad.length - 3} lagi` : ""}` : "") +
      (stopped ? ". ONT berhenti menjawab, sisanya tidak dicoba." : ".") + " Catatan fault dari percobaan ini sudah dihapus.", !bad.length);
  }

  // Uraikan fault milik satu tugas: kode, pesan, parameter yang ditolak, dan arti kode yang umum.
  const FAULT_HINT = {
    "cwmp.9002": "ONT tidak bisa memproses permintaan ini. Untuk Summon, ini biasanya terjadi bila path memakai * dan sebagian objeknya tidak ada di ONT ini; minta path yang lebih spesifik lewat Ambil ulang pada tabelnya.",
    "cwmp.9003": "Nilai tidak diterima ONT (format atau rentang salah).",
    "cwmp.9005": "Nama parameter tidak dikenal ONT ini.",
    "cwmp.9007": "Nilai tidak sah untuk parameter ini.",
    "cwmp.9008": "Parameter ini tidak boleh diubah di ONT ini.",
  };
  async function faultText(id, taskId) {
    try {
      const [f] = taskId ? await get("faults/list?" + qs({ filter: `_id = ${JSON.stringify(`${id}:task_${taskId}`)}`, limit: 1 })) : [];
      if (!f) return "ONT menolak. Lihat bagian Faults.";
      const bad = (f.detail?.setParameterValuesFault || []).map((x) => `${x.parameterName.split(".").slice(-2).join(".")} (${x.faultString})`).join(", ");
      return `ONT menolak (${f.code} ${f.message})${bad ? ` pada ${bad}` : ""}. ${FAULT_HINT[f.code] || ""} Catatan fault ini bisa dihapus di bagian Faults.`.replace(/\s+/g, " ").trim();
    } catch { return "ONT menolak. Lihat bagian Faults."; }
  }

  // Pilihan nilai untuk parameter yang nilainya berupa daftar tetap. TR-069 tidak memberi daftar nilai
  // yang diterima ONT, jadi ini gabungan nilai umum + nilai yang sudah dipakai di ONT ini, plus isian bebas.
  function choicesFor(path, doc, cur) {
    const tail = path.split(".").pop(), low = tail.toLowerCase();
    let base = null;
    if (tail === "ConnectionType") base = /WANPPPConnection/.test(path) ? ["PPPoE_Routed", "PPPoE_Bridged", "IP_Routed"] : ["IP_Routed", "IP_Bridged"];
    else if (low.endsWith("servicelist")) base = ["INTERNET", "TR069", "VOIP", "OTHER", "IPTV", "TR069_INTERNET", "TR069_VOIP", "VOIP_INTERNET", "TR069_VOIP_INTERNET"];
    else if (tail === "AddressingType") base = ["DHCP", "Static"];
    else if (tail === "ConnectionTrigger") base = ["AlwaysOn", "OnDemand", "Manual"];
    if (!base) return null;
    const kind = path.match(/\.(WANPPPConnection|WANIPConnection)\./)?.[1];
    const seen = Object.keys(doc || {}).filter((k) => k.split(".").pop() === tail && (!kind || tail !== "ConnectionType" || k.includes(`.${kind}.`)))
      .map((k) => val(doc, k)).filter((v) => typeof v === "string" && v);
    return [...new Set([...(cur != null && cur !== "" ? [String(cur)] : []), ...base, ...seen])];
  }
  const choiceHtml = (name, opts, cur) => `<select name="${name}" data-choice>${opts.map((o) => `<option ${String(cur) === o ? "selected" : ""}>${esc(o)}</option>`).join("")}
      <option value="__lain">Lainnya (ketik sendiri)…</option></select><input name="${name}__lain" hidden placeholder="Nilai lain" autocomplete="off" spellcheck="false">`;
  const choiceValue = (f, name) => (f.elements[name].value === "__lain" ? f.elements[name + "__lain"].value.trim() : f.elements[name].value);
  document.addEventListener("change", (e) => {
    const sel = e.target.closest?.("[data-choice]");
    if (!sel) return;
    const other = sel.form?.elements[sel.name + "__lain"];
    if (other) { other.hidden = sel.value !== "__lain"; if (!other.hidden) other.focus(); }
  });

  // Satu isian untuk satu parameter. read(form) -> {v, t} bila nilainya berubah, null bila tetap; melempar
  // Error bila isian tidak sah. Dipakai dialog satu sel, form satu baris, dan antrean.
  function paramField(doc, path, name, label = "Nilai") {
    const x = entry(doc, path) || {};
    const t = x.value?.[1] || "xsd:string", cur = x.value?.[0];
    const isBool = t === "xsd:boolean", isNum = /int|long/i.test(t);
    const short = label === "Nilai" ? "" : label;
    // LAN BIND: centang interface LAN/WLAN. Gabungan: yang terbaca di ONT + yang terpilih sekarang
    // (agar tidak terhapus diam-diam) + port LAN 1..N, karena banyak ONT tidak melaporkan LANEthernetInterfaceConfig
    if (!isBool && !isNum && (shortIfaces(cur) !== null || /laninterface|lanbind/i.test(path))) {
      const on = new Set(String(cur ?? "").split(",").map((v) => v.trim().replace(/\.$/, "")).filter(Boolean));
      const set = new Set([...Object.keys(doc).filter((k) => IFACE.test(k) && doc[k]?.object !== false), ...[...on].filter((k) => IFACE.test(k))]);
      const lanDev = [...set].map((k) => k.match(/^(InternetGatewayDevice\.LANDevice\.\d+)\./)?.[1]).find(Boolean);
      if (lanDev) {
        const n = Math.min(+val(doc, `${lanDev}.LANEthernetInterfaceNumberOfEntries`) || 4, 8);
        for (let i = 1; i <= n; i++) set.add(`${lanDev}.LANEthernetInterfaceConfig.${i}`);
      }
      const ifaces = [...set].sort((a, b) => ifaceLabel(a).localeCompare(ifaceLabel(b), "en", { numeric: true }));
      if (ifaces.length) return {
        html: `<fieldset class="checks-box wide-field"><legend>${esc(short || "LAN BIND")}</legend><div class="checks">${ifaces.map((k) => {
          const note = val(doc, k + ".SSID") || (doc[k] ? "" : "belum terbaca");
          return `<label class="check"><input type="checkbox" name="${name}" value="${esc(k)}" ${on.has(k) ? "checked" : ""}> ${esc(ifaceLabel(k))}${note ? ` <span class="hint">${esc(note)}</span>` : ""}</label>`;
        }).join("")}</div></fieldset>`,
        read: (f) => {
          const v = [...f.querySelectorAll(`input[name="${name}"]:checked`)].map((c) => c.value).join(",");
          const same = [...on].sort().join(",") === v.split(",").filter(Boolean).sort().join(",");
          return same ? null : { v, t };
        },
      };
    }
    // WANInterface: pilih koneksi WAN yang ada di ONT ini
    if (!isBool && !isNum && (wanLabel(doc, cur) || /waninterface$/i.test(path))) {
      const conns = wanConnections(doc), curP = String(cur ?? "").trim().replace(/\.$/, "");
      if (conns.length) return {
        html: `<label>${esc(short || "Koneksi WAN")}<select name="${name}">${curP && !conns.includes(curP) ? `<option value="${esc(curP)}" selected>${esc(curP)} (tidak terbaca)</option>` : ""}${
          conns.map((k) => `<option value="${esc(k)}" ${k === curP ? "selected" : ""}>${esc(wanLabel(doc, k))}</option>`).join("")}</select></label>`,
        read: (f) => (f.elements[name].value === curP ? null : { v: f.elements[name].value, t }),
      };
    }
    if (isBool) return {
      html: `<label>${esc(short || "Nilai")}<select name="${name}"><option ${cur === true ? "selected" : ""}>true</option><option ${cur === false ? "selected" : ""}>false</option></select></label>`,
      read: (f) => { const v = f.elements[name].value === "true"; return v === cur ? null : { v, t }; },
    };
    const opts = !isNum ? choicesFor(path, doc, cur) : null;
    if (opts) return {
      html: `<label>${esc(short || "Nilai")}${choiceHtml(name, opts, cur)}</label>`,
      read: (f) => {
        const v = choiceValue(f, name);
        if (!v) throw new Error(`${short || "Nilai"}: isi nilai lainnya dulu.`);
        return v === String(cur ?? "") ? null : { v, t };
      },
    };
    const wpa = WPA_PASS.test(path);
    return {
      html: `<label>${esc(short || (wpa ? "Password WiFi" : `Nilai (${t.replace("xsd:", "")})`))}<input name="${name}" value="${esc(fmt(cur, t))}" ${isNum ? 'inputmode="numeric"' : ""}
        placeholder="${wpa && cur === "" ? "tidak dikirim ONT, isi untuk mengganti" : ""}" autocomplete="off" spellcheck="false"></label>`
        + (wpa && label === "Nilai" ? `<p class="hint">${cur === "" ? "Password lama tidak bisa dibaca dari ONT ini (firmware tidak mengirimnya). Isi password baru. " : ""}8 sampai 63 karakter. Perangkat yang tersambung ke WiFi ini akan terputus dan harus memakai password baru.</p>` : ""),
      read: (f) => {
        let v = f.elements[name].value;
        if (v === fmt(cur, t)) return null;
        if (wpa && !/^[\x20-\x7e]{8,63}$/.test(v)) throw new Error(`${short || "Password WiFi"}: harus 8 sampai 63 karakter (huruf, angka, simbol biasa).`);
        if (isNum) { if (!/^-?\d+$/.test(v.trim())) throw new Error(`${short || "Nilai"}: harus angka bulat.`); v = Number(v); }
        return { v, t };
      },
    };
  }

  // ------------------------------------------------------------------ antrean perubahan (dikirim sekaligus)
  const PENDING = new Map(); // id perangkat -> Map(path -> [path, nilai, tipe])
  const pendingOf = (id) => PENDING.get(id) || new Map();
  function queueAdd(id, values) {
    const m = pendingOf(id);
    values.forEach((pv) => m.set(pv[0], pv));
    PENDING.set(id, m);
    renderPendBar();
    toast(`${values.length} perubahan masuk antrean. Kirim sekaligus lewat bilah di bawah.`, true);
  }
  const shortPath = (p) => p.replace(/^InternetGatewayDevice\./, "").replace(/^LANDevice\.1\.WLANConfiguration\./, "WLAN ").replace(/^WANDevice\.1\.WANConnectionDevice\./, "WAN ");
  function renderPendBar() {
    const bar = $("pendBar");
    if (!bar || !DEV) return;
    const m = pendingOf(DEV.id);
    bar.hidden = !m.size;
    document.body.classList.toggle("has-bulk", m.size > 0);
    bar.innerHTML = m.size ? `<span class="bulk-count">${m.size} perubahan menunggu</span>
      <div class="pend-list">${[...m.values()].map(([p, v]) => `<span class="pend-item" title="${esc(p)}">${esc(shortPath(p))} = <b>${esc(WPA_PASS.test(p) ? "••••" : fmt(v))}</b>
        <button type="button" data-pend-del="${esc(p)}" aria-label="Hapus dari antrean">${ICON.x}</button></span>`).join("")}</div>
      <button type="button" class="send" data-pend-send>${ICON.up}<span>Kirim ke ONT</span></button>
      <button type="button" class="close" data-pend-clear title="Batalkan semua" aria-label="Batalkan semua">${ICON.x}</button>` : "";
  }
  async function sendPending(btn) {
    const id = DEV.id, m = pendingOf(id);
    if (!m.size) return;
    btn.disabled = true;
    try {
      const r = await runTasks(id, [{ name: "setParameterValues", parameterValues: [...m.values()] }], `Kirim ${m.size} perubahan`);
      if (r.ok) PENDING.delete(id);
    } catch (x) { toast(x.message, false); } finally { btn.disabled = false; }
    reloadDevice();
  }

  async function editParam(doc, path, id, queueable = true) {
    const fd = paramField(doc, path, "v");
    return form({
      title: "Ubah parameter", text: path, body: fd.html, ok: "Terapkan ke ONT", alt: queueable ? "Tambah ke antrean" : undefined,
      submit: async (f, later) => {
        const r = fd.read(f);
        if (!r) throw new Error("Nilainya tidak berubah.");
        if (later) { queueAdd(id, [[path, r.v, r.t]]); return "queued"; }
        await runTasks(id, [{ name: "setParameterValues", parameterValues: [[path, r.v, r.t]] }], "Ubah " + path.split(".").pop());
        return "sent";
      },
    });
  }

  // Ubah semua kolom satu baris tabel sekaligus: satu form, satu tugas ke ONT
  async function editRow(doc, inst, cols, id) {
    const fields = cols.map(([label, rel], i) => ({ label, path: `${inst}.${rel}` }))
      .filter((c) => doc[c.path] && !doc[c.path].object && doc[c.path].writable)
      .map((c, i) => ({ ...c, fd: paramField(doc, c.path, "f" + i, c.label || c.path.split(".").pop()) }));
    if (!fields.length) throw new Error("Tidak ada kolom yang bisa diubah di baris ini.");
    const label = shortPath(inst);
    return form({
      title: `Ubah ${label}`, wide: true, ok: "Kirim ke ONT", alt: "Tambah ke antrean",
      text: "Hanya kolom yang Anda ubah yang dikirim, semuanya dalam satu tugas.",
      body: `<div class="row-form">${fields.map((x) => x.fd.html).join("")}</div>`,
      submit: async (f, later) => {
        const changes = [];
        for (const x of fields) { const r = x.fd.read(f); if (r) changes.push([x.path, r.v, r.t]); }
        if (!changes.length) throw new Error("Belum ada yang diubah.");
        if (later) { queueAdd(id, changes); return "queued"; }
        await runTasks(id, [{ name: "setParameterValues", parameterValues: changes }], `Ubah ${label} (${changes.length} kolom)`);
        return "sent";
      },
    });
  }

  // ------------------------------------------------------------------ instance WAN baru
  // Kolom diambil dari koneksi sejenis yang sudah ada di ONT ini, sehingga nama parameter vendor
  // (X_HW_SERVICELIST, X_ZTE-COM_ServiceList, X_FH_*, LAN BIND, VLAN) ikut benar.
  function wanTemplate(doc, table) {
    const kind = table.split(".").pop();
    const sib = Object.keys(doc).filter((k) => new RegExp(`\\.${kind}\\.\\d+$`).test(k) && doc[k]?.object).sort();
    const from = sib.find((k) => k.startsWith(table + ".")) || sib[0] || "";
    const leaves = {};
    if (from) for (const k of Object.keys(doc)) {
      if (!k.startsWith(from + ".")) continue;
      const rel = k.slice(from.length + 1), x = doc[k];
      if (!x.object && x.writable && rel.split(".").length <= 2) leaves[rel] = x.value?.[1] || "xsd:string";
    }
    if (!from) Object.assign(leaves, { Enable: "xsd:boolean", Name: "xsd:string", ConnectionType: "xsd:string", NATEnabled: "xsd:boolean" },
      kind === "WANPPPConnection" ? { Username: "xsd:string", Password: "xsd:string" } : { AddressingType: "xsd:string" });
    return { kind, from, leaves };
  }

  function wanFields(tpl, table, doc) {
    const L = tpl.leaves, has = (r) => r in L, ppp = tpl.kind === "WANPPPConnection";
    const pick = (rx) => Object.keys(L).filter((r) => rx.test(r));
    const f = [];
    const add = (rel, label, kind, def) => has(rel) && f.push({ rel, label, kind: kind || (L[rel] === "xsd:boolean" ? "bool" : /int|long/i.test(L[rel]) ? "num" : "text"), def });
    add("Enable", "Aktif", "bool", true);
    add("Name", "Nama koneksi (Conn Name)");
    add("ConnectionType", "Conn Mode", "choice", ppp ? "PPPoE_Routed" : "IP_Routed");
    pick(/servicelist$/i).slice(0, 1).forEach((r) => add(r, "Service List", "choice", "INTERNET"));
    if (ppp) { add("Username", "Username PPPoE"); add("Password", "Password PPPoE", "secret"); }
    else {
      add("AddressingType", "IP type (DHCP/Static)", "choice", "DHCP");
      ["ExternalIPAddress", "SubnetMask", "DefaultGateway", "DNSServers"].forEach((r) => add(r, r + " (untuk Static)"));
    }
    add("NATEnabled", "NAT", "bool", true);
    pick(/vlan/i).filter((r) => !/lanbind/i.test(r)).slice(0, 4).forEach((r) => {
      const raw = r.split(".").pop();
      add(r, `${/enable/i.test(raw) ? "VLAN aktif" : /id$/i.test(raw) ? "VLAN ID" : /pri|8021p/i.test(raw) ? "Prioritas VLAN" : "VLAN"} (${raw})`);
    });
    pick(/laninterface$/i).slice(0, 1).forEach((r) => f.push({ rel: r, label: "LAN BIND", kind: "ifaces" }));
    const binds = pick(/LANBIND\.(Lan|SSID)\d+Enable$/i);
    if (binds.length) f.push({ rel: binds, label: "LAN BIND", kind: "bindbools" });
    // ZTE menyimpan LAN BIND di objek terpisah X_ZTE-COM_PortBinding.N {LANInterface, WANInterface}
    const pb = portBindingTable(doc);
    if (!f.some((x) => x.kind === "ifaces" || x.kind === "bindbools") && pb) f.push({ rel: pb, label: "LAN BIND (PortBinding baru)", kind: "portbind" });
    return f;
  }

  const portBindingTable = (doc) => Object.keys(doc).find((k) => /^InternetGatewayDevice\.X_[\w-]+_PortBinding$/.test(k) && doc[k]?.object && doc[k]?.writable) || "";
  // interface -> koneksi WAN yang sudah mengikatnya lewat PortBinding
  function boundBy(doc, pb) {
    const m = {};
    for (const i of instances(doc, pb)) {
      const wan = String(val(doc, `${i}.WANInterface`) || "");
      const name = val(doc, `${wan}.Name`) || wan.split(".").slice(-2).join(".");
      String(val(doc, `${i}.LANInterface`) || "").split(",").map((x) => x.trim()).filter(Boolean).forEach((x) => (m[x] = name));
    }
    return m;
  }

  function wanFieldHtml(fd, table, doc) {
    const n = "w" + (Array.isArray(fd.rel) ? "_binds" : fd.rel.replace(/[^\w]/g, "_"));
    fd.name = n;
    const lab = (inner) => `<label>${esc(fd.label)}${inner}</label>`;
    if (fd.kind === "bool") return lab(`<select name="${n}"><option ${fd.def !== false ? "selected" : ""}>true</option><option ${fd.def === false ? "selected" : ""}>false</option></select>`);
    if (fd.kind === "choice") return lab(choiceHtml(n, choicesFor(`${table}.1.${fd.rel}`, doc, fd.def), fd.def));
    if (fd.kind === "secret") return lab(`<input name="${n}" type="password" autocomplete="new-password">`);
    if (fd.kind === "num") return lab(`<input name="${n}" inputmode="numeric" autocomplete="off">`);
    if (fd.kind === "ifaces" || fd.kind === "bindbools" || fd.kind === "portbind") {
      const used = fd.kind === "portbind" ? boundBy(doc, fd.rel) : {};
      const items = fd.kind === "bindbools"
        ? fd.rel.map((r) => ({ v: r, l: r.split(".").pop().replace(/Enable$/i, "").replace(/^Lan/i, "LAN ").replace(/^SSID/i, "WLAN ") }))
        : (() => {
          const set = new Set(Object.keys(doc).filter((k) => IFACE.test(k) && doc[k]?.object !== false));
          const lanDev = [...set].map((k) => k.match(/^(InternetGatewayDevice\.LANDevice\.\d+)\./)?.[1]).find(Boolean) || "InternetGatewayDevice.LANDevice.1";
          const nLan = Math.min(+val(doc, `${lanDev}.LANEthernetInterfaceNumberOfEntries`) || 4, 8);
          for (let i = 1; i <= nLan; i++) set.add(`${lanDev}.LANEthernetInterfaceConfig.${i}`);
          return [...set].sort((a, b) => ifaceLabel(a).localeCompare(ifaceLabel(b), "en", { numeric: true }))
            .map((k) => ({ v: k, l: ifaceLabel(k), h: [val(doc, k + ".SSID"), used[k] ? `sudah terikat ke ${used[k]}` : ""].filter(Boolean).join(" · ") }));
        })();
      return `<fieldset class="checks-box"><legend>${esc(fd.label)}</legend><div class="checks">${items.map((i) =>
        `<label class="check"><input type="checkbox" name="${n}" value="${esc(i.v)}"> ${esc(i.l)}${i.h ? ` <span class="hint">${esc(i.h)}</span>` : ""}</label>`).join("")}</div></fieldset>`;
    }
    return lab(`<input name="${n}" autocomplete="off" spellcheck="false">`);
  }

  function wanValues(f, fields) {
    const out = [];
    for (const fd of fields) {
      if (fd.kind === "bindbools") {
        const on = new Set([...f.querySelectorAll(`input[name="${fd.name}"]:checked`)].map((c) => c.value));
        fd.rel.forEach((r) => out.push([r, on.has(r), "xsd:boolean"]));
        continue;
      }
      if (fd.kind === "portbind") {
        const v = [...f.querySelectorAll(`input[name="${fd.name}"]:checked`)].map((c) => c.value).join(",");
        if (v) out.portbind = { table: fd.rel, lan: v };
        continue;
      }
      if (fd.kind === "ifaces") {
        const v = [...f.querySelectorAll(`input[name="${fd.name}"]:checked`)].map((c) => c.value).join(",");
        if (v) out.push([fd.rel, v, "xsd:string"]);
        continue;
      }
      let v = fd.kind === "choice" ? choiceValue(f, fd.name) : f.elements[fd.name].value.trim();
      if (v === "") continue;
      if (fd.kind === "bool") v = v === "true";
      else if (fd.kind === "num") { if (!/^-?\d+$/.test(v)) throw new Error(`${fd.label} harus angka bulat.`); v = Number(v); }
      out.push([fd.rel, v, fd.kind === "bool" ? "xsd:boolean" : fd.kind === "num" ? "xsd:unsignedInt" : "xsd:string"]);
    }
    return out;
  }

  async function createWan(id, table) {
    const doc = DEV.doc, tpl = wanTemplate(doc, table), fields = wanFields(tpl, table, doc);
    const values = await form({
      title: `Tambah ${tpl.kind === "WANPPPConnection" ? "WAN PPP" : "WAN IP"} baru`, wide: true, ok: "Buat di ONT",
      text: `Di ${table}. Isian kosong tidak dikirim.${tpl.from ? ` Kolom mengikuti ${tpl.from.replace(/^InternetGatewayDevice\./, "")} yang sudah ada.` : ""}`,
      body: `<div class="wan-form">${fields.map((fd) => wanFieldHtml(fd, table, doc)).join("")}</div>`,
      submit: (f) => wanValues(f, fields),
    });
    if (!values) return;
    const before = new Set(instances(doc, table));
    const r = await runTasks(id, [{ name: "addObject", objectName: table }], "Tambah instance", true);
    if (!r.ok) { toast(r.msg, false); return; }
    let doc2 = await get("device?id=" + enc(id));
    let inst = instances(doc2, table).find((k) => !before.has(k));
    if (!inst) {
      await runTasks(id, [{ name: "refreshObject", objectName: table }], "Baca tabel", true);
      doc2 = await get("device?id=" + enc(id));
      inst = instances(doc2, table).find((k) => !before.has(k));
    }
    if (!inst) { toast("Instance sudah dibuat, tetapi nomornya belum terbaca. Tekan Ambil ulang pada tabel itu, lalu isi lewat ✎.", false); return; }
    const pv = values.map(([rel, v, t]) => [`${inst}.${rel}`, v, doc2[`${inst}.${rel}`]?.value?.[1] || tpl.leaves[rel] || t]);
    const name = inst.split(".").slice(-2).join(".");
    if (!pv.length) { toast(`${name} dibuat (kosong). Isi lewat ✎.`, true); return; }
    const s2 = await runTasks(id, [{ name: "setParameterValues", parameterValues: pv }], "Isi " + name, true);
    if (!s2.ok) { toast(`${name} sudah dibuat, tetapi pengisian ditolak: ${s2.msg.replace(/^[^:]*: /, "")} Perbaiki lewat ✎ atau hapus instance itu.`, false); return; }
    if (!values.portbind) { toast(`${name} dibuat dan diisi.`, true); return; }
    // ZTE: buat PortBinding baru yang mengikat LAN/WLAN terpilih ke koneksi ini
    const pbT = values.portbind.table, pbBefore = new Set(instances(doc2, pbT));
    const r3 = await runTasks(id, [{ name: "addObject", objectName: pbT }], "Tambah PortBinding", true);
    let doc3 = r3.ok ? await get("device?id=" + enc(id)) : null;
    let pbi = doc3 && instances(doc3, pbT).find((k) => !pbBefore.has(k));
    if (r3.ok && !pbi) {
      await runTasks(id, [{ name: "refreshObject", objectName: pbT }], "Baca PortBinding", true);
      doc3 = await get("device?id=" + enc(id));
      pbi = instances(doc3, pbT).find((k) => !pbBefore.has(k));
    }
    if (!pbi) { toast(`${name} dibuat dan diisi, tetapi PortBinding untuk LAN BIND gagal dibuat${r3.ok ? "" : ": " + r3.msg.replace(/^[^:]*: /, "")}. Atur lewat tabel PortBinding.`, false); return; }
    const r4 = await runTasks(id, [{ name: "setParameterValues", parameterValues: [[`${pbi}.LANInterface`, values.portbind.lan, "xsd:string"], [`${pbi}.WANInterface`, inst, "xsd:string"]] }], "Isi PortBinding", true);
    toast(r4.ok ? `${name} dibuat, diisi, dan diikat ke LAN/WLAN terpilih (${pbi.split(".").slice(-2).join(".")}).`
      : `${name} dibuat, tetapi LAN BIND ditolak ONT: ${r4.msg.replace(/^[^:]*: /, "")} Interface yang sudah terikat ke koneksi lain mungkin perlu dilepas dulu.`, r4.ok);
  }

  // ------------------------------------------------------------------ halaman perangkat
  async function showDevice(id, keepScroll = false) {
    const box = $("device"), y = scrollY;
    if (!keepScroll || !DEV || DEV.id !== id) box.innerHTML = '<div class="block"><p class="empty">Membaca perangkat…</p></div>';
    try {
      const doc = await get("device?id=" + enc(id));
      DEV = { id, doc };
      renderDevice();
      if (keepScroll) scrollTo(0, y);
    } catch (e) {
      box.innerHTML = `<div class="block"><a class="btn" href="#devices">Kembali ke Devices</a><p class="empty bad">${esc(e.message)}</p></div>`;
    }
  }
  const reloadDevice = () => DEV && showDevice(DEV.id, true);

  const isHeading = (el) => (typeof el === "string" ? /^h[1-6](\.|$)/.test(el) : /^h[1-6]$/.test(el?.tag || ""));
  const headText = (h) => sorted(h.components).filter((x) => typeof x === "string").join(" ").trim();
  const headRest = (h) => sorted(h.components).filter((x) => typeof x !== "string");
  // Satu komponen teratas config -> {judul, isi}. Judul diambil dari elemen h3 di awal komponen.
  function sectionOf(c, ctx) {
    if (c && typeof c === "object" && !Array.isArray(c) && "filter" in c && !X.truthy(X.evaluate(c.filter, getter(ctx.doc)))) return null;
    let title = null, body = [c];
    if (c && typeof c === "object" && !Array.isArray(c)) {
      if (isHeading(c.element)) { title = headText(c); body = headRest(c); }
      else if ((c.type || "container") === "container" && c.components) {
        const kids = sorted(c.components);
        if (kids[0] && typeof kids[0] === "object" && !Array.isArray(kids[0]) && isHeading(kids[0].element)) { title = headText(kids[0]); body = [...headRest(kids[0]), ...kids.slice(1)]; }
      }
    }
    return { title, html: body.map((x) => comp(x, ctx)).join("") };
  }
  const AUTO_TITLE = { "parameter-list": "Informasi perangkat", "device-faults": "Faults", "all-parameters": "Semua parameter" };
  function findSummon(list) {
    for (const c of sorted(list)) {
      if (!c || typeof c !== "object" || Array.isArray(c)) continue;
      if (c.type === "summon-button") return sorted(c.parameters).map((p) => (Array.isArray(p) && p[0] === "PARAM" ? p[1] : null)).filter(Boolean);
      for (const k of ["components", "parameters"]) { const r = c[k] && typeof c[k] === "object" ? findSummon(c[k]) : null; if (r?.length) return r; }
    }
    return null;
  }
  const agoText = (ms) => {
    if (!ms) return "belum pernah";
    const m = Math.round((Date.now() - ms) / 60000);
    return m < 2 ? "baru saja" : m < 60 ? `${m} menit lalu` : m < 2880 ? `${Math.round(m / 60)} jam lalu` : `${Math.round(m / 1440)} hari lalu`;
  };

  function isOnline(doc) {
    const ch = CONF?.ui?.overview?.charts?.online;
    const first = ch ? sorted(ch.slices)[0] : null;
    if (first) return X.truthy(X.evaluate(first.filter, getter(doc)));
    return (val(doc, "Events.Inform") || 0) > Date.now() - 5 * 60000;
  }
  // Lampu pelat depan dari data ONT. Status port LAN hanya ada bila ONT melaporkannya.
  function ledsHtml(doc) {
    const online = isOnline(doc), keys = Object.keys(doc);
    const rx = parseFloat(val(doc, "VirtualParameters.RXPower"));
    const truthyV = (v) => v === true || String(v).toLowerCase() === "true" || v === 1;
    const internet = wanConnections(doc).some((k) => /^connected$/i.test(String(val(doc, `${k}.ConnectionStatus`) || ""))
      && !/tr069/i.test(String(val(doc, `${k}.Name`) || "") + " " + keys.filter((x) => x.startsWith(k + ".") && /servicelist$/i.test(x)).map((x) => val(doc, x)).join(" ")));
    const wl = keys.filter((k) => /^InternetGatewayDevice\.LANDevice\.\d+\.WLANConfiguration\.\d+$/.test(k));
    const is5 = (k) => /5g/i.test(String(val(doc, k + ".SSID") || "")) || /(^|,)\s*(a|ac|ax)\s*(,|$)/i.test(String(val(doc, k + ".Standard") || "")) || +val(doc, k + ".Channel") > 14;
    const w24 = wl.some((k) => truthyV(val(doc, k + ".Enable")) && !is5(k)), w5 = wl.some((k) => truthyV(val(doc, k + ".Enable")) && is5(k));
    const lans = keys.filter((k) => /^InternetGatewayDevice\.LANDevice\.\d+\.LANEthernetInterfaceConfig\.\d+$/.test(k)).sort().slice(0, 4);
    const los = !online && (Number.isNaN(rx) || rx <= -30);
    const led = (label, on, color, mode, title) => `<div class="ledbox${on ? " on" : ""}${on && mode ? " " + mode : ""}" style="--lc:${color}" title="${esc(title)}"><i></i><span>${esc(label)}</span></div>`;
    const lanLeds = (lans.length ? lans : [1, 2, 3, 4].map(() => "")).map((k, i) => {
      const st = k ? String(val(doc, k + ".Status") || "") : "";
      return led(`LAN${i + 1}`, /^up$/i.test(st), "var(--f-green)", "blink", st ? `LAN ${i + 1}: ${st}` : `LAN ${i + 1}: status port tidak dilaporkan ONT`);
    }).join("");
    return `<div class="leds" role="img" aria-label="Lampu ONT">
      ${led("Power", online, "var(--f-green)", "", online ? "ONT menyala dan terhubung ke ACS" : "Tidak ada inform terbaru")}
      ${led("PON", online, "var(--f-green)", "", online ? "Jalur PON tersambung" : "Jalur PON belum terbaca")}
      ${led("LOS", los, "var(--f-red)", "fast", los ? "Kemungkinan putus serat: offline dan sinyal tidak terbaca" : "Tidak ada tanda putus serat")}
      ${led("Internet", internet, "var(--f-green)", "blink", internet ? "Ada koneksi WAN berstatus Connected" : "Tidak ada koneksi WAN internet yang Connected")}
      ${led("2.4G", w24, "var(--f-aqua)", "blink", w24 ? "WiFi 2.4 GHz menyala" : "WiFi 2.4 GHz mati atau belum terbaca")}
      ${led("5G", w5, "var(--f-aqua)", "blink", w5 ? "WiFi 5 GHz menyala" : "WiFi 5 GHz mati atau belum terbaca")}
      ${lanLeds}</div>`;
  }
  // Meteran sinyal RX: -30 dBm (kiri) sampai -8 dBm (kanan)
  function gaugeHtml(rxRaw) {
    const rx = parseFloat(rxRaw), has = !Number.isNaN(rx);
    const t = (v) => Math.min(1, Math.max(0, (v + 30) / 22));
    const pt = (k) => [100 - 80 * Math.cos(Math.PI * k), 100 - 80 * Math.sin(Math.PI * k)].map((n) => n.toFixed(2)).join(" ");
    const arc = (a, b2, color) => `<path class="arc" d="M ${pt(a)} A 80 80 0 0 1 ${pt(b2)}" stroke="${color}"/>`;
    const angle = has ? -90 + t(rx) * 180 : -90;
    const zone = !has ? "Belum terbaca" : rx < -27 ? "Lemah, periksa kabel/konektor" : rx < -24 ? "Cukup" : rx > -8 ? "Terlalu kuat" : "Baik";
    const tick = (v) => { const [x, y] = pt(t(v)).split(" ").map(Number); return `<text class="tick" x="${(100 + (x - 100) * 1.22).toFixed(1)}" y="${(100 + (y - 100) * 1.22 + 3).toFixed(1)}" text-anchor="middle">${v}</text>`; };
    return `<div class="gauge"><svg viewBox="0 0 200 142" role="img" aria-label="Sinyal RX ${has ? rx : "belum terbaca"} dBm">
      ${arc(0, t(-27), "var(--f-red)")}${arc(t(-27), t(-24), "var(--f-yellow)")}${arc(t(-24), 1, "var(--f-green)")}
      ${tick(-30)}${tick(-27)}${tick(-24)}${tick(-8)}
      <g class="needle" style="transform:rotate(-90deg)" data-angle="${angle}"><line x1="100" y1="100" x2="100" y2="42"/><circle cx="100" cy="100" r="6"/></g>
      <text class="val" x="100" y="136" text-anchor="middle">${has ? rx.toFixed(1) : "–"}<tspan class="unit" dx="4">dBm</tspan></text>
    </svg><div class="gauge-cap">Sinyal RX: ${esc(zone)}</div></div>`;
  }
  const tile = (icon, color, label, value, extra = "") => (value == null || value === "" ? ""
    : `<div class="tile ${extra}"><span class="ico${extra.includes("ping") ? " sonar waiting" : ""}" style="--tc:${color}">${ICON[icon]}</span><small>${esc(label)}</small><b>${value}</b></div>`);

  function heroHtml(ctx) {
    const d = ctx.doc;
    const serial = val(d, "DeviceID.SerialNumber") || ctx.id;
    const ip = val(d, LOC.param), loc = locationOf(ip), inform = val(d, "Events.Inform");
    const host = pingHost(d);
    const summon = findSummon(CONF.ui.device) || [];
    return `<section class="card faceplate" style="--fc:${loc ? fiberOf(loc.id) : "var(--f-slate)"}">
      <div class="fp-top">
        <a class="btn-icon" href="#devices" title="Kembali ke Devices" aria-label="Kembali ke Devices">${ICON.back}</a>
        <div class="fp-id">
          <h2>${dot("online", ctx)}${esc(serial)}</h2>
          <div class="fp-model"><span>${esc([val(d, "DeviceID.Manufacturer"), val(d, "DeviceID.ProductClass")].filter(Boolean).join(" "))}</span>
            ${val(d, "InternetGatewayDevice.DeviceInfo.SoftwareVersion") ? `<span>Firmware ${esc(val(d, "InternetGatewayDevice.DeviceInfo.SoftwareVersion"))}</span>` : ""}
            <span class="mono">${esc(ctx.id)}</span></div>
        </div>
        <div class="hero-actions">
          ${summon.length ? `<button type="button" class="btn summon-main" data-summon="${esc(JSON.stringify(summon))}" data-id="${esc(ctx.id)}">${ICON.refresh}<span>Summon</span></button>` : ""}
          <button type="button" class="btn" data-act="reboot">${ICON.power}<span>Reboot</span></button>
          <details class="menu"><summary class="btn-icon" title="Aksi lain" aria-label="Aksi lain">${ICON.more}</summary>
            <div class="menu-pop">
              <button type="button" data-act="refreshAll">${ICON.refresh}Ambil ulang semua</button>
              <button type="button" data-act="download">${ICON.up}Push file</button>
              <a href="${esc(BASE + "api/acs/device.csv?id=" + enc(ctx.id))}">${ICON.down}Unduh CSV parameter</a>
              <button type="button" data-reload-dev>${ICON.refresh}Muat ulang halaman</button>
              <hr><button type="button" class="danger" data-act="factoryReset">${ICON.reset}Reset pabrik</button>
              <button type="button" class="danger" data-act="delete">${ICON.trash}Hapus dari GenieACS</button>
            </div></details>
        </div>
      </div>
      ${ledsHtml(d)}
      <div class="fp-gauges">
        ${gaugeHtml(val(d, "VirtualParameters.RXPower"))}
        <div class="tiles">
          ${tile("pin", loc ? fiberOf(loc.id) : "var(--f-slate)", "Lokasi", loc ? esc(loc.name) : "di luar lokasi")}
          ${tile("link", "var(--f-blue)", "IP TR069", ip ? `<a href="http://${esc(ip)}" target="_blank" rel="noopener noreferrer" class="mono">${esc(ip)}</a>` : "")}
          ${tile("user", "var(--f-violet)", "PPPoE", esc(val(d, "VirtualParameters.pppoeUsername") ?? ""))}
          ${host ? `<div class="tile ping" data-ping="${esc(host)}" title="Klik untuk mengukur ulang"><span class="ico sonar waiting" style="--tc:var(--f-aqua)">${ICON.signal}</span><small>Ping ${esc(host)}</small><b class="ping-out">mengukur…</b></div>` : ""}
          ${tile("clock", "var(--f-slate)", "Inform terakhir", esc(agoText(inform)))}
          ${tile("power", "var(--f-green)", "Menyala", esc(val(d, "VirtualParameters.getdeviceuptime") ?? ""))}
          ${tile("thermo", "var(--f-orange)", "Suhu", val(d, "VirtualParameters.gettemp") != null && val(d, "VirtualParameters.gettemp") !== "" ? `${esc(val(d, "VirtualParameters.gettemp"))} °C` : "")}
          <div class="tile tags"><span class="ico" style="--tc:var(--f-rose)">${ICON.tag}</span><small>Tag</small><b>${tagsHtml(ctx, true)}</b></div>
        </div>
      </div>
    </section>`;
  }
  // gaya kartu: ikon + warna serat dari judulnya
  function cardStyle(title) {
    const t = String(title || "").toLowerCase();
    if (/wifi|ssid|wlan/.test(t)) return ["wifi", "var(--f-aqua)"];
    if (/wan|ppp|internet|koneksi/.test(t)) return ["globe", "var(--f-blue)"];
    if (/host|tersambung|connected/.test(t)) return ["users", "var(--f-green)"];
    if (/admin|user|password|akun/.test(t)) return ["shield", "var(--f-violet)"];
    if (/fault|kesalahan/.test(t)) return ["alert", "var(--f-red)"];
    if (/parameter/.test(t)) return ["list", "var(--f-slate)"];
    if (/konfigurasi/.test(t)) return ["cpu", "var(--f-orange)"];
    return ["info", "var(--f-blue)"];
  }

  function renderDevice() {
    const ctx = { doc: DEV.doc, id: DEV.id, hero: true };
    const cards = [];
    let pending = null;
    for (const c of sorted(CONF.ui.device)) {
      if (c && typeof c === "object" && !Array.isArray(c) && ["ping", "device-actions", "tags"].includes(c.type)) continue;
      const sec = sectionOf(c, ctx);
      if (!sec) continue;
      if (!sec.html.trim()) { if (sec.title) pending = sec.title; continue; }
      // label baris pertama (sudah di-escape) dikembalikan ke teks biasa, karena nanti di-escape lagi
      const firstLabel = (sec.html.match(/<table class="plist"><tr><th>([^<]*)</)?.[1] || "")
        .replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, "&");
      const title = sec.title || pending || (cards.length === 0 ? "Informasi perangkat"
        : c?.type === "parameter-list" ? firstLabel
        : c && typeof c === "object" && "filter" in c ? "Konfigurasi ONT" : AUTO_TITLE[c?.type] || "");
      pending = null;
      const body = /data-allparams/.test(sec.html) ? `<details class="fold"><summary>Tampilkan semua parameter</summary>${sec.html}</details>` : sec.html;
      const [ico, col] = cardStyle(title || sec.html.match(/<h4>([^<]*)</)?.[1]);
      cards.push(`<section class="card dcard" style="--tc:${col}">${title ? `<h3 class="card-title"><span class="ico">${ICON[ico]}</span>${esc(title)}</h3>` : ""}${body}</section>`);
    }
    $("device").innerHTML = `<div class="acs-device" data-id="${esc(DEV.id)}">${heroHtml(ctx)}<div class="dcards">${cards.join("")}</div></div>`;
    simplifyCards($("device").querySelector(".dcards"));
    renderPendBar();
    const box = $("device");
    box.querySelectorAll("[data-faults]").forEach(loadFaultsInto);
    box.querySelectorAll("[data-ping]").forEach(doPing);
    box.querySelectorAll("[data-allparams]").forEach(renderAllParams);
    requestAnimationFrame(() => requestAnimationFrame(() => box.querySelectorAll(".needle[data-angle]").forEach((n) => (n.style.transform = `rotate(${n.dataset.angle}deg)`))));
  }
  // Susun ulang kartu agar sederhana: satu bagian = satu kartu dengan kepala (ikon, judul, tombol),
  // kartu yang hanya berisi judul digabung dengan isinya, tabel kosong jadi satu baris.
  function simplifyCards(root) {
    const recs = [];
    for (const card of [...root.children]) {
      const kids = [...card.children];
      let cur = { title: kids[0]?.classList.contains("card-title") ? kids.shift().textContent.trim() : "", actions: [], body: [] };
      recs.push(cur);
      for (const k of kids) {
        if (k.classList.contains("subhead")) {
          cur = { title: k.querySelector("h4")?.textContent.trim() || "", actions: [...k.querySelectorAll("button")], body: [] };
          recs.push(cur);
        } else cur.body.push(k);
      }
    }
    const out = [];
    recs.forEach((r, i) => {
      if (r.body.length) return out.push(r);
      const n = recs[i + 1];
      if (!n) return;
      // judul tanpa isi: tombolnya (mis. Summon "Admin Web") milik kartu isi berikutnya
      if (r.actions.length) { n.title = r.title || n.title; n.actions = [...r.actions, ...n.actions]; }
      else if (!n.title) n.title = r.title;
    });
    root.innerHTML = "";
    out.forEach((r) => {
      const [ico, col] = cardStyle(r.title);
      const card = document.createElement("section");
      card.className = "card dcard";
      card.style.setProperty("--tc", col);
      card.innerHTML = `<header class="dc-head"><span class="ico">${ICON[ico]}</span><h3>${esc(r.title || "Bagian")}</h3><div class="dc-acts"></div></header>`;
      const acts = card.querySelector(".dc-acts");
      r.actions.forEach((b) => acts.appendChild(b));
      r.body.forEach((b) => card.appendChild(b));
      const tables = card.querySelectorAll(".ptable");
      if (tables.length === 1) {
        const foot = tables[0].querySelector(".ptable-foot");
        foot?.querySelectorAll("button").forEach((b) => {
          b.classList.remove("small");
          if (b.matches("[data-addobj]")) b.innerHTML = `${ICON.plus}<span>Tambah</span>`;
          if (b.matches("[data-refresh]")) b.innerHTML = `${ICON.refresh}<span>Ambil ulang</span>`;
          acts.appendChild(b);
        });
        foot?.remove();
      }
      tables.forEach((t) => {
        const empty = t.querySelector("td.empty");
        if (empty && t.querySelectorAll("tbody tr").length === 1) t.querySelector(".xscroll").outerHTML = `<p class="dc-empty">${esc(empty.textContent)}</p>`;
      });
      const wide = [...card.querySelectorAll(".ptable table.rows")].some((t) => t.querySelectorAll("thead th").length > 5)
        || card.querySelectorAll("table.plist tr").length > 6 || card.querySelector("[data-allparams]");
      if (wide) card.classList.add("full");
      if (!card.querySelector(".ptable tbody tr td:not(.empty), table.plist, [data-faults], [data-allparams]")) card.classList.add("is-empty");
      root.appendChild(card);
    });
  }

  // menu ⋯ tertutup saat klik di luar atau memilih item
  document.addEventListener("click", (e) => {
    document.querySelectorAll("details.menu[open]").forEach((m) => { if (!m.contains(e.target) || e.target.closest(".menu-pop button, .menu-pop a")) m.open = false; });
  });

  async function doPing(el) {
    const out = el.querySelector(".ping-out"), ico = el.querySelector(".sonar");
    out.textContent = "mengukur…";
    ico?.classList.add("waiting");
    ico?.classList.remove("ok");
    try {
      const r = await get("ping?host=" + enc(el.dataset.ping));
      const avg = r?.avg ?? r?.average ?? r?.time;
      const loss = r?.packetLoss ?? r?.loss;
      out.textContent = avg != null ? `${Math.round(avg * 10) / 10} ms${loss != null ? `, hilang ${loss}%` : ""}`
        : loss != null ? `hilang ${loss}%` : "tidak ada jawaban";
      out.dataset.ok = avg != null ? "1" : "0";
      if (ico) ico.style.setProperty("--tc", avg == null ? "var(--f-red)" : avg < 20 ? "var(--f-green)" : avg < 80 ? "var(--f-yellow)" : "var(--f-orange)");
      if (avg != null) ico?.classList.add("ok");
    } catch (e) { out.textContent = e.message; out.dataset.ok = "0"; ico?.style.setProperty("--tc", "var(--f-red)"); }
    finally { ico?.classList.remove("waiting"); }
  }

  async function loadFaultsInto(el) {
    try {
      const rows = await get("faults/list?" + qs({ filter: `device = ${JSON.stringify(DEV.id)}`, limit: 100 }));
      el.innerHTML = rows.length ? `<div class="xscroll"><table class="rows"><thead><tr><th>Channel</th><th>Kode</th><th>Pesan</th><th class="num">Dicoba</th><th>Waktu</th><th></th></tr></thead><tbody>${rows.map((f) =>
        `<tr><td>${esc(f.channel)}</td><td class="mono">${esc(f.code)}</td><td class="wrap">${esc(f.message)}<div class="hint mono wrap">${esc(JSON.stringify(f.detail ?? "").slice(0, 300))}</div></td>
         <td class="num">${esc(f.retries)}</td><td class="nowrap">${esc(f.timestamp ? new Date(f.timestamp).toLocaleString("id-ID") : "")}</td>
         <td><button type="button" class="btn small" data-fault-del="${esc(f._id)}">Hapus</button></td></tr>`).join("")}</tbody></table></div>`
        : '<p class="empty">Tidak ada fault.</p>';
    } catch (e) { el.innerHTML = `<p class="empty bad">${esc(e.message)}</p>`; }
  }

  const allParamsShell = () => `<div data-allparams><div class="toolbar wide">
      <input type="search" data-ap-q placeholder="Saring parameter, mis. WANPPPConnection atau SSID" aria-label="Saring parameter" value="${esc(apSearch)}" autocomplete="off" spellcheck="false">
      <a class="btn small" data-csv href="#">Unduh CSV</a></div><div data-ap-list class="xscroll"></div></div>`;

  function renderAllParams(el) {
    el.querySelector("[data-csv]").href = BASE + "api/acs/device.csv?id=" + enc(DEV.id);
    const words = apSearch.toLowerCase().split(/\s+/).filter(Boolean);
    const keys = Object.keys(DEV.doc).filter((k) => !k.startsWith("Tags.")).sort((a, b) => a.localeCompare(b, "en", { numeric: true }));
    const hit = keys.filter((k) => { const h = (k + " " + fmt(val(DEV.doc, k))).toLowerCase(); return words.every((w) => h.includes(w)); });
    const MAX = 400;
    el.querySelector("[data-ap-list]").innerHTML = `<p class="hint">${hit.length} dari ${keys.length} parameter${hit.length > MAX ? `, ${MAX} pertama ditampilkan` : ""}</p>
      <table class="rows params"><tbody>${hit.slice(0, MAX).map((k) => {
        const x = DEV.doc[k], last = k.split(".").pop(), inst = /^\d+$/.test(last);
        let actions = `<button type="button" class="btn small" data-refresh="${esc(k)}" data-obj="${x.object ? 1 : ""}">Ambil</button>`;
        if (x.object && x.writable && !inst) actions += ` <button type="button" class="btn small" data-addobj="${esc(k)}">Tambah</button>`;
        if (x.object && x.writable && inst) actions += " " + delBtn(DEV.doc, k, true);
        return `<tr><td class="mono wrap">${esc(k)}${x.object ? ' <span class="flag">objek</span>' : ""}</td>
          <td class="mono wrap">${x.object ? "" : paramHtml(["PARAM", k], { doc: DEV.doc, id: DEV.id })}</td><td class="nowrap">${actions}</td></tr>`;
      }).join("")}</tbody></table>`;
  }

  // ------------------------------------------------------------------ lokasi (tab di Devices)
  // Subnet diubah jadi pola awalan IP karena ekspresi GenieACS tidak punya fungsi subnet:
  // 172.16.16.0/20 -> "172.16.16.%" ... "172.16.31.%"
  let LOC = { param: "VirtualParameters.IPTR069", items: [] };
  function cidrExprs(cidr, param) {
    const [ip, plen = "32"] = String(cidr).split("/");
    const o = ip.split(".").map(Number), p = Math.min(Math.max(+plen, 8), 32);
    const P = ["PARAM", param];
    if (p === 32) return [["=", P, ip]];
    const full = Math.floor(p / 8), rem = p % 8, base = o.slice(0, full);
    if (!rem) return [["LIKE", P, `${base.join(".")}.%`]];
    const span = 1 << (8 - rem), start = o[full] & (256 - span), out = [];
    for (let i = 0; i < span; i++) {
      const parts = [...base, start + i];
      out.push(parts.length === 4 ? ["=", P, parts.join(".")] : ["LIKE", P, `${parts.join(".")}.%`]);
    }
    return out;
  }
  const anyOf = (list) => (list.length === 1 ? list[0] : ["OR", ...list]);
  const locExpr = (loc) => anyOf(loc.subnets.flatMap((c) => cidrExprs(c, LOC.param)));
  function locFilter(key) {
    if (!key) return null;
    if (key === "_lain") {
      const all = LOC.items.flatMap((l) => l.subnets.flatMap((c) => cidrExprs(c, LOC.param)));
      return all.length ? ["OR", ["IS NULL", ["PARAM", LOC.param]], ["NOT", anyOf(all)]] : null;
    }
    const l = LOC.items.find((x) => x.id === key);
    return l ? locExpr(l) : null;
  }
  const ipNum = (ip) => String(ip || "").split(".").reduce((a, b) => a * 256 + (+b || 0), 0);
  function locationOf(ip) {
    if (!/^\d+\.\d+\.\d+\.\d+$/.test(String(ip || ""))) return null;
    const n = ipNum(ip);
    return LOC.items.find((l) => l.subnets.some((c) => {
      const [net, plen = 32] = c.split("/"), size = 2 ** (32 - plen), start = ipNum(net);
      return n >= start && n < start + size;
    })) || null;
  }
  const fiberOf = (id) => { const i = LOC.items.findIndex((l) => l.id === id); return i < 0 ? "var(--f-slate)" : `var(${FIBERS[i % FIBERS.length]})`; };
  async function loadLocations() {
    try {
      const s = await call("settings");
      LOC = { param: s.locations?.param || "VirtualParameters.IPTR069", items: s.locations?.items || [] };
    } catch { LOC = { param: "VirtualParameters.IPTR069", items: [] }; }
    if (LIST.loc && LIST.loc !== "_lain" && !LOC.items.some((l) => l.id === LIST.loc)) LIST.loc = "";
  }
  function renderLocTabs() {
    const tabs = [{ id: "", name: "Semua" }, ...LOC.items, ...(LOC.items.length ? [{ id: "_lain", name: "Lainnya" }] : [])];
    $("locTabs").innerHTML = tabs.map((t) => `<button type="button" role="tab" data-loc="${esc(t.id)}" aria-selected="${t.id === LIST.loc}" style="--fc:${t.subnets ? fiberOf(t.id) : "var(--line)"}"
      title="${esc(t.subnets ? t.subnets.join(", ") : t.id === "_lain" ? "IP di luar semua lokasi" : "Semua perangkat")}">${t.subnets ? '<span class="fiber"></span>' : ""}${esc(t.name)}<span class="n" data-n="${esc(t.id)}"></span></button>`).join("");
    // jumlah perangkat per tab (memperhatikan filter pencarian yang aktif)
    const extra = searchParts(), tseq = ++LIST.tabSeq;
    tabs.forEach(async (t) => {
      const parts = [...extra];
      const lf = locFilter(t.id);
      if (lf) parts.push(X.stringify(lf));
      try {
        const r = await get("devices/count?" + qs({ filter: parts.length ? parts.map((x) => `(${x})`).join(" AND ") : "true" }));
        const el = $("locTabs").querySelector(`[data-n="${CSS.escape(t.id)}"]`);
        if (el && tseq === LIST.tabSeq) el.textContent = r.total;
      } catch {}
    });
  }
  $("locTabs").addEventListener("click", (e) => {
    const b = e.target.closest("[data-loc]");
    if (!b || b.dataset.loc === LIST.loc) return;
    LIST.loc = b.dataset.loc;
    $("locTabs").querySelectorAll("[data-loc]").forEach((x) => x.setAttribute("aria-selected", String(x === b)));
    loadDevices(true, false);
  });

  function locRowHtml(l = { id: "", name: "", subnets: [] }) {
    return `<div class="loc-row" data-id="${esc(l.id)}">
      <label>Nama tab<input name="name" value="${esc(l.name)}" placeholder="mis. Kampung Wifi" maxlength="40" autocomplete="off"></label>
      <label>Alamat jaringan<input name="subnets" class="mono" value="${esc(l.subnets.join(", "))}" placeholder="mis. 172.16.0.0/20, 10.10.0.0/24" autocomplete="off" spellcheck="false"></label>
      <button type="button" class="btn-icon danger" data-loc-del title="Hapus lokasi ini" aria-label="Hapus lokasi">${ICON.trash}</button></div>`;
  }
  async function editLocations() {
    const ok = await form({
      title: "Atur lokasi", wide: true, ok: "Simpan lokasi",
      text: "Setiap lokasi menjadi tab di Devices. Perangkat masuk ke tab yang alamat jaringannya memuat IP-nya. Pisahkan beberapa jaringan dengan koma.",
      body: `<div class="loc-list">${(LOC.items.length ? LOC.items : [undefined]).map((l) => locRowHtml(l)).join("")}</div>
        <button type="button" class="btn" data-loc-add>${ICON.plus}<span>Tambah lokasi</span></button>
        <details class="fold"><summary>Lanjutan</summary><label>Parameter IP yang dipakai<input name="param" class="mono" value="${esc(LOC.param)}" spellcheck="false"></label>
        <p class="hint">Bawaan VirtualParameters.IPTR069 (IP WAN/TR069). Ganti bila lokasi ditentukan oleh parameter lain.</p></details>`,
      submit: async (f) => {
        const items = [...f.querySelectorAll(".loc-row")].map((r) => ({ id: r.dataset.id, name: r.querySelector('[name="name"]').value.trim(), subnets: r.querySelector('[name="subnets"]').value }))
          .filter((x) => x.name || x.subnets.trim());
        const r = await fetch(BASE + "api/settings", { method: "PUT", credentials: "include", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ locations: { param: f.elements.param.value.trim(), items } }) });
        const d = await r.json().catch(() => ({}));
        if (!r.ok || !d.ok) {
          const [k, m] = Object.entries(d.errors || {})[0] || ["", `Gagal menyimpan (kode ${r.status}).`];
          const i = k.match(/^locations\.(\d+)\./)?.[1];
          throw new Error(i != null ? `${items[+i]?.name || `Lokasi ${+i + 1}`}: ${m}` : m);
        }
        return true;
      },
    });
    if (ok) { toast("Lokasi disimpan.", true); await loadLocations(); loadDevices(true); }
  }
  document.addEventListener("click", (e) => {
    const add = e.target.closest("[data-loc-add]"), del = e.target.closest("[data-loc-del]");
    if (add) { const list = add.closest("form").querySelector(".loc-list"); list.insertAdjacentHTML("beforeend", locRowHtml()); list.lastElementChild.querySelector("input").focus(); }
    if (del) { const list = del.closest(".loc-list"); del.closest(".loc-row").remove(); if (!list.children.length) list.insertAdjacentHTML("beforeend", locRowHtml()); }
  });
  $("locEdit").onclick = () => editLocations().catch((x) => toast(x.message, false));

  // ------------------------------------------------------------------ daftar perangkat
  const LIST = { chips: [], raw: "", sort: null, skip: 0, rows: [], sel: new Set(), proj: "", total: 0, loc: "", seq: 0, tabSeq: 0 };
  // ikut ui.pageSize GenieACS (bawaan GenieACS 50), paling banyak 1000 baris sekali muat
  const pageSize = () => Math.min(Math.max(+CONF?.ui?.pageSize || 50, 10), 1000);

  function collect(c, out) {
    if (c == null) return;
    if (Array.isArray(c)) { X.params(c, out); return; }
    if (typeof c !== "object") return;
    for (const k of ["parameter", "filter", "label"]) if (c[k] !== undefined) X.params(c[k], out);
    if (c.element && typeof c.element === "object") Object.values(c.element.attributes || {}).forEach((e) => X.params(e, out));
    if (c.type === "overview-dot") sorted(CONF.ui.overview?.charts?.[c.chart]?.slices).forEach((s) => X.params(s.filter, out));
    if (c.components) sorted(c.components).forEach((x) => collect(x, out));
  }
  function projection() {
    if (LIST.proj) return LIST.proj;
    const s = new Set(["DeviceID.ID", "Tags", LOC.param]);
    sorted(CONF.ui.index).forEach((c) => collect(c, s));
    return (LIST.proj = [...s].filter((p) => !p.includes("*")).join(","));
  }
  function searchParts() {
    const parts = LIST.chips.map((c) => X.stringify(c.expr));
    if (LIST.raw.trim()) parts.push(LIST.raw.trim());
    return parts;
  }
  function filterString() {
    const parts = searchParts();
    const lf = locFilter(LIST.loc);
    if (lf) parts.push(X.stringify(lf));
    return parts.length ? parts.map((x) => `(${x})`).join(" AND ") : "true";
  }

  function initFilters() {
    $("fField").innerHTML = sorted(CONF.ui.filters).map((f, i) => `<option value="${i}">${esc(f.label)}</option>`).join("")
      + '<option value="id">Device ID</option>';
  }
  function addChip() {
    const v = $("fValue").value.trim();
    if (!v) return;
    const key = $("fField").value;
    let expr, label;
    if (key === "id") { expr = ["LIKE", ["PARAM", "DeviceID.ID"], `%${v}%`]; label = `Device ID ~ ${v}`; }
    else {
      const f = sorted(CONF.ui.filters)[+key];
      if (f.type === "tag") { expr = ["IS NOT NULL", ["PARAM", "Tags." + v.replace(/[^\w.:-]/g, "")]]; label = `${f.label}: ${v}`; }
      else {
        expr = ["LIKE", f.parameter, v.includes("%") || v.includes("*") ? v.replace(/\*/g, "%") : `%${v}%`];
        label = `${f.label} ~ ${v}`;
      }
    }
    LIST.chips.push({ expr, label });
    $("fValue").value = "";
    loadDevices(true);
  }
  function renderChips() {
    const chips = LIST.chips.map((c, i) => `<span class="chip-f">${esc(c.label)} <button type="button" class="x" data-chip="${i}" aria-label="Hapus filter">×</button></span>`);
    if (LIST.raw.trim()) chips.push(`<span class="chip-f mono">${esc(LIST.raw)} <button type="button" class="x" data-chip="raw" aria-label="Hapus filter ekspresi">×</button></span>`);
    $("fChips").innerHTML = chips.join("");
  }

  function headCells() {
    return sorted(CONF.ui.index).map((c) => {
      const p = Array.isArray(c.parameter) && c.parameter[0] === "PARAM" ? c.parameter[1] : "";
      const dir = p && LIST.sort?.[p];
      const label = esc(typeof c.label === "string" ? c.label : "");
      return p ? `<th><button type="button" class="sort" data-sort="${esc(p)}">${label}${dir ? (dir > 0 ? " ▲" : " ▼") : ""}</button></th>` : `<th>${label}</th>`;
    }).join("");
  }
  function rowHtml(doc) {
    const id = val(doc, "DeviceID.ID");
    const ctx = { doc, id };
    const loc = locationOf(val(doc, LOC.param));
    return `<tr data-id="${esc(id)}"${loc ? ` style="--fc:${fiberOf(loc.id)}" title="Lokasi: ${esc(loc.name)}"` : ""}><td><input type="checkbox" data-sel aria-label="Pilih ${esc(id)}" ${LIST.sel.has(id) ? "checked" : ""}></td>${
      sorted(CONF.ui.index).map((c) => `<td>${comp(c, ctx)}</td>`).join("")}</tr>`;
  }
  function renderList() {
    $("devTable").innerHTML = `<thead><tr><th><input type="checkbox" id="selAll" aria-label="Pilih semua"></th>${headCells()}</tr></thead>
      <tbody>${LIST.rows.map(rowHtml).join("") || '<tr><td colspan="99" class="empty">Tidak ada perangkat yang cocok.</td></tr>'}</tbody>`;
    syncBulk();
  }
  async function loadDevices(reset, tabsToo = true) {
    if (!CONF) return;
    renderChips();
    if (reset && tabsToo) renderLocTabs();
    // abaikan jawaban dari permintaan lama (mis. tab diklik saat daftar sebelumnya masih dimuat)
    const seq = ++LIST.seq;
    if (reset) {
      LIST.skip = 0; LIST.rows = []; LIST.sel.clear();
      $("devTable").innerHTML = '<tbody><tr><td class="empty">Membaca perangkat…</td></tr></tbody>';
    }
    const flt = filterString();
    try {
      const [rows, cnt] = await Promise.all([
        get("devices/list?" + qs({ filter: flt, limit: pageSize(), skip: LIST.skip, sort: LIST.sort ? JSON.stringify(LIST.sort) : "", projection: projection() })),
        reset ? get("devices/count?" + qs({ filter: flt })) : Promise.resolve(null),
      ]);
      if (seq !== LIST.seq) return;
      LIST.rows = LIST.rows.concat(rows);
      LIST.skip += rows.length;
      if (cnt) LIST.total = cnt.total;
      $("devCount").textContent = `${LIST.total} perangkat`;
      $("devMore").hidden = LIST.rows.length >= LIST.total || !rows.length;
      renderList();
    } catch (e) {
      if (seq !== LIST.seq) return;
      $("devTable").innerHTML = `<tbody><tr><td class="empty bad">${esc(e.message)}</td></tr></tbody>`;
      $("devCount").textContent = "";
    }
  }
  function syncBulk() {
    $("bulk").hidden = !LIST.sel.size;
    document.body.classList.toggle("has-bulk", LIST.sel.size > 0);
    $("selCount").textContent = `${LIST.sel.size} dipilih`;
    const all = $("selAll");
    if (all) all.checked = LIST.rows.length > 0 && LIST.rows.every((d) => LIST.sel.has(val(d, "DeviceID.ID")));
  }

  // jalankan fungsi untuk banyak perangkat, 4 sekaligus
  async function each(ids, fn) {
    const queue = [...ids], res = { ok: 0, fail: [] };
    await Promise.all(Array.from({ length: Math.min(4, queue.length) }, async () => {
      while (queue.length) {
        const id = queue.shift();
        try { (await fn(id)) === false ? res.fail.push(id) : res.ok++; } catch (e) { res.fail.push(`${id}: ${e.message}`); }
      }
    }));
    return res;
  }
  const report = (what, r) => toast(r.fail.length ? `${what}: ${r.ok} berhasil, ${r.fail.length} gagal (${r.fail[0]})` : `${what}: ${r.ok} berhasil.`, !r.fail.length);

  async function chooseFile() {
    const files = await get("files/list?" + qs({ filter: "true", limit: 200 }));
    if (!files.length) throw new Error("Belum ada berkas. Unggah dulu di Admin › Files.");
    return form({
      title: "Push file ke perangkat", ok: "Kirim",
      body: `<label>Berkas<select name="f">${files.map((f) => `<option value="${esc(f._id)}">${esc(f._id)} (${esc(f.metadata?.fileType || "")})</option>`).join("")}</select></label>`,
      submit: (f) => files.find((x) => x._id === f.elements.f.value),
    });
  }
  const downloadTask = (f) => ({ name: "download", fileType: f.metadata?.fileType, fileName: f._id });

  async function bulk(kind) {
    const ids = [...LIST.sel], n = ids.length;
    if (kind === "summon") {
      const btn = sorted(CONF.ui.index).find((c) => c?.type === "summon-button");
      const names = btn ? sorted(btn.parameters).map((p) => (Array.isArray(p) && p[0] === "PARAM" ? p[1] : null)).filter(Boolean) : [];
      if (!names.length) throw new Error("Config GenieACS tidak punya tombol Summon di daftar perangkat.");
      report("Summon", await each(ids, async (id) => (await runTasks(id, [{ name: "getParameterValues", parameterNames: names }], "Summon", true)).ok));
    } else if (kind === "reboot") {
      if (!(await ask({ title: `Reboot ${n} perangkat?`, text: "Internet pelanggan putus sekitar 1 sampai 2 menit.", ok: "Reboot", danger: true }))) return;
      report("Reboot", await each(ids, async (id) => (await runTasks(id, [{ name: "reboot" }], "Reboot", true)).ok));
    } else if (kind === "factoryReset") {
      if (!(await ask({ title: `Reset pabrik ${n} perangkat?`, text: "Semua pengaturan di perangkat terpilih hilang, termasuk WiFi dan PPPoE.", ok: "Reset pabrik", danger: true, confirmWord: "reset" }))) return;
      report("Reset pabrik", await each(ids, async (id) => (await runTasks(id, [{ name: "factoryReset" }], "Reset", true)).ok));
    } else if (kind === "download") {
      const f = await chooseFile();
      if (!f) return;
      report("Push file", await each(ids, async (id) => (await runTasks(id, [downloadTask(f)], "Push file", true)).ok));
    } else if (kind === "tag" || kind === "untag") {
      const t = await ask({ title: kind === "tag" ? `Tambah tag ke ${n} perangkat` : `Hapus tag dari ${n} perangkat`, ok: kind === "tag" ? "Tambah" : "Hapus", input: { label: "Nama tag" } });
      if (!t || !t.trim()) return;
      report(kind === "tag" ? "Tag" : "Untag", await each(ids, (id) => post("tags", { id, tags: { [t.trim()]: kind === "tag" } })));
    } else if (kind === "delete") {
      if (!(await ask({ title: `Hapus ${n} perangkat dari GenieACS?`, text: "Data perangkat di ACS dihapus. Perangkat terdaftar lagi saat inform berikutnya, tanpa riwayat lama.", ok: "Hapus", danger: true, confirmWord: "hapus" }))) return;
      report("Hapus", await each(ids, (id) => post("delete", { resource: "devices", id })));
    }
    loadDevices(true);
  }

  // ------------------------------------------------------------------ overview
  const onlineFilter = () => {
    const ch = CONF.ui.overview?.charts?.online, first = ch ? sorted(ch.slices)[0] : null;
    return first ? X.stringify(first.filter) : "Events.Inform > NOW() - 300000";
  };
  // hitungan dijalankan paling banyak 6 sekaligus (Overview bisa meminta puluhan), dengan satu kali coba ulang
  const countQ = { active: 0, wait: [] };
  function countOf(flt) {
    return new Promise((resolve, reject) => {
      const job = async () => {
        countQ.active++;
        try {
          const path = "devices/count?" + qs({ filter: flt || "true" });
          resolve((await get(path).catch(() => get(path))).total);
        } catch (e) { reject(e); } finally { countQ.active--; countQ.wait.shift()?.(); }
      };
      countQ.active < 6 ? job() : countQ.wait.push(job);
    });
  }

  async function showOverview() {
    if (!LOC.loaded) { await loadLocations(); LOC.loaded = true; }
    const ov = CONF.ui.overview || {};
    const groups = sorted(ov.groups);
    const box = $("overview");
    const locs = [...LOC.items, ...(LOC.items.length ? [{ id: "_lain", name: "Lainnya" }] : [])];
    box.innerHTML = `<div class="ov-summary">
        <div class="tile"><span class="ico" style="--tc:var(--f-blue)">${ICON.cpu}</span><small>Total perangkat</small><b data-count="total">…</b></div>
        <div class="tile"><span class="ico sonar ok" style="--tc:var(--f-green)">${ICON.signal}</span><small>Online sekarang</small><b data-count="online">…</b></div>
        <div class="tile"><span class="ico" style="--tc:var(--f-red)">${ICON.alert}</span><small>Fault tercatat</small><b data-count="faults">…</b></div>
        <div class="tile"><span class="ico" style="--tc:var(--f-orange)">${ICON.pin}</span><small>Lokasi</small><b data-count="locs">…</b></div>
      </div>
      ${locs.length ? `<section class="card ov-loc"><h3 class="card-title" style="--tc:var(--f-orange)"><span class="ico">${ICON.pin}</span>Perangkat per lokasi</h3>
        <div class="legend-row"><span><i style="background:var(--f-green)"></i>Online</span><span><i style="background:color-mix(in srgb, var(--f-red) 50%, transparent)"></i>Offline</span></div>
        <div class="locbars">${locs.map((l) => `<div class="locbar" data-loc="${esc(l.id)}" style="--fc:${l.subnets ? fiberOf(l.id) : "var(--f-slate)"}">
          <a class="nm" href="#devices" data-goloc="${esc(l.id)}" title="${esc(l.subnets ? l.subnets.join(", ") : "IP di luar semua lokasi")}"><i></i>${esc(l.name)}</a>
          <div class="track"><span class="on"></span><span class="off"></span></div><span class="num">…</span></div>`).join("")}</div></section>` : ""}
      ${groups.map((g, gi) => `<section class="card"><h3 class="card-title" style="--tc:var(--f-blue)"><span class="ico">${ICON.signal}</span>${esc(g.label || "Ringkasan")}</h3>
        <div class="ov-charts">${sorted(g.charts).map((name, ci) => `<div class="ov-chart" id="ov-${gi}-${ci}"><h3>${esc(ov.charts?.[name]?.label || name)}</h3><p class="empty">Menghitung…</p></div>`).join("")}</div></section>`).join("")
      || '<div class="card"><p class="empty">Config GenieACS tidak punya ui.overview.</p></div>'}`;
    const on = onlineFilter();
    countOf("true").then((n) => countUp(box.querySelector('[data-count="total"]'), n)).catch(() => {});
    countOf(on).then((n) => countUp(box.querySelector('[data-count="online"]'), n)).catch(() => {});
    get("faults/count?filter=true").then((r) => countUp(box.querySelector('[data-count="faults"]'), r.total)).catch(() => {});
    countUp(box.querySelector('[data-count="locs"]'), LOC.items.length);
    // batang per lokasi: total dan online, lalu tumbuh dari kiri
    Promise.all(locs.map(async (l) => {
      const lf = X.stringify(locFilter(l.id));
      const [total, online] = await Promise.all([countOf(lf), countOf(`(${lf}) AND (${on})`)]);
      return { l, total, online };
    })).then((rows) => {
      const max = Math.max(1, ...rows.map((r) => r.total));
      rows.forEach(({ l, total, online }) => {
        const el = box.querySelector(`.locbar[data-loc="${CSS.escape(l.id)}"]`);
        if (!el) return;
        el.querySelector(".num").innerHTML = `<b>${online}</b> online dari ${total}`;
        requestAnimationFrame(() => requestAnimationFrame(() => {
          el.querySelector(".on").style.width = `${(online / max) * 100}%`;
          el.querySelector(".off").style.width = `${((total - online) / max) * 100}%`;
        }));
      });
    }).catch(() => {});
    groups.forEach((g, gi) => sorted(g.charts).forEach(async (name, ci) => {
      const ch = ov.charts?.[name], el = $(`ov-${gi}-${ci}`);
      if (!ch) { el.querySelector(".empty").textContent = "Chart tidak ditemukan."; return; }
      const slices = sorted(ch.slices);
      try {
        const counts = await Promise.all(slices.map((s2) => countOf(X.stringify(s2.filter))));
        el.innerHTML = `<h3>${esc(ch.label || name)}</h3>` + donut(slices, counts);
        countUp(el.querySelector("svg text"), counts.reduce((a2, b2) => a2 + b2, 0));
        requestAnimationFrame(() => requestAnimationFrame(() => el.querySelectorAll("circle.seg-arc").forEach((c) => {
          c.setAttribute("stroke-dasharray", c.dataset.dash);
          c.setAttribute("stroke-dashoffset", c.dataset.off);
        })));
      } catch (e) { el.innerHTML = `<h3>${esc(ch.label || name)}</h3><p class="empty bad">${esc(e.message)}</p>`; }
    }));
  }
  $("overview").addEventListener("click", (e) => {
    const a2 = e.target.closest("[data-goloc]");
    if (!a2) return;
    LIST.loc = a2.dataset.goloc;
    LIST.chips = []; LIST.raw = "";
  });
  function donut(slices, counts) {
    const total = counts.reduce((a2, b2) => a2 + b2, 0), R = 42, C = 2 * Math.PI * R;
    let acc = 0;
    const arcs = slices.map((sl, i) => {
      const frac = total ? counts[i] / total : 0;
      const seg = frac ? `<circle class="seg-arc" r="${R}" cx="60" cy="60" fill="none" stroke="${colorOf(sl.color)}" stroke-width="20"
        stroke-dasharray="0 ${C}" stroke-dashoffset="0" data-dash="${frac * C} ${C}" data-off="${-acc * C}"><title>${esc(sl.label)}: ${counts[i]}</title></circle>` : "";
      acc += frac;
      return seg;
    }).join("");
    const legend = slices.map((sl, i) => `<li><a href="#devices?f=${enc(X.stringify(sl.filter))}"><i style="background:${colorOf(sl.color)}"></i>${esc(sl.label)}</a><b>${counts[i]}</b></li>`).join("");
    return `<div class="donut"><svg viewBox="0 0 120 120" role="img" aria-label="Total ${total}"><circle r="${R}" cx="60" cy="60" fill="none" stroke="var(--line)" stroke-width="20"/>
      <g transform="rotate(-90 60 60)">${arcs}</g><text x="60" y="66" text-anchor="middle">0</text></svg><ul>${legend}</ul></div>`;
  }

  // ------------------------------------------------------------------ faults
  const FAULTS = new Set();
  async function showFaults() {
    FAULTS.clear();
    $("faultDel").disabled = true;
    const t = $("faultTable");
    t.innerHTML = '<tbody><tr><td class="empty">Membaca faults…</td></tr></tbody>';
    try {
      const [rows, cnt] = await Promise.all([get("faults/list?" + qs({ filter: "true", limit: 500, sort: '{"timestamp":-1}' })), get("faults/count?filter=true")]);
      $("faultCount").textContent = `${cnt.total} fault`;
      t.innerHTML = `<thead><tr><th></th><th>Perangkat</th><th>Channel</th><th>Kode</th><th>Pesan</th><th class="num">Dicoba</th><th>Waktu</th></tr></thead><tbody>${rows.map((f) =>
        `<tr><td><input type="checkbox" data-fsel="${esc(f._id)}" aria-label="Pilih fault"></td><td class="mono"><a class="link" href="#device/${enc(f.device)}">${esc(f.device)}</a></td>
         <td>${esc(f.channel)}</td><td class="mono">${esc(f.code)}</td><td class="wrap">${esc(f.message)}</td><td class="num">${esc(f.retries)}</td>
         <td class="nowrap">${esc(f.timestamp ? new Date(f.timestamp).toLocaleString("id-ID") : "")}</td></tr>`).join("") || '<tr><td colspan="7" class="empty">Tidak ada fault.</td></tr>'}</tbody>`;
    } catch (e) { t.innerHTML = `<tbody><tr><td class="empty bad">${esc(e.message)}</td></tr></tbody>`; }
  }
  $("faultTable").addEventListener("change", (e) => {
    const c = e.target.closest("[data-fsel]");
    if (!c) return;
    c.checked ? FAULTS.add(c.dataset.fsel) : FAULTS.delete(c.dataset.fsel);
    $("faultDel").disabled = !FAULTS.size;
  });
  $("faultDel").onclick = async () => {
    if (!(await ask({ title: `Hapus ${FAULTS.size} fault?`, text: "GenieACS akan mencoba lagi tugas atau provision yang gagal.", ok: "Hapus", danger: true }))) return;
    report("Hapus fault", await each([...FAULTS], (id) => post("delete", { resource: "faults", id })));
    showFaults();
  };
  $("faultReload").onclick = showFaults;

  // ------------------------------------------------------------------ admin
  const ACCESS = { 1: "1: hitung", 2: "2: baca", 3: "3: tulis" };
  const firstLine = (s) => String(s ?? "").split("\n").find((l) => l.trim() && !l.trim().startsWith("//")) || "";
  const ADMIN = {
    presets: { title: "Presets", cols: [["_id", "Nama"], ["channel", "Channel"], ["weight", "Bobot"], ["schedule", "Jadwal"], ["events", "Events"], ["precondition", "Precondition"], ["provision", "Provision"], ["provisionArgs", "Argumen"]],
      fields: [["_id", "Nama"], ["channel", "Channel"], ["weight", "Bobot", "number"], ["schedule", "Jadwal"], ["events", "Events", "mono"], ["precondition", "Precondition", "mono"], ["provision", "Provision"], ["provisionArgs", "Argumen provision", "mono"]],
      body: (v) => ({ channel: v.channel, weight: Number(v.weight || 0), schedule: v.schedule, events: v.events, precondition: v.precondition, provision: v.provision, provisionArgs: v.provisionArgs }) },
    provisions: { title: "Provisions", cols: [["_id", "Nama"], ["script", "Script", firstLine]], fields: [["_id", "Nama"], ["script", "Script", "code"]], body: (v) => ({ script: v.script }) },
    virtualParameters: { title: "Virtual Parameters", cols: [["_id", "Nama"], ["script", "Script", firstLine]], fields: [["_id", "Nama"], ["script", "Script", "code"]], body: (v) => ({ script: v.script }) },
    files: { title: "Files" },
    config: { title: "Config", cols: [["_id", "Kunci"], ["value", "Nilai"]], fields: [["_id", "Kunci"], ["value", "Nilai (ekspresi)", "mono"]], body: (v) => ({ value: v.value }),
      note: "Nilai berupa ekspresi GenieACS: teks pakai tanda kutip, mis. 'Status'. Kunci ui.* mengatur tata letak menu GenieACS di sini dan di GenieACS." },
    users: { title: "Users", cols: [["_id", "Username"], ["roles", "Roles"]], fields: [["_id", "Username"], ["roles", "Roles (pisahkan dengan koma)"], ["password", "Password", "password"]], body: (v) => ({ roles: v.roles }) },
    permissions: { title: "Permissions", cols: [["role", "Role"], ["resource", "Resource"], ["access", "Akses", (a) => ACCESS[a] || a], ["validate", "Validate"]],
      fields: [["role", "Role"], ["resource", "Resource", ["devices", "faults", "files", "presets", "provisions", "config", "permissions", "users", "virtualParameters"]], ["access", "Akses", ["1", "2", "3"]], ["validate", "Validate (ekspresi)", "mono"]],
      body: (v) => ({ role: v.role, resource: v.resource, access: Number(v.access), validate: v.validate || "true" }), id: (v) => `${v.role}:${v.resource}:${v.access}`, noEdit: true },
  };
  const ADM = { sub: "presets", rows: [], q: "" };

  function fieldHtml([k, label, kind], v, isNew) {
    const cur = v?.[k] ?? (k === "validate" ? "true" : "");
    if (Array.isArray(kind)) return `<label>${esc(label)}<select name="${k}">${kind.map((o) => `<option ${String(cur) === o ? "selected" : ""}>${esc(o)}</option>`).join("")}</select></label>`;
    if (kind === "code") return `<label>${esc(label)}<textarea name="${k}" class="code" rows="18" spellcheck="false">${esc(cur)}</textarea></label>`;
    const ro = k === "_id" && !isNew ? "readonly" : "";
    const type = kind === "number" ? 'inputmode="numeric"' : kind === "password" ? 'type="password" autocomplete="new-password"' : 'autocomplete="off"';
    return `<label>${esc(label)}<input name="${k}" value="${esc(kind === "password" ? "" : cur)}" ${type} ${ro} class="${kind === "mono" ? "mono" : ""}" spellcheck="false"></label>`;
  }

  async function showAdmin(sub) {
    ADM.sub = ADMIN[sub] ? sub : "presets";
    document.querySelectorAll("[data-sub]").forEach((a) => a.setAttribute("aria-current", a.dataset.sub === ADM.sub ? "page" : "false"));
    $("admin").innerHTML = '<p class="empty">Membaca…</p>';
    try {
      ADM.rows = await get(`${ADM.sub}/list?` + qs({ filter: "true", limit: 1000 }));
      renderAdmin();
    } catch (e) { $("admin").innerHTML = `<p class="empty bad">${esc(e.message)}</p>`; }
  }

  function renderAdmin() {
    if (ADM.sub === "files") return renderFiles();
    const d = ADMIN[ADM.sub];
    const words = ADM.q.toLowerCase().split(/\s+/).filter(Boolean);
    const rows = ADM.rows.filter((r) => { const h = JSON.stringify(r).toLowerCase(); return words.every((w) => h.includes(w)); });
    const MAX = 400;
    $("admin").innerHTML = `<div class="block-head"><h2>${esc(d.title)}</h2><div class="toolbar">
        <input type="search" data-adm-q value="${esc(ADM.q)}" placeholder="Saring" aria-label="Saring ${esc(d.title)}" autocomplete="off">
        <button type="button" class="btn primary" data-adm-new>Tambah</button><button type="button" class="btn" data-adm-reload>Muat ulang</button></div></div>
      ${d.note ? `<p class="hint">${esc(d.note)}</p>` : ""}<p class="hint">${rows.length} entri${rows.length > MAX ? `, ${MAX} pertama ditampilkan` : ""}</p>
      <div class="xscroll"><table class="rows"><thead><tr>${d.cols.map((c) => `<th>${esc(c[1])}</th>`).join("")}<th></th></tr></thead><tbody>${
        rows.slice(0, MAX).map((r) => `<tr data-rid="${esc(r._id)}">${d.cols.map(([k, , f]) => `<td class="${/^(_id|value|precondition|validate)$/.test(k) ? "mono wrap" : "wrap"}">${esc(f ? f(r[k]) : typeof r[k] === "object" && r[k] ? JSON.stringify(r[k]) : r[k] ?? "")}</td>`).join("")}
          <td class="nowrap">${d.noEdit ? "" : '<button type="button" class="btn small" data-adm-edit>Ubah</button> '}${ADM.sub === "users" ? '<button type="button" class="btn small" data-adm-pass>Password</button> ' : ""}<button type="button" class="btn small danger" data-adm-del>Hapus</button></td></tr>`).join("")
        || '<tr><td colspan="99" class="empty">Belum ada entri.</td></tr>'}</tbody></table></div>`;
  }

  async function admEdit(row) {
    const d = ADMIN[ADM.sub], isNew = !row;
    const fields = d.fields.filter(([k]) => !(k === "password" && !isNew));
    const ok = await form({
      title: `${isNew ? "Tambah" : "Ubah"} ${d.title}`, wide: fields.some((f) => f[2] === "code"), ok: "Simpan",
      body: fields.map((f) => fieldHtml(f, row, isNew)).join(""),
      submit: async (f) => {
        const v = Object.fromEntries(fields.map(([k]) => [k, f.elements[k].value]));
        const id = d.id ? d.id(v) : (row?._id ?? v._id.trim());
        if (!id) throw new Error("Nama wajib diisi.");
        if (ADM.sub === "users" && isNew && !v.password) throw new Error("Password wajib diisi untuk user baru.");
        await post("put", { resource: ADM.sub, id, body: d.body(v) });
        if (ADM.sub === "users" && isNew) await post("password", { user: id, password: v.password });
        return true;
      },
    });
    if (ok) {
      toast("Tersimpan.", true);
      if (ADM.sub === "config") await loadConfig(true);
      showAdmin(ADM.sub);
    }
  }

  function renderFiles() {
    $("admin").innerHTML = `<div class="block-head"><h2>Files</h2><div class="toolbar"><button type="button" class="btn primary" data-file-up>Unggah</button>
        <button type="button" class="btn" data-adm-reload>Muat ulang</button></div></div>
      <div class="xscroll"><table class="rows"><thead><tr><th>Nama</th><th>Jenis</th><th>OUI</th><th>Product class</th><th>Versi</th><th class="num">Ukuran</th><th>Diunggah</th><th></th></tr></thead><tbody>${
        ADM.rows.map((f) => `<tr data-rid="${esc(f._id)}"><td class="mono wrap">${esc(f._id)}</td><td>${esc(f.metadata?.fileType ?? "")}</td><td>${esc(f.metadata?.oui ?? "")}</td>
          <td>${esc(f.metadata?.productClass ?? "")}</td><td>${esc(f.metadata?.version ?? "")}</td><td class="num">${esc(f.length != null ? Math.round(f.length / 1024) + " KB" : "")}</td>
          <td class="nowrap">${esc(f.uploadDate ? new Date(f.uploadDate).toLocaleString("id-ID") : "")}</td>
          <td class="nowrap"><a class="btn small" href="${esc(BASE + "api/acs/files/blob?name=" + enc(f._id))}">Unduh</a> <button type="button" class="btn small danger" data-adm-del>Hapus</button></td></tr>`).join("")
        || '<tr><td colspan="8" class="empty">Belum ada berkas.</td></tr>'}</tbody></table></div>`;
  }

  async function uploadFile() {
    const types = ["1 Firmware Upgrade Image", "2 Web Content", "3 Vendor Configuration File", "4 Tone File", "5 Ringer File"];
    const ok = await form({
      title: "Unggah berkas", ok: "Unggah",
      body: `<label>Berkas<input type="file" name="file"></label><label>Nama (kosongkan untuk memakai nama berkas)<input name="name" autocomplete="off"></label>
        <label>Jenis<select name="type">${types.map((t) => `<option>${t}</option>`).join("")}</select></label>
        <label>OUI<input name="oui" autocomplete="off"></label><label>Product class<input name="pc" autocomplete="off"></label><label>Versi<input name="ver" autocomplete="off"></label>`,
      submit: async (f) => {
        const file = f.elements.file.files[0];
        if (!file) throw new Error("Pilih berkas dulu.");
        const name = f.elements.name.value.trim() || file.name;
        const r = await fetch(BASE + "api/acs/files/upload?" + qs({ name, fileType: f.elements.type.value, oui: f.elements.oui.value, productClass: f.elements.pc.value, version: f.elements.ver.value }),
          { method: "POST", credentials: "include", headers: { "Content-Type": "application/octet-stream", "X-Ontloop": "1" }, body: file });
        const d = await r.json().catch(() => ({}));
        if (!r.ok || d.ok === false) throw new Error(d.message || `Unggah gagal (kode ${r.status}).`);
        return true;
      },
    });
    if (ok) { toast("Berkas diunggah.", true); showAdmin("files"); }
  }

  $("admin").addEventListener("input", (e) => {
    if (!e.target.matches("[data-adm-q]")) return;
    ADM.q = e.target.value;
    const pos = e.target.selectionStart;
    renderAdmin();
    const q = $("admin").querySelector("[data-adm-q]");
    q.focus();
    q.setSelectionRange(pos, pos);
  });
  $("admin").addEventListener("click", async (e) => {
    const b = e.target.closest("button");
    if (!b) return;
    const rid = b.closest("[data-rid]")?.dataset.rid;
    const row = ADM.rows.find((r) => r._id === rid);
    try {
      if (b.matches("[data-adm-new]")) await admEdit(null);
      else if (b.matches("[data-adm-reload]")) showAdmin(ADM.sub);
      else if (b.matches("[data-adm-edit]")) await admEdit(row);
      else if (b.matches("[data-file-up]")) await uploadFile();
      else if (b.matches("[data-adm-pass]")) {
        const p = await ask({ title: `Ganti password ${rid}`, ok: "Simpan", input: { label: "Password baru", type: "password" } });
        if (p) { await post("password", { user: rid, password: p }); toast("Password diganti.", true); }
      } else if (b.matches("[data-adm-del]")) {
        if (!(await ask({ title: `Hapus ${rid}?`, text: `Entri ${ADMIN[ADM.sub].title} ini dihapus dari GenieACS.`, ok: "Hapus", danger: true }))) return;
        await post("delete", { resource: ADM.sub, id: rid });
        toast("Dihapus.", true);
        if (ADM.sub === "config") await loadConfig(true);
        showAdmin(ADM.sub);
      }
    } catch (x) { toast(x.message, false); }
  });

  // ------------------------------------------------------------------ klik di daftar dan halaman perangkat
  async function onDeviceClick(e) {
    const b = e.target.closest("button");
    if (!b) return;
    const inList = !!b.closest("#devTable");
    const id = b.dataset.id || b.closest("[data-id]")?.dataset.id || DEV?.id;
    const doc = inList ? LIST.rows.find((d) => val(d, "DeviceID.ID") === id) : DEV?.doc;
    const after = () => (inList ? loadDevices(true) : reloadDevice());
    try {
      if (b.matches("[data-summon]")) {
        b.disabled = true;
        b.textContent = "…";
        await readSafe(id, JSON.parse(b.dataset.summon), "Summon");
        after();
      } else if (b.matches("[data-edit]")) { const r = await editParam(doc, b.dataset.edit, id, !inList); if (r === "sent") after(); else if (r) renderDevice(); }
      else if (b.matches("[data-editrow]")) { const r = await editRow(doc, b.dataset.editrow, JSON.parse(b.dataset.cols), id); if (r === "sent") after(); else if (r) renderDevice(); }
      else if (b.matches("[data-pend-send]")) await sendPending(b);
      else if (b.matches("[data-pend-del]")) { pendingOf(id).delete(b.dataset.pendDel); renderDevice(); }
      else if (b.matches("[data-pend-clear]")) { PENDING.delete(id); renderDevice(); }
      else if (b.matches("[data-refresh]")) {
        const p = b.dataset.refresh;
        b.disabled = true;
        await readSafe(id, [p], "Ambil " + p.split(".").pop());
        after();
      } else if (b.matches("[data-addobj]")) {
        const p = b.dataset.addobj;
        if (/\.(WANPPPConnection|WANIPConnection)$/.test(p) && !inList) { await createWan(id, p); return after(); }
        if (!(await ask({ title: "Tambah instance?", text: `Instance baru dibuat di ${p}. Isi nilainya lewat tombol ✎ setelah selesai.`, ok: "Tambah" }))) return;
        await runTasks(id, [{ name: "addObject", objectName: p }, { name: "refreshObject", objectName: p }], "Tambah instance");
        after();
      } else if (b.matches("[data-delobj]")) {
        const p = b.dataset.delobj;
        if (!(await ask({ title: `Hapus ${p.split(".").slice(-2).join(".")}?`, text: `Instance ${p} dihapus dari ONT beserta semua isinya.`, ok: "Hapus", danger: true }))) return;
        await runTasks(id, [{ name: "deleteObject", objectName: p }, { name: "refreshObject", objectName: p.replace(/\.\d+$/, "") }], "Hapus instance");
        after();
      } else if (b.matches("[data-tag-add]")) {
        const t = await ask({ title: "Tambah tag", ok: "Tambah", input: { label: "Nama tag" } });
        if (t && t.trim()) { await post("tags", { id, tags: { [t.trim()]: true } }); after(); }
      } else if (b.matches("[data-tag-del]")) { await post("tags", { id, tags: { [b.dataset.tagDel]: false } }); after(); }
      else if (b.matches("[data-ping-run]")) doPing(b.closest("[data-ping]"));
      else if (b.matches("[data-fault-del]")) { await post("delete", { resource: "faults", id: b.dataset.faultDel }); toast("Fault dihapus.", true); after(); }
      else if (b.matches("[data-reload-dev]")) reloadDevice();
      else if (b.matches("[data-act]")) await deviceAction(b.dataset.act, id);
    } catch (x) {
      toast(x.message, false);
      if (b.matches("[data-summon]")) { b.disabled = false; b.textContent = "Summon"; }
      if (b.matches("[data-refresh]")) b.disabled = false;
    }
  }

  async function deviceAction(a, id) {
    if (a === "reboot") {
      if (await ask({ title: `Reboot ${id}?`, text: "Internet pelanggan putus sekitar 1 sampai 2 menit.", ok: "Reboot", danger: true })) await runTasks(id, [{ name: "reboot" }], "Reboot");
    } else if (a === "factoryReset") {
      if (await ask({ title: `Reset pabrik ${id}?`, text: "Semua pengaturan di perangkat ini hilang, termasuk WiFi dan PPPoE.", ok: "Reset pabrik", danger: true, confirmWord: "reset" }))
        await runTasks(id, [{ name: "factoryReset" }], "Reset pabrik");
    } else if (a === "download") {
      const f = await chooseFile();
      if (f) await runTasks(id, [downloadTask(f)], "Push file");
    } else if (a === "refreshAll") {
      await runTasks(id, [{ name: "refreshObject", objectName: "" }], "Ambil ulang semua");
      reloadDevice();
    } else if (a === "delete") {
      if (await ask({ title: `Hapus ${id} dari GenieACS?`, text: "Data perangkat di ACS dihapus. Perangkat terdaftar lagi saat inform berikutnya.", ok: "Hapus", danger: true, confirmWord: "hapus" })) {
        await post("delete", { resource: "devices", id });
        toast("Perangkat dihapus dari GenieACS.", true);
        location.hash = "#devices";
      }
    }
  }

  $("device").addEventListener("click", onDeviceClick);
  $("device").addEventListener("click", (e) => { const t = e.target.closest(".tile.ping"); if (t && !e.target.closest("a")) doPing(t); });
  pendBarEl.addEventListener("click", onDeviceClick);
  $("device").addEventListener("input", (e) => {
    if (e.target.matches("[data-ap-q]")) { apSearch = e.target.value; renderAllParams(e.target.closest("[data-allparams]")); }
  });
  $("devTable").addEventListener("click", (e) => {
    const s = e.target.closest("[data-sort]");
    if (s) {
      const p = s.dataset.sort, cur = LIST.sort?.[p];
      LIST.sort = cur === 1 ? { [p]: -1 } : cur === -1 ? null : { [p]: 1 };
      return loadDevices(true);
    }
    onDeviceClick(e);
  });
  $("devTable").addEventListener("change", (e) => {
    if (e.target.id === "selAll") {
      LIST.rows.forEach((d) => (e.target.checked ? LIST.sel.add(val(d, "DeviceID.ID")) : LIST.sel.delete(val(d, "DeviceID.ID"))));
      $("devTable").querySelectorAll("[data-sel]").forEach((c) => (c.checked = e.target.checked));
    } else if (e.target.matches("[data-sel]")) {
      const id = e.target.closest("[data-id]").dataset.id;
      e.target.checked ? LIST.sel.add(id) : LIST.sel.delete(id);
    }
    syncBulk();
  });
  document.querySelectorAll("[data-bulk]").forEach((b) => (b.onclick = async () => {
    $("bulk").classList.add("busy");
    try { await bulk(b.dataset.bulk); } catch (x) { toast(x.message, false); } finally { $("bulk").classList.remove("busy"); }
  }));
  $("selClear").onclick = () => { LIST.sel.clear(); $("devTable").querySelectorAll("[data-sel]").forEach((c) => (c.checked = false)); syncBulk(); };
  $("fAdd").onclick = addChip;
  $("fValue").addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); addChip(); } });
  $("fRawToggle").onclick = () => {
    const box = $("fRawBox");
    box.hidden = !box.hidden;
    $("fRawToggle").setAttribute("aria-expanded", String(!box.hidden));
    if (!box.hidden) $("fRaw").focus();
  };
  const applyRaw = () => { LIST.raw = $("fRaw").value; loadDevices(true); };
  $("fRawApply").onclick = applyRaw;
  $("fRaw").addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); applyRaw(); } });
  $("fChips").onclick = (e) => {
    const b = e.target.closest("[data-chip]");
    if (!b) return;
    if (b.dataset.chip === "raw") { LIST.raw = ""; $("fRaw").value = ""; } else LIST.chips.splice(+b.dataset.chip, 1);
    if (location.hash.includes("?")) history.replaceState(null, "", "#devices");
    loadDevices(true);
  };
  $("devMore").onclick = () => loadDevices(false);
  $("devReload").onclick = () => loadDevices(true);
  $("devCsv").onclick = () => {
    const cols = {};
    sorted(CONF.ui.index).forEach((c) => { if (c.parameter !== undefined && typeof c.label === "string") cols[c.label] = X.stringify(c.parameter); });
    location.href = BASE + "api/acs/devices.csv?" + qs({ filter: filterString(), columns: JSON.stringify(cols) });
  };

  // ------------------------------------------------------------------ navigasi
  function show(panel, tab) {
    document.body.classList.remove("has-bulk");
    $("bulk").hidden = panel !== "devices" || !LIST.sel.size;
    pendBarEl.hidden = true;
    document.querySelectorAll("[data-panel]").forEach((p) => (p.hidden = p.dataset.panel !== panel));
    document.querySelectorAll(".tabs [data-tab]").forEach((a) => a.setAttribute("aria-current", a.dataset.tab === tab ? "page" : "false"));
  }

  async function loadConfig(force = false) {
    if (CONF && !force) return true;
    try {
      const c = await get("config");
      CONF = c;
      LIST.proj = "";
      $("replayNote").hidden = !c.replay;
      $("setupNote").hidden = true;
      $("acsVersion").textContent = c.version && c.version !== "replay" ? `GenieACS ${c.version}` : "";
      initFilters();
      return true;
    } catch (e) {
      $("setupMsg").textContent = e.message;
      $("setupNote").hidden = false;
      return false;
    }
  }

  async function route() {
    const h = location.hash.slice(1) || "devices";
    const [path, query = ""] = h.split("?");
    const parts = path.split("/");
    const tab = parts[0];
    if (tab === "conn") return show("conn", "conn");
    if (!(await loadConfig())) return show("conn", "conn");
    if (tab === "device") { show("device", "devices"); if (!LOC.loaded) { await loadLocations(); LOC.loaded = true; } return showDevice(decodeURIComponent(parts.slice(1).join("/"))); }
    if (tab === "overview") { show("overview", "overview"); return showOverview(); }
    if (tab === "faults") { show("faults", "faults"); return showFaults(); }
    if (tab === "admin") { show("admin", "admin"); return showAdmin(parts[1] || "presets"); }
    show("devices", "devices");
    if (!LOC.loaded) { await loadLocations(); LOC.loaded = true; }
    const f = new URLSearchParams(query).get("f");
    if (f != null) { LIST.raw = f; LIST.chips = []; $("fRaw").value = f; $("fRawBox").hidden = false; }
    loadDevices(true);
  }
  addEventListener("hashchange", route);
  // setelah koneksi disimpan di tab Koneksi, config GenieACS dibaca ulang saat menu lain dibuka
  $("form").addEventListener("submit", () => { CONF = null; });
  route();
})();
