import io
import json
import os
import re
import secrets
import sqlite3
import time
from datetime import date, datetime, timedelta, timezone
from functools import wraps
from pathlib import Path
from zoneinfo import ZoneInfo

from flask import (Blueprint, Flask, abort, g, jsonify, redirect, render_template,
                   request, send_file, session, url_for)
from werkzeug.exceptions import HTTPException
from werkzeug.security import check_password_hash, generate_password_hash

ROOT = Path(__file__).resolve().parent
KOREA = ZoneInfo('Asia/Seoul')
ARCHIVE_GROUPS = [
    ['중앙', '코헤', 'FT'], ['국민', '경기', '경인'], ['동아', '아사히', '인민'],
    ['조선', '코탐'], ['매일경제', '전자', '요미'], ['한국경제', '인천', '경향'],
    ['한국일보', '한겨레', '뉴탐'],
]


def create_app(config=None):
    app = Flask(__name__, static_folder=None)
    base = os.environ.get('APP_BASE_PATH', '/libaryDashBoard').rstrip('/')
    if not re.fullmatch(r'/[A-Za-z0-9_-]+', base):
        raise RuntimeError('APP_BASE_PATH must be a single URL path segment')
    app.config.update(
        SECRET_KEY=os.environ.get('SECRET_KEY'),
        DATABASE=os.environ.get('DATABASE', '/app/data/library.sqlite3'),
        SESSION_COOKIE_NAME='library_dashboard_session',
        SESSION_COOKIE_PATH=base,
        SESSION_COOKIE_SECURE=os.environ.get('COOKIE_SECURE', 'true') == 'true',
        SESSION_COOKIE_HTTPONLY=True, SESSION_COOKIE_SAMESITE='Lax',
        PERMANENT_SESSION_LIFETIME=timedelta(hours=12),
        MAX_CONTENT_LENGTH=64 * 1024,
        BASE_PATH=base,
    )
    if config:
        app.config.update(config)
    if not app.config['SECRET_KEY'] or len(app.config['SECRET_KEY']) < 32:
        raise RuntimeError('A SECRET_KEY of at least 32 characters is required')
    Path(app.config['DATABASE']).parent.mkdir(parents=True, exist_ok=True)

    def db():
        if 'db' not in g:
            g.db = sqlite3.connect(app.config['DATABASE'], timeout=5)
            g.db.row_factory = sqlite3.Row
            g.db.execute('PRAGMA foreign_keys=ON')
            g.db.execute('PRAGMA busy_timeout=5000')
            Path(app.config['DATABASE']).chmod(0o600)
        return g.db

    app.db = db

    @app.teardown_appcontext
    def close_db(_):
        connection = g.pop('db', None)
        if connection:
            connection.close()

    with app.app_context():
        connection = db()
        version = connection.execute('PRAGMA user_version').fetchone()[0]
        if version not in (0, 1, 2, 3):
            raise RuntimeError('Unsupported database version; restore a compatible image')
        connection.execute('PRAGMA journal_mode=WAL')
        if version == 0:
            connection.executescript('BEGIN;\n' + (ROOT / 'schema.sql').read_text() + '\nCOMMIT;')
            seed = json.loads(os.environ.get('INITIAL_SCHEDULE_JSON', (ROOT / 'seed.json').read_text()))
            today = datetime.now(KOREA).date()
            monday = today - timedelta(days=today.weekday())
            with connection:
                for person in seed['staff']:
                    connection.execute('INSERT INTO staff(id,name) VALUES (?,?)',
                                       (person['id'] + 1, person['name']))
                for offset, entries in enumerate(seed['shifts']):
                    for entry in entries:
                        connection.execute('INSERT INTO shifts(staff_id,day,start,end,role) VALUES (?,?,?,?,?)',
                            (entry['id'] + 1, (monday + timedelta(days=offset)).isoformat(),
                             round(entry['start'] * 60), round(entry['end'] * 60),
                             'desk' if entry['desk'] else 'general'))
        if version < 2:
            connection.executescript('''BEGIN;
                CREATE TABLE IF NOT EXISTS monthly_tags (
                    staff_id INTEGER NOT NULL REFERENCES staff(id),
                    year INTEGER NOT NULL CHECK(year BETWEEN 2000 AND 2100),
                    month INTEGER NOT NULL CHECK(month BETWEEN 1 AND 12),
                    completed INTEGER NOT NULL CHECK(completed IN (0,1)),
                    updated_by INTEGER NOT NULL REFERENCES users(id), updated_at TEXT NOT NULL,
                    PRIMARY KEY(staff_id,year,month)
                );
                PRAGMA user_version=2;
                COMMIT;''')
        if version < 3:
            connection.executescript('''BEGIN IMMEDIATE;
                ALTER TABLE users ADD COLUMN staff_id INTEGER REFERENCES staff(id);
                CREATE TABLE archive_draws (
                    id INTEGER PRIMARY KEY, month TEXT NOT NULL UNIQUE,
                    created_by INTEGER NOT NULL REFERENCES users(id), created_at TEXT NOT NULL
                );
                CREATE TABLE archive_assignments (
                    id INTEGER PRIMARY KEY, draw_id INTEGER NOT NULL REFERENCES archive_draws(id),
                    group_number INTEGER NOT NULL CHECK(group_number BETWEEN 1 AND 7),
                    staff_id INTEGER NOT NULL REFERENCES staff(id), staff_name TEXT NOT NULL,
                    UNIQUE(draw_id,group_number), UNIQUE(draw_id,staff_id)
                );
                CREATE TABLE archive_tasks (
                    id INTEGER PRIMARY KEY, assignment_id INTEGER NOT NULL REFERENCES archive_assignments(id),
                    position INTEGER NOT NULL, newspaper TEXT NOT NULL,
                    completed INTEGER NOT NULL DEFAULT 0 CHECK(completed IN (0,1)),
                    completed_by INTEGER REFERENCES users(id), completed_at TEXT,
                    UNIQUE(assignment_id,position)
                );
                PRAGMA user_version=3;
                COMMIT;''')
        if not connection.execute('SELECT 1 FROM users').fetchone():
            username = os.environ.get('ADMIN_USER', '')
            password = os.environ.get('ADMIN_PASSWORD', '')
            if not re.fullmatch(r'[A-Za-z0-9_.-]{2,32}', username) or len(password) < 10:
                raise RuntimeError('Initial ADMIN_USER and ADMIN_PASSWORD (10+ characters) are required')
            with connection:
                connection.execute('INSERT INTO users(username,password_hash,role) VALUES (?,?,?)',
                    (username, generate_password_hash(password), 'admin'))

    bp = Blueprint('dashboard', __name__, url_prefix=base,
                   static_folder='static', static_url_path='/static')

    def fail(message, code=400):
        abort(code, description=message)

    def text(value, label, maximum, required=True):
        if not isinstance(value, str) or len(value.strip()) > maximum or (required and not value.strip()):
            fail(f'{label}을(를) 확인해주세요.')
        return value.strip()

    def payload():
        data = request.get_json(silent=True)
        if not isinstance(data, dict):
            fail('JSON 입력을 확인해주세요.')
        return data

    def password_value(value):
        if not isinstance(value, str) or not 1 <= len(value) <= 128:
            fail('비밀번호를 확인해주세요.')
        return value

    def parse_day(value):
        try:
            if not isinstance(value, str) or not re.fullmatch(r'\d{4}-\d{2}-\d{2}', value):
                raise ValueError
            return date.fromisoformat(value)
        except (ValueError, TypeError):
            fail('날짜를 확인해주세요.')

    def monday_of(value):
        d = parse_day(value)
        return d - timedelta(days=d.weekday())

    def staff_rows():
        return [dict(row) for row in db().execute('SELECT * FROM staff ORDER BY id')]

    def shift_rows(start, end):
        return [dict(row) for row in db().execute(
            'SELECT * FROM shifts WHERE day>=? AND day<? ORDER BY day,start,id',
            (start.isoformat(), end.isoformat()))]

    def csrf():
        if 'csrf' not in session:
            session['csrf'] = secrets.token_urlsafe(32)
        return session['csrf']

    @app.before_request
    def authentication():
        g.user = None
        if session.get('user_id'):
            row = db().execute('SELECT id,username,role,active,version,staff_id FROM users WHERE id=?',
                               (session['user_id'],)).fetchone()
            if row and row['active'] and row['version'] == session.get('version'):
                g.user = dict(row)
            else:
                session.clear()
        public = request.endpoint in ('dashboard.login', 'dashboard.health', 'dashboard.static')
        if request.endpoint and not public and not g.user:
            if request.path.startswith(base + '/api/'):
                fail('로그인이 필요합니다.', 401)
            return redirect(url_for('dashboard.login'))
        if request.method not in ('GET', 'HEAD', 'OPTIONS'):
            expected = session.get('csrf', '')
            supplied = request.headers.get('X-CSRF-Token') or request.form.get('csrf', '')
            if not expected or not isinstance(supplied, str) or not secrets.compare_digest(expected, supplied):
                fail('요청이 만료되었습니다. 새로고침 후 다시 시도해주세요.', 403)

    @app.after_request
    def response_headers(response):
        response.headers['X-Content-Type-Options'] = 'nosniff'
        response.headers['Referrer-Policy'] = 'same-origin'
        response.headers['Content-Security-Policy'] = (
            "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; "
            "img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; "
            "base-uri 'self'; form-action 'self'; object-src 'none'")
        if request.endpoint != 'dashboard.static':
            response.headers['Cache-Control'] = 'no-store'
        return response

    @app.errorhandler(HTTPException)
    def http_error(error):
        if request.path.startswith(base + '/api/'):
            return jsonify(error=error.description), error.code
        return render_template('error.html', message=error.description, base=base), error.code

    @app.errorhandler(sqlite3.IntegrityError)
    def integrity_error(_):
        db().rollback()
        return jsonify(error='같은 이름이 있거나 입력값이 올바르지 않습니다.'), 409

    @app.errorhandler(sqlite3.OperationalError)
    def database_busy(error):
        app.logger.error('Database operation failed: %s', type(error).__name__)
        return jsonify(error='저장소에 접근하지 못했습니다. 잠시 후 다시 시도해주세요.'), 503

    def admin(function):
        @wraps(function)
        def wrapped(*args, **kwargs):
            if g.user['role'] != 'admin':
                fail('관리자 권한이 필요합니다.', 403)
            return function(*args, **kwargs)
        return wrapped

    @bp.get('/healthz')
    def health():
        db().execute('SELECT 1').fetchone()
        return jsonify(status='ok')

    @bp.route('/login', methods=['GET', 'POST'])
    def login():
        if request.method == 'GET':
            if g.user:
                return redirect(url_for('dashboard.index'))
            return render_template('login.html', csrf=csrf(), error=None, base=base)
        username = text(request.form.get('username'), '아이디', 32)
        password = password_value(request.form.get('password'))
        now = int(time.time())
        with db():
            db().execute('DELETE FROM login_attempts WHERE attempted_at<?', (now - 900,))
        attempts = db().execute('SELECT count(*) FROM login_attempts WHERE username=?', (username,)).fetchone()[0]
        if attempts >= 5:
            return render_template('login.html', csrf=csrf(), error='로그인 시도가 많습니다. 15분 후 다시 시도해주세요.', base=base), 429
        user = db().execute('SELECT * FROM users WHERE username=?', (username,)).fetchone()
        # A dummy hash prevents a quick response from identifying nonexistent accounts.
        valid = check_password_hash(user['password_hash'] if user else app.config['DUMMY_HASH'], password)
        if not user or not user['active'] or not valid:
            with db():
                db().execute('INSERT INTO login_attempts VALUES (?,?)', (username, now))
            return render_template('login.html', csrf=csrf(), error='아이디 또는 비밀번호를 확인해주세요.', base=base), 401
        with db():
            db().execute('DELETE FROM login_attempts WHERE username=?', (username,))
        session.clear()
        session.update(user_id=user['id'], version=user['version'])
        session.permanent = True
        csrf()
        return redirect(url_for('dashboard.index'))

    @bp.post('/api/logout')
    def logout():
        session.clear()
        return jsonify(ok=True)

    @bp.get('')
    def index_redirect():
        return redirect(url_for('dashboard.index'))

    @bp.get('/')
    def index():
        return render_template('index.html', base=base)

    @bp.get('/api/me')
    def me():
        return jsonify(user={k: g.user[k] for k in ('id', 'username', 'role', 'staff_id')}, csrf=csrf())

    @bp.get('/api/staff')
    def get_staff():
        return jsonify(staff_rows())

    @bp.route('/api/staff', methods=['POST'])
    @admin
    def add_staff():
        data = payload()
        name, phone = validate_person(data)
        with db():
            db().execute('INSERT INTO staff(name,phone) VALUES (?,?)', (name, phone))
        return jsonify(ok=True), 201

    def validate_person(data):
        name = text(data.get('name'), '이름', 20)
        phone = text(data.get('phone', ''), '전화번호', 20, False)
        if phone and not re.fullmatch(r'[0-9+() -]{7,20}', phone):
            fail('전화번호 형식을 확인해주세요.')
        return name, phone

    @bp.put('/api/staff/<int:person_id>')
    @admin
    def update_staff(person_id):
        data = payload()
        name, phone = validate_person(data)
        active = data.get('active', True)
        if not isinstance(active, bool):
            fail('재직 상태를 확인해주세요.')
        with db():
            result = db().execute('UPDATE staff SET name=?,phone=?,active=? WHERE id=?',
                                 (name, phone, active, person_id))
            if result.rowcount == 0:
                fail('근무자를 찾을 수 없습니다.', 404)
        return jsonify(ok=True)

    @bp.get('/api/schedule')
    def schedule():
        week = monday_of(request.args.get('week', datetime.now(KOREA).date().isoformat()))
        return jsonify(week=week.isoformat(), staff=staff_rows(), shifts=shift_rows(week, week + timedelta(days=7)))

    def validate_shift(data, exclude=0):
        d = parse_day(data.get('day'))
        person_id, start, end, role = (data.get(k) for k in ('staff_id', 'start', 'end', 'role'))
        if d.weekday() > 4 or type(person_id) is not int or type(start) is not int or type(end) is not int:
            fail('평일 날짜와 근무자·시간을 확인해주세요.')
        if not (540 <= start < end <= 1260) or start % 30 or end % 30 or role not in ('desk', 'general'):
            fail('근무 시간은 09:00~21:00 사이의 30분 단위입니다.')
        if not db().execute('SELECT 1 FROM staff WHERE id=? AND active=1', (person_id,)).fetchone():
            fail('재직 중인 근무자를 선택해주세요.')
        if db().execute('SELECT 1 FROM shifts WHERE day=? AND staff_id=? AND start<? AND end>? AND id<>?',
                        (d.isoformat(), person_id, end, start, exclude)).fetchone():
            fail('같은 사람의 근무 시간이 겹칩니다.', 409)
        return person_id, d.isoformat(), start, end, role

    @bp.post('/api/shifts')
    @admin
    def add_shift():
        data = payload()
        with db():
            db().execute('BEGIN IMMEDIATE')
            values = validate_shift(data)
            db().execute('INSERT INTO shifts(staff_id,day,start,end,role) VALUES (?,?,?,?,?)', values)
        return jsonify(ok=True), 201

    @bp.put('/api/shifts/<int:shift_id>')
    @admin
    def update_shift(shift_id):
        data = payload()
        with db():
            db().execute('BEGIN IMMEDIATE')
            if not db().execute('SELECT 1 FROM shifts WHERE id=?', (shift_id,)).fetchone():
                fail('근무를 찾을 수 없습니다.', 404)
            values = validate_shift(data, shift_id)
            db().execute('UPDATE shifts SET staff_id=?,day=?,start=?,end=?,role=? WHERE id=?', (*values, shift_id))
        return jsonify(ok=True)

    @bp.delete('/api/shifts/<int:shift_id>')
    @admin
    def delete_shift(shift_id):
        with db():
            db().execute('DELETE FROM shifts WHERE id=?', (shift_id,))
        return jsonify(ok=True)

    @bp.post('/api/schedule/copy')
    @admin
    def copy_week():
        data = payload()
        source, target = monday_of(data.get('source')), monday_of(data.get('target'))
        with db():
            db().execute('BEGIN IMMEDIATE')
            if shift_rows(target, target + timedelta(days=7)):
                fail('대상 주에 이미 시간표가 있습니다. 기존 근무는 덮어쓰지 않습니다.', 409)
            entries = shift_rows(source, source + timedelta(days=7))
            if not entries:
                fail('복사할 근무가 없습니다.')
            active_ids = {s['id'] for s in staff_rows() if s['active']}
            if any(s['staff_id'] not in active_ids for s in entries):
                fail('원본 주에 퇴직한 근무자가 포함되어 있습니다. 근무자를 확인해주세요.', 409)
            for entry in entries:
                day = parse_day(entry['day']) + (target - source)
                db().execute('INSERT INTO shifts(staff_id,day,start,end,role) VALUES (?,?,?,?,?)',
                    (entry['staff_id'], day.isoformat(), entry['start'], entry['end'], entry['role']))
        return jsonify(ok=True, count=len(entries))

    @bp.get('/api/status')
    def status():
        try:
            now = datetime.fromisoformat(request.args['at']) if 'at' in request.args else datetime.now(KOREA)
            if now.tzinfo is None:
                now = now.replace(tzinfo=KOREA)
            now = now.astimezone(KOREA)
        except ValueError:
            fail('기준 시각을 확인해주세요.')
        entries = shift_rows(now.date() - timedelta(days=7), now.date() + timedelta(days=8))
        for entry in entries:
            day = parse_day(entry['day'])
            midnight = datetime.combine(day, datetime.min.time(), KOREA)
            entry['_start'] = midnight + timedelta(minutes=entry['start'])
            entry['_end'] = midnight + timedelta(minutes=entry['end'])
        boundaries = sorted({point for entry in entries for point in (entry['_start'], entry['_end'])})
        previous_boundary = max((b for b in boundaries if b <= now), default=None)
        next_boundary = min((b for b in boundaries if b > now), default=None)
        def active(moment):
            if moment is None:
                return []
            return [{k: v for k, v in entry.items() if not k.startswith('_')} for entry in entries
                    if entry['_start'] <= moment < entry['_end']]
        # Between workdays, show the last occupied interval and the next occupied interval.
        current = active(now)
        previous_at = previous_boundary - timedelta(microseconds=1) if previous_boundary else None
        if not current and previous_at and not active(previous_at):
            previous_end = max((entry['_end'] for entry in entries if entry['_end'] <= now), default=None)
            previous_at = previous_end - timedelta(microseconds=1) if previous_end else None
        return jsonify(at=now.isoformat(), previous=active(previous_at), current=current,
                       next=active(next_boundary), previous_at=previous_boundary.isoformat() if previous_boundary else None,
                       next_at=next_boundary.isoformat() if next_boundary else None)

    def tagging_period(year, month=1):
        if not 2000 <= year <= 2100 or not 1 <= month <= 12:
            fail('연도와 월을 확인해주세요.')

    @bp.get('/api/tagging')
    def get_tagging():
        value = request.args.get('year', str(datetime.now(KOREA).year))
        if not re.fullmatch(r'[0-9]{4}', value):
            fail('연도를 확인해주세요.')
        year = int(value)
        tagging_period(year)
        people = db().execute('SELECT id,name,active FROM staff WHERE active=1 OR id IN '
                              '(SELECT staff_id FROM monthly_tags WHERE year=?) ORDER BY id', (year,))
        tags = db().execute('SELECT staff_id,month,completed FROM monthly_tags WHERE year=?', (year,))
        return jsonify(year=year, staff=[dict(row) for row in people], tags=[dict(row) for row in tags])

    @bp.put('/api/tagging/<int:person_id>/<int:year>/<int:month>')
    @admin
    def save_tagging(person_id, year, month):
        tagging_period(year, month)
        completed = payload().get('completed')
        if type(completed) is not bool:
            fail('태깅 완료 여부를 확인해주세요.')
        if not db().execute('SELECT 1 FROM staff WHERE id=?', (person_id,)).fetchone():
            fail('근무자를 찾을 수 없습니다.', 404)
        with db():
            db().execute('INSERT INTO monthly_tags(staff_id,year,month,completed,updated_by,updated_at) '
                         'VALUES (?,?,?,?,?,?) ON CONFLICT(staff_id,year,month) DO UPDATE SET '
                         'completed=excluded.completed,updated_by=excluded.updated_by,updated_at=excluded.updated_at',
                         (person_id, year, month, completed, g.user['id'], datetime.now(timezone.utc).isoformat()))
        return jsonify(ok=True)

    def archive_month(value):
        if not isinstance(value, str) or not re.fullmatch(r'[0-9]{4}-[0-9]{2}', value):
            fail('과월호 기준 월을 확인해주세요.')
        year, month = map(int, value.split('-'))
        tagging_period(year, month)
        return value

    @bp.get('/api/archive')
    def get_archive():
        month = archive_month(request.args.get('month', datetime.now(KOREA).strftime('%Y-%m')))
        draw = db().execute('SELECT d.*,u.username AS created_by_name FROM archive_draws d '
                            'JOIN users u ON u.id=d.created_by WHERE d.month=?', (month,)).fetchone()
        assignments = []
        if draw:
            for row in db().execute('SELECT * FROM archive_assignments WHERE draw_id=? ORDER BY group_number', (draw['id'],)):
                assignment = dict(row)
                assignment['tasks'] = [dict(task) for task in db().execute(
                    'SELECT t.*,u.username AS completed_by_name FROM archive_tasks t '
                    'LEFT JOIN users u ON u.id=t.completed_by WHERE t.assignment_id=? ORDER BY t.position', (row['id'],))]
                assignments.append(assignment)
        return jsonify(month=month, draw=dict(draw) if draw else None, assignments=assignments,
                       groups=ARCHIVE_GROUPS, participants=[dict(p) for p in db().execute('SELECT id,name FROM staff WHERE active=1 ORDER BY id')])

    def add_archive_assignments(draw_id, people):
        for number, (person, papers) in enumerate(zip(people, ARCHIVE_GROUPS), 1):
            assignment_id = db().execute('INSERT INTO archive_assignments(draw_id,group_number,staff_id,staff_name) '
                'VALUES (?,?,?,?)', (draw_id, number, person['id'], person['name'])).lastrowid
            db().executemany('INSERT INTO archive_tasks(assignment_id,position,newspaper) VALUES (?,?,?)',
                             [(assignment_id, index, paper) for index, paper in enumerate(papers)])

    @bp.post('/api/archive/draw')
    @admin
    def draw_archive():
        month = archive_month(payload().get('month'))
        with db():
            db().execute('BEGIN IMMEDIATE')
            if db().execute('SELECT 1 FROM archive_draws WHERE month=?', (month,)).fetchone():
                fail('이미 추첨한 월입니다. 저장된 결과를 확인해주세요.', 409)
            people = list(db().execute('SELECT id,name FROM staff WHERE active=1 ORDER BY id'))
            # shortcut: seven fixed groups require seven staff; add participant selection if staffing changes.
            if len(people) != len(ARCHIVE_GROUPS):
                fail('7개 신문 묶음의 추첨에는 재직 근무자 7명이 필요합니다. 인적관리를 확인해주세요.')
            secrets.SystemRandom().shuffle(people)
            draw_id = db().execute('INSERT INTO archive_draws(month,created_by,created_at) VALUES (?,?,?)',
                (month, g.user['id'], datetime.now(timezone.utc).isoformat())).lastrowid
            add_archive_assignments(draw_id, people)
        return jsonify(ok=True), 201

    @bp.put('/api/archive/assignments')
    @admin
    def manual_archive():
        data = payload()
        month = archive_month(data.get('month'))
        ids, expected = data.get('staff_ids'), data.get('expected')
        if (not isinstance(ids, list) or len(ids) != len(ARCHIVE_GROUPS)
                or any(type(value) is not int for value in ids) or len(set(ids)) != len(ids)):
            fail('7개 묶음의 담당자를 중복 없이 선택해주세요.')
        if expected is not None and (not isinstance(expected, list) or len(expected) != len(ARCHIVE_GROUPS)
                or any(type(value) is not int for value in expected)):
            fail('기존 담당 배정을 확인해주세요.')
        with db():
            db().execute('BEGIN IMMEDIATE')
            draw = db().execute('SELECT * FROM archive_draws WHERE month=?', (month,)).fetchone()
            existing = list(db().execute('SELECT * FROM archive_assignments WHERE draw_id=? ORDER BY group_number',
                                        (draw['id'],))) if draw else []
            current = [a['staff_id'] for a in existing] if existing else None
            if expected != current:
                fail('다른 관리자가 담당 배정을 변경했습니다. 새로고침 후 다시 확인해주세요.', 409)
            people = []
            for index, person_id in enumerate(ids):
                person = db().execute('SELECT id,name,active FROM staff WHERE id=?', (person_id,)).fetchone()
                unchanged = bool(existing) and existing[index]['staff_id'] == person_id
                if not person or (not person['active'] and not unchanged):
                    fail('재직 중인 근무자를 선택해주세요. 기존 비활성 담당자는 그대로 유지할 수 있습니다.')
                people.append({'id': person_id, 'name': existing[index]['staff_name'] if unchanged else person['name']})
            if not draw:
                draw_id = db().execute('INSERT INTO archive_draws(month,created_by,created_at) VALUES (?,?,?)',
                    (month, g.user['id'], datetime.now(timezone.utc).isoformat())).lastrowid
                add_archive_assignments(draw_id, people)
            elif ids != current:
                draw_id = draw['id']
                tasks = list(db().execute('SELECT t.* FROM archive_tasks t JOIN archive_assignments a '
                                         'ON a.id=t.assignment_id WHERE a.draw_id=?', (draw_id,)))
                # SQLite checks uniqueness per row; replace atomically with the same IDs to allow swaps.
                db().execute('DELETE FROM archive_tasks WHERE assignment_id IN '
                             '(SELECT id FROM archive_assignments WHERE draw_id=?)', (draw_id,))
                db().execute('DELETE FROM archive_assignments WHERE draw_id=?', (draw_id,))
                db().executemany('INSERT INTO archive_assignments(id,draw_id,group_number,staff_id,staff_name) '
                                 'VALUES (?,?,?,?,?)',
                                 [(old['id'], draw_id, old['group_number'], person['id'], person['name'])
                                  for old, person in zip(existing, people)])
                db().executemany('INSERT INTO archive_tasks(id,assignment_id,position,newspaper,completed,completed_by,completed_at) '
                                 'VALUES (?,?,?,?,?,?,?)', [tuple(task) for task in tasks])
        return jsonify(ok=True)

    @bp.put('/api/archive/tasks/<int:task_id>')
    def complete_archive(task_id):
        completed = payload().get('completed')
        if type(completed) is not bool:
            fail('완료 여부를 확인해주세요.')
        with db():
            db().execute('BEGIN IMMEDIATE')
            task = db().execute('SELECT t.id,a.staff_id FROM archive_tasks t JOIN archive_assignments a '
                                'ON a.id=t.assignment_id WHERE t.id=?', (task_id,)).fetchone()
            if not task:
                fail('신문사 과월호 항목을 찾을 수 없습니다.', 404)
            if g.user['role'] != 'admin' and task['staff_id'] != g.user['staff_id']:
                fail('본인이 담당한 신문사만 완료 체크할 수 있습니다.', 403)
            db().execute('UPDATE archive_tasks SET completed=?,completed_by=?,completed_at=? WHERE id=? AND completed<>?',
                (completed, g.user['id'] if completed else None,
                 datetime.now(timezone.utc).isoformat() if completed else None, task_id, completed))
        return jsonify(ok=True)

    @bp.get('/api/issues')
    def get_issues():
        day = request.args.get('day')
        if day:
            parse_day(day)
        # shortcut: latest 200 issues; add pagination when the team needs older history.
        rows = db().execute('SELECT i.*,u.username AS author FROM issues i JOIN users u ON u.id=i.author_id '
                            'WHERE (? IS NULL OR i.day=?) ORDER BY i.created_at DESC,i.id DESC LIMIT 200', (day, day))
        return jsonify([dict(row) for row in rows])

    @bp.post('/api/issues')
    def add_issue():
        data = payload()
        day = parse_day(data.get('day', datetime.now(KOREA).date().isoformat()))
        category = data.get('category')
        if category not in ('인계', '공지', '시설'):
            fail('이슈 구분을 확인해주세요.')
        title = text(data.get('title'), '제목', 80)
        body = text(data.get('body'), '내용', 1500)
        now = datetime.now(timezone.utc).isoformat()
        with db():
            db().execute('INSERT INTO issues(day,category,title,body,author_id,created_at,updated_at) VALUES (?,?,?,?,?,?,?)',
                         (day.isoformat(), category, title, body, g.user['id'], now, now))
        return jsonify(ok=True), 201

    @bp.patch('/api/issues/<int:issue_id>')
    def toggle_issue(issue_id):
        data = payload()
        if not isinstance(data.get('done'), bool):
            fail('이슈 상태를 확인해주세요.')
        with db():
            result = db().execute('UPDATE issues SET done=?,updated_at=? WHERE id=?',
                (data['done'], datetime.now(timezone.utc).isoformat(), issue_id))
            if result.rowcount == 0:
                fail('이슈를 찾을 수 없습니다.', 404)
        return jsonify(ok=True)

    @bp.get('/api/users')
    @admin
    def get_users():
        return jsonify([dict(row) for row in db().execute('SELECT id,username,role,active,staff_id FROM users ORDER BY id')])

    def linked_staff(value):
        if value is not None and (type(value) is not int or not db().execute('SELECT 1 FROM staff WHERE id=?', (value,)).fetchone()):
            fail('연결할 근무자를 확인해주세요.')
        return value

    @bp.post('/api/users')
    @admin
    def add_user():
        data = payload()
        username = text(data.get('username'), '아이디', 32)
        password = password_value(data.get('password'))
        if not re.fullmatch(r'[A-Za-z0-9_.-]{2,32}', username) or len(password) < 10:
            fail('아이디는 영문·숫자 2~32자, 비밀번호는 10자 이상으로 입력해주세요.')
        role = data.get('role', 'worker')
        if role not in ('admin', 'worker'):
            fail('권한을 확인해주세요.')
        person_id = linked_staff(data.get('staff_id'))
        with db():
            db().execute('INSERT INTO users(username,password_hash,role,staff_id) VALUES (?,?,?,?)',
                         (username, generate_password_hash(password), role, person_id))
        return jsonify(ok=True), 201

    @bp.patch('/api/users/<int:user_id>')
    @admin
    def update_user(user_id):
        data = payload()
        target = db().execute('SELECT * FROM users WHERE id=?', (user_id,)).fetchone()
        if not target:
            fail('계정을 찾을 수 없습니다.', 404)
        if not data or set(data) - {'active', 'staff_id'}:
            fail('계정 변경 항목을 확인해주세요.')
        active = data.get('active', bool(target['active']))
        if type(active) is not bool or (user_id == g.user['id'] and not active):
            fail('본인 계정은 비활성화할 수 없습니다.')
        person_id = linked_staff(data.get('staff_id', target['staff_id']))
        with db():
            db().execute('UPDATE users SET active=?,staff_id=?,version=version+1 WHERE id=?', (active, person_id, user_id))
        return jsonify(ok=True)

    @bp.post('/api/password')
    def password():
        data = payload()
        old = password_value(data.get('current'))
        new = password_value(data.get('password'))
        row = db().execute('SELECT * FROM users WHERE id=?', (g.user['id'],)).fetchone()
        if len(new) < 10 or not check_password_hash(row['password_hash'], old):
            fail('현재 비밀번호를 확인하고 새 비밀번호는 10자 이상 입력해주세요.')
        with db():
            db().execute('UPDATE users SET password_hash=?,version=version+1 WHERE id=?',
                         (generate_password_hash(new), row['id']))
        session.clear()
        return jsonify(ok=True)

    @bp.get('/api/backup')
    @admin
    def backup():
        # SQLite backup includes committed WAL changes in a consistent snapshot.
        target = sqlite3.connect(':memory:')
        try:
            db().backup(target)
            content = target.serialize()
        finally:
            target.close()
        return send_file(io.BytesIO(content), mimetype='application/octet-stream', as_attachment=True,
                         download_name=f'library-{datetime.now(KOREA):%Y%m%d-%H%M%S}.sqlite3')

    app.config['DUMMY_HASH'] = generate_password_hash(secrets.token_urlsafe(24))
    app.register_blueprint(bp)
    return app
