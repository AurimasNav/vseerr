# Requests in Seerr, Overseerr and Ombi that versions cover

People have asked Seerr, Overseerr and Ombi, in several issues, for things that VSeerr's versions do. They are collected here so anyone searching for one of these problems can find a working option. Each entry links the original issue and says what VSeerr does for it. Seerr's issues include those filed while it was called Jellyseerr.

Taken one at a time, most of these look like edge cases: a 3D library, a remux library, a dubbed copy for children, a second language for one family member. Each was filed as its own feature request, and on its own each serves only a few setups. They are the same underlying need, though: more than one copy of a title, each from its own Radarr or Sonarr instance. Versions meet that need once, so one feature covers all of these setups, and others like them that nobody has filed yet.

A version is a Radarr or Sonarr instance with a name of its own, for example "German", "3D" or "Remux". It sits next to Seerr's Standard and 4K requests. Users pick the version in the request dialog, and each version keeps its own requests and availability. By default each user requests one version of a title, and a new request holds the other versions for 24 hours in case its download covers them; both can be changed in **Settings → Users**. See [What it adds](../.github/README.md#what-it-adds) for the details.

VSeerr is based on Seerr, so Ombi users would be moving to a different app. VSeerr has only been run with Plex. With Jellyfin or Emby it is untested.

Last checked on 4 November 2026. Overseerr's repository is archived, so its issues are read-only.

## The same title in another language

- **[Extend multiple request profiles beyond Standard/4K (per-language and per-quality profile support)](https://github.com/seerr-team/seerr/issues/1737)** (Seerr), also filed as [Overseerr #4161](https://github.com/sct/overseerr/issues/4161). Each of the Radarr and Sonarr instances described there (Italian, Italian 4K, Anime Sub ITA, English and so on) can be a version, and a title can be requested once in each.
- **[More Radarr/Sonarr instances](https://github.com/seerr-team/seerr/issues/1334)** (Seerr). An English and an other-language Radarr become two versions, chosen in the request dialog instead of extra buttons.
- **[Allow more requests for media if any Sonarr/Radarr instance doesn't have the media](https://github.com/seerr-team/seerr/issues/874)** (Seerr). Localized and original-language anime instances become two versions; a title already in one can still be requested in the other.
- **[Request not by TMDB but by TMDB - PROFILE](https://github.com/seerr-team/seerr/issues/2178)** (Seerr). With one Radarr/Sonarr instance per language (Ukrainian, Spanish, English), each family member requests their language as a version, and each title is downloaded once per version.
- **[Feature for addiontal Radarr/Sonarr like 4K but for English requests](https://github.com/sct/overseerr/issues/3256)** (Overseerr). The English instances become an "English" version next to German Standard and German 4K.
- **[Custom names for Radarr and Sonarr Servers](https://github.com/sct/overseerr/issues/1997)** (Overseerr). Instead of using the 4K slot for English, the English instance becomes a version named "English", and the dialog shows that name.
- **[Allow request for all servers](https://github.com/sct/overseerr/issues/3109)** (Overseerr). An English and a Swedish Radarr become two versions; a title in one stays requestable in the other.
- **[Allow to change the default server for each user to allow multiple languages](https://github.com/sct/overseerr/issues/3730)** (Overseerr). Each user can set a default version, which is saved with their account.
- **[Add an extra mark for Dubbed versions](https://github.com/sct/overseerr/issues/2281)** (Overseerr). A "Dubbed" version gets its own request choice and status, even when the original is already available.
- **[More than 4k and non-4k requests (a request for every instance of sonarr/radarr)](https://github.com/sct/overseerr/issues/3522)** and **[Handling of multiple Radarr/Sonarr instances (profiles/paths)](https://github.com/sct/overseerr/issues/3615)** (Overseerr). Users pick a version by name and then a quality profile; they don't need to know which instance or path is behind it.

## 3D, remux and other quality tiers

- **[request 3D Version of movie.](https://github.com/seerr-team/seerr/issues/1158)** and **[3D Movie support](https://github.com/seerr-team/seerr/issues/2234)** (Seerr), **[Add a 3D Radarr Server option.](https://github.com/sct/overseerr/issues/4030)** (Overseerr) and **[[FEATURE] 3D movie requests](https://github.com/Ombi-app/Ombi/issues/565)** (Ombi). The 3D Radarr, with its own library, becomes a version named "3D", and the 4K slot stays free for 4K.
- **[Support arbitrary quality tiers rather than 4k and non 4k](https://github.com/seerr-team/seerr/issues/971)** (Seerr). The remux Radarr becomes a "Remux" version. Its availability comes from that Radarr instance, not from the resolution of the copy in the media server, so a 4K regular copy doesn't block a remux request. Administrators choose which users can request each version.
- **[Request: Support multiple Radarr/Sonarr](https://github.com/Ombi-app/Ombi/issues/2335)** (Ombi). Separate 4K, 1080p and 720p instances each become a version that users request by name. With **One Version per Title** turned off, a user can also request a title in both the French and the original-language instance described in the comments.

## Availability and what each copy contains

- **[Overseerr marks a request as "Available" even when the item is found by a different Sonarr/Radarr server than the one set as default or requested](https://github.com/sct/overseerr/issues/4160)** (Overseerr). Each version's availability comes from its own Radarr or Sonarr instance, so a copy on another instance doesn't complete a version request.
- **[See what profile/language a request was made with](https://github.com/sct/overseerr/issues/2757)** (Overseerr). Request notifications name the version and, when it isn't the server's default, the quality profile. The title page shows who requested each version.
- **[Show language info on available items](https://github.com/sct/overseerr/issues/3637)** (Overseerr). The title page shows every user what each version's files contain: resolution, matched custom formats and audio languages.

## Not covered

Some related requests are outside what versions do, for example sending one request to several instances at once, routing anime or kids titles to an instance automatically, or several media servers. VSeerr keeps Seerr's behaviour for those.
