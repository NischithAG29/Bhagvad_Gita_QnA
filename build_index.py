import os
import json
import sqlite3

DATA_DIR = "data"
DB_FILE = "gita_search.db"

def build_index():
    print("Building instant search index...")
    if os.path.exists(DB_FILE):
        os.remove(DB_FILE)

    conn = sqlite3.connect(DB_FILE)
    cursor = conn.cursor()

    cursor.execute("""
        CREATE VIRTUAL TABLE IF NOT EXISTS transcript_fts USING fts5(
            episode_title,
            video_id,
            timestamp,
            seconds UNINDEXED,
            content
        );
    """)

    files = [f for f in os.listdir(DATA_DIR) if f.endswith(".json")]
    total_blocks = 0

    for fname in files:
        with open(os.path.join(DATA_DIR, fname), "r", encoding="utf-8") as f:
            ep = json.load(f)

        segments = ep.get("segments", [])
        title = ep.get("title", "")
        v_id = ep.get("video_id", "")

        for j in range(0, len(segments), 6):
            chunk = segments[j:j+6]
            if not chunk:
                continue

            text_block = " ".join([s["text"] for s in chunk])
            start_sec = chunk[0]["start_seconds"]
            timestamp = chunk[0]["timestamp"]

            cursor.execute(
                "INSERT INTO transcript_fts (episode_title, video_id, timestamp, seconds, content) VALUES (?, ?, ?, ?, ?)",
                (title, v_id, timestamp, start_sec, text_block)
            )
            total_blocks += 1

    conn.commit()
    conn.close()
    print(f"Done! Indexed {len(files)} episodes ({total_blocks} blocks) in '{DB_FILE}'.")

if __name__ == "__main__":
    build_index()