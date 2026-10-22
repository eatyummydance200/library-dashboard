"""Register this service with Server Desk and deploy without exposing credentials."""
import argparse
import http.cookiejar
import json
import subprocess
import time
import urllib.parse
import urllib.request
from pathlib import Path

root = Path(__file__).resolve().parent.parent
parser = argparse.ArgumentParser()
parser.add_argument('mode', choices=['bootstrap', 'deploy'])
parser.add_argument('--local-image', default='library-dashboard:0.1.0')
parser.add_argument('--server-desk-env', type=Path, default=root.parent / 'server-desk/.env')
args = parser.parse_args()


def env_file(path):
    return dict(line.split('=', 1) for line in path.read_text().splitlines() if line and not line.startswith('#'))


settings = env_file(root / '.runtime.env')
admin = env_file(args.server_desk_env)
host = 'https://eatyummydance200.tail72d30b.ts.net'
client = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(http.cookiejar.CookieJar()))


def request(path, data=None, method=None, headers=None):
    with client.open(urllib.request.Request(host + '/api' + path, data=data, method=method, headers=headers or {}), timeout=30) as response:
        body = response.read()
        return json.loads(body) if body else None


csrf = request('/csrf')
request('/login', urllib.parse.urlencode({'username': admin['ADMIN_USER'], 'password': admin['ADMIN_PASSWORD']}).encode(),
        headers={csrf['header']: csrf['token']})
csrf = request('/csrf')


def write(path, data):
    return request(path, json.dumps(data).encode(), 'POST',
                   {csrf['header']: csrf['token'], 'Content-Type': 'application/json'})


try:
    entries = request('/apps')
    match = next((a for a in entries if a['config']['name'] == 'library-dashboard'), None)
    if match:
        assert match['config']['hostPort'] == 8090 and match['config']['containerPort'] == 8000, 'Existing registration differs; inspect before changing it'
        assert match['config']['healthPath'] == '/library-dashboard/healthz' and match['config']['url'] == host + '/library-dashboard/', 'Existing registration uses a different path; update Server Desk healthPath, url and APP_BASE_PATH before deploying'
        app_id = match['id']
    else:
        spec = {
            'name': 'library-dashboard', 'image': 'ghcr.io/eatyummydance200/library-dashboard:main',
            'hostPort': 8090, 'containerPort': 8000, 'bindAddress': '127.0.0.1',
            'healthPath': '/library-dashboard/healthz', 'url': host + '/library-dashboard/',
            'github': 'https://github.com/eatyummydance200/library-dashboard',
            'env': settings, 'volumes': [{'name': 'data', 'target': '/app/data'}],
        }
        app_id = write('/apps', spec)['id']
    state = {'app_id': app_id}
    if args.mode == 'bootstrap':
        command = ['sudo', '-n', 'docker']
        existing = subprocess.check_output(command + ['ps', '-aq', '--filter', 'name=^/sd-library-dashboard$'], text=True).strip()
        if existing:
            owner = subprocess.check_output(command + ['inspect', '--format', '{{index .Config.Labels "serverdesk.app"}}', existing], text=True).strip()
            assert owner == app_id, 'Existing container belongs to another app; not modifying it'
        else:
            subprocess.run(command + ['run', '-d', '--name', 'sd-library-dashboard', '--label', 'serverdesk.app=' + app_id,
                '--restart', 'unless-stopped', '--log-opt', 'max-size=10m', '--log-opt', 'max-file=3',
                '--publish', '127.0.0.1:8090:8000', '--mount', 'type=volume,source=sd-library-dashboard-data,target=/app/data',
                '--env-file', str(root / '.runtime.env'), args.local_image], check=True, stdout=subprocess.DEVNULL)
        state['bootstrap_image'] = args.local_image
        print('Local image started; Server Desk registration:', app_id)
    else:
        deployment = write('/apps/' + app_id + '/deploy', {})['id']
        state['deployment_id'] = deployment
        print('Server Desk deployment started:', deployment)
        for _ in range(150):
            runs = request('/apps/' + app_id + '/deployments')
            result = next(r for r in runs if r['id'] == deployment)
            if result['status'] != 'RUNNING':
                print('Deployment result:', result['status'])
                if result['status'] != 'SUCCESS':
                    raise RuntimeError('Deployment did not succeed; inspect Server Desk deployment records')
                break
            time.sleep(2)
        else:
            raise RuntimeError('Deployment still running; inspect Server Desk before retrying')
    (root / '.deployment-state.json').write_text(json.dumps(state, indent=2))
finally:
    request('/logout', b'', 'POST', {csrf['header']: csrf['token']})
