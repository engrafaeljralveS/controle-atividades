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
  modo: null, abaCid: "ativas", pedidoCid: null, divSel: "todas", fc: "", ft: "", fd: "", recusa: null,
  contratos: [], fCtr: "todos", fDiv: "todas", ctrSel: {}, editCtr: false, confirmDelCtr: null, V: {},
  pessoa: "", histAberto: {}, histBusca: {},
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
  if (/contratos_cidade_id_nome_key/i.test(m)) return "Já existe um contrato com esse nome nesta cidade.";
  if (/duplicate key/i.test(m)) return "Já existe uma unidade com esse código neste contrato.";
  if (/same.*password|different from the old/i.test(m)) return "A senha nova precisa ser diferente da atual.";
  if (/rate limit|too many/i.test(m)) return "Muitas tentativas seguidas. Espere alguns minutos e tente de novo.";
  if (/Só o usuário chefe|usuário chefe|próprio acesso/i.test(m)) return m.replace(/^.*?ERROR:\s*/, "");
  if (/row-level security.*cidades|cidades.*row-level/i.test(m)) return "Só administradores podem criar ou alterar cidades.";
  if (/Só o administrador/i.test(m)) return "Só o administrador pode encerrar ou reabrir cidades.";
  if (/row-level security/i.test(m)) return /cidades/.test(m) ? "Só administradores podem criar ou alterar cidades." : "Você não tem permissão para essa alteração.";
  return m;
}

// ---------- configuração ---------------------------------------------
if (typeof SUPABASE_URL === "undefined" || !/^https?:\/\//.test(SUPABASE_URL) || typeof supabase === "undefined") {
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
  const [c, u, h, p, k] = await Promise.all([
    sb.from("cidades").select("*").order("nome"),
    sb.from("unidades").select("*").order("codigo"),
    sb.from("historico").select("*").order("quando", { ascending: false }).limit(500),
    sb.from("perfis").select("*").order("nome"),
    sb.from("contratos").select("*").order("nome"),
  ]);
  S.bancoVelho = !!(k.error && /contratos|does not exist|schema cache/i.test(k.error.message));
  const erro = [c, u, h, p, k].find(r => r.error && !(r === k && S.bancoVelho));
  if (erro) toast("Erro ao carregar dados: " + erro.error.message, true);
  S.cidades = c.data || []; S.unidades = u.data || []; S.historico = h.data || []; S.perfis = p.data || []; S.contratos = k.data || [];
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
  else if ((h === "usuarios" || h === "aprovacoes") && S.perfil.admin) app.innerHTML = telaUsuarios();
  else app.innerHTML = telaInicio();
}

function telaLogin() {
  return `<div class="authwrap"><form class="auth" id="flogin">
    <div class="brand">Controle de Atividades<small>Setor de Estruturas</small></div>
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
      <div class="brand">Controle de Atividades<small>Setor de Estruturas · v3.1</small></div>
      <nav class="tabs">${tab("inicio", "Início")}${tab("cidades", "Cidades")}</nav>
      <div class="sp"></div>
      <div class="user"><div class="avatar">${esc(iniciais(p.nome))}</div><span class="who">${esc(p.nome)}<small>${nivel(p)}</small></span>
        ${p.admin ? `<a class="btn-ghost${aba === "usuarios" ? " on" : ""}" href="#usuarios">Usuários${pend ? `<span class="badge">${pend}</span>` : ""}</a>` : ""}
        <button class="btn-ghost" type="button" data-acao="trocar-senha">Trocar senha</button>
        <button class="btn-ghost" type="button" data-acao="sair">Sair</button></div>
    </header>
    ${S.bancoVelho ? `<div class="aviso-banco"><b>Falta atualizar o banco de dados.</b> ${p.admin ? "Rode o arquivo <code>supabase/banco.sql</code> no SQL Editor do Supabase. Este aviso some sozinho depois." : "Avise o administrador. Enquanto isso, contratos e cadastros novos não funcionam."}</div>` : ""}
    ${cheio ? html : `<div class="page">${html}</div>`}
    ${cheio ? "" : `<div class="legend"><span class="label">Status</span>${STATUS.map(([s, k]) => `<span class="chip st-${k}">${s}</span>`).join("")}
      <span class="chip late">Em atraso</span><span class="muted">= previsão vencida e ainda não emitida</span></div>`}`;
}

