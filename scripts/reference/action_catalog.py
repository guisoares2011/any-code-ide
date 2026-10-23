"""Build an action catalog: id -> text/description, declaring XML, effective macOS bindings.

usage: python3 -I action_catalog.py [--plugins <plugin-scan.json> <ide key>] <out.json> <ActionsBundle.properties> <keymaps_dir> <actions_xml>...
Plugin <keyboard-shortcut keymap=...> entries are applied after the XML keymaps like
KeymapImpl.doInitShortcuts: add appends to own shortcuts (seeded from bound or converted parent
shortcuts), remove drops one, replace-all drops all then adds. Texts missing from
ActionsBundle fall back to plugin bundles/attributes; Activate<X>ToolWindow actions fall back to
the tool window stripe title (ActivateToolWindowAction shows the stripe title).
Effective keymap mirrors KeymapImpl.getShortcutList + MacOSDefaultKeymap (intellij-community,
Apache-2.0): "Mac OS X 10.5+" own[id] -> own[use-shortcut-of(id)] -> "$default" resolution with
control<->meta swapped. An own <action> entry (even empty) replaces the parent's shortcuts.
Keystrokes containing INSERT are skipped for bundled keymaps on macOS.
"""
import json
import os
import re
import sys
import xml.etree.ElementTree as ET


def read_properties(path):
    props, key, buf = {}, None, ""
    with open(path, encoding="utf-8") as f:
        for raw in f:
            line = raw.rstrip("\n")
            if key is None:
                s = line.lstrip()
                if not s or s[0] in "#!":
                    continue
                if "=" not in s:
                    continue
                key, _, buf = s.partition("=")
                key = key.strip()
            else:
                buf += line.lstrip()
            if buf.endswith("\\") and not buf.endswith("\\\\"):
                buf = buf[:-1]
                continue
            props[key] = buf.strip().replace("\\n", "\n").replace("\\:", ":").replace("\\=", "=")
            key, buf = None, ""
    return props


def read_keymap(path):
    root = ET.parse(path).getroot()
    actions = {}
    for a in root.iter("action"):
        actions[a.get("id")] = {
            "keyboard": [
                [k.get("first-keystroke")] + ([k.get("second-keystroke")] if k.get("second-keystroke") else [])
                for k in a.iter("keyboard-shortcut")
                if "INSERT" not in k.get("first-keystroke")
            ],
            "mouse": [m.get("keystroke") for m in a.iter("mouse-shortcut")],
            "gesture": [{"keystroke": g.get("keystroke"), "modifier": g.get("modifier")} for g in a.iter("keyboard-gesture-shortcut")],
        }
    return root.get("name"), root.get("parent"), actions


SWAP = {"control": "meta", "ctrl": "meta", "meta": "control"}


def swap_mods(stroke):
    return " ".join(SWAP.get(t, t) for t in stroke.split(" "))


def convert_from_parent(sc):
    return {
        "keyboard": [[swap_mods(x) for x in k] for k in sc["keyboard"]],
        "mouse": [swap_mods(m) for m in sc["mouse"]],
        "gesture": [dict(g, keystroke=swap_mods(g["keystroke"])) for g in sc["gesture"]],
    }


def unescape(text):
    if text is None:
        return None
    return re.sub(r"\\u([0-9a-fA-F]{4})", lambda m: chr(int(m.group(1), 16)), text)


