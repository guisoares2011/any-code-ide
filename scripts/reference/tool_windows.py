"""Join a tool window layout with registrations and New UI (expui) icons.

usage: python3 -I tool_windows.py <out.json> <window.layouts.xml> <plugin-scan.json> <ide key> <PlatformIconMappings.json>
The layout comes from the IDE's options/window.layouts.xml (JSON inside CDATA). Each entry gets
its <toolWindow> registration (anchor, icon field, declaring jar) and, for AllIcons.Toolwindows.*
icons, the expui SVG that PlatformIconMappings.json maps to the classic path.
Tool windows registered in code (no <toolWindow> element) keep registration = null.
"""
import json
import sys
import xml.etree.ElementTree as ET


def main():
    out, layouts_xml, scan_json, ide, mappings_json = sys.argv[1:]
    component = ET.parse(layouts_xml).getroot().find("component[@name='ToolWindowLayout']")
    layouts = json.loads(component.text)["layouts"]

    registrations = {}
    for tw in json.load(open(scan_json))[ide]["tool_windows"]:
        registrations.setdefault(tw["id"], tw)

    classic_to_expui = {}
    for expui_name, classic in json.load(open(mappings_json))["expui"]["toolwindows"].items():
        for c in classic if isinstance(classic, list) else [classic]:
            classic_to_expui[c] = "expui/toolwindows/" + expui_name

    def expui_icon(field):
        prefix = "AllIcons.Toolwindows."
        if not field or not field.startswith(prefix):
            return None
        name = field[len(prefix):]
        return classic_to_expui.get("toolwindows/" + name[0].lower() + name[1:] + ".svg")

    result = {}
    for layout_name, layout in layouts.items():
        rows = []
        for entry in layout["v2"]:
            reg = registrations.get(entry["id"])
            rows.append({
                **entry,
                "anchor": entry.get("anchor", "LEFT"),
                "registration": reg and {k: reg[k] for k in ("anchor", "secondary", "icon", "source")},
                "expui_icon": expui_icon(reg and reg["icon"]),
            })
        result[layout_name] = rows
    json.dump({"source": layouts_xml, "layouts": result}, open(out, "w"), indent=1)


if __name__ == "__main__":
    main()
