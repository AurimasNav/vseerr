# VSeerr

**VSeerr is a fork of [Seerr](https://github.com/seerr-team/seerr) that adds versions: the same movie or show can be requested more than once, for example in another language or quality.**

> [!WARNING]
> **VSeerr is vibe coded.** Its changes are written with AI coding agents. AI-assisted contributions are welcome.

> [!NOTE]
> **Early stage.** VSeerr is young and has few users so far. It is provided as is, without warranty of any kind (see [LICENSE](../LICENSE)). Back up before you switch, as described in [Switching between Seerr and VSeerr](../vseerr-docs/switching.md).

## What it adds

Seerr tracks each title once: a movie or show is either requested or it is not. The only exception is a separate 4K server. Radarr and Sonarr also keep one copy of each title per instance. So if one person wants a film in the original language and another wants it dubbed in German, the second request is blocked.

VSeerr adds versions:

- An administrator connects several Radarr or Sonarr instances and gives each one a version name and a default quality profile, for example "German", "Best quality" or "Kids".
- When requesting, a user picks the version in the request dialog, then any quality profile of that instance. A version can be set as the default on each device.
- Each version tracks its own requests and availability, so a title can exist once per version.
- Administrators choose which users can request which versions. Each user requests one version of a title; users with the Manage Requests permission can request several.
- A version can offer extra request options, each tied to one of its quality profiles. For example, a German version can offer "English is fine until a German dub appears". Ticking an option selects its profile in the request dialog's Advanced section; picking another profile there afterwards overrides it.
- The standard server can offer request options too. An option marked "Anime only" is offered only for titles with TMDB's anime keyword. For example, "English dub required" can switch an anime request from a subs-friendly profile to a dub-only one.
- Request notifications name the version, for example "Movie Request Approved in German". Standard requests say "in Standard". When a request uses a quality profile other than the server's default, for example through a request option, the profile is added: "in German (German or English)", "in Standard (Anime dub-only)".
- The title page shows, for every user, what each version's files contain: resolution, matched custom formats and audio languages.
- A version can define the custom formats that make a file count as it, for example "German audio". When another version's file has them, the version shows as available through that one, and only users with Manage Requests can request it. While a request in another version is less than a day old, the same applies, in case that download covers it. For shows this works per season.

Language, quality cutoffs and file sizes are set in Radarr and Sonarr, not in VSeerr. A "German" version is a Radarr instance whose profiles prefer German audio. Its profiles can still differ, for example one with a 720p cutoff and one with a 1080p cutoff.

In Plex, add each version's media folder to the same library. Plex then shows the title once and lets viewers pick the version when playing.

Everything else is Seerr as released upstream.

## Screenshots

The screenshots use demo data: a standard Radarr plus "German" and "French" versions.

**Requesting.** The user picks a version, ticks any of its request options, and can choose another quality profile of that instance.

<img src="../vseerr-docs/images/request-dialog.png" alt="Request dialog with Standard, German and French versions, the German option 'English is fine until a German dub appears' and the quality profile" width="600">

**What each version has.** The title page lists every version with what its files contain. Here The Matrix exists in Standard (2160p Remux with Atmos and Dolby Vision) and in German (1080p with German audio).

<img src="../vseerr-docs/images/versions-panel.png" alt="Versions panel: Standard with 2160p, Atmos, Dolby Vision, Remux and English; German with 1080p, German audio, English and German; French not requested" width="320">

**Covered by another version.** Inception's Standard file already has German audio, which is a defining format of the German version. German therefore shows as available through Standard, and only users with Manage Requests can request it separately.

<img src="../vseerr-docs/images/versions-coverage.png" alt="Versions panel: Standard with 1080p, English and German audio; German not requested, available through Standard" width="320">

**Settings.** In Settings → Services, each Radarr or Sonarr server gets a version name, its defining formats and its request options.

<img src="../vseerr-docs/images/admin-version-settings.png" alt="Server settings: version name German, defining format German audio, and the request option 'English is fine until a German dub appears' tied to the German or English profile" width="600">

## Installing

Images are published to the GitHub Container Registry as `ghcr.io/aurimasnav/vseerr`, tagged `<Seerr version>-vseerr.<build>`, for example `3.5.1-vseerr.18`. The `main` tag follows the latest build. Images are built for amd64 only.

VSeerr is set up like Seerr: use the same container settings, volumes and environment variables, with the VSeerr image in place of Seerr's.

## Switching from and back to Seerr

VSeerr and Seerr can share one database. VSeerr keeps its data in tables of its own, so you can switch to VSeerr and back without exporting anything. Before going back to Seerr, run one command to set version requests aside; VSeerr restores them when it starts again. See [Switching between Seerr and VSeerr](../vseerr-docs/switching.md).

## How it relates to Seerr

- **Built on Seerr releases.** Each new Seerr release is merged in. A scheduled check tests every new release against VSeerr and opens an issue with the result.
- **Small, separate changes.** Version code lives in new files where possible, with only small hooks into existing Seerr code. This keeps upstream merges simple.
- **Not sent upstream.** Seerr does not accept AI-driven contributions, and VSeerr respects that. Code from this repository is not proposed to Seerr.
- **Seerr's documentation applies.** Setup, configuration and troubleshooting follow the [Seerr documentation](https://docs.seerr.dev). VSeerr documents only what it adds.

Versions are VSeerr's main focus and will keep being developed here, even if Seerr adds something similar.

## Why not SeerrNG

[SeerrNG](https://github.com/snapetech-org/seerrng) already supports requests across multiple Radarr and Sonarr instances, and it is a good option if you want its features. It is a broad fork that adds music, books, comics, magazines, games, ROMs and software, along with many other changes.

VSeerr goes the other way. Outside of versions it changes as little as possible, so it can follow every Seerr release closely. If you only need versions, VSeerr stays close to Seerr. If you want more media types, use SeerrNG.

## Contributing

See [CONTRIBUTING.md](../CONTRIBUTING.md). In short: changes are limited to versions and to keeping VSeerr in step with Seerr. To report a vulnerability, see [SECURITY.md](../SECURITY.md).

## License and credits

VSeerr is distributed under the MIT license, the same as Seerr. All credit for Seerr goes to its authors and contributors, and before them Overseerr and Jellyseerr. See [LICENSE](../LICENSE) and [NOTICE.md](../NOTICE.md).

VSeerr is not affiliated with or endorsed by the Seerr team.
