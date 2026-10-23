"""Scan IDE jars for plugin-declared data the keymap XMLs do not carry.

usage: python3 -I plugin_scan.py <out.json> <ide.app> [<ide.app> ...]
Per IDE it records:
  shortcuts     <keyboard-shortcut>/<mouse-shortcut keymap=...> inside <action>, and use-shortcut-of
  tool_windows  <toolWindow> registrations (id, anchor, secondary, icon, factory, declaring jar)
  texts         action.<id>.text / .description, group.<id>.text and toolwindow.stripe.<id>
                from every messages/*.properties, plus text= attributes on <action>/<group>
Only XML under META-INF/ or at a jar root, or with "action" in its path, is parsed.
Language packs (plugins/localization-*) are skipped so texts stay in English.
"""
import json
import os
import re
import sys
import xml.etree.ElementTree as ET
import zipfile

KEYMAPS = {"$default", "Mac OS X 10.5+", "Mac OS X"}
TEXT_KEY = re.compile(r"^(action|group)\.(.+)\.(text|description)$|^toolwindow\.stripe\.(.+)$")


def unescape(text):
    return re.sub(r"\\u([0-9a-fA-F]{4})", lambda m: chr(int(m.group(1), 16)), text)


def read_properties(data):
    props, key, buf = {}, None, ""
    for line in data.decode("utf-8", "replace").splitlines():
        if key is None:
            s = line.lstrip()
            if not s or s[0] in "#!" or "=" not in s:
                continue
            key, _, buf = s.partition("=")
            key = key.strip()
        else:
            buf += line.lstrip()
        if buf.endswith("\\") and not buf.endswith("\\\\"):
            buf = buf[:-1]
            continue
        props[key] = unescape(buf.strip().replace("\\n", "\n").replace("\\:", ":").replace("\\=", "="))
        key, buf = None, ""
    return props


def scan_xml(data, where, result):
    if not any(t in data for t in (b"keyboard-shortcut", b"mouse-shortcut", b"use-shortcut-of", b"<toolWindow", b"<action", b"<group")):
        return
    try:
        root = ET.fromstring(data)
    except ET.ParseError:
        return
    for el in root.iter():
        if el.tag in ("action", "group") and el.get("id") and el.get("text"):
            result["texts"].setdefault(f"{el.tag}.{el.get('id')}.text", {"value": el.get("text"), "source": where})
            if el.get("description"):
                result["texts"].setdefault(f"{el.tag}.{el.get('id')}.description", {"value": el.get("description"), "source": where})
        if el.tag == "toolWindow" and el.get("id"):
            result["tool_windows"].append({
                "id": el.get("id"),
                "anchor": el.get("anchor"),
                "secondary": el.get("secondary"),
                "side_tool": el.get("side"),
                "icon": el.get("icon"),
                "factory": el.get("factoryClass"),
                "can_close_contents": el.get("canCloseContents"),
                "do_not_activate_on_start": el.get("doNotActivateOnStart"),
                "source": where,
            })
    for action in root.iter("action"):
        aid = action.get("id")
        for k in action.iter("keyboard-shortcut"):
            if k.get("keymap") in KEYMAPS:
                result["shortcuts"].append({
                    "id": aid, "type": "keyboard", "keymap": k.get("keymap"),
                    "first": k.get("first-keystroke"), "second": k.get("second-keystroke"),
                    "remove": k.get("remove") == "true", "replace_all": k.get("replace-all") == "true",
                    "source": where,
                })
        for m in action.iter("mouse-shortcut"):
            if m.get("keymap") in KEYMAPS:
                result["shortcuts"].append({
                    "id": aid, "type": "mouse", "keymap": m.get("keymap"), "keystroke": m.get("keystroke"),
                    "remove": m.get("remove") == "true", "replace_all": m.get("replace-all") == "true",
                    "source": where,
                })
        if action.get("use-shortcut-of"):
            result["shortcuts"].append({"id": aid, "use_shortcut_of": action.get("use-shortcut-of"), "source": where})


def scan_app(app):
    result = {"shortcuts": [], "tool_windows": [], "texts": {}}
    contents = os.path.join(app, "Contents")
    for base, _, files in os.walk(contents):
        if "/jbr/" in base + "/":
            continue
        for f in sorted(files):
            if not f.endswith(".jar") or "/plugins/localization-" in base:
                continue
            path = os.path.join(base, f)
            jar = os.path.relpath(path, contents)
            try:
                z = zipfile.ZipFile(path)
            except (zipfile.BadZipFile, OSError):
                continue
            with z:
                for name in z.namelist():
                    where = f"{jar}!{name}"
                    if name.endswith(".xml") and (name.startswith("META-INF/") or "/" not in name or re.search(r"(?i)action", name)):
                        scan_xml(z.read(name), where, result)
                    elif name.startswith("messages/") and name.endswith(".properties") and "_" not in os.path.basename(name):
                        for k, v in read_properties(z.read(name)).items():
                            if TEXT_KEY.match(k):
                                result["texts"].setdefault(k, {"value": v, "source": where})
    return result


def main():
    out_path, *apps = sys.argv[1:]
    result = {os.path.basename(a): scan_app(a) for a in apps}
    json.dump(result, open(out_path, "w"), indent=1, ensure_ascii=False)
    for k, v in result.items():
        kinds = {}
        for r in v["shortcuts"]:
            kinds[r.get("type", "binding")] = kinds.get(r.get("type", "binding"), 0) + 1
        print(k, kinds, "tool_windows", len(v["tool_windows"]), "texts", len(v["texts"]))


if __name__ == "__main__":
    main()
