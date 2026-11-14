"""Klien API UI GenieACS (port UI, biasanya 3000) untuk menu GenieACS.

Menu GenieACS di aplikasi ini meniru UI GenieACS: daftar perangkat, halaman perangkat, Overview,
Faults, dan Admin (presets, provisions, virtual parameters, files, config, users, permissions).
Semua itu dibaca dan diubah lewat API UI GenieACS memakai akun yang diisi di tab Koneksi, sehingga
izin akun itu di GenieACS tetap berlaku. Tata letak halaman diambil dari konfigurasi `ui.*` GenieACS
sendiri (window.clientConfig), jadi perubahan Config di GenieACS langsung terlihat di sini.

Yang diteruskan hanya rute di daftar putih. Task divalidasi bentuknya, dan penghapusan objek yang
memuat koneksi manajemen TR069 ditolak.
"""
from __future__ import annotations

import json
import logging
import re
import threading
import time
from pathlib import Path
from urllib.parse import quote

import httpx

from ..config import Config
from . import ManageError
from .acs_expr import ExprError, evaluate, parse

log = logging.getLogger("manage.genieacs")

RESOURCES = {"devices", "faults", "presets", "provisions", "virtualParameters", "files", "config", "users",
             "permissions", "tasks"}
DELETABLE = RESOURCES - {"tasks"}
PUTTABLE = {"presets", "provisions", "virtualParameters", "config", "permissions", "users"}
REPLAY_MSG = "Mode replay: perubahan tidak dikirim ke GenieACS."
MGMT_MSG = ("Objek ini memuat koneksi manajemen TR069. Menghapusnya memutus ONT dari GenieACS dan ONT tidak bisa "
            "dikelola lagi dari jauh. Bila memang perlu, lakukan langsung di ONT.")
MAX_TASKS = 100
_PATH = re.compile(r"^[A-Za-z_][A-Za-z0-9_\-]*(\.([A-Za-z0-9_\-]+|\*))*\.?$")
_TAG = re.compile(r"^[A-Za-z0-9_\-.:]{1,64}$")
_HOST = re.compile(r"^[A-Za-z0-9.\-:\[\]]{1,255}$")
_ID = re.compile(r"^[^\x00-\x1f\x7f/\\]{1,512}$")
_CLIENT_CONFIG = re.compile(r"window\.clientConfig\s*=\s*(\{.*?\});\s*\n", re.S)
FILE_TYPES = ("1 Firmware Upgrade Image", "2 Web Content", "3 Vendor Configuration File", "4 Tone File", "5 Ringer File")


# ---------------------------------------------------------------- fungsi murni


def check_resource(resource: str, need: str = "read") -> None:
    ok = {"read": RESOURCES, "delete": DELETABLE, "put": PUTTABLE}[need]
    if resource not in ok:
        raise ManageError("Sumber data GenieACS tidak dikenal atau tidak boleh diubah.")


def check_id(i: str) -> str:
    if not _ID.match(i or ""):
        raise ManageError("ID tidak sah.")
    return i


def _value(v, key: str):
    if isinstance(v, bool) or isinstance(v, (int, float)):
        return v
    if isinstance(v, str) and len(v) <= 4096 and "\x00" not in v:
        return v
    raise ManageError(f"Nilai untuk {key} tidak sah.")


def _path(p, key: str = "parameter") -> str:
    if not isinstance(p, str) or not _PATH.match(p) or len(p) > 512:
        raise ManageError(f"Nama {key} tidak sah: {str(p)[:80]}")
    return p


