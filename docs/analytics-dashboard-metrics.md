# Analytics Dashboard Metrics Specification

*For UX/UI Designer - IM Concierge Analytics Dashboard*

## Overview

This document provides a structured specification of all available metrics from the IM Concierge analytics system. The data is organized into logical dashboard sections with clear explanations of what each metric means and how it should be visualized.

**Core Purpose**: Track performance of the layered intent router system and show how queries are being handled at each routing layer.

---

## Section 1: System Overview (Top KPI Cards)
*Primary metrics for executive overview - display prominently at top of dashboard*

| **Backend Metric** | **API Endpoint** | **Display Label** | **Business Description** | **Suggested Visual** |
|-------------------|------------------|-------------------|-------------------------|---------------------|
| `totalQueries` | `/api/analytics?type=summary` | **Total Queries** | Count of all user interactions with chatbot in selected time period | Large number card with trend arrow |
| `errorRate` | `/api/analytics?type=summary` | **Success Rate** | Percentage of queries completed successfully (100% - error_rate). Target: >99% | Percentage with color coding (green >95%, yellow 90-95%, red <90%) |
| `avgResponseTime` | `/api/analytics?type=summary` | **Avg Response Time** | Average time for chatbot to respond to user questions | Time display in seconds with trend line |
| `totalCost` | `/api/analytics?type=summary` | **Operating Cost** | Total OpenAI API costs for embeddings + chat completions | Dollar amount with cost-per-query calculation |

---

## Section 2: Intent Router Performance (Main Dashboard Focus)
*Core functionality showing how the layered routing system distributes and handles queries*

### 2A: Routing Layer Distribution
*Show how queries flow through the 6-layer routing system*

| **Backend Metric** | **API Endpoint** | **Display Label** | **Business Description** | **Suggested Visual** |
|-------------------|------------------|-------------------|-------------------------|---------------------|
| `layers[].queryCount` | `/api/analytics?type=layers` | **Queries by Layer** | Number of queries handled by each routing layer | Horizontal bar chart or donut chart |
| `layers[].layer` | `/api/analytics?type=layers` | **Layer Names** | Routing layer labels with descriptions:<br>• `safety-regex`: Hard safety blocks (emergencies, pregnancy)<br>• `safety-embed`: AI-powered safety filtering<br>• `business-regex`: Keyword routing (shipping, returns)<br>• `semantic-intent`: AI intent classification<br>• `rag-fallback`: Full knowledge base search | Layer labels with distinctive icons and colors |
| `layers[].avgResponseTime` | `/api/analytics?type=layers` | **Response Time by Layer** | Performance comparison across routing layers | Horizontal bar comparison chart |
| `layers[].errorRate` | `/api/analytics?type=layers` | **Reliability by Layer** | Error rate for each routing layer | Color-coded percentages (green <1%, yellow 1-5%, red >5%) |

### 2B: Router Efficiency Analysis
*Key performance indicators for the routing system*

| **Backend Metric** | **Calculation** | **Display Label** | **Business Description** | **Suggested Visual** |
|-------------------|-----------------|-------------------|-------------------------|---------------------|
| `layers[].totalCost` | `/api/analytics?type=costs` | **Cost by Layer** | OpenAI API costs broken down by routing layer | Stacked cost chart showing layer contribution |
| Deterministic layers / total | `(safety-regex + business-regex) / totalQueries * 100` | **Deterministic Resolution Rate** | % of queries resolved without AI processing. Higher = more efficient | Large percentage highlight (target: >70%) |
| `rag-fallback / totalQueries` | `rag-fallback count / total * 100` | **AI Fallback Rate** | % requiring full knowledge base search. Lower = better routing | Percentage with trend arrow (target: <30%) |

---

## Section 3: Safety & Compliance Monitoring
*Critical for regulated supplement industry - FDA/DSHEA compliance tracking*

