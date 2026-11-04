"""Demo data for VSeerr's README screenshots.

Run against a fresh VSeerr started with the Cypress test users
(admin@seerr.dev and demo@seerr.dev, password test1234). It

1. picks a show that is airing now (TMDB data changes, so the show is chosen
   at run time) and writes the fake Radarr/Sonarr libraries for fake_arr.py,
2. adds a standard Radarr and Sonarr plus the versions "German" and "French",
3. lets the demo user request both versions,
4. adds a few requests and runs the Radarr and Sonarr scans,
5. dates the requests back, so they read "13 days ago" and the new-request
   hold doesn't apply,
6. checks what VSeerr reports, and writes demo-state.json for shots.py.

Only demo data: no real titles from anyone's library, no real keys.
"""

import datetime
import json
import os
import sqlite3
import sys
import time
import urllib.error
import urllib.request
from http.cookiejar import CookieJar
from typing import Any

BASE = os.environ.get("VSEERR_URL", "http://127.0.0.1:5055")
DATA_FILE = os.environ.get("DEMO_ARR_DATA", "demo-arr.json")
STATE_FILE = os.environ.get("DEMO_STATE", "demo-state.json")
DB_FILE = os.environ.get("VSEERR_DB", "config/db/db.sqlite3")
PASSWORD = "test1234"

# Shows that air most of the year; the first one with a season on air wins.
SHOW_CANDIDATES = [125935, 126027, 1416, 456]  # Abbott Elementary, Ghosts, Grey's Anatomy, The Simpsons

# Radarr and Sonarr language ids.
ENGLISH, FRENCH, GERMAN = (1, "English"), (2, "French"), (4, "German")
MATRIX, INCEPTION, PULP_FICTION = 603, 27205, 680


class Session:
    def __init__(self, email):
        self.opener = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(CookieJar()))
        status, _ = self.call("POST", "/auth/local", {"email": email, "password": PASSWORD})
        if status != 200:
            sys.exit(f"Sign-in as {email} failed: {status}")

    def call(self, method, path, body=None, expect=None) -> tuple[int, Any]:
        data = json.dumps(body).encode() if body is not None else None
        req = urllib.request.Request(BASE + "/api/v1" + path, method=method, data=data,
                                     headers={"Content-Type": "application/json"})
        try:
            with self.opener.open(req, timeout=180) as res:
                raw = res.read()
                status, payload = res.status, (json.loads(raw) if raw else None)
        except urllib.error.HTTPError as error:
            status, payload = error.code, error.read().decode(errors="replace")[:500]
        if expect and status not in expect:
            sys.exit(f"{method} {path}: {status} {payload}")
        return status, payload


def language(entry):
    return {"id": entry[0], "name": entry[1]}


def language_format(format_id, name, entry):
    return {"id": format_id, "name": name, "specifications": [{
        "name": entry[1], "implementation": "LanguageSpecification", "negate": False, "required": True,
        "fields": [{"name": "value", "value": entry[0]}, {"name": "exceptLanguage", "value": False}],
    }]}


def plain_format(format_id, name):
    # A format the fake files carry by name; its specification doesn't matter here.
    return {"id": format_id, "name": name, "specifications": [{
        "name": name, "implementation": "ReleaseTitleSpecification", "negate": False, "required": True,
        "fields": [{"name": "value", "value": name}],
    }]}


def profile(profile_id, name, scores):
    return {"id": profile_id, "name": name, "minFormatScore": 0, "cutoffFormatScore": 0,
            "formatItems": [{"format": f["id"], "name": f["name"], "score": s} for f, s in scores]}


def movie(tmdb_id, title, year, imdb, file_id=None):
    return {"id": tmdb_id, "title": title, "titleSlug": title.lower().replace(" ", "-"), "tmdbId": tmdb_id,
            "imdbId": imdb, "year": year, "hasFile": file_id is not None, "monitored": True,
            "isAvailable": True, "status": "released", "qualityProfileId": 1, "tags": [], "images": [],
            "originalLanguage": language(ENGLISH), "path": f"/movies/{title}", "rootFolderPath": "/movies",
            "added": "2026-01-01T00:00:00Z", "sizeOnDisk": 0}


def movie_file(file_id, movie_id, resolution, formats, languages):
    return {"id": file_id, "movieId": movie_id, "relativePath": f"{movie_id}.mkv", "size": 0,
            "quality": {"quality": {"id": 1, "name": f"{resolution}p", "resolution": resolution}},
            "customFormats": [{"id": f["id"], "name": f["name"]} for f in formats],
            "languages": [language(entry) for entry in languages]}


