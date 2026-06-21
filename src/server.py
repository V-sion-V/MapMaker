# -*- coding: utf-8 -*-
"""
MapMaker - tiny local server (Python standard library only, no pip installs).

Folder layout (separated: code / config / target data):
    MapMaker/
      start.bat
      src/      <- code: server.py, index.html, app.js, styles.css
      config/   <- TileType.cs, EnemyUnits.json, TerrainConfig.json
      Maps/     <- target data: the map .json files

Run:  python src/server.py   (or double-click start.bat)
Stops when you close the console window.
"""

import os
import re
import sys
import json
import socket
import threading
import webbrowser
import urllib.parse
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

SRC_DIR = os.path.dirname(os.path.abspath(__file__))   # .../MapMaker/src (frontend served from here)
ROOT_DIR = os.path.dirname(SRC_DIR)                     # .../MapMaker
CONFIG_DIR = os.path.join(ROOT_DIR, "config")
TERRAIN_FILE = os.path.join(CONFIG_DIR, "TerrainConfig.json")   # editor-local palette (not relocatable)
PREFS_FILE = os.path.join(CONFIG_DIR, "prefs.json")            # stores the user's chosen paths

# Built-in defaults for the user-overridable game paths.
DEFAULT_MAPS_DIR = os.path.join(ROOT_DIR, "Maps")
DEFAULT_ENEMY_FILE = os.path.join(CONFIG_DIR, "EnemyUnits.json")
DEFAULT_TILETYPE_FILE = os.path.join(CONFIG_DIR, "TileType.cs")
DEFAULT_PROFESSION_FILE = os.path.join(CONFIG_DIR, "Profession.cs")
DEFAULT_SKILL_FILE = os.path.join(CONFIG_DIR, "Skill.cs")
DEFAULT_EQUIPMENT_FILE = os.path.join(CONFIG_DIR, "Equipment.cs")

# Runtime paths — overridden from prefs.json by apply_prefs() (called at import).
MAPS_DIR = DEFAULT_MAPS_DIR
ENEMY_FILE = DEFAULT_ENEMY_FILE
TILETYPE_FILE = DEFAULT_TILETYPE_FILE
PROFESSION_FILE = DEFAULT_PROFESSION_FILE
SKILL_FILE = DEFAULT_SKILL_FILE
EQUIPMENT_FILE = DEFAULT_EQUIPMENT_FILE

NAME_RE = re.compile(r"^[A-Za-z0-9_\-]+$")

STATIC_TYPES = {
    ".html": "text/html; charset=utf-8",
    ".js": "application/javascript; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".json": "application/json; charset=utf-8",
    ".svg": "image/svg+xml",
    ".png": "image/png",
    ".ico": "image/x-icon",
}

# Sensible default colors keyed by the TileType enum names we already know.
DEFAULT_COLORS = {
    "None": "#1b1b1b",
    "Plain": "#7cb342",
    "Wood": "#558b2f",
    "Forest": "#33691e",
    "Hill": "#a1887f",
    "Mountain": "#6d4c41",
    "Shallow": "#4fc3f7",
    "DeepWater": "#1565c0",
    "Fortress": "#9e9e9e",
    "Sand": "#f0d68a",
    "Dune": "#e0b96b",
    "DesertMountain": "#b07d3c",
    "Oasis": "#26a69a",
    "DesertRiver": "#29b6f6",
    "SandStorm": "#cdb38b",
    "Pyramid": "#d4a017",
    "DesertFortress": "#8d6e63",
}
FALLBACK_COLORS = [
    "#e57373", "#f06292", "#ba68c8", "#9575cd", "#7986cb",
    "#64b5f6", "#4dd0e1", "#4db6ac", "#81c784", "#dce775",
    "#ffd54f", "#ffb74d", "#a1887f", "#90a4ae",
]


