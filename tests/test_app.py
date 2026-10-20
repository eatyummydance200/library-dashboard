import json
import os
import re
import sqlite3
import tempfile
import unittest
from datetime import datetime, timedelta
from pathlib import Path
from unittest.mock import patch

from app import KOREA, create_app

BASE = '/libaryDashBoard'
SEED = {'staff': [{'id': 0, 'name': '테스트 가'}, {'id': 1, 'name': '테스트 나'}],
        'shifts': [[{'id': 0, 'start': 9, 'end': 10.5, 'desk': True},
                    {'id': 1, 'start': 10.5, 'end': 21, 'desk': True}], [], [], [], []]}


class ApplicationTests(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.database = str(Path(self.directory.name) / 'app.sqlite3')
        self.environment = patch.dict(os.environ, {
            'ADMIN_USER': 'testadmin', 'ADMIN_PASSWORD': 'test-password-123',
            'INITIAL_SCHEDULE_JSON': json.dumps(SEED),
        })
        self.environment.start()
        self.app = create_app({'TESTING': True, 'DATABASE': self.database,
                               'SECRET_KEY': 'test-secret-' * 4, 'SESSION_COOKIE_SECURE': False})
        self.client = self.app.test_client()
        today = datetime.now(KOREA).date()
        self.monday = today - timedelta(days=today.weekday())

    def tearDown(self):
        self.environment.stop()
        self.directory.cleanup()

    def login(self, client=None, username='testadmin', password='test-password-123'):
        client = client or self.client
        page = client.get(BASE + '/login')
        token = re.search(r'name="csrf" value="([^"]+)"', page.text)[1]
        response = client.post(BASE + '/login', data={'csrf': token, 'username': username, 'password': password})
        return response

    def write(self, path, body, method='post', client=None):
        client = client or self.client
        token = client.get(BASE + '/api/me').json['csrf']
        return getattr(client, method)(BASE + '/api' + path, json=body, headers={'X-CSRF-Token': token})

    def test_authentication_csrf_and_asset_paths(self):
        self.assertEqual(self.client.get(BASE + '/api/staff').status_code, 401)
        self.assertEqual(self.client.post(BASE + '/login', data={}).status_code, 403)
        with self.client.get(BASE + '/static/glass.css') as stylesheet:
            self.assertEqual(stylesheet.status_code, 200)
        self.assertEqual(self.client.get(BASE + '/healthz').json, {'status': 'ok'})
        self.assertEqual(self.login().status_code, 302)
        self.assertEqual(self.client.get(BASE).location, BASE + '/')
        page = self.client.get(BASE + '/')
        self.assertIn(BASE + '/static/actions.js', page.text)
        self.assertIn("script-src 'self'", page.headers['Content-Security-Policy'])
        self.assertEqual(self.client.post(BASE + '/api/staff', json={}).status_code, 403)

    def test_wrong_password_and_throttle(self):
        for _ in range(5):
            self.assertEqual(self.login(password='wrong-password').status_code, 401)
        self.assertEqual(self.login().status_code, 429)

    def test_schedule_seed_and_half_hour_boundary(self):
        self.login()
        data = self.client.get(BASE + '/api/schedule').json
        self.assertEqual(len(data['shifts']), 2)
        self.assertEqual(sum(s['end'] - s['start'] for s in data['shifts']), 720)
        at = lambda t: self.client.get(BASE + '/api/status', query_string={'at': self.monday.isoformat() + 'T' + t + '+09:00'}).json
        self.assertEqual(at('10:29:59')['current'][0]['staff_id'], 1)
        self.assertEqual(at('10:30:00')['current'][0]['staff_id'], 2)
        self.assertEqual(at('21:00:00')['current'], [])
        self.assertEqual(at('08:00:00')['next'][0]['staff_id'], 1)

    def test_shift_crud_overlap_and_invalid_values(self):
        self.login()
        day = (self.monday + timedelta(days=1)).isoformat()
        body = {'staff_id': 1, 'day': day, 'start': 540, 'end': 600, 'role': 'general'}
        self.assertEqual(self.write('/shifts', body).status_code, 201)
        self.assertEqual(self.write('/shifts', {**body, 'start': 570}).status_code, 409)
        self.assertEqual(self.write('/shifts', {**body, 'start': 600, 'end': 630}).status_code, 201)
        for change in [{'start': 541}, {'role': 'unknown'}, {'staff_id': 999}, {'start': True}, {'end': 3000}]:
            self.assertEqual(self.write('/shifts', {**body, **change}).status_code, 400)
        shift = self.client.get(BASE + '/api/schedule').json['shifts'][-2]
        self.assertEqual(self.write('/shifts/' + str(shift['id']), {**body, 'end': 570}, 'put').status_code, 200)
        self.assertEqual(self.write('/shifts/' + str(shift['id']), {}, 'delete').status_code, 200)

    def test_copy_preserves_existing_week(self):
        self.login()
        target = (self.monday + timedelta(days=7)).isoformat()
        payload = {'source': self.monday.isoformat(), 'target': target}
        response = self.write('/schedule/copy', payload)
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json['count'], 2)
        self.assertEqual(self.write('/schedule/copy', payload).status_code, 409)
        original = self.client.get(BASE + '/api/schedule').json
        copied = self.client.get(BASE + '/api/schedule?week=' + target).json
        self.assertEqual(len(copied['shifts']), len(original['shifts']))
        self.assertEqual(copied['shifts'][0]['day'], target)

    def test_staff_history_and_validation(self):
        self.login()
        self.assertEqual(self.write('/staff/1', {'name': '수정됨', 'phone': '010-1234-5678', 'active': False}, 'put').status_code, 200)
        self.assertEqual(len(self.client.get(BASE + '/api/schedule').json['shifts']), 2)
        self.assertEqual(self.write('/staff', {'name': '새 근무자', 'phone': '<script>'}).status_code, 400)
        self.assertEqual(self.write('/staff', {'name': '새 근무자', 'phone': ''}).status_code, 201)

    def test_worker_permissions_and_session_revocation(self):
        self.login()
        self.assertEqual(self.write('/users', {'username': 'worker', 'password': 'worker-password-123', 'role': 'worker'}).status_code, 201)
        worker = self.app.test_client()
        self.assertEqual(self.login(worker, 'worker', 'worker-password-123').status_code, 302)
        self.assertEqual(worker.get(BASE + '/api/staff').status_code, 200)
        self.assertEqual(worker.get(BASE + '/api/backup').status_code, 403)
        self.assertEqual(self.write('/staff', {'name': '금지'}, client=worker).status_code, 403)
        self.assertEqual(self.write('/shifts', {}, client=worker).status_code, 403)
        self.assertEqual(self.write('/users/2', {'active': False}, 'patch').status_code, 200)
        self.assertEqual(worker.get(BASE + '/api/me').status_code, 401)
        self.assertEqual(self.write('/users/1', {'active': False}, 'patch').status_code, 400)

    def test_issue_writes_are_persistent_and_attributed(self):
        self.login()
        body = {'category': '인계', 'title': '<img src=x onerror=alert(1)>', 'body': '다음 근무에 전달'}
        self.assertEqual(self.write('/issues', body).status_code, 201)
        issue = self.client.get(BASE + '/api/issues').json[0]
        self.assertEqual(issue['author'], 'testadmin')
        self.assertEqual(issue['title'], body['title'])
        self.assertEqual(self.write('/issues/' + str(issue['id']), {'done': True}, 'patch').status_code, 200)
        self.assertTrue(self.client.get(BASE + '/api/issues').json[0]['done'])
        self.assertEqual(self.write('/issues', {**body, 'title': ' '}).status_code, 400)
        self.assertEqual(self.write('/issues', {**body, 'category': 'bad'}).status_code, 400)

    def test_password_change_revokes_other_sessions(self):
        self.login()
        other = self.app.test_client()
        self.login(other)
        self.assertEqual(self.write('/password', {'current': 'test-password-123', 'password': ' new-password-123 '}).status_code, 200)
        self.assertEqual(other.get(BASE + '/api/me').status_code, 401)
        self.assertEqual(self.login(password=' new-password-123 ').status_code, 302)

    def test_backup_and_restart_preserve_data(self):
        self.login()
        self.write('/issues', {'category': '인계', 'title': '보관', 'body': '보관 확인'})
        response = self.client.get(BASE + '/api/backup')
        self.assertTrue(response.data.startswith(b'SQLite format 3'))
        backup = Path(self.directory.name) / 'backup.sqlite3'
        backup.write_bytes(response.data)
        with sqlite3.connect(backup) as connection:
            self.assertEqual(connection.execute('PRAGMA integrity_check').fetchone()[0], 'ok')
            self.assertEqual(connection.execute('SELECT title FROM issues').fetchone()[0], '보관')
        restarted = create_app({'TESTING': True, 'DATABASE': self.database, 'SECRET_KEY': 'test-secret-' * 4})
        with restarted.app_context():
            self.assertEqual(restarted.db().execute('SELECT count(*) FROM shifts').fetchone()[0], 2)
            self.assertEqual(restarted.db().execute('SELECT count(*) FROM issues').fetchone()[0], 1)

    def test_monthly_tagging_persistence_validation_and_permissions(self):
        self.assertEqual(self.client.get(BASE + '/api/tagging?year=2026').status_code, 401)
        self.login()
        path = '/tagging/1/2026/9'
        self.assertEqual(self.client.put(BASE + '/api' + path, json={'completed': True}).status_code, 403)
        self.assertEqual(self.write(path, {'completed': True}, 'put').status_code, 200)
        self.assertEqual(self.write(path, {'completed': True}, 'put').status_code, 200)
        result = self.client.get(BASE + '/api/tagging?year=2026').json
        self.assertEqual(result['tags'], [{'staff_id': 1, 'month': 9, 'completed': 1}])
        self.assertEqual(self.client.get(BASE + '/api/tagging?year=2027').json['tags'], [])
        self.assertEqual(self.write('/staff/1', {'name': '보존', 'phone': '', 'active': False}, 'put').status_code, 200)
        self.assertEqual(len(self.client.get(BASE + '/api/tagging?year=2026').json['staff']), 2)
        self.assertEqual(self.write(path, {'completed': False}, 'put').status_code, 200)
        for value in [1, 'true', None]:
            self.assertEqual(self.write(path, {'completed': value}, 'put').status_code, 400)
        for year in ['bad', '1999', '2101', '2026.0']:
            self.assertEqual(self.client.get(BASE + '/api/tagging?year=' + year).status_code, 400)
        for invalid in ['/tagging/1/2026/13', '/tagging/1/1999/9', '/tagging/1/2026/0']:
            self.assertEqual(self.write(invalid, {'completed': True}, 'put').status_code, 400)
        self.assertEqual(self.write('/tagging/999/2026/9', {'completed': True}, 'put').status_code, 404)
        self.write('/users', {'username': 'worker', 'password': 'worker-password-123', 'role': 'worker'})
        worker = self.app.test_client()
        self.login(worker, 'worker', 'worker-password-123')
        self.assertEqual(worker.get(BASE + '/api/tagging?year=2026').status_code, 200)
        self.assertEqual(self.write(path, {'completed': True}, 'put', client=worker).status_code, 403)
        restarted = create_app({'TESTING': True, 'DATABASE': self.database, 'SECRET_KEY': 'test-secret-' * 4})
        with restarted.app_context():
            self.assertEqual(restarted.db().execute('SELECT completed FROM monthly_tags').fetchone()[0], 0)

    def test_tagging_migration_preserves_existing_database(self):
        with sqlite3.connect(self.database) as connection:
            connection.executescript('DROP TABLE monthly_tags; PRAGMA user_version=1;')
        upgraded = create_app({'TESTING': True, 'DATABASE': self.database, 'SECRET_KEY': 'test-secret-' * 4})
        with upgraded.app_context():
            connection = upgraded.db()
            self.assertEqual(connection.execute('PRAGMA user_version').fetchone()[0], 2)
            self.assertEqual(connection.execute('SELECT count(*) FROM shifts').fetchone()[0], 2)
            self.assertEqual(connection.execute('SELECT count(*) FROM staff').fetchone()[0], 2)
            self.assertEqual(connection.execute('SELECT username FROM users').fetchone()[0], 'testadmin')
            self.assertEqual(connection.execute('SELECT count(*) FROM monthly_tags').fetchone()[0], 0)
            self.assertEqual(connection.execute('PRAGMA integrity_check').fetchone()[0], 'ok')

    def test_invalid_dates_json_and_foreign_keys(self):
        self.login()
        self.assertEqual(self.client.get(BASE + '/api/schedule?week=wrong').status_code, 400)
        self.assertEqual(self.client.get(BASE + '/api/status?at=wrong').status_code, 400)
        self.assertEqual(self.write('/staff', ['bad']).status_code, 400)
        self.assertEqual(self.write('/issues', {'day': '2026-99-99'}).status_code, 400)


if __name__ == '__main__':
    unittest.main()
