-- =====================================================================
--  Controle de Atividades · estrutura do banco (Supabase)
--  Cole tudo no SQL Editor do Supabase e clique em "Run".
--  Pode rodar de novo sem problema: não apaga dados existentes.
-- =====================================================================

-- ---------- Tabelas ---------------------------------------------------

create table if not exists public.perfis (
  id         uuid primary key references auth.users(id) on delete cascade,
  nome       text not null,
  email      text not null,
  status     text not null default 'aguardando'
             check (status in ('aguardando', 'aprovado', 'recusado')),
  admin      boolean not null default false,
  criado_em  timestamptz not null default now()
);

create table if not exists public.cidades (
  id         bigint generated always as identity primary key,
  nome       text not null,
  contrato   text not null default '',
  criado_em  timestamptz not null default now()
);

create table if not exists public.unidades (
  id            bigint generated always as identity primary key,
  cidade_id     bigint not null references public.cidades(id) on delete cascade,
  codigo        text not null,
  calc_resp     text,
  calc_status   text not null default 'A iniciar'
                check (calc_status in ('A iniciar','Iniciada','Finalizada','Emitida','Revisão 1','Revisão 2')),
  calc_prev     date,
  des_resp      text,
  des_status    text not null default 'A iniciar'
                check (des_status in ('A iniciar','Iniciada','Finalizada','Emitida','Revisão 1','Revisão 2')),
  des_prev      date,
  criado_em     timestamptz not null default now(),
  atualizado_em timestamptz not null default now(),
  unique (cidade_id, codigo)
);

-- O histórico guarda cópias dos nomes (cidade, unidade, usuário),
-- então continua legível mesmo se algo for excluído depois.
create table if not exists public.historico (
  id            bigint generated always as identity primary key,
  quando        timestamptz not null default now(),
  usuario_id    uuid,
  usuario_nome  text not null,
  cidade_id     bigint,
  cidade        text,
  unidade       text,
  campo         text not null,
  valor_antigo  text,
  valor_novo    text
);

create index if not exists historico_quando_idx on public.historico (quando desc);
create index if not exists unidades_cidade_idx  on public.unidades (cidade_id);

-- ---------- Funções de permissão --------------------------------------

create or replace function public.eh_aprovado() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.perfis where id = auth.uid() and status = 'aprovado');
$$;

create or replace function public.eh_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.perfis where id = auth.uid() and status = 'aprovado' and admin);
$$;

-- ---------- Novo cadastro -> perfil "aguardando" ----------------------
-- A primeira pessoa que se cadastrar vira administradora e já entra aprovada.

create or replace function public.novo_usuario() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  primeiro boolean;
begin
  select not exists (select 1 from public.perfis) into primeiro;
  insert into public.perfis (id, nome, email, status, admin)
  values (
    new.id,
    coalesce(nullif(trim(new.raw_user_meta_data->>'nome'), ''), split_part(new.email, '@', 1)),
    new.email,
    case when primeiro then 'aprovado' else 'aguardando' end,
    primeiro
  );
  return new;
end $$;

drop trigger if exists ao_criar_usuario on auth.users;
create trigger ao_criar_usuario
  after insert on auth.users
  for each row execute function public.novo_usuario();

-- ---------- Histórico automático ---------------------------------------
-- Toda alteração é gravada pelo próprio banco. Ninguém consegue escrever
-- ou apagar o histórico pelo aplicativo.

create or replace function public.registrar(
  p_cidade_id bigint, p_unidade text, p_campo text, p_antigo text, p_novo text
) returns void
language plpgsql security definer set search_path = public as $$
declare
  v_usuario text;
  v_cidade  text;
begin
  select nome into v_usuario from public.perfis where id = auth.uid();
  select nome into v_cidade  from public.cidades where id = p_cidade_id;
  insert into public.historico (usuario_id, usuario_nome, cidade_id, cidade, unidade, campo, valor_antigo, valor_novo)
  values (auth.uid(), coalesce(v_usuario, 'Sistema'), p_cidade_id, v_cidade, p_unidade, p_campo, p_antigo, p_novo);
end $$;

revoke execute on function public.registrar(bigint, text, text, text, text) from public, anon, authenticated;

create or replace function public.log_unidades() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    perform public.registrar(new.cidade_id, new.codigo, 'Unidade criada', null, null);
    return new;
  elsif tg_op = 'DELETE' then
    perform public.registrar(old.cidade_id, old.codigo, 'Unidade excluída', null, null);
    return old;
  end if;

  new.atualizado_em := now();
  if new.codigo is distinct from old.codigo then
    perform public.registrar(new.cidade_id, new.codigo, 'Código', old.codigo, new.codigo); end if;
  if new.calc_resp is distinct from old.calc_resp then
    perform public.registrar(new.cidade_id, new.codigo, 'Cálculo · Responsável', old.calc_resp, new.calc_resp); end if;
  if new.calc_status is distinct from old.calc_status then
    perform public.registrar(new.cidade_id, new.codigo, 'Cálculo · Status', old.calc_status, new.calc_status); end if;
  if new.calc_prev is distinct from old.calc_prev then
    perform public.registrar(new.cidade_id, new.codigo, 'Cálculo · Previsão',
      to_char(old.calc_prev, 'DD/MM/YYYY'), to_char(new.calc_prev, 'DD/MM/YYYY')); end if;
  if new.des_resp is distinct from old.des_resp then
    perform public.registrar(new.cidade_id, new.codigo, 'Desenho · Responsável', old.des_resp, new.des_resp); end if;
  if new.des_status is distinct from old.des_status then
    perform public.registrar(new.cidade_id, new.codigo, 'Desenho · Status', old.des_status, new.des_status); end if;
  if new.des_prev is distinct from old.des_prev then
    perform public.registrar(new.cidade_id, new.codigo, 'Desenho · Previsão',
      to_char(old.des_prev, 'DD/MM/YYYY'), to_char(new.des_prev, 'DD/MM/YYYY')); end if;
  return new;
