BEGIN IMMEDIATE;
ALTER TABLE duty_contact ADD COLUMN day TEXT NOT NULL DEFAULT '';
UPDATE duty_contact SET day=date('now','+9 hours');
PRAGMA user_version=6;
COMMIT;
