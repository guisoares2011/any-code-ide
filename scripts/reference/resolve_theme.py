"""Resolve an IntelliJ *.theme.json (plus parent chain) into flat hex tokens.

usage: python3 -I resolve_theme.py <out.json> <child.theme.json> [<parent.theme.json> ...]
Themes are given child-first. Named colors resolve through the child's `colors`
map first, then each parent's; `ui` keys are flattened with '.' and merged with
child precedence.
"""
import json
import re
import sys

HEX = re.compile(r"^#[0-9A-Fa-f]{6}([0-9A-Fa-f]{2})?$")


def flatten(d, prefix=""):
    out = {}
    for k, v in d.items():
        if isinstance(v, dict):
            out.update(flatten(v, prefix + k + "."))
        else:
            out[prefix + k] = v
    return out


def main():
    out_path, *theme_paths = sys.argv[1:]
    themes = [json.load(open(p)) for p in theme_paths]

    colors = {}
    for t in reversed(themes):
        colors.update(t.get("colors", {}))

    def resolve(value, seen=()):
        if not isinstance(value, str):
            return None, [value]
        if HEX.match(value):
            return value.upper(), [value]
        if value in seen or value not in colors:
            return None, [value]
        hexv, chain = resolve(colors[value], seen + (value,))
        return hexv, [value] + chain

    resolved_colors, unresolved = {}, {}
    for name in sorted(colors):
        hexv, chain = resolve(name)
        if hexv:
            resolved_colors[name] = {"hex": hexv, "chain": chain[:-1]}
        else:
            unresolved["colors." + name] = chain

    ui, ui_source = {}, {}
    for t, p in zip(reversed(themes), reversed(theme_paths)):
        for k, v in flatten(t.get("ui", {})).items():
            ui[k] = v
            ui_source[k] = t.get("name")

    resolved_ui, other_ui = {}, {}
    for k in sorted(ui):
        v = ui[k]
        hexv, chain = resolve(v)
        if hexv:
            resolved_ui[k] = {"hex": hexv, "via": chain[:-1], "from": ui_source[k]}
        elif isinstance(v, str) and not HEX.match(v) and re.match(r"^[A-Za-z][\w-]*$", v) and not v.isdigit() and v not in ("true", "false"):
            unresolved["ui." + k] = chain
        else:
            other_ui[k] = {"value": v, "from": ui_source[k]}

    json.dump(
        {
            "themes": [{"name": t.get("name"), "parentTheme": t.get("parentTheme"), "path": p} for t, p in zip(themes, theme_paths)],
            "editorScheme": themes[0].get("editorScheme"),
            "counts": {
                "colors": len(resolved_colors),
                "ui_colors": len(resolved_ui),
                "ui_other": len(other_ui),
                "unresolved": len(unresolved),
            },
            "colors": resolved_colors,
            "ui": resolved_ui,
            "ui_other": other_ui,
            "unresolved": unresolved,
        },
        open(out_path, "w"),
        indent=1,
    )


if __name__ == "__main__":
    main()
