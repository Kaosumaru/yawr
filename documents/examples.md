# Examples

## Simple echo server and client

### Server
```ts
import { RPCServer } from 'yawr';

const server = new RPCServer(8080);
server.RegisterFunction("echo", (ctx, data: string) => {
    return data;
});
```

### Client

```ts
import { RPCClient } from 'yawr';

const client = new RPCClient('ws://localhost:8080');
await client.connect();
const response = await client.call('echo', 'hello');
```


## Simple chat server and client

### Server
```ts
import { RPCServer } from 'yawr';

const server = new RPCServer(8080);
server.RegisterFunction("joinRoom", (ctx, roomName: string) => {
    ctx.addToGroup(roomName);
});

server.RegisterFunction("message", (ctx, roomName: string, message: string) => {
    ctx.emitToGroup(roomName, "onMessage", roomName, message);
});
```

### Client

```ts
import { RPCClient } from 'yawr';

const client = new RPCClient('ws://localhost:8080');
await client.connect();
client.on('onMessage', (room: string, message: string) =>
    console.log(`${room}: ${message}`)
);
await client.call('joinRoom', 'room1');
await client.call('message', 'room1', 'Hello world');
```