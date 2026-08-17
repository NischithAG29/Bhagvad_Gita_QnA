import os
import json
import yt_dlp
import time
import random

PLAYLIST_URL = "https://www.youtube.com/playlist?list=PLZjoPv4SqEAXVvoHg7EueLBINTFAhkzyp"
OUTPUT_DIR = "data"
os.makedirs(OUTPUT_DIR, exist_ok=True)

def format_time(seconds):
    return f"{int(seconds // 60):02d}:{int(seconds % 60):02d}"

def extract_episode(video_info, idx):
    v_id = video_info.get("id")
    title = video_info.get("title", f"Episode_{idx}")
    
    if not v_id or title in ["[Private video]", "[Deleted video]"]:
        return False

    filename = f"{OUTPUT_DIR}/ep_{idx:03d}.json"
    if os.path.exists(filename):
        print(f"[{idx}] ⏭️ Already exists: {title}")
        return True

    print(f"[{idx}] Fetching: {title}...")

    ydl_opts = {
        'skip_download': True,
        'writesubtitles': True,
        'writeautomaticsub': True,
        'subtitleslangs': ['en', 'en-US', 'en-orig'],
        'quiet': True,
        'no_warnings': True,
    }

    # Try up to 3 times per episode if YouTube blocks us
    for attempt in range(1, 4):
        try:
            with yt_dlp.YoutubeDL(ydl_opts) as ydl:
                info = ydl.extract_info(f"https://www.youtube.com/watch?v={v_id}", download=False)
                
                subs = info.get('subtitles', {})
                auto_subs = info.get('automatic_captions', {})
                
                sub_url = None
                for lang in ['en', 'en-US', 'en-orig']:
                    if lang in subs:
                        for fmt in subs[lang]:
                            if fmt.get('ext') == 'json3':
                                sub_url = fmt.get('url')
                                break
                        if sub_url: break

                if not sub_url:
                    for lang in ['en', 'en-US', 'en-orig']:
                        if lang in auto_subs:
                            for fmt in auto_subs[lang]:
                                if fmt.get('ext') == 'json3':
                                    sub_url = fmt.get('url')
                                    break
                            if sub_url: break

                if not sub_url:
                    print(f"  ⚠️ No English transcript track found for: {title}")
                    return False

                import urllib.request
                req = urllib.request.Request(sub_url, headers={'User-Agent': 'Mozilla/5.0'})
                with urllib.request.urlopen(req) as response:
                    caption_json = json.loads(response.read().decode('utf-8'))

                segments = []
                for ev in caption_json.get('events', []):
                    start_ms = ev.get('tStartMs', 0)
                    start_sec = int(start_ms // 1000)
                    segs = ev.get('segs', [])
                    line_text = "".join([s.get('utf8', '') for s in segs]).replace('\n', ' ').strip()
                    
                    if line_text and not (line_text.startswith('[') and line_text.endswith(']')):
                        segments.append({
                            "start_seconds": start_sec,
                            "timestamp": format_time(start_sec),
                            "text": line_text
                        })

                if not segments:
                    print(f"  ⚠️ Transcript was empty for: {title}")
                    return False

                ep_data = {
                    "episode": idx,
                    "title": title,
                    "video_id": v_id,
                    "segments": segments
                }

                with open(filename, "w", encoding="utf-8") as f:
                    json.dump(ep_data, f, ensure_ascii=False, indent=2)

                print(f"  ✓ Saved Episode {idx} ({len(segments)} lines)")
                return True

        except Exception as e:
            error_msg = str(e)
            if "429" in error_msg or "Too Many Requests" in error_msg:
                # If YouTube rate limits us, wait 60 seconds before trying again
                print(f"  ⚠️ YouTube Rate Limit Hit (429). Taking a 60-second cooldown... (Attempt {attempt}/3)")
                time.sleep(60)
            else:
                print(f"  ✗ Error on {title}: {error_msg}")
                time.sleep(5) # Small pause for random network drops
                
    print(f"  ❌ Failed to download {title} after 3 attempts.")
    return False

def main():
    print("Connecting to YouTube Playlist...")
    ydl_opts = {'extract_flat': 'in_playlist', 'quiet': True, 'no_warnings': True}
    
    with yt_dlp.YoutubeDL(ydl_opts) as ydl:
        result = ydl.extract_info(PLAYLIST_URL, download=False)
        entries = result.get('entries', [])
        
    print(f"Found {len(entries)} episodes. Starting extraction...\n")

    saved_count = 0
    for idx, entry in enumerate(entries, 1):
        if extract_episode(entry, idx):
            saved_count += 1
            # Add a random human-like delay between 3 and 7 seconds after every successful download
            delay = random.uniform(3.0, 7.0)
            time.sleep(delay)

    print(f"\n🎉 Finished! Total {saved_count} episodes processed into '{OUTPUT_DIR}/'.")

if __name__ == "__main__":
    main()