# --------------------------------------------------------------------------- #
# TileType.cs parsing & terrain seeding
# --------------------------------------------------------------------------- #
def parse_tiletype():
    """Return [{id, name, theme}] parsed from TileType.cs (best effort).
    A standalone comment line like '//Grassland' marks the theme of the
    entries that follow it."""
    out = []
    if not os.path.exists(TILETYPE_FILE):
        return out
    theme = ""
    with open(TILETYPE_FILE, encoding="utf-8-sig") as f:
        for line in f:
            s = line.strip()
            m_theme = re.match(r"^//\s*([A-Za-z][A-Za-z0-9_ ]*)\s*$", s)
            if m_theme:
                theme = m_theme.group(1).strip()
                continue
            # An entry like "Plain = 1," (ignore trailing inline comments).
            m_entry = re.match(r"^([A-Za-z_]\w*)\s*=\s*(\d+)", s)
            if m_entry:
                out.append({
                    "id": int(m_entry.group(2)),
                    "name": m_entry.group(1),
                    "theme": theme,
                })
    return out


def parse_cs_enum(path, enum_name):
    """Return the declared member names of a C# enum, in source order."""
    if not os.path.isfile(path):
        return []
    with open(path, encoding="utf-8-sig") as f:
        source = f.read()
    source = re.sub(r"/\*.*?\*/", "", source, flags=re.S)
    source = re.sub(r"//[^\r\n]*", "", source)
    match = re.search(r"\benum\s+" + re.escape(enum_name) + r"\b[^\{]*\{(.*?)\}",
                      source, flags=re.S)
    if not match:
        return []
    members = []
    for raw in match.group(1).split(","):
        item = re.sub(r"\[[^\]]*\]", "", raw).strip()
        member = re.match(r"^([A-Za-z_]\w*)\b", item)
        if member:
            members.append(member.group(1))
    return members


def enemy_enum_payload():
    return {
        "professions": parse_cs_enum(PROFESSION_FILE, "Profession"),
        "skills": parse_cs_enum(SKILL_FILE, "Skill"),
        "equipments": parse_cs_enum(EQUIPMENT_FILE, "Equipment"),
    }


def validate_enemy_config(obj):
    """Validate editable EnemyUnits fields against the configured C# enums."""
    errors = []
    if not isinstance(obj, dict) or not isinstance(obj.get("units"), list):
        return ["顶层字段 units 必须是数组"]

    enums = enemy_enum_payload()
    labels = {"professions": "Profession", "skills": "Skill", "equipments": "Equipment"}
    for key, label in labels.items():
        if not enums[key]:
            errors.append("无法从 %s.cs 读取 enum %s" % (label, label))
    if errors:
        return errors

    professions = set(enums["professions"])
    skills = set(enums["skills"])
    equipments = set(enums["equipments"])
    seen_ids = set()
    for index, unit in enumerate(obj["units"]):
        where = "units[%d]" % index
        if not isinstance(unit, dict):
            errors.append(where + " 必须是对象")
            continue
        unit_id = unit.get("id")
        if not isinstance(unit_id, str) or not re.match(r"^[A-Za-z_]\w*$", unit_id):
            errors.append(where + ".id 必须是合法且非空的标识符")
        elif unit_id in seen_ids:
            errors.append("单位 id 重复: " + unit_id)
        else:
            seen_ids.add(unit_id)

        profession = unit.get("profession")
        if profession not in professions:
            errors.append("%s.profession 未在 Profession enum 中声明: %s" %
                          (where, profession))

        unit_skills = unit.get("skills")
        if not isinstance(unit_skills, list):
            errors.append(where + ".skills 必须是数组")
        else:
            for skill_index, skill in enumerate(unit_skills):
                skill_where = "%s.skills[%d]" % (where, skill_index)
                if not isinstance(skill, dict):
                    errors.append(skill_where + " 必须是对象")
                    continue
                if skill.get("skill") not in skills:
                    errors.append("%s.skill 未在 Skill enum 中声明: %s" %
                                  (skill_where, skill.get("skill")))
                level = skill.get("level")
                if isinstance(level, bool) or not isinstance(level, int):
                    errors.append(skill_where + ".level 必须是整数")

        unit_equipments = unit.get("equipments")
        if not isinstance(unit_equipments, list):
            errors.append(where + ".equipments 必须是数组")
        else:
            for equipment_index, equipment in enumerate(unit_equipments):
                if equipment not in equipments:
                    errors.append("%s.equipments[%d] 未在 Equipment enum 中声明: %s" %
                                  (where, equipment_index, equipment))
    return errors


def _write_terrains(data):
    with open(TERRAIN_FILE, "w", encoding="utf-8") as f:
        json.dump(data, f, indent=2, ensure_ascii=False)


