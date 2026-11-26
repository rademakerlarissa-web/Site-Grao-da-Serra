# Empório & Café Grão da Serra: interface de pedidos

Interface web da **Questão 16** do exercício de Banco de Dados sobre *Functions, Procedures, Views e Triggers*. Ela usa o banco `grao_da_serra` (MySQL) e mostra, na prática, como as regras do negócio ficam dentro do banco: a tela só pede e mostra, e o banco calcula, valida e registra.

**Aluna:** Larissa Rademaker Gabriel

---

## O que a interface faz

| Tela                  | O que acontece                                                                                             | O que o banco usa                                                                                                      |
| --------------------- | ---------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| **Cardápio**   | Lista os produtos ativos por categoria, com os avisos "Estoque baixo" e "Esgotado".                        | `vw_cardapio` (que usa `fn_situacao_estoque`)                                                                      |
| **Novo pedido** | Abre um pedido, adiciona e remove produtos e finaliza o pagamento, já com o desconto de fidelidade.       | `sp_abrir_pedido`, `sp_adicionar_item`, `DELETE` em `item_pedido`, `sp_finalizar_pedido`                     |
| **Pedidos**     | Lista todos os pedidos, filtra por status e permite continuar um pedido aberto.                            | `vw_pedidos_detalhados`                                                                                              |
| **Gerência**   | Mostra os produtos para repor e as vendas por categoria, reajusta preços e exibe o histórico de preços. | `vw_produtos_para_repor`, `vw_vendas_por_categoria`, `sp_reajustar_precos_categoria`, tabela `historico_preco` |
| **Bastidores**  | Material de apoio para a apresentação (veja abaixo).                                                     | nenhum                                                                                                                 |

Recursos que valem destacar:

- **Faixa de Avisos:** mostra a mensagem que o banco devolve, em português, quando recusa uma operação (os `SIGNAL` das procedures). A interface não valida nada por conta própria.
- **Painel "O que o banco fez":** depois de cada ação que altera dados, sobe na parte de baixo da tela e lista, passo a passo, qual procedure, function, view e trigger entrou em cena, com os valores reais da ação. Quando o banco recusa algo, ele mostra a recusa e explica o `ROLLBACK`. O botão **Explicações**, no topo, liga e desliga o painel.
- **Bastidores:** os quatro recursos explicados (quando usar cada um), o mapa das 15 questões e onde cada uma aparece na interface, o caminho de uma ação do clique até o banco, uma explicação da conexão com o banco (com um campo para rascunhar o parágrafo da entrega) e um roteiro de demonstração.
- **Modo claro e escuro:** o claro lembra uma casa colonial de enxaimel, e o escuro, um quadro de giz. Por padrão, segue o tema do sistema.

## Princípio de projeto

**No modo conectado, as regras de negócio ficam no banco.** Totais, descontos, estoque, situação dos produtos e histórico de preços são calculados ou atualizados pelo MySQL. O JavaScript chama as rotinas, mostra o que voltou e recarrega as telas; os triggers cuidam dos efeitos automáticos. No modo de demonstração, `dados.js` simula esses comportamentos localmente, sem persistir alterações.

## Arquivos

| Arquivo           | Função                                                                              |
| ----------------- | ------------------------------------------------------------------------------------- |
| `index.html`    | Estrutura das telas, do painel de explicações e dos Bastidores.                     |
| `estilo.css`    | Visual (tema claro e escuro, enxaimel, cartões de cardápio).                        |
| `dados.js`      | **Único ponto de acesso a dados.** Todas as chamadas ao banco passam por aqui. |
| `app.js`        | Lógica da interface: telas, formulários, avisos e painel "O que o banco fez".       |
| `bastidores.js` | Abas, filtro do mapa e caminho de uma ação da tela Bastidores.                      |
| `server.js`     | API Express, validação das requisições e acesso ao MySQL pelo pool `mysql2`.       |
| `package.json`  | Dependências do servidor e comando `npm start`.                                    |

## Como executar

O projeto inclui um servidor Node.js/Express e a API; instale as dependências e inicie a aplicação na pasta do projeto:

```bash
npm install
npm start
```

Abra <http://127.0.0.1:3000>. Para verificar se a API consegue consultar o banco, use <http://127.0.0.1:3000/api/health>. Também é possível abrir `index.html` diretamente ou servi-lo sem a API: nesses casos, a página usa os dados de demonstração.

As fontes (Grenze Gotisch, Alegreya Sans e Courier Prime) vêm do Google Fonts. Sem internet, o navegador usa fontes de reserva.

## Conexão com o MySQL

O navegador não se conecta diretamente ao banco. O caminho de uma requisição é:

