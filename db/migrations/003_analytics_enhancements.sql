-- Analytics Enhancements: Cost tracking and performance metrics
-- Adds critical fields needed for comprehensive dashboard analytics

-- Add cost tracking fields to query_logs
ALTER TABLE query_logs ADD COLUMN IF NOT EXISTS embedding_tokens INTEGER;
ALTER TABLE query_logs ADD COLUMN IF NOT EXISTS chat_completion_tokens INTEGER;
ALTER TABLE query_logs ADD COLUMN IF NOT EXISTS estimated_cost DECIMAL(10,6);
ALTER TABLE query_logs ADD COLUMN IF NOT EXISTS api_calls_count INTEGER DEFAULT 1;

-- Add timing breakdown fields to routing_decisions
ALTER TABLE routing_decisions ADD COLUMN IF NOT EXISTS execution_time_ms INTEGER;
ALTER TABLE routing_decisions ADD COLUMN IF NOT EXISTS api_latency_ms INTEGER;

-- Create aggregation table for dashboard performance
CREATE TABLE IF NOT EXISTS metrics_hourly (
    metric_hour TIMESTAMPTZ PRIMARY KEY,
    total_queries INTEGER NOT NULL DEFAULT 0,
    total_cost DECIMAL(10,4) NOT NULL DEFAULT 0,
    total_tokens INTEGER NOT NULL DEFAULT 0,
    total_api_calls INTEGER NOT NULL DEFAULT 0,
    avg_response_time REAL NOT NULL DEFAULT 0,
    p95_response_time REAL NOT NULL DEFAULT 0,
    error_count INTEGER NOT NULL DEFAULT 0,

    -- Layer distribution as JSONB for flexibility
    layer_breakdown JSONB NOT NULL DEFAULT '{}',

    -- Intent distribution
    intent_breakdown JSONB NOT NULL DEFAULT '{}',

    -- Safety metrics
    safety_refusals INTEGER NOT NULL DEFAULT 0,
    safety_categories JSONB NOT NULL DEFAULT '{}',

    environment VARCHAR(20) NOT NULL DEFAULT 'development',
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Create composite indexes for dashboard performance
CREATE INDEX IF NOT EXISTS idx_query_logs_hour_layer
ON query_logs(date_trunc('hour', timestamp), routing_layer);

CREATE INDEX IF NOT EXISTS idx_query_logs_cost_analysis
ON query_logs(timestamp, estimated_cost) WHERE estimated_cost IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_routing_decisions_timing
ON routing_decisions(query_log_id, execution_time_ms) WHERE execution_time_ms IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_routing_decisions_layer_triggered
ON routing_decisions(layer, triggered, execution_order);

-- Index for metrics table queries
CREATE INDEX IF NOT EXISTS idx_metrics_hourly_time_env
ON metrics_hourly(metric_hour, environment);

-- Add updated_at trigger for metrics table
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ language 'plpgsql';

CREATE TRIGGER update_metrics_hourly_updated_at
BEFORE UPDATE ON metrics_hourly
FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- Comments for documentation
COMMENT ON COLUMN query_logs.embedding_tokens IS 'Token count for embedding API calls';
COMMENT ON COLUMN query_logs.chat_completion_tokens IS 'Token count for chat completion API calls';
COMMENT ON COLUMN query_logs.estimated_cost IS 'Estimated cost in USD for this query';
COMMENT ON COLUMN query_logs.api_calls_count IS 'Total number of API calls made for this query';

COMMENT ON COLUMN routing_decisions.execution_time_ms IS 'Time spent processing this routing layer in milliseconds';
COMMENT ON COLUMN routing_decisions.api_latency_ms IS 'Network latency for API calls in this layer';

COMMENT ON TABLE metrics_hourly IS 'Hourly aggregated metrics for dashboard performance';
COMMENT ON COLUMN metrics_hourly.layer_breakdown IS 'JSON object with query counts per routing layer';
COMMENT ON COLUMN metrics_hourly.intent_breakdown IS 'JSON object with query counts per intent';
COMMENT ON COLUMN metrics_hourly.safety_categories IS 'JSON object with safety refusal counts by category';