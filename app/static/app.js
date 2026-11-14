(() => {
  "use strict";
  const $ = (id) => document.getElementById(id);
  // alamat dasar tanpa user:password, supaya fetch tetap jalan bila halaman dibuka dengan kredensial di URL
  const BASE = location.origin + location.pathname.replace(/[^/]*$/, "");
  const api = (p, opt) => fetch(BASE + "api/" + p, { credentials: "include", ...opt });
  const esc = (s) =>
    String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const css = (v) => getComputedStyle(document.documentElement).getPropertyValue(v).trim();
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

  let state = null, hours = 3, charts = [], series = null;
  const open = new Set();
  let firstOpenDone = false;

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
    drawCharts();
  };

  // ------------------------------------------------------------------ status + skema
  function renderStatus(s) {
    const el = $("status"), lp = s.loop, top = s.suspects.find((x) => x.level === "kuat");
    const risk = s.counts.risk;
    el.dataset.state = lp.active ? "loop" : "ok";
    if (lp.active) {
      $("statusTitle").textContent = "Loop sedang terjadi";
      const where = lp.blocked_vlans.length ? `${lp.blocked_vlans.join(", ")} diblokir router` : "Belum ada VLAN yang diblokir router";
      const since = s.incident_start ? `, sejak ${fmtTime(s.incident_start)} (${fmtDur(s.ts - s.incident_start)})` : "";
      $("statusSub").textContent = where + since + ".";
      const a = $("statusAction");
      a.hidden = false;
      a.innerHTML = top
        ? `Periksa dulu ONT <b>${esc(top.serial)}</b>${top.trunk ? " di trunk " + esc(top.trunk) : ""}. Cabut perangkat yang tercolok di port LAN-nya.`
        : "Belum ada ONT yang terbukti jadi penyebab. Periksa ONT berisiko di daftar bawah, mulai dari skor tertinggi.";
    } else if (lp.known === false) {
      el.dataset.state = "unknown";
      $("statusTitle").textContent = "Status loop belum bisa dipastikan";
      const bad = s.sources.filter((x) => x.name !== "genieacs").map((x) => `${x.label} ${x.enabled ? "gagal dibaca" : "belum diatur"}`);
      $("statusSub").textContent = `${bad.join(", ")}. Tanpa keduanya aplikasi hanya bisa menandai ONT berisiko, bukan memastikan ada loop.`;
      $("statusAction").hidden = true;
    } else {
      $("statusTitle").textContent = "Jaringan normal";
      $("statusSub").textContent = risk
        ? `Tidak ada loop. ${risk} ONT punya perangkat di port LAN yang bisa memicu loop berikutnya.`
        : "Tidak ada loop dan tidak ada ONT yang berisiko.";
      $("statusAction").hidden = true;
    }
    $("statusWhy").innerHTML = lp.reasons.map((r) => `<li>${esc(r)}</li>`).join("");
    $("path").innerHTML = pathSvg(s, top);
  }

  function pathSvg(s, top) {
    const trunks = new Set();
    s.suspects.forEach((x) => x.trunk && trunks.add(x.trunk));
    s.flapping.forEach((f) => f.ports.forEach((p) => trunks.add(p)));
    const list = [...trunks].sort().slice(0, 3);
    if (!list.length) list.push("Trunk OLT");
    const active = s.loop.active, n = s.counts.flapping_macs;
    const H = Math.max(150, list.length * 64 + 30), mid = H / 2;
    const ys = list.map((_, i) => (list.length === 1 ? mid : 34 + (i * (H - 68)) / (list.length - 1)));
    let g = `<line class="wire" x1="78" y1="${mid}" x2="118" y2="${mid}"/>`;
    g += box(4, mid - 20, 74, 40, "Router", "MikroTik") + box(118, mid - 20, 74, 40, "Switch", "Cisco");
    list.forEach((t, i) => {
      g += `<path class="wire" d="M192 ${mid} C215 ${mid} 215 ${ys[i]} 238 ${ys[i]}"/>`;
      g += box(238, ys[i] - 18, 104, 36, t, "ke OLT");
    });
    const ti = top ? list.indexOf(top.trunk) : -1;
    if (top && ti >= 0) {
      g += `<line class="wire" x1="342" y1="${ys[ti]}" x2="372" y2="${ys[ti]}"/>`;
      g += box(372, ys[ti] - 18, 124, 36, top.serial, "ONT tersangka", true);
    }
    if (active && list.length > 1) {
      const a = ys[0], b = ys[list.length - 1], x0 = top && ti >= 0 ? 500 : 346;
      g += `<path class="loop" d="M${ti === 0 ? x0 : 346} ${a} C${x0 + 40} ${a} ${x0 + 40} ${b} ${ti === list.length - 1 ? x0 : 346} ${b}"/>`;
      g += `<text class="warn" x="${Math.min(x0 + 34, 470)}" y="${mid + 4}" text-anchor="${x0 > 400 ? "end" : "start"}"${x0 > 400 ? ` dx="-14"` : ""}>${n} MAC bolak-balik</text>`;
    }
    const label = active ? "Frame berputar antar-trunk lewat perangkat di sisi pelanggan" : "Tidak ada frame yang berputar";
    return `<svg viewBox="0 0 540 ${H}" role="img" aria-label="${esc(label)}">${g}</svg><figcaption class="hint">${esc(label)}</figcaption>`;
  }
  const box = (x, y, w, h, title, sub, hot) =>
    `<rect class="node${hot ? " hot" : ""}" x="${x}" y="${y}" width="${w}" height="${h}" rx="6"/>` +
    `<text x="${x + w / 2}" y="${y + h / 2 - 1}" text-anchor="middle">${esc(title)}</text>` +
    `<text class="sub" x="${x + w / 2}" y="${y + h / 2 + 12}" text-anchor="middle">${esc(sub)}</text>`;

  // ------------------------------------------------------------------ angka ringkas
  function renderFigures(s) {
    const c = s.counts;
    const items = [
      [c.strong, "tersangka kuat", c.strong > 0],
      [c.risk, "ONT berisiko", false],
      [c.flapping_macs, "MAC berpindah-pindah", c.flapping_macs > 0 && s.loop.active],
      [c.hotspot_active ?? "–", "user hotspot aktif", false],
      [`${c.total_onts - c.no_host_data}/${c.total_onts}`, "ONT dengan data host", false],
    ];
    $("figures").innerHTML = items
      .map(([v, l, alert]) => `<div${alert ? ' class="alert"' : ""}><dd>${esc(v)}</dd><dt>${esc(l)}</dt></div>`)
      .join("");
    $("coverage").textContent = c.no_host_data ? `${c.no_host_data} ONT tidak melaporkan data host, jadi tidak ikut dinilai` : "";
  }

  // ------------------------------------------------------------------ tersangka
  function renderSuspects(s) {
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
    el.innerHTML = s.suspects.map(susHtml).join("");
    el.querySelectorAll("details").forEach((d) => {
      d.addEventListener("toggle", () => {
        d.open ? open.add(d.dataset.id) : open.delete(d.dataset.id);
        if (d.open) loadSpark(d);
      });
      if (d.open) loadSpark(d);
    });
  }
  function susHtml(x) {
    const who = [x.pppoe && "PPPoE " + x.pppoe, x.tags.join(", "), x.model, x.trunk && "trunk " + x.trunk, x.tr069_ip && "TR069 " + x.tr069_ip]
      .filter(Boolean).map(esc).join(", ");
    const hosts = x.hosts.map((h) =>
      `<tr><td class="mono">${esc(h.mac)}</td><td>${esc(h.ip)}</td><td>${esc(h.name)}</td><td>${esc(h.iface === "802.11" ? "Wi-Fi" : h.iface || "-")}</td>` +
      `<td>${esc(h.port || "-")}</td><td>${h.flags.map((f) => `<span class="flag ${esc(f)}">${esc(FLAG[f] || f)}</span>`).join("")}</td></tr>`).join("");
    return `<details class="sus" data-level="${esc(x.level)}" data-id="${esc(x.id)}"${open.has(x.id) ? " open" : ""}>
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
    $("flapping").innerHTML = s.flapping.length
      ? `<table><thead><tr><th>MAC</th><th class="num">Pindah</th><th>Antara port</th><th>Jenis</th></tr></thead><tbody>${s.flapping.map((f) =>
          `<tr><td class="mono">${esc(f.mac)}</td><td class="num">${f.events}×</td><td>${esc(f.ports.join(" dan "))}</td><td>${esc(f.onts.length ? "host ONT " + f.onts.join(", ") : f.kind)}</td></tr>`).join("")}</tbody></table>`
      : '<p class="empty">Tidak ada MAC yang berpindah-pindah port.</p>';
  }
  function renderSources(s) {
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
    $("incidents").innerHTML = list.length
      ? list.map((i) => {
          const t = i.suspects[0];
          return `<div class="inc"><div class="when">${esc(fmtDay(i.start_ts))}, ${i.end_ts ? "selama " + fmtDur(i.end_ts - i.start_ts) : "masih berlangsung"}</div>` +
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
  function drawCharts() {
    charts.forEach((c) => c.destroy());
    charts = [];
    const d = series;
    ["c1", "c2", "c3"].forEach((id) => ($(id).innerHTML = ""));
    if (!d || d.ts.length < 2) {
      $("c1").innerHTML = '<p class="empty">Belum cukup data untuk chart. Data terkumpul tiap pemeriksaan.</p>';
      return;
    }
    const ink2 = css("--muted"), line = css("--line"), band = css("--band"), bs = bands(d), tip = $("tip");
    const mk = (id, cols, sers, names) => {
      const el = $(id);
      const u = new uPlot({
        width: el.clientWidth, height: 132, legend: { show: false },
        cursor: { sync: { key: "loop" }, drag: { x: false, y: false }, points: { size: 8 } },
        scales: { x: { time: true }, y: { range: (u, mn, mx) => [0, Math.max(4, Math.ceil(mx * 1.15))] } },
        axes: [
          { stroke: ink2, grid: { show: false }, ticks: { stroke: line, width: 1 }, values: (u, sp) => sp.map(fmtTime), font: "12px system-ui", size: 28 },
          { stroke: ink2, grid: { stroke: line, width: 1 }, ticks: { show: false }, font: "12px system-ui", size: 38, incrs: [1, 2, 5, 10, 20, 50, 100, 200, 500], values: (u, sp) => sp.map((v) => (Number.isInteger(v) ? v : "")) },
        ],
        series: [{}, ...sers],
        hooks: {
          drawClear: [(u) => {
            u.ctx.save();
            u.ctx.fillStyle = band;
            bs.forEach(([a, b]) => {
              const x0 = Math.max(u.bbox.left, u.valToPos(a, "x", true)), x1 = Math.min(u.bbox.left + u.bbox.width, u.valToPos(b, "x", true));
              if (x1 > x0) u.ctx.fillRect(x0, u.bbox.top, x1 - x0, u.bbox.height);
            });
            u.ctx.restore();
          }],
          setCursor: [(u) => {
            const i = u.cursor.idx;
            if (i == null || u.cursor.left < 0) { if (tip.dataset.owner === id) tip.hidden = true; return; }
            if (!u.over.matches(":hover")) return;
            const r = u.over.getBoundingClientRect();
            tip.dataset.owner = id;
            tip.innerHTML = `<b>${fmtTime(d.ts[i])}</b> ` + cols.map((c, k) => `${esc(names[k])}: <b>${d[c][i] ?? "–"}</b>`).join(", ") + (d.loop_active[i] ? ", loop aktif" : "");
            tip.hidden = false;
            const x = Math.min(r.left + u.cursor.left + 12, innerWidth - tip.offsetWidth - 8);
            tip.style.left = x + "px";
            tip.style.top = r.top + Math.max(0, u.cursor.top - 34) + "px";
          }],
        },
      }, [d.ts, ...cols.map((c) => d[c])], el);
      u.over.addEventListener("mouseleave", () => (tip.hidden = true));
      charts.push(u);
    };
    const accent = css("--accent");
    mk("c1", ["flap_events"], [{ stroke: accent, width: 2, fill: accent + "22", points: { show: false } }], ["pindah port"]);
    mk("c2", ["hotspot_active"], [{ stroke: accent, width: 2, points: { show: false }, spanGaps: true }], ["user"]);
    mk("c3", ["strong", "risk"], [
      { stroke: css("--critical"), width: 2, points: { show: false }, paths: uPlot.paths.stepped({ align: 1 }) },
      { stroke: css("--warning"), width: 2, dash: [6, 4], points: { show: false }, paths: uPlot.paths.stepped({ align: 1 }) },
    ], ["tersangka kuat", "berisiko"]);
    const rows = d.ts.map((t, i) => i).slice(-40).reverse();
    $("seriesTable").innerHTML = `<div class="scroll"><table><thead><tr><th>Waktu</th><th class="num">Pindah port</th><th class="num">User hotspot</th><th class="num">Tersangka kuat</th><th class="num">Berisiko</th><th>Loop</th></tr></thead><tbody>${rows.map((i) =>
      `<tr><td>${fmtTime(d.ts[i])}</td><td class="num">${d.flap_events[i] ?? "–"}</td><td class="num">${d.hotspot_active[i] ?? "–"}</td><td class="num">${d.strong[i] ?? "–"}</td><td class="num">${d.risk[i] ?? "–"}</td><td>${d.loop_active[i] ? "ya" : "tidak"}</td></tr>`).join("")}</tbody></table></div>`;
  }
  async function loadSeries() {
    try { series = await (await api(`series?hours=${hours}`)).json(); drawCharts(); } catch {}
  }
  document.querySelectorAll(".range button").forEach((b) => {
    b.onclick = () => {
      hours = +b.dataset.h;
      document.querySelectorAll(".range button").forEach((x) => x.setAttribute("aria-pressed", x === b));
      loadSeries();
    };
  });
  let rz;
  addEventListener("resize", () => {
    clearTimeout(rz);
    rz = setTimeout(() => charts.forEach((u) => u.setSize({ width: u.root.parentElement.clientWidth, height: 132 })), 120);
  });

  // ------------------------------------------------------------------ putaran
  async function loadState() {
    try {
      const s = await (await api("state")).json();
      if (!s.ready) { $("statusTitle").textContent = "Mengambil data pertama…"; return; }
      state = s;
      renderStatus(s); renderFigures(s); renderSuspects(s); renderFlapping(s); renderSources(s);
      renderIncidents().catch(() => {});
    } catch {
      $("status").dataset.state = "wait";
      $("statusTitle").textContent = "Aplikasi tidak bisa dihubungi";
      $("statusSub").textContent = "Periksa apakah service ont-loop-detector masih berjalan, lalu muat ulang halaman.";
    }
  }
  $("btnRefresh").onclick = async () => {
    const b = $("btnRefresh");
    b.disabled = true; b.textContent = "Sedang mengecek…";
    try { await api("refresh", { method: "POST" }); } catch {}
    setTimeout(async () => { await loadState(); await loadSeries(); b.disabled = false; b.textContent = "Cek ulang sekarang"; }, 4000);
  };
  loadState().then(loadSeries);
  setInterval(loadState, 15000);
  setInterval(loadSeries, 60000);
})();
