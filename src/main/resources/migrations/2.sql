BEGIN;
                CREATE TABLE IF NOT EXISTS monthly_tags (
                    staff_id INTEGER NOT NULL REFERENCES staff(id),
                    year INTEGER NOT NULL CHECK(year BETWEEN 2000 AND 2100),
                    month INTEGER NOT NULL CHECK(month BETWEEN 1 AND 12),
                    completed INTEGER NOT NULL CHECK(completed IN (0,1)),
                    updated_by INTEGER NOT NULL REFERENCES users(id), updated_at TEXT NOT NULL,
                    PRIMARY KEY(staff_id,year,month)
                );
                PRAGMA user_version=2;
                COMMIT;