"""Database checks: migrations, knowledge base loading, and row-level security between schools."""
import psycopg

from app import db
import load_kb
import migrate


def test_migrations_are_idempotent(pg):
    assert migrate.migrate(pg, quiet=True) == []


def test_load_kb_twice_changes_nothing(pg):
    counts = load_kb.load(pg, quiet=True)
    with psycopg.connect(pg) as con:
        n_nodes = con.execute("select count(*) from kg_node where active").fetchone()[0]
        n_edges = con.execute("select count(*) from kg_edge").fetchone()[0]
        before = con.execute("select max(xmin::text::bigint) from kg_node").fetchone()[0]
    assert n_edges == counts["edges"]
    assert n_nodes == counts["nodes"]
    load_kb.load(pg, quiet=True)
    with psycopg.connect(pg) as con:
        after = con.execute("select max(xmin::text::bigint) from kg_node").fetchone()[0]
    assert after == before  # no row rewritten


def _seed(con):
    con.execute("insert into school values ('sch_a', 'School A', 'Dharmapuri'), ('sch_b', 'School B', 'Salem')")
    con.execute("insert into student(id, school_id) values ('st_a', 'sch_a'), ('st_b', 'sch_b')")
    con.execute("insert into student_private values ('st_a', 'Meena', null), ('st_b', 'Kavya', null)")
    con.execute("insert into evidence_event(id, student_id, device_id, kind, created_at) values "
                "('ev_a', 'st_a', 'dev1', 'self_report', now()), ('ev_b', 'st_b', 'dev2', 'self_report', now())")


def test_school_cannot_see_another_school(pg):
    with db.connect() as con:  # trusted: all schools
        _seed(con)
    with db.connect(schools=["sch_a"]) as con:
        assert [r["id"] for r in con.execute("select id from student order by id")] == ["st_a"]
        assert [r["id"] for r in con.execute("select id from evidence_event")] == ["ev_a"]
        assert con.execute("select * from student_private where student_id = 'st_b'").fetchall() == []
        assert con.execute("select * from evidence_event where student_id = 'st_b'").fetchall() == []


def test_no_scope_sees_nothing_and_cannot_write_elsewhere(pg):
    with db.connect() as con:
        _seed(con)
    with db.connect(schools=[]) as con:
        assert con.execute("select count(*) as n from student").fetchone()["n"] == 0
    try:
        with db.connect(schools=["sch_a"]) as con:
            con.execute("insert into evidence_event(id, student_id, device_id, kind, created_at) "
                        "values ('ev_x', 'st_b', 'dev1', 'rating', now())")
        raise AssertionError("insert for another school's student should be refused")
    except psycopg.errors.InsufficientPrivilege:
        pass


def test_readonly_role_cannot_read_names(pg):
    with db.connect() as con:
        _seed(con)
    with psycopg.connect(pg) as con:
        con.execute("set role disha_readonly")
        assert con.execute("select count(*) from student").fetchone()[0] == 2
        try:
            con.execute("select * from student_private")
            raise AssertionError("readonly role should not read student_private")
        except psycopg.errors.InsufficientPrivilege:
            pass


def test_deleting_a_student_removes_everything(pg):
    with db.connect() as con:
        _seed(con)
        con.execute("delete from student where id = 'st_a'")
        for table in ("student_private", "evidence_event"):
            n = con.execute(f"select count(*) as n from {table} where student_id = 'st_a'").fetchone()["n"]
            assert n == 0, table
