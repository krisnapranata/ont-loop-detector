"""Tes lapisan kelola perangkat: parser, penyusun perintah, klien API UI GenieACS (transport tiruan), dan rute web."""
import json
from pathlib import Path

import httpx
import pytest
from fastapi.testclient import TestClient

from app.config import Config
from app.manage import ManageError
from app.manage import cisco as sw
from app.manage import acs_expr as ex
from app.manage import genieacs_ui as ui
from app.manage import mikrotik as mt
from app.monitor import Monitor
from app.store import Store
from app.web import create_app

FX = Path(__file__).parent / "fixtures"
rd = lambda n: (FX / n).read_text(encoding="utf-8")


# ---------------------------------------------------------------- GenieACS (API UI)

UI_DOC = {
    "DeviceID.ID": {"value": ["ONT-1", "xsd:string"], "object": False, "writable": False},
    "VirtualParameters.IPTR069": {"value": ["172.16.0.9", "xsd:string"], "object": False, "writable": False},
    "InternetGatewayDevice.WANDevice.1.WANConnectionDevice.1.WANPPPConnection.1.Name": {"value": ["1_INTERNET_R_VID_10", "xsd:string"]},
    "InternetGatewayDevice.WANDevice.1.WANConnectionDevice.2.WANIPConnection.1.Name": {"value": ["2_MGMT", "xsd:string"]},
    "InternetGatewayDevice.WANDevice.1.WANConnectionDevice.2.WANIPConnection.1.X_HW_SERVICELIST": {"value": ["TR069", "xsd:string"]},
    "InternetGatewayDevice.WANDevice.1.WANConnectionDevice.3.WANIPConnection.1.ExternalIPAddress": {"value": ["172.16.0.9", "xsd:string"]},
}


def test_expression_parser_handles_genieacs_filters():
    assert ex.parse('Events.Inform > NOW() - 220 * 1000') == [">", ["PARAM", "Events.Inform"], ["-", ["FUNC", "NOW"], ["*", 220, 1000]]]
    assert ex.parse("InternetGatewayDevice.X_CT-COM_UserInfo.ServiceName IS NOT NULL")[1] == ["PARAM", "InternetGatewayDevice.X_CT-COM_UserInfo.ServiceName"]
    assert ex.parse("'string'") == "string" and ex.parse("false") is False
    e = ex.parse('A = "x" OR NOT B IS NULL')
    assert ex.evaluate(e, {"A": "x"}.get) is True and ex.evaluate(e, {"B": 1}.get) is True and ex.evaluate(e, {}.get) is None  # null = "x" -> tidak diketahui
    assert ex.evaluate(ex.parse('A LIKE "%b_"'), {"A": "abc"}.get) is True
    assert ex.evaluate(ex.parse('"http://"||ENCODEURICOMPONENT(A)'), {"A": "1 2"}.get) == "http://1%202"
    with pytest.raises(ex.ExprError):
        ex.parse("A = ")


def test_clean_tasks_keeps_known_shapes_only():
    t = ui.clean_tasks([{"name": "getParameterValues", "parameterNames": ["VirtualParameters.RXPower", "InternetGatewayDevice.LANDevice.*.Hosts.Host"], "device": "x"},
                        {"name": "setParameterValues", "parameterValues": [["A.B", True, "xsd:boolean"]], "_id": "zz"},
                        {"name": "addObject", "objectName": "A.B.WANPPPConnection"},
                        {"name": "deleteObject", "objectName": "A.B.WANPPPConnection.2"},
                        {"name": "refreshObject", "objectName": ""}, {"name": "reboot", "extra": 1}])
    assert t[0] == {"name": "getParameterValues", "parameterNames": ["VirtualParameters.RXPower", "InternetGatewayDevice.LANDevice.*.Hosts.Host"]}
    assert t[1] == {"name": "setParameterValues", "parameterValues": [["A.B", True, "xsd:boolean"]]}
    assert t[5] == {"name": "reboot"}


@pytest.mark.parametrize("bad", [
    [], [{"name": "setParameterValues", "parameterValues": [["A B", 1]]}], [{"name": "deleteObject", "objectName": "A.B.WANPPPConnection"}],
    [{"name": "runScript"}], [{"name": "download", "fileType": "9 Apa", "fileName": "x"}],
    [{"name": "setParameterValues", "parameterValues": [["A.B", {"x": 1}]]}], [{"name": "reboot"}] * 101,
])
def test_clean_tasks_rejects(bad):
    with pytest.raises(ManageError):
        ui.clean_tasks(bad)


def test_holds_mgmt_by_name_servicelist_or_tr069_ip():
    w = "InternetGatewayDevice.WANDevice.1.WANConnectionDevice"
    assert not ui.holds_mgmt(UI_DOC, w + ".1.WANPPPConnection.1")
    assert ui.holds_mgmt(UI_DOC, w + ".2.WANIPConnection.1") and ui.holds_mgmt(UI_DOC, w + ".2")
    assert ui.holds_mgmt(UI_DOC, w + ".3.WANIPConnection.1")


