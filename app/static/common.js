// Alat bantu bersama untuk halaman kelola perangkat (GenieACS, Switch, MikroTik).
window.UI = (() => {
  "use strict";
  const $ = (id) => document.getElementById(id);
  // alamat dasar tanpa user:password, supaya fetch tetap jalan bila halaman dibuka dengan kredensial di URL
  const BASE = location.origin + location.pathname.replace(/[^/]*$/, "");
  const api = (p, opt) => fetch(BASE + "api/" + p, { credentials: "include", ...opt });
  const json = (method, body) => ({ method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const esc = (s) =>
    String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

  // ------------------------------------------------------------------ tema
  const saved = (() => { try { return localStorage.getItem("theme"); } catch { return null; } })();
  if (saved) document.documentElement.dataset.theme = saved;
  if ($("btnTheme")) $("btnTheme").onclick = () => {
    const dark = document.documentElement.dataset.theme
      ? document.documentElement.dataset.theme === "dark"
      : matchMedia("(prefers-color-scheme: dark)").matches;
    const next = dark ? "light" : "dark";
    document.documentElement.dataset.theme = next;
    try { localStorage.setItem("theme", next); } catch {}
  };

  // ------------------------------------------------------------------ panggilan API
  // Mengembalikan data, atau melempar Error berisi pesan yang siap ditampilkan.
  async function call(path, opt) {
    let r;
    try { r = await api(path, opt); } catch { throw new Error("Aplikasi tidak bisa dihubungi."); }
    let d = null;
    try { d = await r.json(); } catch {}
    if (!r.ok || (d && d.ok === false)) throw new Error(d?.message || d?.detail || `Permintaan gagal (kode ${r.status}).`);
    return d;
  }

  // ------------------------------------------------------------------ pemberitahuan singkat
  let toastTimer = 0;
  function toast(text, ok = true) {
    let el = $("toast");
    if (!el) {
      el = document.createElement("div");
      el.id = "toast";
      el.className = "toast";
      el.setAttribute("role", "status");
      document.body.appendChild(el);
    }
    el.textContent = text;
    el.dataset.ok = ok ? "1" : "0";
    el.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => (el.hidden = true), ok ? 6000 : 10000);
  }

  // ------------------------------------------------------------------ dialog konfirmasi
  // ask({title, text, ok, danger, input: {label, value, type, placeholder}, confirmWord})
  // -> true / nilai isian bila disetujui, null bila dibatalkan.
  function ask(o) {
    return new Promise((resolve) => {
      const d = document.createElement("dialog");
      d.className = "ask";
      const field = o.input
        ? `<label>${esc(o.input.label)}<input id="askInput" type="${esc(o.input.type || "text")}" value="${esc(o.input.value ?? "")}" placeholder="${esc(o.input.placeholder || "")}" autocomplete="off" spellcheck="false"></label>`
        : o.confirmWord
          ? `<label><span>Ketik <b class="mono">${esc(o.confirmWord)}</b> untuk melanjutkan</span><input id="askInput" autocomplete="off" spellcheck="false"></label>`
          : "";
      d.innerHTML = `<form method="dialog"><h2>${esc(o.title)}</h2>${o.text ? `<p>${esc(o.text)}</p>` : ""}${field}
        <div class="ask-actions"><button type="button" class="btn" data-x>Batal</button>
        <button type="submit" class="btn ${o.danger ? "danger" : "primary"}">${esc(o.ok || "Lanjutkan")}</button></div></form>`;
      document.body.appendChild(d);
      const input = d.querySelector("#askInput"), submit = d.querySelector('[type="submit"]');
      if (o.confirmWord) {
        submit.disabled = true;
        input.oninput = () => (submit.disabled = input.value.trim() !== o.confirmWord);
      }
      let result = null;
      d.querySelector("[data-x]").onclick = () => d.close();
      d.querySelector("form").onsubmit = () => { result = o.input ? input.value : true; };
      d.onclose = () => { d.remove(); resolve(result); };
      d.showModal();
      (input || d.querySelector("[data-x]")).focus();
    });
  }

  // ------------------------------------------------------------------ dialog formulir
  // form({title, text, body (HTML aman), ok, danger, wide, submit(formEl) -> nilai | Promise}).
  // submit boleh melempar Error: pesannya tampil di dialog dan dialog tetap terbuka.
  // Hasil: nilai dari submit, atau null bila dibatalkan.
  function form(o) {
    return new Promise((resolve) => {
      const d = document.createElement("dialog");
      d.className = "ask" + (o.wide ? " wide" : "");
      d.innerHTML = `<form novalidate><h2>${esc(o.title)}</h2>${o.text ? `<p>${esc(o.text)}</p>` : ""}
        <div class="ask-body">${o.body || ""}</div><p class="ask-err" role="alert" hidden></p>
        <div class="ask-actions"><button type="button" class="btn" data-x>Batal</button>
        ${o.alt ? `<button type="submit" class="btn" data-alt>${esc(o.alt)}</button>` : ""}
        <button type="submit" class="btn ${o.danger ? "danger" : "primary"}">${esc(o.ok || "Simpan")}</button></div></form>`;
      document.body.appendChild(d);
      const f = d.querySelector("form"), err = d.querySelector(".ask-err"), submits = [...f.querySelectorAll('[type="submit"]')];
      let result = null;
      d.querySelector("[data-x]").onclick = () => d.close();
      f.onsubmit = async (e) => {
        e.preventDefault();
        err.hidden = true;
        submits.forEach((b) => (b.disabled = true));
        try {
          // argumen kedua: true bila yang ditekan tombol alternatif (o.alt)
          result = await o.submit(f, !!e.submitter?.hasAttribute("data-alt"));
          d.close();
        } catch (x) {
          err.textContent = x.message;
          err.hidden = false;
        } finally { submits.forEach((b) => (b.disabled = false)); }
      };
      d.onclose = () => { d.remove(); resolve(result); };
      d.showModal();
      o.onReady?.(f, d);
      (f.querySelector("input:not([disabled]), select:not([disabled])") || d.querySelector("[data-x]")).focus();
    });
  }

  // ------------------------------------------------------------------ tab di dalam halaman
  // Tombol: .tabs [data-tab]; isi: [data-panel]. onShow(nama) dipanggil tiap tab dibuka.
  function tabs(onShow) {
    const btns = [...document.querySelectorAll(".tabs [data-tab]")];
    const show = (name, setHash = true) => {
      for (const b of btns) b.setAttribute("aria-selected", b.dataset.tab === name ? "true" : "false");
      for (const p of document.querySelectorAll("[data-panel]")) p.hidden = p.dataset.panel !== name;
      if (setHash) history.replaceState(null, "", "#" + name);
      onShow?.(name);
    };
    for (const b of btns) b.onclick = () => show(b.dataset.tab);
    const want = location.hash.slice(1);
    show(btns.some((b) => b.dataset.tab === want) ? want : btns[0].dataset.tab, false);
    return show;
  }

  // ------------------------------------------------------------------ pemuat isi panel
  // Panel berisi elemen .body dan (opsional) tombol [data-reload]. Dimuat sekali saat pertama dibuka.
  function loader(panel, path, render) {
    const body = panel.querySelector(".body");
    let loaded = false, busy = false;
    async function load() {
      if (busy) return;
      busy = true;
      body.setAttribute("aria-busy", "true");
      if (!loaded) body.innerHTML = '<p class="empty">Membaca dari perangkat…</p>';
      try {
        body.innerHTML = render(await call(path));
        loaded = true;
      } catch (e) {
        body.innerHTML = `<p class="empty bad">${esc(e.message)}</p>`;
      } finally {
        busy = false;
        body.removeAttribute("aria-busy");
      }
    }
    panel.querySelector("[data-reload]")?.addEventListener("click", load);
    return { load, first: () => loaded || load() };
  }

  const fmtAgo = (ts) => {
    if (!ts) return "belum pernah";
    const s = Math.max(0, Date.now() / 1000 - ts);
    if (s < 90) return "baru saja";
    if (s < 3600) return `${Math.round(s / 60)} menit lalu`;
    if (s < 86400 * 2) return `${Math.round(s / 3600)} jam lalu`;
    return `${Math.round(s / 86400)} hari lalu`;
  };
  const pill = (kind, text) => `<span class="pill ${kind}">${esc(text)}</span>`;

  return { $, api, json, esc, call, toast, ask, form, tabs, loader, fmtAgo, pill };
})();