| **Backend Metric** | **API Endpoint** | **Display Label** | **Business Description** | **Suggested Visual** |
|-------------------|------------------|-------------------|-------------------------|---------------------|
| `safetyRefusals[].refusalCount` | `/api/analytics?type=safety` | **Safety Refusals** | Count of queries blocked by safety systems | Bar chart by refusal category |
| `safetyRefusals[].category` | `/api/analytics?type=safety` | **Refusal Categories** | Types of safety blocks:<br>• `pregnancy`: Pregnancy/breastfeeding queries<br>• `emergency`: 911/medical emergency blocks<br>• `medication`: Drug interaction warnings<br>• `medical-advice`: Healthcare recommendations | Category breakdown with explanations |
| `safetyRefusals[].rule` | `/api/analytics?type=safety` | **Safety Rules Triggered** | Specific safety rule that fired (for compliance audits) | Detailed expandable list |
| `totalRefusals / totalQueries` | Calculated from safety data | **Safety Block Rate** | % of all queries blocked for safety reasons | Percentage with threshold monitoring (alert if >5%) |

---

## Section 4: Cost Analysis & Optimization
*Financial tracking and OpenAI API usage optimization*

### 4A: Cost Breakdown
| **Backend Metric** | **API Endpoint** | **Display Label** | **Business Description** | **Suggested Visual** |
|-------------------|------------------|-------------------|-------------------------|---------------------|
| `embeddingTokens * $0.02/1M` | `/api/analytics?type=costs` | **Embedding Costs** | Cost for vector similarity calculations (text-embedding-3-small) | Dollar amount with tokens/cost breakdown |
| `completionTokens * pricing` | `/api/analytics?type=costs` | **Chat Completion Costs** | Cost for GPT-4o-mini responses ($0.15 input, $0.60 output per 1M tokens) | Dollar amount split by input/output |
| `totalApiCalls` | `/api/analytics?type=costs` | **API Call Volume** | Total OpenAI API requests made | Count with calls/query efficiency ratio |
| `avgCostPerQuery` | `/api/analytics?type=costs` | **Cost Per Query** | Average OpenAI cost per user interaction | Dollar amount with trend over time |

### 4B: Cost Optimization Insights
| **Backend Metric** | **Calculation** | **Display Label** | **Business Description** | **Suggested Visual** |
|-------------------|-----------------|-------------------|-------------------------|---------------------|
| `embeddingTokens / totalQueries` | Calculated average | **Avg Embedding Tokens/Query** | Efficiency of vector operations | Token count trend with optimization opportunities |
| Layer cost ranking | From cost breakdown | **Most Expensive Layers** | Which routing layers consume the most API credits | Cost ranking table with optimization suggestions |

---

## Section 5: Performance & Reliability
*Technical performance monitoring and SLA tracking*

| **Backend Metric** | **API Endpoint** | **Display Label** | **Business Description** | **Suggested Visual** |
|-------------------|------------------|-------------------|-------------------------|---------------------|
| `p95ResponseTime` | `/api/analytics?type=summary` | **95th Percentile Response** | Worst-case response time (95% of queries complete faster) | Time chart with SLA threshold line (target: <3s) |
| `executionTimeMs` | `/api/analytics?type=performance` | **Layer Processing Time** | How long each routing layer takes to execute | Performance comparison bars |
| `apiLatency` | `/api/analytics?type=performance` | **OpenAI API Latency** | Network delay for OpenAI API calls | Latency trend chart over time |
| `errorCount` | `/api/analytics?type=summary` | **System Errors** | Technical failures requiring investigation | Error count with alert thresholds |

---

## Section 6: Usage Patterns & Business Intelligence
*Insights for content optimization and user behavior*