1. `app.js` chama uma função assíncrona de `dados.js`.
2. `dados.js` envia uma requisição HTTP com `fetch` para uma rota `/api/...`.
3. `server.js`, usando Node.js, Express e `mysql2/promise`, executa uma consulta parametrizada ou chama uma procedure MySQL.
4. O servidor devolve o resultado em JSON; a interface atualiza a tela. Os erros SQL `SIGNAL` são enviados como respostas HTTP 400, com a mensagem da procedure.

As credenciais ficam no arquivo local `.env`, lido pelo servidor com `dotenv`. Configure `DB_HOST`, `DB_PORT` (opcional, padrão `3306`), `DB_NAME`, `DB_USER` e `DB_PASSWORD`. Não coloque credenciais no JavaScript do navegador nem as publique no Git. A aplicação usa um pool de conexões MySQL.

Exemplo de configuração local (substitua os valores pelos do seu MySQL; `DB_PASSWORD` pode ficar vazio se o usuário não tiver senha):

```dotenv
DB_HOST=127.0.0.1
DB_PORT=3306
DB_NAME=grao_da_serra
DB_USER=grao_app
DB_PASSWORD=sua_senha
```

O banco e os objetos (tabelas, views, rotinas e triggers) precisam estar criados no MySQL antes de conectar. A API não cria nem migra o schema automaticamente. Os scripts estão na pasta `sql/` e devem ser executados nesta ordem:

1. [`sql/01_base_grao_da_serra.sql`](sql/01_base_grao_da_serra.sql) cria o banco, as tabelas e os dados iniciais de teste. Execute uma vez em uma instalação sem o banco `grao_da_serra`.
2. [`sql/02_questoes_1_a_15.sql`](sql/02_questoes_1_a_15.sql) cria as functions, procedures, triggers e views. Pode ser executado novamente para recriar esses objetos; não recria as tabelas nem apaga os dados.

No MySQL Workbench, abra cada arquivo dentro de `sql/` e execute primeiro o script da base. A aplicação espera o schema e os nomes de objetos definidos nesses scripts.

| Função em `dados.js` | Rota da API | Operação principal |
| --- | --- | --- |
| `listarCardapio()` | `GET /api/cardapio` | Consulta `vw_cardapio` |
| `listarClientes()`, `listarFuncionarios()`, `listarCategorias()` | `GET /api/clientes`, `/api/funcionarios`, `/api/categorias` | Consultas às respectivas tabelas |
| `abrirPedido()` | `POST /api/pedidos` | `CALL sp_abrir_pedido`; lê o parâmetro `OUT` na mesma conexão |
| `adicionarItem()` | `POST /api/pedidos/:id/itens` | `CALL sp_adicionar_item` |
| `removerItem()` | `DELETE /api/pedidos/:id/itens/:produtoId` | `DELETE` em `item_pedido`; o trigger devolve o estoque |
| `listarItensPedido()` | `GET /api/pedidos/:id/itens` | Consulta dos itens com `JOIN` em `produto` |
| `finalizarPedido()` | `POST /api/pedidos/:id/finalizar` | `CALL sp_finalizar_pedido` |
| `listarPedidos()` | `GET /api/pedidos?status=...` | Consulta `vw_pedidos_detalhados` |
| `listarProdutosParaRepor()` | `GET /api/gerencia/reposicao` | Consulta `vw_produtos_para_repor` |
| `listarVendasPorCategoria()` | `GET /api/gerencia/vendas` | Consulta `vw_vendas_por_categoria` |
| `reajustarPrecos()` | `POST /api/gerencia/reajustes` | `CALL sp_reajustar_precos_categoria` |
| `listarHistoricoPrecos()` | `GET /api/gerencia/historico-precos` | Consulta `historico_preco` |

O servidor valida parâmetros, usa placeholders nas consultas e não expõe o `.env` pela hospedagem estática. Para `abrirPedido`, a procedure e a leitura do `OUT` usam a mesma conexão do pool. O conector pode devolver valores `DECIMAL` como texto; a interface os converte para número ao formatar valores monetários.

### Sem conexão com o banco

Se o MySQL não estiver configurado ou estiver inacessível, a API informa indisponibilidade e `dados.js` ativa automaticamente os dados fictícios. A página também usa essa demonstração se for aberta diretamente ou se o servidor estático devolver HTML para uma rota da API. O selo **“Dados fictícios”** e o aviso deixam claro que as ações são apenas simuladas; pedidos, alterações de estoque, reajustes e histórico ficam em memória e são perdidos ao recarregar a página. Erros de validação da API em JSON continuam sendo exibidos, em vez de serem escondidos pelo fallback.

## Estrutura do banco e recursos

