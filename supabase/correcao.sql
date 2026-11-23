-- Correção: libera o acesso às tabelas e cria o perfil que faltou
grant usage on schema public to anon, authenticated;
grant select, insert, update, delete on public.cidades, public.unidades to authenticated;
grant select, update on public.perfis to authenticated;
grant select on public.historico to authenticated;
grant execute on function public.eh_aprovado(), public.eh_admin() to authenticated;

insert into public.perfis (id, nome, email, status, admin)
select u.id,
       coalesce(nullif(trim(u.raw_user_meta_data->>'nome'), ''), split_part(u.email, '@', 1)),
       u.email,
       case when sem_perfis and n = 1 then 'aprovado' else 'aguardando' end,
       sem_perfis and n = 1
from (select *, row_number() over (order by created_at) as n,
             not exists (select 1 from public.perfis) as sem_perfis
      from auth.users) u
where not exists (select 1 from public.perfis p where p.id = u.id);

select nome, email, status, admin from public.perfis;