def seed_terrains():
    """Build TerrainConfig.json from TileType.cs and persist it."""
    entries = parse_tiletype()
    if not entries:
        entries = [{"id": 0, "name": "None", "theme": ""}]
    terrains, themes, fb = [], [], 0
    for e in entries:
        color = DEFAULT_COLORS.get(e["name"])
        if not color:
            color = FALLBACK_COLORS[fb % len(FALLBACK_COLORS)]
            fb += 1
        th = e.get("theme", "")
        if th and th not in themes:
            themes.append(th)
        terrains.append({
            "id": e["id"], "name": e["name"], "color": color, "theme": th,
            "deployable": True,
        })
    data = {"themes": themes, "terrains": terrains}
    _write_terrains(data)
    return data


def _migrate_terrains(data):
    """In-place migration: rename old 'category' -> 'theme', ensure a top-level
    'themes' list exists. Returns True if anything changed."""
    changed = False
    for t in data.get("terrains", []):
        if "category" in t:
            if "theme" not in t:
                t["theme"] = t.get("category", "")
            del t["category"]
            changed = True
        if "deployable" not in t:           # new field: default deployable
            t["deployable"] = True
            changed = True
    if "themes" not in data:
        seen = []
        for t in data.get("terrains", []):
            th = t.get("theme", "")
            if th and th not in seen:
                seen.append(th)
        data["themes"] = seen
        changed = True
    return changed


def load_terrains():
    if os.path.exists(TERRAIN_FILE):
        with open(TERRAIN_FILE, encoding="utf-8-sig") as f:
            data = json.load(f)
        if _migrate_terrains(data):
            _write_terrains(data)
        return data
    return seed_terrains()


def read_map_theme(path):
    """Best-effort read of just a map's theme field for the list view."""
    try:
        with open(path, encoding="utf-8-sig") as f:
            return (json.load(f) or {}).get("theme", "") or ""
    except Exception:
        return ""


# --------------------------------------------------------------------------- #
# User preferences (chosen paths) — persisted in config/prefs.json
# --------------------------------------------------------------------------- #
PREF_DEFAULTS = {
    "mapsDir": DEFAULT_MAPS_DIR,
    "enemyFile": DEFAULT_ENEMY_FILE,
    "tileTypeFile": DEFAULT_TILETYPE_FILE,
    "professionFile": DEFAULT_PROFESSION_FILE,
    "skillFile": DEFAULT_SKILL_FILE,
    "equipmentFile": DEFAULT_EQUIPMENT_FILE,
}


def _same_path(a, b):
    """Compare paths without freezing a built-in default into preferences."""
    try:
        norm = lambda p: os.path.normcase(os.path.abspath(os.path.expanduser(p)))
        return norm(a) == norm(b)
    except (TypeError, ValueError):
        return False


def normalize_prefs(prefs):
    """Keep only genuine user overrides; defaults are represented by absence."""
    out = {}
    for key, default in PREF_DEFAULTS.items():
        val = str((prefs or {}).get(key, "") or "").strip()
        if val and not _same_path(val, default):
            out[key] = val
    return out


def load_prefs():
    if os.path.exists(PREFS_FILE):
        try:
            with open(PREFS_FILE, encoding="utf-8-sig") as f:
                return normalize_prefs(json.load(f) or {})
        except Exception:
            return {}
    return {}


def save_prefs(prefs):
    prefs = normalize_prefs(prefs)
    os.makedirs(CONFIG_DIR, exist_ok=True)
    with open(PREFS_FILE, "w", encoding="utf-8") as f:
        json.dump(prefs, f, indent=2, ensure_ascii=False)


def apply_prefs(prefs):
    """Point the runtime path globals at the user's chosen locations (or defaults)."""
    global MAPS_DIR, ENEMY_FILE, TILETYPE_FILE, PROFESSION_FILE, SKILL_FILE, EQUIPMENT_FILE
    prefs = normalize_prefs(prefs)
    MAPS_DIR = prefs.get("mapsDir") or DEFAULT_MAPS_DIR
    ENEMY_FILE = prefs.get("enemyFile") or DEFAULT_ENEMY_FILE
    TILETYPE_FILE = prefs.get("tileTypeFile") or DEFAULT_TILETYPE_FILE
    PROFESSION_FILE = prefs.get("professionFile") or DEFAULT_PROFESSION_FILE
    SKILL_FILE = prefs.get("skillFile") or DEFAULT_SKILL_FILE
    EQUIPMENT_FILE = prefs.get("equipmentFile") or DEFAULT_EQUIPMENT_FILE