def test_extract_client_config():
    html = '<script>\n window.clientConfig = {"ui":{"pageSize":10}};\n</script>'
    assert ui.extract_client_config(html) == {"ui": {"pageSize": 10}}
    with pytest.raises(ManageError):
        ui.extract_client_config("<html>NBI</html>")


def _ui_client(handler):
    c = Config()
    c.genieacs_ui_url, c.genieacs_ui_user, c.genieacs_ui_password = "http://acs.contoh:3000", "admin", "rahasia"
    return ui.UiClient(c, transport=httpx.MockTransport(handler))


def test_ui_client_logs_in_relogs_on_401_and_posts_tasks():
    seen, state = [], {"logins": 0}

    def handler(req: httpx.Request):
        seen.append(req)
        if req.url.path == "/login":
            state["logins"] += 1
            assert json.loads(req.content) == {"username": "admin", "password": "rahasia"}
            return httpx.Response(200, json=f"tok{state['logins']}")
        if req.headers.get("cookie") == "genieacs-ui-jwt=tok1":
            return httpx.Response(401)  # token pertama dianggap kedaluwarsa
        if req.method == "HEAD":
            return httpx.Response(200, headers={"X-Total-Count": "7"})
        if req.url.path.endswith("/tasks"):
            return httpx.Response(200, json=[{"_id": "t1", "status": "done"}], headers={"Connection-Request": "OK"})
        return httpx.Response(200, json=[UI_DOC])

    c = _ui_client(handler)
    assert c.count("devices", "true") == 7 and state["logins"] == 2
    r = c.post_tasks("ONT-1", [{"name": "reboot"}])
    assert r == {"tasks": [{"_id": "t1", "status": "done"}], "connectionRequest": "OK"}
    assert [x.url.path for x in seen if x.method == "POST"][-1] == "/api/devices/ONT-1/tasks"
    with pytest.raises(ManageError, match="TR069"):
        c.post_tasks("ONT-1", [{"name": "deleteObject", "objectName": "InternetGatewayDevice.WANDevice.1.WANConnectionDevice.2.WANIPConnection.1"}])


def test_ui_client_guards_resources_and_bad_login():
    c = _ui_client(lambda req: httpx.Response(400, text="Incorrect username or password"))
    with pytest.raises(ManageError, match="Login"):
        c.count("devices", "true")
    with pytest.raises(ManageError):
        c.put("devices", "x", {})
    with pytest.raises(ManageError):
        c.delete("tasks", "x")
    with pytest.raises(ManageError):
        c.delete("users", "admin")  # akun yang dipakai aplikasi sendiri
    with pytest.raises(ManageError):
        c.put("config", "ui.pageSize", {"value": "1000 +"})


def test_replay_filters_and_counts():
    r = ui.ReplayUi(FX)
    assert r.count("devices", "true") == len(json.loads(rd("genieacs_devices.json")))
    hit = r.list("devices", {"filter": 'DeviceID.SerialNumber = "FHTTA20F75C3"', "projection": "DeviceID.ID,Tags"})
    assert len(hit) == 1 and set(hit[0]) == {"DeviceID.ID"}
    assert r.client_config()["ui"]["device"] and r.list("faults", {"filter": "true"})


# ---------------------------------------------------------------- Switch


def test_parse_interfaces_status():
    ports = {p["port"]: p for p in sw.parse_interfaces_status(rd("cisco_interfaces_status_contoh.txt"))}
    assert len(ports) == 9
    assert ports["Gi1/0/3"] == {"port": "Gi1/0/3", "name": "", "status": "notconnect", "vlan": "1", "duplex": "auto",
                                "speed": "auto", "type": "10/100/1000BaseTX"}
    assert ports["Gi1/0/47"]["name"] == "OLT-1" and ports["Gi1/0/47"]["vlan"] == "trunk"
    assert ports["Te1/0/1"]["type"] == "Not Present" and ports["Po1"]["type"] == ""


def test_mask_config_hides_secrets_only():
    out = sw.mask_config("enable secret 5 $1$abc\nservice password-encryption\nsnmp-server community publik RO\n"
                         " password 7 0822455D\ninterface Gi1/0/1\n description ke-router")
    assert "$1$abc" not in out and "publik" not in out and "0822455D" not in out
    assert "service password-encryption" in out and "description ke-router" in out


def test_build_config_only_known_ports_and_safe_text():
    known = {"Gi1/0/5", "Gi1/0/47"}
    assert sw.build_config("shutdown", "Gi1/0/5", "", known) == ["interface Gi1/0/5", "shutdown"]
    assert sw.build_config("description", "Gi1/0/5", " AP kantor ", known) == ["interface Gi1/0/5", "description AP kantor"]
    assert sw.build_config("description", "Gi1/0/5", "", known) == ["interface Gi1/0/5", "no description"]
    for args in (("shutdown", "Gi1/0/9", ""), ("shutdown", "Gi1/0/5\nno vlan 200", ""), ("description", "Gi1/0/5", "a\nshutdown"),
                 ("description", "Gi1/0/5", "apa?"), ("description", "Gi1/0/5", "lantai#2"), ("reload", "Gi1/0/5", "")):
        with pytest.raises(ManageError):
            sw.build_config(*args, known)


