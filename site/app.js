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
  if (!S.session) { app.innerHTML = h === "cadastro" ? telaCadastro() : telaLogin(); return; }
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

function telaMsg(titulo, texto) {
  return `<div class="msg"><div class="brand" style="color:var(--accent)">Controle de Atividades</div>
    <h2>${titulo}</h2><p class="muted">${texto}</p>
    <button class="btn sec" type="button" data-acao="sair">Sair</button></div>`;
}

function shell(aba, html) {
  const p = S.perfil, pend = S.perfis.filter(x => x.status === "aguardando").length;
  const tab = (id, nome, extra = "") => `<a href="#${id}" class="${aba === id ? "on" : ""}">${nome}${extra}</a>`;
  return `<header class="top">
      <div class="brand">Controle de Atividades<small>Cálculo e Desenho</small></div>
      <nav class="tabs">${tab("inicio", "Início")}${tab("cidades", "Cidades")}${p.admin ? tab("aprovacoes", "Aprovações", pend ? `<span class="badge">${pend}</span>` : "") : ""}</nav>
      <div class="sp"></div>
      <div class="user"><div class="avatar">${esc(iniciais(p.nome))}</div><span>${esc(p.nome)}${p.admin ? " · admin" : ""}</span>
        <button class="btn-ghost" type="button" data-acao="sair">Sair</button></div>
    </header>
    <div class="page">${html}</div>
    <div class="legend"><span class="label">Status</span>${STATUS.map(([s, k]) => `<span class="chip st-${k}">${s}</span>`).join("")}
      <span class="chip late">Em atraso</span><span class="muted">= previsão vencida e ainda não emitida</span></div>`;
}

function atividades(cidades) {
  const porId = new Map(cidades.map(c => [c.id, c])), out = [];
  for (const u of S.unidades) {
    const c = porId.get(u.cidade_id); if (!c) continue;
    out.push({ c, u, etapa: "Cálculo", resp: u.calc_resp, st: u.calc_status, d: u.calc_prev });
    out.push({ c, u, etapa: "Desenho", resp: u.des_resp, st: u.des_status, d: u.des_prev });
  }
  return out;
}

function itemLog(h, comCidade = true) {
  const alvo = [comCidade && h.cidade, h.unidade, h.campo].filter(Boolean).join(" · ");
  const mud = (h.valor_antigo || h.valor_novo) ? `: ${esc(h.valor_antigo || "—")} → ${esc(h.valor_novo || "—")}` : "";
  return `<li><time>${quando(h.quando)}</time><span><b>${esc(h.usuario_nome)}</b> · ${esc(alvo)}${mud}</span></li>`;
}

