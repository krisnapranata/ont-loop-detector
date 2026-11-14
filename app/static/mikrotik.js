(() => {
  "use strict";
  const { esc, call, json, toast, ask, tabs, loader, pill } = UI;
  const panel = (n) => document.querySelector(`[data-panel="${n}"]`);
  const state = (x) => x.disabled ? pill("off", "Nonaktif") : x.running ? pill("good", "Berjalan") : pill("warn", "Tidak berjalan");
  const toggle = (x) => x.dynamic ? "" :
    `<button type="button" class="btn small ${x.disabled ? "" : "danger"}" data-act="${x.disabled ? "enable" : "disable"}" data-name="${esc(x.name)}">${x.disabled ? "Aktifkan" : "Nonaktifkan"}</button>`;
  let data = { interfaces: [], vlans: [] };

  const render = {
    iface: () => data.interfaces.length
      ? `<div class="xscroll"><table class="rows"><thead><tr><th>Nama</th><th>Jenis</th><th>Status</th><th>MTU</th><th>Terakhir naik</th><th></th></tr></thead><tbody>${data.interfaces.map((i) =>
          `<tr><td class="mono">${esc(i.name)}${i.dynamic ? ' <span class="flag">dinamis</span>' : ""}</td><td>${esc(i.type)}</td><td>${state(i)}</td>
           <td>${esc(i.mtu)}</td><td class="nowrap">${esc(i.last_up)}</td><td class="nowrap">${toggle(i)}</td></tr>`).join("")}</tbody></table></div>`
      : '<p class="empty">Router tidak mengembalikan daftar interface.</p>',
    vlan: () => data.vlans.length
      ? `<div class="xscroll"><table class="rows"><thead><tr><th>Nama</th><th class="num">VLAN</th><th>Di interface</th><th>Status</th><th>Loop-protect</th><th></th></tr></thead><tbody>${data.vlans.map((v) =>
          `<tr><td class="mono">${esc(v.name)}</td><td class="num">${esc(v.vlan_id)}</td><td class="mono">${esc(v.interface)}</td>
           <td>${v.lp_status === "disabled" ? pill("bad", "Diblokir loop-protect") : state(v)}</td>
           <td><select class="small" data-lp="${esc(v.name)}" aria-label="Loop-protect ${esc(v.name)}">${["on", "off", "default"].map((o) =>
             `<option ${o === v.loop_protect ? "selected" : ""}>${o}</option>`).join("")}</select></td>
           <td class="nowrap">${toggle(v)}</td></tr>`).join("")}</tbody></table></div>`
      : '<p class="empty">Router tidak punya interface VLAN.</p>',
  };
  // dua tab berbagi satu pembacaan router
  const both = (which) => loader(panel(which), "mikrotik/interfaces", (d) => {
    data = d;
    const other = which === "iface" ? "vlan" : "iface";
    panel(other).querySelector(".body").innerHTML = render[other]();
    return render[which]();
  });
  const L = {
    iface: both("iface"), vlan: both("vlan"),
    hotspot: loader(panel("hotspot"), "mikrotik/hotspot", (d) => d.active.length
      ? `<p class="hint">${d.active.length} user aktif</p><div class="xscroll"><table class="rows"><thead><tr><th>User</th><th>IP</th><th>MAC</th><th>Lama tersambung</th><th>Server</th></tr></thead><tbody>${d.active.map((u) =>
          `<tr><td>${esc(u.user)}</td><td class="mono">${esc(u.address)}</td><td class="mono">${esc(u.mac)}</td><td>${esc(u.uptime)}</td><td>${esc(u.server)}</td></tr>`).join("")}</tbody></table></div>`
      : '<p class="empty">Tidak ada user hotspot yang aktif.</p>'),
    log: loader(panel("log"), "mikrotik/log", (d) =>
      d.lines.length ? `<pre class="out">${esc(d.lines.join("\n"))}</pre>` : '<p class="empty">Log router kosong.</p>'),
    config: loader(panel("config"), "mikrotik/config", (d) => `<pre class="out tall">${esc(d.text)}</pre>`),
  };
  let loadedIfaces = false;

  async function send(payload, el) {
    el.disabled = true;
    try {
      const d = await call("mikrotik/action", json("POST", payload));
      toast(d.message, true);
    } catch (e) {
      toast(e.message, false);
    } finally {
      el.disabled = false;
      await L.iface.load(); // juga mengembalikan pilihan yang ditolak ke nilai sebenarnya di router
    }
  }

  for (const name of ["iface", "vlan"]) {
    panel(name).addEventListener("click", async (e) => {
      const b = e.target.closest("[data-act]");
      if (!b) return;
      const n = b.dataset.name;
      if (b.dataset.act === "disable") {
        if (!(await ask({ title: `Nonaktifkan ${n}?`, ok: "Nonaktifkan", danger: true,
          text: "Lalu lintas lewat interface ini berhenti. Bila ini jalur aplikasi ke router, aplikasi tidak bisa mengaktifkannya lagi." }))) return;
      }
      send({ action: b.dataset.act, name: n }, b);
    });
  }
  panel("vlan").addEventListener("change", async (e) => {
    const s = e.target.closest("[data-lp]");
    if (!s) return;
    const n = s.dataset.lp, v = s.value;
    const ok = await ask({ title: `Atur loop-protect ${n} ke ${v}?`, ok: "Terapkan", danger: v !== "on",
      text: v === "on" ? "Router akan mematikan VLAN ini sementara bila mendeteksi loop." : "Tanpa loop-protect, loop di VLAN ini tidak diblokir router dan tidak terdeteksi dari sisi router." });
    if (ok) send({ action: "loop_protect", name: n, value: v }, s);
    else L.iface.load();
  });

  tabs((name) => {
    if (name === "iface" || name === "vlan") { if (!loadedIfaces) { loadedIfaces = true; L[name].load(); } }
    else L[name]?.first();
  });
})();
