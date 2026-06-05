# Supabase Setup — Askine

Passos pra provisionar o Supabase, rodar a migration e ligar no MCP server.

## 1. Criar projeto Supabase

1. Acessa https://supabase.com/dashboard → **New project**
2. Org: você (ou crie uma "Askine")
3. Project name: `askine-prod` (ou `askine-dev` se quiser separar ambientes)
4. Database password: gera uma forte e guarda em cofre
5. Region: **South America (São Paulo)** — `sa-east-1`
6. Pricing plan: **Free** dá pra começar (8 GB DB, 1 GB storage, 50k MAU); upgrade pra **Pro ($25/mês)** quando passar disso

Aguarda o projeto provisionar (~2-3min).

## 2. Habilitar pgvector

Já vem incluído no Supabase. Não precisa fazer nada — a migration ativa via `CREATE EXTENSION IF NOT EXISTS "vector"`.

## 3. Rodar a migration

1. No dashboard do projeto → **SQL Editor** (ícone de banco de dados na esquerda)
2. Clica em **New query**
3. Cola todo o conteúdo de [`migrations/001_init.sql`](../migrations/001_init.sql)
4. Clica em **Run** (canto inferior direito)
5. Deve aparecer "Success. No rows returned."

Se der erro, copia a mensagem e me manda — provavelmente é variação de versão do Postgres.

## 4. Verificar schema

No mesmo SQL Editor, roda:

```sql
SELECT table_name FROM information_schema.tables
WHERE table_schema = 'public' ORDER BY table_name;
```

Deve listar (em alfabética):
- chunks
- course_access
- courses
- lessons
- magic_links
- materials
- oauth_access_tokens
- oauth_authorization_codes
- oauth_clients
- oauth_refresh_tokens
- rate_limit_buckets
- search_queries
- student_progress
- students
- tenants
- tool_calls
- usage_events

**17 tabelas no total.**

## 5. Coletar credenciais

No dashboard do projeto → **Settings** → **API**:

- **Project URL** (`https://xxxxxxxxxxxxx.supabase.co`) → copiar
- **Project API keys**:
  - `anon` `public` → vamos usar no frontend (Phase 2+)
  - `service_role` `secret` → **CRÍTICO**, nunca commitar — usa só no backend

Em **Settings** → **Database**:

- **Connection string** (modo **Session** ou **Transaction** — pega o **Pooler** com porta `6543` pra produção, vai ser mais estável que conexão direta porta `5432`)

## 6. Configurar variáveis no EasyPanel

Adicionar essas env vars no app `mcp-agentclass`:

```
SUPABASE_URL=https://xxxxxxxxxxxxx.supabase.co
SUPABASE_SERVICE_ROLE_KEY=eyJhbGciOi...<a chave service_role>
SUPABASE_ANON_KEY=eyJhbGciOi...<a chave anon>
DATABASE_URL=postgresql://postgres.xxx:<password>@aws-0-sa-east-1.pooler.supabase.com:6543/postgres
```

> A `DATABASE_URL` vai ser usada pra queries diretas via `postgres` lib (mais rápido que o cliente Supabase JS pra operações batch).

**Save & Restart** o container no EasyPanel.

## 7. Habilitar Storage bucket (pra áudios temp + materials)

No dashboard → **Storage** → **New bucket**:

- Nome: `audio-temp` → **Private**
- Nome: `materials` → **Private**

Os buckets ficarão prontos pra uso na Sub-fase 0.4 (import VMA) e Fase 2 (ingest novos cursos).

## 8. Próximo passo

Quando tiver feito 1-7, me avisa que eu sigo com a Sub-fase 0.2 (path routing + tenant resolution).

---

## Troubleshooting

**"permission denied for schema public"**
- Você tá usando a `anon` key. Tem que ser `service_role` no backend.

**"extension vector is not allowed"**
- Você tá num plano Free muito antigo. Faz upgrade pra Pro ou cria um projeto novo (versões recentes já incluem `vector`).

**Conexão fica caindo / timeout**
- Usa o connection string do **Pooler** (porta 6543), não o direto (5432).
- Aumenta `connection_limit` no client se for muita concorrência.

**Não sei a senha do banco**
- Settings → Database → "Reset database password". A senha não dá pra recuperar, só resetar.