const ativa = c => !c.encerrada_em;
const cidadesAtivas = () => S.cidades.filter(ativa);
const contratosDe = c => S.contratos.filter(k => k.cidade_id === c.id);
const divisoesDe = k => [...new Set([...(k.divisoes || []), ...S.unidades.filter(u => u.contrato_id === k.id && u.divisao).map(u => u.divisao)])].sort((a, b) => a.localeCompare(b, "pt-BR", { numeric: true }));
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
  const admin = S.perfil.admin;
  const pessoas = S.perfis.filter(p => p.status === "aprovado").map(p => p.nome).sort((a, b) => a.localeCompare(b, "pt-BR"));
  if (S.modo === "pessoa" && (!admin || !pessoas.includes(S.pessoa))) S.modo = null;
  const modo = S.modo || (admin ? "todas" : "minhas");
  const ativas = cidadesAtivas();
  if (S.filtro !== "todas" && !ativas.some(c => c.id === +S.filtro)) S.filtro = "todas";
  const um = S.filtro !== "todas" ? ativas.find(c => c.id === +S.filtro) : null;
  const ks = um ? contratosDe(um) : [];
  if (S.fCtr !== "todos" && !ks.some(k => k.id === +S.fCtr)) S.fCtr = "todos";
  const kSel = S.fCtr !== "todos" ? ks.find(k => k.id === +S.fCtr) : null;
  const dvs = kSel ? divisoesDe(kSel) : [];
  if (S.fDiv !== "todas" && !dvs.includes(S.fDiv)) S.fDiv = "todas";
  const lista = um ? [um] : ativas;
  const passa = u => (!kSel || u.contrato_id === kSel.id) && (S.fDiv === "todas" || u.divisao === S.fDiv);
  const todas = atividades(lista).filter(a => passa(a.u)), meus = todas.filter(a => a.resp === nomeEu());
  const dela = modo === "pessoa" ? todas.filter(a => a.resp === S.pessoa) : [];
  const A = modo === "minhas" ? meus : modo === "pessoa" ? dela : todas, tot = A.length, cnt = s => A.filter(a => a.st === s).length;
  const L = A.filter(late), unidAtras = new Set(L.map(a => a.u.id)).size;
  const ids = new Set(lista.map(c => c.id)), nUnid = S.unidades.filter(u => ids.has(u.cidade_id) && passa(u)).length;
  const emit = cnt("Emitida"), and = cnt("Iniciada") + cnt("Revisão 1") + cnt("Revisão 2");
  const caminho = [um?.nome, kSel?.nome, S.fDiv !== "todas" ? S.fDiv : null].filter(Boolean).map(esc).join(" · ");
  const comCidade = !um;

  const titulo = modo === "minhas" ? `Olá, ${esc(nomeEu().split(" ")[0])}` : modo === "pessoa" ? `Atividades de ${esc(S.pessoa)}` : caminho || "Todas as cidades";
  const sub = modo !== "todas"
    ? `${tot} atividade${tot === 1 ? "" : "s"} designada${tot === 1 ? "" : "s"} para ${modo === "minhas" ? "você" : esc(S.pessoa)} · ${caminho || "todas as cidades"}`
    : `${um ? `${ks.length} contrato${ks.length === 1 ? "" : "s"}` : `${ativas.length} cidade${ativas.length === 1 ? "" : "s"} em andamento`} · ${nUnid} unidade${nUnid === 1 ? "" : "s"} · ${tot} atividade${tot === 1 ? "" : "s"}`;

  const g1 = modo !== "todas"
    ? `<div class="g"><div><div class="label">${modo === "minhas" ? "Para você" : "Para " + esc(S.pessoa.split(" ")[0])}</div><div class="big">${tot}</div><div class="small">atividades designadas</div></div></div>`
    : `<div class="g"><div><div class="label">Unidades</div><div class="big">${nUnid}</div><div class="small">${tot} atividades</div></div></div>`;
  const chip = (acao, v, txt, on) => `<button type="button" data-acao="${acao}" data-v="${esc(v)}" aria-pressed="${on}">${esc(txt)}</button>`;

  const hero = `<div class="hero">
    <div class="hero-head"><div><div class="label">Painel de acompanhamento</div><h2>${titulo}</h2><div class="sub">${sub}</div></div></div>
    <div class="seg" role="group" aria-label="Quais atividades mostrar">
      <button type="button" data-acao="modo" data-v="minhas" aria-pressed="${modo === "minhas"}">Minhas atividades<span class="cnt">${meus.length}</span></button>
      <button type="button" data-acao="modo" data-v="todas" aria-pressed="${modo === "todas"}">Todas as atividades</button>
      ${admin ? `<label class="pessoa${modo === "pessoa" ? " on" : ""}"><span>Por pessoa</span><select id="fpessoa" aria-label="Ver as atividades de uma pessoa"><option value="">Escolha…</option>${pessoas.map(n => `<option${modo === "pessoa" && n === S.pessoa ? " selected" : ""}>${esc(n)}</option>`).join("")}</select></label>` : ""}</div>
    <div class="frows">
      <div class="frow"><span class="k">Cidade</span><div class="hchips">${chip("filtro", "todas", "Todas", S.filtro === "todas")}${ativas.map(c => chip("filtro", c.id, c.nome, String(S.filtro) === String(c.id))).join("")}</div></div>
      ${um ? `<div class="frow"><span class="k">Contrato</span><div class="hchips l2">${chip("fctr", "todos", "Todos", !kSel)}${ks.map(k => chip("fctr", k.id, k.nome, kSel?.id === k.id)).join("")}</div></div>` : ""}
      ${dvs.length ? `<div class="frow"><span class="k">Divisão</span><div class="hchips l3">${chip("fdiv", "todas", "Todas", S.fDiv === "todas")}${dvs.map(d => chip("fdiv", d, d, S.fDiv === d)).join("")}</div></div>` : ""}
    </div>
    ${kSel && kSel.observacoes ? `<div class="hobs"><b>Observações do contrato</b>${esc(kSel.observacoes)}</div>` : ""}
    <div class="gauges">${g1}
      <div class="g">${anel(tot ? emit / tot : 0, "var(--hero-emit)", "glow-emit", (tot ? Math.round(emit / tot * 100) : 0) + "%")}<div><div class="label">Emitidas</div><div class="big">${emit}<span class="small"> /${tot}</span></div><div class="small">progresso</div></div></div>
      <div class="g">${anel(tot ? and / tot : 0, "var(--hero-run)", "glow-run", and)}<div><div class="label">Em andamento</div><div class="big">${and}</div><div class="small">iniciadas e em revisão</div></div></div>
      <div class="g ${L.length ? "alert" : ""}">${anel(tot ? L.length / tot : 0, "var(--hero-late)", "glow-late", L.length)}<div><div class="label">Em atraso</div><div class="big">${L.length}</div><div class="small">em ${unidAtras} unidade${unidAtras === 1 ? "" : "s"}</div></div></div>
    </div></div>`;

  if (!ativas.length) return shell("inicio", hero + `<div class="page"><div class="empty">Nenhuma cidade em andamento. Cadastre uma na aba <a href="#cidades">Cidades</a>.</div></div>`, true);
  if (modo !== "todas") return shell("inicio", hero + `<div class="page">${painelMinhas(A, comCidade, modo === "pessoa" ? S.pessoa : null)}</div>`, true);

  const etapas = ["calc", "des"].map(e => {
    const a = A.filter(x => x.e === e), l = a.filter(late).length, em = a.filter(x => x.st === "Emitida").length;
    return `<div class="bar-row"><div class="name">${e === "calc" ? "Cálculo" : "Desenho"}<small>${em} de ${a.length} emitidas</small></div>${pilha(a)}${tagAtraso(l)}</div>`;
  }).join("");
  const barra = (acao, v, nome, a, sub) => {
    const l = a.filter(late).length, em = a.filter(x => x.st === "Emitida").length;
    return `<div class="bar-row click" data-acao="${acao}" data-v="${v}"><div class="name">${esc(nome)}<small>${sub} · ${a.length ? Math.round(em / a.length * 100) : 0}% emitido</small></div>${a.length ? pilha(a) : `<div class="stack"></div>`}${tagAtraso(l)}</div>`;
  };

  let blocoMeio;
  if (!um) {
    blocoMeio = `<section class="panel span2"><header><h3>Andamento por cidade</h3><span class="note">toque numa cidade para filtrar</span></header>
      <div class="bars">${lista.map(c => { const a = atividades([c]); return barra("filtro", c.id, c.nome, a, `${a.length / 2} unid.`); }).join("")}</div></section>`;
  } else if (!kSel) {
    blocoMeio = `<section class="panel span2"><header><h3>Andamento por contrato</h3><span class="note">toque num contrato para filtrar · <a href="#cidade-${um.id}">abrir a cidade</a></span></header>
      <div class="bars">${ks.map(k => { const a = atividades([um]).filter(x => x.u.contrato_id === k.id); return barra("fctr", k.id, k.nome, a, `${a.length / 2} unid.`); }).join("") || `<div class="empty">Nenhum contrato nesta cidade.</div>`}</div></section>`;
  } else {
    const us = S.unidades.filter(u => u.contrato_id === kSel.id && passa(u)).sort((a, b) => (a.divisao || "").localeCompare(b.divisao || "", "pt-BR") || a.codigo.localeCompare(b.codigo, "pt-BR", { numeric: true }));
    const et = (n, s, d) => `<div class="et"><em>${n}</em><span class="dotlbl"><i style="background:var(--c-${COR[s]})"></i>${s}</span><span class="num">${d ? br(d).slice(0, 5) : "—"}</span></div>`;
    blocoMeio = `<section class="panel span2"><header><h3>Unidades</h3><span class="note">borda vermelha = atividade atrasada · <a href="#cidade-${um.id}">abrir a cidade</a></span></header>
      ${us.length ? `<div class="utiles">${us.map(u => {
        const ls = [atrasada(u.calc_status, u.calc_prev), atrasada(u.des_status, u.des_prev)].filter(Boolean).length;
        return `<a class="utile ${ls ? "is-late" : ""}" href="#cidade-${um.id}"><b>${esc(u.codigo)}${u.divisao ? ` <small>${esc(u.divisao)}</small>` : ""}</b>
          ${et("Cálculo", u.calc_status, u.calc_prev)}${et("Desenho", u.des_status, u.des_prev)}${ls ? `<span class="lt">${ls} atividade${ls > 1 ? "s" : ""} em atraso</span>` : ""}</a>`;
      }).join("")}</div>` : `<div class="empty">Nenhuma unidade aqui ainda.</div>`}</section>`;
  }

  const ult = um ? S.historico.filter(h => h.cidade_id === um.id) : S.historico;
  return shell("inicio", hero + `<div class="dash">
    <section class="panel"><header><h3>Status das atividades</h3><span class="note">cálculo + desenho</span></header>${rosca(A)}</section>
    <section class="panel"><header><h3>Cálculo × Desenho</h3><span class="note">atividades em cada status</span></header><div class="bars">${etapas}</div>${miniLegenda()}</section>
    ${blocoMeio}
    <section class="panel"><header><h3>Em atraso</h3><span class="note">previsão vencida e não emitida</span></header>${listaAtrasos(L, comCidade)}</section>
    <section class="panel"><header><h3>Próximas entregas</h3><span class="note">próximos 14 dias</span></header>${listaProximas(A, comCidade)}</section>
    ${historicoBox(ult, comCidade, "inicio", "Últimas alterações")}
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

function painelMinhas(A, comCidade, pessoa) {
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
        ${pedindo || pessoa ? "" : `<button type="button" class="btn-out" data-acao="pedir-recusa" data-key="${key}">Recusar</button>`}</div>
      ${pedindo ? `<div class="confirma"><span>Tirar seu nome desta atividade? Ela fica sem responsável, e o histórico registra que você saiu.</span>
        <button type="button" class="btn danger sm" data-acao="recusar" data-uid="${a.u.id}" data-f="${a.e}_resp">Sim, recusar</button>
        <button type="button" class="btn link" data-acao="cancelar-recusa">Cancelar</button></div>` : ""}
    </div></li>`;
  };
  return `<section class="panel"><header><h3>Designadas para ${pessoa ? esc(pessoa) : "você"}</h3><span class="note">${pessoa ? "as mudanças de status ficam registradas no histórico com o seu nome" : "não vai fazer? use “Recusar” para tirar seu nome"}</span></header>
    ${A.length ? grupos.filter(g => g[1].length).map(([t, arr, c]) => `<div class="group-t ${c}">${t} · ${arr.length}</div><ul class="mine">${arr.map(card).join("")}</ul>`).join("")
      : `<div class="empty">Nenhuma atividade designada para ${pessoa ? esc(pessoa) : "você"}${comCidade ? "" : " neste filtro"}. Toque em “Todas as atividades” para ver tudo.</div>`}</section>`;
}

