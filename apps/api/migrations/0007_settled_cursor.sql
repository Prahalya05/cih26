-- received_at records when the row was inserted (not when its transaction began), so the sync cursor can
-- wait until an event number is old enough that no earlier number can still be committing (see v2.sync).
alter table evidence_event alter column received_at set default clock_timestamp();
create index on evidence_event (student_id, seq);