function telaInicio() {
  if (S.filtro !== "todas" && !S.cidades.some(c => c.id === +S.filtro)) S.filtro = "todas";
  const lista = S.filtro === "todas" ? S.cidades : S.cidades.filter(c => c.id === +S.filtro);
  const acts = atividades(lista);
  const atras = acts.filter(a => atrasada(a.st, a.d)).sort((a, b) => a.d.localeCompare(b.d));
  const cnt = s => acts.filter(a => a.st === s).length;
  const ids = new Set(lista.map(c => c.id));
  const nUnid = S.unidades.filter(u => ids.has(u.cidade_id)).length;
  const unidAtras = new Set(atras.map(a => a.u.id)).size;
  const kpi = (lbl, v, k) => `<div class="kpi"><span class="label"><i class="st-${k}"></i>${lbl}</span><b>${v}</b></div>`;

  const porCidade = lista.map(c => {
    const a = atividades([c]), t = a.length || 1, l = a.filter(x => atrasada(x.st, x.d)).length;
    const seg = STATUS.map(([s, k]) => `<span class="st-${k}" style="width:${a.filter(x => x.st === s).length / t * 100}%"></span>`).join("");
    return `<tr><td><a href="#cidade-${c.id}">${esc(c.nome)}</a><div class="muted small">${esc(c.contrato)}</div></td>
      <td class="num">${a.length / 2}</td><td><div class="prog">${a.length ? seg : ""}</div></td><td class="num ${l ? "late-txt" : ""}">${l}</td></tr>`;
  }).join("");

  const ult = (S.filtro === "todas" ? S.historico : S.historico.filter(h => h.cidade_id === +S.filtro)).slice(0, 15);

  return shell("inicio", `
    <div class="bar"><h2>${S.filtro === "todas" ? "Todas as cidades" : esc(lista[0]?.nome)}</h2><div class="sp"></div>
      <label class="label" for="fcid">Cidade</label>
      <select id="fcid" class="plain"><option value="todas">Todas</option>${S.cidades.map(c => `<option value="${c.id}"${String(c.id) === String(S.filtro) ? " selected" : ""}>${esc(c.nome)}</option>`).join("")}</select>
    </div>
    <div class="kpis">
      <div class="kpi"><span class="label">Unidades</span><b>${nUnid}</b><span class="muted small">${acts.length} atividades</span></div>
      <div class="kpi late"><span class="label">Em atraso</span><b>${atras.length}</b><span class="small">em ${unidAtras} unidade${unidAtras === 1 ? "" : "s"}</span></div>
      ${kpi("A iniciar", cnt("A iniciar"), "todo")}${kpi("Iniciada", cnt("Iniciada"), "run")}${kpi("Finalizada", cnt("Finalizada"), "done")}${kpi("Emitida", cnt("Emitida"), "emit")}${kpi("Em revisão", cnt("Revisão 1") + cnt("Revisão 2"), "rev1")}
    </div>
    <div class="two">
      <div class="box"><header><h3>Atividades em atraso</h3><span class="muted small">previsão vencida, ainda não emitida</span></header>
        <div class="scroll"><table><thead><tr><th>Cidade</th><th>Unidade</th><th>Etapa</th><th>Responsável</th><th>Status</th><th>Previsão</th><th class="num">Atraso</th></tr></thead>
        <tbody>${atras.length ? atras.map(a => `<tr><td><a href="#cidade-${a.c.id}">${esc(a.c.nome)}</a></td><td class="unit">${esc(a.u.codigo)}</td><td>${a.etapa}</td><td>${esc(a.resp || "—")}</td>
          <td><span class="chip st-${COR[a.st]}">${a.st}</span></td><td class="late-txt">${br(a.d)}</td><td class="num late-txt">${diasAtraso(a.d)} d</td></tr>`).join("")
          : `<tr><td colspan="7" class="muted">Nenhuma atividade em atraso.</td></tr>`}</tbody></table></div>
      </div>
      <div class="box"><header><h3>Andamento por cidade</h3></header>
        <div class="scroll"><table><thead><tr><th>Cidade</th><th class="num">Unid.</th><th>Status das atividades</th><th class="num">Atraso</th></tr></thead>
        <tbody>${porCidade || `<tr><td colspan="4" class="muted">Nenhuma cidade cadastrada.</td></tr>`}</tbody></table></div>
      </div>
    </div>
    <div class="box"><header><h3>Últimas alterações</h3></header>
      ${ult.length ? `<ul class="log">${ult.map(h => itemLog(h)).join("")}</ul>` : `<div class="empty">Nenhuma alteração ainda.</div>`}</div>`);
}

function telaCidades() {
  const cards = S.cidades.map(c => {
    const a = atividades([c]), l = a.filter(x => atrasada(x.st, x.d)).length, e = a.filter(x => x.st === "Emitida").length;
    return `<a class="city" href="#cidade-${c.id}"><div><h3>${esc(c.nome)}</h3><span class="muted">${esc(c.contrato || "Sem contrato")}</span></div>
      <div class="meta"><span class="chip st-todo">${a.length / 2} unidade${a.length === 2 ? "" : "s"}</span>${a.length ? `<span class="chip st-emit">${e}/${a.length} emitidas</span>` : ""}${l ? `<span class="chip late">${l} em atraso</span>` : ""}</div></a>`;
  }).join("");
  return shell("cidades", `
    <div class="bar"><h2>Cidades</h2></div>
    <form class="formline" id="fcidade">
      <label for="ncid">Nome da cidade<input id="ncid" placeholder="Ex.: Mongaguá" required></label>
      <label for="ncon">Contrato<input id="ncon" placeholder="Ex.: Contrato 050/2026" required></label>
      <button class="btn" type="submit">+ Cadastrar cidade</button>
    </form>
    ${cards ? `<div class="cities">${cards}</div>` : `<div class="empty">Nenhuma cidade ainda. Cadastre a primeira acima.</div>`}`);
}