O banco usado pela aplicação é `grao_da_serra`. As tabelas envolvidas nos fluxos incluem `categoria` e `produto` para o catálogo; `cliente` e `funcionario` como participantes dos pedidos; `pedido` para o cabeçalho; `item_pedido` para produtos e preços registrados na venda; e `historico_preco` para auditoria de reajustes.

**Functions** calculam e devolvem um valor:

- `fn_total_pedido` soma quantidade × preço unitário dos itens de um pedido.
- `fn_situacao_estoque` classifica o estoque do produto como disponível, baixo (`REPOR`) ou esgotado.
- `fn_desconto_fidelidade` determina o percentual de desconto a partir dos pedidos pagos do cliente.

**Procedures** executam operações de negócio no banco, centralizando validações e alterações:

- `sp_abrir_pedido` valida cliente e funcionário, cria o pedido e devolve seu ID pelo parâmetro `OUT`.
- `sp_adicionar_item` valida o estado do pedido, produto, quantidade, estoque e duplicidade; usa transação e grava o preço vigente do produto.
- `sp_finalizar_pedido` valida o pedido, calcula bruto e fidelidade e grava desconto, valor total e status pago numa operação transacional; bloqueia as linhas relevantes durante a operação.
- `sp_reajustar_precos_categoria` valida categoria e percentual e atualiza os preços da categoria.

**Views** fornecem conjuntos de dados prontos para leitura pela aplicação:

- `vw_cardapio` mostra produtos ativos e sua situação, sem expor as colunas de estoque na tela.
- `vw_pedidos_detalhados` reúne pedido, cliente, atendente, quantidade de itens e valores.
- `vw_produtos_para_repor` lista produtos ativos cujo estoque está no mínimo ou abaixo dele.
- `vw_vendas_por_categoria` agrega unidades e faturamento dos pedidos pagos por categoria.

**Triggers** executam automaticamente como consequência de alterações nas tabelas:

- `trg_item_baixa_estoque` reduz o estoque depois da inclusão de um item no pedido.
- `trg_item_devolve_estoque` devolve ao estoque a quantidade quando um item é removido.
- `trg_produto_historico_preco` registra preço anterior, preço novo, data e usuário em `historico_preco` quando o preço muda.
- `trg_pedido_bloqueia_alteracao` impede alterações indevidas em pedidos já pagos ou cancelados.

Os preços unitários são copiados para `item_pedido` ao adicionar o produto ao pedido. Assim, reajustes posteriores não alteram o valor registrado nas vendas antigas.

Assim, a interface solicita operações e apresenta os resultados, enquanto as regras críticas, os cálculos e os efeitos automáticos permanecem no banco. A aba **Bastidores** explica os recursos, mostra o mapa das questões e ilustra o caminho de cada operação.

## Roteiro de teste (estado inicial do banco)

| O que fazer                                                               | Resultado esperado                                                                     |
| ------------------------------------------------------------------------- | -------------------------------------------------------------------------------------- |
| Abrir pedido para Helena Rudnick e adicionar 11 unidades de Mel silvestre | O mel entra em "Produtos para repor" (estoque de 14 para 3, mínimo 4).                |
| Adicionar quantidade 0, depois 999                                        | Mensagens do banco: "Informe uma quantidade maior que zero." e "Estoque insuficiente." |
| Remover o mel do pedido                                                   | O estoque volta, e o produto sai da lista de repor.                                    |
| Finalizar o pedido 10 (Rafael Linzmeyer)                                  | Desconto de 5,00% e total de R$ 25,65.                                                 |
| Finalizar o pedido 9 (Luana Pscheidt)                                     | Sem desconto, total de R$ 30,00.                                                       |
| Reajustar os Cafés em 10%                                                | O histórico ganha 3 linhas: 6,00 → 6,60, 11,50 → 12,65 e 8,00 → 8,80.              |
| No Workbench: `UPDATE pedido SET valor_total = 1 WHERE id_pedido = 1;`  | O trigger recusa: pedido pago não pode ser alterado.                                  |

A aba **Bastidores > Roteiro da demonstração** traz esses mesmos passos, com caixas para marcar o andamento.

## Tecnologias

Interface: HTML5, CSS3 e JavaScript puro. Servidor/API: Node.js e Express. Conexão MySQL: `mysql2/promise`, com configuração carregada de `.env` por `dotenv`. O CSS usa variáveis para os temas claro e escuro; as fontes externas são servidas pelo Google Fonts.

## Uso de IA

A interface, a API e a documentação tiveram auxílio de IA. As functions, procedures, views e triggers são objetos do banco MySQL e são utilizados pela aplicação por meio das consultas e chamadas descritas acima. Revise e adapte esta declaração às regras de identificação de ferramentas exigidas pela disciplina.
