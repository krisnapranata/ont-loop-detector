// Ekspresi GenieACS dalam bentuk larik: ["AND", a, b], ["PARAM", "x"], ["FUNC", "NOW"], ...
// evaluate() menilai terhadap dokumen perangkat, stringify() menyusun teks untuk parameter filter API.
window.AcsExpr = (() => {
  "use strict";
  const LEVEL = { OR: 10, AND: 11, NOT: 12, "=": 20, "<>": 20, "<": 20, "<=": 20, ">": 20, ">=": 20, LIKE: 20,
    "NOT LIKE": 20, "IS NULL": 20, "IS NOT NULL": 20, "||": 30, "+": 31, "-": 31, "*": 32, "/": 32, "%": 32 };

  const like = (v, pat, escChar) => {
    let rx = "";
    for (let i = 0; i < pat.length; i++) {
      const c = pat[i];
      if (escChar && c === escChar && i + 1 < pat.length) { rx += pat[++i].replace(/[.*+?^${}()|[\]\\]/g, "\\$&"); continue; }
      rx += c === "%" ? "[\\s\\S]*" : c === "_" ? "[\\s\\S]" : c.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    }
    return new RegExp("^" + rx + "$").test(v);
  };
  const cmp = (op, a, b) => {
    if (a == null || b == null) return null;
    if (typeof a !== typeof b) return op === "<>";
    switch (op) {
      case "=": return a === b; case "<>": return a !== b; case "<": return a < b;
      case "<=": return a <= b; case ">": return a > b; default: return a >= b;
    }
  };
  const truthy = (v) => v != null && v !== false && v !== 0 && v !== "";

  // get(nama) -> nilai parameter atau null
  function evaluate(e, get, now = Date.now()) {
    if (!Array.isArray(e)) return e;
    const ev = (x) => evaluate(x, get, now);
    const op = e[0];
    switch (op) {
      case "PARAM": return get(e[1]);
      case "FUNC": {
        const a = e.slice(2).map(ev);
        switch (e[1]) {
          case "NOW": return now;
          case "UPPER": return a[0] == null ? null : String(a[0]).toUpperCase();
          case "LOWER": return a[0] == null ? null : String(a[0]).toLowerCase();
          case "ROUND": { if (a[0] == null) return null; const f = 10 ** (a[1] || 0); return Math.round(a[0] * f) / f; }
          case "COALESCE": return a.find((x) => x != null) ?? null;
          case "DATE_STRING": return typeof a[0] === "number" ? new Date(a[0]).toLocaleString("id-ID") : null;
          case "ENCODEURICOMPONENT": return a[0] == null ? null : encodeURIComponent(String(a[0]));
          default: return null;
        }
      }
      case "AND": {
        const v = e.slice(1).map(ev);
        if (v.some((x) => x != null && !truthy(x))) return false;
        return v.some((x) => x == null) ? null : true;
      }
      case "OR": {
        const v = e.slice(1).map(ev);
        if (v.some(truthy)) return true;
        return v.some((x) => x == null) ? null : false;
      }
      case "NOT": { const v = ev(e[1]); return v == null ? null : !truthy(v); }
      case "IS NULL": return ev(e[1]) == null;
      case "IS NOT NULL": return ev(e[1]) != null;
      case "LIKE": case "NOT LIKE": {
        const a = ev(e[1]), b = ev(e[2]);
        if (a == null || b == null) return null;
        const r = like(String(a), String(b), e[3]);
        return op === "LIKE" ? r : !r;
      }
      case "=": case "<>": case "<": case "<=": case ">": case ">=": return cmp(op, ev(e[1]), ev(e[2]));
      case "||": { const a = ev(e[1]), b = ev(e[2]); return a == null || b == null ? null : `${a}${b}`; }
      case "+": case "-": case "*": case "/": case "%": {
        const a = ev(e[1]), b = ev(e[2]);
        if (typeof a !== "number" || typeof b !== "number") return null;
        if ((op === "/" || op === "%") && b === 0) return null;
        return op === "+" ? a + b : op === "-" ? a - b : op === "*" ? a * b : op === "/" ? a / b : a % b;
      }
      case "CASE":
        for (let i = 1; i < e.length - 1; i += 2) if (truthy(ev(e[i]))) return ev(e[i + 1]);
        return null;
      default: return null;
    }
  }

  function stringify(e, level = 0) {
    if (!Array.isArray(e)) return JSON.stringify(e ?? null);
    const op = e[0];
    if (op === "PARAM") return typeof e[1] === "string" && /^[a-zA-Z0-9_.*-]+$/.test(e[1]) ? e[1] : `{${stringify(e[1])}}`;
    if (op === "FUNC") return `${e[1]}(${e.slice(2).map((x) => stringify(x)).join(", ")})`;
    if (op === "CASE") {
      let s = "CASE";
      for (let i = 1; i < e.length - 1; i += 2) s += ` WHEN ${stringify(e[i])} THEN ${stringify(e[i + 1])}`;
      return s + " END";
    }
    const lv = LEVEL[op];
    if (lv == null) return JSON.stringify(e);
    let s;
    if (op === "NOT") s = `NOT ${stringify(e[1], lv)}`;
    else if (op === "IS NULL" || op === "IS NOT NULL") s = `${stringify(e[1], lv)} ${op}`;
    else if (op === "AND" || op === "OR") s = e.slice(1).map((x) => stringify(x, lv)).join(` ${op} `);
    else s = `${stringify(e[1], lv)} ${op} ${stringify(e[2], lv)}${e[3] ? ` ESCAPE ${JSON.stringify(e[3])}` : ""}`;
    return lv <= level ? `(${s})` : s;
  }

  // Nama parameter yang dipakai sebuah ekspresi (untuk projection)
  function params(e, out = new Set()) {
    if (Array.isArray(e)) {
      if (e[0] === "PARAM" && typeof e[1] === "string") out.add(e[1]);
      else e.slice(1).forEach((x) => params(x, out));
    }
    return out;
  }

  return { evaluate, stringify, params, truthy };
})();
