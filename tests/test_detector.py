import json
from pathlib import Path

from app import replay
from app.collectors.cisco import SwitchData
from app.config import Config
from app.detector import analyze

FX = Path(__file__).parent / "fixtures"
EXPECTED = json.loads((FX / "expected.json").read_text())


def run(**over):
    cfg = Config()
    for k, v in over.items():
        setattr(cfg, k, v)
    onts, sw, rt = replay.load(FX)
    return analyze(cfg, onts, sw, rt), (onts, sw, rt, cfg)


def test_incident_top_suspect_is_the_real_culprit():
    res, _ = run()
    assert res["loop"]["active"]
    assert res["loop"]["blocked_vlans"] == ["vlan200-HOTSPOT"]
    assert res["loop"]["router_mac_flapping"]
    top = res["suspects"][0]
    assert top["id"] == EXPECTED["top"]
    assert top["level"] == "kuat" and top["score"] >= 90
    assert top["trunk"] == "Gi1/0/47"
    codes = {r["code"] for r in top["reasons"]}
    assert {"flap_lan", "hotspot_lan", "cross_trunk", "reboot"} <= codes
    assert res["counts"]["strong"] == 1


def test_other_lan_bridged_onts_are_at_risk_not_strong():
    res, _ = run()
    by_id = {s["id"]: s for s in res["suspects"]}
    for i in EXPECTED["risk"]:
        assert by_id[i]["level"] == "berisiko", by_id[i]
        assert [r["code"] for r in by_id[i]["reasons"]] == ["hotspot_lan"]
    assert res["counts"]["risk"] >= 3


def test_single_roam_event_is_not_flapping():
    res, _ = run()
    # 6 MAC ada di log, satu hanya sekali pindah (roaming biasa), satu lagi MAC router
    assert res["counts"]["flapping_macs"] == 5
    assert all(f["events"] >= 3 for f in res["flapping"])
    kinds = {f["kind"] for f in res["flapping"]}
    assert any(k.startswith("perangkat ZTE") for k in kinds)  # perangkat penyambung tak terdaftar


def test_coverage_is_reported():
    res, _ = run()
    assert res["counts"]["total_onts"] == 322
    assert res["counts"]["no_host_data"] == 142


def test_normal_network_has_no_loop_but_keeps_risk_list():
    onts, sw, rt = replay.load(FX)
    for v in rt.vlans:
        v.lp_status = "on" if v.lp_status == "disabled" else v.lp_status
    res = analyze(Config(), onts, SwitchData(flaps=[], mac_ports=sw.mac_ports), rt)
    assert not res["loop"]["active"]
    assert res["counts"]["strong"] == 0
    assert res["counts"]["risk"] >= 4  # ONT dengan perangkat ter-bridge di port LAN tetap ditandai


def test_works_with_missing_sources():
    onts, sw, rt = replay.load(FX)
    assert analyze(Config(), onts, None, None)["loop"]["active"] is False
    assert analyze(Config(), None, sw, rt)["loop"]["active"] is True
    assert analyze(Config(), None, None, None)["suspects"] == []
