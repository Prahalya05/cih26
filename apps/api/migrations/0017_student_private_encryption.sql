-- Encrypt any remaining plaintext PII in student_private with PII_KEY, then drop plaintext columns.
-- scripts/migrate.py sets app.pii_key from settings.pii_key() for this transaction.
do $$
declare
  k text := nullif(current_setting('app.pii_key', true), '');
begin
  if exists (
    select 1 from student_private
    where name is not null or phone is not null or guardian_name is not null
  ) then
    if k is null then
      raise exception 'app.pii_key must be set to encrypt existing student_private rows (run via scripts/migrate.py with PII_KEY set)';
    end if;
    update student_private
    set
      name_enc = case when name is not null then pgp_sym_encrypt(name, k) else name_enc end,
      phone_enc = case when phone is not null then pgp_sym_encrypt(phone, k) else phone_enc end,
      guardian_name_enc = case when guardian_name is not null then pgp_sym_encrypt(guardian_name, k) else guardian_name_enc end
    where name is not null or phone is not null or guardian_name is not null;
  end if;
end $$;

alter table student_private drop column if exists name;
alter table student_private drop column if exists phone;
alter table student_private drop column if exists guardian_name;
