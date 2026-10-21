"""Local browser QA only; production runs from Server Desk."""
import os
import subprocess
from pathlib import Path

root = Path(__file__).resolve().parent.parent
subprocess.run(['python3', str(root / 'scripts/fetch-font.py')], check=True)
subprocess.run(['mvn', '-B', '-q', '-DskipTests', 'package'], cwd=root, check=True)
settings = dict(line.split('=', 1) for line in (root / '.runtime.env').read_text().splitlines()
                if line and not line.startswith('#'))
os.environ.update(settings)
os.environ['DATABASE'] = str(root / 'data' / 'local.sqlite3')
os.environ['COOKIE_SECURE'] = 'false'
os.chdir(root)
os.environ['PORT'] = '8091'
os.environ['SERVER_ADDRESS'] = '127.0.0.1'
os.execvp('java', ['java', '-Xms32m', '-Xmx256m', '-jar', str(root / 'target/app.jar')])
