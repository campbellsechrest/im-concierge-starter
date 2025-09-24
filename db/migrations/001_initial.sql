-- Initial database schema for IM Concierge query logging and evaluation storage

-- Query logs table - stores all chat interactions with routing metadata
CREATE TABLE query_logs (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  timestamp TIMESTAMPTZ DEFAULT NOW(),
  user_message TEXT,
  normalized_message TEXT,
  response_answer TEXT,
  routing_layer VARCHAR(20) NOT NULL,
  routing_rule TEXT,
  routing_intent TEXT,
  routing_category TEXT,
  routing_score REAL,
  sources JSONB,
  response_time_ms SMALLINT,
  user_session_id TEXT,
  openai_model VARCHAR(50),
  openai_request_id VARCHAR(100),
  total_tokens INTEGER,
  embedding_cache_hit BOOLEAN,
  environment VARCHAR(20) DEFAULT 'production',
  error_message TEXT,
  api_version VARCHAR(20) DEFAULT '1.0'
);

-- Evaluation results table - stores automated test results
CREATE TABLE eval_results (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  timestamp TIMESTAMPTZ DEFAULT NOW(),
  eval_suite VARCHAR(50) NOT NULL,
  eval_scenario_id VARCHAR(100) NOT NULL,
  question TEXT NOT NULL,
  expectation VARCHAR(20),
  passed BOOLEAN NOT NULL,
  reasons JSONB,
  top_docs JSONB,
  git_commit VARCHAR(40),
  deployment_id VARCHAR(100),
  environment VARCHAR(20) DEFAULT 'production'
);

-- Document retrieval details table - detailed scoring for each document per query
CREATE TABLE retrieval_details (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  query_log_id UUID NOT NULL REFERENCES query_logs(id) ON DELETE CASCADE,
  document_id VARCHAR(100) NOT NULL,
  document_section TEXT,
  similarity_score REAL NOT NULL,
  rank_position INTEGER NOT NULL,
  scope_filtered BOOLEAN DEFAULT FALSE
);

-- Essential indexes for performance
CREATE INDEX idx_query_logs_timestamp ON query_logs(timestamp DESC);
CREATE INDEX idx_query_logs_routing ON query_logs(routing_layer, routing_intent);
CREATE INDEX idx_query_logs_session ON query_logs(user_session_id) WHERE user_session_id IS NOT NULL;
CREATE INDEX idx_query_logs_environment ON query_logs(environment);

CREATE INDEX idx_eval_results_suite_time ON eval_results(eval_suite, timestamp DESC);
CREATE INDEX idx_eval_results_passed ON eval_results(passed);
CREATE INDEX idx_eval_results_commit ON eval_results(git_commit) WHERE git_commit IS NOT NULL;

CREATE INDEX idx_retrieval_similarity ON retrieval_details(similarity_score DESC);
CREATE INDEX idx_retrieval_query_rank ON retrieval_details(query_log_id, rank_position);