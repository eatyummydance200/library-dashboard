"""Local browser QA only; production runs from Server Desk."""
import os
from pathlib import Path

root = Path(__file__).resolve().parent.parent
settings = dict(line.split('=', 1) for line in (root / '.runtime.env').read_text().splitlines()
                if line and not line.startswith('#'))
os.environ.update(settings)
os.environ['DATABASE'] = str(root / 'data' / 'local.sqlite3')
os.environ['COOKIE_SECURE'] = 'false'
os.chdir(root)
os.execv(str(root / '.venv/bin/gunicorn'), ['gunicorn', '--bind', '127.0.0.1:8091',
          '--workers', '1', '--threads', '2', 'app:create_app()'])
