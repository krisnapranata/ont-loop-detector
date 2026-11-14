"""Notifikasi Telegram dengan jeda anti-spam."""
from __future__ import annotations

import logging
import time

import httpx

from .config import Config

log = logging.getLogger("notifier")


class Notifier:
    def __init__(self, cfg: Config):
        self.cfg = cfg
        self._last: dict[str, float] = {}

    @property
    def enabled(self) -> bool:
        return bool(self.cfg.telegram_bot_token and self.cfg.telegram_chat_id)

    def send(self, text: str, key: str | None = None) -> bool:
        """Kirim pesan. Bila `key` diberikan, pesan dengan key yang sama tidak diulang selama masa jeda."""
        if not self.enabled:
            return False
        now = time.time()
        if key and now - self._last.get(key, 0) < self.cfg.telegram_cooldown_min * 60:
            return False
        try:
            r = httpx.post(
                f"https://api.telegram.org/bot{self.cfg.telegram_bot_token}/sendMessage",
                json={"chat_id": self.cfg.telegram_chat_id, "text": text, "disable_web_page_preview": True},
                timeout=15,
            )
            r.raise_for_status()
        except Exception as e:  # jangan sampai kegagalan Telegram menghentikan pemantauan
            log.warning("gagal kirim Telegram: %s", type(e).__name__)
            return False
        if key:
            self._last[key] = now
        return True


def fmt_suspect(s: dict) -> str:
    who = s["label"] if s["label"] != s["serial"] else "-"
    return (
        f"• {s['serial']} ({s['model']}) skor {s['score']}\n"
        f"  pelanggan: {who} | TR069: {s['tr069_ip'] or '-'} | trunk: {s['trunk'] or '-'}\n"
        + "\n".join(f"  - {r['text']}" for r in s["reasons"])
    )


def msg_loop_start(a: dict) -> str:
    lines = ["🔴 LOOP TERDETEKSI", *("- " + r for r in a["loop"]["reasons"]), ""]
    strong = [s for s in a["suspects"] if s["level"] == "kuat"]
    if strong:
        lines += ["ONT tersangka kuat:", *(fmt_suspect(s) for s in strong[:3])]
    else:
        lines.append("Belum ada ONT tersangka kuat; lihat dashboard untuk ONT berisiko.")
    return "\n".join(lines)


def msg_new_suspect(s: dict) -> str:
    return "🟠 Tersangka kuat baru\n" + fmt_suspect(s)


def msg_loop_end(minutes: float) -> str:
    return f"🟢 Loop sudah hilang (berlangsung ±{minutes:.0f} menit)."
