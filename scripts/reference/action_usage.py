"""Rank the user's local action usage and join it with the action catalog.

usage: python3 -I action_usage.py <out.json> <options/actionSummary.xml> <actions-catalog.mac.json>
actionSummary.xml (ActionsLocalSummary) stores per action id: c = invocation count, l = last use (epoch ms).
Ids that are Java class names are unregistered actions recorded by class; they have no catalog entry.
"""
import json
import sys
import xml.etree.ElementTree as ET


def main():
    out, summary_xml, catalog_json = sys.argv[1:]
    catalog = json.load(open(catalog_json))["actions"]
    rows = []
    for e in ET.parse(summary_xml).getroot().iter("e"):
        i = e.find("i")
        if i is None:
            continue
        aid = e.get("n")
        entry = catalog.get(aid) or {}
        mac = entry.get("mac") or {}
        rows.append({
            "id": aid,
            "count": int(i.get("c", 0)),
            "last_ms": int(i.get("l", 0)),
            "label": entry.get("label"),
            "in_catalog": aid in catalog,
            "mac_keyboard": mac.get("keyboard", []),
            "mac_mouse": mac.get("mouse", []),
        })
    rows.sort(key=lambda r: -r["count"])
    json.dump({
        "source": summary_xml,
        "total_actions": len(rows),
        "total_invocations": sum(r["count"] for r in rows),
        "rows": rows,
    }, open(out, "w"), indent=1, ensure_ascii=False)


if __name__ == "__main__":
    main()
