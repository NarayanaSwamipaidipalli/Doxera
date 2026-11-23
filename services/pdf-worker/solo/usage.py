"""Anonymous daily totals only: no documents, request data or user identifiers."""
from contextlib import contextmanager
from datetime import datetime, timedelta, timezone
from pathlib import Path
import sqlite3

from solo.catalog import TOOLS


DATA_DIRECTORY = Path("/data")
LOCAL_DIRECTORY = Path.home() / ".local" / "share" / "doxera"
STATS_TIMEZONE = timezone(timedelta(hours=5, minutes=30), "IST")


def database_path():
    directory = DATA_DIRECTORY if DATA_DIRECTORY.is_dir() else LOCAL_DIRECTORY
    return directory / "usage.db"


def today():
    return datetime.now(STATS_TIMEZONE).date()


@contextmanager
def database():
    path = database_path()
    path.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
    connection = sqlite3.connect(path, timeout=5)
    try:
        connection.execute("PRAGMA journal_mode=WAL")
        connection.execute("""CREATE TABLE IF NOT EXISTS daily_usage (
            tool TEXT NOT NULL,
            day TEXT NOT NULL,
            successes INTEGER NOT NULL DEFAULT 0 CHECK (successes >= 0),
            failures INTEGER NOT NULL DEFAULT 0 CHECK (failures >= 0),
            PRIMARY KEY (tool, day)
        )""")
        yield connection
    finally:
        connection.close()


def record_tool_use(slug, succeeded):
    # Names come only from the server's allowlist. The legacy encryption alias
    # shares Protect PDF's name and therefore increments the same daily total.
    name = TOOLS[slug].name
    successes, failures = (1, 0) if succeeded else (0, 1)
    with database() as connection:
        with connection:
            connection.execute("""INSERT INTO daily_usage (tool, day, successes, failures)
                VALUES (?, ?, ?, ?)
                ON CONFLICT(tool, day) DO UPDATE SET
                    successes = successes + excluded.successes,
                    failures = failures + excluded.failures""",
                (name, today().isoformat(), successes, failures))


def read_stats():
    end = today()
    start = end - timedelta(days=29)
    with database() as connection:
        # Keep the all-time and daily tables in the same read snapshot.
        with connection:
            connection.execute("BEGIN")
            tools = connection.execute("""SELECT tool, SUM(successes), SUM(failures)
                FROM daily_usage GROUP BY tool ORDER BY tool""").fetchall()
            days = connection.execute("""SELECT day, SUM(successes), SUM(failures)
                FROM daily_usage WHERE day BETWEEN ? AND ? GROUP BY day ORDER BY day""",
                (start.isoformat(), end.isoformat())).fetchall()

    def counts(successes=0, failures=0):
        return {"successes": successes, "failures": failures, "total": successes + failures}

    by_tool = {tool.name: counts() for tool in TOOLS.values()}
    by_tool.update({name: counts(successes, failures) for name, successes, failures in tools})
    by_day = {day: counts(successes, failures) for day, successes, failures in days}
    daily = [{"day": (start + timedelta(days=offset)).isoformat(),
              **by_day.get((start + timedelta(days=offset)).isoformat(), counts())}
             for offset in range(30)]
    return {
        "tools": [{"name": name, **by_tool[name]} for name in sorted(by_tool)],
        "days": daily,
        "totals": counts(sum(item["successes"] for item in by_tool.values()),
                         sum(item["failures"] for item in by_tool.values())),
    }
