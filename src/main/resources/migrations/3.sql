BEGIN IMMEDIATE;
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
                COMMIT;