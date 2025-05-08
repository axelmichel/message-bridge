# MessageBridge

**MessageBridge** is a minimal, type-safe utility to enable communication between a parent window and one or more `<iframe>` elements using the `postMessage` API. It supports both **promise-based requests** and **observable event streams**, with optional support for broadcasting from parent to all iframes.

---

## Features

* Promise and observable request/response messaging
* Bidirectional: Parent ↔ Iframe
* Auto-handshake on iframe connect
* Supports broadcast messaging (parent to all children)

---

## Installation

```bash
npm install message-bridge
```

Or clone locally:

```bash
git clone https://github.com/axelmichel/message-bridge.git
cd message-bridge
npm install
```

---

## Usage

### 1. Setup the bridge (in both parent and iframe)

```ts
import { MessageBridge } from 'message-bridge';

MessageBridge.init();
```

---

### 2. In the **parent window** (main page)

#### Send a Promise-based request to an iframe

```ts
const iframe = document.getElementById('child-frame') as HTMLIFrameElement;

const result = await MessageBridge.toChild(iframe).sendRequest('getTime');
console.log('Time from iframe:', result);
```

#### Subscribe to observable responses

```ts
MessageBridge.toChild(iframe).sendObservable('height').subscribe({
  next: (data) => console.log('Height from iframe:', data),
  complete: () => console.log('Completed'),
});
```

#### Listen for requests *from* iframe

```ts
MessageBridge.toChild(iframe).listenFor('ping').subscribe(({ request }) => {
  // opt. send a response back to the iframe
  MessageBridge.toChild(iframe).respond(request.uid, { pong: true });
});
```

#### Broadcast to all registered iframes

```ts
import {MessageBridge} from "./message-bride";

MessageBridge.connect([iframe1, iframe2]).then(() => {
    MessageBridge.broadcastRequest('refreshData', {force: true}).then(console.log);
    MessageBridge.broadcastObservable('tickStream').subscribe(({iframeId, value}) => {
        console.log(`Tick from ${iframeId}:`, value);
    });
});

```

---

### 3. In the **iframe(s)**

#### Send request to parent

```ts
const result = await MessageBridge.toParent().sendRequest('getConfig');
console.log('Parent config:', result);
```

#### listen to observable stream

```ts
MessageBridge.toParent().listenFor(event).subscribe(({ event }) => {
    // opt. send a response back to the parent
    MessageBridge.toParent().respond(request.uid, { ... });
});
```

---

## Testing

Run all tests:

```bash
npm test
```

Or use the playground:

```bash
npm run dev:playground
```

Then open `http://localhost:5173/` in your browser.