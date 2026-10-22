"""Run the existing API contract tests against a real Spring Boot HTTP process."""
import atexit
import contextlib
import http.cookiejar
import json as jsonlib
import os
import socket
import sqlite3
import subprocess
import tempfile
import time
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path
from zoneinfo import ZoneInfo

KOREA = ZoneInfo('Asia/Seoul')
ROOT = Path(__file__).resolve().parent.parent
APPS = []


def stop_apps():
    for app in APPS:
        app.process.terminate()
    for app in APPS:
        try:
            app.process.wait(timeout=10)
        except subprocess.TimeoutExpired:
            app.process.kill()
            app.process.wait()
        app.log.close()
    APPS.clear()


atexit.register(stop_apps)


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, *args, **kwargs):
        return None


class Response:
    def __init__(self, response):
        self.status_code = response.code
        self.headers = response.headers
        self.location = response.headers.get('Location')
        self.data = response.read()
        self.text = self.data.decode('utf-8', errors='replace')
        self.json = jsonlib.loads(self.text) if 'application/json' in response.headers.get('Content-Type', '') else None

    def __enter__(self):
        return self

    def __exit__(self, *args):
        pass


class Client:
    def __init__(self, app):
        self.app = app
        self.opener = urllib.request.build_opener(NoRedirect(), urllib.request.HTTPCookieProcessor(http.cookiejar.CookieJar()))

    def request(self, method, path, data=None, json=None, headers=None, query_string=None):
        headers = dict(headers or {})
        if query_string:
            path += ('&' if '?' in path else '?') + urllib.parse.urlencode(query_string)
        if json is not None:
            data = jsonlib.dumps(json).encode()
            headers['Content-Type'] = 'application/json'
        elif data is not None:
            data = urllib.parse.urlencode(data).encode()
            headers['Content-Type'] = 'application/x-www-form-urlencoded'
        request = urllib.request.Request(self.app.url + path, data=data, headers=headers, method=method)
        try:
            response = self.opener.open(request, timeout=30)
        except urllib.error.HTTPError as error:
            response = error
        return Response(response)

    def __getattr__(self, method):
        if method in ('get', 'post', 'put', 'patch', 'delete'):
            return lambda path, **kwargs: self.request(method.upper(), path, **kwargs)
        raise AttributeError(method)


class SpringApp:
    def __init__(self, config):
        self.database = config['DATABASE']
        with socket.socket() as sock:
            sock.bind(('127.0.0.1', 0))
            port = sock.getsockname()[1]
        env = dict(os.environ, DATABASE=self.database, PORT=str(port), COOKIE_SECURE='false')
        self.url = f'http://127.0.0.1:{port}'
        self.log = tempfile.TemporaryFile(mode='w+b')
        self.process = subprocess.Popen(['java', '-Xms16m', '-Xmx192m', '-jar', str(ROOT/'target/app.jar')], cwd=ROOT, env=env, stdout=self.log, stderr=self.log)
        APPS.append(self)
        for _ in range(300):
            try:
                with urllib.request.urlopen(self.url+'/library-dashboard/healthz', timeout=1) as response:
                    if response.status == 200:
                        return
            except (OSError, urllib.error.URLError):
                pass
            if self.process.poll() is not None:
                break
            time.sleep(.1)
        self.log.seek(0)
        raise RuntimeError('Spring Boot did not start: '+self.log.read().decode()[-5000:])

    def test_client(self):
        return Client(self)

    @contextlib.contextmanager
    def app_context(self):
        self.connection = sqlite3.connect(self.database)
        self.connection.row_factory = sqlite3.Row
        self.connection.execute('PRAGMA foreign_keys=ON')
        try:
            yield self
        finally:
            self.connection.close()

    def db(self):
        return self.connection


def create_app(config):
    return SpringApp(config)