def radarr_libraries():
    remux, atmos, vision = plain_format(1, "Remux"), plain_format(2, "Atmos"), plain_format(3, "Dolby Vision")
    german_std = language_format(4, "German audio", GERMAN)
    standard = {
        "kind": "radarr", "root": "/movies",
        "formats": [remux, atmos, vision, german_std],
        "profiles": [profile(1, "Best quality", [(remux, 50), (atmos, 20), (vision, 20), (german_std, 0)])],
        "movies": [movie(MATRIX, "The Matrix", 1999, "tt0133093", 11),
                   movie(INCEPTION, "Inception", 2010, "tt1375666", 12)],
        "files": [movie_file(11, MATRIX, 2160, [remux, atmos, vision], [ENGLISH]),
                  movie_file(12, INCEPTION, 1080, [german_std], [ENGLISH, GERMAN])],
    }
    german_audio = language_format(1, "German audio", GERMAN)
    german = {
        "kind": "radarr", "root": "/movies-german",
        "formats": [german_audio],
        "profiles": [profile(1, "German", [(german_audio, 100)]),
                     profile(2, "German or English", [(german_audio, 10)])],
        "movies": [movie(MATRIX, "The Matrix", 1999, "tt0133093", 21)],
        "files": [movie_file(21, MATRIX, 1080, [german_audio], [ENGLISH, GERMAN])],
    }
    french_audio = language_format(1, "French audio", FRENCH)
    french = {
        "kind": "radarr", "root": "/movies-french",
        "formats": [french_audio],
        "profiles": [profile(1, "French", [(french_audio, 100)])],
        "movies": [], "files": [],
    }
    return standard, german, french


def series_library(show, held, root, formats, languages, resolution, first_file_id):
    """One Sonarr instance holding `held` = {season: [episode numbers]} of the show."""
    files, episodes, file_id = [], [], first_file_id
    for season, count in show["seasons"].items():
        for number in range(1, count + 1):
            has = number in held.get(season, [])
            if has:
                file_id += 1
                files.append({"id": file_id, "seriesId": 1, "seasonNumber": season, "size": 0,
                              "relativePath": f"S{season:02d}E{number:02d}.mkv",
                              "quality": {"quality": {"id": 1, "name": f"{resolution}p", "resolution": resolution}},
                              "customFormats": [{"id": f["id"], "name": f["name"]} for f in formats],
                              "languages": [language(entry) for entry in languages]})
            episodes.append({"id": season * 1000 + number, "seriesId": 1, "seasonNumber": season,
                             "episodeNumber": number, "hasFile": has, "monitored": True,
                             "episodeFileId": file_id if has else 0})
    seasons = [{"seasonNumber": season, "monitored": season in held, "statistics": {
        "episodeFileCount": len(held.get(season, [])), "episodeCount": len(held.get(season, [])),
        "totalEpisodeCount": count, "sizeOnDisk": 0,
        "percentOfEpisodes": 100.0 * len(held.get(season, [])) / count}}
        for season, count in show["seasons"].items()]
    series = {"id": 1, "title": show["name"], "titleSlug": "demo-show", "tvdbId": show["tvdbId"],
              "tmdbId": show["tmdbId"], "qualityProfileId": 1, "languageProfileId": 1, "monitored": True,
              "seasons": seasons, "originalLanguage": language(ENGLISH), "seriesType": "standard",
              "statistics": {"episodeFileCount": len(files), "episodeCount": len(files),
                             "totalEpisodeCount": sum(show["seasons"].values())},
              "added": "2026-01-01T00:00:00Z", "path": f"{root}/demo", "rootFolderPath": root,
              "tags": [], "images": [], "year": 2020, "status": "continuing", "seasonFolder": True}
    return {"series": [series], "files": files, "episodes": episodes}


def missing_episode(show):
    """The aired episode Standard lacks in the season on air, if any."""
    return show["aired"] - 1 if show["aired"] >= 3 else None


