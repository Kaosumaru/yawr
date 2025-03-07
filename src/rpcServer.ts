import { WebSocketServer, WebSocket } from 'ws';
import { RPCMessage, RPCCall, RPCEvent, UserInfo } from './interface';
import { RPCBase } from './rpcShared';
import { Signal, SignalConnection } from 'typed-signals';

export type CallCallback = (method: string, ...args: any[]) => void;
export interface FilterInfo {
  call: CallCallback;
}

export interface GroupEmitter {
  emitToGroup(group: string, method: string, ...params: any): void;
  iterateGroup(group: string, cb: (context: Context) => void): void;
}

export interface Context extends GroupEmitter {
  ws: WebSocket;
  userId?: string;
  userName?: string;
  isAdmin?: boolean;
  addToGroup(group: string): void;
  removeFromGroup(group: string): void;
  emitToGroup(group: string, method: string, ...params: any): void;
  call(method: string, ...params: any): void;
  iterateGroup(group: string, cb: (context: Context) => void): void;
}

interface SocketData {
  context: Context;
  groups: Set<string>;
}

export class RPCServer extends RPCBase<WebSocket> implements GroupEmitter {
  wss: WebSocketServer;

  constructor(port?: number) {
    super();
    this.wss = new WebSocketServer({ port, noServer: port === undefined });
    this.wss.on('connection', ws => this.onConnection(ws));
  }

  public close(): void {
    this.wss.close();
  }

  public registerJWTAuth(
    authFunction: (token: string) => Promise<UserInfo | undefined>
  ): void {
    this.RegisterFunction(
      'auth',
      async (
        context: Context,
        token: string
      ): Promise<UserInfo | undefined> => {
        const userInfo = await authFunction(token);
        if (!userInfo) return undefined;
        const userData = this.socketData.get(context.ws);
        if (!userData) return undefined;
        userData.context.userId = userInfo.id;
        userData.context.userName = userInfo.name;
        userData.context.isAdmin = userInfo.isAdmin;
        return userInfo;
      }
    );
  }

  public RegisterFunction(
    name: string,
    method: (context: Context, ...args: any[]) => any
  ): void {
    this.functions.set(name, method);
  }

  public RegisterAuthorizedFunction(
    name: string,
    method: (context: Context, ...args: unknown[]) => unknown
  ): void {
    this.functions.set(name, (context: Context, ...args: unknown[]) => {
      if (!context.userId) throw new Error('Not authorized');
      return method(context, ...args);
    });
  }

  public on(
    name: string,
    method: (context: Context, ...args: unknown[]) => void
  ): SignalConnection {
    let signal = this.events.get(name);
    if (!signal) {
      signal = new Signal();
      this.events.set(name, signal);
    }
    return signal.connect(method);
  }

  public onGroupRemoved(group: string, method: (() => void) | undefined): void {
    if (!method) {
      this.groupRemoved.delete(group);
      return;
    }

    this.groupRemoved.set(group, method);
  }

  public groupMemberCount(group: string): number {
    return this.groups.get(group)?.size ?? 0;
  }

  public emitToGroup(
    group: string,
    method: string,
    ...params: unknown[]
  ): void {
    const groupSet = this.groups.get(group);
    if (groupSet) {
      for (const client of groupSet) {
        this.emit(client, method, ...params);
      }
    }
  }

  public iterateGroup(group: string, cb: (ctx: Context) => void): void {
    const groupSet = this.groups.get(group);
    if (groupSet) {
      for (const client of groupSet) {
        const data = this.socketData.get(client);
        if (data) {
          cb(data.context);
        }
      }
    }
  }

  protected onRPCMessage(ws: WebSocket, data: RPCCall): void {
    const method = this.functions.get(data.method);
    if (method) {
      const socketData = this.socketData.get(ws);
      if (!socketData) return;
      try {
        const result = method(socketData.context, ...data.params);
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
    const socketData = this.socketData.get(ws);
    if (!socketData) return;
    const signal = this.events.get(event.method);
    if (signal) {
      signal.emit(socketData.context, ...event.params);
    }
  }

  protected createContext(ws: WebSocket): Context {
    return {
      ws,
      addToGroup: (group: string) => this.addToGroup(ws, group),
      removeFromGroup: (group: string) => this.removeFromGroup(ws, group),
      emitToGroup: (group: string, method: string, ...params: any) => {
        const groupSet = this.groups.get(group);
        if (groupSet) {
          for (const client of groupSet) {
            this.emit(client, method, ...params);
          }
        }
      },
      call: (method: string, ...params: any) =>
        this.emit(ws, method, ...params),
      iterateGroup: (group: string, cb: (ctx: Context) => void) => {
        const groupSet = this.groups.get(group);
        if (groupSet) {
          for (const client of groupSet) {
            const data = this.socketData.get(client);
            if (data) {
              cb(data.context);
            }
          }
        }
      },
    };
  }

  protected onConnection(ws: WebSocket): void {
    this.clients.add(ws);
    this.socketData.set(ws, {
      groups: new Set(),
      context: this.createContext(ws),
    });
    ws.on('error', () => this.onDisconnect(ws));

    ws.on('message', (message: string) => {
      try {
        const data = JSON.parse(message);
        this.onMessage(ws, data);
      } catch (e) {
        this.onDisconnect(ws);
      }
    });
  }

  protected onDisconnect(ws: WebSocket): void {
    this.removeFromAllGroups(ws);
    ws.close();
    this.clients.delete(ws);
    this.socketData.delete(ws);
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

  public addToGroup(ws: WebSocket, group: string): void {
    const socketData = this.socketData.get(ws);
    if (!socketData) return;
    socketData.groups.add(group);

    let groupSet = this.groups.get(group);
    if (!groupSet) {
      groupSet = new Set();
      this.groups.set(group, groupSet);
    }
    groupSet.add(ws);
  }

  public removeFromGroup(ws: WebSocket, group: string): void {
    const socketData = this.socketData.get(ws);
    if (!socketData) return;
    socketData.groups.delete(group);

    const groupSet = this.groups.get(group);
    if (groupSet) {
      groupSet.delete(ws);

      if (groupSet.size === 0) {
        this.deleteGroup(group);
      }
    }
  }

  protected deleteGroup(group: string): void {
    this.groups.delete(group);
    const groupRemoved = this.groupRemoved.get(group);
    if (groupRemoved) {
      groupRemoved();
    }
  }

  public removeFromAllGroups(ws: WebSocket): void {
    const socketData = this.socketData.get(ws);
    if (!socketData) return;
    for (const group of socketData.groups) {
      const groupSet = this.groups.get(group);
      if (groupSet) {
        groupSet.delete(ws);

        if (groupSet.size === 0) {
          this.deleteGroup(group);
        }
      }
    }
    socketData.groups.clear();
  }

  protected socketData: Map<WebSocket, SocketData> = new Map();
  protected clients: Set<WebSocket> = new Set();
  protected groups: Map<string, Set<WebSocket>> = new Map();
  protected events: Map<
    string,
    Signal<(context: Context, ...args: any[]) => void>
  > = new Map();
  protected groupRemoved: Map<string, () => void> = new Map();
  protected functions: Map<string, (context: Context, ...args: any[]) => any> =
    new Map();
}
