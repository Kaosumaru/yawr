import { RPCClient } from '../src/rpcClient';
import { RPCServer } from '../src/rpcServer';

async function helper(
  cb: (server: RPCServer, client: RPCClient) => Promise<void>
) {
  const server = new RPCServer(8082);
  const client = new RPCClient('ws://localhost:8082');
  try {
    await cb(server, client);
  } finally {
    client.close();
    server.close();
  }
}

describe('examples', () => {
  it('echo should work', async () =>
    helper(async (server, client) => {
      server.RegisterFunction('echo', (_, data: string) => {
        return data;
      });

      await client.connect();
      const response = await client.call('echo', 'hello');
      expect(response).toBe('hello');
    }));

  it('chat should work', async () =>
    helper(async (server, client) => {
      server.RegisterFunction('joinRoom', (ctx, roomName: string) => {
        ctx.addToGroup(roomName);
      });

      server.RegisterFunction(
        'message',
        (ctx, roomName: string, message: string) => {
          ctx.emitToGroup(roomName, 'onMessage', roomName, message);
        }
      );

      let result = '';
      await client.connect();
      client.on('onMessage', (room: string, message: string) => {
        result = `${room}: ${message}`;
      });
      await client.call('joinRoom', 'room1');
      await client.call('message', 'room1', 'Hello world');
      expect(result).toBe('room1: Hello world');
    }));
});
