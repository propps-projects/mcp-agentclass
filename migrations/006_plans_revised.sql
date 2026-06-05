-- Phase 3.1 iteration — revised tier limits after persona pricing review.
--
-- Decisions:
--   - Cursos: 1 / 3 / 5 / unlimited (tighter, forces upgrade as catalog grows)
--   - Transcrição: 15h / 60h / 200h / unlimited (Starter +5h vs original draft
--     to reduce mês 1 friction without separate "credit one-time" model)
--   - Alunos ativos: 100 / 500 / 2000 / unlimited (unchanged — LLM tokens
--     paid by the student via Claude/ChatGPT subscription; only server-side
--     ~$0.00001/call hits our infra, so we can be generous here)
--   - KB tamanho: 100MB / 500MB / 2GB / unlimited (unchanged)
-- Pricing unchanged: R$ 99 / 299 / 999 / sob proposta.

UPDATE plans SET max_courses = 1,  transcribe_hours_month = 15  WHERE id = 'starter';
UPDATE plans SET max_courses = 3,  transcribe_hours_month = 60  WHERE id = 'pro';
UPDATE plans SET max_courses = 5,  transcribe_hours_month = 200 WHERE id = 'scale';
