# VSeerr

**VSeerr is a fork of [Seerr](https://github.com/seerr-team/seerr) that adds versions: the same movie or show can be requested more than once, for example in another language or quality.**

> [!WARNING]
> **VSeerr is vibe coded.** Its changes are written with AI coding agents. AI-assisted contributions are welcome.

> [!NOTE]
> **Work in progress.** This repository currently holds an unmodified Seerr release plus the fork setup. Versions are not implemented yet, and there are no releases or images. For production use, run [Seerr](https://github.com/seerr-team/seerr).

## What it adds

Seerr tracks each title once: a movie or show is either requested or it is not. The only exception is a separate 4K server. Radarr and Sonarr also keep one copy of each title per instance. So if one person wants a film in the original language and another wants it dubbed in German, the second request is blocked.

VSeerr adds versions:

- An administrator connects several Radarr or Sonarr instances and gives each one a version name and a default quality profile, for example "German", "Best quality" or "Kids".
- When requesting, a user first picks a version, then any quality profile of that instance.
- Each version tracks its own requests and availability, so a title can exist once per version.
- Administrators choose which users can request which versions.

Language, quality cutoffs and file sizes are set in Radarr and Sonarr, not in VSeerr. A "German" version is a Radarr instance whose profiles prefer German audio. Its profiles can still differ, for example one with a 720p cutoff and one with a 1080p cutoff.

In Plex, add each version's media folder to the same library. Plex then shows the title once and lets viewers pick the version when playing.

Everything else is Seerr as released upstream.

## How it relates to Seerr

- **Built on Seerr releases.** Each new Seerr release is merged in. A scheduled check tests every new release against VSeerr and opens an issue with the result.
- **Small, separate changes.** Version code lives in new files where possible, with only small hooks into existing Seerr code. This keeps upstream merges simple.
- **Not sent upstream.** Seerr does not accept AI-driven contributions, and VSeerr respects that. Code from this repository is not proposed to Seerr.
- **Seerr's documentation applies.** Setup, configuration and troubleshooting follow the [Seerr documentation](https://docs.seerr.dev). VSeerr documents only what it adds.

If Seerr adds this feature itself, VSeerr will point users back to Seerr.

## Why not SeerrNG

[SeerrNG](https://github.com/snapetech-org/seerrng) already supports requests across multiple Radarr and Sonarr instances, and it is a good option if you want its features. It is a broad fork that adds music, books, comics, magazines, games, ROMs and software, along with many other changes.

VSeerr goes the other way. It changes as little as possible, so it can follow every Seerr release closely. If you only need versions, VSeerr stays close to Seerr. If you want more media types, use SeerrNG.

## Contributing

See [CONTRIBUTING.md](../CONTRIBUTING.md). In short: changes are limited to versions and to keeping VSeerr in step with Seerr. To report a vulnerability, see [SECURITY.md](../SECURITY.md).

## License and credits

VSeerr is distributed under the MIT license, the same as Seerr. All credit for Seerr goes to its authors and contributors, and before them Overseerr and Jellyseerr. See [LICENSE](../LICENSE) and [NOTICE.md](../NOTICE.md).

VSeerr is not affiliated with or endorsed by the Seerr team.
