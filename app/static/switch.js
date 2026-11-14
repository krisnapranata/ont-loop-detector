(() => {
  "use strict";
  const { $, esc, call, json, toast, ask, tabs, loader, pill } = UI;
  const panel = (n) => document.querySelector(`[data-panel="${n}"]`);
  const STATUS = {
    connected: ["good", "Tersambung"], notconnect: ["off", "Tidak ada kabel"], disabled: ["off", "Dimatikan"],
    "err-disabled": ["bad", "Diblokir switch"], inactive: ["off", "Tidak aktif"], monitoring: ["off", "Monitor"],
  };
  let ports = [];

  const L = {
    port: loader(panel("port"), "switch/ports", (d) => {
      ports = d.ports;
      if (!ports.length) return '<p class="empty">Switch tidak mengembalikan daftar port.</p>';
      return `<div class="xscroll"><table class="rows"><thead><tr><th>Port</th><th>Deskripsi</th><th>Status</th><th>VLAN</th><th>Kecepatan</th><th>Jenis</th><th></th></tr></thead><tbody>${ports.map((p) => {
        const [kind, text] = STATUS[p.status] || ["off", p.status];
        const off = p.status === "disabled";
        return `<tr><td class="mono nowrap">${esc(p.port)}${p.olt_trunk ? ' <span class="flag">trunk OLT</span>' : ""}</td><td>${esc(p.name)}</td>
          <td>${pill(kind, text)}</td><td>${esc(p.vlan)}</td><td class="nowrap">${esc(p.speed)} ${esc(p.duplex)}</td><td>${esc(p.type)}</td>
          <td class="nowrap"><button type="button" class="btn small" data-act="description" data-port="${esc(p.port)}">Deskripsi</button>
          <button type="button" class="btn small ${off ? "" : "danger"}" data-act="${off ? "no_shutdown" : "shutdown"}" data-port="${esc(p.port)}">${off ? "Nyalakan" : "Matikan"}</button></td></tr>`;
      }).join("")}</tbody></table></div>`;
    }),
    log: loader(panel("log"), "switch/log", (d) =>
      d.lines.length ? `<pre class="out">${esc(d.lines.join("\n"))}</pre>` : '<p class="empty">Log switch kosong.</p>'),
    config: loader(panel("config"), "switch/config", (d) => `<pre class="out tall">${esc(d.text)}</pre>`),
  };

  async function send(payload, btn) {
    btn.disabled = true;
    try {
      const d = await call("switch/action", json("POST", payload));
      toast(d.message, true);
      if (payload.action !== "save") await L.port.load();
    } catch (e) {
      toast(e.message, false);
    } finally { btn.disabled = false; }
  }

  panel("port").addEventListener("click", async (e) => {
    const b = e.target.closest("[data-act]");
    if (!b) return;
    const p = ports.find((x) => x.port === b.dataset.port), a = b.dataset.act;
    if (!p) return;
    if (a === "description") {
      const v = await ask({ title: `Deskripsi port ${p.port}`, ok: "Simpan", input: { label: "Deskripsi (kosongkan untuk menghapus)", value: p.name } });
      if (v != null) send({ action: a, port: p.port, text: v }, b);
    } else if (a === "shutdown") {
      const text = p.olt_trunk
        ? "Port ini trunk ke OLT. Semua pelanggan di OLT tersebut akan putus sampai port dinyalakan lagi."
        : "Semua perangkat di belakang port ini akan putus. Bila port ini jalur aplikasi ke switch, aplikasi tidak bisa menyalakannya lagi.";
      if (await ask({ title: `Matikan port ${p.port}${p.name ? " (" + p.name + ")" : ""}?`, text, ok: "Matikan port", danger: true,
        confirmWord: p.olt_trunk ? p.port : undefined }))
        send({ action: a, port: p.port }, b);
    } else if (a === "no_shutdown") send({ action: a, port: p.port }, b);
  });

  $("btnWrite").onclick = async (e) => {
    if (await ask({ title: "Simpan ke startup-config?", text: "Konfigurasi yang sedang berjalan akan dipakai lagi setelah switch dinyalakan ulang.", ok: "Simpan" }))
      send({ action: "save" }, e.currentTarget);
  };

  tabs((name) => L[name]?.first());
})();
