import { RPCMessage, RPCCall, RPCEvent, UserInfo } from './interface';
import { RPCBase } from './rpcShared';
import { Signal, SignalConnection } from 'typed-signals';
import { WebSocket as IsoWebSocket } from 'isomorphic-ws';

/**
 * Class to create a client for the RPC server.
 * This can be used in the browser or in Node.js.
 */

type Socket = IsoWebSocket | WebSocket;
export class RPCClient extends RPCBase<Socket> {
  private ws: Socket;
  private url: string;

  /**
   * Creates an instance of the RPC client.
   *
   * @param url - The URL of the WebSocket server to connect to.
   */
  constructor(url: string) {
    super();
    this.url = url;
    this.ws = this.createSocket();
  }

  /**
   * Establishes a connection if not already connected.
   *
   * @returns {Promise<void>} A promise that resolves when the connection is successfully established,
   *                          or rejects if the connection isn't correctly estabilished.
   */
  public connect(): Promise<void> {
    if (this.connected) return Promise.resolve();
    return new Promise<void>((resolve, reject) => {
      this.onConnected.connect(() => resolve());
      this.onDisconnected.connect(() => reject());
    });
  }

  /**
   * Closes the connection to the server.
   */
  public close(): void {
    this.ws.close();
  }

  /**
   * Reconnects to the server.
   *
   * @returns {Promise<void>} A promise that resolves when the connection is successfully reestablished,
   *                          or rejects if the connection isn't correctly reestablished
   */
  public reconnect(): Promise<void> {
    this.connected = false;
    this.ws = this.createSocket();
    return this.connect();
  }

  /**
   * Authorizes the connection with the given token.
   *
   * @param token - The token to authorize the user with.
   * @returns {Promise<UserInfo | undefined>} A promise that resolves with the user info if the user is authorized,
   *                                          or rejects if the user is not authorized.
   */
  public async authorize(token: string): Promise<UserInfo | undefined> {
    const response = await this.call<UserInfo | undefined>('auth', token);
    if (response) this.onAuthorized.emit();
    return response;
  }

  /**
   * Calls a method on the server.
   *
   * @param method - The method to call on the server.
   * @param params - The parameters to pass to the method.
   * @returns {Promise<T>} A promise that resolves with the result of the method call,
   *                       or rejects if the method call fails (throws an exception, for example).
   */
  public call<T>(method: string, ...params: unknown[]): Promise<T> {
    return super.callRPC(this.ws, method, ...params);
  }

  /**
   * Registers a function with a given name. Server can use call<T> method to call this function.
   *
   * @param name - The name of the function to register.
   * @param method - The function to be registered, which can take any number of arguments and return any type.
   */
  public RegisterFunction(name: string, method: (...args: any[]) => any): void {
    this.functions.set(name, method);
  }

  /**
   * Registers an event listener for the specified event name.
   * The method will be called whenever the event is emitted by server.
   *
   * @param name - The name of the event to listen for.
   * @param method - The callback function to be executed when the event is triggered.
   * @returns A SignalConnection object that can be used to manage the connection.
   */
  public on(name: string, method: (...args: any[]) => void): SignalConnection {
    let signal = this.events.get(name);
    if (!signal) {
      signal = new Signal();
      this.events.set(name, signal);
    }
    return signal.connect(method);
  }

  protected createSocket(): Socket {
    let ws: Socket;
    if (window !== undefined && window.WebSocket !== undefined) {
      ws = new WebSocket(this.url);
    } else {
      ws = new IsoWebSocket(this.url);
    }

    this.initialize(ws);
    return ws;
  }

  protected onRPCMessage(ws: Socket, data: RPCCall): void {
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

  protected onRPCEvent(ws: Socket, event: RPCEvent): void {
    const signal = this.events.get(event.method);
    if (signal) {
      signal.emit(...event.params);
    }
  }

  protected initialize(ws: Socket): void {
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

    if (ws instanceof WebSocket) {
      ws.onmessage = event => {
        try {
          const data = JSON.parse(event.data);
          this.onMessage(ws, data);
        } catch (e) {
          this.disconnect();
        }
      };
    } else {
      ws.onmessage = event => {
        try {
          const data = JSON.parse(event.data.toString());
          this.onMessage(ws, data);
        } catch (e) {
          this.disconnect();
        }
      };
    }
  }

  public disconnect(): void {
    this.connected = false;
    this.ws.close();
    this.onDisconnected.emit(null);
  }

  protected onMessage(ws: Socket, data: RPCMessage): void {
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