def prefs_payload():
    raw = load_prefs()                          # only keys the user explicitly overrode
    keys = ("mapsDir", "enemyFile", "tileTypeFile", "professionFile",
            "skillFile", "equipmentFile")
    return {
        "set": {key: raw.get(key, "") for key in keys},
        "effective": {"mapsDir": MAPS_DIR, "enemyFile": ENEMY_FILE,
                      "tileTypeFile": TILETYPE_FILE, "professionFile": PROFESSION_FILE,
                      "skillFile": SKILL_FILE, "equipmentFile": EQUIPMENT_FILE},
        "defaults": dict(PREF_DEFAULTS),
        "exists": {"mapsDir": os.path.isdir(MAPS_DIR),
                   "enemyFile": os.path.isfile(ENEMY_FILE),
                   "tileTypeFile": os.path.isfile(TILETYPE_FILE),
                   "professionFile": os.path.isfile(PROFESSION_FILE),
                   "skillFile": os.path.isfile(SKILL_FILE),
                   "equipmentFile": os.path.isfile(EQUIPMENT_FILE)},
    }


def native_pick(kind, title):
    """Open a native folder/file dialog in an isolated subprocess (so a tkinter
    failure can never take down the server). Returns (path_or_None, error)."""
    script = (
        "import sys\n"
        "try:\n"
        "    import tkinter as tk\n"
        "    from tkinter import filedialog\n"
        "except Exception:\n"
        "    sys.exit(2)\n"
        "r = tk.Tk(); r.withdraw(); r.attributes('-topmost', True)\n"
        "kind, title = sys.argv[1], sys.argv[2]\n"
        "p = filedialog.askdirectory(title=title) if kind == 'dir' "
        "else filedialog.askopenfilename(title=title)\n"
        "sys.stdout.write(p or '')\n"
    )
    try:
        import subprocess
        r = subprocess.run([sys.executable, "-c", script, kind, title or ""],
                           capture_output=True, text=True, timeout=300)
        if r.returncode == 2:
            return None, "tkinter not available"
        return (r.stdout.strip() or None), None
    except Exception as ex:
        return None, str(ex)


# --------------------------------------------------------------------------- #
# Map serialization (keeps the human-friendly grid layout for "tiles")
# --------------------------------------------------------------------------- #
TILES_TOKEN = "__TILES_PLACEHOLDER__"
DEPLOY_TOKEN = "__DEPLOY_PLACEHOLDER__"


def format_map(m):
    """Serialize a map dict, rendering 'tiles' as an aligned WxH grid and the
    free-form 'deployRegion' as one compact {x,y} per line, so the files stay
    readable / diff-friendly, matching the existing maps."""
    width = int(m.get("width", 0)) or 1
    tiles = list(m.get("tiles", []))

    # Canonical key order, then any extra keys (so nothing is silently lost).
    order = ["mapName", "theme", "width", "height", "tiles", "deployRegion", "enemyPresets"]
    ordered = {}
    for k in order:
        if k in m:
            ordered[k] = m[k]
    for k in m:
        if k not in ordered:
            ordered[k] = m[k]
    ordered["tiles"] = TILES_TOKEN

    deploy = ordered.get("deployRegion")
    deploy_is_list = isinstance(deploy, list)
    if deploy_is_list:
        ordered["deployRegion"] = DEPLOY_TOKEN

    text = json.dumps(ordered, indent=2, ensure_ascii=False)

    if tiles:
        pad = max(len(str(int(t))) for t in tiles)
        rows = []
        for i in range(0, len(tiles), width):
            row = tiles[i:i + width]
            rows.append("    " + ", ".join(str(int(t)).rjust(pad) for t in row))
        grid = "[\n" + ",\n".join(rows) + "\n  ]"
    else:
        grid = "[]"
    text = text.replace('"' + TILES_TOKEN + '"', grid)

    if deploy_is_list:
        if deploy:
            cells = ",\n".join('    { "x": %d, "y": %d }' % (int(c["x"]), int(c["y"])) for c in deploy)
            block = "[\n" + cells + "\n  ]"
        else:
            block = "[]"
        text = text.replace('"' + DEPLOY_TOKEN + '"', block)

    return text + "\n"


