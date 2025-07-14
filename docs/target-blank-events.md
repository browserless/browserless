# Target="_blank" Events WebSocket API

The `/events` WebSocket endpoint provides real-time notifications when new tabs are created via `target="_blank"` links in headless browser sessions.

## Connection

```javascript
const ws = new WebSocket('ws://localhost:3000/events?token=YOUR_TOKEN');

ws.onopen = () => {
  console.log('Connected to events stream');
};

ws.onmessage = (event) => {
  const message = JSON.parse(event.data);
  console.log('Received event:', message);
};
```

## Event Types

### Connection Confirmation
```json
{
  "type": "connected",
  "timestamp": 1752489300000,
  "message": "Events stream connected successfully"
}
```

### Target Created Event
```json
{
  "type": "targetCreated",
  "timestamp": 1752489301000,
  "data": {
    "id": "page-target-id",
    "url": "https://example.com/new-page",
    "title": "",
    "createdAt": 1752489301000,
    "createdBy": "target_blank",
    "sessionId": "browser-session-id",
    "webSocketDebuggerUrl": "ws://localhost:3000/devtools/page/page-target-id"
  }
}
```

## Usage Examples

### Basic Event Monitoring
```javascript
const ws = new WebSocket('ws://localhost:3000/events?token=YOUR_TOKEN');

ws.onmessage = (event) => {
  const message = JSON.parse(event.data);
  
  if (message.type === 'targetCreated') {
    console.log(`New tab created: ${message.data.url}`);
    
    const pageWs = new WebSocket(message.data.webSocketDebuggerUrl);
  }
};
```

### OAuth Flow Handling
```javascript
const ws = new WebSocket('ws://localhost:3000/events?token=YOUR_TOKEN');

ws.onmessage = (event) => {
  const message = JSON.parse(event.data);
  
  if (message.type === 'targetCreated' && 
      (message.data.url.includes('oauth') || 
       message.data.url.includes('login'))) {
    
    console.log('OAuth popup detected:', message.data.url);
    
    const pageWs = new WebSocket(message.data.webSocketDebuggerUrl);
    pageWs.onopen = () => {
    };
  }
};
```

### Integration with Puppeteer
```javascript
const puppeteer = require('puppeteer');
const WebSocket = require('ws');

async function handleTargetBlankFlow() {
  const browser = await puppeteer.connect({
    browserWSEndpoint: 'ws://localhost:3000/chrome'
  });
  
  const ws = new WebSocket('ws://localhost:3000/events?token=YOUR_TOKEN');
  
  ws.onmessage = async (event) => {
    const message = JSON.parse(event.data);
    
    if (message.type === 'targetCreated') {
      const pages = await browser.pages();
      const newPage = pages.find(p => p.url() === message.data.url);
      
      if (newPage) {
        console.log('Connected to new page:', await newPage.title());
      }
    }
  };
}
```

## Error Handling

```javascript
const ws = new WebSocket('ws://localhost:3000/events?token=YOUR_TOKEN');

ws.onerror = (error) => {
  console.error('WebSocket error:', error);
};

ws.onclose = (event) => {
  console.log('Connection closed:', event.code, event.reason);
  
  setTimeout(() => {
  }, 5000);
};
```