def clean_tasks(tasks) -> list[dict]:
    """Saring daftar task dari browser: hanya jenis dan kolom yang dikenal."""
    if not isinstance(tasks, list) or not tasks:
        raise ManageError("Tidak ada tugas yang dikirim.")
    if len(tasks) > MAX_TASKS:
        raise ManageError(f"Maksimal {MAX_TASKS} tugas sekali kirim.")
    out = []
    for t in tasks:
        if not isinstance(t, dict):
            raise ManageError("Format tugas tidak sah.")
        name = t.get("name")
        if name == "getParameterValues":
            names = t.get("parameterNames")
            if not isinstance(names, list) or not names or len(names) > 500:
                raise ManageError("Daftar parameter untuk summon tidak sah.")
            out.append({"name": name, "parameterNames": [_path(n) for n in names]})
        elif name == "setParameterValues":
            vals = t.get("parameterValues")
            if not isinstance(vals, list) or not vals or len(vals) > 200:
                raise ManageError("Daftar nilai parameter tidak sah.")
            pv = []
            for item in vals:
                if not isinstance(item, list) or len(item) not in (2, 3):
                    raise ManageError("Format nilai parameter tidak sah.")
                row = [_path(item[0]), _value(item[1], item[0])]
                if len(item) == 3:
                    if not isinstance(item[2], str) or not re.match(r"^xsd:[A-Za-z]{2,20}$", item[2]):
                        raise ManageError("Tipe parameter tidak sah.")
                    row.append(item[2])
                pv.append(row)
            out.append({"name": name, "parameterValues": pv})
        elif name in ("refreshObject", "addObject", "deleteObject"):
            obj = t.get("objectName", "")
            if obj != "" or name != "refreshObject":
                _path(obj, "objek")
            if name == "deleteObject" and not re.search(r"\.\d+\.?$", obj):
                raise ManageError("Hanya instance (berakhiran nomor) yang bisa dihapus.")
            out.append({"name": name, "objectName": obj.rstrip(".") if name != "refreshObject" else obj})
        elif name in ("reboot", "factoryReset"):
            out.append({"name": name})
        elif name == "download":
            ft, fn = t.get("fileType"), t.get("fileName")
            if ft not in FILE_TYPES or not isinstance(fn, str) or not _ID.match(fn):
                raise ManageError("Pilih berkas dan jenisnya dengan benar.")
            item = {"name": name, "fileType": ft, "fileName": fn}
            if t.get("targetFileName"):
                item["targetFileName"] = check_id(str(t["targetFileName"]))
            out.append(item)
        else:
            raise ManageError(f"Jenis tugas tidak dikenal: {str(name)[:40]}")
    return out


def _flat_val(doc: dict, key: str):
    x = doc.get(key)
    v = x.get("value") if isinstance(x, dict) else None
    return v[0] if isinstance(v, list) and v else None


def holds_mgmt(doc: dict, obj: str) -> bool:
    """Apakah objek (dokumen datar API UI) memuat koneksi WAN manajemen TR069."""
    prefix = obj.rstrip(".") + "."
    tr069_ip = str(_flat_val(doc, "VirtualParameters.IPTR069") or "")
    for k in doc:
        if not k.startswith(prefix):
            continue
        tail = k.rsplit(".", 1)[-1].lower()
        v = str(_flat_val(doc, k) or "")
        if (tail == "name" or tail.endswith("servicelist")) and "TR069" in v.upper():
            return True
        if tail == "externalipaddress" and tr069_ip and v == tr069_ip:
            return True
    return False


def extract_client_config(html: str) -> dict:
    m = _CLIENT_CONFIG.search(html or "")
    if not m:
        raise ManageError("Konfigurasi tampilan GenieACS tidak terbaca. Pastikan alamat yang diisi adalah UI GenieACS (bukan NBI).")
    return json.loads(m.group(1))


# ---------------------------------------------------------------- klien