// ---------- Cidades ----------------------------------------------------
const valor = id => esc(S.V[id] || "");

// Cadastro em cascata: Cidade → Contrato → Divisão → Unidade
function cascata(fixa) {
  const ativas = cidadesAtivas();
  const c = fixa || ativas.find(x => x.id === +S.fc);
  const novaCid = !fixa && S.fc === "__nova";
  const ks = c ? contratosDe(c) : [];
  const k = c && S.ft && S.ft !== "__novo" ? ks.find(x => x.id === +S.ft) : null;
  const novoCtr = novaCid || S.ft === "__novo";
  const dvs = k ? divisoesDe(k) : [];
  const temCid = !!c || novaCid, temCtr = !!k || novoCtr, n = fixa ? 0 : 1;

  const p1 = fixa ? "" : `<div class="step"><span><i>1</i> · Cidade</span>
      <select id="sc"><option value="">Escolha…</option>${ativas.map(x => `<option value="${x.id}"${x.id === +S.fc ? " selected" : ""}>${esc(x.nome)}</option>`).join("")}${S.perfil.admin ? `<option value="__nova"${novaCid ? " selected" : ""}>+ Nova cidade…</option>` : ""}</select>
      ${novaCid ? `<div class="newbox"><label for="ncid">Nome da cidade<input id="ncid" placeholder="Ex.: Mongaguá" value="${valor("ncid")}"></label></div>` : ""}</div>`;
  const p2 = `<div class="step"><span><i>${n + 1}</i> · Contrato</span>
      <select id="sct"${temCid && !novaCid ? "" : " disabled"}>${novaCid ? `<option>+ Novo contrato…</option>` : temCid
        ? `<option value="">Escolha…</option>${ks.map(x => `<option value="${x.id}"${k?.id === x.id ? " selected" : ""}>${esc(x.nome)}</option>`).join("")}<option value="__novo"${S.ft === "__novo" ? " selected" : ""}>+ Novo contrato…</option>`
        : `<option>Escolha a cidade primeiro</option>`}</select>
      ${novoCtr ? `<div class="newbox"><label for="nctr">Nome do contrato<input id="nctr" placeholder="Ex.: Contrato BBL" value="${valor("nctr")}"></label>
        <label for="nobs">Observações do contrato <span class="opt">(responsável, contatos, regras…)</span><textarea id="nobs" placeholder="Ex.: Responsável: Eng. Marcos (BBL), (13) 99999-0000. Medição até o dia 5.">${valor("nobs")}</textarea></label></div>` : ""}</div>`;
  const p3 = `<div class="step"><span><i>${n + 2}</i> · Divisão <span class="opt">(opcional)</span></span>
      <select id="sd"${temCtr ? "" : " disabled"}>${temCtr ? `<option value=""${S.fd === "" ? " selected" : ""}>Sem divisão</option>${dvs.map(d => `<option${d === S.fd ? " selected" : ""}>${esc(d)}</option>`).join("")}<option value="__nova"${S.fd === "__nova" ? " selected" : ""}>+ Nova divisão…</option>` : `<option>Escolha o contrato primeiro</option>`}</select>
      ${S.fd === "__nova" ? `<div class="newbox"><label for="ndiv">Nome da divisão<input id="ndiv" placeholder="Ex.: Bacia A" value="${valor("ndiv")}"></label></div>` : ""}</div>`;
  const p4 = `<div class="step"><span><i>${n + 3}</i> · Unidade <span class="opt">(opcional)</span></span><input id="uu" placeholder="Ex.: EB15" value="${valor("uu")}"${temCtr ? "" : " disabled"}></div>`;
  const dica = !temCid ? (S.perfil.admin ? "Comece pela cidade. Se ela ainda não existe, escolha “+ Nova cidade…”." : "Comece pela cidade. Cidades novas são cadastradas por um administrador.")
    : !temCtr ? (ks.length ? `${esc(c.nome)} tem ${ks.length} contrato${ks.length > 1 ? "s" : ""}. Escolha um ou crie outro.` : "Cadastre o primeiro contrato desta cidade.")
    : "Divisão e unidade são opcionais: dá para cadastrar só a cidade e o contrato agora, e as unidades depois.";
  return `<form class="cascade" id="fcasc"><h3>${fixa ? "Adicionar em " + esc(fixa.nome) : "Cadastrar"}</h3>
    <div class="steps">${p1}${p2}${p3}${p4}</div>
    <div class="end"><button class="btn" type="submit"${temCtr ? "" : " disabled"}>Salvar</button><span class="hint">${dica}</span></div></form>`;
}

