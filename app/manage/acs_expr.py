"""Pengurai dan penilai ekspresi GenieACS (bentuk teks -> bentuk larik), untuk mode replay dan tes.

Bentuk larik sama dengan yang dipakai GenieACS: ["AND", a, b], ["=", ["PARAM", "x"], "v"],
["FUNC", "NOW"], dst. Penilaian memakai logika tiga nilai (None = tidak diketahui), seperti SQL.
"""
from __future__ import annotations

import re
import time
from datetime import datetime, timezone
from urllib.parse import quote

_TOKEN = re.compile(r"""
    \s*(?:
      (?P<num>\d+(?:\.\d+)?)
    | (?P<sq>'(?:[^']|'')*')
    | (?P<dq>"(?:[^"\\]|\\.)*")
    | (?P<brace>\{[^}]*\})
    | (?P<op><>|<=|>=|\|\||[=<>+\-*/%(),])
    | (?P<name>[A-Za-z_][A-Za-z0-9_.*\-]*)
    )""", re.X)
_KEYWORDS = {"AND", "OR", "NOT", "LIKE", "IS", "NULL", "TRUE", "FALSE", "CASE", "WHEN", "THEN", "ELSE", "END", "ESCAPE"}
_BIN = {"OR": 10, "AND": 11, "=": 20, "<>": 20, "<": 20, "<=": 20, ">": 20, ">=": 20, "LIKE": 20,
        "||": 30, "+": 31, "-": 31, "*": 32, "/": 32, "%": 32}


class ExprError(ValueError):
    pass


def _tokens(s: str) -> list[tuple[str, object]]:
    out, i = [], 0
    s = s or ""
    while i < len(s):
        if s[i:].strip() == "":
            break
        m = _TOKEN.match(s, i)
        if not m or m.end() == i:
            raise ExprError(f"Tidak bisa membaca ekspresi di posisi {i}: {s[i:i + 20]!r}")
        i = m.end()
        k = m.lastgroup
        v = m.group(k)
        if k == "num":
            out.append(("val", float(v) if "." in v else int(v)))
        elif k == "sq":
            out.append(("val", v[1:-1].replace("''", "'")))
        elif k == "dq":
            import json
            out.append(("val", json.loads(v)))
        elif k == "brace":
            out.append(("name", v[1:-1]))
        elif k == "op":
            out.append(("op", v))
        else:
            up = v.upper()
            out.append(("kw", up) if up in _KEYWORDS else ("name", v))
    out.append(("end", None))
    return out


class _P:
    def __init__(self, s: str):
        self.t, self.i = _tokens(s), 0

    def peek(self, k=0):
        return self.t[min(self.i + k, len(self.t) - 1)]

    def take(self):
        tok = self.t[self.i]
        self.i += 1
        return tok

    def expect(self, kind, val=None):
        tok = self.take()
        if tok[0] != kind or (val is not None and tok[1] != val):
            raise ExprError(f"Diharapkan {val or kind}, ditemukan {tok[1]!r}")
        return tok

    def parse(self, level=0):
        left = self.prefix()
        while True:
            kind, v = self.peek()
            op = v if kind in ("op", "kw") else None
            if op == "IS" and level < 20:
                self.take()
                neg = self.peek() == ("kw", "NOT")
                if neg:
                    self.take()
                self.expect("kw", "NULL")
                left = ["IS NOT NULL" if neg else "IS NULL", left]
                continue
            if op == "NOT" and self.peek(1) == ("kw", "LIKE") and level < 20:
                self.take()
                self.take()
                left = ["NOT LIKE", left, self.parse(20)]
                continue
            if op not in _BIN or _BIN[op] <= level:
                return left
            self.take()
            right = self.parse(_BIN[op])
            if op == "LIKE" and self.peek() == ("kw", "ESCAPE"):
                self.take()
                left = ["LIKE", left, right, self.expect("val")[1]]
            else:
                left = [op, left, right]

    def prefix(self):
        kind, v = self.take()
        if kind == "val":
            return v
        if kind == "kw":
            if v == "NULL":
                return None
            if v in ("TRUE", "FALSE"):
                return v == "TRUE"
            if v == "NOT":
                return ["NOT", self.parse(12)]
            if v == "CASE":
                out = ["CASE"]
                while self.peek() == ("kw", "WHEN"):
                    self.take()
                    out.append(self.parse())
                    self.expect("kw", "THEN")
                    out.append(self.parse())
                if self.peek() == ("kw", "ELSE"):
                    self.take()
                    out += [True, self.parse()]
                self.expect("kw", "END")
                return out
        if kind == "op" and v == "(":
            e = self.parse()
            self.expect("op", ")")
            return e
        if kind == "op" and v == "-":
            e = self.parse(32)
            return -e if isinstance(e, (int, float)) else ["*", -1, e]
        if kind == "name":
            if self.peek() == ("op", "("):
                self.take()
                args = []
                if self.peek() != ("op", ")"):
                    args.append(self.parse())
                    while self.peek() == ("op", ","):
                        self.take()
                        args.append(self.parse())
                self.expect("op", ")")
                return ["FUNC", v.upper(), *args]
            return ["PARAM", v]
        raise ExprError(f"Bagian ekspresi tidak terduga: {v!r}")