class UiClient:
    def __init__(self, cfg: Config, transport: httpx.BaseTransport | None = None):
        self.cfg, self._transport = cfg, transport
        self._lock = threading.Lock()
        self._token: tuple[str, str] = ("", "")  # (kunci akun, token)
        self._conf: tuple[str, float, dict] = ("", 0.0, {})

    def _base(self) -> str:
        if not self.cfg.genieacs_ui_url:
            raise ManageError("Alamat UI GenieACS belum diisi. Isi di tab Koneksi.")
        return self.cfg.genieacs_ui_url.rstrip("/")

    def _account(self) -> str:
        return f"{self.cfg.genieacs_ui_url}|{self.cfg.genieacs_ui_user}|{self.cfg.genieacs_ui_password}"

    def _client(self, timeout: float) -> httpx.Client:
        return httpx.Client(base_url=self._base(), timeout=timeout, transport=self._transport)

    def _login(self, c: httpx.Client) -> str:
        r = c.post("/login", json={"username": self.cfg.genieacs_ui_user, "password": self.cfg.genieacs_ui_password})
        if r.status_code == 400:
            raise ManageError("Login ke UI GenieACS ditolak. Periksa username dan password di tab Koneksi.")
        r.raise_for_status()
        token = r.json() if r.headers.get("content-type", "").startswith("application/json") else r.cookies.get("genieacs-ui-jwt")
        if not isinstance(token, str) or not token:
            raise ManageError("UI GenieACS tidak memberi token login. Pastikan alamatnya UI GenieACS.")
        with self._lock:
            self._token = (self._account(), token)
        return token

    def request(self, method: str, path: str, *, params=None, json_body=None, content=None, headers=None,
                timeout: float = 60.0) -> httpx.Response:
        with self._client(timeout) as c:
            for attempt in (0, 1):
                with self._lock:
                    acc, token = self._token
                if not token or acc != self._account():
                    token = self._login(c)
                h = {"Cookie": f"genieacs-ui-jwt={token}", **(headers or {})}
                r = c.request(method, path, params=params, json=json_body, content=content, headers=h)
                if r.status_code == 401 and attempt == 0:
                    with self._lock:
                        self._token = ("", "")
                    continue
                if r.status_code == 401:
                    raise ManageError("Sesi ke UI GenieACS ditolak. Periksa akun di tab Koneksi.")
                if r.status_code == 403:
                    raise ManageError("Akun GenieACS ini tidak punya izin untuk tindakan tersebut.")
                if r.status_code >= 400:
                    text = r.text.strip().strip('"')[:300] or r.reason_phrase
                    raise ManageError(f"GenieACS menjawab {r.status_code}: {text}")
                return r
        raise AssertionError("tidak tercapai")

    # ------------------------------------------------------------ operasi
    def client_config(self) -> dict:
        with self._lock:
            acc, ts, conf = self._conf
        if acc == self.cfg.genieacs_ui_url and time.time() - ts < 30:
            return conf
        with self._client(30) as c:
            r = c.get("/")
            r.raise_for_status()
            conf = extract_client_config(r.text)
        conf = {"ui": conf.get("ui", {}), "snapshot": r.headers.get("X-Config-Snapshot", ""),
                "version": r.headers.get("GenieACS-Version", "")}
        with self._lock:
            self._conf = (self.cfg.genieacs_ui_url, time.time(), conf)
        return conf

    def forget_config(self) -> None:
        with self._lock:
            self._conf = ("", 0.0, {})

    def list(self, resource: str, params: dict) -> list:
        check_resource(resource)
        return self.request("GET", f"/api/{resource}/", params=params).json()

    def count(self, resource: str, flt: str) -> int:
        check_resource(resource)
        r = self.request("HEAD", f"/api/{resource}/", params={"filter": flt or "true"})
        return int(r.headers.get("X-Total-Count") or 0)

    def device(self, device_id: str) -> dict:
        docs = self.list("devices", {"filter": f"DeviceID.ID = {json.dumps(device_id)}"})
        if not docs:
            raise ManageError("Perangkat tidak ditemukan di GenieACS.")
        return docs[0]

    def csv(self, resource: str, params: dict, device_id: str = "") -> httpx.Response:
        check_resource(resource)
        path = f"/api/devices/{quote(device_id, safe='')}.csv" if device_id else f"/api/{resource}.csv"
        return self.request("GET", path, params=params, timeout=120)

    def post_tasks(self, device_id: str, tasks) -> dict:
        tasks = clean_tasks(tasks)
        doc = None
        for t in tasks:
            if t["name"] == "deleteObject":
                doc = doc or self.device(device_id)
                if holds_mgmt(doc, t["objectName"]):
                    raise ManageError(MGMT_MSG)
        r = self.request("POST", f"/api/devices/{quote(device_id, safe='')}/tasks", json_body=tasks, timeout=180)
        log.info("task ke %s: %s -> %s", device_id, ", ".join(t["name"] for t in tasks), r.headers.get("Connection-Request"))
        return {"tasks": r.json() if r.content else [], "connectionRequest": r.headers.get("Connection-Request", "")}

    def tags(self, device_id: str, changes) -> None:
        if not isinstance(changes, dict) or not changes or not all(_TAG.match(str(k)) and isinstance(v, bool) for k, v in changes.items()):
            raise ManageError("Tag hanya boleh huruf, angka, titik, titik dua, garis bawah, dan tanda hubung.")
        self.request("POST", f"/api/devices/{quote(device_id, safe='')}/tags", json_body=changes)

    def delete(self, resource: str, item_id: str) -> None:
        check_resource(resource, "delete")
        check_id(item_id)
        if resource == "users" and item_id == self.cfg.genieacs_ui_user:
            raise ManageError("Akun ini dipakai aplikasi untuk masuk ke GenieACS, jadi tidak bisa dihapus dari sini.")
        self.request("DELETE", f"/api/{resource}/{quote(item_id, safe='')}")
        log.info("hapus %s/%s", resource, item_id)
        if resource == "config":
            self.forget_config()

    def put(self, resource: str, item_id: str, body) -> None:
        check_resource(resource, "put")
        check_id(item_id)
        if not isinstance(body, dict):
            raise ManageError("Isi tidak sah.")
        if resource == "config":
            try:
                parse(str(body.get("value", "")))
            except ExprError as e:
                raise ManageError(f"Nilai config bukan ekspresi yang sah: {e}") from None
        self.request("PUT", f"/api/{resource}/{quote(item_id, safe='')}", json_body=body)
        log.info("simpan %s/%s", resource, item_id)
        if resource == "config":
            self.forget_config()

    def password(self, user: str, new: str) -> None:
        check_id(user)
        if not isinstance(new, str) or not 4 <= len(new) <= 128:
            raise ManageError("Password minimal 4 karakter.")
        self.request("PUT", f"/api/users/{quote(user, safe='')}/password", json_body={"newPassword": new})

    def upload(self, name: str, data: bytes, meta: dict) -> None:
        check_id(name)
        if meta.get("fileType") not in FILE_TYPES:
            raise ManageError("Pilih jenis berkas.")
        h = {"Content-Type": "application/octet-stream", "Metadata-FileType": meta["fileType"]}
        for k, hk in (("oui", "Metadata-OUI"), ("productClass", "Metadata-ProductClass"), ("version", "Metadata-Version")):
            v = str(meta.get(k) or "")
            if v:
                if not re.match(r"^[\x20-\x7e]{1,128}$", v):
                    raise ManageError(f"Isian {k} tidak sah.")
                h[hk] = v
        self.request("PUT", f"/api/files/{quote(name, safe='')}", content=data, headers=h, timeout=600)

    def blob(self, name: str) -> httpx.Response:
        check_id(name)
        return self.request("GET", f"/api/blob/files/{quote(name, safe='')}", timeout=600)

    def ping(self, host: str):
        if not _HOST.match(host or ""):
            raise ManageError("Alamat ping tidak sah.")
        return self.request("GET", f"/api/ping/{quote(host, safe='')}", timeout=30).json()


