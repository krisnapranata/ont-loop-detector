import json
import os
import stat

import pytest
from fastapi.testclient import TestClient

from app import settings
from app.config import Config, load
from app.monitor import Monitor
from app.store import Store
from app.web import create_app


def cfg_at(tmp_path):
    c = Config()
    c.settings_path = str(tmp_path / "settings.json")
    c.genieacs_url = ""
    return c


FULL = {
    "genieacs": {"host": "192.168.100.253", "port": 7557, "user": "", "password": ""},
    "cisco": {"host": "192.168.70.254", "port": 23, "transport": "telnet", "user": "pemantau",
              "password": "rahasia-sw", "enable_password": "rahasia-en"},
    "mikrotik": {"host": "192.168.100.20", "port": 22, "user": "pemantau", "password": "rahasia-mt"},
    "olts": [{"name": "OLT 1", "host": "192.168.203.2", "port": 23, "transport": "telnet", "user": "admin",
              "password": "rahasia-olt", "enable_password": ""}],
    "network": {"hotspot_subnets": "10.8.0.0/20, 10.9.0.0/24", "hotspot_vlan": 200, "tr069_vlan": 100,
                "tr069_interface": "vlan100-MNG-TR069", "olt_trunks": "Gi1/0/47, Gi1/0/48"},
    "telegram": {"bot_token": "", "chat_id": "-100123"},
}


def test_save_applies_persists_and_hides_secrets(tmp_path):
    c = cfg_at(tmp_path)
    settings.save(c, FULL)
    assert c.genieacs_url == "http://192.168.100.253:7557"
    assert c.cisco_password == "rahasia-sw" and c.hotspot_subnets == ["10.8.0.0/20", "10.9.0.0/24"]
    assert c.olts[0]["password"] == "rahasia-olt" and c.olts[0]["id"]
    assert stat.S_IMODE(os.stat(c.settings_path).st_mode) == 0o600
    view = json.dumps(settings.public_view(c))
    assert "rahasia" not in view
    assert settings.public_view(c)["cisco"]["password_set"] is True
    # dibaca kembali saat aplikasi start
    c2 = cfg_at(tmp_path)
    settings.overlay(c2)
    assert c2.mikrotik_password == "rahasia-mt" and c2.olts == c.olts


def test_blank_password_keeps_old_value(tmp_path):
    c = cfg_at(tmp_path)
    settings.save(c, FULL)
    oid = c.olts[0]["id"]
    settings.save(c, {
        "cisco": {**FULL["cisco"], "password": "", "enable_password": "baru"},
        "olts": [{**FULL["olts"][0], "id": oid, "password": "", "name": "OLT Bale"}],
    })
    assert c.cisco_password == "rahasia-sw" and c.cisco_enable_password == "baru"
    assert c.olts[0]["password"] == "rahasia-olt" and c.olts[0]["name"] == "OLT Bale" and c.olts[0]["id"] == oid
    assert c.mikrotik_host == "192.168.100.20"  # bagian yang tidak dikirim tidak berubah


@pytest.mark.parametrize("section,field,value", [
    ("cisco", "port", 70000),
    ("cisco", "host", "sw itch; reload"),
    ("cisco", "transport", "rsh"),
    ("network", "tr069_interface", 'vlan100" ; /system reset-configuration'),
    ("network", "hotspot_subnets", "sepuluh"),
    ("network", "hotspot_vlan", 5000),
    ("network", "olt_trunks", "Gi1/0/47 | include x"),
    ("telegram", "chat_id", "bukan id"),
])
def test_invalid_values_are_rejected_and_nothing_changes(tmp_path, section, field, value):
    c = cfg_at(tmp_path)
    settings.save(c, FULL)
    before = {k: getattr(c, k) for k in settings.SAVED_KEYS}
    with pytest.raises(settings.SettingsError) as e:
        settings.save(c, {section: {**FULL[section], field: value}})
    assert f"{section}.{field}" in e.value.errors
    assert before == {k: getattr(c, k) for k in settings.SAVED_KEYS}


def test_env_file_then_settings_file_precedence(tmp_path, monkeypatch):
    env = tmp_path / ".env"
    sp = tmp_path / "s.json"
    env.write_text(f"CISCO_HOST=10.0.0.1\nMIKROTIK_HOST=10.0.0.2\nSETTINGS_PATH={sp}\n")
    sp.write_text(json.dumps({"cisco_host": "10.9.9.9"}))
    for k in ("CISCO_HOST", "MIKROTIK_HOST", "SETTINGS_PATH"):
        monkeypatch.delenv(k, raising=False)
    c = load(env)
    assert c.cisco_host == "10.9.9.9" and c.mikrotik_host == "10.0.0.2"


