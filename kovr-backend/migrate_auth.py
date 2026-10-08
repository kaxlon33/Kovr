"""
One-time migration for authentication support.

Creates the `users` table and adds a nullable `user_id` column to the
existing `scans` table. Written as raw SQL (not Base.metadata.create_all)
because create_all never alters tables that already exist — and `scans`
already exists with real data.

Safe to re-run: every statement is guarded with IF NOT EXISTS.
"""
from dotenv import load_dotenv

load_dotenv(override=True)

from sqlalchemy import text

from app.core.database import engine

STATEMENTS = [
    # Users table — id is a uuid string to match the existing Scan/Finding style
    """
    CREATE TABLE IF NOT EXISTS users (
        id VARCHAR PRIMARY KEY,
        email VARCHAR NOT NULL UNIQUE,
        hashed_password VARCHAR NOT NULL,
        role VARCHAR NOT NULL DEFAULT 'user',
        created_at TIMESTAMPTZ DEFAULT now()
    )
    """,
    "CREATE UNIQUE INDEX IF NOT EXISTS ix_users_email ON users (email)",
    # Nullable: scans created before auth exists keep working (admin-visible only)
    "ALTER TABLE scans ADD COLUMN IF NOT EXISTS user_id VARCHAR REFERENCES users(id)",
]


def run():
    with engine.begin() as conn:
        for statement in STATEMENTS:
            conn.execute(text(statement))
    print("Auth migration complete: users table ready, scans.user_id added (if missing).")


if __name__ == "__main__":
    run()
