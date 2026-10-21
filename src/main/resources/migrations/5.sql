BEGIN IMMEDIATE;
                CREATE TABLE duty_contact (
                    id INTEGER PRIMARY KEY CHECK(id=1), teacher TEXT NOT NULL, extension TEXT NOT NULL
                );
                PRAGMA user_version=5;
                COMMIT;