# ---------------------------------------------------------------- MikroTik


def test_parse_mikrotik_lists():
    ifs = {i["name"]: i for i in mt.parse_interfaces(rd("mikrotik_interface_contoh.txt"))}
    assert ifs["ether14-CADANGAN"]["disabled"] and not ifs["ether14-CADANGAN"]["running"]
    assert ifs["pppoe-contoh 01"]["dynamic"] and ifs["vlan100-MNG-TR069"]["type"] == "vlan"
    vl = {v["name"]: v for v in mt.parse_vlans(rd("mikrotik_vlan.txt"))}
    assert vl["vlan30-ISP4"]["interface"] == "ether11-INTERNET" and vl["vlan30-ISP4"]["loop_protect"] == "on"
    hs = mt.parse_hotspot(rd("mikrotik_hotspot_active_contoh.txt"))
    assert [h["user"] for h in hs] == ["voucher-a1b2", "voucher-c3d4"] and hs[0]["address"] == "10.8.0.21"


def test_build_command_only_known_names():
    ifs, vl = {"ether14-CADANGAN", "vlan200-HOTSPOT", "pppoe-contoh 01"}, {"vlan200-HOTSPOT"}
    assert mt.build_command("disable", "ether14-CADANGAN", "", ifs, vl) == '/interface set [find name="ether14-CADANGAN"] disabled=yes'
    assert mt.build_command("loop_protect", "vlan200-HOTSPOT", "on", ifs, vl) == '/interface vlan set [find name="vlan200-HOTSPOT"] loop-protect=on'
    for args in (("disable", "ether99", ""), ("disable", "pppoe-contoh 01", ""), ("loop_protect", "ether14-CADANGAN", "on"),
                 ("loop_protect", "vlan200-HOTSPOT", "on; /system reset-configuration"), ("disable", 'x"] ; /user remove [find', ""),
                 ("reboot", "ether14-CADANGAN", "")):
        with pytest.raises(ManageError):
            mt.build_command(*args, ifs, vl)


# ---------------------------------------------------------------- rute web (mode replay)


@pytest.fixture
def client():
    c = Config()
    mon = Monitor(c, Store(":memory:"), replay=True)
    mon.replay_dir = str(FX)
    t = TestClient(create_app(c, mon, "pw"))
    t.auth = (c.web_user, "pw")
    return t


def test_pages_and_lists_work_in_replay(client):
    for page in ("genieacs", "switch", "mikrotik"):
        assert client.get("/" + page).status_code == 200
    conf = client.get("/api/acs/config").json()
    assert conf["replay"] and conf["ui"]["index"]
    assert client.get("/api/acs/devices/count", params={"filter": 'DeviceID.SerialNumber LIKE "%A20F75C3"'}).json() == {"total": 1}
    doc = client.get("/api/acs/device", params={"id": "000AC2-HG6145D2-FHTTA20F75C3"}).json()
    assert doc["DeviceID.SerialNumber"]["value"][0] == "FHTTA20F75C3"
    assert client.get("/api/acs/presets/list").json()
    assert client.get("/api/acs/secrets/list").status_code == 400
    ports = client.get("/api/switch/ports").json()["ports"]
    assert [p["port"] for p in ports if p["olt_trunk"]] == ["Gi1/0/47", "Gi1/0/48"]
    assert client.get("/api/mikrotik/interfaces").json()["vlans"]
    assert client.get("/api/switch/config").status_code == 400


def test_writes_need_json_and_are_refused_in_replay(client):
    assert client.post("/api/switch/action", data={"action": "shutdown", "port": "Gi1/0/47"}).status_code == 415
    assert client.post("/api/acs/tasks", data={"id": "x"}).status_code == 415
    assert client.post("/api/acs/files/upload", params={"name": "a", "fileType": "1 Firmware Upgrade Image"}, content=b"x").status_code == 415
    dev = "000AC2-HG6145D2-FHTTA20F75C3"
    for path, body in (("switch/action", {"action": "shutdown", "port": "Gi1/0/47"}),
                       ("mikrotik/action", {"action": "disable", "name": "vlan200-HOTSPOT"}),
                       ("acs/tasks", {"id": dev, "tasks": [{"name": "getParameterValues", "parameterNames": ["VirtualParameters.RXPower"]}]}),
                       ("acs/tasks", {"id": dev, "tasks": [{"name": "reboot"}]}),
                       ("acs/delete", {"resource": "presets", "id": "inform"}),
                       ("acs/put", {"resource": "provisions", "id": "x", "body": {"script": ""}})):
        r = client.post(f"/api/{path}", json=body)
        assert r.status_code == 400 and "replay" in r.json()["message"].lower(), path
    r = client.post("/api/acs/tasks", json={"id": dev, "tasks": [{"name": "deleteObject",
                    "objectName": "InternetGatewayDevice.WANDevice.1.WANConnectionDevice.2.WANIPConnection.1"}]})
    assert r.status_code == 400 and "TR069" in r.json()["message"]
    assert client.get("/api/acs/config", auth=("admin", "salah")).status_code == 401
