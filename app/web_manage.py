"""Rute halaman dan API untuk tab GenieACS, Switch, dan MikroTik."""
from __future__ import annotations

import logging
import threading
from pathlib import Path

from fastapi import Body, Depends, FastAPI, HTTPException, Request
from fastapi.concurrency import run_in_threadpool
from fastapi.responses import FileResponse, JSONResponse, Response

from . import settings
from .config import Config
from .manage import ManageError
from .manage import cisco as sw
from .manage import genieacs_ui as acs_mod
from .manage import mikrotik as mt
from .monitor import Monitor

log = logging.getLogger("manage")
STATIC = Path(__file__).parent / "static"
REPLAY_ONLY = "Tidak tersedia di mode replay karena tidak ada perangkat yang dihubungi."


def register(app: FastAPI, cfg: Config, monitor: Monitor, json_only) -> None:
    replay_dir = Path(getattr(monitor, "replay_dir", "") or ".")
    acs = acs_mod.ReplayUi(replay_dir) if monitor.replay else acs_mod.UiClient(cfg)
    # satu sesi per perangkat pada satu waktu: jalur VTY switch dan sesi SSH router terbatas
    locks = {"cisco": threading.Lock(), "mikrotik": threading.Lock()}
    mutate = [Depends(json_only)]

    def fx(name: str) -> str:
        p = replay_dir / name
        return p.read_text(encoding="utf-8") if p.is_file() else ""

    def guard(fn, lock: str = ""):
        try:
            if lock:
                with locks[lock]:
                    return fn()
            return fn()
        except ManageError as e:
            return JSONResponse({"ok": False, "message": str(e)}, status_code=400)
        except Exception as e:  # kegagalan jaringan/login ke perangkat
            log.warning("permintaan kelola gagal: %s: %s", type(e).__name__, e)
            return JSONResponse({"ok": False, "message": settings._err(e)}, status_code=502)

    def live(fn, sample):
        """Di mode replay pakai `sample()`, selain itu `fn()`."""
        return sample() if monitor.replay else fn()

    def no_replay():
        if monitor.replay:
            raise ManageError("Mode replay: perubahan tidak dikirim ke perangkat.")

    for path, page in (("/genieacs", "genieacs.html"), ("/switch", "switch.html"), ("/mikrotik", "mikrotik.html")):
        app.add_api_route(path, lambda page=page: FileResponse(STATIC / page, headers={"Cache-Control": "no-cache"}),
                          methods=["GET"])

    # ------------------------------------------------------------ GenieACS (lewat API UI GenieACS)
    def upload_guard(request: Request) -> None:
        # unggahan berkas bukan JSON; header khusus ini tidak bisa dipasang oleh form dari situs lain
        if request.headers.get("x-ontloop") != "1":
            raise HTTPException(415, "Header X-Ontloop wajib ada")

    def passthrough(r, filename: str):
        return Response(r.content, media_type=r.headers.get("content-type", "application/octet-stream"),
                        headers={"Content-Disposition": f'attachment; filename="{filename}"'})

    @app.get("/api/acs/config")
    def acs_config():
        return guard(lambda: {"replay": monitor.replay, "user": "" if monitor.replay else cfg.genieacs_ui_user,
                              **acs.client_config()})

    @app.get("/api/acs/{resource}/list")
    def acs_list(resource: str, filter: str = "true", limit: int = 100, skip: int = 0, sort: str = "", projection: str = ""):
        params = {"filter": filter or "true", "limit": str(min(max(limit, 1), 1000)), "skip": str(max(skip, 0))}
        if sort:
            params["sort"] = sort
        if projection:
            params["projection"] = projection
        return guard(lambda: acs.list(resource, params))

    @app.get("/api/acs/{resource}/count")
    def acs_count(resource: str, filter: str = "true"):
        return guard(lambda: {"total": acs.count(resource, filter)})

    @app.get("/api/acs/device")
    def acs_device(id: str):
        return guard(lambda: acs.device(id))

    @app.get("/api/acs/devices.csv")
    def acs_devices_csv(filter: str = "true", columns: str = "{}"):
        return guard(lambda: passthrough(acs.csv("devices", {"filter": filter, "columns": columns}), "perangkat.csv"))

    @app.get("/api/acs/device.csv")
    def acs_device_csv(id: str):
        return guard(lambda: passthrough(acs.csv("devices", {}, id), "parameter.csv"))

    @app.get("/api/acs/ping")
    def acs_ping(host: str):
        return guard(lambda: acs.ping(host))

    @app.get("/api/acs/files/blob")
    def acs_blob(name: str):
        return guard(lambda: passthrough(acs.blob(name), name.replace('"', "")))

    @app.post("/api/acs/tasks", dependencies=mutate)
    def acs_tasks(payload: dict = Body(...)):
        return guard(lambda: {"ok": True, **acs.post_tasks(str(payload.get("id") or ""), payload.get("tasks"))})

    @app.post("/api/acs/tags", dependencies=mutate)
    def acs_tags(payload: dict = Body(...)):
        return guard(lambda: (acs.tags(str(payload.get("id") or ""), payload.get("tags")), {"ok": True})[1])

    @app.post("/api/acs/delete", dependencies=mutate)
    def acs_delete(payload: dict = Body(...)):
        return guard(lambda: (acs.delete(str(payload.get("resource") or ""), str(payload.get("id") or "")), {"ok": True})[1])

    @app.post("/api/acs/put", dependencies=mutate)
    def acs_put(payload: dict = Body(...)):
        return guard(lambda: (acs.put(str(payload.get("resource") or ""), str(payload.get("id") or ""), payload.get("body")),
                              {"ok": True})[1])

    @app.post("/api/acs/password", dependencies=mutate)
    def acs_password(payload: dict = Body(...)):
        return guard(lambda: (acs.password(str(payload.get("user") or ""), payload.get("password")), {"ok": True})[1])

    @app.post("/api/acs/files/upload", dependencies=[Depends(upload_guard)])
    async def acs_upload(request: Request, name: str, fileType: str, oui: str = "", productClass: str = "", version: str = ""):
        data = await request.body()
        meta = {"fileType": fileType, "oui": oui, "productClass": productClass, "version": version}
        return await run_in_threadpool(guard, lambda: (acs.upload(name, data, meta), {"ok": True})[1])

    # ------------------------------------------------------------ Switch
    @app.get("/api/switch/ports")
    def switch_ports():
        def run():
            rows = live(lambda: sw.ports(cfg), lambda: sw.parse_interfaces_status(fx("cisco_interfaces_status_contoh.txt")))
            trunks = {t.lower() for t in cfg.olt_trunks}
            for r in rows:
                r["olt_trunk"] = r["port"].lower() in trunks
            return {"replay": monitor.replay, "ports": rows}
        return guard(run, "cisco")

    @app.get("/api/switch/log")
    def switch_log():
        return guard(lambda: {"lines": live(lambda: sw.logs(cfg), lambda: fx("cisco_logging.txt").splitlines()[-200:])}, "cisco")

    @app.get("/api/switch/config")
    def switch_config():
        def run():
            if monitor.replay:
                raise ManageError(REPLAY_ONLY)
            return {"text": sw.running_config(cfg)}
        return guard(run, "cisco")

    @app.post("/api/switch/action", dependencies=mutate)
    def switch_action(payload: dict = Body(...)):
        def run():
            no_replay()
            return {"ok": True, "message": sw.apply(cfg, str(payload.get("action") or ""), str(payload.get("port") or ""),
                                                    str(payload.get("text") or ""))}
        return guard(run, "cisco")

    # ------------------------------------------------------------ MikroTik
    @app.get("/api/mikrotik/interfaces")
    def mikrotik_interfaces():
        def sample():
            return {"interfaces": mt.parse_interfaces(fx("mikrotik_interface_contoh.txt")),
                    "vlans": mt.parse_vlans(fx("mikrotik_vlan.txt"))}
        return guard(lambda: {"replay": monitor.replay, **live(lambda: mt.interfaces(cfg), sample)}, "mikrotik")

    @app.get("/api/mikrotik/hotspot")
    def mikrotik_hotspot():
        return guard(lambda: {"active": live(lambda: mt.hotspot(cfg),
                                             lambda: mt.parse_hotspot(fx("mikrotik_hotspot_active_contoh.txt")))}, "mikrotik")

    @app.get("/api/mikrotik/log")
    def mikrotik_log():
        return guard(lambda: {"lines": live(lambda: mt.logs(cfg),
                                            lambda: [x for x in fx("mikrotik_log.txt").splitlines() if x.strip()][-200:])}, "mikrotik")

    @app.get("/api/mikrotik/config")
    def mikrotik_config():
        def run():
            if monitor.replay:
                raise ManageError(REPLAY_ONLY)
            return {"text": mt.export(cfg)}
        return guard(run, "mikrotik")

    @app.post("/api/mikrotik/action", dependencies=mutate)
    def mikrotik_action(payload: dict = Body(...)):
        def run():
            no_replay()
            return {"ok": True, "message": mt.apply(cfg, str(payload.get("action") or ""), str(payload.get("name") or ""),
                                                    str(payload.get("value") or ""))}
        return guard(run, "mikrotik")
