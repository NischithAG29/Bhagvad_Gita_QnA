@echo off
rem Double-click to fetch new episodes and publish them. Needs Python and Git installed.
cd /d "%~dp0"
git pull
python -m pip install --upgrade --quiet yt-dlp
python ingest.py
git add data
git diff --cached --quiet && (echo Nothing new to publish.) || (git commit -m "Add new episode transcripts" && git push && echo Published. The site updates in about a minute.)
pause
