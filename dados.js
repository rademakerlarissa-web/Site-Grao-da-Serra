/* ==========================================================================
 * dados.js — acesso à API do servidor e dados locais de demonstração.
 * ========================================================================== */
let MODO_DEMONSTRACAO = false;

const demo = (() => {
  const categorias = [
    { id_categoria: 1, nome: 'Cafés' },
    { id_categoria: 2, nome: 'Chás' },
    { id_categoria: 3, nome: 'Acompanhamentos' },
    { id_categoria: 4, nome: 'Mercearia' },
    { id_categoria: 5, nome: 'Bebidas' },
  ];
  const produtos = [
    { id_produto: 1, produto: 'Café coado', categoria: 'Cafés', id_categoria: 1, preco: 6, estoque: 20, estoque_minimo: 5 },
    { id_produto: 2, produto: 'Café espresso', categoria: 'Cafés', id_categoria: 1, preco: 11.5, estoque: 18, estoque_minimo: 5 },
    { id_produto: 3, produto: 'Café com leite', categoria: 'Cafés', id_categoria: 1, preco: 8, estoque: 16, estoque_minimo: 5 },
    { id_produto: 4, produto: 'Cappuccino', categoria: 'Bebidas', id_categoria: 5, preco: 12, estoque: 12, estoque_minimo: 4 },
    { id_produto: 5, produto: 'Chá de ervas', categoria: 'Chás', id_categoria: 2, preco: 7.5, estoque: 15, estoque_minimo: 4 },
    { id_produto: 6, produto: 'Chá de frutas', categoria: 'Chás', id_categoria: 2, preco: 8, estoque: 10, estoque_minimo: 4 },
    { id_produto: 7, produto: 'Pão de queijo', categoria: 'Acompanhamentos', id_categoria: 3, preco: 9, estoque: 24, estoque_minimo: 6 },
    { id_produto: 8, produto: 'Bolo de fubá', categoria: 'Acompanhamentos', id_categoria: 3, preco: 10, estoque: 14, estoque_minimo: 4 },
    { id_produto: 9, produto: 'Broa de milho', categoria: 'Acompanhamentos', id_categoria: 3, preco: 8.5, estoque: 11, estoque_minimo: 4 },
    { id_produto: 10, produto: 'Mel silvestre', categoria: 'Mercearia', id_categoria: 4, preco: 18, estoque: 14, estoque_minimo: 4 },
    { id_produto: 11, produto: 'Geleia artesanal', categoria: 'Mercearia', id_categoria: 4, preco: 16, estoque: 9, estoque_minimo: 3 },
    { id_produto: 12, produto: 'Doce de leite', categoria: 'Mercearia', id_categoria: 4, preco: 15, estoque: 0, estoque_minimo: 3 },
    { id_produto: 13, produto: 'Biscoito amanteigado', categoria: 'Acompanhamentos', id_categoria: 3, preco: 7, estoque: 2, estoque_minimo: 4 },
    { id_produto: 14, produto: 'Cesta da serra', categoria: 'Mercearia', id_categoria: 4, preco: 27, estoque: 8, estoque_minimo: 3 },
  ];
  const clientes = [
    { id_cliente: 1, nome: 'Helena Rudnick', cpf: '00000000001' },
    { id_cliente: 2, nome: 'Rafael', cpf: '00000000002' },
    { id_cliente: 3, nome: 'Marina Costa', cpf: '00000000003' },
    { id_cliente: 4, nome: 'João Almeida', cpf: '00000000004' },
  ];
  const funcionarios = [
    { id_funcionario: 1, nome: 'Bruno Tavares', cargo: 'Atendente' },
    { id_funcionario: 2, nome: 'Camila Souza', cargo: 'Caixa' },
  ];
  const pedidos = [
    { id_pedido: 1, id_cliente: 3, id_funcionario: 2, data_pedido: '2026-01-10 09:00:00', status: 'PAGO', desconto_percentual: 0, valor_total: 12 },
    { id_pedido: 2, id_cliente: 2, id_funcionario: 1, data_pedido: '2026-01-12 10:30:00', status: 'PAGO', desconto_percentual: 0, valor_total: 15.5 },
    { id_pedido: 10, id_cliente: 2, id_funcionario: 1, data_pedido: '2026-01-15 11:00:00', status: 'ABERTO', desconto_percentual: 0, valor_total: null },
  ];
  const itens = new Map([
    [1, [{ id_produto: 1, quantidade: 2, preco_unitario: 6 }]],
    [2, [{ id_produto: 3, quantidade: 1, preco_unitario: 8 }, { id_produto: 5, quantidade: 1, preco_unitario: 7.5 }]],
    [10, [{ id_produto: 14, quantidade: 1, preco_unitario: 27 }]],
  ]);
  const historico = [];
  let proximoPedido = 11;

  function produtoParaCardapio(p) {
    return {
      id_produto: p.id_produto,
      produto: p.produto,
      categoria: p.categoria,
      preco: p.preco,
      situacao: p.estoque <= 0 ? 'ESGOTADO' : p.estoque <= p.estoque_minimo ? 'REPOR' : 'OK',
    };
  }

  function pedidoDetalhado(p) {
    const linhas = itens.get(p.id_pedido) || [];
    const valorBruto = linhas.reduce((total, item) => total + item.quantidade * item.preco_unitario, 0);
    const cliente = clientes.find((c) => c.id_cliente === p.id_cliente);
    const funcionario = funcionarios.find((f) => f.id_funcionario === p.id_funcionario);
    return {
      ...p,
      cliente: cliente ? cliente.nome : '',
      atendente: funcionario ? funcionario.nome : '',
      qtd_itens: linhas.reduce((total, item) => total + item.quantidade, 0),
      valor_bruto: valorBruto,
      desconto_percentual: p.status === 'PAGO' ? p.desconto_percentual : null,
      valor_total: p.status === 'PAGO' ? p.valor_total : null,
    };
  }

  function listarItens(idPedido) {
    return (itens.get(idPedido) || []).map((item) => {
      const p = produtos.find((produto) => produto.id_produto === item.id_produto);
      return {
        id_produto: item.id_produto,
        produto: p ? p.produto : '',
        quantidade: item.quantidade,
        preco_unitario: item.preco_unitario,
        subtotal: item.quantidade * item.preco_unitario,
      };
    });
  }

  function erro(mensagem) {
    throw new Error(mensagem);
  }

  function executar(caminho, opcoes) {
    const url = new URL(caminho, window.location.href);
    const metodo = (opcoes && opcoes.method) || 'GET';
    const corpo = opcoes && opcoes.body ? JSON.parse(opcoes.body) : {};
    const partes = url.pathname.split('/').filter(Boolean);

    if (url.pathname === '/api/cardapio' && metodo === 'GET') {
      return produtos.map(produtoParaCardapio);
    }
    if (url.pathname === '/api/clientes' && metodo === 'GET') return clientes;
    if (url.pathname === '/api/funcionarios' && metodo === 'GET') return funcionarios;
    if (url.pathname === '/api/categorias' && metodo === 'GET') return categorias;
    if (url.pathname === '/api/pedidos' && metodo === 'POST') {
      if (!clientes.some((c) => c.id_cliente === Number(corpo.id_cliente))) erro('Selecione um cliente válido.');
      if (!funcionarios.some((f) => f.id_funcionario === Number(corpo.id_funcionario))) erro('Selecione um atendente válido.');
      const pedido = {
        id_pedido: proximoPedido++,
        id_cliente: Number(corpo.id_cliente),
        id_funcionario: Number(corpo.id_funcionario),
        data_pedido: new Date().toISOString().slice(0, 19).replace('T', ' '),
        status: 'ABERTO',
        desconto_percentual: 0,
        valor_total: null,
      };
      pedidos.push(pedido);
      itens.set(pedido.id_pedido, []);
      return { id_pedido: pedido.id_pedido };
    }
    if (partes[1] === 'pedidos' && partes.length === 2 && metodo === 'GET') {
      const status = url.searchParams.get('status');
      return pedidos
        .filter((p) => !status || p.status === status)
        .slice()
        .sort((a, b) => b.id_pedido - a.id_pedido)
        .map(pedidoDetalhado);
    }
    if (partes[1] === 'pedidos' && partes.length === 4 && partes[3] === 'itens' && metodo === 'GET') {
      return listarItens(Number(partes[2]));
    }
    if (partes[1] === 'pedidos' && partes.length === 4 && partes[3] === 'itens' && metodo === 'POST') {
      const idPedido = Number(partes[2]);
      const idProduto = Number(corpo.id_produto);
      const quantidade = Number(corpo.quantidade);
      const pedido = pedidos.find((p) => p.id_pedido === idPedido);
      const produto = produtos.find((p) => p.id_produto === idProduto);
      if (!pedido || pedido.status !== 'ABERTO') erro('Pedido inexistente ou não está aberto.');
      if (!produto) erro('Produto não encontrado.');
      if (!Number.isSafeInteger(quantidade) || quantidade <= 0) erro('Informe uma quantidade maior que zero.');
      if (produto.estoque < quantidade) erro('Estoque insuficiente.');
      const linhas = itens.get(idPedido) || [];
      if (linhas.some((item) => item.id_produto === idProduto)) erro('Este produto já está no pedido.');
      linhas.push({ id_produto: idProduto, quantidade, preco_unitario: produto.preco });
      itens.set(idPedido, linhas);
      produto.estoque -= quantidade;
      return null;
    }
    if (partes[1] === 'pedidos' && partes.length === 5 && partes[3] === 'itens' && metodo === 'DELETE') {
      const idPedido = Number(partes[2]);
      const idProduto = Number(partes[4]);
      const linhas = itens.get(idPedido) || [];
      const indice = linhas.findIndex((item) => item.id_produto === idProduto);
      if (indice < 0) erro('Item não encontrado neste pedido.');
      const [removido] = linhas.splice(indice, 1);
      const produto = produtos.find((p) => p.id_produto === idProduto);
      if (produto) produto.estoque += removido.quantidade;
      return null;
    }
    if (partes[1] === 'pedidos' && partes.length === 4 && partes[3] === 'finalizar' && metodo === 'POST') {
      const pedido = pedidos.find((p) => p.id_pedido === Number(partes[2]));
      const linhas = pedido ? itens.get(pedido.id_pedido) || [] : [];
      if (!pedido || pedido.status !== 'ABERTO') erro('Pedido inexistente ou não está aberto.');
      if (!linhas.length) erro('O pedido precisa ter pelo menos um item.');
      const pagosDoCliente = pedidos.filter((p) => p.id_cliente === pedido.id_cliente && p.status === 'PAGO').length;
      const bruto = linhas.reduce((total, item) => total + item.quantidade * item.preco_unitario, 0);
      pedido.desconto_percentual = pagosDoCliente >= 5 ? 10 : pagosDoCliente >= 1 ? 5 : 0;
      pedido.valor_total = Math.round(bruto * (1 - pedido.desconto_percentual / 100) * 100) / 100;
      pedido.status = 'PAGO';
      return null;
    }
    if (url.pathname === '/api/gerencia/reposicao' && metodo === 'GET') {
      return produtos
        .filter((p) => p.estoque <= p.estoque_minimo)
        .map((p) => ({
          id_produto: p.id_produto,
          produto: p.produto,
          categoria: p.categoria,
          estoque: p.estoque,
          estoque_minimo: p.estoque_minimo,
          faltam: Math.max(0, p.estoque_minimo - p.estoque),
        }));
    }
    if (url.pathname === '/api/gerencia/vendas' && metodo === 'GET') {
      const vendas = new Map(categorias.map((categoria) => [categoria.nome, { categoria: categoria.nome, unidades: 0, faturamento: 0 }]));
      pedidos.filter((p) => p.status === 'PAGO').forEach((pedido) => {
        (itens.get(pedido.id_pedido) || []).forEach((item) => {
          const produto = produtos.find((p) => p.id_produto === item.id_produto);
          if (!produto) return;
          const venda = vendas.get(produto.categoria);
          venda.unidades += item.quantidade;
          venda.faturamento += item.quantidade * item.preco_unitario;
        });
      });
      return Array.from(vendas.values());
    }
    if (url.pathname === '/api/gerencia/reajustes' && metodo === 'POST') {
      const categoria = categorias.find((c) => c.id_categoria === Number(corpo.id_categoria));
      const percentual = Number(corpo.percentual);
      if (!categoria) erro('Categoria não encontrada.');
      if (!Number.isFinite(percentual) || percentual <= -100) erro('Informe um percentual maior que -100.');
      produtos.filter((p) => p.id_categoria === categoria.id_categoria).forEach((produto) => {
        const anterior = produto.preco;
        produto.preco = Math.round(anterior * (1 + percentual / 100) * 100) / 100;
        if (produto.preco !== anterior) {
          historico.unshift({
            id_produto: produto.id_produto,
            preco_antigo: anterior,
            preco_novo: produto.preco,
            data_alteracao: new Date().toISOString().slice(0, 19).replace('T', ' '),
            usuario: 'simulacao-local',
          });
        }
      });
      return { ok: true };
    }
    if (url.pathname === '/api/gerencia/historico-precos' && metodo === 'GET') return historico;
    erro('Operação indisponível nos dados de demonstração.');
  }

  return { executar };
})();