| **Backend Metric** | **API Endpoint** | **Display Label** | **Business Description** | **Suggested Visual** |
|-------------------|------------------|-------------------|-------------------------|---------------------|
| `totalQueries` by hour | `/api/analytics?type=summary` (time-based) | **Traffic Patterns** | When users are most active with the chatbot | Time series chart showing hourly/daily patterns |
| `routing_intent` breakdown | Query logs analysis | **Top Question Types** | Most common user intents (dosage, shipping, product info) | Intent ranking with query examples |
| `similarity_score` distribution | `/api/analytics?type=trace` | **Knowledge Base Match Quality** | How well knowledge documents match user questions | Score distribution histogram |
| Recent queries | `/api/analytics` overview | **Live Activity Feed** | Most recent user interactions (anonymized) | Real-time scrolling list with routing info |

---

## Dashboard Layout Recommendations

### **Visual Hierarchy**
1. **Header Section**:
   - Time range selector (24h, 7d, 30d buttons)
   - Environment indicator (Production/Development)
   - Last updated timestamp

2. **Top KPI Row**: 4 large metric cards (Total Queries, Success Rate, Avg Response, Cost)

3. **Main Content Area**:
   - Large routing layer breakdown visualization (donut chart + bar chart)
   - Shows the 6-layer flow with query counts and percentages

4. **Secondary Metrics Grid**: 2x3 layout
   - Safety & Compliance (top priority for regulation)
   - Cost Analysis & Optimization
   - Performance & Reliability
   - Usage Patterns & Insights

5. **Detail Panel**: Expandable/collapsible section
   - Individual query traces
   - Detailed breakdowns and drill-downs
   - Administrative controls

### **Color Coding System**
- **🟢 Green**: Deterministic routing layers (safety-regex, business-regex) - efficient, no AI cost
- **🔵 Blue**: AI-powered routing layers (safety-embed, semantic-intent) - moderate cost
- **🟠 Orange**: Fallback processing (rag-fallback) - highest cost, full AI processing
- **🔴 Red**: Errors, safety blocks, and alerts
- **⚫ Gray**: Neutral/informational metrics

### **Data Refresh Strategy**
- **Real-time**: KPI cards, error counts, live activity feed
- **5-minute intervals**: Performance metrics, cost tracking
- **Hourly**: Historical trends, usage patterns
- **Daily**: Compliance reports, optimization insights

---

## API Integration Guide

### **Primary Endpoints**
```bash
# System overview metrics
GET /api/analytics?type=summary&hours=24

# Routing layer performance
GET /api/analytics?type=layers&hours=24

# Cost analysis
GET /api/analytics?type=costs&hours=24

# Safety compliance
GET /api/analytics?type=safety&hours=24

# Performance monitoring
GET /api/analytics?type=performance&hours=24

# Individual query trace
GET /api/analytics?type=trace&queryId=<id>
```

### **Response Format Examples**
```json
// Summary metrics response
{
  "success": true,
  "data": {
    "totalQueries": 1247,
    "errorRate": "0.8",
    "avgResponseTime": 892,
    "p95ResponseTime": 1456,
    "totalCost": 2.47,
    "environment": "production"
  }
}

// Layer breakdown response
{
  "success": true,
  "data": {
    "layers": [
      {
        "layer": "business-regex",
        "queryCount": 456,
        "avgResponseTime": 234,
        "totalCost": 0.00,
        "errorRate": "0.0"
      },
      {
        "layer": "semantic-intent",
        "queryCount": 342,
        "avgResponseTime": 567,
        "totalCost": 1.23,
        "errorRate": "0.3"
      }
    ]
  }
}
```

---

## Success Metrics & Goals

### **Operational Targets**
- **Success Rate**: >99% (error rate <1%)
- **Response Time**: <2s average, <3s 95th percentile
- **Deterministic Resolution**: >70% of queries handled without AI
- **Cost Efficiency**: <$0.005 per query
- **Safety Coverage**: 100% of medical/emergency queries blocked

### **Business Intelligence Goals**
- Identify most common user question types for content optimization
- Track seasonal patterns in query volume and types
- Monitor safety compliance for FDA/DSHEA requirements
- Optimize routing rules to reduce AI processing costs
- Improve knowledge base based on low-scoring retrievals

This specification provides all the data and context needed to create an effective analytics dashboard that showcases the intent router's performance while providing actionable business insights.