function telaCidade(c) {
  const nomes = S.perfis.filter(p => p.status === "aprovado").map(p => p.nome);
  const selResp = (v, f) => {
    const ops = [...new Set([...nomes, ...(v ? [v] : [])])].sort((a, b) => a.localeCompare(b, "pt-BR"));
    return `<select class="resp" data-f="${f}" aria-label="Responsável"><option value="">—</option>${ops.map(n => `<option${n === v ? " selected" : ""}>${esc(n)}</option>`).join("")}</select>`;
  };
  const selSt = (v, f) => `<select class="pill st-${COR[v]}" data-f="${f}" aria-label="Status">${STATUS.map(([s]) => `<option${s === v ? " selected" : ""}>${s}</option>`).join("")}</select>`;
  const data = (v, st, f) => `<input type="date" class="date${atrasada(st, v) ? " is-late" : ""}" data-f="${f}" value="${v || ""}" aria-label="Previsão de entrega">`;
  const unid = S.unidades.filter(u => u.cidade_id === c.id);
  const busca = S.busca.toLowerCase();
  const admin = S.perfil.admin;

  const linhas = unid.map(u => {
    const chave = [u.codigo, u.calc_resp, u.des_resp].join(" ").toLowerCase();
    const del = !admin ? "" : S.confirmDel === u.id
      ? `<td><button class="btn danger sm" type="button" data-acao="excluir" data-id="${u.id}">Excluir ${esc(u.codigo)}?</button> <button class="btn link" type="button" data-acao="cancelar">Cancelar</button></td>`
      : `<td><button class="btn link" type="button" data-acao="pedir-excluir" data-id="${u.id}" title="Excluir unidade">Excluir</button></td>`;
    return `<tr data-id="${u.id}" data-busca="${esc(chave)}"${busca && !chave.includes(busca) ? " hidden" : ""}>
      <td class="unit">${esc(u.codigo)}</td>
      <td class="split">${selResp(u.calc_resp, "calc_resp")}</td><td>${selSt(u.calc_status, "calc_status")}</td><td>${data(u.calc_prev, u.calc_status, "calc_prev")}</td>
      <td class="split">${selResp(u.des_resp, "des_resp")}</td><td>${selSt(u.des_status, "des_status")}</td><td>${data(u.des_prev, u.des_status, "des_prev")}</td>${del}</tr>`;
  }).join("");

  const hist = S.historico.filter(h => h.cidade_id === c.id).slice(0, 100);

  const cabecalho = S.editCidade
    ? `<form class="formline" id="feditcidade" style="flex:1">
        <label for="ecid">Nome da cidade<input id="ecid" value="${esc(c.nome)}" required></label>
        <label for="econ">Contrato<input id="econ" value="${esc(c.contrato)}" required></label>
        <button class="btn" type="submit">Salvar</button><button class="btn sec" type="button" data-acao="cancelar-edicao">Cancelar</button></form>`
    : `<div><h2>${esc(c.nome)}</h2><span class="muted">${esc(c.contrato || "Sem contrato")}</span>
        <button class="btn link" type="button" data-acao="editar-cidade">Editar</button>
        ${!admin ? "" : S.confirmDelCidade
          ? `<div class="confirma"><span>Excluir <b>${esc(c.nome)}</b>${unid.length ? ` e ${unid.length === 1 ? "sua unidade" : `suas ${unid.length} unidades`}` : ""}? Não dá para desfazer (o histórico fica guardado).</span>
              <button class="btn danger sm" type="button" data-acao="excluir-cidade">Sim, excluir</button>
              <button class="btn link" type="button" data-acao="cancelar-excluir-cidade">Cancelar</button></div>`
          : `<button class="btn link" type="button" data-acao="pedir-excluir-cidade">Excluir cidade</button>`}</div>
      <div class="sp"></div><input id="busca" type="search" placeholder="Buscar unidade ou responsável…" value="${esc(S.busca)}">`;

  return shell("cidades", `
    <div class="bar"><a href="#cidades">← Cidades</a></div>
    <div class="bar">${cabecalho}</div>
    <div class="two wide">
      <div class="box">
        <div class="scroll"><table>
          <thead><tr class="group"><th></th><th colspan="3" class="split">Cálculo</th><th colspan="3" class="split">Desenho</th>${admin ? "<th></th>" : ""}</tr>
          <tr><th>Unidade</th><th class="split">Responsável</th><th>Status</th><th>Previsão de entrega</th><th class="split">Responsável</th><th>Status</th><th>Previsão de entrega</th>${admin ? "<th></th>" : ""}</tr></thead>
          <tbody>${linhas || `<tr><td colspan="${admin ? 8 : 7}" class="muted">Nenhuma unidade ainda. Adicione a primeira abaixo.</td></tr>`}</tbody>
        </table></div>
        <form class="addrow" id="fnovaunidade"><input id="nunid" placeholder="Código da unidade, ex.: EB14" required><button class="btn" type="submit">+ Adicionar unidade</button></form>
      </div>
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
window.addEventListener("hashchange", () => { S.editCidade = false; S.confirmDel = null; S.confirmDelCidade = false; S.busca = ""; render(); window.scrollTo(0, 0); });

async function ocupado(form, fn) {
  const b = form.querySelector("button[type=submit]"); if (b) b.disabled = true;
  try { await fn(); } finally { if (b && b.isConnected) b.disabled = false; }
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
    const c = cidadeAtual(), codigo = v("nunid").toUpperCase();
    const { data, error } = await sb.from("unidades").insert({ cidade_id: c.id, codigo }).select().single();
    if (error) return toast(traduz(error.message), true);
    S.unidades.push(data); S.unidades.sort((a, b) => a.codigo.localeCompare(b.codigo, "pt-BR", { numeric: true }));
    render(); document.getElementById("nunid")?.focus();
  });
});

app.addEventListener("change", async e => {
  const t = e.target;
  if (t.id === "fcid") { S.filtro = t.value; render(); return; }
  const campo = t.dataset.f; if (!campo) return;
  const id = +t.closest("tr").dataset.id, u = S.unidades.find(x => x.id === id);
  const antigo = u[campo], novo = t.value || null;
  u[campo] = novo; render();
  const { error } = await sb.from("unidades").update({ [campo]: novo }).eq("id", id);
  if (error) { u[campo] = antigo; render(); toast("Não foi possível salvar: " + traduz(error.message), true); }
});

app.addEventListener("input", e => {
  if (e.target.id !== "busca") return;
  S.busca = e.target.value; const b = S.busca.toLowerCase();
  app.querySelectorAll("tr[data-busca]").forEach(tr => { tr.hidden = !!b && !tr.dataset.busca.includes(b); });
});

app.addEventListener("click", async e => {
  const el = e.target.closest("[data-acao]"); if (!el) return;
  const acao = el.dataset.acao;
  if (acao === "sair") { await sb.auth.signOut(); history.replaceState(null, "", location.pathname); return; }
  if (acao === "editar-cidade") { S.editCidade = true; render(); document.getElementById("ecid")?.focus(); return; }
  if (acao === "cancelar-edicao") { S.editCidade = false; render(); return; }
  if (acao === "pedir-excluir") { S.confirmDel = +el.dataset.id; render(); return; }
  if (acao === "cancelar") { S.confirmDel = null; render(); return; }
  if (acao === "pedir-excluir-cidade") { S.confirmDelCidade = true; render(); return; }
  if (acao === "cancelar-excluir-cidade") { S.confirmDelCidade = false; render(); return; }
  if (acao === "excluir-cidade") {
    const c = cidadeAtual(); if (!c) return;
    el.disabled = true;
    const { data, error } = await sb.from("cidades").delete().eq("id", c.id).select();
    if (error || !data?.length) { el.disabled = false; return toast(error ? traduz(error.message) : "Você não tem permissão para excluir cidades.", true); }
    S.cidades = S.cidades.filter(x => x.id !== c.id);
    S.unidades = S.unidades.filter(u => u.cidade_id !== c.id);
    if (String(S.filtro) === String(c.id)) S.filtro = "todas";
    toast(`${c.nome} excluída`); location.hash = "cidades"; return;
  }
  if (acao === "excluir") {
    const id = +el.dataset.id; S.confirmDel = null;
    const { error } = await sb.from("unidades").delete().eq("id", id);
    if (error) return toast(traduz(error.message), true);
    S.unidades = S.unidades.filter(u => u.id !== id); toast("Unidade excluída"); render(); return;
  }
  if (acao === "status") {
    el.disabled = true;
    const { error } = await sb.from("perfis").update({ status: el.dataset.v }).eq("id", el.dataset.id);
    if (error) { el.disabled = false; return toast(traduz(error.message), true); }
    const p = S.perfis.find(x => x.id === el.dataset.id); if (p) p.status = el.dataset.v;
    toast(el.dataset.v === "aprovado" ? "Acesso liberado" : "Acesso removido"); render();
  }
});
