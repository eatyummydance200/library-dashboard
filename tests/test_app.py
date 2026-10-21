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
            connection.executescript('DROP TABLE archive_tasks; DROP TABLE archive_assignments; DROP TABLE archive_draws; '
                                     'ALTER TABLE users DROP COLUMN staff_id; DROP TABLE monthly_tags; DROP TABLE duty_contact; PRAGMA user_version=1;')
        upgraded = create_app({'TESTING': True, 'DATABASE': self.database, 'SECRET_KEY': 'test-secret-' * 4})
        with upgraded.app_context():
            connection = upgraded.db()
            self.assertEqual(connection.execute('PRAGMA user_version').fetchone()[0], 5)
            self.assertEqual(connection.execute('SELECT count(*) FROM shifts').fetchone()[0], 2)
            self.assertEqual(connection.execute('SELECT count(*) FROM staff').fetchone()[0], 2)
            self.assertEqual(connection.execute('SELECT username FROM users').fetchone()[0], 'testadmin')
            self.assertEqual(connection.execute('SELECT count(*) FROM monthly_tags').fetchone()[0], 0)
            self.assertEqual(connection.execute('PRAGMA integrity_check').fetchone()[0], 'ok')

    def archive_roster(self):
        for i in range(5):
            self.assertEqual(self.write('/staff', {'name': f'추첨 근무자 {i}', 'phone': ''}).status_code, 201)

    def test_archive_monthly_draw_is_unique_and_preserves_history(self):
        self.assertEqual(self.client.get(BASE + '/api/archive?month=2026-10').status_code, 401)
        self.login()
        self.assertEqual(self.client.post(BASE + '/api/archive/draw', json={'month': '2026-10'}).status_code, 403)
        for value in [None, 202610, '2026-1', '2026-13', '2026-00', '1999-12', '2101-01']:
            self.assertEqual(self.write('/archive/draw', {'month': value}).status_code, 400)
        self.assertEqual(self.write('/archive/draw', {'month': '2026-10'}).status_code, 400)
        self.assertIsNone(self.client.get(BASE + '/api/archive?month=2026-10').json['draw'])
        self.archive_roster()
        self.assertEqual(self.write('/archive/draw', {'month': '2026-10'}).status_code, 201)
        before = self.client.get(BASE + '/api/archive?month=2026-10').json
        assignments = before['assignments']
        self.assertEqual(len(assignments), 7)
        self.assertEqual({a['staff_id'] for a in assignments}, set(range(1, 8)))
        self.assertEqual([a['group_number'] for a in assignments], list(range(1, 8)))
        self.assertEqual(sum(len(a['tasks']) for a in assignments), 20)
        self.assertEqual([t['newspaper'] for t in assignments[0]['tasks']], ['중앙', '코헤', 'FT'])
        self.assertEqual([t['newspaper'] for t in assignments[-1]['tasks']], ['한국일보', '한겨레', '뉴탐'])
        self.assertTrue(all(not t['completed'] for a in assignments for t in a['tasks']))
        self.assertEqual(self.write('/archive/draw', {'month': '2026-10'}).status_code, 409)
        self.assertEqual(self.client.get(BASE + '/api/archive?month=2026-10').json['assignments'], assignments)
        self.assertEqual(self.write('/archive/draw', {'month': '2026-11'}).status_code, 201)
        first = assignments[0]
        self.write('/staff/' + str(first['staff_id']), {'name': '변경된 이름', 'phone': '', 'active': False}, 'put')
        self.assertEqual(self.client.get(BASE + '/api/archive?month=2026-10').json['assignments'], assignments)
        self.assertIsNone(self.client.get(BASE + '/api/archive?month=2026-12').json['draw'])
        self.assertEqual(self.client.get(BASE + '/api/archive?month=wrong').status_code, 400)
        with self.app.app_context():
            self.assertEqual(self.app.db().execute('SELECT count(*) FROM archive_draws').fetchone()[0], 2)

    def test_manual_archive_creation_and_swap_preserve_completed_tasks(self):
        self.login()
        self.archive_roster()
        ids = list(range(1, 8))
        body = {'month': '2026-10', 'staff_ids': ids, 'expected': None}
        self.assertEqual(self.client.put(BASE + '/api/archive/assignments', json=body).status_code, 403)
        self.assertEqual(self.write('/archive/assignments', body, 'put').status_code, 200)
        before = self.client.get(BASE + '/api/archive?month=2026-10').json
        task_id = before['assignments'][0]['tasks'][0]['id']
        self.write('/archive/tasks/' + str(task_id), {'completed': True}, 'put')
        before = self.client.get(BASE + '/api/archive?month=2026-10').json
        self.write('/archive/draw', {'month': '2026-11'})
        november = self.client.get(BASE + '/api/archive?month=2026-11').json
        changed = [2, 1, 3, 4, 5, 6, 7]
        update = {**body, 'staff_ids': changed, 'expected': ids}
        self.assertEqual(self.write('/archive/assignments', update, 'put').status_code, 200)
        after = self.client.get(BASE + '/api/archive?month=2026-10').json
        self.assertEqual([a['staff_id'] for a in after['assignments']], changed)
        self.assertEqual([a['id'] for a in after['assignments']], [a['id'] for a in before['assignments']])
        self.assertEqual([a['tasks'] for a in after['assignments']], [a['tasks'] for a in before['assignments']])
        self.assertEqual(after['draw'], before['draw'])
        self.assertEqual(self.client.get(BASE + '/api/archive?month=2026-11').json, november)
        self.assertEqual(self.write('/archive/assignments', update, 'put').status_code, 409)
        self.assertEqual(self.write('/archive/draw', {'month': '2026-10'}).status_code, 409)
        self.assertEqual(self.write('/archive/assignments', {**body, 'staff_ids': changed, 'expected': changed}, 'put').status_code, 200)
        self.write('/users', {'username': 'worker', 'password': 'worker-password-123', 'role': 'worker', 'staff_id': 1})
        worker = self.app.test_client()
        self.login(worker, 'worker', 'worker-password-123')
        self.assertEqual(self.write('/archive/assignments', update, 'put', worker).status_code, 403)
        self.assertEqual(self.write('/archive/tasks/' + str(task_id), {'completed': False}, 'put', worker).status_code, 403)
        new_task = after['assignments'][1]['tasks'][0]['id']
        self.assertEqual(self.write('/archive/tasks/' + str(new_task), {'completed': True}, 'put', worker).status_code, 200)
        with self.app.app_context():
            self.assertEqual(self.app.db().execute('PRAGMA foreign_key_check').fetchall(), [])

    def test_manual_archive_validation_and_inactive_history(self):
        self.login()
        self.archive_roster()
        ids = list(range(1, 8))
        body = {'month': '2026-10', 'staff_ids': ids, 'expected': None}
        for invalid in [None, [], [1]*7, [True,2,3,4,5,6,7], ['1',2,3,4,5,6,7], [1,2,3,4,5,6,999]]:
            self.assertEqual(self.write('/archive/assignments', {**body, 'staff_ids': invalid}, 'put').status_code, 400)
        self.assertEqual(self.write('/archive/assignments', {**body, 'month': 'wrong'}, 'put').status_code, 400)
        self.assertEqual(self.write('/archive/assignments', {**body, 'expected': [1]}, 'put').status_code, 400)
        self.assertIsNone(self.client.get(BASE + '/api/archive?month=2026-10').json['draw'])
        self.write('/archive/assignments', body, 'put')
        self.write('/staff/1', {'name': '과거 이름 변경', 'phone': '', 'active': False}, 'put')
        self.assertEqual(self.write('/archive/assignments', {**body, 'expected': ids}, 'put').status_code, 200)
        self.assertEqual(self.write('/archive/assignments', {**body, 'expected': ids, 'staff_ids': [2,1,3,4,5,6,7]}, 'put').status_code, 400)
        self.assertEqual(self.client.get(BASE + '/api/archive?month=2026-10').json['assignments'][0]['staff_name'], '테스트 가')

    def test_manual_archive_failed_swap_rolls_back_all_records(self):
        self.login()
        self.archive_roster()
        ids = list(range(1, 8))
        self.write('/archive/assignments', {'month': '2026-10', 'staff_ids': ids}, 'put')
        before = self.client.get(BASE + '/api/archive?month=2026-10').json
        with self.app.app_context():
            with self.app.db():
                self.app.db().execute("CREATE TRIGGER reject_assignment BEFORE INSERT ON archive_assignments "
                                      "BEGIN SELECT RAISE(ABORT, 'test failure'); END")
        response = self.write('/archive/assignments', {'month': '2026-10', 'staff_ids': [2,1,3,4,5,6,7], 'expected': ids}, 'put')
        self.assertEqual(response.status_code, 409)
        self.assertEqual(self.client.get(BASE + '/api/archive?month=2026-10').json, before)

    def test_simultaneous_archive_draw_keeps_one_result(self):
        from concurrent.futures import ThreadPoolExecutor
        from threading import Barrier

        self.login()
        self.archive_roster()
        clients = [self.app.test_client(), self.app.test_client()]
        for client in clients:
            self.login(client)
        tokens = [client.get(BASE + '/api/me').json['csrf'] for client in clients]
        barrier = Barrier(2)

        def draw(index):
            barrier.wait(timeout=5)
            return clients[index].post(BASE + '/api/archive/draw', json={'month': '2026-10'},
                                       headers={'X-CSRF-Token': tokens[index]}).status_code

        with ThreadPoolExecutor(max_workers=2) as pool:
            self.assertEqual(sorted(pool.map(draw, range(2))), [201, 409])
        with self.app.app_context():
            self.assertEqual(self.app.db().execute('SELECT count(*) FROM archive_tasks').fetchone()[0], 20)

    def test_archive_completion_ownership_audit_backup_and_restart(self):
        self.login()
        self.archive_roster()
        self.write('/archive/draw', {'month': '2026-10'})
        assignments = self.client.get(BASE + '/api/archive?month=2026-10').json['assignments']
        own = next(a for a in assignments if a['staff_id'] == 1)['tasks'][0]['id']
        other = next(a for a in assignments if a['staff_id'] != 1)['tasks'][0]['id']
        self.assertEqual(self.write('/users', {'username': 'worker', 'password': 'worker-password-123',
                                               'role': 'worker', 'staff_id': 1}).status_code, 201)
        worker = self.app.test_client()
        self.login(worker, 'worker', 'worker-password-123')
        self.assertEqual(worker.get(BASE + '/api/me').json['user']['staff_id'], 1)
        self.assertEqual(self.write('/archive/draw', {'month': '2026-12'}, client=worker).status_code, 403)
        self.assertEqual(self.write('/archive/tasks/' + str(other), {'completed': True}, 'put', worker).status_code, 403)
        self.assertEqual(self.write('/users/2', {'staff_id': 2}, 'patch', worker).status_code, 403)
        own_path = '/archive/tasks/' + str(own)
        self.assertEqual(worker.put(BASE + '/api' + own_path, json={'completed': True}).status_code, 403)
        self.assertEqual(self.write(own_path, {'completed': 'true'}, 'put', worker).status_code, 400)
        self.assertEqual(self.write('/archive/tasks/999999', {'completed': True}, 'put', worker).status_code, 404)
        self.assertEqual(self.write(own_path, {'completed': True}, 'put', worker).status_code, 200)
        task_rows = lambda client: [t for a in client.get(BASE + '/api/archive?month=2026-10').json['assignments'] for t in a['tasks']]
        saved = next(t for t in task_rows(worker) if t['id'] == own)
        self.assertEqual(saved['completed'], 1)
        self.assertEqual(saved['completed_by_name'], 'worker')
        self.assertTrue(saved['completed_at'])
        self.write(own_path, {'completed': True}, 'put', worker)
        self.assertEqual(next(t for t in task_rows(worker) if t['id'] == own), saved)
        self.write(own_path, {'completed': False}, 'put', worker)
        cleared = next(t for t in task_rows(worker) if t['id'] == own)
        self.assertEqual(cleared['completed'], 0)
        self.assertIsNone(cleared['completed_at'])
        self.assertIsNone(cleared['completed_by'])
        self.assertEqual(self.write('/archive/tasks/' + str(other), {'completed': True}, 'put').status_code, 200)
        backup = self.client.get(BASE + '/api/backup').data
        saved_backup = Path(self.directory.name) / 'archive-backup.sqlite3'
        saved_backup.write_bytes(backup)
        with sqlite3.connect(saved_backup) as connection:
            self.assertEqual(connection.execute('SELECT count(*) FROM archive_assignments').fetchone()[0], 7)
            self.assertEqual(connection.execute('SELECT sum(completed) FROM archive_tasks').fetchone()[0], 1)
        restarted = create_app({'TESTING': True, 'DATABASE': self.database, 'SECRET_KEY': 'test-secret-' * 4})
        with restarted.app_context():
            self.assertEqual(restarted.db().execute('SELECT count(*) FROM archive_tasks').fetchone()[0], 20)
        self.assertEqual(self.write('/users/2', {'staff_id': None}, 'patch').status_code, 200)
        self.assertEqual(worker.get(BASE + '/api/me').status_code, 401)
        self.login(worker, 'worker', 'worker-password-123')
        self.assertEqual(self.write(own_path, {'completed': True}, 'put', worker).status_code, 403)

    def test_account_staff_link_validation_and_version_two_migration(self):
        self.login()
        for value in [True, '1', 999]:
            self.assertEqual(self.write('/users', {'username': 'worker', 'password': 'worker-password-123',
                                                  'role': 'worker', 'staff_id': value}).status_code, 400)
        self.write('/users', {'username': 'worker', 'password': 'worker-password-123', 'role': 'worker'})
        self.assertEqual(self.write('/users/2', {'staff_id': 1}, 'patch').status_code, 200)
        self.assertEqual(self.client.get(BASE + '/api/users').json[1]['staff_id'], 1)
        self.assertEqual(self.write('/users/2', {'staff_id': False}, 'patch').status_code, 400)
        self.assertEqual(self.write('/users/999', {'staff_id': 1}, 'patch').status_code, 404)
        self.assertEqual(self.write('/users/2', {}, 'patch').status_code, 400)
        self.write('/tagging/1/2026/9', {'completed': True}, 'put')
        with sqlite3.connect(self.database) as connection:
            connection.executescript('DROP TABLE archive_tasks; DROP TABLE archive_assignments; DROP TABLE archive_draws; '
                                     'ALTER TABLE users DROP COLUMN staff_id; DROP TABLE duty_contact; PRAGMA user_version=2;')
        upgraded = create_app({'TESTING': True, 'DATABASE': self.database, 'SECRET_KEY': 'test-secret-' * 4})
        with upgraded.app_context():
            connection = upgraded.db()
            self.assertEqual(connection.execute('PRAGMA user_version').fetchone()[0], 5)
            self.assertEqual(connection.execute('SELECT count(*) FROM users').fetchone()[0], 2)
            self.assertEqual(connection.execute('SELECT count(*) FROM shifts').fetchone()[0], 2)
            self.assertEqual(connection.execute('SELECT completed FROM monthly_tags').fetchone()[0], 1)
            self.assertEqual(connection.execute('PRAGMA integrity_check').fetchone()[0], 'ok')
            self.assertEqual(connection.execute('PRAGMA foreign_key_check').fetchall(), [])

    def test_22_hour_shift_boundaries_and_version_three_migration(self):
        self.login()
        before = self.client.get(BASE + '/api/schedule').json['shifts']
        with sqlite3.connect(self.database) as connection:
            connection.executescript("""BEGIN;
                CREATE TABLE legacy_shifts (
                    id INTEGER PRIMARY KEY, staff_id INTEGER NOT NULL REFERENCES staff(id), day TEXT NOT NULL,
                    start INTEGER NOT NULL CHECK(start>=540 AND start%30=0),
                    end INTEGER NOT NULL CHECK(end<=1260 AND end%30=0 AND end>start),
                    role TEXT NOT NULL CHECK(role IN ('desk','general')));
                INSERT INTO legacy_shifts SELECT * FROM shifts;
                DROP TABLE shifts;
                ALTER TABLE legacy_shifts RENAME TO shifts;
                CREATE INDEX shifts_day ON shifts(day);
                DROP TABLE duty_contact; PRAGMA user_version=3; COMMIT;""")
        self.app = create_app({'TESTING': True, 'DATABASE': self.database,
                              'SECRET_KEY': 'test-secret-' * 4, 'SESSION_COOKIE_SECURE': False})
        self.client = self.app.test_client()
        self.login()
        self.assertEqual(self.client.get(BASE + '/api/schedule').json['shifts'], before)
        day = (self.monday + timedelta(days=1)).isoformat()
        body = {'staff_id': 1, 'day': day, 'start': 1260, 'end': 1320, 'role': 'desk'}
        self.assertEqual(self.write('/shifts', body).status_code, 201)
        at = lambda time: self.client.get(BASE + '/api/status', query_string={'at': day + 'T' + time + '+09:00'}).json
        self.assertEqual(at('21:59:59')['current'][0]['staff_id'], 1)
        self.assertEqual(at('22:00:00')['current'], [])
        for invalid in [{'end': 1350}, {'start': 1320}, {'end': 1319}]:
            self.assertEqual(self.write('/shifts', {**body, **invalid}).status_code, 400)
        shift = self.client.get(BASE + '/api/schedule').json['shifts'][-1]
        self.assertEqual(self.write('/shifts/' + str(shift['id']), {**body, 'start': 1290}, 'put').status_code, 200)
        with self.app.app_context():
            self.assertEqual(self.app.db().execute('PRAGMA user_version').fetchone()[0], 5)
            self.assertEqual(self.app.db().execute('PRAGMA integrity_check').fetchone()[0], 'ok')
            self.assertEqual(self.app.db().execute('PRAGMA foreign_key_check').fetchall(), [])

        seed = json.loads(json.dumps(SEED))
        seed['shifts'][0].append({'id': 0, 'start': 21, 'end': 22, 'desk': False})
        with patch.dict(os.environ, {'INITIAL_SCHEDULE_JSON': json.dumps(seed)}):
            fresh = create_app({'TESTING': True, 'DATABASE': str(Path(self.directory.name) / 'fresh.sqlite3'),
                                'SECRET_KEY': 'test-secret-' * 4})
        with fresh.app_context():
            self.assertEqual(fresh.db().execute('SELECT count(*) FROM shifts WHERE end=1320').fetchone()[0], 1)

    def test_shift_change_issues_filter_by_category_week_and_status(self):
        self.login()
        day = self.monday.isoformat()
        change = {'day': day, 'category': '근무 변경', 'title': '<img src=x>', 'body': '대체 근무 요청'}
        self.assertEqual(self.write('/issues', change).status_code, 201)
        self.write('/issues', {**change, 'category': '인계', 'title': '일반 인계'})
        self.write('/issues', {**change, 'day': (self.monday + timedelta(days=7)).isoformat(), 'title': '다음 주 요청'})
        query = {'category': '근무 변경', 'week': (self.monday + timedelta(days=3)).isoformat()}
        response = self.client.get(BASE + '/api/issues', query_string=query)
        self.assertEqual(len(response.json), 1)
        issue = response.json[0]
        self.assertEqual(issue['title'], change['title'])
        self.assertEqual(issue['author'], 'testadmin')
        self.write('/issues/' + str(issue['id']), {'done': True}, 'patch')
        self.assertEqual(self.client.get(BASE + '/api/issues', query_string=query).json[0]['done'], 1)
        self.assertEqual(len(self.client.get(BASE + '/api/issues').json), 3)
        self.assertEqual(self.client.get(BASE + '/api/issues?category=bad').status_code, 400)
        self.assertEqual(self.client.get(BASE + '/api/issues?week=wrong').status_code, 400)
        self.assertEqual(self.client.get(BASE + '/api/issues?week=9999-12-31').status_code, 400)

    def test_invalid_dates_json_and_foreign_keys(self):
        self.login()
        self.assertEqual(self.client.get(BASE + '/api/schedule?week=wrong').status_code, 400)
        self.assertEqual(self.client.get(BASE + '/api/status?at=wrong').status_code, 400)
        self.assertEqual(self.write('/staff', ['bad']).status_code, 400)
        self.assertEqual(self.write('/issues', {'day': '2026-99-99'}).status_code, 400)

    def test_duty_contact_validation_permissions_and_persistence(self):
        self.assertEqual(self.client.get(BASE + '/api/duty').status_code, 401)
        self.login()
        self.assertEqual(self.client.get(BASE + '/api/duty').json, {'teacher': '', 'extension': ''})
        data = {'teacher': ' 김담당 ', 'extension': ' 1234 '}
        self.assertEqual(self.client.put(BASE + '/api/duty', json=data).status_code, 403)
        self.assertEqual(self.write('/duty', data, 'put').json, {'teacher': '김담당', 'extension': '1234'})
        for invalid in [{}, {'teacher': None, 'extension': ''}, {'teacher': '가' * 41, 'extension': ''},
                        {'teacher': '', 'extension': 'x123'}, {'teacher': '', 'extension': '1' * 21}]:
            self.assertEqual(self.write('/duty', invalid, 'put').status_code, 400)
        self.write('/users', {'username': 'worker', 'password': 'worker-password-123', 'role': 'worker'})
        worker = self.app.test_client()
        self.login(worker, 'worker', 'worker-password-123')
        self.assertEqual(worker.get(BASE + '/api/duty').json['teacher'], '김담당')
        self.assertEqual(self.write('/duty', data, 'put', worker).status_code, 403)
        restarted = create_app({'TESTING': True, 'DATABASE': self.database, 'SECRET_KEY': 'test-secret-' * 4})
        with restarted.app_context():
            self.assertEqual(restarted.db().execute('SELECT teacher,extension FROM duty_contact').fetchone()[:], ('김담당', '1234'))
        self.assertEqual(self.write('/duty', {'teacher': '', 'extension': ''}, 'put').status_code, 200)
        with sqlite3.connect(self.database) as connection:
            connection.executescript('DROP TABLE duty_contact; PRAGMA user_version=4;')
        upgraded = create_app({'TESTING': True, 'DATABASE': self.database, 'SECRET_KEY': 'test-secret-' * 4})
        with upgraded.app_context():
            self.assertEqual(upgraded.db().execute('PRAGMA user_version').fetchone()[0], 5)
            self.assertEqual(upgraded.db().execute('SELECT count(*) FROM shifts').fetchone()[0], 2)
            self.assertEqual(upgraded.db().execute('PRAGMA integrity_check').fetchone()[0], 'ok')

if __name__ == '__main__':
    unittest.main()
