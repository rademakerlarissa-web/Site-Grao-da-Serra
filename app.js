/* ==========================================================================
 * app.js — lógica da interface do Console Grão da Serra
 *
 * Aqui NÃO há regra de negócio: nada de total, desconto ou estoque calculado.
 * A interface só chama as funções de dados.js, mostra o que voltou e recarrega
 * as telas depois de cada operação (os triggers mudam estoque e situação).
 * ========================================================================== */
(function () {
  'use strict';

  /* ---------- utilitários ---------- */
  const $ = (sel, raiz = document) => raiz.querySelector(sel);
  const $$ = (sel, raiz = document) => Array.from(raiz.querySelectorAll(sel));

  const ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
  // Todo texto que vem do banco passa por aqui antes de entrar no HTML.
  const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ESC[c]);

  const formatadorMoeda = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });
  // O conector do MySQL costuma devolver DECIMAL como texto; Number() cobre os dois casos.
  const moeda = (v) => formatadorMoeda.format(Number(v));
  const percentual = (v) =>
    Number(v).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + '%';
  const dataHora = (v) => {
    const d = new Date(String(v).replace(' ', 'T'));
    return Number.isNaN(d.getTime()) ? esc(v) : d.toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' });
  };

  const TELAS = ['cardapio', 'novo-pedido', 'pedidos', 'gerencia', 'bastidores'];
  const reduzirMovimento = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  /* ---------- estado da interface ---------- */
  const estado = {
    pedido: null,        // número do pedido em andamento
    cardapio: [],
    clientes: [],
    funcionarios: [],
    categorias: [],
    nomes: new Map(),    // id_produto -> nome (só para exibir o histórico)
    filtro: '',
    produtoPre: null,    // produto escolhido no cardápio, a levar para o novo pedido
    confirmando: false,
    histCount: 0,        // quantas linhas o histórico de preços tinha na última leitura
  };

  /* ---------- faixa de avisos: onde aparecem as mensagens do banco ---------- */
  const com = $('#comunicador');
  const ROTULOS = { info: 'AVISO', ok: 'CONFIRMADO', erro: 'ALERTA' };

  function avisar(tipo, texto) {
    com.dataset.tipo = tipo;
    $('#com-rotulo').textContent = ROTULOS[tipo] || ROTULOS.info;
    $('#com-texto').textContent = texto;
    com.classList.remove('pulso');
    void com.offsetWidth; // reinicia a animação
    com.classList.add('pulso');
  }

  const mensagemDe = (e) => (e && (e.sqlMessage || e.message)) || String(e);

  // Roda uma operação de dados; se o banco recusar (SIGNAL), mostra a mensagem.
  async function executar(fn) {
    try {
      return { ok: true, valor: await fn() };
    } catch (e) {
      avisar('erro', mensagemDe(e));
      return { ok: false, valor: undefined, erro: mensagemDe(e) };
    }
  }

  /* ---------- painel "O que o banco fez" ----------
     Mostra, depois de cada ação que altera dados, qual procedure, function,
     view ou trigger entrou em cena. Só explica: não calcula nem decide nada. */
  const NOMES_CAMADA = { interface: 'Interface', procedure: 'Procedure', function: 'Function', view: 'View', trigger: 'Trigger' };
  const painelExplica = $('#explica');
  let explicacoesLigadas = true;
  try { if (localStorage.getItem('gs-explica') === 'nao') explicacoesLigadas = false; } catch (e) { /* ignora */ }

  const cod = (t) => '<code>' + esc(t) + '</code>';

  window.addEventListener('modo-demonstracao', () => {
    fecharExplica();
    avisar('info', 'Banco indisponível: usando dados fictícios. As alterações ficam só nesta sessão e não são gravadas no MySQL.');
  });

  function explicar(titulo, passos, recusa) {
    if (!explicacoesLigadas || MODO_DEMONSTRACAO) return;
    $('#explica-titulo').textContent = titulo;
    painelExplica.classList.toggle('recusa', Boolean(recusa));
    $('#explica-passos').innerHTML = passos
      .map(([camada, html]) => `<li class="passo"><span class="tipo tipo-${camada}">${NOMES_CAMADA[camada]}</span><p>${html}</p></li>`)
      .join('');
    painelExplica.hidden = false;
    painelExplica.scrollTop = 0;
    document.body.classList.add('explica-aberta');
  }

  function fecharExplica() {
    painelExplica.hidden = true;
    document.body.classList.remove('explica-aberta');
  }

  function explicarRecusa(rotina, mensagem, detalhe) {
    explicar('Recusado pelo banco', [
      ['procedure', `${cod(rotina)} encontrou um problema e parou com ${cod('SIGNAL')}: “${esc(mensagem)}”`],
      ['procedure', esc(detalhe)],
      ['interface', 'A interface não validou nada. Só mostrou a mensagem do banco na faixa de Avisos.'],
    ], true);
  }

  // Compara a situação do produto antes e depois (a função é fn_situacao_estoque, lida na vw_cardapio).
  function descreverSituacao(antes, depois) {
    if (!antes || !depois) return 'foi recalculada';
    return antes.situacao !== depois.situacao
      ? `mudou de ${esc(antes.situacao)} para <strong>${esc(depois.situacao)}</strong>`
      : `continua ${esc(depois.situacao)}`;
  }

  function atualizarBotaoExplica() {
    const botao = $('#btn-explica');
    botao.setAttribute('aria-pressed', String(explicacoesLigadas));
    botao.textContent = explicacoesLigadas ? 'Explicações: ligadas' : 'Explicações: desligadas';
  }

  $('#btn-explica').addEventListener('click', () => {
    explicacoesLigadas = !explicacoesLigadas;
    try { localStorage.setItem('gs-explica', explicacoesLigadas ? 'sim' : 'nao'); } catch (e) { /* ignora */ }
    if (!explicacoesLigadas) fecharExplica();
    atualizarBotaoExplica();
  });
  $('#explica-fechar').addEventListener('click', fecharExplica);
  atualizarBotaoExplica();

  /* ==========================================================================
   * TELA 1 — CARDÁPIO  (vw_cardapio)
   * ========================================================================== */
  async function recarregarCardapio() {
    estado.cardapio = await listarCardapio();
    estado.cardapio.forEach((p) => estado.nomes.set(Number(p.id_produto), p.produto));
    renderCardapio();
    renderSelectProdutos();
  }

  function renderCardapio() {
    const lista = $('#cardapio-lista');
    $('#cardapio-qtd').textContent = estado.cardapio.length + ' itens no cardápio';
    if (!estado.cardapio.length) {
      lista.innerHTML = '<p class="vazio">Nenhum produto ativo no cardápio.</p>';
      return;
    }
    const grupos = new Map();
    estado.cardapio.forEach((p) => {
      if (!grupos.has(p.categoria)) grupos.set(p.categoria, []);
      grupos.get(p.categoria).push(p);
    });
    lista.innerHTML = Array.from(grupos, ([categoria, itens]) => `
      <section class="grupo">
        <h3 class="grupo-titulo">${esc(categoria)}<span class="grupo-qtd">${itens.length}</span></h3>
        <ul class="itens">${itens.map(htmlItemCardapio).join('')}</ul>
      </section>`).join('');
  }

  function htmlItemCardapio(p) {
    const esgotado = p.situacao === 'ESGOTADO';
    const selo = esgotado
      ? '<span class="selo selo-esgotado">Esgotado</span>'
      : p.situacao === 'REPOR'
        ? '<span class="selo selo-repor">Estoque baixo</span>'
        : '<span></span>';
    return `
      <li class="item" data-situacao="${esc(p.situacao)}">
        <div class="item-topo">
          <span class="item-nome">${esc(p.produto)}</span>
          <span class="pontilhado" aria-hidden="true"></span>
          <span class="item-preco">${moeda(p.preco)}</span>
        </div>
        <div class="item-base">
          ${selo}
          <button type="button" class="btn btn-sec btn-mini" data-pedir="${esc(p.id_produto)}" ${esgotado ? 'disabled' : ''}>Pedir</button>
        </div>
      </li>`;
  }

  $('#cardapio-lista').addEventListener('click', (ev) => {
    const botao = ev.target.closest('[data-pedir]');
    if (!botao) return;
    if (estado.pedido == null) {
      avisar('info', 'Abra um pedido na tela Novo pedido antes de adicionar produtos.');
      irPara('novo-pedido');
      return;
    }
    estado.produtoPre = botao.dataset.pedir;
    irPara('novo-pedido');
  });

  /* ==========================================================================
   * TELA 2 — NOVO PEDIDO  (sp_abrir_pedido, sp_adicionar_item, sp_finalizar_pedido)
   * ========================================================================== */
  function renderSelectsPessoas() {
    const cli = $('#sel-cliente');
    if (!cli.options.length) {
      cli.innerHTML = estado.clientes.map((c) => `<option value="${esc(c.id_cliente)}">${esc(c.nome)}</option>`).join('');
    }
    const fun = $('#sel-func');
    if (!fun.options.length) {
      fun.innerHTML = estado.funcionarios
        .map((f) => `<option value="${esc(f.id_funcionario)}">${esc(f.nome)} · ${esc(f.cargo)}</option>`).join('');
    }
  }

  function renderSelectProdutos() {
    const sel = $('#sel-produto');
    const anterior = estado.produtoPre != null ? String(estado.produtoPre) : sel.value;
    estado.produtoPre = null;
    sel.innerHTML = estado.cardapio.map((p) => {
      const esgotado = p.situacao === 'ESGOTADO';
      return `<option value="${esc(p.id_produto)}" ${esgotado ? 'disabled' : ''}>${esc(p.produto)} · ${moeda(p.preco)}${esgotado ? ' (esgotado)' : ''}</option>`;
    }).join('');
    if (anterior && Array.from(sel.options).some((o) => o.value === anterior && !o.disabled)) sel.value = anterior;
  }

  async function carregarNovoPedido() {
    await executar(async () => {
      if (!estado.clientes.length) estado.clientes = await listarClientes();
      if (!estado.funcionarios.length) estado.funcionarios = await listarFuncionarios();
      renderSelectsPessoas();
      await recarregarCardapio();
      await recarregarItens();
    });
    if (estado.pedido != null && $('#sel-produto').value) $('#inp-qtd').focus({ preventScroll: true });
  }

  async function recarregarItens() {
    const emAndamento = estado.pedido != null;
    $('#fs-item').disabled = !emAndamento;
    $('#fs-fim').disabled = !emAndamento;

    if (!emAndamento) {
      $('#pedido-titulo').textContent = 'Nenhum pedido em andamento';
      $('#pedido-status').innerHTML = '';
      $('#itens-area').innerHTML = '<p class="vazio">Abra um pedido na etapa 1 para começar a adicionar produtos.</p>';
      $('#total-parcial').textContent = '—';
      return;
    }

    const [itens, pedidos] = await Promise.all([listarItensPedido(estado.pedido), listarPedidos()]);
    const linha = pedidos.find((p) => Number(p.id_pedido) === Number(estado.pedido));
    $('#pedido-titulo').textContent = 'Pedido #' + estado.pedido;
    $('#pedido-status').innerHTML = linha ? `<span class="status status-${esc(linha.status)}">${esc(linha.status)}</span>` : '';
    $('#total-parcial').textContent = linha ? moeda(linha.valor_bruto) : '—';

    if (!itens.length) {
      $('#itens-area').innerHTML = '<p class="vazio">O pedido ainda não tem itens.</p>';
      return;
    }
    $('#itens-area').innerHTML = `
      <div class="tabela-wrap">
        <table class="tabela media">
          <thead><tr><th>Produto</th><th class="num">Qtd</th><th class="num">Unitário</th><th class="num">Subtotal</th><th><span class="so-leitor">Remover</span></th></tr></thead>
          <tbody>${itens.map((i) => `
            <tr>
              <td>${esc(i.produto)}</td>
              <td class="num">${esc(i.quantidade)}</td>
              <td class="num">${moeda(i.preco_unitario)}</td>
              <td class="num">${moeda(i.subtotal)}</td>
              <td class="num"><button type="button" class="btn btn-perigo btn-mini" data-remover="${esc(i.id_produto)}" aria-label="Remover ${esc(i.produto)}">Remover</button></td>
            </tr>`).join('')}
          </tbody>
        </table>
      </div>`;
  }

  // 1 — abrir pedido
  $('#f-abrir').addEventListener('submit', async (ev) => {
    ev.preventDefault();
    const idCliente = Number($('#sel-cliente').value);
    const idFunc = Number($('#sel-func').value);
    const nomeCliente = $('#sel-cliente').selectedOptions[0] ? $('#sel-cliente').selectedOptions[0].text : '';
    const nomeFunc = $('#sel-func').selectedOptions[0] ? $('#sel-func').selectedOptions[0].text.split(' · ')[0] : '';
    const { ok, valor: id, erro } = await executar(() => abrirPedido(idCliente, idFunc));
    if (!ok) {
      explicarRecusa('sp_abrir_pedido', erro, 'A procedure parou antes do INSERT. Nenhum pedido foi criado.');
      return;
    }
    estado.pedido = Number(id);
    $('#resultado').hidden = true;
    avisar('ok', `Pedido #${id} aberto. Adicione os produtos.`);
    await executar(recarregarItens);
    explicar(`Pedido #${esc(id)} aberto: o que o banco fez`, [
      ['interface', `${cod('abrirPedido()')} chamou ${cod(`CALL sp_abrir_pedido(${idCliente}, ${idFunc}, @id)`)}, com cliente ${esc(nomeCliente)} e atendente ${esc(nomeFunc)}.`],
      ['procedure', `Conferiu se o cliente e o funcionário existem (senão, ${cod('SIGNAL')}) e inseriu a linha em ${cod('pedido')}. A data e o status ABERTO vêm dos valores padrão (${cod('DEFAULT')}) da tabela.`],
      ['procedure', `Devolveu o número <strong>#${esc(id)}</strong> pelo parâmetro ${cod('OUT')}, lido com ${cod('LAST_INSERT_ID()')}.`],
      ['view', `A tela Pedidos, que lê a ${cod('vw_pedidos_detalhados')}, já mostra o novo pedido como ABERTO.`],
    ]);
  });

  // 2 — adicionar produto
  $('#f-item').addEventListener('submit', async (ev) => {
    ev.preventDefault();
    if (estado.pedido == null) return;
    const produto = Number($('#sel-produto').value);
    const lido = parseInt($('#inp-qtd').value, 10);
    const quantidade = Number.isNaN(lido) ? 0 : lido; // a validação é do banco
    const antes = estado.cardapio.find((p) => Number(p.id_produto) === produto);
    const { ok, erro } = await executar(() => adicionarItem(estado.pedido, produto, quantidade));
    if (!ok) {
      explicarRecusa('sp_adicionar_item', erro, 'O handler fez ROLLBACK e repassou o erro (RESIGNAL). Nada foi gravado e o trigger de estoque nem chegou a rodar.');
      return;
    }
    avisar('ok', 'Item adicionado ao pedido.');
    await executar(() => Promise.all([recarregarCardapio(), recarregarItens()]));
    const depois = estado.cardapio.find((p) => Number(p.id_produto) === produto);
    explicar('Item adicionado: o que o banco fez', [
      ['interface', `${cod('adicionarItem()')} chamou ${cod(`CALL sp_adicionar_item(${estado.pedido}, ${produto}, ${quantidade})`)}: ${esc(quantidade)} × ${esc(antes ? antes.produto : 'produto #' + produto)} no pedido #${esc(estado.pedido)}.`],
      ['procedure', `Abriu uma transação, travou o pedido e o produto (${cod('FOR UPDATE')}) e conferiu: pedido ABERTO, produto ativo, quantidade positiva, estoque suficiente e produto ainda fora do pedido.`],
      ['procedure', `Gravou o item em ${cod('item_pedido')} com o preço atual do produto (${antes ? moeda(antes.preco) : '—'}) e deu ${cod('COMMIT')}.`],
      ['trigger', `${cod('trg_item_baixa_estoque')} (AFTER INSERT) subtraiu ${esc(quantidade)} do estoque, sozinho. A procedure não mandou isso.`],
      ['function', `${cod('fn_situacao_estoque')}, usada pela ${cod('vw_cardapio')}, reclassificou o produto: ${descreverSituacao(antes, depois)}.`],
      ['function', `${cod('fn_total_pedido')}, usada pela ${cod('vw_pedidos_detalhados')}, recalculou o valor bruto do pedido: <strong>${esc($('#total-parcial').textContent)}</strong>.`],
    ]);
  });

  // remover item
  $('#itens-area').addEventListener('click', async (ev) => {
    const botao = ev.target.closest('[data-remover]');
    if (!botao || estado.pedido == null) return;
    const linhaTr = botao.closest('tr');
    const nomeItem = linhaTr ? linhaTr.cells[0].textContent : 'o item';
    const qtdItem = linhaTr ? linhaTr.cells[1].textContent : '?';
    const idProd = Number(botao.dataset.remover);
    const antes = estado.cardapio.find((p) => Number(p.id_produto) === idProd);
    const { ok } = await executar(() => removerItem(estado.pedido, idProd));
    if (!ok) return;
    avisar('ok', 'Item removido do pedido.');
    await executar(() => Promise.all([recarregarCardapio(), recarregarItens()]));
    const depois = estado.cardapio.find((p) => Number(p.id_produto) === idProd);
    explicar('Item removido: o que o banco fez', [
      ['interface', `${cod('removerItem()')} executou ${cod('DELETE FROM item_pedido')} para ${esc(nomeItem)} no pedido #${esc(estado.pedido)}. Aqui não existe procedure: o próprio DELETE basta.`],
      ['trigger', `${cod('trg_item_devolve_estoque')} (AFTER DELETE) somou ${esc(qtdItem)} de volta ao estoque, lendo a quantidade em ${cod('OLD.quantidade')} (no DELETE não existe NEW).`],
      ['function', `${cod('fn_situacao_estoque')}, usada pela ${cod('vw_cardapio')}, reclassificou o produto: ${descreverSituacao(antes, depois)}.`],
      ['function', `${cod('fn_total_pedido')}, usada pela ${cod('vw_pedidos_detalhados')}, recalculou o valor bruto do pedido: <strong>${esc($('#total-parcial').textContent)}</strong>.`],
    ]);
  });

  // 3 — finalizar
  $('#btn-finalizar').addEventListener('click', async () => {
    if (estado.pedido == null) return;
    const id = estado.pedido;
    const { ok, erro } = await executar(() => finalizarPedido(id));
    if (!ok) {
      explicarRecusa('sp_finalizar_pedido', erro, 'O handler fez ROLLBACK e repassou o erro (RESIGNAL). O pedido continua como estava.');
      return;
    }
    // desconto e valor total gravados pelo banco: lidos na view de pedidos
    const lido = await executar(() => listarPedidos());
    const linha = lido.ok ? lido.valor.find((p) => Number(p.id_pedido) === Number(id)) : null;
    estado.pedido = null;
    $('#res-titulo').textContent = `Pedido #${id} pago`;
    $('#res-desconto').textContent = linha ? percentual(linha.desconto_percentual) : '—';
    $('#res-total').textContent = linha ? moeda(linha.valor_total) : '—';
    $('#resultado').hidden = false;
    avisar('ok', `Pedido #${id} finalizado.`);
    await executar(() => Promise.all([recarregarCardapio(), recarregarItens()]));
    const bruto = linha ? moeda(linha.valor_bruto) : '—';
    const desc = linha ? percentual(linha.desconto_percentual) : '—';
    const total = linha ? moeda(linha.valor_total) : '—';
    explicar(`Pedido #${esc(id)} finalizado: o que o banco fez`, [
      ['interface', `${cod('finalizarPedido()')} chamou ${cod(`CALL sp_finalizar_pedido(${id})`)}. A tela não calculou nada.`],
      ['procedure', `Abriu uma transação, travou o pedido (${cod('FOR UPDATE')}) e conferiu: o pedido existe, está ABERTO e tem pelo menos um item.`],
      ['function', `${cod('fn_total_pedido')} somou quantidade × preço unitário dos itens: valor bruto <strong>${esc(bruto)}</strong>.`],
      ['function', `${cod('fn_desconto_fidelidade')} contou os pedidos PAGO de ${esc(linha ? linha.cliente : 'o cliente')}: desconto de <strong>${esc(desc)}</strong>.`],
      ['procedure', `Num único ${cod('UPDATE')}, gravou o desconto, o ${cod('valor_total')} = ${cod('ROUND(bruto × (1 − desconto/100), 2)')} = <strong>${esc(total)}</strong> e o status PAGO. Depois, ${cod('COMMIT')}.`],
      ['trigger', `${cod('trg_pedido_bloqueia_alteracao')} (BEFORE UPDATE) olhou ${cod('OLD.status')}: era ABERTO, então deixou passar. Daqui em diante, o pedido PAGO não aceita mais alteração.`],
      ['view', `A tela leu o resultado na ${cod('vw_pedidos_detalhados')}. A ${cod('vw_vendas_por_categoria')}, na Gerência, já passa a contar este pedido, porque só soma pedidos PAGO.`],
    ]);
  });

  $('#btn-novo').addEventListener('click', () => {
    $('#resultado').hidden = true;
    $('#sel-cliente').focus();
  });

  /* ==========================================================================
   * TELA 3 — PEDIDOS  (vw_pedidos_detalhados)
   * ========================================================================== */
  async function recarregarPedidos() {
    const dados = await listarPedidos(estado.filtro || undefined);
    $('#pedidos-qtd').textContent = dados.length + (dados.length === 1 ? ' pedido' : ' pedidos');
    if (!dados.length) {
      $('#pedidos-tabela').innerHTML = '<p class="vazio">Nenhum pedido com este status.</p>';
      return;
    }
    $('#pedidos-tabela').innerHTML = `
      <div class="tabela-wrap">
        <table class="tabela larga">
          <thead><tr>
            <th>Nº</th><th>Data</th><th>Status</th><th>Cliente</th><th>Atendente</th>
            <th class="num">Itens</th><th class="num">Bruto</th><th class="num">Desconto</th><th class="num">Total</th><th></th>
          </tr></thead>
          <tbody>${dados.map((p) => {
            const apagar = p.status !== 'PAGO' ? ' apagado' : '';
            return `
            <tr>
              <td class="num">#${esc(p.id_pedido)}</td>
              <td>${dataHora(p.data_pedido)}</td>
              <td><span class="status status-${esc(p.status)}">${esc(p.status)}</span></td>
              <td>${esc(p.cliente)}</td>
              <td>${esc(p.atendente)}</td>
              <td class="num">${esc(p.qtd_itens)}</td>
              <td class="num">${moeda(p.valor_bruto)}</td>
              <td class="num${apagar}">${p.status === 'PAGO' ? percentual(p.desconto_percentual) : '—'}</td>
              <td class="num${apagar}">${p.status === 'PAGO' ? moeda(p.valor_total) : '—'}</td>
              <td class="num">${p.status === 'ABERTO' ? `<button type="button" class="btn btn-sec btn-mini" data-continuar="${esc(p.id_pedido)}">Continuar</button>` : ''}</td>
            </tr>`;
          }).join('')}
          </tbody>
        </table>
      </div>`;
  }

  $('#pedidos-filtros').addEventListener('click', (ev) => {
    const chip = ev.target.closest('[data-filtro]');
    if (!chip) return;
    estado.filtro = chip.dataset.filtro;
    $$('#pedidos-filtros .chip').forEach((c) => c.setAttribute('aria-pressed', String(c === chip)));
    executar(recarregarPedidos);
  });

  $('#pedidos-tabela').addEventListener('click', (ev) => {
    const botao = ev.target.closest('[data-continuar]');
    if (!botao) return;
    estado.pedido = Number(botao.dataset.continuar);
    $('#resultado').hidden = true;
    avisar('info', `Continuando o pedido #${estado.pedido}.`);
    irPara('novo-pedido');
  });

  /* ==========================================================================
   * TELA 4 — GERÊNCIA  (vw_produtos_para_repor, vw_vendas_por_categoria,
   *                     sp_reajustar_precos_categoria, historico_preco)
   * ========================================================================== */
  async function recarregarGerencia() {
    const [repor, vendas, historico, categorias] = await Promise.all([
      listarProdutosParaRepor(), listarVendasPorCategoria(), listarHistoricoPrecos(), listarCategorias(),
    ]);
    estado.categorias = categorias;
    estado.histCount = historico.length;
    repor.forEach((p) => estado.nomes.set(Number(p.id_produto), p.produto));
    renderRepor(repor);
    renderVendas(vendas);
    renderHistorico(historico);
    renderSelectCategorias();
  }

  function renderRepor(dados) {
    if (!dados.length) {
      $('#repor-tabela').innerHTML = '<p class="vazio">Nada para repor. Estoque em dia.</p>';
      return;
    }
    $('#repor-tabela').innerHTML = `
      <div class="tabela-wrap">
        <table class="tabela media">
          <thead><tr><th>Produto</th><th>Categoria</th><th class="num">Estoque</th><th class="num">Mínimo</th><th class="num">Faltam</th></tr></thead>
          <tbody>${dados.map((p) => `
            <tr>
              <td>${esc(p.produto)}</td><td>${esc(p.categoria)}</td>
              <td class="num">${esc(p.estoque)}</td><td class="num">${esc(p.estoque_minimo)}</td>
              <td class="num faltam">${esc(p.faltam)}</td>
            </tr>`).join('')}
          </tbody>
        </table>
      </div>`;
  }

  function renderVendas(dados) {
    const maior = Math.max(...dados.map((d) => Number(d.faturamento)), 0);
    $('#vendas-lista').innerHTML = dados.map((d) => {
      const largura = maior > 0 ? (Number(d.faturamento) / maior) * 100 : 0; // só a escala da barra
      return `
        <div class="barra-linha">
          <span class="barra-nome">${esc(d.categoria)}</span>
          <span class="barra-trilho"><span class="barra-fill" data-largura="${largura.toFixed(2)}"></span></span>
          <span class="barra-valor">${moeda(d.faturamento)}<small>${esc(d.unidades)} un.</small></span>
        </div>`;
    }).join('') + '<p class="escala">Barras proporcionais ao faturamento; a maior ocupa a linha inteira.</p>';
    // a largura é aplicada em seguida, para a barra crescer com animação
    requestAnimationFrame(() => requestAnimationFrame(() => {
      $$('#vendas-lista .barra-fill').forEach((b) => { b.style.width = b.dataset.largura + '%'; });
    }));
  }

  function renderHistorico(dados) {
    if (!dados.length) {
      $('#historico-tabela').innerHTML = '<p class="vazio">Nenhum reajuste registrado ainda. Aplique um reajuste e ele aparece aqui.</p>';
      return;
    }
    $('#historico-tabela').innerHTML = `
      <div class="tabela-wrap">
        <table class="tabela media">
          <thead><tr><th>Produto</th><th class="num">Antigo</th><th class="num">Novo</th><th>Quando</th><th>Usuário</th></tr></thead>
          <tbody>${dados.map((h) => `
            <tr>
              <td>${esc(estado.nomes.get(Number(h.id_produto)) || '#' + h.id_produto)}</td>
              <td class="num">${moeda(h.preco_antigo)}</td>
              <td class="num">${moeda(h.preco_novo)}</td>
              <td>${dataHora(h.data_alteracao)}</td>
              <td>${esc(h.usuario)}</td>
            </tr>`).join('')}
          </tbody>
        </table>
      </div>`;
  }

  function renderSelectCategorias() {
    const sel = $('#sel-categoria');
    const anterior = sel.value;
    sel.innerHTML = estado.categorias.map((c) => `<option value="${esc(c.id_categoria)}">${esc(c.nome)}</option>`).join('');
    if (anterior) sel.value = anterior;
  }

  // Reajuste em duas etapas, dentro da própria página (a página não pode abrir confirm()).
  function fecharConfirmacao() {
    estado.confirmando = false;
    $('#reaj-confirma').hidden = true;
    $('#btn-reaj').hidden = false;
  }

  $('#f-reajuste').addEventListener('submit', (ev) => {
    ev.preventDefault();
    const bruto = $('#inp-percentual').value.trim().replace(',', '.');
    const pct = Number.parseFloat(bruto);
    if (bruto === '' || Number.isNaN(pct)) {
      avisar('info', 'Informe o percentual do reajuste, por exemplo 10 ou -5.');
      $('#inp-percentual').focus();
      return;
    }
    const sel = $('#sel-categoria');
    const nome = sel.options[sel.selectedIndex] ? sel.options[sel.selectedIndex].text : '';
    $('#reaj-texto').textContent = `Aplicar ${pct.toLocaleString('pt-BR')}% em todos os produtos de ${nome}?`;
    estado.confirmando = true;
    $('#reaj-confirma').hidden = false;
    $('#btn-reaj').hidden = true;
    $('#btn-reaj-ok').focus();
  });

  $('#btn-reaj-cancelar').addEventListener('click', () => { fecharConfirmacao(); $('#btn-reaj').focus(); });

  $('#btn-reaj-ok').addEventListener('click', async () => {
    const pct = Number.parseFloat($('#inp-percentual').value.trim().replace(',', '.'));
    const categoria = Number($('#sel-categoria').value);
    const selCat = $('#sel-categoria');
    const nomeCategoria = selCat.options[selCat.selectedIndex] ? selCat.options[selCat.selectedIndex].text : '';
    const histAntes = estado.histCount;
    fecharConfirmacao();
    const { ok, valor, erro } = await executar(() => reajustarPrecos(categoria, pct));
    if (!ok) {
      explicarRecusa('sp_reajustar_precos_categoria', erro, 'A procedure parou antes do UPDATE. Nenhum preço mudou.');
      return;
    }
    const n = valor && valor.produtos_alterados != null ? valor.produtos_alterados : null;
    avisar('ok', n != null ? `Reajuste aplicado: ${n} produto(s) alterado(s).` : 'Reajuste aplicado.');
    $('#inp-percentual').value = '';
    await executar(() => Promise.all([recarregarGerencia(), recarregarCardapio()]));
    const novas = estado.histCount - histAntes; // linhas que o trigger gravou
    explicar('Reajuste aplicado: o que o banco fez', [
      ['interface', `${cod('reajustarPrecos()')} chamou ${cod(`CALL sp_reajustar_precos_categoria(${categoria}, ${pct})`)}: ${esc(pct.toLocaleString('pt-BR'))}% em ${esc(nomeCategoria)}.`],
      ['procedure', `Conferiu se a categoria existe e se o percentual é maior que -100. Depois rodou um único ${cod('UPDATE')} em ${cod('produto')}, só da categoria: ${cod('preco = ROUND(preco × (1 + percentual/100), 2)')}.`],
      ['trigger', `${cod('trg_produto_historico_preco')} (AFTER UPDATE, uma vez por linha alterada) comparou ${cod('OLD.preco')} com ${cod('NEW.preco')} e ${novas > 0 ? `gravou <strong>${esc(novas)}</strong> linha(s) em ${cod('historico_preco')}, com o usuário de ${cod('CURRENT_USER()')}` : 'não gravou nada, porque nenhum preço mudou'}.`],
      ['view', `A ${cod('vw_cardapio')} já mostra os preços novos. Os pedidos antigos não mudam de valor, porque cada venda guarda o preço em ${cod('item_pedido.preco_unitario')}.`],
    ]);
  });

  /* ==========================================================================
   * NAVEGAÇÃO (o endereço da página guarda a tela atual: #cardapio, #pedidos…)
   * ========================================================================== */
  const carregadores = {
    'cardapio': () => executar(recarregarCardapio),
    'novo-pedido': carregarNovoPedido,
    'pedidos': () => executar(recarregarPedidos),
    'gerencia': () => executar(recarregarGerencia),
    'bastidores': () => {}, // tela só de texto (bastidores.js cuida das abas)
  };

  const telaDoEndereco = () => {
    const nome = location.hash.slice(1);
    return TELAS.includes(nome) ? nome : 'cardapio';
  };

  function mostrarTela(nome, comSalto) {
    fecharExplica();
    TELAS.forEach((t) => { $('#tela-' + t).hidden = t !== nome; });
    $$('.nav a').forEach((a) => {
      if (a.dataset.tela === nome) a.setAttribute('aria-current', 'page');
      else a.removeAttribute('aria-current');
    });
    window.scrollTo(0, 0);
    carregadores[nome]();
  }

  function irPara(nome) {
    if (location.hash.slice(1) === nome) mostrarTela(nome, false);
    else location.hash = nome;
  }
  window.addEventListener('hashchange', () => mostrarTela(telaDoEndereco(), true));

  /* ==========================================================================
   * TEMA (claro: reboco e enxaimel · escuro: quadro de giz)
   * ========================================================================== */
  const prefereEscuro = window.matchMedia('(prefers-color-scheme: dark)');

  function temaAtual() {
    const t = document.documentElement.dataset.theme;
    if (t === 'light' || t === 'dark') return t;
    return prefereEscuro.matches ? 'dark' : 'light';
  }

  function rotuloTema() {
    $('#btn-tema').textContent = temaAtual() === 'dark' ? 'Modo claro' : 'Modo escuro';
  }

  function aplicarTema(tema) {
    document.documentElement.dataset.theme = tema;
    try { localStorage.setItem('gs-tema-v2', tema); } catch (e) { /* sem armazenamento: tudo bem */ }
    rotuloTema();
  }

  $('#btn-tema').addEventListener('click', () => aplicarTema(temaAtual() === 'dark' ? 'light' : 'dark'));
  if (prefereEscuro.addEventListener) prefereEscuro.addEventListener('change', rotuloTema);

  /* ---------- comunicador: limpar ---------- */
  $('#com-limpar').addEventListener('click', () => {
    com.dataset.tipo = 'info';
    $('#com-rotulo').textContent = ROTULOS.info;
    $('#com-texto').textContent = 'Nenhuma mensagem do banco por enquanto.';
  });

  /* ---------- partida ---------- */
  function iniciar() {
    let guardado = null;
    try { guardado = localStorage.getItem('gs-tema-v2'); } catch (e) { /* ignora */ }
    if (guardado === 'light' || guardado === 'dark') document.documentElement.dataset.theme = guardado;
    rotuloTema();

    if (typeof MODO_DEMONSTRACAO !== 'undefined' && MODO_DEMONSTRACAO) $('#badge-demo').hidden = false;

    mostrarTela(telaDoEndereco(), false);
  }

  iniciar();
})();
