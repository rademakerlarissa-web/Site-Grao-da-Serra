'use strict';

require('dotenv').config();

const path = require('node:path');
const express = require('express');
const mysql = require('mysql2/promise');

const required = ['DB_HOST', 'DB_NAME', 'DB_USER'];
const missing = required.filter((key) => !process.env[key]);
const hasDatabaseSettings = required.some((key) => process.env[key] !== undefined)
  || process.env.DB_PASSWORD !== undefined;
if (hasDatabaseSettings && missing.length) {
  throw new Error(`Configure as variáveis ${missing.join(', ')} no arquivo .env.`);
}
if (hasDatabaseSettings && process.env.DB_PASSWORD === undefined) {
  throw new Error('Configure DB_PASSWORD no arquivo .env. Use vazio se o usuário MySQL não tiver senha.');
}
const databaseConfigurado = hasDatabaseSettings;

const port = Number(process.env.PORT || 3000);
const dbPort = Number(process.env.DB_PORT || 3306);
if (!Number.isInteger(port) || port < 1 || port > 65535) {
  throw new Error('PORT precisa ser um número entre 1 e 65535.');
}
if (databaseConfigurado && (!Number.isInteger(dbPort) || dbPort < 1 || dbPort > 65535)) {
  throw new Error('DB_PORT precisa ser um número entre 1 e 65535.');
}

const pool = databaseConfigurado ? mysql.createPool({
  host: process.env.DB_HOST,
  port: dbPort,
  database: process.env.DB_NAME,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0,
  decimalNumbers: true,
  dateStrings: true,
  charset: 'utf8mb4',
}) : null;

const app = express();
app.disable('x-powered-by');
app.use(express.json({ limit: '10kb' }));

function erroHttp(status, mensagem) {
  const erro = new Error(mensagem);
  erro.status = status;
  return erro;
}

function inteiroPositivo(valor, nome) {
  const numero = Number(valor);
  if (!Number.isSafeInteger(numero) || numero <= 0) {
    throw erroHttp(400, `${nome} precisa ser um número inteiro positivo.`);
  }
  return numero;
}

function asyncRoute(handler) {
  return (req, res, next) => Promise.resolve(handler(req, res, next)).catch(next);
}

app.get('/api/health', asyncRoute(async (req, res) => {
  await pool.query('SELECT 1');
  res.json({ ok: true, database: process.env.DB_NAME });
}));

app.get('/api/cardapio', asyncRoute(async (req, res) => {
  const [rows] = await pool.query('SELECT * FROM vw_cardapio ORDER BY categoria, produto');
  res.json(rows);
}));

app.get('/api/clientes', asyncRoute(async (req, res) => {
  const [rows] = await pool.query('SELECT id_cliente, nome, cpf FROM cliente ORDER BY nome');
  res.json(rows);
}));

app.get('/api/funcionarios', asyncRoute(async (req, res) => {
  const [rows] = await pool.query('SELECT id_funcionario, nome, cargo FROM funcionario ORDER BY nome');
  res.json(rows);
}));

app.get('/api/categorias', asyncRoute(async (req, res) => {
  const [rows] = await pool.query('SELECT id_categoria, nome FROM categoria ORDER BY nome');
  res.json(rows);
}));

app.post('/api/pedidos', asyncRoute(async (req, res) => {
  const idCliente = inteiroPositivo(req.body.id_cliente, 'id_cliente');
  const idFuncionario = inteiroPositivo(req.body.id_funcionario, 'id_funcionario');
  const connection = await pool.getConnection();
  try {
    await connection.query('CALL sp_abrir_pedido(?, ?, @id_pedido)', [idCliente, idFuncionario]);
    const [[resultado]] = await connection.query('SELECT @id_pedido AS id_pedido');
    res.status(201).json({ id_pedido: resultado.id_pedido });
  } finally {
    connection.release();
  }
}));

app.post('/api/pedidos/:id/itens', asyncRoute(async (req, res) => {
  const idPedido = inteiroPositivo(req.params.id, 'id_pedido');
  const idProduto = inteiroPositivo(req.body.id_produto, 'id_produto');
  const quantidade = inteiroPositivo(req.body.quantidade, 'quantidade');
  await pool.query('CALL sp_adicionar_item(?, ?, ?)', [idPedido, idProduto, quantidade]);
  res.status(204).end();
}));

app.get('/api/pedidos/:id/itens', asyncRoute(async (req, res) => {
  const idPedido = inteiroPositivo(req.params.id, 'id_pedido');
  const [rows] = await pool.execute(
    `SELECT i.id_produto, p.nome AS produto, i.quantidade, i.preco_unitario,
            i.quantidade * i.preco_unitario AS subtotal
       FROM item_pedido i
       JOIN produto p ON p.id_produto = i.id_produto
      WHERE i.id_pedido = ?
      ORDER BY p.nome`,
    [idPedido]
  );
  res.json(rows);
}));

