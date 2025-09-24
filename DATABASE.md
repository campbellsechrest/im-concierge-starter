# Database Implementation - Phase 1

This document describes the database logging functionality added to the IM Concierge chatbot for auditing, compliance, and performance monitoring.

## Overview

The database implementation stores:
- **Query Logs**: Every chat interaction with routing metadata and response times
- **Evaluation Results**: Automated test results for performance tracking
- **Retrieval Details**: Document similarity scores and rankings

## Features

### Async Logging
- All database operations happen **after** the response is sent to the user
- Zero impact on chat response performance
- Graceful degradation if database is unavailable

### Extractable Architecture
- Database layer designed to be easily extracted for analytics dashboard
- Clean separation between connection, queries, and application logic
- Reusable across multiple projects

## Database Schema

### query_logs
Stores all chat interactions with complete routing metadata:
```sql
- id (UUID, primary key)
- timestamp (timestamptz)
- user_message, normalized_message, response_answer (text)
- routing_layer, routing_rule, routing_intent, routing_category
- routing_score, response_time_ms
- sources (jsonb), openai_model, total_tokens
- environment, git_commit, error_message
```

### eval_results
Stores evaluation test results:
```sql
- id (UUID, primary key)
- eval_suite, eval_scenario_id, question
- passed (boolean), reasons (jsonb), top_docs (jsonb)
- git_commit, deployment_id, environment
```

### retrieval_details
Stores document similarity scores:
```sql
- query_log_id (FK to query_logs)
- document_id, similarity_score, rank_position
- scope_filtered (boolean)
```

## Setup

### 1. Environment Variables
```bash
# Required - Vercel Postgres connection string
DATABASE_URL=your_postgres_connection_string

# Optional - for tracking
VERCEL_ENV=production
DEPLOYMENT_ID=your_deployment_id
```

### 2. Database Initialization
```bash
# Run migrations to create tables
npm run db:migrate
```

### 3. Health Check
Visit `/api/health` to verify database connectivity and view basic metrics.

## File Structure

```
/lib/database/
  ├── connection.js     # Database connection management
  ├── queries.js        # All database operations

/db/migrations/
  └── 001_initial.sql   # Database schema

/api/
  ├── chat.js          # Enhanced with async logging
  └── health.js        # Health check endpoint

/scripts/
  ├── migrate.js       # Migration runner
  └── eval-retrieval.js # Enhanced with result storage
```

## Key Benefits

1. **Compliance**: Full audit trail of all interactions
2. **Performance Monitoring**: Response times, routing patterns, error rates
3. **Model Improvement**: Track document retrieval effectiveness
4. **A/B Testing**: Compare routing threshold changes
5. **Operational Insights**: Database health, query patterns

## Analytics-Ready

The database layer is designed to support a future analytics dashboard:
- Standardized query interface in `/lib/database/queries.js`
- Environment-aware logging for dev/staging/production separation
- Git commit tracking for deployment correlation
- Extractable as npm package or shared module

## Usage

The database logging is automatic once deployed. All chat API calls will be logged asynchronously, and evaluation runs will store results automatically.

Monitor via:
- `/api/health` endpoint for real-time status
- Database queries using the extractable query layer
- Future analytics dashboard