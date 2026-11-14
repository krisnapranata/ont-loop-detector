(() => {
  "use strict";
  const $ = (id) => document.getElementById(id);
  const BASE = location.origin + location.pathname.replace(/[^/]*$/, "");
  const api = (p, opt) => fetch(BASE + "api/" + p, { credentials: "include", ...opt });
  const json = (method, body) => ({ method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const form = $("form");
  const SAVED = "tersimpan, kosongkan bila tidak diubah";

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
  };

  // ------------------------------------------------------------------ isi form
  function fill(s) {
    for (const sec of ["genieacs", "cisco", "mikrotik", "network", "telegram"]) {
      for (const [k, v] of Object.entries(s[sec] || {})) {
        const el = form.elements[`${sec}.${k}`];
        if (!el) continue;
        if (el.type === "password") {
          el.value = "";
          el.placeholder = s[sec][k + "_set"] ? SAVED : "";
        } else el.value = v ?? "";
      }
    }
    $("olts").innerHTML = "";
    (s.olts || []).forEach(addOlt);
    syncEmpty();
    $("replayNote").hidden = !s.replay;
  }

  function addOlt(o) {
    const node = $("oltTpl").content.firstElementChild.cloneNode(true);
    node.dataset.id = o?.id || "";
    node.querySelectorAll("[data-f]").forEach((el) => {
      const k = el.dataset.f;
      if (el.type === "password") el.placeholder = o?.[k + "_set"] ? SAVED : "";
      else if (o && o[k] != null) el.value = o[k];
    });
    node.querySelector(".btn-del").onclick = () => { node.remove(); syncEmpty(); markDirty(); };
    $("olts").appendChild(node);
    return node;
  }
  const syncEmpty = () => ($("noOlt").hidden = $("olts").children.length > 0);
  $("addOlt").onclick = () => { addOlt(null).querySelector("input").focus(); syncEmpty(); markDirty(); };

  function collect() {
    const out = { genieacs: {}, cisco: {}, mikrotik: {}, network: {}, telegram: {}, olts: [] };
    for (const el of form.elements) {
      if (!el.name || !el.name.includes(".")) continue;
      const [sec, k] = el.name.split(".");
      out[sec][k] = el.value.trim();
    }
    $("olts").querySelectorAll(".olt").forEach((node) => {
      const o = { id: node.dataset.id };
      node.querySelectorAll("[data-f]").forEach((el) => (o[el.dataset.f] = el.value.trim()));
      out.olts.push(o);
    });
    return out;
  }

  // ------------------------------------------------------------------ pesan kesalahan per kolom
  function clearErrors() {
    form.querySelectorAll(".err").forEach((e) => e.remove());
    form.querySelectorAll("[aria-invalid]").forEach((e) => e.removeAttribute("aria-invalid"));
  }
  function showErrors(errors) {
    let first = null;
    for (const [key, msg] of Object.entries(errors || {})) {
      let el = form.elements[key];
      const m = key.match(/^olts\.(\d+)\.(\w+)$/);
      if (m) el = $("olts").children[+m[1]]?.querySelector(`[data-f="${m[2]}"]`);
      if (!el) continue;
      el.setAttribute("aria-invalid", "true");
      const e = document.createElement("small");
      e.className = "err";
      e.textContent = msg;
      el.parentElement.appendChild(e);
      first ||= el;
    }
    first?.focus();
  }
  function setResult(el, ok, text) {
    el.textContent = text;
    el.dataset.ok = ok === null ? "" : ok ? "1" : "0";
  }

  // ------------------------------------------------------------------ simpan
  let dirty = false;
  const markDirty = () => { dirty = true; setResult($("saveMsg"), null, "Ada perubahan yang belum disimpan"); };
  form.addEventListener("input", markDirty);
  addEventListener("beforeunload", (e) => { if (dirty) e.preventDefault(); });

  async function save() {
    clearErrors();
    const b = $("btnSave");
    b.disabled = true;
    setResult($("saveMsg"), null, "Menyimpan…");
    try {
      const r = await api("settings", json("PUT", collect()));
      const d = await r.json();
      if (r.ok && d.ok) {
        dirty = false;
        fill(await (await api("settings")).json());
        setResult($("saveMsg"), true, "Pengaturan disimpan. Pemeriksaan ulang sedang berjalan.");
        return true;
      }
      showErrors(d.errors);
      setResult($("saveMsg"), false, "Belum disimpan. Perbaiki isian yang ditandai.");
    } catch {
      setResult($("saveMsg"), false, "Belum disimpan. Aplikasi tidak bisa dihubungi.");
    } finally { b.disabled = false; }
    return false;
  }
  form.addEventListener("submit", (e) => { e.preventDefault(); save(); });

  // ------------------------------------------------------------------ tes koneksi
  form.addEventListener("click", async (e) => {
    const btn = e.target.closest(".btn-test");
    if (!btn) return;
    const box = btn.closest("[data-kind]"), res = box.querySelector(".result"), kind = box.dataset.kind;
    clearErrors();
    btn.disabled = true;
    setResult(res, null, "Mencoba menyambung…");
    try {
      if (kind === "olt" && !box.dataset.id) {
        // OLT baru belum punya identitas sampai disimpan
        const idx = [...$("olts").children].indexOf(box);
        if (!(await save())) { setResult(res, false, "Simpan dulu belum berhasil."); return; }
        const again = $("olts").children[idx];
        again?.querySelector(".btn-test").click();
        return;
      }
      const r = await api("settings/test", json("POST", { kind, olt_id: box.dataset.id || "", settings: collect() }));
      const d = await r.json();
      if (d.errors) showErrors(d.errors);
      setResult(res, !!d.ok, d.message || (d.ok ? "Berhasil." : "Gagal."));
    } catch {
      setResult(res, false, "Aplikasi tidak bisa dihubungi.");
    } finally { btn.disabled = false; }
  });

  api("settings").then((r) => r.json()).then(fill).catch(() => {
    setResult($("saveMsg"), false, "Pengaturan tidak bisa dimuat. Muat ulang halaman.");
  });
})();
