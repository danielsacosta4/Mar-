# Maré

A web client for [Navidrome](https://www.navidrome.org) with an Apple Music–style look and Spotify-style discovery
from [ListenBrainz](https://listenbrainz.org): Made for You playlists, endless radio, synced lyrics, gapless playback
and crossfade, hi-res badges, playlist editing and offline downloads.

## Install or update (Proxmox VE)

Run on the Proxmox host shell. The first run creates a small Debian container with everything Maré needs;
later runs find that container and update it.

```bash
bash -c "$(curl -fsSL https://raw.githubusercontent.com/danielsacosta4/Mar-/main/mare.sh)"
```

You'll be asked for Navidrome's address. Then point your reverse proxy at the container's IP on port 80
and sign in with your Navidrome account.

## Development

The app lives in `app/` (plain HTML/CSS/JS). `build/build.sh <version>` packs it into `mare.sh`.
`test/run.sh` runs the browser tests against a mock server. See `CLAUDE.md` for the full guide.