function cartaoContrato(k) {
  const us = S.unidades.filter(u => u.contrato_id === k.id), dv = divisoesDe(k);
  const a = us.flatMap(u => [{ st: u.calc_status }, { st: u.des_status }]);
  const obs = (k.observacoes || "").split("\n")[0];
  return `<div class="ctr"><div class="row"><b>${esc(k.nome)}</b><span class="muted small">${us.length} unid.</span></div>
    ${dv.length ? `<div class="divs">${dv.map(d => `<span class="dchip">${esc(d)} · ${us.filter(u => u.divisao === d).length}</span>`).join("")}</div>` : `<span class="muted small">Sem divisões</span>`}
    ${a.length ? pilha(a) : ""}
    ${obs ? `<span class="muted small"><b>Obs.:</b> ${esc(obs.slice(0, 70))}${obs.length > 70 || k.observacoes.includes("\n") ? "…" : ""}</span>` : ""}</div>`;
}

function telaCidades() {
  const ativas = cidadesAtivas(), enc = S.cidades.filter(c => !ativa(c)), admin = S.perfil.admin;
  const aba = S.abaCid === "enc" ? "enc" : "ativas", lista = aba === "ativas" ? ativas : enc;
  const card = c => {
    const a = atividades([c]), l = a.filter(late).length, em = a.filter(x => x.st === "Emitida").length, pend = a.length - em;
    let acao;
    if (!ativa(c)) acao = S.pedidoCid === c.id
      ? `<div class="confirma soft"><span>Reabrir <b>${esc(c.nome)}</b>? Ela volta para o Início e dá para criar novas atividades.</span>
          <button class="btn sm" type="button" data-acao="reabrir" data-id="${c.id}">Sim, reabrir</button><button class="btn link" type="button" data-acao="cancelar-cid">Cancelar</button></div>`
      : `<div class="acts"><a class="btn sec sm" href="#cidade-${c.id}">Consultar</a>${admin ? `<button class="btn ghost sm" type="button" data-acao="pedir-cid" data-id="${c.id}">Reabrir</button>` : ""}</div>`;
    else acao = S.pedidoCid === c.id
      ? `<div class="confirma"><span>Encerrar <b>${esc(c.nome)}</b>? Ela sai do Início e vai para <b>Encerradas</b>. Dá para reabrir depois.${pend ? ` <b>Atenção:</b> ${pend} atividade${pend > 1 ? "s ainda não foram emitidas" : " ainda não foi emitida"}.` : ""}</span>
          <button class="btn danger sm" type="button" data-acao="encerrar" data-id="${c.id}">Sim, encerrar</button><button class="btn link" type="button" data-acao="cancelar-cid">Cancelar</button></div>`
      : `<div class="acts"><a class="btn sm" href="#cidade-${c.id}">Abrir</a>${admin ? `<button class="btn ghost sm" type="button" data-acao="pedir-cid" data-id="${c.id}">Encerrar cidade</button>` : ""}</div>`;
    const ks = contratosDe(c);
    return `<article class="city ${ativa(c) ? "" : "closed"}">
      <div class="head"><div><h3>${esc(c.nome)}</h3><div class="contrato">${ks.length} contrato${ks.length === 1 ? "" : "s"} · ${a.length / 2} unidades</div></div>
        ${!ativa(c) ? `<span class="chip closed">Encerrada</span>` : l ? `<span class="chip late">${l} em atraso</span>` : `<span class="chip ok">Em dia</span>`}</div>
      <div class="contracts">${ks.map(cartaoContrato).join("") || `<span class="muted small">Nenhum contrato ainda.</span>`}</div>
      ${!ativa(c) ? `<div class="muted small">Encerrada em ${dataCurta(c.encerrada_em)}/${new Date(c.encerrada_em).getFullYear()}${c.encerrada_por ? " por " + esc(c.encerrada_por) : ""}</div>` : ""}
      ${acao}</article>`;
  };
  return shell("cidades", `
    <div class="bar"><h2>Cidades</h2><span class="sp"></span>
      <div class="seg2" role="group" aria-label="Situação">
        <button type="button" data-acao="aba-cid" data-v="ativas" aria-pressed="${aba === "ativas"}">Em andamento<span class="cnt">${ativas.length}</span></button>
        <button type="button" data-acao="aba-cid" data-v="enc" aria-pressed="${aba === "enc"}">Encerradas<span class="cnt">${enc.length}</span></button></div></div>
    ${aba === "ativas" ? cascata(null) : `<div class="note">Cidades encerradas não aparecem no Início. As atividades ficam guardadas para consulta.</div>`}
    ${lista.length ? `<div class="cities">${lista.map(card).join("")}</div>` : `<div class="empty">${aba === "ativas" ? "Nenhuma cidade em andamento. Cadastre a primeira acima." : "Nenhuma cidade encerrada."}</div>`}`);
}

