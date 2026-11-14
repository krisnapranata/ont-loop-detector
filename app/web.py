"""API JSON dan halaman dashboard."""
from __future__ import annotations

import secrets
import time
from pathlib import Path

from fastapi import Depends, FastAPI, HTTPException, status
from fastapi.responses import FileResponse, JSONResponse
from fastapi.security import HTTPBasic, HTTPBasicCredentials

from . import __version__
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

    @app.get("/api/incidents")
    def incidents():
        return monitor.store.incidents()

    @app.get("/api/device/{device_id}/history")
    def history(device_id: str, hours: float = 24):
        return monitor.store.score_history(device_id, int(time.time() - min(hours, 24 * 14) * 3600))

    @app.post("/api/refresh")
    def refresh():
        monitor.request_refresh()
        return {"ok": True}

    return app
