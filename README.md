# Controle de Atividades · como colocar no ar

São 4 etapas. A primeira vez leva uns 15 minutos.

## Arquivos

| Arquivo | Para que serve |
|---|---|
| `site/index.html` | A página do aplicativo |
| `site/style.css` | Visual (cores, tabela, telas) |
| `site/app.js` | Funcionamento: login, cidades, unidades, aprovações, histórico |
| `site/config.js` | Endereço e chave pública do Supabase |
| `supabase/banco.sql` | Cria as tabelas, a segurança e o histórico no Supabase |
| `supabase/correcao.sql` | Correção de permissões (já aplicada) |

Sempre que o `banco.sql` mudar, rode o arquivo inteiro de novo no SQL Editor. Ele só acrescenta o que falta e não apaga dados.
| `netlify.toml` | Diz ao Netlify para publicar a pasta `site` |

**Publicação automática:** o Netlify está ligado a este repositório. Qualquer mudança enviada para a branch `main` é publicada sozinha em cerca de 1 minuto.

## 1. Criar o projeto no Supabase

1. Entre em **supabase.com**, clique em *Start your project* e crie uma conta (pode ser com o GitHub ou e-mail).
2. Clique em **New project**. Dê um nome (ex.: `controle-atividades`), crie uma senha para o banco (guarde-a) e escolha a região **South America (São Paulo)**.
3. Espere uns 2 minutos até o projeto ficar pronto.

## 2. Criar o banco

1. No menu da esquerda, abra **SQL Editor**.
2. Clique em **New query**, cole **todo** o conteúdo de `banco.sql` e clique em **Run**.
3. Deve aparecer *Success. No rows returned*. Em **Table Editor** você vai ver as tabelas `cidades` (já com as 5 cidades), `unidades`, `perfis` e `historico`.

Desligue a confirmação por e-mail, já que você aprova as contas manualmente:

4. Vá em **Authentication → Sign In / Providers → Email** e desmarque **Confirm email**. Salve.

## 3. Ligar o aplicativo ao Supabase

1. Vá em **Project Settings → API** (ou *Data API*).
2. Copie a **Project URL** e a chave **anon public**.
3. Abra `config.js` num editor de texto (o Bloco de Notas serve) e cole os dois valores entre as aspas:

```js
const SUPABASE_URL = "https://abcdxyz.supabase.co";
const SUPABASE_ANON_KEY = "eyJhbGciOi...";
```

A chave *anon* pode ficar no arquivo sem problema: quem protege os dados são as regras do banco. **Nunca** coloque a chave *service_role* nesse arquivo.

## 4. Publicar (Netlify, grátis)

1. Entre em **app.netlify.com/drop** (crie uma conta se pedir).
2. Arraste a pasta `controle-atividades` inteira para a página.
3. Em segundos aparece um link do tipo `https://nome-aleatorio.netlify.app`. Em *Site configuration → Change site name* você pode trocar para algo como `controle-atividades-eb.netlify.app`.

Para atualizar depois: em *Deploys*, arraste a pasta de novo.

## Primeiro acesso

1. Abra o link e clique em **Criar conta**. **Você precisa ser a primeira pessoa a se cadastrar:** a primeira conta vira administradora e já entra aprovada.
2. Depois mande o link para a equipe. Cada pessoa cria a conta e vê a mensagem "aguardando aprovação".
3. Na aba **Aprovações** (só você vê), clique em **Aprovar**. A tela da pessoa abre sozinha.

## Como funciona

- **Quem pode o quê:** todo usuário aprovado vê e edita tudo (cidades, unidades, responsáveis, status e datas). Só o administrador aprova contas, remove acesso e exclui unidades.
- **Histórico:** cada alteração é gravada pelo próprio banco com quem fez, o que mudou, o valor antigo, o novo e a hora. Ninguém consegue editar nem apagar o histórico pelo aplicativo.
- **Tempo real:** quando alguém muda algo, a tela dos outros atualiza sozinha.
- **Atraso:** uma atividade está atrasada quando a previsão de entrega já passou e o status ainda não é *Emitida*.
- **Responsáveis:** a lista mostra os usuários aprovados. O banco grava quem designou cada atividade e quando.
- **Minhas atividades:** quem não é administrador abre o Início já filtrado nas atividades designadas para si, e pode recusar (tirar o próprio nome).
- **Cidades encerradas:** o administrador encerra ou reabre uma cidade. Encerradas saem do Início e ficam só para consulta.
- **Divisões:** ao adicionar uma unidade, escolha uma divisão que já existe na cidade, crie uma nova ou deixe sem divisão.

## Tarefas de manutenção (no Supabase)

- **Tornar outra pessoa administradora:** *Table Editor → perfis*, mude a coluna `admin` dessa pessoa para `true`.
- **Excluir uma cidade:** *Table Editor → cidades*, apague a linha (as unidades dela também são apagadas; o histórico fica).
- **Esqueceu a senha:** *Authentication → Users*, clique no usuário e use *Send password recovery* ou exclua o usuário para ele se cadastrar de novo.
- **Plano grátis:** se ninguém usar o aplicativo por 7 dias seguidos, o Supabase pausa o projeto. É só entrar no painel e clicar em *Restore*.
