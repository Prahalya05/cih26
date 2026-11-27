-- Hardening paid-job confirmation: anti-self-confirm fingerprint, optional buyer OTP HMAC (never raw phone).
alter table confirm_token
  add column if not exists creator_fp text,
  add column if not exists buyer_hmac text,
  add column if not exists otp_code_hash text,
  add column if not exists otp_expires_at timestamptz,
  add column if not exists otp_tries int not null default 0,
  add column if not exists otp_verified_at timestamptz;
