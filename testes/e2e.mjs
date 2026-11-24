// =====================================================================
//  Testes de ponta a ponta do Controle de Atividades
//  Roda contra um Supabase LOCAL e descartável (nunca o banco real).
//  Uso: SITE_URL=... SUPABASE_URL=... SUPABASE_KEY=... node testes/e2e.mjs
// =====================================================================
import { chromium } from "playwright";
import { createClient } from "@supabase/supabase-js";
import fs from "node:fs";

const SITE = process.env.SITE_URL, URL_SB = process.env.SUPABASE_URL, KEY = process.env.SUPABASE_KEY;
const SHOTS = "testes/capturas"; fs.mkdirSync(SHOTS, { recursive: true });
const SENHA = "senha123";
const U = {
  chefe: { nome: "Rafael Chefe", email: "chefe@teste.com" },
  ana: { nome: "Ana Admin", email: "ana@teste.com" },
  hannah: { nome: "Hannah Colab", email: "hannah@teste.com" },
  joao: { nome: "João Colab", email: "joao@teste.com" },
  intruso: { nome: "Intruso", email: "intruso@teste.com" },
};

const resultados = [];
let navegador;
async function passo(nome, fn) {
  const t0 = Date.now();
  try { await fn(); resultados.push([true, nome]); console.log(`  OK    ${nome} (${Date.now() - t0} ms)`); }
  catch (e) { resultados.push([false, nome, e.message]); console.log(`  FALHA ${nome}\n        → ${e.message.split("\n")[0]}`); }
}
function confere(cond, msg) { if (!cond) throw new Error(msg); }

async function pagina(largura = 1300, altura = 900) {
  const ctx = await navegador.newContext({ viewport: { width: largura, height: altura }, locale: "pt-BR" });
  const p = await ctx.newPage();
  p.erros = [];
  p.on("pageerror", e => p.erros.push(e.message));
  p.on("console", m => { if (m.type() === "error" && !/favicon|fonts\.g/.test(m.text())) p.erros.push(m.text()); });
  return p;
}
async function foto(p, nome) { await p.screenshot({ path: `${SHOTS}/${nome}.png`, fullPage: true }).catch(() => {}); }
async function toast(p) { await p.waitForSelector("#toast:not([hidden])", { timeout: 8000 }); return p.textContent("#toast"); }
async function semRolagemLateral(p) { return p.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1); }

async function cadastrar(p, u) {
  await p.goto(SITE + "#cadastro"); await p.waitForSelector("#fcad");
  await p.fill("#cnome", u.nome); await p.fill("#cemail", u.email); await p.fill("#csenha", SENHA);
  await p.click("#fcad button[type=submit]");
}
async function entrar(p, u, senha = SENHA) {
  await p.goto(SITE + "#login"); await p.waitForSelector("#flogin");
  await p.fill("#lemail", u.email); await p.fill("#lsenha", senha); await p.click("#flogin button[type=submit]");
  await p.waitForSelector(".hero", { timeout: 15000 });
}
async function irCidade(p, nome) {
  await p.goto(SITE + "#cidades"); await p.waitForSelector(".cities");
  await p.click(`article.city:has(h3:text-is("${nome}")) a.btn`); await p.waitForSelector(".ctabs");
}
const linha = (p, cod) => p.locator(`table.grade tbody tr:has(td.unit:text-matches("^${cod}"))`).first();

