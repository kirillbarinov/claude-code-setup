# youtube-search

Search YouTube videos using yt-dlp and display structured results.

## Usage

```
/youtube-search <query> [--limit N]
```

- `query` — search terms (required)
- `--limit N` — number of results (default: 10)

## What it shows

For each video:
- Title
- Views (formatted as K/M/B)
- Channel name
- Duration
- URL

## Examples

```
/youtube-search "rust programming tutorial"
/youtube-search "lo-fi beats" --limit 5
/youtube-search "claude ai demo" --limit 20
```

## Requirements

- `yt-dlp` must be installed (`pip install yt-dlp`)
- Newer binary at `~/opt/anaconda3/bin/yt-dlp-new` is preferred (bypasses YouTube bot detection via `--flat-playlist`)

## Trigger

When the user asks to search YouTube, find YouTube videos, or uses `/youtube-search`, run:

```bash
~/.claude/skills/youtube-search/run.sh "<QUERY>" [--limit N]
```

Replace `<QUERY>` with the user's search terms (quoted). Print the output directly to the user.