function ativarModoDemonstracao() {
  if (MODO_DEMONSTRACAO) return;
  MODO_DEMONSTRACAO = true;
  const badge = document.getElementById('badge-demo');
  if (badge) badge.hidden = false;
  window.dispatchEvent(new Event('modo-demonstracao'));
}

async function requisitarApi(caminho, opcoes) {
  if (MODO_DEMONSTRACAO) return demo.executar(caminho, opcoes);

  let resposta;
  try {
    resposta = await fetch(caminho, {
      headers: { 'Content-Type': 'application/json' },
      ...opcoes,
    });
  } catch (erro) {
    ativarModoDemonstracao();
    return demo.executar(caminho, opcoes);
  }

  const tipoConteudo = resposta.headers && resposta.headers.get('content-type');
  if (
    resposta.status === 503
    || (resposta.status === 404 && (!tipoConteudo || !tipoConteudo.includes('json')))
    || (resposta.ok && tipoConteudo && tipoConteudo.includes('text/html'))
  ) {
    ativarModoDemonstracao();
    return demo.executar(caminho, opcoes);
  }

  const texto = await resposta.text();
  let resultado = null;
  if (texto) {
    try {
      resultado = JSON.parse(texto);
    } catch (erro) {
      throw new Error('O servidor retornou uma resposta inválida.');
    }
  }
  if (!resposta.ok) {
    throw new Error((resultado && resultado.error) || `Erro na API (${resposta.status}).`);
  }
  return resultado;
}

