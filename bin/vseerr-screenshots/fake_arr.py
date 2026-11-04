"""Fake Radarr and Sonarr instances for VSeerr's README screenshots.

Serves the demo libraries written by seed.py (the JSON file named by
DEMO_ARR_DATA), one instance per port, with just the API calls Seerr and
VSeerr make. Read only: adding or updating a title answers with the title as
it is. Unknown paths answer 404 and are logged, so a missing call shows up in
the job log.
"""

import json
import os
import re
import sys
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import parse_qs, urlparse

DATA_FILE = os.environ.get("DEMO_ARR_DATA", "demo-arr.json")
_cache = {"mtime": None, "data": {}}
_lock = threading.Lock()


def instances():
    """The demo data, reloaded when seed.py rewrites it."""
    with _lock:
        try:
            mtime = os.path.getmtime(DATA_FILE)
        except OSError:
            return {}
        if mtime != _cache["mtime"]:
            with open(DATA_FILE, encoding="utf-8") as handle:
                _cache["data"] = json.load(handle)
            _cache["mtime"] = mtime
        return _cache["data"]


def term_id(query, prefix):
    match = re.fullmatch(prefix + r":(\d+)", (query.get("term") or [""])[0])
    return int(match.group(1)) if match else None


def answer_get(arr, path, query):
    kind = arr["kind"]
    one = lambda name: int(query[name][0]) if name in query else None
    if path == "/system/status":
        return {
            "appName": kind.capitalize(),
            "version": "5.0.0.0" if kind == "radarr" else "4.0.0.0",
            "urlBase": "",
        }
    if path == "/qualityprofile":
        return arr["profiles"]
    if path == "/customformat":
        return arr["formats"]
    if path == "/rootfolder":
        return [{"id": 1, "path": arr["root"], "freeSpace": 4 * 10**12, "unmappedFolders": []}]
    if path in ("/tag", "/languageprofile"):
        return [] if path == "/tag" else [{"id": 1, "name": "English"}]
    if path == "/queue":
        return {"page": 1, "pageSize": 1000, "totalRecords": 0, "records": []}
    if kind == "radarr":
        movies = arr["movies"]
        if path == "/movie":
            tmdb = one("tmdbId")
            return [m for m in movies if tmdb is None or m["tmdbId"] == tmdb]
        if path == "/movie/lookup":
            # A title outside the library is offered for adding, like Radarr's
            # own lookup does (no id yet).
            tmdb = term_id(query, "tmdb")
            found = [m for m in movies if m["tmdbId"] == tmdb]
            return found or [{
                "tmdbId": tmdb, "title": f"Movie {tmdb}", "titleSlug": f"movie-{tmdb}",
                "year": 2000, "images": [], "monitored": False, "hasFile": False,
            }]
        if path.startswith("/movie/"):
            found = [m for m in movies if str(m["id"]) == path.split("/")[2]]
            return found[0] if found else None
        if path == "/moviefile":
            movie = one("movieId")
            return [f for f in arr["files"] if f["movieId"] == movie]
    else:
        series = arr["series"]
        if path == "/series":
            tvdb = one("tvdbId")
            return [s for s in series if tvdb is None or s["tvdbId"] == tvdb]
        if path == "/series/lookup":
            tvdb = term_id(query, "tvdb")
            found = [s for s in series if s["tvdbId"] == tvdb]
            return found or [{
                "tvdbId": tvdb, "title": f"Series {tvdb}", "titleSlug": f"series-{tvdb}",
                "year": 2000, "images": [], "seasons": [], "monitored": False,
            }]
        if path.startswith("/series/"):
            found = [s for s in series if str(s["id"]) == path.split("/")[2]]
            return found[0] if found else None
        if path == "/episodefile":
            show = one("seriesId")
            return [f for f in arr["files"] if f["seriesId"] == show]
        if path == "/episode":
            show = one("seriesId")
            return [e for e in arr["episodes"] if e["seriesId"] == show]
    return None


def handler_for(port):
    class Handler(BaseHTTPRequestHandler):
        def log_message(self, format, *args):  # noqa: A002 (base signature)
            pass

        def reply(self, status, body):
            raw = json.dumps(body).encode()
            self.send_response(status)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(raw)))
            self.end_headers()
            self.wfile.write(raw)

        def target(self):
            url = urlparse(self.path)
            path = re.sub(r"^/api/v3", "", url.path).rstrip("/").lower()
            return path, parse_qs(url.query)

        def do_GET(self):
            arr = instances().get(str(port))
            path, query = self.target()
            body = answer_get(arr, path, query) if arr else None
            if body is None:
                print(f"{port} GET {self.path}: not found", flush=True)
                self.reply(404, {"message": "NotFound"})
            else:
                self.reply(200, body)

        def do_write(self):
            length = int(self.headers.get("Content-Length") or 0)
            sent = json.loads(self.rfile.read(length) or b"{}")
            path, _ = self.target()
            print(f"{port} {self.command} {path}", flush=True)
            if path == "/command":
                self.reply(201, {"id": 1, "name": sent.get("name"), "status": "queued"})
            else:
                # Echo the title back as added (with an id), without storing it.
                if isinstance(sent, dict):
                    sent.setdefault("id", 900)
                self.reply(200 if self.command == "PUT" else 201, sent)

        do_POST = do_write
        do_PUT = do_write

    return Handler


if __name__ == "__main__":
    ports = [int(p) for p in sys.argv[1:]] or [7878, 7879, 7880, 8989, 8990]
    for port in ports:
        server = ThreadingHTTPServer(("127.0.0.1", port), handler_for(port))
        threading.Thread(target=server.serve_forever, daemon=True).start()
    print("fake arr instances on ports", ports, flush=True)
    threading.Event().wait()
