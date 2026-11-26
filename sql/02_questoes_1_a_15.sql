USE grao_da_serra;

DROP VIEW IF EXISTS vw_cardapio, vw_pedidos_detalhados,
                   vw_produtos_para_repor, vw_vendas_por_categoria;
DROP TRIGGER IF EXISTS trg_item_baixa_estoque;
DROP TRIGGER IF EXISTS trg_item_devolve_estoque;
DROP TRIGGER IF EXISTS trg_produto_historico_preco;
DROP TRIGGER IF EXISTS trg_pedido_bloqueia_alteracao;
DROP PROCEDURE IF EXISTS sp_abrir_pedido;
DROP PROCEDURE IF EXISTS sp_adicionar_item;
DROP PROCEDURE IF EXISTS sp_finalizar_pedido;
DROP PROCEDURE IF EXISTS sp_reajustar_precos_categoria;
DROP FUNCTION IF EXISTS fn_total_pedido;
DROP FUNCTION IF EXISTS fn_situacao_estoque;
DROP FUNCTION IF EXISTS fn_desconto_fidelidade;

-- Q1. Soma os valores dos itens pelo preço histórico. COALESCE troca NULL por zero.
CREATE FUNCTION fn_total_pedido(p_id_pedido INT)
RETURNS DECIMAL(10,2)
READS SQL DATA
RETURN (
    SELECT COALESCE(SUM(quantidade * preco_unitario), 0)
    FROM item_pedido
    WHERE id_pedido = p_id_pedido
);

-- Q2. Testa primeiro estoque zero. Com saldo positivo, compara com o mínimo.
CREATE FUNCTION fn_situacao_estoque(p_id_produto INT)
RETURNS VARCHAR(8)
READS SQL DATA
RETURN (
    SELECT CASE
        WHEN estoque = 0 THEN 'ESGOTADO'
        WHEN estoque > 0 AND estoque <= estoque_minimo THEN 'REPOR'
        ELSE 'OK'
    END
    FROM produto
    WHERE id_produto = p_id_produto
);

-- Q3. Conta somente os pedidos pagos e verifica a faixa maior primeiro.
CREATE FUNCTION fn_desconto_fidelidade(p_id_cliente INT)
RETURNS DECIMAL(4,2)
READS SQL DATA
RETURN (
    SELECT CASE
        WHEN COUNT(*) >= 4 THEN 10
        WHEN COUNT(*) >= 2 THEN 5
        ELSE 0
    END
    FROM pedido
    WHERE id_cliente = p_id_cliente AND status = 'PAGO'
);

DELIMITER $$

-- Q4. Os padrões da tabela definem a data e o status. OUT devolve o ID da sessão.
CREATE PROCEDURE sp_abrir_pedido(
    IN p_id_cliente INT, IN p_id_funcionario INT, OUT p_id_pedido INT
)
BEGIN
    IF NOT EXISTS (SELECT 1 FROM cliente WHERE id_cliente = p_id_cliente) THEN
        SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Cliente inexistente.';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM funcionario WHERE id_funcionario = p_id_funcionario) THEN
        SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Funcionário inexistente.';
    END IF;

    INSERT INTO pedido (id_cliente, id_funcionario)
    VALUES (p_id_cliente, p_id_funcionario);
    SET p_id_pedido = LAST_INSERT_ID();
END$$

