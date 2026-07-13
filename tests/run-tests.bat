@echo off
python -m unittest discover -s "%~dp0" -p "test_*.py" -v