def sonarr_libraries(show):
    current, aired = show["current"], show["aired"]
    previous = [s for s in show["seasons"] if 0 < s < current]
    full = lambda season: list(range(1, show["seasons"][season] + 1))
    # Standard: every earlier season, and the season on air without its
    # second-newest episode (so one screenshot shows had, missing and upcoming).
    standard_held = {s: full(s) for s in previous}
    missing = missing_episode(show)
    standard_held[current] = [e for e in range(1, aired + 1) if e != missing]
    web = plain_format(1, "WEB-DL")
    standard = {"kind": "sonarr", "root": "/tv", "formats": [web],
                "profiles": [profile(1, "HD-1080p", [(web, 10)])]}
    standard.update(series_library(show, standard_held, "/tv", [web], [ENGLISH], 1080, 100))
    # German: the season before the current one in part, the one before that in full.
    german_held = {}
    if current - 1 in show["seasons"]:
        german_held[current - 1] = list(range(1, min(6, show["seasons"][current - 1] - 2) + 1))
    if current - 2 in show["seasons"]:
        german_held[current - 2] = full(current - 2)
    german_audio = language_format(1, "German audio", GERMAN)
    german = {"kind": "sonarr", "root": "/tv-german", "formats": [german_audio],
              "profiles": [profile(1, "German", [(german_audio, 100)])]}
    german.update(series_library(show, german_held, "/tv-german", [german_audio], [ENGLISH, GERMAN], 1080, 500))
    return standard, german


def pick_show(admin):
    fallback = None
    for tmdb_id in SHOW_CANDIDATES:
        status, tv = admin.call("GET", f"/tv/{tmdb_id}")
        if status != 200 or not tv.get("externalIds", {}).get("tvdbId"):
            continue
        seasons = {s["seasonNumber"]: s["episodeCount"] for s in tv["seasons"]
                   if s["seasonNumber"] > 0 and s["episodeCount"] > 0}
        last, upcoming = tv.get("lastEpisodeToAir"), tv.get("nextEpisodeToAir")
        show = {"tmdbId": tmdb_id, "tvdbId": tv["externalIds"]["tvdbId"], "name": tv["name"], "seasons": seasons}
        if (last and upcoming and last["seasonNumber"] == upcoming["seasonNumber"] == max(seasons)
                and last["episodeNumber"] >= 3 and len(seasons) >= 4):
            return {**show, "current": last["seasonNumber"], "aired": last["episodeNumber"]}
        if fallback is None and len(seasons) >= 4:
            latest = max(seasons)
            fallback = {**show, "current": latest, "aired": seasons[latest]}
    if fallback is None:
        sys.exit("No demo show found on TMDB.")
    print("No candidate show is on air now; the season screenshots will show no upcoming episodes.")
    return fallback


def server_body(kind, name, port, profile_id, profile_name, root, default, label=None, **extra):
    body = {"name": name, "hostname": "127.0.0.1", "port": port, "apiKey": "demo-key", "useSsl": False,
            "baseUrl": "", "activeProfileId": profile_id, "activeProfileName": profile_name,
            "activeDirectory": root, "is4k": False, "isDefault": default, "syncEnabled": True,
            "preventSearch": True, "tagRequests": False, "tags": [], "externalUrl": ""}
    if kind == "radarr":
        body["minimumAvailability"] = "released"
    else:
        body.update({"seriesType": "standard", "animeSeriesType": "anime", "enableSeasonFolders": True,
                     "activeLanguageProfileId": 1, "monitorNewItems": "all"})
    if label:
        body.update({"buttonLabel": label, "definingMatch": "all", "coverageMode": "formats"})
    body.update(extra)
    return body


def run_job(admin, job_id):
    admin.call("POST", f"/settings/jobs/{job_id}/run", expect=(200,))
    time.sleep(2)
    for _ in range(120):
        _, jobs = admin.call("GET", "/settings/jobs", expect=(200,))
        if not next(j for j in jobs if j["id"] == job_id)["running"]:
            print(f"{job_id} done")
            return
        time.sleep(2)
    sys.exit(f"{job_id} did not finish")


def date_back(request_id, days):
    when = (datetime.datetime.now(datetime.timezone.utc) - datetime.timedelta(days=days))
    stamp = when.strftime("%Y-%m-%d %H:%M:%S.%f")[:-3]
    with sqlite3.connect(DB_FILE) as db:
        db.execute("UPDATE media_request SET createdAt = ?, updatedAt = ? WHERE id = ?", (stamp, stamp, request_id))
        db.execute("UPDATE vseerr_version_request SET createdAt = ? WHERE requestId = ?", (stamp, request_id))


