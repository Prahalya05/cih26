-- Level probabilities can be tiny (1e-50); real (float4) underflows. Use double precision.
alter table skill_state alter column p_level type double precision[];