# ---------------------------------------------------------------- mode replay


def _flatten_nbi(doc: dict) -> dict:
    """Dokumen NBI (bersarang) -> dokumen datar seperti API UI."""
    out: dict = {}

    def walk(node: dict, prefix: str) -> None:
        for k, v in node.items():
            if k.startswith("_") or not isinstance(v, dict):
                continue
            p = prefix + k
            if "_value" in v:
                out[p] = {"value": [v["_value"], v.get("_type") or "xsd:string"], "writable": bool(v.get("_writable")), "object": False}
            else:
                out[p] = {"object": True, "writable": bool(v.get("_writable"))}
                walk(v, p + ".")

    walk(doc, "")
    ident = doc.get("_deviceId") or {}
    leaf = lambda v, t="xsd:string": {"value": [v, t], "writable": False, "object": False}
    out["DeviceID.ID"] = leaf(doc.get("_id", ""))
    for k, n in (("_Manufacturer", "Manufacturer"), ("_OUI", "OUI"), ("_ProductClass", "ProductClass"), ("_SerialNumber", "SerialNumber")):
        if ident.get(k):
            out["DeviceID." + n] = leaf(ident[k])
    from datetime import datetime
    try:
        out["Events.Inform"] = leaf(int(datetime.fromisoformat(doc["_lastInform"].replace("Z", "+00:00")).timestamp() * 1000), "xsd:dateTime")
    except (KeyError, ValueError, AttributeError):
        pass
    for t in doc.get("_tags") or []:
        out["Tags." + t] = leaf(True, "xsd:boolean")
    return out