def main():
    admin = Session("admin@seerr.dev")
    show = pick_show(admin)
    print(f"Show: {show['name']} (TMDB {show['tmdbId']}), season {show['current']} aired to episode {show['aired']}")

    radarr_std, radarr_de, radarr_fr = radarr_libraries()
    sonarr_std, sonarr_de = sonarr_libraries(show)
    with open(DATA_FILE, "w", encoding="utf-8") as handle:
        json.dump({"7878": radarr_std, "7879": radarr_de, "7880": radarr_fr,
                   "8989": sonarr_std, "8990": sonarr_de}, handle)

    dub_option = {"id": "english-until-dub", "label": "English is fine until a German dub appears",
                  "profileId": 2, "profileName": "German or English", "onlyIfNoOtherVersion": False,
                  "animeOnly": False}
    for kind, body in [
        ("radarr", server_body("radarr", "Radarr", 7878, 1, "Best quality", "/movies", True)),
        ("radarr", server_body("radarr", "Radarr German", 7879, 1, "German", "/movies-german", False, "German",
                               definingFormats=["German audio"], requestOptions=[dub_option])),
        ("radarr", server_body("radarr", "Radarr French", 7880, 1, "French", "/movies-french", False, "French",
                               definingFormats=["French audio"])),
        ("sonarr", server_body("sonarr", "Sonarr", 8989, 1, "HD-1080p", "/tv", True)),
        ("sonarr", server_body("sonarr", "Sonarr German", 8990, 1, "German", "/tv-german", False, "German",
                               definingFormats=["German audio"])),
    ]:
        _, saved = admin.call("POST", f"/settings/{kind}", body, expect=(200, 201))
        print(f"{kind} {saved['id']}: {saved['name']}")

    _, users = admin.call("GET", "/user?take=10", expect=(200,))
    demo_id = next(u["id"] for u in users["results"] if u["email"] == "demo@seerr.dev")
    # Request (32) and advanced requests (8192), so the dialog shows the quality profile.
    admin.call("POST", f"/user/{demo_id}/settings/permissions",
               {"permissions": 32 | 8192, "requestServices": ["radarr:1", "radarr:2", "sonarr:1"]}, expect=(200,))

    # The Matrix: Standard requested by admin, German by demo.
    # Requests are dated back at the end: sending a request to Radarr saves it
    # again in the background, which would undo an earlier change.
    backdate = []
    _, standard = admin.call("POST", "/request", {"mediaType": "movie", "mediaId": MATRIX}, expect=(201,))
    backdate.append((standard["id"], 13))
    _, german = admin.call("POST", "/request", {"mediaType": "movie", "mediaId": MATRIX, "isServiceRequest": True,
                                                "serverId": 1, "userId": demo_id}, expect=(201,))
    if german.get("status") == 1:  # pending; requests made by an admin are usually approved already
        admin.call("POST", f"/request/{german['id']}/approve", expect=(200,))
    backdate.append((german["id"], 11))

    run_job(admin, "radarr-scan")
    run_job(admin, "sonarr-scan")

    # Pulp Fiction: Standard requested by admin and still downloading.
    _, pulp = admin.call("POST", "/request", {"mediaType": "movie", "mediaId": PULP_FICTION}, expect=(201,))
    backdate.append((pulp["id"], 3))
    time.sleep(5)
    for request_id, days in backdate:
        date_back(request_id, days)
    for request_id, days in backdate:
        _, request = admin.call("GET", f"/request/{request_id}", expect=(200,))
        age = datetime.datetime.now(datetime.timezone.utc) - datetime.datetime.fromisoformat(
            request["createdAt"].replace("Z", "+00:00"))
        if age.days != days:
            sys.exit(f"Request {request_id} is {age.days} days old, expected {days}")

    # What VSeerr reports now.
    failures = []
    for tmdb_id, kind in [(MATRIX, "movie"), (INCEPTION, "movie"), (show["tmdbId"], "tv")]:
        _, details = admin.call("GET", f"/{kind}/{tmdb_id}", expect=(200,))
        media_id = (details.get("mediaInfo") or {}).get("id")
        if not media_id:
            failures.append(f"{kind} {tmdb_id} has no media entry")
            continue
        _, versions = admin.call("GET", f"/media/{media_id}/versions", expect=(200,))
        for version in versions["versions"]:
            summary = version.get("summary") or {}
            print(f"{kind} {tmdb_id} {version['key']}: resolution {summary.get('resolution')},"
                  f" formats {summary.get('formats')}, languages {summary.get('languages')},"
                  f" seasons {sorted((version.get('seasonEpisodes') or {}).keys())},"
                  f" coverage {json.dumps(version.get('coverage'))[:160]}")
        if not any(v.get("summary") for v in versions["versions"]):
            failures.append(f"{kind} {tmdb_id}: no version has file details")
    if failures:
        sys.exit("\n".join(failures))

    with open(STATE_FILE, "w", encoding="utf-8") as handle:
        json.dump({"show": {**show, "missing": missing_episode(show)},
                   "movies": {"matrix": MATRIX, "inception": INCEPTION, "pulpFiction": PULP_FICTION}}, handle)
    print("Demo data ready.")


if __name__ == "__main__":
    main()