def client(tmp_path):
    c = cfg_at(tmp_path)
    mon = Monitor(c, Store(":memory:"))
    return TestClient(create_app(c, mon, "pw")), c, mon


def test_api_requires_login_and_json(tmp_path):
    cl, c, _ = client(tmp_path)
    assert cl.get("/api/settings").status_code == 401
    assert cl.get("/pengaturan").status_code == 401
    auth = ("admin", "pw")
    assert cl.get("/pengaturan", auth=auth).status_code == 200
    # form biasa (bukan JSON) ditolak
    r = cl.put("/api/settings", auth=auth, content="cisco=x", headers={"content-type": "text/plain"})
    assert r.status_code == 415 and c.cisco_host == ""


def test_api_save_roundtrip_and_reconfigure(tmp_path):
    cl, c, mon = client(tmp_path)
    auth = ("admin", "pw")
    assert mon.switch.enabled is False
    r = cl.put("/api/settings", auth=auth, json=FULL)
    assert r.status_code == 200 and r.json() == {"ok": True}
    assert mon.switch.enabled and mon.router.enabled and mon.acs.enabled
    got = cl.get("/api/settings", auth=auth)
    assert "rahasia" not in got.text
    assert got.json()["genieacs"] == {"host": "192.168.100.253", "port": 7557, "user": "", "password": "", "password_set": False,
                                      "ui_url": "", "ui_user": "", "ui_password": "", "ui_password_set": False}
    bad = cl.put("/api/settings", auth=auth, json={"mikrotik": {"host": "x", "port": 0}})
    assert bad.status_code == 422 and "mikrotik.port" in bad.json()["errors"]


def test_connection_test_reports_failure_without_saving(tmp_path):
    cl, c, _ = client(tmp_path)
    r = cl.post("/api/settings/test", auth=("admin", "pw"),
                json={"kind": "genieacs", "settings": {"genieacs": {"host": "127.0.0.1", "port": 9, "user": "", "password": ""}}})
    assert r.status_code == 200 and r.json()["ok"] is False
    assert r.json()["message"].startswith("Koneksi ditolak")
    assert c.genieacs_url == ""  # tes tidak menyimpan
    r = cl.post("/api/settings/test", auth=("admin", "pw"), json={"kind": "cisco", "settings": {}})
    assert r.json() == {"ok": False, "message": "Host switch belum diisi."}


def test_genieacs_ui_account_saved_validated_and_hidden(tmp_path):
    c = cfg_at(tmp_path)
    ui = {**FULL["genieacs"], "ui_url": "http://10.0.0.5:3000/", "ui_user": "admin", "ui_password": "rahasia-ui"}
    settings.save(c, {"genieacs": ui})
    assert (c.genieacs_ui_url, c.genieacs_ui_user, c.genieacs_ui_password) == ("http://10.0.0.5:3000", "admin", "rahasia-ui")
    assert "rahasia-ui" not in json.dumps(settings.public_view(c))
    settings.save(c, {"genieacs": {**ui, "ui_password": ""}})
    assert c.genieacs_ui_password == "rahasia-ui"  # dikosongkan = tidak diubah
    for bad in ("javascript:alert(1)", "http://10.0.0.5:3000/api/x", "ftp://a"):
        with pytest.raises(settings.SettingsError):
            settings.merged(c, {"genieacs": {**ui, "ui_url": bad}})


def test_acs_locations_saved_with_stable_ids_and_validated(tmp_path):
    c = cfg_at(tmp_path)
    items = [{"name": "Kampung Wifi", "subnets": "172.16.0.0/20"},
             {"name": "Trigara.Net", "subnets": ["172.16.16.5/20", " "]}]
    settings.save(c, {"locations": {"param": "VirtualParameters.IPTR069", "items": items}})
    assert [x["subnets"] for x in c.acs_locations] == [["172.16.0.0/20"], ["172.16.16.0/20"]]
    first = c.acs_locations[0]["id"]
    settings.save(c, {"locations": {"items": [{**c.acs_locations[0], "name": "Kampung WiFi"}]}})
    assert c.acs_locations[0]["id"] == first and c.acs_locations[0]["name"] == "Kampung WiFi"
    assert settings.public_view(c)["locations"]["items"][0]["subnets"] == ["172.16.0.0/20"]
    for bad in ({"items": [{"name": "", "subnets": "10.0.0.0/8"}]}, {"items": [{"name": "A", "subnets": "bukan-ip"}]},
                {"items": [{"name": "A", "subnets": "10.0.0.0/4"}]}, {"items": [{"name": "A", "subnets": ""}]},
                {"items": [{"name": "A", "subnets": "10.0.0.0/8"}, {"name": "a", "subnets": "11.0.0.0/8"}]},
                {"param": "x; drop", "items": []}):
        with pytest.raises(settings.SettingsError):
            settings.merged(c, {"locations": bad})