def safe_map_file(name):
    if not name or not NAME_RE.match(name):
        return None
    return os.path.join(MAPS_DIR, name + ".json")


# --------------------------------------------------------------------------- #
# HTTP handler
# --------------------------------------------------------------------------- #
class Handler(BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"
    server_version = "MapMaker/1.0"

    def log_message(self, fmt, *args):
        print("  %s - %s" % (self.command, self.path))

    # -- helpers --------------------------------------------------------- #
    def _send_json(self, obj, code=200):
        body = json.dumps(obj, ensure_ascii=False).encode("utf-8")
        self.send_response(code)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(body)

    def _error(self, code, msg):
        self._send_json({"error": msg}, code)

    def _read_body(self):
        length = int(self.headers.get("Content-Length", 0))
        raw = self.rfile.read(length) if length else b""
        return raw.decode("utf-8")

    # -- GET ------------------------------------------------------------- #
    def do_GET(self):
        path = urllib.parse.urlparse(self.path).path
        try:
            if path == "/api/prefs":
                return self._send_json(prefs_payload())

            if path == "/api/maps":
                maps = []
                if os.path.isdir(MAPS_DIR):
                    for fn in sorted(os.listdir(MAPS_DIR)):
                        if not fn.lower().endswith(".json"):
                            continue
                        maps.append({
                            "name": fn[:-5],
                            "theme": read_map_theme(os.path.join(MAPS_DIR, fn)),
                        })
                return self._send_json({"maps": maps})

            if path.startswith("/api/maps/"):
                name = urllib.parse.unquote(path[len("/api/maps/"):])
                fp = safe_map_file(name)
                if not fp or not os.path.exists(fp):
                    return self._error(404, "map not found")
                with open(fp, encoding="utf-8-sig") as f:
                    return self._send_json(json.load(f))

            if path == "/api/terrains":
                return self._send_json(load_terrains())

            if path == "/api/enemies":
                if not os.path.exists(ENEMY_FILE):
                    return self._send_json({"units": []})
                with open(ENEMY_FILE, encoding="utf-8-sig") as f:
                    return self._send_json(json.load(f))

            if path == "/api/enemy-enums":
                return self._send_json(enemy_enum_payload())

            if path == "/api/tiletype":
                return self._send_json({"types": parse_tiletype()})

            return self._serve_static(path)
        except Exception as ex:  # keep the server alive on bad input
            return self._error(500, str(ex))

    # -- PUT ------------------------------------------------------------- #
    def do_PUT(self):
        path = urllib.parse.urlparse(self.path).path
        try:
            body = self._read_body()
            if path.startswith("/api/maps/"):
                name = urllib.parse.unquote(path[len("/api/maps/"):])
                fp = safe_map_file(name)
                if not fp:
                    return self._error(400, "invalid map name")
                obj = json.loads(body)
                # 'levelUp' is deprecated: strip it from every enemy on save
                for p in obj.get("enemyPresets", []):
                    for en in p.get("enemies", []):
                        en.pop("levelUp", None)
                # write WITH BOM to match the existing map files / game loader
                with open(fp, "w", encoding="utf-8-sig") as f:
                    f.write(format_map(obj))
                return self._send_json({"ok": True})

            if path == "/api/terrains":
                obj = json.loads(body)
                with open(TERRAIN_FILE, "w", encoding="utf-8") as f:
                    json.dump(obj, f, indent=2, ensure_ascii=False)
                return self._send_json({"ok": True})

            if path == "/api/enemies":
                obj = json.loads(body)
                errors = validate_enemy_config(obj)
                if errors:
                    return self._send_json({"ok": False, "errors": errors}, 400)
                with open(ENEMY_FILE, "w", encoding="utf-8") as f:
                    json.dump(obj, f, indent=2, ensure_ascii=False)
                    f.write("\n")
                return self._send_json({"ok": True})

            if path == "/api/prefs":
                obj = json.loads(body)
                prefs, errs = load_prefs(), []
                for key, val, is_dir in [("mapsDir", obj.get("mapsDir"), True),
                                         ("enemyFile", obj.get("enemyFile"), False),
                                         ("tileTypeFile", obj.get("tileTypeFile"), False),
                                         ("professionFile", obj.get("professionFile"), False),
                                         ("skillFile", obj.get("skillFile"), False),
                                         ("equipmentFile", obj.get("equipmentFile"), False)]:
                    val = (val or "").strip()
                    if not val or _same_path(val, PREF_DEFAULTS[key]):
                        prefs.pop(key, None)                 # empty -> fall back to default
                    elif is_dir and not os.path.isdir(val):
                        errs.append("文件夹不存在: " + val)
                    elif not is_dir and not os.path.isfile(val):
                        errs.append("文件不存在: " + val)
                    else:
                        prefs[key] = val
                if errs:
                    return self._send_json({"ok": False, "errors": errs})
                save_prefs(prefs); apply_prefs(prefs)
                return self._send_json({"ok": True, "prefs": prefs_payload()})

            return self._error(404, "unknown endpoint")
        except Exception as ex:
            return self._error(500, str(ex))

    # -- POST ------------------------------------------------------------ #
    def do_POST(self):
        path = urllib.parse.urlparse(self.path).path
        try:
            if path == "/api/pick":
                obj = json.loads(self._read_body() or "{}")
                p, err = native_pick(obj.get("kind", "dir"), obj.get("title", ""))
                return self._send_json({"path": p, "error": err})
            return self._error(404, "unknown endpoint")
        except Exception as ex:
            return self._error(500, str(ex))

    # -- DELETE ---------------------------------------------------------- #
    def do_DELETE(self):
        path = urllib.parse.urlparse(self.path).path
        try:
            if path.startswith("/api/maps/"):
                name = urllib.parse.unquote(path[len("/api/maps/"):])
                fp = safe_map_file(name)
                if not fp:
                    return self._error(400, "invalid map name")
                if os.path.exists(fp):
                    os.remove(fp)
                meta = fp + ".meta"          # clean up Unity leftover if present
                if os.path.exists(meta):
                    os.remove(meta)
                return self._send_json({"ok": True})
            return self._error(404, "unknown endpoint")
        except Exception as ex:
            return self._error(500, str(ex))

    # -- static ---------------------------------------------------------- #
    def _serve_static(self, path):
        if path in ("/", ""):
            path = "/index.html"
        rel = urllib.parse.unquote(path.lstrip("/"))
        full = os.path.normpath(os.path.join(SRC_DIR, rel))
        if not full.startswith(SRC_DIR) or not os.path.isfile(full):
            return self._error(404, "not found")
        ctype = STATIC_TYPES.get(os.path.splitext(full)[1].lower(),
                                 "application/octet-stream")
        with open(full, "rb") as f:
            data = f.read()
        self.send_response(200)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(data)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(data)


# --------------------------------------------------------------------------- #
def find_port(start=8765):
    for p in range(start, start + 30):
        s = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
        try:
            s.bind(("127.0.0.1", p))
            s.close()
            return p
        except OSError:
            s.close()
    return start


def main():
    for d in (MAPS_DIR, CONFIG_DIR):
        if not os.path.isdir(d):
            os.makedirs(d)
    load_terrains()  # make sure TerrainConfig.json exists on first run

    port = find_port()
    url = "http://127.0.0.1:%d/" % port
    httpd = ThreadingHTTPServer(("127.0.0.1", port), Handler)

    print("=" * 56)
    print("  MapMaker is running:  " + url)
    print("  Maps folder:          " + MAPS_DIR)
    print("  EnemyUnits file:      " + ENEMY_FILE)
    print("  TileType file:        " + TILETYPE_FILE)
    print("  Profession enum:      " + PROFESSION_FILE)
    print("  Skill enum:           " + SKILL_FILE)
    print("  Equipment enum:       " + EQUIPMENT_FILE)
    print("  Close this window to stop the editor.")
    print("=" * 56)

    threading.Timer(0.6, lambda: webbrowser.open(url)).start()
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        print("\nStopped.")


# Apply saved path preferences at import time — covers both `python server.py`
# and the preview launcher (which imports this module without calling main()).
apply_prefs(load_prefs())

if __name__ == "__main__":
    main()
