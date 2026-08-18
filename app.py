import os
import json
import sqlite3
import streamlit as st
from google import genai
from google.genai import types

st.set_page_config(page_title="Bhagavad Gita AI Navigator", page_icon="🕉️", layout="wide")

# Read API Key from Streamlit Secrets or OS Environment
api_key = st.secrets.get("GEMINI_API_KEY") or os.environ.get("GEMINI_API_KEY")

if not api_key:
    st.error("⚠️ GEMINI_API_KEY is not set. Please add it to `.streamlit/secrets.toml` or set it as an environment variable.")
    st.stop()

# Initialize Gemini Client with explicit API key
client = genai.Client(api_key=api_key)

DB_FILE = "gita_search.db"

def query_transcripts(search_query: str) -> str:
    """Searches 128 episodes for concepts, keywords, Sanskrit terms, and verse references."""
    if not os.path.exists(DB_FILE):
        return json.dumps([{"error": "Database not indexed. Run build_index.py first."}])

    conn = sqlite3.connect(DB_FILE)
    cursor = conn.cursor()

    clean_query = "".join([c if c.isalnum() or c.isspace() else " " for c in search_query]).strip()
    words = clean_query.split()
    if not words:
        conn.close()
        return "[]"
    
    fts_query = " OR ".join(words)

    cursor.execute("""
        SELECT episode_title, video_id, timestamp, seconds, content, rank
        FROM transcript_fts
        WHERE transcript_fts MATCH ?
        ORDER BY rank
        LIMIT 6
    """, (fts_query,))

    rows = cursor.fetchall()
    conn.close()

    results = []
    for r in rows:
        results.append({
            "episode": r[0],
            "timestamp": r[2],
            "text": r[4],
            "url": f"https://www.youtube.com/watch?v={r[1]}&t={r[3]}s"
        })
    return json.dumps(results)

def ask_agent(user_question: str):
    chat = client.chats.create(
        model="gemini-flash-lite-latest",
        config=types.GenerateContentConfig(
            temperature=0.2,
            system_instruction=(
                "You are a Bhagavad Gita research assistant analyzing Swami Anish Chaitanya's podcast series. "
                "Use the query_transcripts tool to find relevant segments. "
                "Synthesize a clear, philosophically grounded answer based on the transcripts. "
                "ALWAYS cite the episodes with clickable links at the end: "
                "\n\n**Sources:**\n* [Episode Title @ MM:SS](https://www.youtube.com/watch?v=VIDEO_ID&t=SSs)"
            ),
            tools=[query_transcripts]
        )
    )

    response = chat.send_message(user_question)

    while response.function_calls:
        for call in response.function_calls:
            if call.name == "query_transcripts":
                tool_output = query_transcripts(**call.args)
                response = chat.send_message(
                    types.Part.from_function_response(
                        name=call.name,
                        response={"result": tool_output}
                    )
                )
    return response.text

# Streamlit UI
st.title("🕉️ Bhagavad Gita AI Navigator")
st.caption("Direct answers across 128 episodes with timestamp citations.")

if "messages" not in st.session_state:
    st.session_state.messages = []

for msg in st.session_state.messages:
    with st.chat_message(msg["role"]):
        st.markdown(msg["content"])

if prompt := st.chat_input("Ask about any verse, term, or concept (e.g., 'What is Nishkama Karma in Chapter 2?')..."):
    st.session_state.messages.append({"role": "user", "content": prompt})
    with st.chat_message("user"):
        st.markdown(prompt)

    with st.chat_message("assistant"):
        with st.spinner("Finding insights from transcripts..."):
            try:
                answer = ask_agent(prompt)
                st.markdown(answer)
                st.session_state.messages.append({"role": "assistant", "content": answer})
            except Exception as e:
                st.error(f"Error: {str(e)}")