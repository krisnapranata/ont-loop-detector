"""API JSON dan halaman dashboard."""
from __future__ import annotations

import secrets
import time
from pathlib import Path

from fastapi import Body, Depends, FastAPI, HTTPException, Request, status
from fastapi.responses import FileResponse, JSONResponse
from fastapi.security import HTTPBasic, HTTPBasicCredentials

from . import __version__, settings, web_manage
from .config import Config
from .monitor import Monitor

STATIC = Path(__file__).parent / "static"
_basic = HTTPBasic(realm="ONT Loop Detector")


def create_app(cfg: Config, monitor: Monitor, password: str) -> FastAPI:
    def auth(cred: HTTPBasicCredentials = Depends(_basic)) -> None:
        ok = secrets.compare_digest(cred.username.encode(), cfg.web_user.encode()) and secrets.compare_digest(
            cred.password.encode(), password.encode()
        )
        if not ok:
            raise HTTPException(
                status.HTTP_401_UNAUTHORIZED, "Login salah", {"WWW-Authenticate": 'Basic realm="ONT Loop Detector"'}
            )

    app = FastAPI(title="ONT Loop Detector", version=__version__, docs_url=None, redoc_url=None,
                  openapi_url=None, dependencies=[Depends(auth)])

    @app.get("/")
    def index():
        return FileResponse(STATIC / "index.html", headers={"Cache-Control": "no-cache"})

    @app.get("/static/{path:path}")
    def static(path: str):
        f = (STATIC / path).resolve()
        if not f.is_file() or STATIC.resolve() not in f.parents:
            raise HTTPException(404)
        return FileResponse(f, headers={"Cache-Control": "no-cache"})

    @app.get("/api/state")
    def state():
        s = monitor.snapshot()
        if not s:
            return JSONResponse({"ready": False}, status_code=200)
        s["ready"] = True
        s["version"] = __version__
        s["interval"] = cfg.fast_interval_sec
        s["thresholds"] = {"strong": cfg.score_strong, "risk": cfg.score_risk}
        return s

    @app.get("/api/series")
    def series(hours: float = 6):
        hours = min(max(hours, 0.25), 24 * 14)
        return monitor.store.series(int(time.time() - hours * 3600))

    @app.get("/api/moves")
    def moves(start: int, end: int):
        """MAC yang pindah port pada rentang waktu tertentu (untuk titik di chart)."""
        end = min(end, int(time.time()) + 60)
        start = max(start, end - 14 * 86400)
        return monitor.store.moves(start, end)

    @app.get("/api/incidents")
    def incidents():
        return monitor.store.incidents()

    @app.get("/api/device/{device_id}/history")
    def history(device_id: str, hours: float = 24):
        return monitor.store.score_history(device_id, int(time.time() - min(hours, 24 * 14) * 3600))

    @app.get("/pengaturan")
    def settings_page():
        return FileResponse(STATIC / "settings.html", headers={"Cache-Control": "no-cache"})

    def _json_only(request: Request) -> None:
        # mencegah form dari situs lain mengubah pengaturan memakai login browser yang tersimpan
        if "application/json" not in request.headers.get("content-type", ""):
            raise HTTPException(415, "Content-Type harus application/json")

    @app.get("/api/settings")
    def settings_get():
        v = settings.public_view(cfg)
        v["replay"] = monitor.replay
        return JSONResponse(v, headers={"Cache-Control": "no-store"})

    @app.put("/api/settings", dependencies=[Depends(_json_only)])
    def settings_put(payload: dict = Body(...)):
        try:
            settings.save(cfg, payload)
        except settings.SettingsError as e:
            return JSONResponse({"ok": False, "errors": e.errors}, status_code=422)
        monitor.reconfigure()
        return {"ok": True}

    @app.post("/api/settings/test", dependencies=[Depends(_json_only)])
    def settings_test(payload: dict = Body(...)):
        """Tes koneksi memakai isi form saat ini (belum tentu sudah disimpan)."""
        try:
            trial = settings.merged(cfg, payload.get("settings") or {})
        except settings.SettingsError as e:
            return JSONResponse({"ok": False, "errors": e.errors, "message": "Perbaiki isian yang ditandai dulu."}, status_code=422)
        return settings.test(trial, str(payload.get("kind") or ""), str(payload.get("olt_id") or ""))

    @app.post("/api/refresh")
    def refresh():
        monitor.request_refresh()
        return {"ok": True}

    web_manage.register(app, cfg, monitor, _json_only)

    return app
