CREATE TABLE staff (
 id INTEGER PRIMARY KEY, name TEXT NOT NULL UNIQUE,
 phone TEXT NOT NULL DEFAULT '', active INTEGER NOT NULL DEFAULT 1 CHECK(active IN (0,1))
);
CREATE TABLE users (
 id INTEGER PRIMARY KEY, username TEXT NOT NULL UNIQUE, password_hash TEXT NOT NULL,
 role TEXT NOT NULL CHECK(role IN ('admin','worker')),
 active INTEGER NOT NULL DEFAULT 1 CHECK(active IN (0,1)), version INTEGER NOT NULL DEFAULT 1
);
CREATE TABLE shifts (
 id INTEGER PRIMARY KEY, staff_id INTEGER NOT NULL REFERENCES staff(id), day TEXT NOT NULL,
 start INTEGER NOT NULL CHECK(start>=540 AND start%30=0),
 end INTEGER NOT NULL CHECK(end<=1260 AND end%30=0 AND end>start),
 role TEXT NOT NULL CHECK(role IN ('desk','general'))
);
CREATE INDEX shifts_day ON shifts(day);
CREATE TABLE issues (
 id INTEGER PRIMARY KEY, day TEXT NOT NULL, category TEXT NOT NULL,
 title TEXT NOT NULL, body TEXT NOT NULL,
 author_id INTEGER NOT NULL REFERENCES users(id), done INTEGER NOT NULL DEFAULT 0 CHECK(done IN (0,1)),
 created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);
CREATE INDEX issues_day ON issues(day);
CREATE TABLE login_attempts (username TEXT NOT NULL, attempted_at INTEGER NOT NULL);
CREATE INDEX login_attempts_time ON login_attempts(username,attempted_at);
PRAGMA user_version=1;