def main():
    args = sys.argv[1:]
    plugin_ops, plugin_texts = [], {}
    if args[0] == "--plugins":
        scan = json.load(open(args[1]))[args[2]]
        plugin_ops = [r for r in scan["shortcuts"] if r.get("keymap") or r.get("use_shortcut_of")]
        plugin_texts = scan["texts"]
        args = args[3:]
    stripe_titles = {
        k[len("toolwindow.stripe."):].replace(" ", "").replace("_", ""): v["value"]
        for k, v in plugin_texts.items()
        if k.startswith("toolwindow.stripe.")
    }
    out, bundle, keymaps_dir, *xmls = args
    props = read_properties(bundle)

    declared, binding = {}, {}
    for x in xmls:
        for el in ET.parse(x).getroot().iter():
            if el.tag in ("action", "group") and el.get("id"):
                declared.setdefault(el.get("id"), {"kind": el.tag, "file": os.path.basename(x)})
                if el.get("use-shortcut-of"):
                    binding[el.get("id")] = el.get("use-shortcut-of")

    chain = ["$default.xml", "Mac OS X 10.5+.xml"]
    _, _, parent = read_keymap(os.path.join(keymaps_dir, chain[0]))
    _, parent_name, own = read_keymap(os.path.join(keymaps_dir, chain[1]))
    assert parent_name == "$default", parent_name

    for r in plugin_ops:
        if "use_shortcut_of" in r:
            binding.setdefault(r["id"], r["use_shortcut_of"])

    def apply_ops(keymap, table, seed):
        for r in plugin_ops:
            if r.get("keymap") != keymap:
                continue
            aid = r["id"]
            if r["type"] == "mouse":
                field, stroke = "mouse", r["keystroke"]
            else:
                field, stroke = "keyboard", [x for x in (r["first"], r["second"]) if x]
            if aid not in table:
                table[aid] = seed(aid)
            entry = table[aid]
            if r["replace_all"]:
                entry["keyboard"], entry["mouse"], entry["gesture"] = [], [], []
            if r["remove"]:
                entry[field] = [k for k in entry[field] if k != stroke]
            elif stroke not in entry[field]:
                entry[field].append(stroke)
            entry.setdefault("plugin_sources", []).append(r["source"].split("!")[0])

    empty = lambda aid: {"keyboard": [], "mouse": [], "gesture": []}
    apply_ops("$default", parent, lambda aid: dict(parent[binding[aid]]) if binding.get(aid) in parent else empty(aid))

    def seed_own(aid):
        if binding.get(aid) in own:
            return {k: list(v) for k, v in own[binding[aid]].items()}
        src = parent.get(aid) or parent.get(binding.get(aid))
        return convert_from_parent(src) if src else empty(aid)

    apply_ops("Mac OS X 10.5+", own, seed_own)

    def resolve(aid):
        if aid in own:
            return own[aid], "Mac OS X 10.5+"
        if aid in binding and binding[aid] in own:
            return own[binding[aid]], "Mac OS X 10.5+ via " + binding[aid]
        if aid in parent:
            return convert_from_parent(parent[aid]), "$default"
        if aid in binding and binding[aid] in parent:
            return convert_from_parent(parent[binding[aid]]), "$default via " + binding[aid]
        return None, None

    ids = set(declared) | set(own) | set(parent) | {
        k.split(".", 1)[1].rsplit(".", 1)[0]
        for k in props
        if k.startswith(("action.", "group.")) and k.endswith((".text", ".description"))
    } | {r["id"] for r in plugin_ops}

    def lookup(aid, kind, suffix):
        prefix = "group" if kind == "group" else "action"
        for key in (f"{prefix}.{aid}.{suffix}", f"action.{aid}.{suffix}", f"group.{aid}.{suffix}"):
            if props.get(key):
                return unescape(props[key]), "ActionsBundle"
        for key in (f"{prefix}.{aid}.{suffix}", f"action.{aid}.{suffix}", f"group.{aid}.{suffix}"):
            if key in plugin_texts:
                return plugin_texts[key]["value"], plugin_texts[key]["source"]
        m = re.match(r"^Activate(.+)ToolWindow$", aid)
        if suffix == "text" and m and m.group(1) in stripe_titles:
            return stripe_titles[m.group(1)], "toolwindow.stripe"
        return None, None
    catalog = {}
    for aid in sorted(ids):
        kind = declared.get(aid, {}).get("kind")
        mac, origin = resolve(aid)
        text, text_source = lookup(aid, kind, "text")
        catalog[aid] = {
            "text": text,
            "label": text.replace("_", "") if text else None,
            "text_source": text_source,
            "description": lookup(aid, kind, "description")[0],
            "declared_in": declared.get(aid, {}).get("file"),
            "kind": kind,
            "use_shortcut_of": binding.get(aid),
            "mac": mac,
            "mac_binding_from": origin,
        }

    bound = {k: v for k, v in catalog.items() if v["mac"] and (v["mac"]["keyboard"] or v["mac"]["mouse"] or v["mac"]["gesture"])}
    json.dump(
        {
            "sources": {"bundle": bundle, "keymaps": chain, "actions_xml": [os.path.basename(x) for x in xmls], "plugin_shortcut_ops": len(plugin_ops)},
            "counts": {
                "ids": len(catalog),
                "with_text": sum(1 for v in catalog.values() if v["text"]),
                "declared_in_platform_xml": sum(1 for v in catalog.values() if v["declared_in"]),
                "with_mac_binding": len(bound),
            },
            "actions": catalog,
        },
        open(out, "w"),
        indent=1,
        ensure_ascii=False,
    )


if __name__ == "__main__":
    main()
