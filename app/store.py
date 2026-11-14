"""Penyimpanan SQLite: deret waktu untuk chart, riwayat kejadian loop, riwayat skor ONT."""
from __future__ import annotations

import json
import sqlite3
import threading
import time
from pathlib import Path

MAX_MOVES = 200  # batas baris per pemeriksaan supaya badai loop tidak membengkakkan database

SCHEMA = """
CREATE TABLE IF NOT EXISTS samples (
  ts INTEGER PRIMARY KEY, loop_active INTEGER, flap_macs INTEGER, flap_events INTEGER,
  hotspot_active INTEGER, strong INTEGER, risk INTEGER, blocked INTEGER);
CREATE TABLE IF NOT EXISTS incidents (
  id INTEGER PRIMARY KEY AUTOINCREMENT, start_ts INTEGER, end_ts INTEGER,
  blocked_vlans TEXT, suspects TEXT);
CREATE TABLE IF NOT EXISTS scores (ts INTEGER, device_id TEXT, score INTEGER, level TEXT);
CREATE INDEX IF NOT EXISTS scores_dev ON scores(device_id, ts);
CREATE TABLE IF NOT EXISTS moves (
  ts INTEGER, mac TEXT, events INTEGER, ports TEXT, kind TEXT, onts TEXT, flapping INTEGER);
CREATE INDEX IF NOT EXISTS moves_ts ON moves(ts);
"""


