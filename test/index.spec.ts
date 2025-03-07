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

describe('index', () => {
  describe('dummy', () => {
    it('should work', async () =>
      helper(async (server, client) => {
        server.RegisterFunction('echo', (_, data: string) => {
          return data;
        });

        await client.connect();
        const response = await client.call('echo', 'hello');
        expect(response).toBe('hello');
      }));
  });
});