function telaCidade(c) {
  const admin = S.perfil.admin, fechada = !ativa(c);
  const ks = contratosDe(c);
  let k = ks.find(x => x.id === S.ctrSel[c.id]) || ks[0] || null;
  if (k && !fechada && (!S.ft || (S.ft !== "__novo" && !ks.some(x => x.id === +S.ft)))) S.ft = String(k.id);
  const nomes = S.perfis.filter(p => p.status === "aprovado").map(p => p.nome);
  const divs = k ? divisoesDe(k) : [];
  const selResp = (v, f, id) => {
    const ops = [...new Set([...nomes, ...(v ? [v] : [])])].sort((a, b) => a.localeCompare(b, "pt-BR"));
    return `<select class="resp" data-uid="${id}" data-f="${f}" aria-label="Responsável"><option value="">—</option>${ops.map(n => `<option${n === v ? " selected" : ""}>${esc(n)}</option>`).join("")}</select>`;
  };
  const selSt = (v, f, id) => `<select class="pill st-${COR[v]}" data-uid="${id}" data-f="${f}" aria-label="Status">${STATUS.map(([s]) => `<option${s === v ? " selected" : ""}>${s}</option>`).join("")}</select>`;
  const data = (v, st, f, id) => `<input type="date" class="date${atrasada(st, v) ? " is-late" : ""}" data-uid="${id}" data-f="${f}" value="${v || ""}" aria-label="Previsão de entrega">`;
  const ro = (s, d, r) => [`${esc(r || "—")}`, `<span class="chip st-${COR[s]}">${s}</span>`, `<span class="num${atrasada(s, d) ? " late-txt" : ""}">${br(d)}</span>`];
  const unid = k ? S.unidades.filter(u => u.contrato_id === k.id) : [];
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
    const cel = fechada
      ? [...ro(u.calc_status, u.calc_prev, u.calc_resp), ...ro(u.des_status, u.des_prev, u.des_resp)]
      : [selResp(u.calc_resp, "calc_resp", u.id), selSt(u.calc_status, "calc_status", u.id), data(u.calc_prev, u.calc_status, "calc_prev", u.id),
         selResp(u.des_resp, "des_resp", u.id), selSt(u.des_status, "des_status", u.id), data(u.des_prev, u.des_status, "des_prev", u.id)];
    return `<tr data-busca="${esc(chave)}"${busca && !chave.includes(busca) ? " hidden" : ""}>
      <td class="unit">${esc(u.codigo)}${moverDiv}</td>
      <td class="split" data-label="Cálculo · responsável">${cel[0]}</td><td data-label="Cálculo · status">${cel[1]}</td><td data-label="Cálculo · previsão">${cel[2]}</td>
      <td class="split" data-label="Desenho · responsável">${cel[3]}</td><td data-label="Desenho · status">${cel[4]}</td><td data-label="Desenho · previsão">${cel[5]}</td>${del.replace("<td>", '<td class="del">')}</tr>`;
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

  const abasDiv = divs.length ? `<div class="dtabs" role="group" aria-label="Divisões">
      <button type="button" data-acao="div" data-v="todas" aria-pressed="${S.divSel === "todas"}">Todas<span class="cnt">${unid.length}</span></button>
      ${divs.map(d => `<button type="button" data-acao="div" data-v="${esc(d)}" aria-pressed="${S.divSel === d}">${esc(d)}<span class="cnt">${unid.filter(u => u.divisao === d).length}</span></button>`).join("")}
      ${temSem ? `<button type="button" data-acao="div" data-v="__sem" aria-pressed="${S.divSel === "__sem"}">Sem divisão<span class="cnt">${unid.filter(u => !u.divisao).length}</span></button>` : ""}</div>` : "";

  const abasCtr = ks.length ? `<div class="ctabs" role="group" aria-label="Contratos">${ks.map(x => `<button type="button" data-acao="ctr-tab" data-id="${x.id}" aria-pressed="${x.id === k.id}">${esc(x.nome)}<span class="cnt">${S.unidades.filter(u => u.contrato_id === x.id).length}</span></button>`).join("")}</div>` : "";

  let obsBox = "";
  if (k) {
    const nU = unid.length;
    const del = !admin || fechada ? "" : S.confirmDelCtr === k.id
      ? `<div class="confirma"><span>Excluir o <b>${esc(k.nome)}</b>${nU ? ` e ${nU === 1 ? "sua unidade" : `suas ${nU} unidades`}` : ""}? Não dá para desfazer (o histórico fica guardado).</span>
          <button class="btn danger sm" type="button" data-acao="excluir-ctr" data-id="${k.id}">Sim, excluir</button><button class="btn link" type="button" data-acao="cancelar-ctr-del">Cancelar</button></div>`
      : `<button class="btn link" type="button" data-acao="pedir-excluir-ctr" data-id="${k.id}">Excluir contrato</button>`;
    obsBox = S.editCtr && !fechada
      ? `<form class="obsbox" id="fctr"><h3>Editar contrato</h3>
          <label for="knome">Nome do contrato<input id="knome" value="${esc(k.nome)}" required></label>
          <label for="kobs">Observações (responsável, contatos, regras…)<textarea id="kobs" rows="5">${esc(k.observacoes || "")}</textarea></label>
          <div class="bar"><button class="btn sm" type="submit">Salvar</button><button class="btn sec sm" type="button" data-acao="cancelar-ctr">Cancelar</button></div></form>`
      : `<section class="obsbox"><div class="row"><h3>Observações do contrato</h3>${fechada ? "" : `<button class="btn link" type="button" data-acao="editar-ctr">Editar</button>`}</div>
          ${k.observacoes ? `<p>${esc(k.observacoes)}</p>${k.obs_por ? `<span class="meta">Atualizado por ${esc(k.obs_por)} em ${dataCurta(k.obs_em)}</span>` : ""}`
            : `<span class="muted">Nenhuma observação ainda. Use para anotar o responsável do contrato, contatos e regras de entrega.</span>`}
          ${del}</section>`;
  }

  const hist = S.historico.filter(h => h.cidade_id === c.id);
  const cab = S.editCidade && !fechada
    ? `<form class="formline" id="feditcidade" style="flex:1"><label for="ecid">Nome da cidade<input id="ecid" value="${esc(c.nome)}" required></label>
        <button class="btn" type="submit">Salvar</button><button class="btn sec" type="button" data-acao="cancelar-edicao">Cancelar</button></form>`
    : `<div><h2>${esc(c.nome)}</h2><span class="muted">${ks.length} contrato${ks.length === 1 ? "" : "s"}</span>
      ${fechada || !admin ? "" : `<button class="btn link" type="button" data-acao="editar-cidade">Renomear</button>`}
      ${admin && !fechada ? (S.pedidoCid === c.id
        ? `<div class="confirma"><span>Encerrar <b>${esc(c.nome)}</b>? Ela sai do Início e vai para Encerradas.</span><button class="btn danger sm" type="button" data-acao="encerrar" data-id="${c.id}">Sim, encerrar</button><button class="btn link" type="button" data-acao="cancelar-cid">Cancelar</button></div>`
        : `<button class="btn link" type="button" data-acao="pedir-cid" data-id="${c.id}">Encerrar cidade</button>`) : ""}
      ${admin ? (S.confirmDelCidade
        ? `<div class="confirma"><span>Excluir <b>${esc(c.nome)}</b> com todos os contratos e unidades? Não dá para desfazer (o histórico fica guardado).</span>
            <button class="btn danger sm" type="button" data-acao="excluir-cidade">Sim, excluir</button><button class="btn link" type="button" data-acao="cancelar-excluir-cidade">Cancelar</button></div>`
        : `<button class="btn link" type="button" data-acao="pedir-excluir-cidade">Excluir cidade</button>`) : ""}</div>
      <div class="sp"></div><input id="busca" type="search" placeholder="Buscar unidade ou responsável…" value="${esc(S.busca)}">`;

  return shell("cidades", `
    <div class="bar"><a href="#cidades">← Cidades</a></div>
    <div class="bar">${cab}</div>
    ${fechada ? `<div class="banner"><span>Cidade <b>encerrada</b> em ${dataCurta(c.encerrada_em)}/${new Date(c.encerrada_em).getFullYear()}${c.encerrada_por ? " por " + esc(c.encerrada_por) : ""}. As atividades ficam só para consulta.</span>
      ${admin ? (S.pedidoCid === c.id ? `<button class="btn sm" type="button" data-acao="reabrir" data-id="${c.id}">Confirmar: reabrir</button><button class="btn link" type="button" data-acao="cancelar-cid">Cancelar</button>`
        : `<button class="btn sm" type="button" data-acao="pedir-cid" data-id="${c.id}">Reabrir cidade</button>`) : ""}</div>` : ""}
    ${abasCtr}
    ${obsBox}
    ${fechada ? "" : cascata(c)}
    ${k ? `${abasDiv}
    <div class="box"><table class="grade">
        <thead><tr class="group"><th></th><th colspan="3" class="split">Cálculo</th><th colspan="3" class="split">Desenho</th>${colDel ? "<th></th>" : ""}</tr>
        <tr><th>Unidade</th><th class="split">Responsável</th><th>Status</th><th>Previsão</th><th class="split">Responsável</th><th>Status</th><th>Previsão</th>${colDel ? "<th></th>" : ""}</tr></thead>
        <tbody>${corpo || `<tr><td colspan="${nCols}" class="muted">Nenhuma unidade neste contrato ainda.${fechada ? "" : " Adicione pelo formulário acima."}</td></tr>`}</tbody>
      </table></div>
    ${historicoBox(hist, false, "cidade-" + c.id, "Histórico da cidade")}
    </div>` : `<div class="empty">Esta cidade ainda não tem contrato. Cadastre o primeiro no formulário acima.</div>`}`);
}

