(() => {
  "use strict";
  const $ = (id) => document.getElementById(id);
  // alamat dasar tanpa user:password, supaya fetch tetap jalan bila halaman dibuka dengan kredensial di URL
  const BASE = location.origin + location.pathname.replace(/[^/]*$/, "");
  const api = (p, opt) => fetch(BASE + "api/" + p, { credentials: "include", ...opt });
  const esc = (s) =>
    String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const css = (v) => getComputedStyle(document.documentElement).getPropertyValue(v).trim();
  const calm = matchMedia("(prefers-reduced-motion: reduce)").matches; // pengguna minta animasi dikurangi
  const fmtTime = (ts) => new Date(ts * 1000).toLocaleTimeString("id-ID", { hour: "2-digit", minute: "2-digit" });
  const fmtDay = (ts) =>
    new Date(ts * 1000).toLocaleDateString("id-ID", { day: "numeric", month: "short" }) + " " + fmtTime(ts);
  const fmtDur = (sec) => {
    const m = Math.max(1, Math.round(sec / 60));
    return m < 60 ? `${m} menit` : `${Math.floor(m / 60)} jam ${m % 60} menit`;
  };
  const ICON = {
    kuat: '<svg viewBox="0 0 12 12" aria-hidden="true"><path d="M6 1 11.5 11H.5z" fill="currentColor"/></svg>',
    berisiko: '<svg viewBox="0 0 12 12" aria-hidden="true"><circle cx="6" cy="6" r="5" fill="currentColor"/></svg>',
    normal: '<svg viewBox="0 0 12 12" aria-hidden="true"><circle cx="6" cy="6" r="4" fill="none" stroke="currentColor" stroke-width="2"/></svg>',
  };
  const LEVEL = { kuat: "Tersangka kuat", berisiko: "Berisiko", normal: "Pantau" };
  const FLAG = { flap: "berpindah port", hotspot_lan: "hotspot lewat LAN", cross: "terlihat di trunk lain", multi: "ada di ONT lain" };

  let hours = 3, charts = [], series = null, chartKey = "", bandList = [];
  // pilihan rincian MAC di bawah chart: null = titik tertinggi otomatis, {ts} = titik yang diklik, {range:true} = seluruh rentang
  let moveSel = null, moveTs = null, moveKey = "";
  const open = new Set();
  const last = {}; // tanda tangan tiap bagian, supaya hanya digambar ulang bila datanya berubah
  let firstOpenDone = false, firstList = true;
  const changed = (key, value) => {
    const sig = JSON.stringify(value);
    if (last[key] === sig) return false;
    last[key] = sig;
    return true;
  };

  // ------------------------------------------------------------------ tema
  const saved = (() => { try { return localStorage.getItem("theme"); } catch { return null; } })();
  if (saved) document.documentElement.dataset.theme = saved;
  $("btnTheme").onclick = () => {
    const dark = document.documentElement.dataset.theme
      ? document.documentElement.dataset.theme === "dark"
      : matchMedia("(prefers-color-scheme: dark)").matches;
    const next = dark ? "light" : "dark";
    document.documentElement.dataset.theme = next;
    try { localStorage.setItem("theme", next); } catch {}
    chartKey = "";
    drawCharts();
  };

  // ------------------------------------------------------------------ status + skema
  function renderStatus(s) {
    const el = $("status"), lp = s.loop, top = s.suspects.find((x) => x.level === "kuat");
    const risk = s.counts.risk;
    $("stateLine").textContent = `Dipantau langsung, terakhir ${fmtTime(s.ts)}`;
    const view = { a: lp.active, k: lp.known, b: lp.blocked_vlans, r: lp.reasons, t: top?.serial, tk: top?.trunk, risk };
    if (changed("status", view)) {
      el.dataset.state = lp.active ? "loop" : "ok";
      if (lp.active) {
        $("statusTitle").textContent = "Loop sedang terjadi";
        const a = $("statusAction");
        a.hidden = false;
        a.innerHTML = top
          ? `Periksa dulu ONT <b>${esc(top.serial)}</b>${top.trunk ? " di trunk " + esc(top.trunk) : ""}. Cabut perangkat yang tercolok di port LAN-nya.`
          : "Belum ada ONT yang terbukti jadi penyebab. Periksa ONT berisiko di daftar bawah, mulai dari skor tertinggi.";
      } else if (lp.known === false) {
        el.dataset.state = "unknown";
        $("statusTitle").textContent = "Status loop belum bisa dipastikan";
        $("statusAction").hidden = true;
      } else {
        $("statusTitle").textContent = "Jaringan normal";
        $("statusAction").hidden = true;
      }
      $("statusWhy").innerHTML = lp.reasons.map((r, i) => `<li style="--i:${i}">${esc(r)}</li>`).join("");
    }
    // kalimat ini memuat durasi, jadi diperbarui tiap putaran tanpa menggambar ulang yang lain
    if (lp.active) {
      const where = lp.blocked_vlans.length ? `${lp.blocked_vlans.join(", ")} diblokir router` : "Belum ada VLAN yang diblokir router";
      const since = s.incident_start ? `, sejak ${fmtTime(s.incident_start)} (${fmtDur(s.ts - s.incident_start)})` : "";
      $("statusSub").textContent = where + since + ".";
    } else if (lp.known === false) {
      const bad = s.sources.filter((x) => x.name !== "genieacs").map((x) => `${x.label} ${x.enabled ? "gagal dibaca" : "belum diatur"}`);
      $("statusSub").innerHTML = `${esc(bad.join(", "))}. Tanpa keduanya aplikasi hanya bisa menandai ONT berisiko, bukan memastikan ada loop. Isi di halaman <a href="pengaturan">Pengaturan</a>.`;
    } else {
      $("statusSub").textContent = risk
        ? `Tidak ada loop. ${risk} ONT punya perangkat di port LAN yang bisa memicu loop berikutnya.`
        : "Tidak ada loop dan tidak ada ONT yang berisiko.";
    }
    const trunks = new Set();
    s.suspects.forEach((x) => x.trunk && trunks.add(x.trunk));
    s.flapping.forEach((f) => f.ports.forEach((p) => trunks.add(p)));
    const pv = { list: [...trunks].sort().slice(0, 3), a: lp.active, n: s.counts.flapping_macs, t: top?.serial, tk: top?.trunk };
    if (changed("path", pv)) $("path").innerHTML = pathSvg(pv);
  }

  // titik kecil yang berjalan di sepanjang garis (paket data)
  const packets = (d, n, dur, bad) => {
    if (calm) return "";
    let out = "";
    for (let i = 0; i < n; i++)
      out += `<circle class="pkt${bad ? " bad" : ""}" r="${bad ? 3.6 : 3}"><animateMotion dur="${dur}s" begin="${((-dur * i) / n).toFixed(2)}s" repeatCount="indefinite" path="${d}"/></circle>`;
    return out;
  };

  // ---- ilustrasi perangkat (SVG buatan sendiri, tanpa logo atau gambar dari luar)
  const blink = (i, slow) => `class="lk" style="animation-delay:${((i * 0.37) % 1.3).toFixed(2)}s${slow ? ";animation-duration:2.4s" : ""}"`;
  const label = (cx, y, title, sub, hot) =>
    `<text class="dev-t${hot ? " warn" : ""}" x="${cx}" y="${y}" text-anchor="middle">${esc(title)}</text>` +
    `<text class="sub" x="${cx}" y="${y + 13}" text-anchor="middle">${esc(sub)}</text>`;
  // server rak 1U (router MikroTik x86, mis. Dell PowerEdge)
  function serverArt(x, cy) {
    const y = cy - 15;
    let bays = "";
    for (let i = 0; i < 4; i++) bays += `<rect x="${x + 50 + i * 9}" y="${y + 9}" width="7" height="12" rx="1" fill="#2c323a" stroke="#4a525d" stroke-width=".6"/><circle cx="${x + 53.5 + i * 9}" cy="${y + 19}" r=".9" fill="#3ddc84" ${blink(i)}/>`;
    let grill = "";
    for (let i = 0; i < 7; i++) grill += `<path d="M${x + 13 + i * 4.4} ${y + 8} l2 4 l-2 4 l2 4" stroke="#5b6470" stroke-width=".8" fill="none"/>`;
    return `<g class="dev">
      <rect x="${x}" y="${y}" width="92" height="30" rx="3.5" fill="url(#gSrv)" stroke="#0b0e12"/>
      <rect x="${x + 1.5}" y="${y + 2}" width="5" height="26" rx="1.2" fill="#3a414b"/><rect x="${x + 85.5}" y="${y + 2}" width="5" height="26" rx="1.2" fill="#3a414b"/>
      ${grill}<circle cx="${x + 46}" cy="${y + 15}" r="3.2" fill="#9aa7b6" stroke="#d7dde4" stroke-width=".7"/>
      ${bays}<circle cx="${x + 9.5}" cy="${y + 6}" r="1.4" fill="#4aa3ff" class="pwr"/>
    </g>`;
  }
  // switch rak 1U (Cisco Catalyst): dua baris port RJ45 dengan lampu link
  function switchArt(x, cy) {
    const y = cy - 15;
    let ports = "";
    for (let r = 0; r < 2; r++) for (let i = 0; i < 8; i++) {
      const px = x + 22 + i * 7.6, py = y + 7 + r * 10;
      ports += `<rect x="${px}" y="${py}" width="6" height="6.5" rx=".8" fill="#1d232a"/><rect x="${px + .6}" y="${py - 2}" width="1.6" height="1.2" fill="#41e07b" ${blink(r * 8 + i)}/>`;
    }
    return `<g class="dev">
      <rect x="${x}" y="${y}" width="92" height="30" rx="3.5" fill="url(#gSw)" stroke="#55677a"/>
      <rect x="${x + 4}" y="${y + 5}" width="14" height="20" rx="2" fill="#20303f"/><circle cx="${x + 8}" cy="${y + 10}" r="1.3" fill="#41e07b"/><circle cx="${x + 13}" cy="${y + 10}" r="1.3" fill="#ffb020" ${blink(3, true)}/>
      ${ports}<rect x="${x + 84}" y="${y + 8}" width="5" height="6" rx=".8" fill="#1d232a"/><rect x="${x + 84}" y="${y + 17}" width="5" height="6" rx=".8" fill="#1d232a"/>
    </g>`;
  }
  // sasis OLT dengan port PON
  function oltArt(x, cy, i0) {
    const y = cy - 16;
    let pon = "";
    for (let i = 0; i < 8; i++) pon += `<rect x="${x + 24 + i * 7.4}" y="${y + 17}" width="5.4" height="8" rx="1" fill="#1a2027"/><circle cx="${x + 26.7 + i * 7.4}" cy="${y + 12}" r="1.2" fill="#41e07b" ${blink(i0 * 3 + i)}/>`;
    return `<g class="dev">
      <rect x="${x}" y="${y}" width="92" height="32" rx="3.5" fill="url(#gOlt)" stroke="#0d1116"/>
      <rect x="${x + 4}" y="${y + 5}" width="16" height="9" rx="1.5" fill="#0e3a2a" stroke="#1d5c43" stroke-width=".6"/>
      <text x="${x + 12}" y="${y + 11.6}" text-anchor="middle" class="lcd">PON</text>
      ${pon}<rect x="${x + 85}" y="${y + 6}" width="4" height="20" rx="1" fill="#2b323b"/>
    </g>`;
  }
  // ONT pelanggan: kotak putih dua antena
  function ontArt(x, cy, hot) {
    const y = cy - 13;
    return `<g class="dev${hot ? " ont-hot" : ""}">
      <path d="M${x + 9} ${y + 2} l-3 -12 M${x + 49} ${y + 2} l3 -12" stroke="#c9ced6" stroke-width="3" stroke-linecap="round"/>
      <rect x="${x}" y="${y}" width="58" height="26" rx="6" fill="url(#gOnt)" stroke="${hot ? "var(--critical)" : "#c4cbd4"}" stroke-width="${hot ? 2 : 1}"/>
      <circle cx="${x + 12}" cy="${y + 13}" r="1.6" fill="#36c46a"/><circle cx="${x + 19}" cy="${y + 13}" r="1.6" fill="#36c46a"/>
      <circle cx="${x + 26}" cy="${y + 13}" r="1.6" fill="${hot ? "#ff3b3b" : "#cfd5dc"}" ${hot ? 'class="lk fast"' : ""}/>
      <circle cx="${x + 33}" cy="${y + 13}" r="1.6" fill="#36c46a" ${blink(2)}/><rect x="${x + 41}" y="${y + 9}" width="11" height="8" rx="2" fill="#e3e7ec"/>
    </g>`;
  }
  const DEFS = `<defs>
    <linearGradient id="gSrv" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#3b424c"/><stop offset=".5" stop-color="#1c2128"/><stop offset="1" stop-color="#121519"/></linearGradient>
    <linearGradient id="gSw" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#dfe7ee"/><stop offset=".55" stop-color="#b9c7d4"/><stop offset="1" stop-color="#94a6b7"/></linearGradient>
    <linearGradient id="gOlt" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#4a525d"/><stop offset="1" stop-color="#1d2228"/></linearGradient>
    <linearGradient id="gOnt" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#ffffff"/><stop offset="1" stop-color="#e2e7ed"/></linearGradient>
  </defs>`;

  function pathSvg({ list, a: active, n, t: topSerial, tk: topTrunk }) {
    list = list.length ? list : ["Trunk OLT"];
    const H = Math.max(180, list.length * 86 + 26), mid = H / 2 - 8;
    const ys = list.map((_, i) => (list.length === 1 ? mid : 34 + (i * (H - 92)) / (list.length - 1)));
    let wires = "", pk = "", devs = "";
    const w0 = `M96 ${mid} L130 ${mid}`;
    wires += `<path class="wire" d="${w0}"/>`;
    pk += packets(w0, 1, 1.4, false);
    devs += serverArt(4, mid) + label(50, mid + 30, "MikroTik", "Router x86") + switchArt(130, mid) + label(176, mid + 30, "Cisco", "Switch");
    list.forEach((t, i) => {
      const d = `M222 ${mid} C246 ${mid} 246 ${ys[i]} 270 ${ys[i]}`;
      wires += `<path class="wire" d="${d}"/>`;
      pk += packets(d, 1, 1.8 + i * 0.35, false);
      devs += oltArt(270, ys[i], i) + label(316, ys[i] + 31, t, "ke OLT");
    });
    const ti = topSerial ? list.indexOf(topTrunk) : -1;
    if (ti >= 0) {
      wires += `<path class="wire" d="M362 ${ys[ti]} L402 ${ys[ti]}"/>`;
      if (!calm) devs += `<rect class="halo" x="398" y="${ys[ti] - 17}" width="66" height="34" rx="9"/>`;
      devs += ontArt(402, ys[ti], true) + label(431, ys[ti] + 28, topSerial, "ONT tersangka", true);
    }
    let loop = "";
    if (active && list.length > 1) {
      const a = ys[0], b = ys[list.length - 1], x0 = ti >= 0 ? 462 : 364;
      const d = `M${ti === 0 ? x0 : 364} ${a} C${x0 + 52} ${a} ${x0 + 52} ${b} ${ti === list.length - 1 ? x0 : 364} ${b}`;
      loop = `<path class="loop" d="${d}"/>` + packets(d, 3, 2.2, true);
      // teks di sisi dalam lengkung, sedikit di bawah label ONT agar tidak bertabrakan
      loop += `<text class="warn" x="${x0 - 2}" y="${(a + b) / 2 + 20}" text-anchor="end">${n} MAC bolak-balik</text>`;
    }
    const cap = active ? "Frame berputar antar-trunk lewat perangkat di sisi pelanggan" : "Tidak ada frame yang berputar";
    return `<svg viewBox="0 0 540 ${H}" role="img" aria-label="${esc(cap)}">${DEFS}${wires}${pk}${loop}${devs}</svg><figcaption class="hint">${esc(cap)}</figcaption>`;
  }

  // ------------------------------------------------------------------ angka ringkas
  function countUp(el, to) {
    const from = +el.dataset.v || 0;
    el.dataset.v = to;
    if (calm || from === to) { el.textContent = to; return; }
    const t0 = performance.now(), dur = 700;
    const step = (t) => {
      const k = Math.min(1, (t - t0) / dur), e = 1 - Math.pow(1 - k, 3);
      el.textContent = Math.round(from + (to - from) * e);
      if (k < 1) requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
    // jaring pengaman: bila tab di latar belakang, animasi bisa tertahan; pastikan angka akhirnya benar
    setTimeout(() => { if (+el.dataset.v === to) el.textContent = to; }, dur + 150);
  }
  function renderFigures(s) {
    const c = s.counts;
    const items = [
      ["strong", c.strong, "tersangka kuat", c.strong > 0],
      ["risk", c.risk, "ONT berisiko", false],
      ["flap", c.flapping_macs, "MAC berpindah-pindah", c.flapping_macs > 0 && s.loop.active],
      ["hs", c.hotspot_active, "user hotspot aktif", false],
      ["cov", `${c.total_onts - c.no_host_data}/${c.total_onts}`, "ONT dengan data host", false],
    ];
    const el = $("figures");
    if (!el.querySelector("[data-k]"))
      el.innerHTML = items.map(([k, , l]) => `<div data-k="${k}"><dd data-v="0">0</dd><dt>${esc(l)}</dt></div>`).join("");
    items.forEach(([k, v, , alert]) => {
      const card = el.querySelector(`[data-k="${k}"]`), dd = card.firstElementChild;
      card.classList.toggle("alert", !!alert);
      const prev = dd.dataset.raw;
      dd.dataset.raw = String(v);
      if (typeof v === "number") countUp(dd, v);
      else dd.textContent = v ?? "–";
      if (prev !== undefined && prev !== String(v)) {
        dd.classList.remove("changed");
        void dd.offsetWidth; // mulai ulang animasi
        dd.classList.add("changed");
      }
    });
    $("coverage").textContent = c.no_host_data ? `${c.no_host_data} ONT tidak melaporkan data host, jadi tidak ikut dinilai` : "";
  }

  // ------------------------------------------------------------------ tersangka
  function renderSuspects(s) {
    if (!changed("suspects", s.suspects)) return;
    const el = $("suspects");
    if (!s.suspects.length) {
      el.innerHTML = '<p class="empty">Tidak ada ONT yang perlu diperiksa saat ini.</p>';
      return;
    }
    if (!firstOpenDone) {
      // saat pertama dimuat, buka rincian tersangka kuat teratas supaya buktinya langsung terlihat
      firstOpenDone = true;
      const t = s.suspects.find((x) => x.level === "kuat");
      if (t) open.add(t.id);
    }
    el.innerHTML = s.suspects.map((x, i) => susHtml(x, i, firstList)).join("");
    firstList = false;
    el.querySelectorAll("details").forEach((d) => {
      d.addEventListener("toggle", () => {
        d.open ? open.add(d.dataset.id) : open.delete(d.dataset.id);
        if (d.open) loadSpark(d);
      });
      if (d.open) loadSpark(d);
    });
  }
  function susHtml(x, i, enter) {
    const who = [x.pppoe && "PPPoE " + x.pppoe, x.tags.join(", "), x.model, x.trunk && "trunk " + x.trunk, x.tr069_ip && "TR069 " + x.tr069_ip]
      .filter(Boolean).map(esc).join(", ");
    const hosts = x.hosts.map((h) =>
      `<tr><td class="mono">${esc(h.mac)}</td><td>${esc(h.ip)}</td><td>${esc(h.name)}</td><td>${esc(h.iface === "802.11" ? "Wi-Fi" : h.iface || "-")}</td>` +
      `<td>${esc(h.port || "-")}</td><td>${h.flags.map((f) => `<span class="flag ${esc(f)}">${esc(FLAG[f] || f)}</span>`).join("")}</td></tr>`).join("");
    return `<details class="sus${enter ? " enter" : ""}" style="--i:${i}" data-level="${esc(x.level)}" data-id="${esc(x.id)}"${open.has(x.id) ? " open" : ""}>
      <summary>
        <div class="score"><b>${x.score}</b><div class="meter"><i style="width:${x.score}%"></i></div></div>
        <div class="who"><div class="serial">${esc(x.serial)}</div><div class="meta">${who}</div></div>
        <span class="chip ${esc(x.level)}">${ICON[x.level] || ""}${esc(LEVEL[x.level] || x.level)}</span>
      </summary>
      <div class="detail">
        <ul class="reasons">${x.reasons.map((r) => `<li><span class="pts">+${r.points}</span><span>${esc(r.text)}</span></li>`).join("")}</ul>
        <h4>Perangkat yang terhubung ke ONT ini</h4>
        <div class="scroll"><table><thead><tr><th>MAC</th><th>IP</th><th>Nama</th><th>Lewat</th><th>Port di switch</th><th>Catatan</th></tr></thead><tbody>${hosts}</tbody></table></div>
        <h4>Skor 24 jam terakhir</h4><div class="sparkbox hint">Memuat…</div>
      </div></details>`;
  }
  async function loadSpark(d) {
    const boxEl = d.querySelector(".sparkbox");
    try {
      const h = await (await api(`device/${encodeURIComponent(d.dataset.id)}/history?hours=24`)).json();
      if (h.ts.length < 2) { boxEl.textContent = "Belum cukup data."; return; }
      const W = 320, Hh = 44, t0 = h.ts[0], t1 = h.ts[h.ts.length - 1] || t0 + 1;
      const pts = h.ts.map((t, i) => `${(((t - t0) / (t1 - t0 || 1)) * W).toFixed(1)},${(Hh - 4 - (h.score[i] / 100) * (Hh - 8)).toFixed(1)}`);
      boxEl.innerHTML = `<svg class="spark" width="${W}" height="${Hh}" viewBox="0 0 ${W} ${Hh}" role="img" aria-label="Riwayat skor"><path d="M${pts.join("L")}"/></svg>` +
        `${fmtDay(t0)} sampai ${fmtDay(t1)}, tertinggi ${Math.max(...h.score)}`;
    } catch { boxEl.textContent = "Riwayat tidak bisa dimuat."; }
  }

  // ------------------------------------------------------------------ MAC flapping, sumber, kejadian
  function renderFlapping(s) {
    if (!changed("flapping", s.flapping)) return;
    $("flapping").innerHTML = s.flapping.length
      ? `<div class="xscroll"><table><thead><tr><th>MAC</th><th class="num">Pindah</th><th>Antara port</th><th>Jenis</th></tr></thead><tbody>${s.flapping.map((f) =>
          `<tr><td class="mono">${esc(f.mac)}</td><td class="num">${f.events}×</td><td class="nowrap">${esc(f.ports.join(" dan "))}</td><td>${esc(f.onts.length ? "host ONT " + f.onts.join(", ") : f.kind)}</td></tr>`).join("")}</tbody></table></div>`
      : '<p class="empty">Tidak ada MAC yang berpindah-pindah port.</p>';
  }
  function renderSources(s) {
    if (changed("sources", s.sources.map((x) => [x.enabled, x.ok, x.error])))
      $("sources").innerHTML = s.sources.map((x) => {
        const cls = !x.enabled ? "" : x.ok ? "ok" : x.ok === false ? "err" : "";
        const txt = !x.enabled ? "belum diatur" : x.ok ? "tersambung" : x.ok === false ? "gagal: " + x.error : "menunggu";
        return `<li title="${esc(txt)}"><span class="dot ${cls}"></span>${esc(x.label)}${x.enabled && x.ok === false ? " (gagal)" : !x.enabled ? " (belum diatur)" : ""}</li>`;
      }).join("");
    $("replayTag").hidden = !s.replay;
    $("foot").textContent = `Diperbarui ${fmtTime(s.ts)}, otomatis tiap ${s.interval} detik. Notifikasi Telegram ${s.telegram ? "aktif" : "belum diatur"}. Versi ${s.version}.`;
  }
  async function renderIncidents() {
    const list = await (await api("incidents")).json();
    if (!changed("incidents", list)) return;
    $("incidents").innerHTML = list.length
      ? list.map((i) => {
          const t = i.suspects[0];
          return `<div class="inc"><div class="when">${i.end_ts ? "" : '<span class="live"></span>'}${esc(fmtDay(i.start_ts))}, ${i.end_ts ? "selama " + fmtDur(i.end_ts - i.start_ts) : "masih berlangsung"}</div>` +
            `<div class="meta">${i.blocked_vlans.length ? esc(i.blocked_vlans.join(", ")) + " diblokir. " : ""}${t ? `Tersangka: <span class="mono">${esc(t.serial)}</span> (skor ${t.score})` : "Tersangka tidak ditemukan"}</div></div>`;
        }).join("")
      : '<p class="empty">Belum ada kejadian loop yang tercatat.</p>';
  }

  // ------------------------------------------------------------------ chart
  function bands(d) {
    const out = [];
    let start = null;
    d.ts.forEach((t, i) => {
      if (d.loop_active[i] && start === null) start = t;
      if (!d.loop_active[i] && start !== null) { out.push([start, t]); start = null; }
    });
    if (start !== null) out.push([start, d.ts[d.ts.length - 1]]);
    return out;
  }
  const COLS = [["flap_events"], ["hotspot_active"], ["strong", "risk"]];
  // seri yang digambar: kolom pertama diulang sebagai lapisan pendar di bawah garis utama
  const DRAWN = [["flap_events", "flap_events"], ["hotspot_active", "hotspot_active"], ["strong", "strong", "risk"]];
  const CH_H = 180;
  const lastOf = (arr) => { for (let i = arr.length - 1; i >= 0; i--) if (arr[i] != null) return [i, arr[i]]; return [-1, null]; };
  function chartNumbers(d) {
    const set = (id, v) => { const el = $(id); if (el && el.textContent !== String(v)) { el.textContent = v; el.classList.remove("tick"); void el.offsetWidth; el.classList.add("tick"); } };
    const max = (a) => Math.max(0, ...a.filter((x) => x != null));
    set("now1", lastOf(d.flap_events)[1] ?? "–");
    set("now2", lastOf(d.hotspot_active)[1] ?? "–");
    set("now3", `${lastOf(d.strong)[1] ?? 0} / ${lastOf(d.risk)[1] ?? 0}`);
    $("sub1").textContent = `tertinggi ${max(d.flap_events)} pada rentang ini, klik titik untuk melihat MAC`;
    $("sub2").textContent = `tertinggi ${max(d.hotspot_active)} pada rentang ini`;
  }
  const NAMES = [["pindah port"], ["user"], ["tersangka kuat", "berisiko"]];
  function drawCharts() {
    const d = series;
    if (!d || d.ts.length < 2) {
      charts.forEach((c) => c.destroy());
      charts = []; chartKey = "";
      ["c1", "c2", "c3"].forEach((id) => ($(id).innerHTML = ""));
      $("c1").innerHTML = '<p class="empty">Belum cukup data untuk chart. Data terkumpul tiap pemeriksaan.</p>';
      return;
    }
    bandList = bands(d);
    const key = hours + "|" + (document.documentElement.dataset.theme || "auto");
    if (charts.length && key === chartKey) {
      // rentang dan tema sama: cukup ganti datanya, tanpa membangun ulang (tidak berkedip)
      charts.forEach((u, i) => u.setData([d.ts, ...DRAWN[i].map((c) => d[c])]));
    } else {
      charts.forEach((c) => c.destroy());
      charts = []; chartKey = key;
      ["c1", "c2", "c3"].forEach((id) => ($(id).innerHTML = ""));
      const muted = css("--muted"), line = css("--line"), tip = $("tip");
      const orange = css("--f-orange"), aqua = css("--f-aqua"), red = css("--f-red"), yellow = css("--f-yellow");
      const grad = (color) => (u) => {
        const g = u.ctx.createLinearGradient(0, u.bbox.top, 0, u.bbox.top + u.bbox.height);
        g.addColorStop(0, color + "66");
        g.addColorStop(.6, color + "1a");
        g.addColorStop(1, color + "00");
        return g;
      };
      // pita waktu loop: arsiran merah, lebih jelas daripada blok warna polos
      const hatch = (() => {
        const c = document.createElement("canvas"), dpr = devicePixelRatio || 1;
        c.width = c.height = 10 * dpr;
        const x = c.getContext("2d");
        x.fillStyle = red + "14"; x.fillRect(0, 0, c.width, c.height);
        x.strokeStyle = red + "40"; x.lineWidth = 2 * dpr;
        x.beginPath(); x.moveTo(0, c.height); x.lineTo(c.width, 0); x.stroke();
        return c;
      })();
      const mk = (id, idx, sers) => {
        const el = $(id);
        const u = new uPlot({
          width: el.clientWidth, height: CH_H, legend: { show: false },
          cursor: { sync: { key: "loop" }, drag: { x: false, y: false }, points: { size: 11, width: 3, fill: css("--surface") } },
          scales: { x: { time: true }, y: { range: (u, mn, mx) => [0, Math.max(4, Math.ceil(mx * 1.15))] } },
          axes: [
            { stroke: muted, grid: { show: false }, ticks: { stroke: line, width: 1 }, values: (u, sp) => sp.map(fmtTime), font: "12px 'Plus Jakarta Sans', system-ui", size: 28 },
            { stroke: muted, grid: { stroke: line, width: 1, dash: [3, 4] }, ticks: { show: false }, font: "12px 'Plus Jakarta Sans', system-ui", size: 38, incrs: [1, 2, 5, 10, 20, 50, 100, 200, 500], values: (u, sp) => sp.map((v) => (Number.isInteger(v) ? v : "")) },
          ],
          series: [{}, ...sers],
          hooks: {
            drawClear: [(u) => {
              u.ctx.save();
              u.ctx.fillStyle = u.ctx.createPattern(hatch, "repeat");
              bandList.forEach(([a, b]) => {
                const x0 = Math.max(u.bbox.left, u.valToPos(a, "x", true)), x1 = Math.min(u.bbox.left + u.bbox.width, u.valToPos(b, "x", true));
                if (x1 > x0) u.ctx.fillRect(x0, u.bbox.top, x1 - x0, u.bbox.height);
              });
              u.ctx.restore();
            }],
            // titik terakhir: cincin berwarna di nilai terbaru tiap garis utama
            draw: [(u) => {
              const ctx = u.ctx, dpr = devicePixelRatio || 1;
              if (moveTs != null) {
                // garis titik yang rinciannya sedang ditampilkan di bawah chart
                const x = Math.round(u.valToPos(moveTs, "x", true));
                if (x >= u.bbox.left && x <= u.bbox.left + u.bbox.width) {
                  ctx.save(); ctx.strokeStyle = css("--ink2"); ctx.lineWidth = 1.5 * dpr; ctx.setLineDash([4 * dpr, 3 * dpr]);
                  ctx.beginPath(); ctx.moveTo(x, u.bbox.top); ctx.lineTo(x, u.bbox.top + u.bbox.height); ctx.stroke(); ctx.restore();
                }
              }
              u.series.forEach((s, si) => {
                if (!si || !s.show || s._glow) return;
                const [i, v] = lastOf(u.data[si]);
                if (i < 0) return;
                const x = u.valToPos(u.data[0][i], "x", true), y = u.valToPos(v, "y", true);
                ctx.save();
                ctx.beginPath(); ctx.arc(x, y, 7 * dpr, 0, 2 * Math.PI); ctx.fillStyle = s._stroke + "33"; ctx.fill();
                ctx.beginPath(); ctx.arc(x, y, 3.5 * dpr, 0, 2 * Math.PI); ctx.fillStyle = s._stroke; ctx.fill();
                ctx.lineWidth = 2 * dpr; ctx.strokeStyle = css("--surface"); ctx.stroke();
                ctx.restore();
              });
            }],
            setCursor: [(u) => {
              const i = u.cursor.idx, dd = series;
              if (i == null || u.cursor.left < 0) { if (tip.dataset.owner === id) tip.hidden = true; return; }
              if (!u.over.matches(":hover")) return;
              const r = u.over.getBoundingClientRect();
              tip.dataset.owner = id;
              tip.innerHTML = `<b>${fmtTime(dd.ts[i])}</b> ` + COLS[idx].map((c, k) => `${esc(NAMES[idx][k])}: <b>${dd[c][i] ?? "–"}</b>`).join(", ") + (dd.loop_active[i] ? ", loop aktif" : "");
              tip.hidden = false;
              tip.style.left = Math.min(r.left + u.cursor.left + 12, innerWidth - tip.offsetWidth - 8) + "px";
              tip.style.top = r.top + Math.max(0, u.cursor.top - 34) + "px";
            }],
          },
        }, [d.ts, ...DRAWN[idx].map((c) => d[c])], el);
        u.over.addEventListener("mouseleave", () => (tip.hidden = true));
        u.over.addEventListener("click", () => {
          const i = u.cursor.idx;
          if (i == null || !series) return;
          moveSel = { ts: series.ts[i] };
          loadMoves();
          $("moves").scrollIntoView({ behavior: calm ? "auto" : "smooth", block: "nearest" });
        });
        charts.push(u);
      };
      const spline = uPlot.paths.spline ? uPlot.paths.spline() : undefined, step = uPlot.paths.stepped({ align: 1 });
      const glow = (color, paths) => ({ stroke: color + "30", width: 9, points: { show: false }, paths, spanGaps: true, _stroke: color, _glow: true });
      const main = (color, paths, extra = {}) => ({ stroke: color, _stroke: color, width: 2.6, points: { show: false }, paths, spanGaps: true, ...extra });
      mk("c1", 0, [glow(orange, spline), main(orange, spline, { fill: grad(orange) })]);
      mk("c2", 1, [glow(aqua, spline), main(aqua, spline, { fill: grad(aqua) })]);
      mk("c3", 2, [glow(red, step), main(red, step, { fill: grad(red) }), main(yellow, step, { dash: [6, 4] })]);
    }
    chartNumbers(d);
    const rows = d.ts.map((t, i) => i).slice(-40).reverse();
    $("seriesTable").innerHTML = `<div class="scroll"><table><thead><tr><th>Waktu</th><th class="num">Pindah port</th><th class="num">User hotspot</th><th class="num">Tersangka kuat</th><th class="num">Berisiko</th><th>Loop</th></tr></thead><tbody>${rows.map((i) =>
      `<tr><td>${fmtTime(d.ts[i])}</td><td class="num">${d.flap_events[i] ?? "–"}</td><td class="num">${d.hotspot_active[i] ?? "–"}</td><td class="num">${d.strong[i] ?? "–"}</td><td class="num">${d.risk[i] ?? "–"}</td><td>${d.loop_active[i] ? "ya" : "tidak"}</td></tr>`).join("")}</tbody></table></div>`;
  }
  // ------------------------------------------------------------------ rincian MAC pindah port per titik chart
  const peakIdx = (d) => {
    let best = -1;
    d.flap_events.forEach((v, i) => { if (v > 0 && (best < 0 || v >= d.flap_events[best])) best = i; });
    return best;
  };
  const nearestIdx = (d, ts) => d.ts.reduce((b, t, i) => (Math.abs(t - ts) < Math.abs(d.ts[b] - ts) ? i : b), 0);
  // MAC router yang ikut pindah = frame router berputar kembali, tanda loop walau hanya sekali
  const moveBadge = (m) => m.kind === "MAC router sendiri" ? '<span class="mv-badge hot">MAC router kembali</span>'
    : m.flapping ? '<span class="mv-badge hot">berpindah-pindah</span>'
    : `<span class="mv-badge">${m.events > 1 ? "di bawah ambang" : "sekali pindah (roaming)"}</span>`;
  // gambar ulang garis penanda setelah uPlot selesai menyiapkan skala (jangan di tengah pembuatan chart)
  const markCharts = () => requestAnimationFrame(() => charts.forEach((u) => u.redraw(false)));
  async function loadMoves() {
    const box = $("moves"), d = series;
    if (!box) return;
    if (!d || !d.ts.length) { box.innerHTML = ""; moveTs = null; return; }
    const step = d.ts.length > 1 ? d.ts[1] - d.ts[0] : 60;
    let start, end, idx = -1;
    if (moveSel?.range) { start = d.ts[0] - step + 1; end = d.ts[d.ts.length - 1]; }
    else {
      idx = moveSel ? nearestIdx(d, moveSel.ts) : peakIdx(d);
      if (idx < 0) {
        moveTs = null; moveKey = ""; markCharts();
        box.innerHTML = `<p class="empty">Tidak ada MAC yang pindah port dalam ${hours} jam terakhir.</p>`;
        return;
      }
      // satu titik chart bisa mewakili beberapa pemeriksaan (rentang panjang diringkas)
      start = (idx > 0 ? d.ts[idx - 1] : d.ts[idx] - step) + 1; end = d.ts[idx];
    }
    moveTs = idx >= 0 ? d.ts[idx] : null;
    markCharts();
    const key = [start, end, idx >= 0 ? d.flap_events[idx] : "r", !!moveSel].join("|");
    if (key === moveKey) return;
    moveKey = key;
    let r;
    try { r = await (await api(`moves?start=${start}&end=${end}`)).json(); } catch { box.innerHTML = '<p class="empty">Rincian MAC tidak bisa dimuat.</p>'; return; }
    if (moveKey !== key) return;
    const n = idx >= 0 ? d.flap_events[idx] : null;
    const when = moveSel?.range ? `dalam ${hours} jam terakhir`
      : r.samples > 1 ? `pukul ${fmtTime(start)}–${fmtTime(end)}` : `pukul ${fmtTime(end)}`;
    const title = moveSel ? `MAC yang pindah port ${when}` : `Titik tertinggi: MAC yang pindah port ${when}`;
    const sub = moveSel?.range
      ? `${r.macs.length} MAC berbeda. Angka "pindah" adalah jumlah tertinggi dalam satu pemeriksaan.`
      : `${n} perpindahan${r.samples > 1 ? ` (tertinggi dari ${r.samples} pemeriksaan)` : ""}. Klik titik lain di grafik untuk melihat waktu lain.`;
    const rows = r.macs.map((m) => `<tr class="${m.flapping || m.kind === "MAC router sendiri" ? "flap" : ""}"><td class="mono">${esc(m.mac)}</td>
        <td class="num">${m.events}×</td>
        <td>${moveBadge(m)}</td>
        <td class="nowrap">${esc(m.ports.join(" dan "))}</td>
        <td>${esc(m.onts.length ? "host ONT " + m.onts.join(", ") : m.kind)}</td>
        ${moveSel?.range ? `<td class="nowrap">${esc(fmtTime(m.first))}${m.last !== m.first ? "–" + esc(fmtTime(m.last)) : ""}</td>` : ""}</tr>`).join("");
    box.innerHTML = `<div class="moves-head"><div class="ct"><h3>${esc(title)}</h3><small>${esc(sub)}</small></div>
      <div class="mv-seg" role="group" aria-label="Pilih waktu">
        <button type="button" data-mv="peak" aria-pressed="${!moveSel}">Titik tertinggi</button>
        <button type="button" data-mv="range" aria-pressed="${!!moveSel?.range}">Seluruh ${hours} jam</button></div></div>
      ${r.macs.length ? `<div class="xscroll"><table><thead><tr><th>MAC</th><th class="num">Pindah</th><th>Sifat</th><th>Antara port</th><th>Jenis / ONT</th>${moveSel?.range ? "<th>Terlihat</th>" : ""}</tr></thead><tbody>${rows}</tbody></table></div>`
        : `<p class="empty">${n ? "Rincian MAC untuk waktu ini belum tersimpan (data sebelum fitur ini dipasang)." : "Tidak ada MAC yang pindah port pada waktu ini."}</p>`}`;
  }
  document.addEventListener("click", (e) => {
    const b = e.target.closest("[data-mv]");
    if (!b) return;
    moveSel = b.dataset.mv === "range" ? { range: true } : null;
    loadMoves();
  });
  async function loadSeries() {
    try { series = await (await api(`series?hours=${hours}`)).json(); drawCharts(); } catch {}
    loadMoves();
  }
  document.querySelectorAll(".range button").forEach((b) => {
    b.onclick = () => {
      hours = +b.dataset.h;
      moveSel = null;
      document.querySelectorAll(".range button").forEach((x) => x.setAttribute("aria-pressed", x === b));
      loadSeries();
    };
  });
  let rz;
  addEventListener("resize", () => {
    clearTimeout(rz);
    rz = setTimeout(() => charts.forEach((u) => u.setSize({ width: u.root.parentElement.clientWidth, height: CH_H })), 120);
  });

  // ------------------------------------------------------------------ putaran
  async function loadState() {
    try {
      const s = await (await api("state")).json();
      if (!s.ready) { $("statusTitle").textContent = "Mengambil data pertama…"; return; }
      renderStatus(s); renderFigures(s); renderSuspects(s); renderFlapping(s); renderSources(s);
      renderIncidents().catch(() => {});
    } catch {
      last.status = "";
      $("status").dataset.state = "wait";
      $("stateLine").textContent = "Sambungan terputus";
      $("statusTitle").textContent = "Aplikasi tidak bisa dihubungi";
      $("statusSub").textContent = "Periksa apakah service ont-loop-detector masih berjalan, lalu muat ulang halaman.";
      $("statusAction").hidden = true;
    }
  }
  $("btnRefresh").onclick = async () => {
    const b = $("btnRefresh"), label = b.querySelector("span");
    b.disabled = true; b.classList.add("busy"); label.textContent = "Sedang mengecek…";
    try { await api("refresh", { method: "POST" }); } catch {}
    setTimeout(async () => {
      await loadState(); await loadSeries();
      b.disabled = false; b.classList.remove("busy"); label.textContent = "Cek ulang sekarang";
    }, 4000);
  };
  loadState().then(loadSeries);
  setInterval(loadState, 15000);
  setInterval(loadSeries, 60000);
})();
