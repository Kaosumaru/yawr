import { RPCCall, RPCEvent, RPCMessage, RPCResponse } from './interface';

interface ISend {
  send(data: any): void;
}

export class RPCBase<WebSocket extends ISend> {
  protected callRPC<T>(
    ws: WebSocket,
    method: string,
    ...params: unknown[]
  ): Promise<T> {
    return new Promise((resolve, reject) => {
      const id = this.currentID++;
      this.calls.set(id, (result, error) => {
        if (error) {
          reject(new Error(error));
        } else {
          resolve(result);
        }
      });
      const call: RPCCall = { type: 'rpc', id, method, params };
      this.send(ws, call);
    });
  }

  public emit(ws: WebSocket, method: string, ...params: unknown[]): void {
    const call: RPCEvent = { type: 'rpcEvent', method, params };
    this.send(ws, call);
  }

  protected onRPCResponse(resp: RPCResponse): void {
    const call = this.calls.get(resp.id);
    if (call) {
      call(resp.result, resp.error ? resp.result : null);
      this.calls.delete(resp.id);
    }
  }

  protected sendResponse(ws: WebSocket, id: number, result: unknown): void {
    if (result instanceof Promise) {
      result
        .then(res => this.sendResponse(ws, id, res))
        .catch(err => {
          let message = 'Unknown Error';
          if (err instanceof Error) message = err.message;
          this.sendError(ws, id, message);
        });
      return;
    }
    this.send(ws, { type: 'rpcResponse', id, result });
  }

  protected sendError(ws: WebSocket, id: number, error: unknown): void {
    this.send(ws, { type: 'rpcResponse', id, error: true, result: error });
  }

  protected send(ws: WebSocket, message: RPCMessage): void {
    ws.send(JSON.stringify(message));
  }

  protected calls: Map<number, (result: any, error: any) => void> = new Map();
  protected currentID = 0;
}
