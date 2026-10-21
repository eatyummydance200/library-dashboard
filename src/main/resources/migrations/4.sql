BEGIN IMMEDIATE;
                CREATE TABLE shifts_v4 (
                    id INTEGER PRIMARY KEY, staff_id INTEGER NOT NULL REFERENCES staff(id), day TEXT NOT NULL,
                    start INTEGER NOT NULL CHECK(start>=540 AND start%30=0),
                    end INTEGER NOT NULL CHECK(end<=1320 AND end%30=0 AND end>start),
                    role TEXT NOT NULL CHECK(role IN ('desk','general'))
                );
                INSERT INTO shifts_v4(id,staff_id,day,start,end,role) SELECT id,staff_id,day,start,end,role FROM shifts;
                DROP TABLE shifts;
                ALTER TABLE shifts_v4 RENAME TO shifts;
                CREATE INDEX shifts_day ON shifts(day);
                PRAGMA user_version=4;
                COMMIT;