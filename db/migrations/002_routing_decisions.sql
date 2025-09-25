-- Create routing decisions table for detailed routing analysis
-- This tracks every routing layer decision for each query

CREATE TABLE IF NOT EXISTS routing_decisions (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    query_log_id UUID NOT NULL REFERENCES query_logs(id) ON DELETE CASCADE,
    layer VARCHAR(30) NOT NULL,
    rule TEXT,
    intent TEXT,
    category TEXT,
    score REAL,
    triggered BOOLEAN NOT NULL DEFAULT FALSE,
    execution_order INTEGER NOT NULL,
    decision_time TIMESTAMPTZ DEFAULT NOW(),

    -- Additional debug info for analysis
    risk_token_count INTEGER,
    has_product_context BOOLEAN,
    embedding_score REAL
);

-- Indexes for efficient querying
CREATE INDEX IF NOT EXISTS idx_routing_decisions_query_log_id ON routing_decisions(query_log_id);
CREATE INDEX IF NOT EXISTS idx_routing_decisions_layer ON routing_decisions(layer);
CREATE INDEX IF NOT EXISTS idx_routing_decisions_layer_triggered ON routing_decisions(layer, triggered);
CREATE INDEX IF NOT EXISTS idx_routing_decisions_layer_score ON routing_decisions(layer, score) WHERE score IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_routing_decisions_decision_time ON routing_decisions(decision_time);

-- Composite index for tracking routing flows
CREATE INDEX IF NOT EXISTS idx_routing_decisions_flow ON routing_decisions(query_log_id, execution_order);