-- Q5. Bloqueia as linhas do pedido e do produto durante a operação.
-- O item recebe o preço atual e o trigger baixa o estoque na mesma transação.
CREATE PROCEDURE sp_adicionar_item(
    IN p_id_pedido INT, IN p_id_produto INT, IN p_quantidade INT
)
BEGIN
    DECLARE v_status VARCHAR(10);
    DECLARE v_ativo BOOLEAN;
    DECLARE v_estoque INT;
    DECLARE v_preco DECIMAL(8,2);
    DECLARE EXIT HANDLER FOR SQLEXCEPTION
    BEGIN
        ROLLBACK;
        RESIGNAL;
    END;

    START TRANSACTION;

    SELECT status INTO v_status
    FROM pedido WHERE id_pedido = p_id_pedido FOR UPDATE;
    IF v_status IS NULL THEN
        SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Pedido inexistente.';
    END IF;
    IF v_status <> 'ABERTO' THEN
        SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Somente pedidos abertos aceitam itens.';
    END IF;

    SELECT ativo, estoque, preco INTO v_ativo, v_estoque, v_preco
    FROM produto WHERE id_produto = p_id_produto FOR UPDATE;
    IF v_ativo IS NULL THEN
        SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Produto inexistente.';
    END IF;
    IF v_ativo = FALSE THEN
        SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Produto inativo.';
    END IF;
    IF p_quantidade IS NULL OR p_quantidade <= 0 THEN
        SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Informe uma quantidade maior que zero.';
    END IF;
    IF v_estoque < p_quantidade THEN
        SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Estoque insuficiente.';
    END IF;
    IF EXISTS (
        SELECT 1 FROM item_pedido
        WHERE id_pedido = p_id_pedido AND id_produto = p_id_produto
    ) THEN
        SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Este produto já está no pedido.';
    END IF;

    INSERT INTO item_pedido (id_pedido, id_produto, quantidade, preco_unitario)
    VALUES (p_id_pedido, p_id_produto, p_quantidade, v_preco);
    COMMIT;
END$$

-- Q6. Confere a existência de itens e usa as duas functions antes de gravar o pagamento.
CREATE PROCEDURE sp_finalizar_pedido(IN p_id_pedido INT)
BEGIN
    DECLARE v_status VARCHAR(10);
    DECLARE v_cliente INT;
    DECLARE v_bruto DECIMAL(10,2);
    DECLARE v_desconto DECIMAL(4,2);
    DECLARE EXIT HANDLER FOR SQLEXCEPTION
    BEGIN
        ROLLBACK;
        RESIGNAL;
    END;

    START TRANSACTION;

    SELECT status, id_cliente INTO v_status, v_cliente
    FROM pedido WHERE id_pedido = p_id_pedido FOR UPDATE;
    IF v_status IS NULL THEN
        SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Pedido inexistente.';
    END IF;
    IF v_status <> 'ABERTO' THEN
        SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Somente pedidos abertos podem ser finalizados.';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM item_pedido WHERE id_pedido = p_id_pedido) THEN
        SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'O pedido precisa ter pelo menos um item.';
    END IF;

    SET v_bruto = fn_total_pedido(p_id_pedido);
    SET v_desconto = fn_desconto_fidelidade(v_cliente);

    UPDATE pedido
    SET desconto_percentual = v_desconto,
        valor_total = ROUND(v_bruto * (1 - v_desconto / 100), 2),
        status = 'PAGO'
    WHERE id_pedido = p_id_pedido;
    COMMIT;
END$$

-- Q7. Um UPDATE por categoria aplica o reajuste. O trigger audita cada preço alterado.
CREATE PROCEDURE sp_reajustar_precos_categoria(
    IN p_id_categoria INT, IN p_percentual DECIMAL(5,2)
)
BEGIN
    IF NOT EXISTS (SELECT 1 FROM categoria WHERE id_categoria = p_id_categoria) THEN
        SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Categoria inexistente.';
    END IF;
    IF p_percentual IS NULL OR p_percentual <= -100 THEN
        SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Informe um percentual maior que -100.';
    END IF;

    UPDATE produto
    SET preco = ROUND(preco * (1 + p_percentual / 100), 2)
    WHERE id_categoria = p_id_categoria;
END$$

-- Q12. NEW é o item inserido. A condição também impede saldo negativo na baixa.
CREATE TRIGGER trg_item_baixa_estoque
AFTER INSERT ON item_pedido
FOR EACH ROW
BEGIN
    UPDATE produto
    SET estoque = estoque - NEW.quantidade
    WHERE id_produto = NEW.id_produto
      AND NEW.quantidade > 0 AND estoque >= NEW.quantidade;
    IF ROW_COUNT() = 0 THEN
        SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Quantidade inválida ou estoque insuficiente para a baixa.';
    END IF;