end $$;

drop trigger if exists historico_unidades on public.unidades;
create trigger historico_unidades
  before insert or update or delete on public.unidades
  for each row execute function public.log_unidades();

create or replace function public.log_cidades() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    -- AFTER INSERT: a cidade já existe, então o nome aparece no histórico
    perform public.registrar(new.id, null, 'Cidade criada', null, new.contrato);
    return new;
  elsif tg_op = 'DELETE' then
    perform public.registrar(old.id, null, 'Cidade excluída', null, null);
    return old;
  end if;
  if new.nome is distinct from old.nome then
    perform public.registrar(new.id, null, 'Nome da cidade', old.nome, new.nome); end if;
  if new.contrato is distinct from old.contrato then
    perform public.registrar(new.id, null, 'Contrato', old.contrato, new.contrato); end if;
  return new;
end $$;

drop trigger if exists historico_cidades on public.cidades;
drop trigger if exists historico_cidades_ins on public.cidades;
create trigger historico_cidades_ins
  after insert on public.cidades
  for each row execute function public.log_cidades();
create trigger historico_cidades
  before update or delete on public.cidades
  for each row execute function public.log_cidades();

create or replace function public.log_perfis() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.status is distinct from old.status then
    perform public.registrar(null, null, 'Acesso de ' || new.nome, old.status, new.status); end if;
  if new.admin is distinct from old.admin then
    perform public.registrar(null, null, 'Administrador: ' || new.nome,
      case when old.admin then 'sim' else 'não' end, case when new.admin then 'sim' else 'não' end); end if;
  return new;
end $$;

drop trigger if exists historico_perfis on public.perfis;
create trigger historico_perfis
  after update on public.perfis
  for each row execute function public.log_perfis();

-- ---------- Segurança (Row Level Security) ----------------------------

alter table public.perfis    enable row level security;
alter table public.cidades   enable row level security;
alter table public.unidades  enable row level security;
alter table public.historico enable row level security;

drop policy if exists perfis_ver      on public.perfis;
drop policy if exists perfis_admin    on public.perfis;
drop policy if exists cidades_ver     on public.cidades;
drop policy if exists cidades_criar   on public.cidades;
drop policy if exists cidades_editar  on public.cidades;
drop policy if exists cidades_excluir on public.cidades;
drop policy if exists unidades_ver     on public.unidades;
drop policy if exists unidades_criar   on public.unidades;
drop policy if exists unidades_editar  on public.unidades;
drop policy if exists unidades_excluir on public.unidades;
drop policy if exists historico_ver   on public.historico;

-- Perfis: cada um vê o próprio; aprovados veem os outros aprovados
-- (para escolher responsáveis); só o administrador vê todos e altera.
create policy perfis_ver on public.perfis for select to authenticated
  using (id = auth.uid() or public.eh_admin() or (public.eh_aprovado() and status = 'aprovado'));
create policy perfis_admin on public.perfis for update to authenticated
  using (public.eh_admin()) with check (public.eh_admin());

-- Cidades e unidades: todo aprovado vê, cria e edita; só o admin exclui.
create policy cidades_ver     on public.cidades for select to authenticated using (public.eh_aprovado());
create policy cidades_criar   on public.cidades for insert to authenticated with check (public.eh_aprovado());
create policy cidades_editar  on public.cidades for update to authenticated using (public.eh_aprovado()) with check (public.eh_aprovado());
create policy cidades_excluir on public.cidades for delete to authenticated using (public.eh_admin());

create policy unidades_ver     on public.unidades for select to authenticated using (public.eh_aprovado());
create policy unidades_criar   on public.unidades for insert to authenticated with check (public.eh_aprovado());
create policy unidades_editar  on public.unidades for update to authenticated using (public.eh_aprovado()) with check (public.eh_aprovado());
create policy unidades_excluir on public.unidades for delete to authenticated using (public.eh_admin());

-- Histórico: só leitura (quem escreve é o banco, pelos gatilhos acima).
create policy historico_ver on public.historico for select to authenticated using (public.eh_aprovado());

-- ---------- Permissões de acesso pela API ------------------------------
-- (projetos novos do Supabase não liberam as tabelas automaticamente;
--  quem decide o que cada um vê são as regras de segurança acima)

grant usage on schema public to anon, authenticated;
grant select, insert, update, delete on public.cidades, public.unidades to authenticated;
grant select, update on public.perfis to authenticated;
grant select on public.historico to authenticated;
grant execute on function public.eh_aprovado(), public.eh_admin() to authenticated;

-- ---------- Tempo real -------------------------------------------------

do $$
declare t text;
begin
  foreach t in array array['perfis','cidades','unidades','historico'] loop
    begin
      execute format('alter publication supabase_realtime add table public.%I', t);
    exception when duplicate_object then null;
    end;
  end loop;
end $$;
