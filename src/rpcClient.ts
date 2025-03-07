import { RPCMessage, RPCCall, RPCEvent, UserInfo } from './interface';
import { RPCBase } from './rpcShared';
import { Signal, SignalConnection } from 'typed-signals';
import { WebSocket } from 'isomorphic-ws';

export class RPCClient extends RPCBase<WebSocket> {
  private ws: WebSocket;
  private url: string;

  constructor(url: string) {
    super();
    this.url = url;
    this.ws = this.createSocket();
  }

  public connect(): Promise<void> {
    if (this.connected) return Promise.resolve();
    return new Promise<void>((resolve, reject) => {
      this.onConnected.connect(() => resolve());
      this.onDisconnected.connect(() => reject());
    });
  }

  public close(): void {
    this.ws.close();
  }

  public reconnect(): Promise<void> {
    this.connected = false;
    this.ws = this.createSocket();
    return this.connect();
  }

  public async authorize(token: string): Promise<UserInfo | undefined> {
    const response = await this.call<UserInfo | undefined>('auth', token);
    if (response) this.onAuthorized.emit();
    return response;
  }

  public call<T>(method: string, ...params: unknown[]): Promise<T> {
    return super.callRPC(this.ws, method, ...params);
  }

  public RegisterFunction(name: string, method: (...args: any[]) => any): void {
    this.functions.set(name, method);
  }

  public on(name: string, method: (...args: any[]) => void): SignalConnection {
    let signal = this.events.get(name);
    if (!signal) {
      signal = new Signal();
      this.events.set(name, signal);
    }
    return signal.connect(method);
  }

  protected createSocket(): WebSocket {
    const ws = new WebSocket(this.url);
    this.initialize(ws);
    return ws;
  }

  protected onRPCMessage(ws: WebSocket, data: RPCCall): void {
    const method = this.functions.get(data.method);
    if (method) {
      try {
        const result = method(...data.params);
        this.sendResponse(ws, data.id, result);
      } catch (error) {
        let message = 'Unknown Error';
        if (error instanceof Error) message = error.message;
        this.sendError(ws, data.id, message);
      }
      return;
    }
    this.sendError(ws, data.id, `Method '${data.method}' not found`);
  }

  protected onRPCEvent(ws: WebSocket, event: RPCEvent): void {
    const signal = this.events.get(event.method);
    if (signal) {
      signal.emit(...event.params);
    }
  }

  protected initialize(ws: WebSocket): void {
    ws.onopen = () => {
      this.connected = true;
      this.onConnected.emit();
      if (this.wasConnected) this.onReconnected.emit();

      this.wasConnected = true;
    };
    ws.onerror = () => {
      this.disconnect();
    };

    ws.onclose = () => {
      this.disconnect();
    };

    ws.onmessage = event => {
      try {
        const data = JSON.parse(event.data.toString());
        this.onMessage(ws, data);
      } catch (e) {
        this.disconnect();
      }
    };
  }

  public disconnect(): void {
    this.connected = false;
    this.ws.close();
    this.onDisconnected.emit(null);
  }

  protected onMessage(ws: WebSocket, data: RPCMessage): void {
    switch (data.type) {
      case 'rpc':
        this.onRPCMessage(ws, data);
        break;
      case 'rpcResponse':
        this.onRPCResponse(data);
        break;
      case 'rpcEvent':
        this.onRPCEvent(ws, data);
        break;
    }
  }

  protected events: Map<string, Signal<(...args: any[]) => void>> = new Map();
  protected functions: Map<string, (...args: any[]) => any> = new Map();
  onDisconnected = new Signal<(error: any) => void>();
  onConnected = new Signal<() => void>();
  onReconnected = new Signal<() => void>();
  onAuthorized = new Signal<() => void>();
  connected = false;
  wasConnected = false;
}
