"""Downloads English captions for any playlist episode we don't have yet into data/ep_NNN.json.

Episodes are recognised by their YouTube video id, so re-ordering the playlist never
causes a re-download or a mix-up. Private or removed videos are skipped quietly.
Exit code: 0 = fine (even if nothing new), 1 = new episodes are waiting but could not
be downloaded (YouTube blocked this computer, or no captions yet).
"""
import glob
import json
import os
import random
import re
import sys
import time
import urllib.request

import yt_dlp

PLAYLIST_URL = "https://www.youtube.com/playlist?list=PLZjoPv4SqEAXVvoHg7EueLBINTFAhkzyp"
OUTPUT_DIR = "data"
LANGS = ["en", "en-US", "en-orig"]
# Pure chanting: the automatic captions are gibberish, so they would only add noise to search.
SKIP_TITLE_WORDS = ["Recitation"]
SKIP_ERRORS = ["Private video", "Video unavailable", "This video has been removed", "members-only", "Join this channel"]
BLOCKED_ERRORS = ["confirm you", "not a bot", "HTTP Error 429", "Too Many Requests"]


class Blocked(Exception):
    """YouTube refused this computer. Retrying from here will not help."""


os.makedirs(OUTPUT_DIR, exist_ok=True)


def format_time(seconds):
    return f"{int(seconds // 60):02d}:{int(seconds % 60):02d}"


def known_episodes():
    ids, highest = set(), 0
    for path in glob.glob(os.path.join(OUTPUT_DIR, "ep_*.json")):
        highest = max(highest, int(re.search(r"ep_(\d+)", path).group(1)))
        with open(path, encoding="utf-8") as f:
            ids.add(json.load(f).get("video_id"))
    return ids, highest


def caption_url(info):
    for tracks in (info.get("subtitles") or {}, info.get("automatic_captions") or {}):  # manual first
        for lang in LANGS:
            for fmt in tracks.get(lang, []):
                if fmt.get("ext") == "json3":
                    return fmt.get("url")
    return None


def fetch_segments(video_id):
    opts = {"skip_download": True, "writesubtitles": True, "writeautomaticsub": True,
            "subtitleslangs": LANGS, "quiet": True, "no_warnings": True}
    with yt_dlp.YoutubeDL(opts) as ydl:
        info = ydl.extract_info(f"https://www.youtube.com/watch?v={video_id}", download=False)
    url = caption_url(info)
    if not url:
        return None
    req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"})
    with urllib.request.urlopen(req) as response:
        events = json.loads(response.read().decode("utf-8")).get("events", [])
    segments = []
    for ev in events:
        text = "".join(s.get("utf8", "") for s in ev.get("segs", []))
        text = re.sub(r"\[[^\]]{0,30}\]", " ", text)          # [Music], [Applause] ...
        text = re.sub(r"\s+", " ", text).strip()
        if text:
            start = int(ev.get("tStartMs", 0) // 1000)
            segments.append({"start_seconds": start, "timestamp": format_time(start), "text": text})
    return segments


def download(video_id, title, number):
    """Returns "saved", "skipped" or "failed". Raises Blocked if YouTube refuses this computer."""
    for attempt in range(1, 4):
        try:
            segments = fetch_segments(video_id)
            if not segments:
                print("  No English captions yet (YouTube can take a day or two to add them)")
                return "failed"
            path = os.path.join(OUTPUT_DIR, f"ep_{number:03d}.json")
            with open(path, "w", encoding="utf-8") as f:
                json.dump({"episode": number, "title": title, "video_id": video_id, "segments": segments},
                          f, ensure_ascii=False, indent=2)
            print(f"  Saved {path} ({len(segments)} lines)")
            return "saved"
        except Exception as e:  # noqa: BLE001
            msg = str(e)
            if any(k in msg for k in SKIP_ERRORS):
                print("  Skipped: the video is private or unavailable.")
                return "skipped"
            if any(k in msg for k in BLOCKED_ERRORS):
                if attempt == 3:
                    raise Blocked(msg) from e
                print(f"  YouTube is limiting requests (attempt {attempt}/3). Waiting 60s.")
                time.sleep(60)
                continue
            print(f"  Attempt {attempt}/3 failed: {msg[:200]}. Waiting 5s.")
            time.sleep(5)
    return "failed"


def main():
    known, highest = known_episodes()
    print(f"Have {len(known)} episodes. Checking the playlist...")
    with yt_dlp.YoutubeDL({"extract_flat": "in_playlist", "quiet": True, "no_warnings": True}) as ydl:
        entries = ydl.extract_info(PLAYLIST_URL, download=False).get("entries", [])
    new = [e for e in entries
           if e.get("id") and e["id"] not in known and e.get("title") not in ("[Private video]", "[Deleted video]")]
    print(f"Playlist has {len(entries)} videos, {len(new)} new.")

    saved, failed, waiting = 0, [], []
    for i, entry in enumerate(new):
        title = entry.get("title") or entry["id"]
        if any(w.lower() in title.lower() for w in SKIP_TITLE_WORDS):
            print(f"Skipping (chanting only): {title}")
            continue
        print(f"New: {title}")
        try:
            result = download(entry["id"], title, highest + 1)
        except Blocked:
            waiting = [e.get("title") or e["id"] for e in new[i:]
                       if not any(w.lower() in (e.get("title") or "").lower() for w in SKIP_TITLE_WORDS)]
            break
        if result == "saved":
            highest += 1
            saved += 1
            time.sleep(random.uniform(3.0, 7.0))
        elif result == "failed":
            failed.append(title)

    print(f"\nDone. {saved} new episode(s) saved.")
    if waiting:
        print(f"\nYouTube blocked this computer, so {len(waiting)} new episode(s) are waiting:")
        for t in waiting:
            print(f"  - {t}")
        print("Double-click update.bat on your own PC to download them.")
    if failed:
        print("Could not download (will retry next time): " + "; ".join(failed))
    if waiting or failed:
        sys.exit(1)


if __name__ == "__main__":
    main()
