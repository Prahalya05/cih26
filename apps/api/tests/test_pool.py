"""The connection pool is made once even when many threads ask for it at the same moment."""
import threading

from app import db


def test_one_pool_under_concurrent_first_use(pg):
    db.close_pool()
    made: list = []
    original = db.ConnectionPool

    def counting(*args, **kwargs):
        p = original(*args, **kwargs)
        made.append(p)
        return p

    db.ConnectionPool = counting
    try:
        start = threading.Barrier(32)
        seen = []

        def first_use():
            start.wait()
            seen.append(db.pool())

        threads = [threading.Thread(target=first_use) for _ in range(32)]
        for t in threads:
            t.start()
        for t in threads:
            t.join()
    finally:
        db.ConnectionPool = original
    assert len(made) == 1
    assert all(p is made[0] for p in seen)
    with db.connect() as con:
        assert con.execute("select 1 as one").fetchone()["one"] == 1