END$$

-- Q13. OLD guarda a quantidade da linha removida.
CREATE TRIGGER trg_item_devolve_estoque
AFTER DELETE ON item_pedido
FOR EACH ROW
UPDATE produto
SET estoque = estoque + OLD.quantidade
WHERE id_produto = OLD.id_produto$$

-- Q14. A comparação dos preços impede registros de mudanças apenas no estoque.
CREATE TRIGGER trg_produto_historico_preco
AFTER UPDATE ON produto
FOR EACH ROW
BEGIN
    IF OLD.preco <> NEW.preco THEN
        INSERT INTO historico_preco (id_produto, preco_antigo, preco_novo, usuario)
        VALUES (NEW.id_produto, OLD.preco, NEW.preco, CURRENT_USER());
    END IF;
END$$

-- Q15. OLD.status permite ABERTO -> PAGO, mas barra alterações posteriores.
CREATE TRIGGER trg_pedido_bloqueia_alteracao
BEFORE UPDATE ON pedido
FOR EACH ROW
BEGIN
    IF OLD.status IN ('PAGO', 'CANCELADO') THEN
        SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Pedido pago ou cancelado não pode ser alterado.';
    END IF;
END$$

DELIMITER ;

-- Q8. Expõe somente os produtos ativos e reaproveita a função de estoque.
CREATE VIEW vw_cardapio AS
SELECT p.id_produto, c.nome AS categoria, p.nome AS produto, p.preco,
       fn_situacao_estoque(p.id_produto) AS situacao
FROM produto p
JOIN categoria c ON c.id_categoria = p.id_categoria
WHERE p.ativo = TRUE;

-- Q9. Conta linhas de item, uma por produto. COUNT devolve zero no pedido vazio.
CREATE VIEW vw_pedidos_detalhados AS
SELECT p.id_pedido, p.data_pedido, p.status, c.nome AS cliente,
       f.nome AS atendente,
       (SELECT COUNT(*) FROM item_pedido i WHERE i.id_pedido = p.id_pedido) AS qtd_itens,
       fn_total_pedido(p.id_pedido) AS valor_bruto,
       p.desconto_percentual, p.valor_total
FROM pedido p
JOIN cliente c ON c.id_cliente = p.id_cliente
JOIN funcionario f ON f.id_funcionario = p.id_funcionario;

-- Q10. Inclui os ativos esgotados e os que chegaram exatamente ao mínimo.
CREATE VIEW vw_produtos_para_repor AS
SELECT p.id_produto, p.nome AS produto, c.nome AS categoria,
       p.estoque, p.estoque_minimo, p.estoque_minimo - p.estoque AS faltam
FROM produto p
JOIN categoria c ON c.id_categoria = p.id_categoria
WHERE p.ativo = TRUE AND p.estoque <= p.estoque_minimo;

-- Q11. Começa pelas categorias e soma apenas itens de pedidos pagos.
-- O faturamento usa o preço registrado em cada item, antes do desconto.
CREATE VIEW vw_vendas_por_categoria AS
SELECT c.nome AS categoria,
       COALESCE(SUM(CASE WHEN pe.status = 'PAGO' THEN i.quantidade END), 0) AS unidades,
       COALESCE(SUM(CASE WHEN pe.status = 'PAGO'
                         THEN i.quantidade * i.preco_unitario END), 0) AS faturamento
FROM categoria c
LEFT JOIN produto pr ON pr.id_categoria = c.id_categoria
LEFT JOIN item_pedido i ON i.id_produto = pr.id_produto
LEFT JOIN pedido pe ON pe.id_pedido = i.id_pedido
GROUP BY c.id_categoria, c.nome;
