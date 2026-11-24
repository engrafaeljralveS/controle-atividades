"use strict";
// =====================================================================
//  Controle de Atividades · lógica do aplicativo
// =====================================================================

const STATUS = [["A iniciar","todo"],["Iniciada","run"],["Finalizada","done"],["Emitida","emit"],["Revisão 1","rev1"],["Revisão 2","rev2"]];
const COR = Object.fromEntries(STATUS);
const app = document.getElementById("app");

const S = {
  session: null, uid: null, perfil: null, carregado: false,
  cidades: [], unidades: [], historico: [], perfis: [],
  filtro: "todas", busca: "", editCidade: false, confirmDel: null, confirmDelCidade: false,
  modo: null, abaCid: "ativas", pedidoCid: null, divSel: "todas", fc: "", fd: "", recusa: null,
};

// ---------- utilitários ------------------------------------------------
const pad = n => String(n).padStart(2, "0");
const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
const hoje = () => { const d = new Date(); return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}`; };
const br = d => d ? d.split("-").reverse().join("/") : "—";
const atrasada = (st, d) => !!d && st !== "Emitida" && d < hoje();
const diasAtraso = d => Math.round((new Date(hoje()+"T12:00") - new Date(d+"T12:00")) / 864e5);
const quando = ts => { const d = new Date(ts); return `${pad(d.getDate())}/${pad(d.getMonth()+1)}/${d.getFullYear()} · ${pad(d.getHours())}:${pad(d.getMinutes())}`; };
const iniciais = n => n ? n.trim().split(/\s+/).map(p => p[0]).slice(0, 2).join("").toUpperCase() : "?";
const cidadeAtual = () => { const m = location.hash.match(/^#cidade-(\d+)$/); return m ? S.cidades.find(c => c.id === +m[1]) : null; };

function toast(msg, erro) {
  const t = document.getElementById("toast");
  t.textContent = msg; t.className = "toast" + (erro ? " erro" : ""); t.hidden = false;
  clearTimeout(toast.t); toast.t = setTimeout(() => { t.hidden = true; }, erro ? 7000 : 2500);
}
function traduz(m) {
  m = String(m || "");
  if (/Invalid login/i.test(m)) return "E-mail ou senha incorretos.";
  if (/already registered|already been registered/i.test(m)) return "Já existe uma conta com esse e-mail.";
  if (/at least 6/i.test(m)) return "A senha precisa ter pelo menos 6 caracteres.";
  if (/Email not confirmed/i.test(m)) return "Confirme seu e-mail antes de entrar (veja sua caixa de entrada).";
  if (/duplicate key/i.test(m)) return "Já existe uma unidade com esse código nesta cidade.";
  if (/same.*password|different from the old/i.test(m)) return "A senha nova precisa ser diferente da atual.";
  if (/rate limit|too many/i.test(m)) return "Muitas tentativas seguidas. Espere alguns minutos e tente de novo.";
  if (/Só o administrador/i.test(m)) return "Só o administrador pode encerrar ou reabrir cidades.";
  if (/row-level security/i.test(m)) return "Você não tem permissão para essa alteração.";
  return m;
}

// ---------- configuração ---------------------------------------------
if (typeof SUPABASE_URL === "undefined" || !/^https:\/\//.test(SUPABASE_URL) || typeof supabase === "undefined") {
  app.innerHTML = `<div class="msg"><h2>Falta configurar</h2><p>Abra o arquivo <code>config.js</code> e cole a URL e a chave <b>anon</b> do seu projeto Supabase.</p></div>`;
  throw new Error("config.js não preenchido");
}
const sb = supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

// ---------- sessão e dados ---------------------------------------------
let canal = null, tmr = null;

sb.auth.onAuthStateChange((evento, session) => {
  if (evento === "PASSWORD_RECOVERY") { S.novaSenha = "recuperar"; setTimeout(render, 0); }
  S.session = session;
  const id = session?.user?.id ?? null;
  if (id !== S.uid || evento === "INITIAL_SESSION") { S.uid = id; setTimeout(iniciar, 0); }
});

async function iniciar() {
  if (canal) { sb.removeChannel(canal); canal = null; }
  S.carregado = false; S.perfil = null;
  if (!S.session) { S.carregado = true; render(); return; }
  render();
  const { data, error } = await sb.from("perfis").select("*").eq("id", S.uid).maybeSingle();
  S.erroPerfil = error ? error.message : "";
  S.perfil = data;
  if (data?.status === "aprovado") await carregar();
  S.carregado = true;
  canal = sb.channel("mudancas")
    .on("postgres_changes", { event: "*", schema: "public" }, () => { clearTimeout(tmr); tmr = setTimeout(atualizar, 400); })
    .subscribe();
  render();
}

async function carregar() {
  const [c, u, h, p] = await Promise.all([
    sb.from("cidades").select("*").order("nome"),
    sb.from("unidades").select("*").order("codigo"),
    sb.from("historico").select("*").order("quando", { ascending: false }).limit(500),
    sb.from("perfis").select("*").order("nome"),
  ]);
  const erro = [c, u, h, p].find(r => r.error);
  if (erro) toast("Erro ao carregar dados: " + erro.error.message, true);
  S.cidades = c.data || []; S.unidades = u.data || []; S.historico = h.data || []; S.perfis = p.data || [];
  const eu = S.perfis.find(x => x.id === S.uid);
  if (eu) S.perfil = eu;
}

// Chamado quando alguém altera algo (tempo real)
async function atualizar() {
  if (S.perfil?.status !== "aprovado") {
    const { data } = await sb.from("perfis").select("*").eq("id", S.uid).maybeSingle();
    if (data?.status === "aprovado") return iniciar();
    S.perfil = data; return renderDepois();
  }
  await carregar();
  renderDepois();
}

// Não redesenha enquanto a pessoa está digitando num campo
function renderDepois() {
  const a = document.activeElement;
  if (a && app.contains(a) && a.tagName === "INPUT") a.addEventListener("blur", () => setTimeout(render, 0), { once: true });
  else render();
}

// ---------- telas -----------------------------------------------------
function render() {
  const h = location.hash.slice(1);
  if (!S.carregado) { app.innerHTML = `<div class="msg">Carregando…</div>`; return; }
  if (!S.session) { app.innerHTML = h === "cadastro" ? telaCadastro() : h === "esqueci" ? telaEsqueci() : telaLogin(); return; }
  if (S.novaSenha) { app.innerHTML = telaNovaSenha(); return; }
  if (!S.perfil) { app.innerHTML = telaMsg("Cadastro não encontrado", "Sua conta existe, mas não tem perfil no sistema. Fale com o administrador." + (S.erroPerfil ? `<br><code class="small">${esc(S.erroPerfil)}</code>` : "")); return; }
  if (S.perfil.status === "aguardando") { app.innerHTML = telaMsg(`Olá, ${esc(S.perfil.nome)}`, "Seu acesso está aguardando aprovação do administrador. Esta tela abre sozinha assim que for aprovado."); return; }
  if (S.perfil.status !== "aprovado") { app.innerHTML = telaMsg("Acesso não liberado", "Seu acesso não está ativo. Fale com o administrador."); return; }

  const c = cidadeAtual();
  if (c) app.innerHTML = telaCidade(c);
  else if (h === "cidades") app.innerHTML = telaCidades();
  else if (h === "aprovacoes" && S.perfil.admin) app.innerHTML = telaAprovacoes();
  else app.innerHTML = telaInicio();
}

function telaLogin() {
  return `<div class="authwrap"><form class="auth" id="flogin">
    <div class="brand">Controle de Atividades</div>
    <label for="lemail">E-mail<input id="lemail" type="email" autocomplete="username" required></label>
    <label for="lsenha">Senha<input id="lsenha" type="password" autocomplete="current-password" required></label>
    <button class="btn" type="submit">Entrar</button>
    <p><a href="#esqueci">Esqueci minha senha</a></p>
    <p>Não tem acesso? <a href="#cadastro">Criar conta</a></p>
  </form></div>`;
}

function telaCadastro() {
  return `<div class="authwrap"><form class="auth" id="fcad">
    <div class="brand">Criar conta</div>
    <label for="cnome">Nome<input id="cnome" autocomplete="name" required></label>
    <label for="cemail">E-mail<input id="cemail" type="email" autocomplete="username" required></label>
    <label for="csenha">Senha (mínimo 6 caracteres)<input id="csenha" type="password" autocomplete="new-password" minlength="6" required></label>
    <div class="info" id="cmsg">Depois de criar, sua conta fica aguardando aprovação do administrador.</div>
    <button class="btn" type="submit">Pedir acesso</button>
    <p><a href="#login">Voltar ao login</a></p>
  </form></div>`;
}

function telaEsqueci() {
  return `<div class="authwrap"><form class="auth" id="fesqueci">
    <div class="brand">Esqueci minha senha</div>
    <label for="eemail">E-mail da sua conta<input id="eemail" type="email" autocomplete="username" required></label>
    <div class="info" id="emsg">Vamos enviar um link para o seu e-mail. Abra o link neste mesmo navegador para criar a senha nova.</div>
    <button class="btn" type="submit">Enviar link</button>
    <p><a href="#login">Voltar ao login</a></p>
  </form></div>`;
}

function telaNovaSenha() {
  const rec = S.novaSenha === "recuperar";
  return `<div class="authwrap"><form class="auth" id="fnovasenha">
    <div class="brand">${rec ? "Criar senha nova" : "Trocar senha"}</div>
    <label for="ns1">Senha nova (mínimo 6 caracteres)<input id="ns1" type="password" autocomplete="new-password" minlength="6" required></label>
    <label for="ns2">Repita a senha nova<input id="ns2" type="password" autocomplete="new-password" minlength="6" required></label>
    <div class="info" id="nmsg">${rec ? "Você entrou pelo link do e-mail. Escolha a senha nova para continuar." : "Escolha a senha nova. Na próxima vez, entre com ela."}</div>
    <button class="btn" type="submit">Salvar senha</button>
    ${rec ? "" : `<button class="btn sec" type="button" data-acao="cancelar-senha">Cancelar</button>`}
  </form></div>`;
}

function telaMsg(titulo, texto) {
  return `<div class="msg"><div class="brand" style="color:var(--accent)">Controle de Atividades</div>
    <h2>${titulo}</h2><p class="muted">${texto}</p>
    <button class="btn sec" type="button" data-acao="sair">Sair</button></div>`;
}

function shell(aba, html, cheio) {
  const p = S.perfil, pend = S.perfis.filter(x => x.status === "aguardando").length;
  const tab = (id, nome, extra = "") => `<a href="#${id}" class="${aba === id ? "on" : ""}">${nome}${extra}</a>`;
  return `<header class="top">
      <div class="brand">Controle de Atividades<small>Cálculo e Desenho · v2.1</small></div>
      <nav class="tabs">${tab("inicio", "Início")}${tab("cidades", "Cidades")}${p.admin ? tab("aprovacoes", "Aprovações", pend ? `<span class="badge">${pend}</span>` : "") : ""}</nav>
      <div class="sp"></div>
      <div class="user"><div class="avatar">${esc(iniciais(p.nome))}</div><span>${esc(p.nome)}${p.admin ? " · admin" : ""}</span>
        <button class="btn-ghost" type="button" data-acao="trocar-senha">Trocar senha</button>
        <button class="btn-ghost" type="button" data-acao="sair">Sair</button></div>
    </header>
    ${cheio ? html : `<div class="page">${html}</div>`}
    ${cheio ? "" : `<div class="legend"><span class="label">Status</span>${STATUS.map(([s, k]) => `<span class="chip st-${k}">${s}</span>`).join("")}
      <span class="chip late">Em atraso</span><span class="muted">= previsão vencida e ainda não emitida</span></div>`}`;
}

const ativa = c => !c.encerrada_em;
const cidadesAtivas = () => S.cidades.filter(ativa);
const divisoesDe = c => [...new Set(S.unidades.filter(u => u.cidade_id === c.id && u.divisao).map(u => u.divisao))].sort((a, b) => a.localeCompare(b, "pt-BR", { numeric: true }));
const diasAte = d => Math.round((new Date(d + "T12:00") - new Date(hoje() + "T12:00")) / 864e5);
const dataCurta = ts => { if (!ts) return "—"; const d = new Date(ts); return `${pad(d.getDate())}/${pad(d.getMonth() + 1)}`; };
const nomeEu = () => S.perfil.nome;

function atividades(cidades) {
  const porId = new Map(cidades.map(c => [c.id, c])), out = [];
  for (const u of S.unidades) {
    const c = porId.get(u.cidade_id); if (!c) continue;
    out.push({ c, u, e: "calc", etapa: "Cálculo", resp: u.calc_resp, st: u.calc_status, d: u.calc_prev, por: u.calc_designado_por, em: u.calc_designado_em });
    out.push({ c, u, e: "des", etapa: "Desenho", resp: u.des_resp, st: u.des_status, d: u.des_prev, por: u.des_designado_por, em: u.des_designado_em });
  }
  return out;
}
const late = a => atrasada(a.st, a.d);

function itemLog(h, comCidade = true) {
  const alvo = [comCidade && h.cidade, h.unidade, h.campo].filter(Boolean).join(" · ");
  const mud = (h.valor_antigo || h.valor_novo) ? `: ${esc(h.valor_antigo || "—")} → ${esc(h.valor_novo || "—")}` : "";
  return `<li><time>${quando(h.quando)}</time><span><b>${esc(h.usuario_nome)}</b> · ${esc(alvo)}${mud}</span></li>`;
}

// ---------- gráficos ---------------------------------------------------
function anel(pct, cor, glow, rotulo) {
  const r = 26, C = 2 * Math.PI * r;
  return `<svg class="ring ${glow}" viewBox="0 0 64 64" aria-hidden="true"><circle class="t" cx="32" cy="32" r="${r}"/>
    <circle class="v" cx="32" cy="32" r="${r}" style="stroke:${cor};stroke-dasharray:${C};stroke-dashoffset:${C * (1 - (pct || 0))}"/>
    <text x="32" y="37" text-anchor="middle">${rotulo}</text></svg>`;
}
function rosca(A) {
  const tot = A.length, r = 78, C = 2 * Math.PI * r, cnt = s => A.filter(a => a.st === s).length;
  const gap = STATUS.filter(([s]) => cnt(s)).length > 1 ? 2 : 0; let off = 0;
  const segs = tot ? STATUS.map(([s, k]) => {
    const n = cnt(s); if (!n) return ""; const len = n / tot * C;
    const el = `<circle class="seg" cx="100" cy="100" r="${r}" stroke="var(--c-${k})" stroke-dasharray="${Math.max(len - gap, .1)} ${C}" stroke-dashoffset="${-off}" transform="rotate(-90 100 100)" data-tip="${s}: ${n} (${Math.round(n / tot * 100)}%)"/>`;
    off += len; return el;
  }).join("") : "";
  return `<div class="donut-wrap"><svg class="donut" viewBox="0 0 200 200" role="img" aria-label="Atividades por status">
      <circle cx="100" cy="100" r="${r}" stroke="var(--surface-2)"/>${segs}
      <text class="center-n" x="100" y="104" text-anchor="middle">${tot}</text><text class="center-l" x="100" y="124" text-anchor="middle">atividades</text></svg>
    <ul class="dlegend">${STATUS.map(([s, k]) => `<li><i style="background:var(--c-${k})"></i><span>${s}</span><span class="n">${cnt(s)}</span><span class="p">${tot ? Math.round(cnt(s) / tot * 100) : 0}%</span></li>`).join("")}</ul></div>`;
}
const pilha = A => `<div class="stack">${STATUS.map(([s, k]) => { const n = A.filter(a => a.st === s).length; return n ? `<span style="flex-grow:${n};background:var(--c-${k})" data-tip="${s}: ${n}"></span>` : ""; }).join("")}</div>`;
const miniLegenda = () => `<div class="minilegend">${STATUS.map(([s, k]) => `<span><i style="background:var(--c-${k})"></i>${s}</span>`).join("")}</div>`;
const tagAtraso = l => `<span class="tag ${l ? "late" : "ok"}">${l ? l + " atraso" : "em dia"}</span>`;

// ---------- Início -----------------------------------------------------
function telaInicio() {
  const admin = S.perfil.admin, modo = S.modo || (admin ? "todas" : "minhas");
  const ativas = cidadesAtivas();
  if (S.filtro !== "todas" && !ativas.some(c => c.id === +S.filtro)) S.filtro = "todas";
  const lista = S.filtro === "todas" ? ativas : ativas.filter(c => c.id === +S.filtro);
  const todas = atividades(lista), meus = todas.filter(a => a.resp === nomeEu());
  const A = modo === "minhas" ? meus : todas, tot = A.length, cnt = s => A.filter(a => a.st === s).length;
  const L = A.filter(late), unidAtras = new Set(L.map(a => a.u.id)).size;
  const ids = new Set(lista.map(c => c.id)), nUnid = S.unidades.filter(u => ids.has(u.cidade_id)).length;
  const emit = cnt("Emitida"), and = cnt("Iniciada") + cnt("Revisão 1") + cnt("Revisão 2");
  const um = S.filtro !== "todas" ? lista[0] : null;
  const lugar = um ? esc(um.nome) : "todas as cidades";

  const titulo = modo === "minhas" ? `Olá, ${esc(nomeEu().split(" ")[0])}` : um ? esc(um.nome) : "Todas as cidades";
  const sub = modo === "minhas"
    ? `${tot} atividade${tot === 1 ? "" : "s"} designada${tot === 1 ? "" : "s"} para você · ${lugar}`
    : um ? `${esc(um.contrato || "Sem contrato")} · ${nUnid} unidades · ${tot} atividades` : `${ativas.length} cidades em andamento · ${nUnid} unidades · ${tot} atividades`;

  const g1 = modo === "minhas"
    ? `<div class="g"><div><div class="label">Para você</div><div class="big">${tot}</div><div class="small">atividades designadas</div></div></div>`
    : `<div class="g"><div><div class="label">Unidades</div><div class="big">${nUnid}</div><div class="small">${tot} atividades</div></div></div>`;

  const hero = `<div class="hero">
    <div class="hero-head"><div><div class="label">Painel de acompanhamento</div><h2>${titulo}</h2><div class="sub">${sub}</div></div></div>
    <div class="filters">
      <div class="seg" role="group" aria-label="Quais atividades mostrar">
        <button type="button" data-acao="modo" data-v="minhas" aria-pressed="${modo === "minhas"}">Minhas atividades<span class="cnt">${meus.length}</span></button>
        <button type="button" data-acao="modo" data-v="todas" aria-pressed="${modo === "todas"}">Todas as atividades</button></div>
      <div class="hchips" role="group" aria-label="Filtrar por cidade">
        <button type="button" data-acao="filtro" data-v="todas" aria-pressed="${S.filtro === "todas"}">Todas</button>
        ${ativas.map(c => `<button type="button" data-acao="filtro" data-v="${c.id}" aria-pressed="${String(S.filtro) === String(c.id)}">${esc(c.nome)}</button>`).join("")}</div>
    </div>
    <div class="gauges">${g1}
      <div class="g">${anel(tot ? emit / tot : 0, "var(--hero-emit)", "glow-emit", (tot ? Math.round(emit / tot * 100) : 0) + "%")}<div><div class="label">Emitidas</div><div class="big">${emit}<span class="small"> /${tot}</span></div><div class="small">progresso</div></div></div>
      <div class="g">${anel(tot ? and / tot : 0, "var(--hero-run)", "glow-run", and)}<div><div class="label">Em andamento</div><div class="big">${and}</div><div class="small">iniciadas e em revisão</div></div></div>
      <div class="g ${L.length ? "alert" : ""}">${anel(tot ? L.length / tot : 0, "var(--hero-late)", "glow-late", L.length)}<div><div class="label">Em atraso</div><div class="big">${L.length}</div><div class="small">em ${unidAtras} unidade${unidAtras === 1 ? "" : "s"}</div></div></div>
    </div></div>`;

  if (!ativas.length) return shell("inicio", hero + `<div class="page"><div class="empty">Nenhuma cidade em andamento. Cadastre uma na aba <a href="#cidades">Cidades</a>.</div></div>`, true);
  if (modo === "minhas") return shell("inicio", hero + `<div class="page">${painelMinhas(A, !um)}</div>`, true);

  const etapas = ["calc", "des"].map(e => {
    const a = A.filter(x => x.e === e), l = a.filter(late).length, em = a.filter(x => x.st === "Emitida").length;
    return `<div class="bar-row"><div class="name">${e === "calc" ? "Cálculo" : "Desenho"}<small>${em} de ${a.length} emitidas</small></div>${pilha(a)}${tagAtraso(l)}</div>`;
  }).join("");

  let blocoMeio;
  if (!um) {
    blocoMeio = `<section class="panel span2"><header><h3>Andamento por cidade</h3><span class="note">toque numa cidade para filtrar</span></header>
      <div class="bars">${lista.map(c => {
        const a = atividades([c]), l = a.filter(late).length, em = a.filter(x => x.st === "Emitida").length, n = a.length / 2;
        return `<div class="bar-row click" data-acao="filtro" data-v="${c.id}"><div class="name">${esc(c.nome)}<small>${n} unid. · ${a.length ? Math.round(em / a.length * 100) : 0}% emitido</small></div>${a.length ? pilha(a) : `<div class="stack"></div>`}${tagAtraso(l)}</div>`;
      }).join("")}</div></section>`;
  } else {
    const divs = divisoesDe(um);
    const us = S.unidades.filter(u => u.cidade_id === um.id).sort((a, b) => (a.divisao || "").localeCompare(b.divisao || "", "pt-BR") || a.codigo.localeCompare(b.codigo, "pt-BR", { numeric: true }));
    const et = (n, s, d) => `<div class="et"><em>${n}</em><span class="dotlbl"><i style="background:var(--c-${COR[s]})"></i>${s}</span><span class="num">${d ? br(d).slice(0, 5) : "—"}</span></div>`;
    blocoMeio = `<section class="panel span2"><header><h3>Unidades</h3><span class="note">borda vermelha = atividade atrasada · <a href="#cidade-${um.id}">abrir a cidade</a></span></header>
      ${us.length ? `<div class="utiles">${us.map(u => {
        const ls = [atrasada(u.calc_status, u.calc_prev), atrasada(u.des_status, u.des_prev)].filter(Boolean).length;
        return `<a class="utile ${ls ? "is-late" : ""}" href="#cidade-${um.id}"><b>${esc(u.codigo)}${divs.length && u.divisao ? ` <small>${esc(u.divisao)}</small>` : ""}</b>
          ${et("Cálculo", u.calc_status, u.calc_prev)}${et("Desenho", u.des_status, u.des_prev)}${ls ? `<span class="lt">${ls} atividade${ls > 1 ? "s" : ""} em atraso</span>` : ""}</a>`;
      }).join("")}</div>` : `<div class="empty">Nenhuma unidade nesta cidade ainda.</div>`}</section>`;
  }

  const ult = (um ? S.historico.filter(h => h.cidade_id === um.id) : S.historico).slice(0, 12);
  return shell("inicio", hero + `<div class="dash">
    <section class="panel"><header><h3>Status das atividades</h3><span class="note">cálculo + desenho</span></header>${rosca(A)}</section>
    <section class="panel"><header><h3>Cálculo × Desenho</h3><span class="note">atividades em cada status</span></header><div class="bars">${etapas}</div>${miniLegenda()}</section>
    ${blocoMeio}
    <section class="panel"><header><h3>Em atraso</h3><span class="note">previsão vencida e não emitida</span></header>${listaAtrasos(L, !um)}</section>
    <section class="panel"><header><h3>Próximas entregas</h3><span class="note">próximos 14 dias</span></header>${listaProximas(A, !um)}</section>
    <section class="panel span2"><header><h3>Últimas alterações</h3></header>${ult.length ? `<ul class="log">${ult.map(h => itemLog(h, !um)).join("")}</ul>` : `<div class="empty">Nenhuma alteração ainda.</div>`}</section>
  </div>`, true);
}

function listaAtrasos(L, comCidade) {
  if (!L.length) return `<div class="empty">Nenhuma atividade em atraso.</div>`;
  const sev = d => d >= 10 ? 3 : d >= 4 ? 2 : 1;
  return `<ul class="items">${L.slice().sort((a, b) => a.d.localeCompare(b.d)).slice(0, 8).map(a => {
    const d = -diasAte(a.d);
    return `<li class="item sev-${sev(d)}"><a href="#cidade-${a.c.id}"><div class="t">${comCidade ? esc(a.c.nome) + " · " : ""}${esc(a.u.codigo)} · ${a.etapa}</div>
      <div class="s">${esc(a.resp || "sem responsável")} · ${a.st} · previsto ${br(a.d)}</div></a><div class="d"><b>${d} d</b><small>de atraso</small></div></li>`;
  }).join("")}</ul>`;
}
function listaProximas(A, comCidade) {
  const p = A.filter(a => a.d && a.st !== "Emitida" && a.d >= hoje() && diasAte(a.d) <= 14).sort((a, b) => a.d.localeCompare(b.d));
  if (!p.length) return `<div class="empty">Nada previsto para os próximos 14 dias.</div>`;
  return `<ul class="items">${p.slice(0, 8).map(a => {
    const d = diasAte(a.d);
    return `<li class="item soon"><a href="#cidade-${a.c.id}"><div class="t">${comCidade ? esc(a.c.nome) + " · " : ""}${esc(a.u.codigo)} · ${a.etapa}</div>
      <div class="s">${esc(a.resp || "sem responsável")} · ${a.st}</div></a><div class="d"><b>${br(a.d).slice(0, 5)}</b><small>${d === 0 ? "hoje" : d === 1 ? "amanhã" : "em " + d + " dias"}</small></div></li>`;
  }).join("")}</ul>`;
}

function painelMinhas(A, comCidade) {
  const ord = A.slice().sort((a, b) => (a.d || "9999").localeCompare(b.d || "9999"));
  const pend = ord.filter(a => a.st !== "Emitida" && !late(a));
  const grupos = [
    ["Em atraso", ord.filter(late), "late"],
    ["Próximos 14 dias", pend.filter(a => a.d && diasAte(a.d) <= 14), ""],
    ["Mais adiante", pend.filter(a => a.d && diasAte(a.d) > 14), ""],
    ["Sem previsão", pend.filter(a => !a.d), ""],
    ["Emitidas", ord.filter(a => a.st === "Emitida"), ""],
  ];
  const card = a => {
    const key = `${a.u.id}|${a.e}`, l = late(a), dd = a.d ? diasAte(a.d) : null;
    const prazo = !a.d ? "sem previsão" : a.st === "Emitida" ? br(a.d) : `${br(a.d)} · ${l ? -dd + " d de atraso" : dd === 0 ? "hoje" : dd === 1 ? "amanhã" : "em " + dd + " dias"}`;
    const pedindo = S.recusa === key;
    return `<li class="task ${l ? "is-late" : ""}"><div class="task-b">
      <div class="task-h"><a href="#cidade-${a.c.id}"><b>${comCidade ? esc(a.c.nome) + " · " : ""}${esc(a.u.codigo)}${a.u.divisao ? " · " + esc(a.u.divisao) : ""} · ${a.etapa}</b></a>
        <span class="who">${a.por ? `Designada por <b>${esc(a.por)}</b> em ${dataCurta(a.em)}` : "Designação anterior ao registro"}</span></div>
      <div class="task-f"><span class="lbl">Status</span>
        <select class="st-sel" data-uid="${a.u.id}" data-f="${a.e}_status" aria-label="Status" style="background-color:var(--c-${COR[a.st]});${a.st === "A iniciar" ? "color:var(--fg)" : ""}">${STATUS.map(([s]) => `<option${s === a.st ? " selected" : ""}>${s}</option>`).join("")}</select>
        <span class="lbl">Previsão</span><span class="due ${l ? "late" : ""}">${prazo}</span><span class="sp"></span>
        ${pedindo ? "" : `<button type="button" class="btn-out" data-acao="pedir-recusa" data-key="${key}">Recusar</button>`}</div>
      ${pedindo ? `<div class="confirma"><span>Tirar seu nome desta atividade? Ela fica sem responsável, e o histórico registra que você saiu.</span>
        <button type="button" class="btn danger sm" data-acao="recusar" data-uid="${a.u.id}" data-f="${a.e}_resp">Sim, recusar</button>
        <button type="button" class="btn link" data-acao="cancelar-recusa">Cancelar</button></div>` : ""}
    </div></li>`;
  };
  return `<section class="panel"><header><h3>Designadas para você</h3><span class="note">não vai fazer? use “Recusar” para tirar seu nome</span></header>
    ${A.length ? grupos.filter(g => g[1].length).map(([t, arr, c]) => `<div class="group-t ${c}">${t} · ${arr.length}</div><ul class="mine">${arr.map(card).join("")}</ul>`).join("")
      : `<div class="empty">Nenhuma atividade designada para você${comCidade ? "" : " nesta cidade"}. Toque em “Todas as atividades” para ver tudo.</div>`}</section>`;
}

// ---------- Cidades ----------------------------------------------------
function formUnidade(fixa) {
  const ativas = cidadesAtivas();
  const c = fixa || ativas.find(x => x.id === +S.fc);
  const divs = c ? divisoesDe(c) : [];
  const n = fixa ? 0 : 1;
  const cidSel = fixa ? "" : `<label for="uc"><span><span class="step">1</span> · Cidade</span><select id="uc"><option value="">Escolha a cidade…</option>${ativas.map(x => `<option value="${x.id}"${x.id === +S.fc ? " selected" : ""}>${esc(x.nome)}</option>`).join("")}</select></label>`;
  const opts = c ? `<option value=""${S.fd === "" ? " selected" : ""}>Sem divisão</option>${divs.map(d => `<option${d === S.fd ? " selected" : ""}>${esc(d)}</option>`).join("")}<option value="__nova"${S.fd === "__nova" ? " selected" : ""}>+ Nova divisão…</option>` : `<option>Escolha a cidade primeiro</option>`;
  const dica = c ? (divs.length ? `${esc(c.nome)} já tem ${divs.length} ${divs.length > 1 ? "divisões" : "divisão"}: ${divs.map(esc).join(", ")}. Escolha uma, deixe sem divisão ou crie uma nova.` : `${esc(c.nome)} ainda não tem divisões. Deixe “Sem divisão” ou crie a primeira.`) : "A lista de divisões aparece depois que você escolhe a cidade.";
  return `<form class="cascade" id="fnovaunidade"><h3>Adicionar unidade</h3>
    <div class="row">${cidSel}
      <label for="ud"><span><span class="step">${n + 1}</span> · Divisão</span><select id="ud"${c ? "" : " disabled"}>${opts}</select></label>
      ${S.fd === "__nova" ? `<label for="udn"><span>Nome da nova divisão</span><input id="udn" placeholder="Ex.: Bacia A, Rede Norte" required></label>` : ""}
      <label for="uu"><span><span class="step">${n + 2}</span> · Código da unidade</span><input id="uu" placeholder="Ex.: EB15"${c ? "" : " disabled"} required></label>
      <button class="btn" type="submit"${c ? "" : " disabled"}>+ Adicionar</button></div>
    <span class="hint">${dica}</span></form>`;
}

function telaCidades() {
  const ativas = cidadesAtivas(), enc = S.cidades.filter(c => !ativa(c)), admin = S.perfil.admin;
  const aba = S.abaCid === "enc" ? "enc" : "ativas", lista = aba === "ativas" ? ativas : enc;
  const card = c => {
    const a = atividades([c]), l = a.filter(late).length, em = a.filter(x => x.st === "Emitida").length, pend = a.length - em;
    const divs = divisoesDe(c), nU = a.length / 2;
    const chips = divs.length ? divs.map(d => `<span class="dchip">${esc(d)} · ${S.unidades.filter(u => u.cidade_id === c.id && u.divisao === d).length}</span>`).join("") : `<span class="dchip">Sem divisões</span>`;
    let acao;
    if (!ativa(c)) acao = S.pedidoCid === c.id
      ? `<div class="confirma soft"><span>Reabrir <b>${esc(c.nome)}</b>? Ela volta para o Início e dá para criar novas atividades.</span>
          <button class="btn sm" type="button" data-acao="reabrir" data-id="${c.id}">Sim, reabrir</button><button class="btn link" type="button" data-acao="cancelar-cid">Cancelar</button></div>`
      : `<div class="acts"><a class="btn sec sm" href="#cidade-${c.id}">Consultar</a>${admin ? `<button class="btn ghost sm" type="button" data-acao="pedir-cid" data-id="${c.id}">Reabrir</button>` : ""}</div>`;
    else acao = S.pedidoCid === c.id
      ? `<div class="confirma"><span>Encerrar <b>${esc(c.nome)}</b>? Ela sai do Início e vai para <b>Encerradas</b>. Dá para reabrir depois.${pend ? ` <b>Atenção:</b> ${pend} atividade${pend > 1 ? "s ainda não foram emitidas" : " ainda não foi emitida"}.` : ""}</span>
          <button class="btn danger sm" type="button" data-acao="encerrar" data-id="${c.id}">Sim, encerrar</button><button class="btn link" type="button" data-acao="cancelar-cid">Cancelar</button></div>`
      : `<div class="acts"><a class="btn sm" href="#cidade-${c.id}">Abrir</a>${admin ? `<button class="btn ghost sm" type="button" data-acao="pedir-cid" data-id="${c.id}">Encerrar cidade</button>` : ""}</div>`;
    return `<article class="city ${ativa(c) ? "" : "closed"}">
      <div class="head"><div><h3>${esc(c.nome)}</h3><div class="contrato">${esc(c.contrato || "Sem contrato")}</div></div>
        ${!ativa(c) ? `<span class="chip closed">Encerrada</span>` : l ? `<span class="chip late">${l} em atraso</span>` : `<span class="chip ok">Em dia</span>`}</div>
      <div class="divs">${chips}</div>
      ${a.length ? pilha(a) : `<div class="stack"></div>`}
      <div class="meta"><span>${nU} unidade${nU === 1 ? "" : "s"}</span><span>${em}/${a.length} emitidas</span></div>
      ${!ativa(c) ? `<div class="muted small">Encerrada em ${dataCurta(c.encerrada_em)}/${new Date(c.encerrada_em).getFullYear()}${c.encerrada_por ? " por " + esc(c.encerrada_por) : ""}</div>` : ""}
      ${acao}</article>`;
  };
  return shell("cidades", `
    <div class="bar"><h2>Cidades</h2><span class="sp"></span>
      <div class="seg2" role="group" aria-label="Situação">
        <button type="button" data-acao="aba-cid" data-v="ativas" aria-pressed="${aba === "ativas"}">Em andamento<span class="cnt">${ativas.length}</span></button>
        <button type="button" data-acao="aba-cid" data-v="enc" aria-pressed="${aba === "enc"}">Encerradas<span class="cnt">${enc.length}</span></button></div></div>
    ${aba === "ativas" ? `<form class="formline" id="fcidade">
        <label for="ncid">Nome da cidade<input id="ncid" placeholder="Ex.: Mongaguá" required></label>
        <label for="ncon">Contrato<input id="ncon" placeholder="Ex.: Contrato 050/2026" required></label>
        <button class="btn" type="submit">+ Cadastrar cidade</button></form>
      ${ativas.length ? formUnidade(null) : ""}`
      : `<div class="note">Cidades encerradas não aparecem no Início. As atividades ficam guardadas para consulta.</div>`}
    ${lista.length ? `<div class="cities">${lista.map(card).join("")}</div>` : `<div class="empty">${aba === "ativas" ? "Nenhuma cidade em andamento. Cadastre a primeira acima." : "Nenhuma cidade encerrada."}</div>`}`);
}

function telaCidade(c) {
  const admin = S.perfil.admin, fechada = !ativa(c);
  const nomes = S.perfis.filter(p => p.status === "aprovado").map(p => p.nome);
  const divs = divisoesDe(c);
  const selResp = (v, f, id) => {
    const ops = [...new Set([...nomes, ...(v ? [v] : [])])].sort((a, b) => a.localeCompare(b, "pt-BR"));
    return `<select class="resp" data-uid="${id}" data-f="${f}" aria-label="Responsável"><option value="">—</option>${ops.map(n => `<option${n === v ? " selected" : ""}>${esc(n)}</option>`).join("")}</select>`;
  };
  const selSt = (v, f, id) => `<select class="pill st-${COR[v]}" data-uid="${id}" data-f="${f}" aria-label="Status">${STATUS.map(([s]) => `<option${s === v ? " selected" : ""}>${s}</option>`).join("")}</select>`;
  const data = (v, st, f, id) => `<input type="date" class="date${atrasada(st, v) ? " is-late" : ""}" data-uid="${id}" data-f="${f}" value="${v || ""}" aria-label="Previsão de entrega">`;
  const ro = (s, d, r) => [`${esc(r || "—")}`, `<span class="chip st-${COR[s]}">${s}</span>`, `<span class="num${atrasada(s, d) ? " late-txt" : ""}">${br(d)}</span>`];
  const unid = S.unidades.filter(u => u.cidade_id === c.id);
  const busca = S.busca.toLowerCase();
  const colDel = admin && !fechada;
  const nCols = 7 + (colDel ? 1 : 0);

  const linha = u => {
    const chave = [u.codigo, u.divisao, u.calc_resp, u.des_resp].join(" ").toLowerCase();
    const del = !colDel ? "" : S.confirmDel === u.id
      ? `<td><button class="btn danger sm" type="button" data-acao="excluir" data-id="${u.id}">Excluir ${esc(u.codigo)}?</button> <button class="btn link" type="button" data-acao="cancelar">Cancelar</button></td>`
      : `<td><button class="btn link" type="button" data-acao="pedir-excluir" data-id="${u.id}">Excluir</button></td>`;
    const moverDiv = divs.length && !fechada
      ? `<select class="movediv" data-uid="${u.id}" data-f="divisao" aria-label="Divisão de ${esc(u.codigo)}" title="Mudar de divisão"><option value="">Sem divisão</option>${divs.map(d => `<option${d === u.divisao ? " selected" : ""}>${esc(d)}</option>`).join("")}</select>` : "";
    const celulas = fechada
      ? [...ro(u.calc_status, u.calc_prev, u.calc_resp), ...ro(u.des_status, u.des_prev, u.des_resp)]
      : [selResp(u.calc_resp, "calc_resp", u.id), selSt(u.calc_status, "calc_status", u.id), data(u.calc_prev, u.calc_status, "calc_prev", u.id),
         selResp(u.des_resp, "des_resp", u.id), selSt(u.des_status, "des_status", u.id), data(u.des_prev, u.des_status, "des_prev", u.id)];
    return `<tr data-busca="${esc(chave)}"${busca && !chave.includes(busca) ? " hidden" : ""}>
      <td class="unit">${esc(u.codigo)}${moverDiv}</td>
      <td class="split">${celulas[0]}</td><td>${celulas[1]}</td><td>${celulas[2]}</td>
      <td class="split">${celulas[3]}</td><td>${celulas[4]}</td><td>${celulas[5]}</td>${del}</tr>`;
  };

  let corpo;
  const temSem = unid.some(u => !u.divisao);
  if (divs.length) {
    const grupos = [...divs, ...(temSem ? [null] : [])];
    const mostrar = S.divSel === "todas" ? grupos : [S.divSel === "__sem" ? null : S.divSel].filter(g => grupos.includes(g));
    corpo = mostrar.map(d => {
      const us = unid.filter(u => (u.divisao || null) === d);
      const l = us.reduce((n, u) => n + atrasada(u.calc_status, u.calc_prev) + atrasada(u.des_status, u.des_prev), 0);
      return `<tr class="div-row"><td colspan="${nCols}"><div class="div-title"><b>${esc(d || "Sem divisão")}</b><span class="muted small">${us.length} unidade${us.length === 1 ? "" : "s"}</span>${l ? `<span class="chip late">${l} em atraso</span>` : ""}</div></td></tr>${us.map(linha).join("")}`;
    }).join("");
  } else corpo = unid.map(linha).join("");

  const abas = divs.length ? `<div class="dtabs" role="group" aria-label="Divisões">
      <button type="button" data-acao="div" data-v="todas" aria-pressed="${S.divSel === "todas"}">Todas<span class="cnt">${unid.length}</span></button>
      ${divs.map(d => `<button type="button" data-acao="div" data-v="${esc(d)}" aria-pressed="${S.divSel === d}">${esc(d)}<span class="cnt">${unid.filter(u => u.divisao === d).length}</span></button>`).join("")}
      ${temSem ? `<button type="button" data-acao="div" data-v="__sem" aria-pressed="${S.divSel === "__sem"}">Sem divisão<span class="cnt">${unid.filter(u => !u.divisao).length}</span></button>` : ""}</div>` : "";

  const hist = S.historico.filter(h => h.cidade_id === c.id).slice(0, 100);
  let cab;
  if (S.editCidade && !fechada) cab = `<form class="formline" id="feditcidade" style="flex:1">
        <label for="ecid">Nome da cidade<input id="ecid" value="${esc(c.nome)}" required></label>
        <label for="econ">Contrato<input id="econ" value="${esc(c.contrato)}" required></label>
        <button class="btn" type="submit">Salvar</button><button class="btn sec" type="button" data-acao="cancelar-edicao">Cancelar</button></form>`;
  else cab = `<div><h2>${esc(c.nome)}</h2><span class="muted">${esc(c.contrato || "Sem contrato")} · ${divs.length ? `${divs.length} ${divs.length > 1 ? "divisões" : "divisão"}` : "sem divisões"}</span>
      ${fechada ? "" : `<button class="btn link" type="button" data-acao="editar-cidade">Editar</button>`}
      ${admin && !fechada ? (S.pedidoCid === c.id
        ? `<div class="confirma"><span>Encerrar <b>${esc(c.nome)}</b>? Ela sai do Início e vai para Encerradas.</span><button class="btn danger sm" type="button" data-acao="encerrar" data-id="${c.id}">Sim, encerrar</button><button class="btn link" type="button" data-acao="cancelar-cid">Cancelar</button></div>`
        : `<button class="btn link" type="button" data-acao="pedir-cid" data-id="${c.id}">Encerrar cidade</button>`) : ""}
      ${admin ? (S.confirmDelCidade
        ? `<div class="confirma"><span>Excluir <b>${esc(c.nome)}</b>${unid.length ? ` e ${unid.length === 1 ? "sua unidade" : `suas ${unid.length} unidades`}` : ""}? Não dá para desfazer (o histórico fica guardado).</span>
            <button class="btn danger sm" type="button" data-acao="excluir-cidade">Sim, excluir</button><button class="btn link" type="button" data-acao="cancelar-excluir-cidade">Cancelar</button></div>`
        : `<button class="btn link" type="button" data-acao="pedir-excluir-cidade">Excluir cidade</button>`) : ""}</div>
      <div class="sp"></div><input id="busca" type="search" placeholder="Buscar unidade ou responsável…" value="${esc(S.busca)}">`;

  return shell("cidades", `
    <div class="bar"><a href="#cidades">← Cidades</a></div>
    <div class="bar">${cab}</div>
    ${fechada ? `<div class="banner"><span>Cidade <b>encerrada</b> em ${dataCurta(c.encerrada_em)}/${new Date(c.encerrada_em).getFullYear()}${c.encerrada_por ? " por " + esc(c.encerrada_por) : ""}. As atividades ficam só para consulta.</span>
      ${admin ? (S.pedidoCid === c.id ? `<button class="btn sm" type="button" data-acao="reabrir" data-id="${c.id}">Confirmar: reabrir</button><button class="btn link" type="button" data-acao="cancelar-cid">Cancelar</button>`
        : `<button class="btn sm" type="button" data-acao="pedir-cid" data-id="${c.id}">Reabrir cidade</button>`) : ""}</div>` : formUnidade(c)}
    ${abas}
    <div class="two wide">
      <div class="box"><div class="scroll"><table>
        <thead><tr class="group"><th></th><th colspan="3" class="split">Cálculo</th><th colspan="3" class="split">Desenho</th>${colDel ? "<th></th>" : ""}</tr>
        <tr><th>Unidade</th><th class="split">Responsável</th><th>Status</th><th>Previsão de entrega</th><th class="split">Responsável</th><th>Status</th><th>Previsão de entrega</th>${colDel ? "<th></th>" : ""}</tr></thead>
        <tbody>${corpo || `<tr><td colspan="${nCols}" class="muted">Nenhuma unidade ainda.${fechada ? "" : " Adicione a primeira acima."}</td></tr>`}</tbody>
      </table></div></div>
      <div class="box"><header><h3>Histórico</h3></header>
        ${hist.length ? `<ul class="log">${hist.map(h => itemLog(h, false)).join("")}</ul>` : `<div class="empty">Nenhuma alteração ainda.</div>`}</div>
    </div>`);
}

function telaAprovacoes() {
  const pend = S.perfis.filter(p => p.status === "aguardando");
  const outros = S.perfis.filter(p => p.status !== "aguardando");
  const rotulo = { aprovado: ["Ativo", "st-done"], recusado: ["Sem acesso", "late"] };
  return shell("aprovacoes", `
    <div class="bar"><h2>Pedidos de acesso</h2></div>
    <div class="box"><div class="scroll"><table><thead><tr><th>Nome</th><th>E-mail</th><th>Pedido em</th><th></th></tr></thead>
      <tbody>${pend.length ? pend.map(p => `<tr><td>${esc(p.nome)}</td><td>${esc(p.email)}</td><td>${quando(p.criado_em)}</td>
        <td style="text-align:right"><button class="btn sm" type="button" data-acao="status" data-id="${p.id}" data-v="aprovado">Aprovar</button>
        <button class="btn sec sm" type="button" data-acao="status" data-id="${p.id}" data-v="recusado">Recusar</button></td></tr>`).join("")
        : `<tr><td colspan="4" class="muted">Nenhum pedido pendente.</td></tr>`}</tbody></table></div></div>
    <div class="bar"><h2>Usuários</h2></div>
    <div class="box"><div class="scroll"><table><thead><tr><th>Nome</th><th>E-mail</th><th>Situação</th><th></th></tr></thead>
      <tbody>${outros.map(p => {
        const [txt, cls] = rotulo[p.status];
        const acao = p.id === S.uid ? `<span class="muted small">você</span>`
          : p.status === "aprovado" ? `<button class="btn sec sm" type="button" data-acao="status" data-id="${p.id}" data-v="recusado">Remover acesso</button>`
          : `<button class="btn sm" type="button" data-acao="status" data-id="${p.id}" data-v="aprovado">Liberar acesso</button>`;
        return `<tr><td>${esc(p.nome)}${p.admin ? ` <span class="chip st-emit">admin</span>` : ""}</td><td>${esc(p.email)}</td><td><span class="chip ${cls}">${txt}</span></td><td style="text-align:right">${acao}</td></tr>`;
      }).join("")}</tbody></table></div></div>`);
}

// ---------- ações -----------------------------------------------------
window.addEventListener("hashchange", () => {
  Object.assign(S, { editCidade: false, confirmDel: null, confirmDelCidade: false, busca: "", pedidoCid: null, divSel: "todas", fd: "", recusa: null });
  render(); window.scrollTo(0, 0);
});

async function ocupado(form, fn) {
  const b = form.querySelector("button[type=submit]"); if (b) b.disabled = true;
  try { await fn(); } finally { if (b && b.isConnected) b.disabled = false; }
}
const ordenaUnid = () => S.unidades.sort((a, b) => a.codigo.localeCompare(b.codigo, "pt-BR", { numeric: true }));

async function salvarUnidade(id, campo, valor) {
  const u = S.unidades.find(x => x.id === id); if (!u) return;
  const antigo = u[campo]; u[campo] = valor; render();
  const { data, error } = await sb.from("unidades").update({ [campo]: valor }).eq("id", id).select().maybeSingle();
  if (error || !data) { u[campo] = antigo; render(); toast("Não foi possível salvar: " + (error ? traduz(error.message) : "a cidade pode estar encerrada."), true); return false; }
  Object.assign(u, data); render(); return true;
}

async function mudarCidade(id, valores, msg) {
  const { data, error } = await sb.from("cidades").update(valores).eq("id", id).select().maybeSingle();
  if (error || !data) return toast(error ? traduz(error.message) : "Você não tem permissão para isso.", true);
  Object.assign(S.cidades.find(c => c.id === id), data); S.pedidoCid = null; toast(msg); render();
}

app.addEventListener("submit", e => {
  e.preventDefault();
  const f = e.target, v = id => document.getElementById(id).value.trim();

  if (f.id === "flogin") ocupado(f, async () => {
    const { error } = await sb.auth.signInWithPassword({ email: v("lemail"), password: document.getElementById("lsenha").value });
    if (error) toast(traduz(error.message), true);
  });

  if (f.id === "fcad") ocupado(f, async () => {
    const { data, error } = await sb.auth.signUp({ email: v("cemail"), password: document.getElementById("csenha").value, options: { data: { nome: v("cnome") } } });
    const msg = document.getElementById("cmsg");
    if (error) { msg.className = "info erro"; msg.textContent = traduz(error.message); return; }
    if (!data.session) { msg.className = "info"; msg.textContent = "Conta criada. Confirme pelo link enviado ao seu e-mail e depois entre."; }
    history.replaceState(null, "", location.pathname);
  });

  if (f.id === "fesqueci") ocupado(f, async () => {
    const msg = document.getElementById("emsg");
    const { error } = await sb.auth.resetPasswordForEmail(v("eemail"), { redirectTo: location.origin + location.pathname });
    if (error) { msg.className = "info erro"; msg.textContent = traduz(error.message); return; }
    msg.className = "info"; msg.textContent = "Pronto. Se esse e-mail tiver conta, chega um link em alguns minutos (veja também o spam).";
  });

  if (f.id === "fnovasenha") ocupado(f, async () => {
    const a = document.getElementById("ns1").value, b = document.getElementById("ns2").value, msg = document.getElementById("nmsg");
    if (a !== b) { msg.className = "info erro"; msg.textContent = "As duas senhas não são iguais."; return; }
    const { error } = await sb.auth.updateUser({ password: a });
    if (error) { msg.className = "info erro"; msg.textContent = traduz(error.message); return; }
    S.novaSenha = null; history.replaceState(null, "", location.pathname); toast("Senha alterada"); render();
  });

  if (f.id === "fcidade") ocupado(f, async () => {
    const { data, error } = await sb.from("cidades").insert({ nome: v("ncid"), contrato: v("ncon") }).select().single();
    if (error) return toast(traduz(error.message), true);
    S.cidades.push(data); S.cidades.sort((a, b) => a.nome.localeCompare(b.nome, "pt-BR"));
    toast("Cidade cadastrada"); location.hash = "cidade-" + data.id;
  });

  if (f.id === "feditcidade") ocupado(f, async () => {
    const c = cidadeAtual(); const novo = { nome: v("ecid"), contrato: v("econ") };
    const { error } = await sb.from("cidades").update(novo).eq("id", c.id);
    if (error) return toast(traduz(error.message), true);
    Object.assign(c, novo); S.editCidade = false; toast("Cidade atualizada"); render();
  });

  if (f.id === "fnovaunidade") ocupado(f, async () => {
    const c = cidadeAtual() || S.cidades.find(x => x.id === +S.fc); if (!c) return;
    const codigo = v("uu").toUpperCase();
    const divisao = S.fd === "__nova" ? v("udn") : (S.fd || null);
    if (S.fd === "__nova" && !divisao) return toast("Escreva o nome da nova divisão.", true);
    const { data, error } = await sb.from("unidades").insert({ cidade_id: c.id, codigo, divisao }).select().single();
    if (error) return toast(traduz(error.message), true);
    S.unidades.push(data); ordenaUnid();
    S.fd = divisao || "";
    toast(`${codigo} adicionada em ${c.nome}${divisao ? " · " + divisao : ""}`);
    render(); document.getElementById("uu")?.focus();
  });
});

app.addEventListener("change", async e => {
  const t = e.target;
  if (t.id === "uc") { S.fc = t.value; S.fd = ""; render(); document.getElementById("ud")?.focus(); return; }
  if (t.id === "ud") { S.fd = t.value; render(); (document.getElementById(S.fd === "__nova" ? "udn" : "uu"))?.focus(); return; }
  if (t.dataset.uid && t.dataset.f) {
    const ok = await salvarUnidade(+t.dataset.uid, t.dataset.f, t.value || null);
    if (ok && t.classList.contains("st-sel")) toast("Status atualizado: " + t.value);
  }
});

app.addEventListener("input", e => {
  if (e.target.id !== "busca") return;
  S.busca = e.target.value; const b = S.busca.toLowerCase();
  app.querySelectorAll("tr[data-busca]").forEach(tr => { tr.hidden = !!b && !tr.dataset.busca.includes(b); });
});

app.addEventListener("click", async e => {
  const el = e.target.closest("[data-acao]"); if (!el) return;
  const acao = el.dataset.acao, id = el.dataset.id ? +el.dataset.id : null;
  if (el.tagName === "A") return;
  switch (acao) {
    case "sair": S.novaSenha = null; await sb.auth.signOut(); history.replaceState(null, "", location.pathname); return;
    case "trocar-senha": S.novaSenha = "trocar"; break;
    case "cancelar-senha": e.preventDefault(); S.novaSenha = null; break;
    case "modo": S.modo = el.dataset.v; S.recusa = null; break;
    case "filtro": S.filtro = el.dataset.v; break;
    case "aba-cid": S.abaCid = el.dataset.v; S.pedidoCid = null; break;
    case "div": S.divSel = el.dataset.v; break;
    case "pedir-cid": S.pedidoCid = id; break;
    case "cancelar-cid": S.pedidoCid = null; break;
    case "encerrar": { const c = S.cidades.find(x => x.id === id); return mudarCidade(id, { encerrada_em: new Date().toISOString() }, `${c.nome} encerrada. Ela saiu do Início e está em Encerradas.`); }
    case "reabrir": { const c = S.cidades.find(x => x.id === id); return mudarCidade(id, { encerrada_em: null }, `${c.nome} reaberta. Ela voltou para o Início.`); }
    case "pedir-recusa": S.recusa = el.dataset.key; break;
    case "cancelar-recusa": S.recusa = null; break;
    case "recusar": {
      S.recusa = null;
      if (await salvarUnidade(+el.dataset.uid, el.dataset.f, null)) toast("Seu nome foi retirado. A atividade ficou sem responsável.");
      return;
    }
    case "editar-cidade": S.editCidade = true; render(); document.getElementById("ecid")?.focus(); return;
    case "cancelar-edicao": S.editCidade = false; break;
    case "pedir-excluir": S.confirmDel = id; break;
    case "cancelar": S.confirmDel = null; break;
    case "pedir-excluir-cidade": S.confirmDelCidade = true; break;
    case "cancelar-excluir-cidade": S.confirmDelCidade = false; break;
    case "excluir-cidade": {
      const c = cidadeAtual(); if (!c) return;
      el.disabled = true;
      const { data, error } = await sb.from("cidades").delete().eq("id", c.id).select();
      if (error || !data?.length) { el.disabled = false; return toast(error ? traduz(error.message) : "Você não tem permissão para excluir cidades.", true); }
      S.cidades = S.cidades.filter(x => x.id !== c.id);
      S.unidades = S.unidades.filter(u => u.cidade_id !== c.id);
      if (String(S.filtro) === String(c.id)) S.filtro = "todas";
      toast(`${c.nome} excluída`); location.hash = "cidades"; return;
    }
    case "excluir": {
      S.confirmDel = null;
      const { error } = await sb.from("unidades").delete().eq("id", id);
      if (error) return toast(traduz(error.message), true);
      S.unidades = S.unidades.filter(u => u.id !== id); toast("Unidade excluída"); break;
    }
    case "status": {
      el.disabled = true;
      const { error } = await sb.from("perfis").update({ status: el.dataset.v }).eq("id", el.dataset.id);
      if (error) { el.disabled = false; return toast(traduz(error.message), true); }
      const p = S.perfis.find(x => x.id === el.dataset.id); if (p) p.status = el.dataset.v;
      toast(el.dataset.v === "aprovado" ? "Acesso liberado" : "Acesso removido"); break;
    }
    default: return;
  }
  render();
});

// dica ao passar o mouse nos gráficos
const tip = document.getElementById("tip");
document.addEventListener("mousemove", e => {
  const t = e.target.closest && e.target.closest("[data-tip]");
  if (!t) { tip.hidden = true; return; }
  tip.textContent = t.dataset.tip; tip.style.left = e.clientX + "px"; tip.style.top = e.clientY + "px"; tip.hidden = false;
});