const enviarJson = (metodo, corpo) => ({
  method: metodo,
  body: JSON.stringify(corpo),
});

async function listarCardapio() {
  return requisitarApi('/api/cardapio');
}

async function listarClientes() {
  return requisitarApi('/api/clientes');
}

async function listarFuncionarios() {
  return requisitarApi('/api/funcionarios');
}

async function listarCategorias() {
  return requisitarApi('/api/categorias');
}

async function abrirPedido(idCliente, idFuncionario) {
  const resultado = await requisitarApi(
    '/api/pedidos',
    enviarJson('POST', { id_cliente: idCliente, id_funcionario: idFuncionario })
  );
  return resultado.id_pedido;
}

async function adicionarItem(idPedido, idProduto, quantidade) {
  return requisitarApi(
    `/api/pedidos/${encodeURIComponent(idPedido)}/itens`,
    enviarJson('POST', { id_produto: idProduto, quantidade })
  );
}

async function removerItem(idPedido, idProduto) {
  return requisitarApi(
    `/api/pedidos/${encodeURIComponent(idPedido)}/itens/${encodeURIComponent(idProduto)}`,
    { method: 'DELETE' }
  );
}

async function listarItensPedido(idPedido) {
  return requisitarApi(`/api/pedidos/${encodeURIComponent(idPedido)}/itens`);
}

async function finalizarPedido(idPedido) {
  return requisitarApi(
    `/api/pedidos/${encodeURIComponent(idPedido)}/finalizar`,
    { method: 'POST' }
  );
}

async function listarPedidos(status) {
  const query = status ? `?${new URLSearchParams({ status })}` : '';
  return requisitarApi(`/api/pedidos${query}`);
}

async function listarProdutosParaRepor() {
  return requisitarApi('/api/gerencia/reposicao');
}

async function listarVendasPorCategoria() {
  return requisitarApi('/api/gerencia/vendas');
}

async function reajustarPrecos(idCategoria, percentual) {
  return requisitarApi(
    '/api/gerencia/reajustes',
    enviarJson('POST', { id_categoria: idCategoria, percentual })
  );
}

async function listarHistoricoPrecos() {
  return requisitarApi('/api/gerencia/historico-precos');
}
