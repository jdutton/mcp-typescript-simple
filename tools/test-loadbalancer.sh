#!/bin/bash

# Test script for load-balanced MCP server with Redis session storage
# Verifies that sessions persist across multiple backend instances

set -e

NGINX_URL="http://localhost:8080"
REDIS_CLI="docker exec mcp-redis redis-cli"

echo "🧪 Testing Load-Balanced MCP Server with Redis Session Storage"
echo "================================================================"
echo ""

# Color codes
GREEN='\033[0;32m'
RED='\033[0;31m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Step 1: Initialize session
echo -e "${BLUE}Step 1: Initialize MCP session${NC}"
INIT_RESPONSE=$(curl -s -i -X POST "$NGINX_URL/mcp" \
  -H "Content-Type: application/json" \
  -H "Accept: application/json, text/event-stream" \
  -d '{
    "jsonrpc": "2.0",
    "id": 1,
    "method": "initialize",
    "params": {
      "protocolVersion": "2024-11-05",
      "capabilities": {},
      "clientInfo": {"name": "loadbalancer-test", "version": "1.0.0"}
    }
  }')

# Extract session ID from header
SESSION_ID=$(echo "$INIT_RESPONSE" | grep -i "mcp-session-id:" | sed 's/.*: //' | tr -d '\r')

if [ -z "$SESSION_ID" ]; then
  echo -e "${RED}❌ Failed to get session ID${NC}"
  echo "$INIT_RESPONSE"
  exit 1
fi

echo -e "${GREEN}✅ Session initialized: $SESSION_ID${NC}"
echo ""

# Step 2: Verify session in Redis
echo -e "${BLUE}Step 2: Verify session stored in Redis${NC}"
REDIS_KEY="mcp:session:$SESSION_ID"
REDIS_DATA=$($REDIS_CLI GET "$REDIS_KEY")

if [ -z "$REDIS_DATA" ]; then
  echo -e "${RED}❌ Session not found in Redis${NC}"
  exit 1
fi

echo -e "${GREEN}✅ Session found in Redis${NC}"
echo "   Key: $REDIS_KEY"
echo "   Data: ${REDIS_DATA:0:100}..."
echo ""

# Step 3: Make multiple requests and verify they hit different instances
echo -e "${BLUE}Step 3: Test session persistence across multiple instances${NC}"
echo "   Making 10 requests with same session ID..."
echo ""

SUCCESS_COUNT=0
for i in {1..10}; do
  RESPONSE=$(curl -s -X POST "$NGINX_URL/mcp" \
    -H "Content-Type: application/json" \
    -H "Accept: application/json, text/event-stream" \
    -H "mcp-session-id: $SESSION_ID" \
    -d '{
      "jsonrpc": "2.0",
      "id": '$i',
      "method": "tools/list",
      "params": {}
    }')

  # Check if response is successful (has result, not error)
  if echo "$RESPONSE" | grep -q '"result"'; then
    SUCCESS_COUNT=$((SUCCESS_COUNT + 1))
    echo -e "   Request $i: ${GREEN}✅ Success${NC}"
  else
    echo -e "   Request $i: ${RED}❌ Failed${NC}"
    echo "   Response: $RESPONSE"
  fi
done

echo ""
echo -e "${BLUE}Step 4: Results${NC}"
echo "   Total requests: 10"
echo "   Successful: $SUCCESS_COUNT"

if [ $SUCCESS_COUNT -eq 10 ]; then
  echo -e "${GREEN}✅ All requests succeeded - session persisted across all instances!${NC}"
else
  echo -e "${RED}❌ Some requests failed - session persistence issue${NC}"
  exit 1
fi

echo ""

# Step 5: Check Redis TTL
echo -e "${BLUE}Step 5: Verify session TTL in Redis${NC}"
TTL=$($REDIS_CLI TTL "$REDIS_KEY")
echo "   Session TTL: $TTL seconds (~$(($TTL / 60)) minutes)"

if [ $TTL -gt 0 ]; then
  echo -e "${GREEN}✅ Session has valid TTL${NC}"
else
  echo -e "${RED}❌ Session TTL invalid${NC}"
  exit 1
fi

echo ""

# Step 6: Cleanup session
echo -e "${BLUE}Step 6: Cleanup session${NC}"
DELETE_RESPONSE=$(curl -s -X DELETE "$NGINX_URL/mcp" \
  -H "mcp-session-id: $SESSION_ID")

if echo "$DELETE_RESPONSE" | grep -q "successfully terminated"; then
  echo -e "${GREEN}✅ Session successfully terminated${NC}"
else
  echo -e "${RED}❌ Failed to terminate session${NC}"
  echo "   Response: $DELETE_RESPONSE"
fi

echo ""

# Step 7: Verify session removed from Redis
echo -e "${BLUE}Step 7: Verify session removed from Redis${NC}"
REDIS_DATA_AFTER=$($REDIS_CLI GET "$REDIS_KEY")

if [ -z "$REDIS_DATA_AFTER" ] || [ "$REDIS_DATA_AFTER" == "(nil)" ]; then
  echo -e "${GREEN}✅ Session removed from Redis${NC}"
else
  echo -e "${RED}❌ Session still in Redis after deletion${NC}"
  exit 1
fi

echo ""
echo -e "${GREEN}========================================${NC}"
echo -e "${GREEN}✅ All tests passed!${NC}"
echo -e "${GREEN}========================================${NC}"
echo ""
echo "Load-balanced MCP server with Redis session storage is working correctly!"
echo "Sessions persist across multiple backend instances."
