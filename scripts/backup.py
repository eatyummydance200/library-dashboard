"""Consistent local SQLite backup; safe with active WAL writes."""
import os
import sqlite3
from datetime import datetime, timedelta, timezone
from pathlib import Path

data = Path(os.environ.get('DATABASE', '/app/data/library.sqlite3'))
destination = data.parent / 'backups'
destination.mkdir(mode=0o700, exist_ok=True)
target = destination / ('library-' + datetime.now(timezone.utc).strftime('%Y%m%d-%H%M%S') + '.sqlite3')
with sqlite3.connect(f'file:{data}?mode=ro', uri=True) as source:
    with sqlite3.connect(target) as backup:
        source.backup(backup)
target.chmod(0o600)
cutoff = datetime.now(timezone.utc) - timedelta(days=7)
for old in destination.glob('library-*.sqlite3'):
    if datetime.fromtimestamp(old.stat().st_mtime, timezone.utc) < cutoff:
        old.unlink()
print('Database snapshot completed.')