class Store:
    def __init__(self, path: str):
        if path != ":memory:":
            Path(path).parent.mkdir(parents=True, exist_ok=True)
        self._db = sqlite3.connect(path, check_same_thread=False)
        self._db.row_factory = sqlite3.Row
        self._lock = threading.Lock()
        with self._lock, self._db:
            self._db.executescript(SCHEMA)

    # ------------------------------------------------------------ tulis
    def add_sample(self, a: dict, ts: int | None = None) -> None:
        c = a["counts"]
        ts = ts or a["ts"]
        with self._lock, self._db:
            self._db.execute(
                "INSERT OR REPLACE INTO samples VALUES (?,?,?,?,?,?,?,?)",
                (ts, int(a["loop"]["active"]), c["flapping_macs"], c["flap_events"], c["hotspot_active"],
                 c["strong"], c["risk"], len(a["loop"]["blocked_vlans"])),
            )
            self._db.executemany(
                "INSERT INTO scores VALUES (?,?,?,?)",
                [(ts, s["id"], s["score"], s["level"]) for s in a["suspects"] if s["level"] != "normal"],
            )
            self._db.execute("DELETE FROM moves WHERE ts=?", (ts,))
            self._db.executemany(
                "INSERT INTO moves VALUES (?,?,?,?,?,?,?)",
                [(ts, m["mac"], m["events"], json.dumps(m["ports"]), m["kind"], json.dumps(m["onts"]), int(m["flapping"]))
                 for m in a.get("moved", [])[:MAX_MOVES]],
            )

    def open_incident(self, a: dict, ts: int | None = None) -> int:
        with self._lock, self._db:
            cur = self._db.execute(
                "INSERT INTO incidents (start_ts, blocked_vlans, suspects) VALUES (?,?,?)",
                (ts or a["ts"], json.dumps(a["loop"]["blocked_vlans"]), json.dumps(_top(a))),
            )
            return cur.lastrowid

    def update_incident(self, inc_id: int, a: dict) -> None:
        """Simpan tersangka terbaik selama kejadian berlangsung (jangan timpa dengan daftar kosong)."""
        top = _top(a)
        with self._lock, self._db:
            row = self._db.execute("SELECT blocked_vlans, suspects FROM incidents WHERE id=?", (inc_id,)).fetchone()
            if not row:
                return
            vl = sorted(set(json.loads(row["blocked_vlans"] or "[]")) | set(a["loop"]["blocked_vlans"]))
            old = json.loads(row["suspects"] or "[]")
            best = top if (top and (not old or top[0]["score"] >= old[0]["score"])) else old
            self._db.execute(
                "UPDATE incidents SET blocked_vlans=?, suspects=? WHERE id=?", (json.dumps(vl), json.dumps(best), inc_id)
            )

    def close_incident(self, inc_id: int, ts: int) -> None:
        with self._lock, self._db:
            self._db.execute("UPDATE incidents SET end_ts=? WHERE id=?", (ts, inc_id))

    def prune(self, days: int) -> None:
        cut = int(time.time()) - days * 86400
        with self._lock, self._db:
            self._db.execute("DELETE FROM samples WHERE ts<?", (cut,))
            self._db.execute("DELETE FROM scores WHERE ts<?", (cut,))
            self._db.execute("DELETE FROM moves WHERE ts<?", (cut,))

    # ------------------------------------------------------------ baca
    def open_incident_id(self) -> int | None:
        with self._lock:
            r = self._db.execute("SELECT id FROM incidents WHERE end_ts IS NULL ORDER BY id DESC LIMIT 1").fetchone()
        return r["id"] if r else None

    def series(self, since: int, max_points: int = 720) -> dict:
        with self._lock:
            rows = self._db.execute("SELECT * FROM samples WHERE ts>=? ORDER BY ts", (since,)).fetchall()
        step = max(1, len(rows) // max_points)
        keys = ["ts", "loop_active", "flap_macs", "flap_events", "hotspot_active", "strong", "risk", "blocked"]
        out = {k: [] for k in keys}
        for i in range(0, len(rows), step):
            chunk = rows[i : i + step]
            out["ts"].append(chunk[-1]["ts"])
            for k in keys[1:]:
                vals = [r[k] for r in chunk if r[k] is not None]
                # ambil nilai terburuk dalam satu kelompok supaya lonjakan singkat tidak hilang
                out[k].append((min(vals) if k == "hotspot_active" else max(vals)) if vals else None)
        return out

    def moves(self, start: int, end: int) -> dict:
        """MAC yang pindah port pada pemeriksaan di antara start..end (detik), digabung per MAC.

        Jendela flapping saling tumpang tindih antar-pemeriksaan, jadi per MAC yang dilaporkan adalah
        jumlah pindah tertinggi dalam satu pemeriksaan, bukan penjumlahan."""
        with self._lock:
            rows = self._db.execute(
                "SELECT mac, MAX(events) AS events, MAX(flapping) AS flapping, COUNT(*) AS seen, MIN(ts) AS first,"
                " MAX(ts) AS last, group_concat(DISTINCT ports) AS ports, group_concat(DISTINCT onts) AS onts,"
                " MAX(kind) AS kind"
                " FROM moves WHERE ts>=? AND ts<=? GROUP BY mac"
                " ORDER BY MAX(flapping) DESC, MAX(events) DESC, mac LIMIT ?",
                (start, end, MAX_MOVES),
            ).fetchall()
            n = self._db.execute("SELECT COUNT(*) FROM samples WHERE ts>=? AND ts<=?", (start, end)).fetchone()[0]

        def union(blob: str | None) -> list[str]:
            # group_concat menggabungkan beberapa larik JSON dengan koma: "[..],[..]"
            return sorted({x for part in json.loads(f"[{blob or ''}]") for x in part})

        macs = [
            {"mac": r["mac"], "events": r["events"], "ports": union(r["ports"]), "kind": r["kind"],
             "onts": union(r["onts"]), "flapping": bool(r["flapping"]), "first": r["first"], "last": r["last"],
             "seen": r["seen"]}
            for r in rows
        ]
        return {"start": start, "end": end, "samples": n, "macs": macs}

    def incidents(self, limit: int = 20) -> list[dict]:
        with self._lock:
            rows = self._db.execute("SELECT * FROM incidents ORDER BY id DESC LIMIT ?", (limit,)).fetchall()
        return [
            {"id": r["id"], "start_ts": r["start_ts"], "end_ts": r["end_ts"],
             "blocked_vlans": json.loads(r["blocked_vlans"] or "[]"), "suspects": json.loads(r["suspects"] or "[]")}
            for r in rows
        ]

    def score_history(self, device_id: str, since: int) -> dict:
        with self._lock:
            rows = self._db.execute(
                "SELECT ts, score FROM scores WHERE device_id=? AND ts>=? ORDER BY ts", (device_id, since)
            ).fetchall()
        return {"ts": [r["ts"] for r in rows], "score": [r["score"] for r in rows]}


def _top(a: dict) -> list[dict]:
    return [
        {"id": s["id"], "serial": s["serial"], "label": s["label"], "score": s["score"], "level": s["level"],
         "trunk": s["trunk"], "tr069_ip": s["tr069_ip"]}
        for s in a["suspects"][:5]
        if s["level"] != "normal"
    ]