def _merge(base: dict, extra: dict) -> dict:
    out = dict(base)
    for k, v in extra.items():
        if k not in out:
            out[k] = v
        elif isinstance(out[k], dict) and isinstance(v, dict) and "_value" not in out[k]:
            out[k] = _merge(out[k], v)
    return out


class ReplayUi:
    """Pengganti UiClient di mode replay: data dari fixture, semua perubahan ditolak."""

    def __init__(self, folder: str | Path):
        d = Path(folder)
        rd = lambda n: json.loads((d / n).read_text(encoding="utf-8")) if (d / n).is_file() else None
        sample = rd("genieacs_detail_contoh.json") or {}
        self._devices = [_flatten_nbi(_merge(x, sample)) for x in rd("genieacs_devices.json") or []]
        self._ui = rd("genieacs_ui_contoh.json") or {}
        self._admin = self._ui.pop("admin", {})

    def client_config(self) -> dict:
        return {"ui": self._ui, "snapshot": "replay", "version": "replay"}

    def _docs(self, resource: str) -> list[dict]:
        check_resource(resource)
        return self._devices if resource == "devices" else list(self._admin.get(resource, []))

    def _filtered(self, resource: str, flt: str) -> list[dict]:
        try:
            e = parse(flt or "true")
        except ExprError as x:
            raise ManageError(f"Filter tidak sah: {x}") from None
        now = time.time() * 1000
        out = []
        for d in self._docs(resource):
            get = (lambda k, d=d: _flat_val(d, k)) if resource == "devices" else (lambda k, d=d: d.get(k))
            if evaluate(e, get, now):
                out.append(d)
        return out

    def list(self, resource: str, params: dict) -> list:
        rows = self._filtered(resource, params.get("filter", "true"))
        sort = json.loads(params.get("sort") or "{}")
        for k, direction in reversed(list(sort.items())):
            key = (lambda d: str(_flat_val(d, k) or "")) if resource == "devices" else (lambda d: str(d.get(k) or ""))
            rows.sort(key=key, reverse=direction < 0)
        skip, limit = int(params.get("skip") or 0), int(params.get("limit") or 0)
        rows = rows[skip: skip + limit] if limit else rows[skip:]
        proj = [p for p in str(params.get("projection") or "").split(",") if p]
        if proj and resource == "devices":
            rows = [{k: v for k, v in d.items() if any(k == p or k.startswith(p + ".") for p in proj)} for d in rows]
        return rows

    def count(self, resource: str, flt: str) -> int:
        return len(self._filtered(resource, flt))

    def device(self, device_id: str) -> dict:
        d = next((x for x in self._devices if _flat_val(x, "DeviceID.ID") == device_id), None)
        if d is None:
            raise ManageError("Perangkat tidak ditemukan.")
        return d

    def csv(self, *a, **k):
        raise ManageError("Unduh CSV tidak tersedia di mode replay.")

    def post_tasks(self, device_id: str, tasks) -> dict:
        tasks = clean_tasks(tasks)
        doc = self.device(device_id)
        for t in tasks:
            if t["name"] == "deleteObject" and holds_mgmt(doc, t["objectName"]):
                raise ManageError(MGMT_MSG)
        raise ManageError(REPLAY_MSG)

    def tags(self, *a):
        raise ManageError(REPLAY_MSG)

    def delete(self, resource: str, item_id: str):
        check_resource(resource, "delete")
        raise ManageError(REPLAY_MSG)

    def put(self, resource: str, item_id: str, body):
        check_resource(resource, "put")
        if resource == "config":
            try:
                parse(str((body or {}).get("value", "")))
            except ExprError as e:
                raise ManageError(f"Nilai config bukan ekspresi yang sah: {e}") from None
        raise ManageError(REPLAY_MSG)

    def password(self, *a):
        raise ManageError(REPLAY_MSG)

    def upload(self, *a):
        raise ManageError(REPLAY_MSG)

    def blob(self, *a):
        raise ManageError(REPLAY_MSG)

    def ping(self, host: str):
        raise ManageError("Ping tidak tersedia di mode replay.")
