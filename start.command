#!/bin/bash
# MapMaker launcher for macOS / Linux.
# macOS: double-click this file in Finder (first time may need: chmod +x start.command).
# Linux: run  bash start.command
cd "$(dirname "$0")"
if command -v python3 >/dev/null 2>&1; then
  exec python3 src/server.py
else
  exec python src/server.py
fi
