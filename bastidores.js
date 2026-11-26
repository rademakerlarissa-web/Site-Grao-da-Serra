/* ==========================================================================
 * bastidores.js — aba "Bastidores": material de apoio para a apresentação.
 * Abas, filtro do mapa, caminho de uma ação, rascunho do
 * parágrafo da conexão e roteiro. Não conversa com o banco.
 * ========================================================================== */
(function () {
  'use strict';

  const $ = (sel, raiz = document) => raiz.querySelector(sel);
  const $$ = (sel, raiz = document) => Array.from(raiz.querySelectorAll(sel));
  const ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
  const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ESC[c]);
  const reduzirMovimento = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  /* ---------- copiar texto (com plano B se a área de transferência recusar) ---------- */
  async function copiar(texto, botao, elementoParaSelecionar) {
    const original = botao.textContent;
    try {
      await navigator.clipboard.writeText(texto);
      botao.textContent = 'Copiado ✓';
    } catch (e) {
      if (elementoParaSelecionar) {
        if (elementoParaSelecionar.select) {
          elementoParaSelecionar.select();
        } else {
          const faixa = document.createRange();
          faixa.selectNodeContents(elementoParaSelecionar);
          const sel = window.getSelection();
          sel.removeAllRanges();
          sel.addRange(faixa);
        }
      }
      botao.textContent = 'Selecionado: use Ctrl+C';
    }
    setTimeout(() => { botao.textContent = original; }, 2000);
  }

  /* ==========================================================================
   * ABAS
   * ========================================================================== */
  const abas = $$('[data-aba]');

  function mostrarAba(nome) {
    abas.forEach((a) => {
      const ligada = a.dataset.aba === nome;
      a.setAttribute('aria-selected', String(ligada));
      a.tabIndex = ligada ? 0 : -1;
      $('#painel-' + a.dataset.aba).hidden = !ligada;
    });
  }

  abas.forEach((a) => a.addEventListener('click', () => mostrarAba(a.dataset.aba)));
  $('.subnav').addEventListener('keydown', (ev) => {
    if (ev.key !== 'ArrowRight' && ev.key !== 'ArrowLeft') return;
    const atual = abas.findIndex((a) => a.getAttribute('aria-selected') === 'true');
    const proxima = abas[(atual + (ev.key === 'ArrowRight' ? 1 : abas.length - 1)) % abas.length];
    mostrarAba(proxima.dataset.aba);
    proxima.focus();
  });

  /* ==========================================================================
   * MAPA DAS QUESTÕES: filtro por tipo
   * ========================================================================== */
  $('#mapa-filtros').addEventListener('click', (ev) => {
    const chip = ev.target.closest('[data-tipo-filtro]');
    if (!chip) return;
    const tipo = chip.dataset.tipoFiltro;
    $$('#mapa-filtros .chip').forEach((c) => c.setAttribute('aria-pressed', String(c === chip)));
    $$('#mapa-tabela tbody tr').forEach((tr) => { tr.hidden = tipo !== '' && tr.dataset.tipo !== tipo; });
  });

  /* ==========================================================================
   * CAMINHO DE UMA AÇÃO
   * ========================================================================== */
  const CAMADAS = {
    interface: 'Interface',
    procedure: 'Procedure',
    function: 'Function',
    view: 'View',
    trigger: 'Trigger',
  };

  const FLUXOS = {
    adicionar: {
      gatilho: 'O atendente escolhe um produto, informa a quantidade e clica em “Adicionar”.',
      passos: [
        ['interface', 'A interface chama adicionarItem(), que executa CALL sp_adicionar_item(pedido, produto, quantidade). Ela não valida nada.'],
        ['procedure', 'sp_adicionar_item abre uma transação (START TRANSACTION) e usa FOR UPDATE para travar a linha do pedido e a do produto enquanto valida. Assim, dois atendentes não vendem o mesmo estoque ao mesmo tempo.'],
        ['procedure', 'Ela recusa, com SIGNAL e mensagem em português, se o pedido não existir ou não estiver ABERTO, se o produto não existir ou estiver inativo, se a quantidade for zero ou negativa, se o estoque não bastar ou se o produto já estiver no pedido. Em qualquer recusa, o handler faz ROLLBACK e repassa o erro (RESIGNAL).'],
        ['procedure', 'Passando pelas validações, ela grava o item em item_pedido com o preço lido da tabela produto. O preço nunca vem da tela.'],
        ['trigger', 'trg_item_baixa_estoque (AFTER INSERT em item_pedido) subtrai a quantidade do estoque. A procedure não precisou mudar.'],
        ['interface', 'A interface recarrega o cardápio e os itens. A situação do produto, calculada por fn_situacao_estoque na vw_cardapio, pode ter virado “Estoque baixo”.'],
      ],
      nota: 'Se a validação falhar, os passos 3 e 4 não acontecem e a mensagem aparece na faixa de Avisos.',
    },
    remover: {
      gatilho: 'O atendente clica em “Remover” em um item do pedido, antes de pagar.',
      passos: [
        ['interface', 'A interface chama removerItem(), que executa um DELETE em item_pedido (id_pedido, id_produto). Aqui não existe procedure.'],
        ['trigger', 'trg_item_devolve_estoque (AFTER DELETE em item_pedido) soma de volta ao estoque a quantidade do item removido. Ele lê essa quantidade em OLD, porque no DELETE não existe NEW.'],
        ['interface', 'A interface recarrega o cardápio e os itens. O produto volta a aparecer como disponível.'],
      ],
      nota: 'Junto com o trigger do INSERT, o estoque acompanha os itens nos dois sentidos, automaticamente.',
    },
    finalizar: {
      gatilho: 'O caixa clica em “Finalizar e pagar”.',
      passos: [
        ['interface', 'A interface chama finalizarPedido(), que executa CALL sp_finalizar_pedido(pedido).'],
        ['procedure', 'sp_finalizar_pedido abre uma transação, trava o pedido (FOR UPDATE) e recusa pedido inexistente, pedido que não esteja ABERTO e pedido sem itens.'],
        ['function', 'fn_total_pedido soma quantidade × preço unitário dos itens e devolve o valor bruto.'],
        ['function', 'fn_desconto_fidelidade conta os pedidos PAGOS do cliente e devolve 10, 5 ou 0.'],
        ['procedure', 'Num único UPDATE, a procedure grava o desconto, o valor total já com o desconto (arredondado em duas casas) e o status PAGO. Não existe como gravar o status sem o valor.'],
        ['trigger', 'trg_pedido_bloqueia_alteracao (BEFORE UPDATE) olha OLD.status. Como o pedido ainda estava ABERTO, deixa passar. Dali em diante, o pedido pago fica travado.'],
        ['interface', 'A interface lê o pedido na vw_pedidos_detalhados e mostra o desconto e o valor total.'],
      ],
      nota: 'Por isso o trigger usa OLD.status: interessa a situação do pedido antes da mudança.',
    },
    reajustar: {
      gatilho: 'A gerência escolhe uma categoria, informa o percentual e confirma o reajuste.',
      passos: [
        ['interface', 'A interface chama reajustarPrecos(), que executa CALL sp_reajustar_precos_categoria(categoria, percentual).'],
        ['procedure', 'A procedure recusa categoria inexistente e percentual menor ou igual a -100.'],
        ['procedure', 'Ela atualiza o preço de cada produto da categoria, arredondando em duas casas.'],
        ['trigger', 'trg_produto_historico_preco (AFTER UPDATE em produto) grava uma linha em historico_preco para cada produto cujo preço realmente mudou: preço antigo, preço novo, data e CURRENT_USER().'],
        ['interface', 'A tela de Gerência mostra o histórico. Os pedidos antigos não mudam de valor, porque o preço de cada venda fica gravado em item_pedido.preco_unitario.'],
      ],
      nota: 'Um UPDATE direto no Workbench também gera histórico. A auditoria é do banco, e não depende de quem altera.',
    },
  };

  const fluxo = { nome: 'adicionar', temporizador: null };

  function pararFluxo() {
    clearTimeout(fluxo.temporizador);
    fluxo.temporizador = null;
  }

  function renderFluxo() {
    pararFluxo();
    const f = FLUXOS[fluxo.nome];
    $('#fluxo-gatilho').textContent = f.gatilho;
    $('#fluxo-nota').textContent = f.nota;
    $('#fluxo-passos').classList.remove('tocando');
    $('#fluxo-passos').innerHTML = f.passos.map(([camada, texto]) => `
      <li class="passo">
        <span class="tipo tipo-${camada}">${CAMADAS[camada]}</span>
        <p>${esc(texto)}</p>
      </li>`).join('');
    $('#fluxo-tocar').textContent = '▶ Percorrer';
  }

  function percorrerFluxo() {
    const passos = $$('#fluxo-passos .passo');
    pararFluxo();
    passos.forEach((p) => p.classList.remove('aceso'));
    if (reduzirMovimento) {
      passos.forEach((p) => p.classList.add('aceso'));
      return;
    }
    $('#fluxo-passos').classList.add('tocando');
    $('#fluxo-tocar').textContent = '↻ Repetir';
    let i = 0;
    const proximo = () => {
      if (i >= passos.length) {
        $('#fluxo-passos').classList.remove('tocando');
        passos.forEach((p) => p.classList.add('aceso'));
        return;
      }
      passos.forEach((p, k) => p.classList.toggle('aceso', k === i));
      passos[i].scrollIntoView({ block: 'nearest', behavior: 'smooth' });
      i += 1;
      fluxo.temporizador = setTimeout(proximo, 1500);
    };
    proximo();
  }

  $('#fluxo-escolha').addEventListener('click', (ev) => {
    const chip = ev.target.closest('[data-fluxo]');
    if (!chip) return;
    fluxo.nome = chip.dataset.fluxo;
    $$('#fluxo-escolha .chip').forEach((c) => c.setAttribute('aria-pressed', String(c === chip)));
    renderFluxo();
  });
  $('#fluxo-tocar').addEventListener('click', percorrerFluxo);

  /* ==========================================================================
   * ROTEIRO: progresso e cópia do comando
   * ========================================================================== */
  function contarRoteiro() {
    const caixas = $$('#roteiro-lista input[type="checkbox"]');
    const feitos = caixas.filter((c) => c.checked).length;
    $('#roteiro-contagem').textContent = feitos + ' de ' + caixas.length + ' passos';
  }
  $('#roteiro-lista').addEventListener('change', contarRoteiro);
  contarRoteiro();

  document.addEventListener('click', (ev) => {
    const botao = ev.target.closest('[data-copiar]');
    if (!botao) return;
    const alvo = $(botao.dataset.copiar);
    if (alvo) copiar(alvo.textContent.trim(), botao, alvo);
  });

  /* ---------- partida ---------- */
  renderFluxo();
})();