// ---------- nível de acesso ---------------------------------------------
const nivel = p => p.chefe ? "Chefe" : p.admin ? "Administrador" : "Colaborador";

// ---------- histórico recolhível (2 linhas → relatório) -----------------
function historicoBox(lista, comCidade, chave, titulo) {
  const aberto = S.histAberto[chave];
  if (!lista.length) return `<section class="panel span2 hist"><header><h3>${titulo}</h3></header><div class="empty">Nenhuma alteração ainda.</div></section>`;
  if (!aberto) return `<section class="panel span2 hist"><header><h3>${titulo}</h3>
      <button class="btn sec sm" type="button" data-acao="hist" data-v="${chave}">Ver todas (${lista.length})</button></header>
      <ul class="log curto">${lista.slice(0, 2).map(h => itemLog(h, comCidade)).join("")}</ul></section>`;
  const b = (S.histBusca[chave] || "").toLowerCase();
  const linhas = lista.filter(h => !b || [h.usuario_nome, h.cidade, h.unidade, h.campo, h.valor_antigo, h.valor_novo].join(" ").toLowerCase().includes(b));
  return `<section class="panel span2 hist"><header><h3>${titulo}</h3>
      <div class="bar"><input type="search" class="hbusca" data-chave="${chave}" placeholder="Filtrar por pessoa, unidade, campo…" value="${esc(S.histBusca[chave] || "")}">
      <button class="btn sec sm" type="button" data-acao="hist" data-v="${chave}">Recolher</button></div></header>
    <div class="rel"><table class="relatorio"><thead><tr><th>Quando</th><th>Quem</th>${comCidade ? "<th>Cidade</th>" : ""}<th>Unidade</th><th>O que mudou</th><th>De</th><th>Para</th></tr></thead>
      <tbody>${linhas.map(h => `<tr data-hb="${esc([h.usuario_nome, h.cidade, h.unidade, h.campo, h.valor_antigo, h.valor_novo].join(" ").toLowerCase())}">
        <td class="num">${quando(h.quando)}</td><td>${esc(h.usuario_nome)}</td>${comCidade ? `<td>${esc(h.cidade || "—")}</td>` : ""}<td>${esc(h.unidade || "—")}</td>
        <td>${esc(h.campo)}</td><td class="val">${esc(h.valor_antigo || "—")}</td><td class="val">${esc(h.valor_novo || "—")}</td></tr>`).join("")}</tbody></table></div>
    <span class="note">${lista.length} alteraç${lista.length === 1 ? "ão" : "ões"} registrada${lista.length === 1 ? "" : "s"} (mostrando as mais recentes, até 500).</span></section>`;
}