def parse(s: str):
    p = _P(s)
    e = p.parse()
    if p.peek()[0] != "end":
        raise ExprError(f"Sisa ekspresi tidak terbaca: {p.peek()[1]!r}")
    return e


def _like(v, pat, esc=None) -> bool:
    rx, i = "", 0
    while i < len(pat):
        c = pat[i]
        if esc and c == esc and i + 1 < len(pat):
            rx += re.escape(pat[i + 1])
            i += 2
            continue
        rx += ".*" if c == "%" else "." if c == "_" else re.escape(c)
        i += 1
    return re.fullmatch(rx, v, re.S) is not None


def _cmp(op, a, b):
    if a is None or b is None:
        return None
    num = (int, float)
    if isinstance(a, bool) or isinstance(b, bool):
        if not (isinstance(a, bool) and isinstance(b, bool)):
            return False if op != "<>" else True
    elif isinstance(a, num) != isinstance(b, num):
        return False if op != "<>" else True
    return {"=": a == b, "<>": a != b, "<": a < b, "<=": a <= b, ">": a > b, ">=": a >= b}[op]


def evaluate(e, get, now_ms: float | None = None):
    """Nilai ekspresi. `get(name)` mengembalikan nilai parameter atau None."""
    now_ms = time.time() * 1000 if now_ms is None else now_ms
    ev = lambda x: evaluate(x, get, now_ms)
    if not isinstance(e, list):
        return e
    op = e[0]
    if op == "PARAM":
        return get(e[1])
    if op == "FUNC":
        name, args = e[1], [ev(a) for a in e[2:]]
        if name == "NOW":
            return now_ms
        if name == "UPPER":
            return None if args[0] is None else str(args[0]).upper()
        if name == "LOWER":
            return None if args[0] is None else str(args[0]).lower()
        if name == "ROUND":
            return None if args[0] is None else round(args[0], int(args[1]) if len(args) > 1 else 0)
        if name == "COALESCE":
            return next((a for a in args if a is not None), None)
        if name == "DATE_STRING":
            return None if not isinstance(args[0], (int, float)) else datetime.fromtimestamp(args[0] / 1000, timezone.utc).isoformat()
        if name == "ENCODEURICOMPONENT":
            return None if args[0] is None else quote(str(args[0]), safe="-_.!~*'()")
        raise ExprError(f"Fungsi {name} tidak dikenal")
    if op == "AND":
        vals = [ev(x) for x in e[1:]]
        if any(v is False or v == 0 for v in vals if v is not None):
            return False
        return None if any(v is None for v in vals) else True
    if op == "OR":
        vals = [ev(x) for x in e[1:]]
        if any(v not in (None, False, 0, "") for v in vals):
            return True
        return None if any(v is None for v in vals) else False
    if op == "NOT":
        v = ev(e[1])
        return None if v is None else not v
    if op == "IS NULL":
        return ev(e[1]) is None
    if op == "IS NOT NULL":
        return ev(e[1]) is not None
    if op in ("LIKE", "NOT LIKE"):
        a, b = ev(e[1]), ev(e[2])
        if a is None or b is None:
            return None
        r = _like(str(a), str(b), e[3] if len(e) > 3 else None)
        return r if op == "LIKE" else not r
    if op in ("=", "<>", "<", "<=", ">", ">="):
        return _cmp(op, ev(e[1]), ev(e[2]))
    if op == "||":
        a, b = ev(e[1]), ev(e[2])
        return None if a is None or b is None else f"{a}{b}"
    if op in ("+", "-", "*", "/", "%"):
        a, b = ev(e[1]), ev(e[2])
        if not isinstance(a, (int, float)) or not isinstance(b, (int, float)):
            return None
        if op in "/%" and b == 0:
            return None
        return {"+": a + b, "-": a - b, "*": a * b, "/": a / b, "%": a % b}[op]
    if op == "CASE":
        for i in range(1, len(e) - 1, 2):
            if ev(e[i]):
                return ev(e[i + 1])
        return None
    raise ExprError(f"Operator {op} tidak dikenal")
