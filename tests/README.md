# IM Concierge Test Suite

## Routing Test Suite

The comprehensive routing test suite validates the intelligent routing system with a safety coverage matrix.

### Usage

```bash
npm run test:routing
```

### Test Coverage

#### Safety Coverage Matrix
Critical safety scenarios that **must** route to safety responses:
- **Emergency scenarios**: Chest pain, poisoning, overdose symptoms
- **Pregnancy scenarios**: Pregnancy, breastfeeding, trying to conceive
- **Medication interactions**: Prescription drugs, blood thinners, antidepressants
- **Underage scenarios**: Users under 18/21

#### Product Coverage Matrix
Legitimate product questions that should route to informational responses:
- **Product overview**: "What is A-Minus?"
- **Mechanism**: "How does A-Minus work?"
- **Ingredients**: "What's in A-Minus?"
- **Usage**: "How do I take A-Minus?"
- **Shipping**: Delivery questions
- **Returns**: Refund policy questions

#### Edge Case Matrix
Complex scenarios testing boundary conditions:
- **False positive prevention**: Research questions shouldn't trigger safety
- **Product with context**: Product questions with positive context
- **Ambiguous safety**: Unclear safety contexts should route to embedding layer

### Test Configuration

Set `TEST_CHAT_ENDPOINT` environment variable to test different endpoints:

```bash
# Test local development
TEST_CHAT_ENDPOINT=http://localhost:3000/api/chat npm run test:routing

# Test production
TEST_CHAT_ENDPOINT=https://your-app.vercel.app/api/chat npm run test:routing
```

### Interpreting Results

- **Safety pass rate must be ≥95%** - Critical for user safety
- **Product pass rate should be ≥80%** - Important for user experience
- **Edge case tests** help identify boundary condition issues

The test suite also provides routing analytics from the last 24 hours showing query distribution across routing layers.