// ---------- Usuários (administradores) ----------------------------------
function telaUsuarios() {
  const eu = S.perfil, chefe = !!eu.chefe;
  const pend = S.perfis.filter(p => p.status === "aguardando");
  const outros = S.perfis.filter(p => p.status !== "aguardando");
  const situacao = { aprovado: ["Ativo", "ok"], recusado: ["Sem acesso", "late"] };
  const nivelCel = p => {
    if (p.chefe) return `<span class="chip st-emit">Chefe</span>`;
    if (!chefe || p.status !== "aprovado") return `<span class="chip ${p.admin ? "st-run" : "st-todo"}">${nivel(p)}</span>`;
    return `<select class="nivel" data-id="${p.id}" aria-label="Nível de ${esc(p.nome)}">
      <option value="colab"${p.admin ? "" : " selected"}>Colaborador</option><option value="admin"${p.admin ? " selected" : ""}>Administrador</option></select>`;
  };
  return shell("usuarios", `
    <div class="bar"><h2>Usuários</h2></div>
    <div class="niveis">
      <div><b>Chefe</b><span>Tudo o que o administrador faz e decide quem é administrador.</span></div>
      <div><b>Administrador</b><span>Aprova cadastros e cria, renomeia, encerra, reabre e exclui cidades.</span></div>
      <div><b>Colaborador</b><span>Cadastra contratos, divisões e unidades e atualiza responsáveis, status e datas.</span></div>
    </div>
    <h3>Pedidos de acesso</h3>
    <div class="box"><div class="scroll"><table><thead><tr><th>Nome</th><th>E-mail</th><th>Pedido em</th><th></th></tr></thead>
      <tbody>${pend.length ? pend.map(p => `<tr><td>${esc(p.nome)}</td><td>${esc(p.email)}</td><td>${quando(p.criado_em)}</td>
        <td class="acoes"><button class="btn sm" type="button" data-acao="aprovar" data-id="${p.id}">Aprovar como colaborador</button>
        ${chefe ? `<button class="btn sec sm" type="button" data-acao="aprovar" data-id="${p.id}" data-admin="1">Aprovar como administrador</button>` : ""}
        <button class="btn link" type="button" data-acao="status" data-id="${p.id}" data-v="recusado">Recusar</button></td></tr>`).join("")
        : `<tr><td colspan="4" class="muted">Nenhum pedido pendente.</td></tr>`}</tbody></table></div></div>
    <h3>Usuários cadastrados</h3>
    <div class="box"><div class="scroll"><table><thead><tr><th>Nome</th><th>E-mail</th><th>Nível</th><th>Situação</th><th></th></tr></thead>
      <tbody>${outros.map(p => {
        const [txt, cls] = situacao[p.status];
        const acao = p.id === S.uid ? `<span class="muted small">você</span>` : p.chefe ? ""
          : p.status === "aprovado" ? `<button class="btn sec sm" type="button" data-acao="status" data-id="${p.id}" data-v="recusado">Remover acesso</button>`
          : `<button class="btn sm" type="button" data-acao="status" data-id="${p.id}" data-v="aprovado">Liberar acesso</button>`;
        return `<tr><td>${esc(p.nome)}</td><td>${esc(p.email)}</td><td>${nivelCel(p)}</td><td><span class="chip ${cls}">${txt}</span></td><td class="acoes">${acao}</td></tr>`;
      }).join("")}</tbody></table></div></div>
    ${chefe ? "" : `<p class="note">Só o usuário chefe muda o nível de alguém para administrador.</p>`}`);
}