app.delete('/api/pedidos/:id/itens/:produtoId', asyncRoute(async (req, res) => {
  const idPedido = inteiroPositivo(req.params.id, 'id_pedido');
  const idProduto = inteiroPositivo(req.params.produtoId, 'id_produto');
  const [resultado] = await pool.execute(
    'DELETE FROM item_pedido WHERE id_pedido = ? AND id_produto = ?',
    [idPedido, idProduto]
  );
  if (resultado.affectedRows === 0) {
    throw erroHttp(404, 'Item não encontrado neste pedido.');
  }
  res.status(204).end();
}));

app.post('/api/pedidos/:id/finalizar', asyncRoute(async (req, res) => {
  const idPedido = inteiroPositivo(req.params.id, 'id_pedido');
  await pool.query('CALL sp_finalizar_pedido(?)', [idPedido]);
  res.status(204).end();
}));

app.get('/api/pedidos', asyncRoute(async (req, res) => {
  const status = req.query.status;
  const statusPermitidos = new Set(['ABERTO', 'PAGO', 'CANCELADO']);
  if (status && !statusPermitidos.has(status)) {
    throw erroHttp(400, 'Status de pedido inválido.');
  }
  const sql = status
    ? 'SELECT * FROM vw_pedidos_detalhados WHERE status = ? ORDER BY id_pedido DESC'
    : 'SELECT * FROM vw_pedidos_detalhados ORDER BY id_pedido DESC';
  const [rows] = status ? await pool.execute(sql, [status]) : await pool.query(sql);
  res.json(rows);
}));

app.get('/api/gerencia/reposicao', asyncRoute(async (req, res) => {
  const [rows] = await pool.query('SELECT * FROM vw_produtos_para_repor ORDER BY categoria, produto');
  res.json(rows);
}));

app.get('/api/gerencia/vendas', asyncRoute(async (req, res) => {
  const [rows] = await pool.query('SELECT * FROM vw_vendas_por_categoria ORDER BY categoria');
  res.json(rows);
}));

app.post('/api/gerencia/reajustes', asyncRoute(async (req, res) => {
  const idCategoria = inteiroPositivo(req.body.id_categoria, 'id_categoria');
  const percentual = Number(req.body.percentual);
  if (!Number.isFinite(percentual) || percentual <= -100) {
    throw erroHttp(400, 'Informe um percentual maior que -100.');
  }
  await pool.query('CALL sp_reajustar_precos_categoria(?, ?)', [idCategoria, percentual]);
  res.json({ ok: true });
}));

app.get('/api/gerencia/historico-precos', asyncRoute(async (req, res) => {
  const [rows] = await pool.query(
    'SELECT * FROM historico_preco ORDER BY id_historico DESC'
  );
  res.json(rows);
}));

app.use('/api', (req, res) => {
  res.status(404).json({ error: 'Rota da API não encontrada.' });
});

const arquivosPrivados = new Set([
  '/server.js',
  '/package.json',
  '/package-lock.json',
  '/.env.example',
  '/.gitignore',
]);
app.use((req, res, next) => {
  const caminho = req.path.toLowerCase();
  if (arquivosPrivados.has(caminho) || caminho.startsWith('/node_modules/')) {
    return res.sendStatus(404);
  }
  next();
});
app.use(express.static(__dirname, { dotfiles: 'deny', index: 'index.html' }));

app.use((erro, req, res, next) => {
  if (res.headersSent) return next(erro);
  if (erro.status) return res.status(erro.status).json({ error: erro.message });
  if (erro.sqlState === '45000' && erro.sqlMessage) {
    return res.status(400).json({ error: erro.sqlMessage });
  }
  if (!pool || [
    'ECONNREFUSED',
    'ECONNRESET',
    'EHOSTUNREACH',
    'ENOTFOUND',
    'ETIMEDOUT',
    'PROTOCOL_CONNECTION_LOST',
    'PROTOCOL_ENQUEUE_AFTER_FATAL_ERROR',
    'ER_ACCESS_DENIED_ERROR',
  ].includes(erro.code)) {
    return res.status(503).json({ error: 'Banco de dados indisponível.' });
  }
  console.error('Falha na API:', erro);
  return res.status(500).json({ error: 'Erro ao acessar o banco de dados.' });
});

const server = app.listen(port, '127.0.0.1', () => {
  console.log(`Grão da Serra disponível em http://127.0.0.1:${port}`);
  if (!pool) console.log('Banco não configurado; a interface usará dados de demonstração.');
});

async function encerrar() {
  server.close(async () => {
    if (pool) await pool.end();
    process.exit(0);
  });
}

process.on('SIGINT', encerrar);
process.on('SIGTERM', encerrar);