// ---------------------------------------------------------------------
(async () => {
  navegador = await chromium.launch();
  console.log("\n=== 1. Cadastro e aprovação ===");
  const chefe = await pagina(), hannah = await pagina(), ana = await pagina(), joao = await pagina(390, 844);

  await passo("Primeiro cadastro vira Chefe e entra direto", async () => {
    await cadastrar(chefe, U.chefe); await chefe.waitForSelector(".hero", { timeout: 15000 });
    confere((await chefe.textContent(".user .who")).includes("Chefe"), "nível Chefe não aparece no cabeçalho");
  });
  await passo("Segundo cadastro fica aguardando aprovação", async () => {
    await cadastrar(hannah, U.hannah);
    await hannah.waitForSelector("text=aguardando aprovação", { timeout: 15000 });
  });
  await passo("Chefe vê o pedido com o número no botão Usuários", async () => {
    await chefe.reload(); await chefe.waitForSelector('a[href="#usuarios"] .badge', { timeout: 15000 });
  });
  await passo("Chefe aprova como colaboradora e a tela dela abre sozinha (tempo real)", async () => {
    await chefe.click('a[href="#usuarios"]'); await chefe.waitForSelector(".niveis");
    await chefe.click(`tr:has-text("${U.hannah.email}") [data-acao=aprovar]:not([data-admin])`);
    await toast(chefe);
    await hannah.waitForSelector(".hero", { timeout: 20000 });
    confere((await hannah.textContent(".user .who")).includes("Colaborador"), "nível Colaborador não aparece");
  });
  await passo("Chefe aprova a Ana como administradora", async () => {
    await cadastrar(ana, U.ana); await ana.waitForSelector("text=aguardando aprovação", { timeout: 15000 });
    await chefe.goto(SITE + "#usuarios"); await chefe.reload(); await chefe.waitForSelector(`tr:has-text("${U.ana.email}") [data-admin]`, { timeout: 15000 });
    await chefe.click(`tr:has-text("${U.ana.email}") [data-acao=aprovar][data-admin]`); await toast(chefe);
    await ana.waitForSelector(".hero", { timeout: 20000 });
    confere((await ana.textContent(".user .who")).includes("Administrador"), "nível Administrador não aparece");
  });
  await passo("João (celular) se cadastra e é aprovado como colaborador", async () => {
    await cadastrar(joao, U.joao); await joao.waitForSelector("text=aguardando aprovação", { timeout: 15000 });
    await chefe.reload(); await chefe.waitForSelector(`tr:has-text("${U.joao.email}") [data-acao=aprovar]`, { timeout: 15000 });
    await chefe.click(`tr:has-text("${U.joao.email}") [data-acao=aprovar]:not([data-admin])`); await toast(chefe);
    await joao.waitForSelector(".hero", { timeout: 20000 });
  });
  await passo("Administradora não chefe não vê 'Aprovar como administrador' nem muda nível", async () => {
    const intr = await pagina(); await cadastrar(intr, U.intruso); await intr.waitForSelector("text=aguardando aprovação", { timeout: 15000 });
    await ana.goto(SITE + "#usuarios"); await ana.reload(); await ana.waitForSelector(".niveis");
    confere(await ana.locator("[data-acao=aprovar][data-admin]").count() === 0, "Ana vê botão de aprovar como admin");
    confere(await ana.locator("select.nivel").count() === 0, "Ana consegue mudar nível");
    await intr.context().close();
  });
  await passo("Colaboradora não vê o botão Usuários", async () => {
    confere(await hannah.locator('a[href="#usuarios"]').count() === 0, "Hannah vê o botão Usuários");
  });

  console.log("\n=== 2. Cadastro em cascata: cidade → contrato → divisão → unidade ===");
  await passo("Chefe cadastra Itanhaém + Contrato BBL (com observações) + Bacia A + EB01", async () => {
    await chefe.goto(SITE + "#cidades"); await chefe.waitForSelector("#fcasc");
    await chefe.selectOption("#sc", "__nova"); await chefe.fill("#ncid", "Itanhaém");
    await chefe.fill("#nctr", "Contrato BBL"); await chefe.fill("#nobs", "Responsável: Eng. Marcos\nMedição até o dia 5.");
    await chefe.selectOption("#sd", "__nova"); await chefe.fill("#ndiv", "Bacia A"); await chefe.fill("#uu", "eb01");
    await chefe.click("#fcasc button[type=submit]");
    confere((await toast(chefe)).includes("Itanhaém → Contrato BBL → Bacia A → EB01"), "mensagem de salvo inesperada");
  });
  await passo("Os textos digitados não somem ao trocar as listas da cascata", async () => {
    await chefe.goto(SITE + "#cidades"); await chefe.reload(); await chefe.waitForSelector("#fcasc");
    await chefe.selectOption("#sc", "__nova"); await chefe.fill("#ncid", "Peruíbe"); await chefe.fill("#nctr", "Contrato 012");
    await chefe.selectOption("#sd", "__nova");
    confere(await chefe.inputValue("#ncid") === "Peruíbe" && await chefe.inputValue("#nctr") === "Contrato 012", "texto apagado ao trocar lista");
    await chefe.fill("#ndiv", "Rede Norte"); await chefe.click("#fcasc button[type=submit]");
    await chefe.waitForSelector(".ctabs", { timeout: 10000 });   // sem unidade → abre a cidade
  });
  await passo("Segundo contrato na mesma cidade e mesmo código de unidade em contratos diferentes", async () => {
    await irCidade(chefe, "Itanhaém");
    await chefe.selectOption("#sct", "__novo"); await chefe.fill("#nctr", "Contrato Sabesp 045"); await chefe.fill("#uu", "EB01");
    await chefe.click("#fcasc button[type=submit]"); await toast(chefe);
    confere(await chefe.locator(".ctabs button").count() === 2, "não apareceram 2 abas de contrato");
  });
  await passo("Código repetido no MESMO contrato é recusado com mensagem clara", async () => {
    await chefe.click('.ctabs button:has-text("Contrato BBL")');
    await chefe.fill("#uu", "EB01"); await chefe.click("#fcasc button[type=submit]");
    const t = await toast(chefe);
    confere(/já existe uma unidade/i.test(t), "mensagem: " + t);
  });
  await passo("Unidades EB02 e EB03 na Bacia A / nova Bacia B", async () => {
    await chefe.selectOption("#sd", "Bacia A"); await chefe.fill("#uu", "EB02"); await chefe.click("#fcasc button[type=submit]"); await toast(chefe);
    await chefe.selectOption("#sd", "__nova"); await chefe.fill("#ndiv", "Bacia B"); await chefe.fill("#uu", "EB03"); await chefe.click("#fcasc button[type=submit]"); await toast(chefe);
    confere(await chefe.locator(".dtabs button").count() >= 3, "abas de divisão não apareceram");
  });

  console.log("\n=== 3. Responsáveis, status, datas e atrasos ===");
  await passo("Chefe designa Hannah no cálculo da EB01 e coloca previsão vencida", async () => {
    await chefe.click('.ctabs button:has-text("Contrato BBL")');
    await linha(chefe, "EB01").locator("select[data-f=calc_resp]").selectOption(U.hannah.nome);
    await chefe.waitForTimeout(600);
    await linha(chefe, "EB01").locator("input[data-f=calc_prev]").fill("2026-01-10");
    await linha(chefe, "EB01").locator("input[data-f=calc_prev]").dispatchEvent("change");
    await chefe.waitForTimeout(800);
    confere(await linha(chefe, "EB01").locator("input.is-late").count() === 1, "data vencida não ficou vermelha");
  });
  await passo("Chefe designa João no desenho da EB02 com prazo daqui a 5 dias", async () => {
    const d = new Date(Date.now() + 5 * 864e5).toISOString().slice(0, 10);
    await linha(chefe, "EB02").locator("select[data-f=des_resp]").selectOption(U.joao.nome); await chefe.waitForTimeout(600);
    await linha(chefe, "EB02").locator("input[data-f=des_prev]").fill(d); await linha(chefe, "EB02").locator("input[data-f=des_prev]").dispatchEvent("change");
    await chefe.waitForTimeout(800);
  });
  await passo("Hannah vê a atividade em 'Minhas atividades' com 'Designada por Rafael Chefe' e em atraso", async () => {
    await hannah.goto(SITE + "#inicio"); await hannah.reload(); await hannah.waitForSelector(".task", { timeout: 15000 });
    const txt = await hannah.textContent(".mine");
    confere(txt.includes("EB01") && txt.includes("Designada por") && txt.includes("Rafael Chefe"), "cartão sem designação: " + txt.slice(0, 120));
    confere(await hannah.locator(".group-t.late").count() === 1, "grupo 'Em atraso' não apareceu");
  });
  await passo("Hannah muda o status pelo cartão e o chefe vê a mudança sem recarregar (tempo real)", async () => {
    await chefe.goto(SITE + "#inicio"); await chefe.waitForSelector(".hero");
    await hannah.locator(".st-sel").first().selectOption("Iniciada"); await toast(hannah);
    await chefe.waitForFunction(() => document.querySelector(".hist")?.textContent.includes("Iniciada"), null, { timeout: 15000 });
  });
  await passo("Painel do chefe conta 1 atraso e mostra a EB01 na lista de atrasos", async () => {
    await chefe.reload(); await chefe.waitForSelector(".hero");
    confere((await chefe.textContent(".g.alert .big")).trim() === "1", "contagem de atraso diferente de 1");
    confere((await chefe.textContent(".items")).includes("EB01"), "EB01 não está na lista de atrasos");
  });
  await passo("Filtros em 3 níveis: Itanhaém → Contrato BBL → Bacia A, com observações no painel", async () => {
    await chefe.click('.hchips button:has-text("Itanhaém")');
    await chefe.click('.hchips.l2 button:has-text("Contrato BBL")');
    confere((await chefe.textContent(".hobs")).includes("Eng. Marcos"), "observações do contrato não aparecem");
    await chefe.click('.hchips.l3 button:has-text("Bacia A")');
    confere((await chefe.textContent(".hero h2")).includes("Itanhaém · Contrato BBL · Bacia A"), "título do filtro errado");
  });
  await passo("Filtro 'Por pessoa' mostra só as atividades do João", async () => {
    await chefe.click('.hchips button:has-text("Todas")');
    await chefe.selectOption("#fpessoa", U.joao.nome);
    await chefe.waitForSelector(".task");
    const t = await chefe.textContent(".mine");
    confere(t.includes("EB02") && !t.includes("EB01"), "lista da pessoa errada");
    confere(await chefe.locator("[data-acao=pedir-recusa]").count() === 0, "chefe vê botão Recusar na lista de outra pessoa");
    await foto(chefe, "por-pessoa");
  });
  await passo("Hannah recusa a atividade e o nome dela sai", async () => {
    await hannah.click("[data-acao=pedir-recusa]"); await hannah.click("[data-acao=recusar]"); await toast(hannah);
    await hannah.waitForSelector("text=Nenhuma atividade designada", { timeout: 10000 });
  });

  console.log("\n=== 4. Contrato: observações ===");
  await passo("Colaboradora edita as observações; fica registrado quem e quando", async () => {
    await irCidade(hannah, "Itanhaém");
    await hannah.click('.ctabs button:has-text("Contrato BBL")');
    await hannah.click("[data-acao=editar-ctr]"); await hannah.fill("#kobs", "Responsável: Eng. Marcos\nNovo telefone (13) 99999-0000");
    await hannah.click("#fctr button[type=submit]"); await toast(hannah);
    confere((await hannah.textContent(".obsbox")).includes("Atualizado por Hannah Colab"), "não mostra quem atualizou");
  });

  console.log("\n=== 5. Permissões de cidade ===");
  await passo("Colaboradora não tem '+ Nova cidade', Renomear, Encerrar nem Excluir", async () => {
    await hannah.goto(SITE + "#cidades"); await hannah.waitForSelector("#sc");
    confere(await hannah.locator('#sc option[value="__nova"]').count() === 0, "Hannah tem + Nova cidade");
    confere(await hannah.locator("[data-acao=pedir-cid]").count() === 0, "Hannah tem Encerrar");
    await irCidade(hannah, "Itanhaém");
    confere(await hannah.locator("[data-acao=editar-cidade], [data-acao=pedir-excluir-cidade], [data-acao=pedir-excluir-ctr]").count() === 0, "Hannah tem Renomear/Excluir");
  });
  await passo("Administradora encerra Peruíbe; some do Início dos colaboradores (tempo real)", async () => {
    await joao.goto(SITE + "#inicio"); await joao.waitForSelector(".hero");
    await joao.click('.seg button[data-v=todas]');
    confere(await joao.locator('.hchips button:has-text("Peruíbe")').count() === 1, "Peruíbe não estava no Início do João");
    await ana.goto(SITE + "#cidades"); await ana.waitForSelector(".cities");
    await ana.click('article.city:has(h3:text-is("Peruíbe")) [data-acao=pedir-cid]'); await ana.click("[data-acao=encerrar]"); await toast(ana);
    await joao.waitForFunction(() => ![...document.querySelectorAll(".hchips button")].some(b => b.textContent.includes("Peruíbe")), null, { timeout: 15000 });
  });
  await passo("Cidade encerrada fica só para consulta e reabre", async () => {
    await ana.click('.seg2 button[data-v=enc]'); await ana.click('article.city:has(h3:text-is("Peruíbe")) a.btn'); await ana.waitForSelector(".banner");
    confere(await ana.locator("#fcasc").count() === 0, "formulário de cadastro aparece em cidade encerrada");
    await ana.click('.banner [data-acao=pedir-cid]'); await ana.click('[data-acao=reabrir]'); await toast(ana);
  });

  console.log("\n=== 6. Exclusões (administrador) ===");
  await passo("Chefe exclui unidade EB03, depois o Contrato Sabesp 045", async () => {
    await irCidade(chefe, "Itanhaém");
    await linha(chefe, "EB03").locator("[data-acao=pedir-excluir]").click(); await linha(chefe, "EB03").locator("[data-acao=excluir]").click(); await toast(chefe);
    await chefe.click('.ctabs button:has-text("Sabesp")'); await chefe.click("[data-acao=pedir-excluir-ctr]"); await chefe.click("[data-acao=excluir-ctr]"); await toast(chefe);
    confere(await chefe.locator(".ctabs button").count() === 1, "contrato não saiu");
  });

  console.log("\n=== 7. Histórico ===");
  await passo("Histórico mostra 2 linhas e abre o relatório com filtro", async () => {
    confere(await chefe.locator(".hist .log.curto li").count() === 2, "histórico recolhido não tem 2 linhas");
    await chefe.click(".hist [data-acao=hist]"); await chefe.waitForSelector("table.relatorio");
    const total = await chefe.locator("table.relatorio tbody tr").count();
    await chefe.fill(".hbusca", "Hannah");
    const vis = await chefe.locator("table.relatorio tbody tr:not([hidden])").count();
    confere(total > 5 && vis > 0 && vis < total, `relatório: total ${total}, filtrado ${vis}`);
    await foto(chefe, "relatorio");
  });

  console.log("\n=== 8. Telas no celular e no notebook ===");
  for (const [nome, url] of [["inicio", "#inicio"], ["cidades", "#cidades"]]) {
    await passo(`Celular sem rolagem lateral: ${nome}`, async () => {
      await joao.goto(SITE + url); await joao.waitForTimeout(800); await foto(joao, "celular-" + nome);
      confere(await semRolagemLateral(joao), "a página rola para o lado");
    });
  }
  await passo("Celular sem rolagem lateral: dentro da cidade", async () => {
    await irCidade(joao, "Itanhaém"); await foto(joao, "celular-cidade");
    confere(await semRolagemLateral(joao), "a página rola para o lado");
  });
  await passo("Notebook (1024) a tabela da cidade cabe sem barra", async () => {
    await chefe.setViewportSize({ width: 1024, height: 800 }); await irCidade(chefe, "Itanhaém");
    const ok = await chefe.evaluate(() => { const t = document.querySelector("table.grade"); return t.scrollWidth <= t.closest(".box").clientWidth + 1; });
    confere(ok, "tabela maior que a caixa"); await chefe.setViewportSize({ width: 1300, height: 900 });
  });

  console.log("\n=== 9. Senha ===");
  await passo("João troca a senha, sai e entra com a nova", async () => {
    await joao.click("[data-acao=trocar-senha]"); await joao.fill("#ns1", "novaSenha9"); await joao.fill("#ns2", "novaSenha9");
    await joao.click("#fnovasenha button[type=submit]"); await toast(joao);
    await joao.click("[data-acao=sair]"); await joao.waitForSelector("#flogin");
    await entrar(joao, U.joao, "novaSenha9");
  });
  await passo("Senha errada mostra mensagem em português", async () => {
    const p = await pagina(); await p.goto(SITE + "#login"); await p.waitForSelector("#flogin");
    await p.fill("#lemail", U.joao.email); await p.fill("#lsenha", "errada000"); await p.click("#flogin button[type=submit]");
    confere(/incorretos/i.test(await toast(p)), "mensagem inesperada"); await p.context().close();
  });

  console.log("\n=== 10. Segurança direto na API (tentando burlar o aplicativo) ===");
  const api = async u => { const c = createClient(URL_SB, KEY, { auth: { persistSession: false } }); const { error } = await c.auth.signInWithPassword({ email: u.email, password: SENHA }); if (error) throw error; return c; };
  const hc = await api(U.hannah), ac = await api(U.ana), ic = await api(U.intruso);
  await passo("Pendente (não aprovado) não lê cidades, unidades nem histórico", async () => {
    for (const t of ["cidades", "unidades", "historico", "contratos"]) { const { data } = await ic.from(t).select("*"); confere(!data?.length, `intruso leu ${t}`); }
  });
  await passo("Pendente não consegue se aprovar sozinho", async () => {
    const { data: { user } } = await ic.auth.getUser();
    await ic.from("perfis").update({ status: "aprovado" }).eq("id", user.id);
    const { data } = await ic.from("perfis").select("status").eq("id", user.id).single();
    confere(data.status === "aguardando", "intruso se aprovou");
  });
  await passo("Colaboradora não cria cidade pela API", async () => {
    const { error } = await hc.from("cidades").insert({ nome: "Cidade pirata" }); confere(!!error, "conseguiu criar cidade");
  });
  await passo("Colaboradora não se torna administradora pela API", async () => {
    const { data: { user } } = await hc.auth.getUser();
    await hc.from("perfis").update({ admin: true }).eq("id", user.id);
    const { data } = await hc.from("perfis").select("admin").eq("id", user.id).single(); confere(data.admin === false, "virou admin");
  });
  await passo("Administradora não chefe não promove ninguém pela API", async () => {
    const { error } = await ac.from("perfis").update({ admin: true }).eq("email", U.joao.email); confere(!!error, "Ana promoveu o João");
  });
  await passo("Ninguém escreve nem apaga histórico pela API", async () => {
    const { error } = await hc.from("historico").insert({ usuario_nome: "falso", campo: "x" }); confere(!!error, "inseriu histórico");
    const { data } = await ac.from("historico").delete().neq("id", 0).select(); confere(!data?.length, "apagou histórico");
  });
  await passo("Não dá para forjar 'Designada por' pela API", async () => {
    const { data: u } = await hc.from("unidades").select("id,des_designado_por").eq("codigo", "EB02").single();
    await hc.from("unidades").update({ des_designado_por: "Fulano" }).eq("id", u.id);
    const { data: d } = await hc.from("unidades").select("des_designado_por").eq("id", u.id).single();
    confere(d.des_designado_por === u.des_designado_por, "designação forjada");
  });
  await passo("Colaboradora não exclui unidade pela API", async () => {
    const { data } = await hc.from("unidades").delete().eq("codigo", "EB02").select(); confere(!data?.length, "excluiu unidade");
  });

  console.log("\n=== 11. Erros de JavaScript nas páginas ===");
  for (const [n, p] of [["chefe", chefe], ["Ana", ana], ["Hannah", hannah], ["João", joao]])
    await passo(`Nenhum erro de script na tela de ${n}`, async () => confere(!p.erros.length, p.erros.slice(0, 3).join(" | ")));

  await foto(chefe, "final-chefe");
  await navegador.close();
  const falhas = resultados.filter(r => !r[0]);
  console.log(`\n================ RESULTADO: ${resultados.length - falhas.length} de ${resultados.length} testes passaram ================`);
  falhas.forEach(f => console.log(`FALHA: ${f[1]} → ${f[2]}`));
  process.exit(falhas.length ? 1 : 0);
})().catch(e => { console.error("ERRO GERAL:", e); process.exit(2); });