// ---------- ações -----------------------------------------------------
window.addEventListener("hashchange", () => {
  Object.assign(S, { editCidade: false, confirmDel: null, confirmDelCidade: false, busca: "", pedidoCid: null, divSel: "todas", fc: "", ft: "", fd: "", recusa: null, editCtr: false, confirmDelCtr: null, V: {} });
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

  if (f.id === "feditcidade") ocupado(f, async () => {
    const c = cidadeAtual(); const novo = { nome: v("ecid") };
    const { error } = await sb.from("cidades").update(novo).eq("id", c.id);
    if (error) return toast(traduz(error.message), true);
    Object.assign(c, novo); S.editCidade = false; toast("Cidade atualizada"); render();
  });

  if (f.id === "fcasc") ocupado(f, async () => {
    const V = S.V, fixa = cidadeAtual();
    let c = fixa || S.cidades.find(x => x.id === +S.fc);
    if (!c) {
      const nome = (V.ncid || "").trim(); if (!nome) return toast("Escreva o nome da cidade.", true);
      const { data, error } = await sb.from("cidades").insert({ nome }).select().single();
      if (error) return toast(traduz(error.message), true);
      S.cidades.push(data); S.cidades.sort((a, b) => a.nome.localeCompare(b.nome, "pt-BR")); c = data; S.fc = String(c.id);
    }
    let k = S.contratos.find(x => x.id === +S.ft && x.cidade_id === c.id);
    if (!k) {
      const nome = (V.nctr || "").trim(); if (!nome) return toast("Escreva o nome do contrato.", true);
      const { data, error } = await sb.from("contratos").insert({ cidade_id: c.id, nome, observacoes: (V.nobs || "").trim() }).select().single();
      if (error) return toast(traduz(error.message), true);
      S.contratos.push(data); S.contratos.sort((a, b) => a.nome.localeCompare(b.nome, "pt-BR")); k = data; S.ft = String(k.id);
    }
    const div = S.fd === "__nova" ? (V.ndiv || "").trim() : (S.fd || null);
    if (S.fd === "__nova" && !div) return toast("Escreva o nome da nova divisão.", true);
    if (div && !(k.divisoes || []).includes(div)) {
      const { data, error } = await sb.from("contratos").update({ divisoes: [...(k.divisoes || []), div] }).eq("id", k.id).select().maybeSingle();
      if (error) return toast(traduz(error.message), true);
      if (data) Object.assign(k, data);
    }
    const codigo = (V.uu || "").trim().toUpperCase();
    if (codigo) {
      const { data, error } = await sb.from("unidades").insert({ cidade_id: c.id, contrato_id: k.id, codigo, divisao: div }).select().single();
      if (error) return toast(traduz(error.message), true);
      S.unidades.push(data); ordenaUnid();
    }
    toast(`Salvo: ${[c.nome, k.nome, div, codigo].filter(Boolean).join(" → ")}`);
    S.V = {}; S.fd = div || "";
    if (fixa) { S.ctrSel[c.id] = k.id; render(); document.getElementById("uu")?.focus(); }
    else if (!codigo) location.hash = "cidade-" + c.id;
    else render();
  });

  if (f.id === "fctr") ocupado(f, async () => {
    const c = cidadeAtual(), k = S.contratos.find(x => x.id === (S.ctrSel[c.id] || contratosDe(c)[0]?.id));
    const novo = { nome: v("knome"), observacoes: document.getElementById("kobs").value.trim() };
    const { data, error } = await sb.from("contratos").update(novo).eq("id", k.id).select().maybeSingle();
    if (error || !data) return toast(error ? traduz(error.message) : "Não foi possível salvar: a cidade pode estar encerrada.", true);
    Object.assign(k, data); S.editCtr = false; toast("Contrato atualizado"); render();
  });
});

app.addEventListener("change", async e => {
  const t = e.target;
  if (t.id === "fpessoa") { if (t.value) { S.modo = "pessoa"; S.pessoa = t.value; } else { S.modo = "todas"; } render(); return; }
  if (t.classList.contains("nivel")) {
    const adm = t.value === "admin";
    const { error } = await sb.from("perfis").update({ admin: adm }).eq("id", t.dataset.id);
    if (error) { toast(traduz(error.message), true); render(); return; }
    Object.assign(S.perfis.find(x => x.id === t.dataset.id) || {}, { admin: adm });
    toast(adm ? "Agora é administrador" : "Agora é colaborador"); render(); return;
  }
  if (t.id === "sc") { S.fc = t.value; S.ft = ""; S.fd = ""; render(); document.getElementById(S.fc === "__nova" ? "ncid" : "sct")?.focus(); return; }
  if (t.id === "sct") { S.ft = t.value; S.fd = ""; render(); document.getElementById(S.ft === "__novo" ? "nctr" : "sd")?.focus(); return; }
  if (t.id === "sd") { S.fd = t.value; render(); document.getElementById(S.fd === "__nova" ? "ndiv" : "uu")?.focus(); return; }
  if (t.dataset.uid && t.dataset.f) {
    const ok = await salvarUnidade(+t.dataset.uid, t.dataset.f, t.value || null);
    if (ok && t.classList.contains("st-sel")) toast("Status atualizado: " + t.value);
  }
});

app.addEventListener("input", e => {
  if (["ncid", "nctr", "nobs", "ndiv", "uu"].includes(e.target.id)) { S.V[e.target.id] = e.target.value; return; }
  if (e.target.classList.contains("hbusca")) {
    const ch = e.target.dataset.chave, b = e.target.value.toLowerCase(); S.histBusca[ch] = e.target.value;
    e.target.closest(".hist").querySelectorAll("tr[data-hb]").forEach(tr => { tr.hidden = !!b && !tr.dataset.hb.includes(b); });
    return;
  }
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
    case "hist": S.histAberto[el.dataset.v] = !S.histAberto[el.dataset.v]; break;
    case "aprovar": {
      el.disabled = true;
      const mud = el.dataset.admin ? { status: "aprovado", admin: true } : { status: "aprovado" };
      const { error } = await sb.from("perfis").update(mud).eq("id", el.dataset.id);
      if (error) { el.disabled = false; return toast(traduz(error.message), true); }
      Object.assign(S.perfis.find(x => x.id === el.dataset.id) || {}, mud);
      toast(el.dataset.admin ? "Aprovado como administrador" : "Aprovado como colaborador"); break;
    }
    case "filtro": S.filtro = el.dataset.v; S.fCtr = "todos"; S.fDiv = "todas"; break;
    case "fctr": S.fCtr = el.dataset.v; S.fDiv = "todas"; break;
    case "fdiv": S.fDiv = el.dataset.v; break;
    case "ctr-tab": { const c = cidadeAtual(); S.ctrSel[c.id] = id; S.ft = String(id); S.fd = ""; S.divSel = "todas"; S.editCtr = false; S.confirmDelCtr = null; break; }
    case "editar-ctr": S.editCtr = true; render(); document.getElementById("kobs")?.focus(); return;
    case "cancelar-ctr": S.editCtr = false; break;
    case "pedir-excluir-ctr": S.confirmDelCtr = id; break;
    case "cancelar-ctr-del": S.confirmDelCtr = null; break;
    case "excluir-ctr": {
      el.disabled = true;
      const { data, error } = await sb.from("contratos").delete().eq("id", id).select();
      if (error || !data?.length) { el.disabled = false; return toast(error ? traduz(error.message) : "Só o administrador pode excluir contratos.", true); }
      const k = S.contratos.find(x => x.id === id);
      S.contratos = S.contratos.filter(x => x.id !== id); S.unidades = S.unidades.filter(u => u.contrato_id !== id);
      S.confirmDelCtr = null; S.ft = ""; toast(`${k ? k.nome : "Contrato"} excluído`); break;
    }
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
