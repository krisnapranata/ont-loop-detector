from datetime import datetime
from pathlib import Path

from app import replay
from app.collectors import cisco, mikrotik
from app.util import is_random_mac, mac_add, norm_mac, parse_uptime_hours

FX = Path(__file__).parent / "fixtures"


def test_norm_mac():
    assert norm_mac("1402.EC96.357D") == "14:02:ec:96:35:7d"
    assert norm_mac("14-02-EC-96-35-7D") == "14:02:ec:96:35:7d"
    assert norm_mac("00:00:00:00:00:00") == ""
    assert norm_mac("") == "" and norm_mac(None) == ""
    assert mac_add("88:65:9f:43:7a:e0", 1) == "88:65:9f:43:7a:e1"
    assert is_random_mac("d2:37:75:b5:2e:ca") and not is_random_mac("0c:37:47:9a:82:ef")


def test_uptime():
    assert parse_uptime_hours("0d 01:30:00") == 1.5
    assert parse_uptime_hours("2d 20:00:00") == 68
    assert parse_uptime_hours("") is None


def test_cisco_clock_and_flaps():
    now = cisco.parse_clock("22:44:18.837 UTC Tue Feb 19 2002")
    assert now == datetime(2002, 2, 19, 22, 44, 18)
    line = (
        "Feb 19 22:43:13.350: %SW_MATM-4-MACFLAP_NOTIF: Host 1402.ec96.357d in vlan 200 "
        "is flapping between port Te1/0/1 and port Gi1/0/47"
    )
    (ev,) = cisco.parse_flaps(line, now)
    assert (ev.mac, ev.vlan, ev.port_a, ev.port_b) == ("14:02:ec:96:35:7d", 200, "Te1/0/1", "Gi1/0/47")
    assert ev.age_sec == 65
    # baris log lain diabaikan
    assert cisco.parse_flaps("Feb 19 22:43:49.704: %SFF8472-5-THRESHOLD_VIOLATION: Te1/0/1: Rx power low", now) == []


def test_cisco_mac_table():
    t = cisco.parse_mac_table((FX / "cisco_mac_vlan200.txt").read_text())
    assert set(t) == {200}
    assert "ff:ff:ff:ff:ff:ff" not in t[200]  # entri CPU dibuang
    assert set(t[200].values()) <= {"Gi1/0/47", "Gi1/0/48"}


def test_mikrotik_vlans():
    vl = {v.name: v for v in mikrotik.parse_vlans((FX / "mikrotik_vlan.txt").read_text())}
    assert len(vl) == 5
    assert vl["vlan200-HOTSPOT"].blocked and vl["vlan200-HOTSPOT"].vlan_id == 200
    assert not vl["vlan200-HOTSPOT"].running
    assert vl["vlan60-LB-METRO-ISP3"].running and not vl["vlan60-LB-METRO-ISP3"].blocked
    assert vl["vlan40-ISP1"].disabled and vl["vlan40-ISP1"].lp_status == "off"


def test_mikrotik_log_uses_receiving_interface():
    logs = mikrotik.parse_loop_logs((FX / "mikrotik_log.txt").read_text())
    assert len(logs) == 4
    assert {l.iface for l in logs} == {"vlan200-HOTSPOT"}  # bukan nama VLAN di dalam kurung


def test_mikrotik_arp_and_count():
    arp = mikrotik.parse_arp((FX / "mikrotik_arp.txt").read_text())
    assert len(arp) > 300 and all(len(m) == 17 for m in arp.values())
    assert mikrotik.parse_count("0\n") == 0 and mikrotik.parse_count("155\n") == 155


def test_replay_loads_everything():
    onts, sw, rt = replay.load(FX)
    assert len(onts) == 322
    assert sum(1 for o in onts if not o.has_host_data) == 142
    assert sw.flaps and 200 in sw.mac_ports and 100 in sw.mac_ports
    assert rt.hotspot_active == 0
