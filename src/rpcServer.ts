import { WebSocketServer, WebSocket } from 'ws';
import { RPCMessage, RPCCall, RPCEvent, UserInfo } from './interface';
import { RPCBase } from './rpcShared';
import { Signal, SignalConnection } from 'typed-signals';
import { ServerUsers } from './serverUsers';
import { Duplex } from 'stream';
import { IncomingMessage } from 'http';

export type CallCallback = (method: string, ...args: any[]) => void;
export interface FilterInfo {
  call: CallCallback;
}

/**
 * Interface representing a group emitter that can emit events to a group and iterate over a group.
 */
export interface GroupEmitter {
  /**
   * Emits an event to a specified group.
   *
   * @param group - The name of the group to emit the event to.
   * @param method - The method name to be called on the group.
   * @param params - Additional parameters to be passed to the method.
   */
  emitToGroup(group: string, method: string, ...params: any): void;

  /**
   * Iterates over a specified group and executes a callback function for each context.
   *
   * @param group - The name of the group to iterate over.
   * @param cb - The callback function to be executed for each context.
   */
  iterateGroup(group: string, cb: (context: Context) => void): void;
}

/**
 * Represents the context for a WebSocket connection, extending the capabilities of a GroupEmitter.
 * Provides methods for managing group memberships and emitting events to groups.
 */
export interface Context extends GroupEmitter {
  /**
   * The optional user ID associated with this context.
   */
  userId?: string;
  /**
   * The optional user name associated with this context.
   */
  userName?: string;
  /**
   * Indicates whether the user is an admin.
   */
  isAdmin?: boolean;

  /**
   * Adds the websocket from this context to the specified group.
   * @param group - The name of the group to add the context to.
   */
  addToGroup(group: string): void;

  /**
   * Removes the websocket from this context from the specified group.
   * @param group - The name of the group to remove the context from.
   */
  removeFromGroup(group: string): void;

  /**
   * Emits an event with the specified parameters to the caller.
   * @param method - The method name to call.
   * @param params - The parameters to pass with the method call.
   */
  emit(method: string, ...params: any): void;
}

interface ServerContext extends Context {
  ws: WebSocket;
}

interface SocketData {
  context: ServerContext;
  groups: Set<string>;
  lastPing: number;
  lastPong: number;
  timeout?: NodeJS.Timeout;
}

/**
 * The `RPCServer` class extends `RPCBase` and implements `GroupEmitter` to provide
 * a WebSocket-based RPC server with group management and JWT authentication support.
 *
 * @template WebSocket - The WebSocket type used by the server.
 */
export class RPCServer extends RPCBase<WebSocket> implements GroupEmitter {
  /**
   * The WebSocket server instance.
   */
  protected wss: WebSocketServer;

  /**
   * Creates an instance of `RPCServer`.
   *
   * @param port - The port number to listen on. If not provided, the server will operate in noServer mode.
   */
  constructor(port?: number) {
    super();
    this.wss = new WebSocketServer({ port, noServer: port === undefined });
    this.wss.on('connection', ws => this.onConnection(ws));
  }

  /**
   * Closes the WebSocket server.
   */
  public close(): void {
    this.wss.close();
  }

  /**
   * Forwards the upgrade request to the WebSocket server.
   * Useful if you have an existing HTTP server and want to handle WebSocket upgrades.
   */
  public handleUpgrade(
    request: IncomingMessage,
    socket: Duplex,
    upgradeHead: Buffer,
    callback: (client: WebSocket, request: IncomingMessage) => void
  ): void {
    this.wss.handleUpgrade(request, socket, upgradeHead, callback);
  }

  /**
   * Registers a JWT authentication function.
   *
   * @param authFunction - A function that takes a JWT token and returns a `UserInfo` object or `undefined`.
   */
  public registerJWTAuth(
    authFunction: (token: string) => Promise<UserInfo | undefined>
  ): void {
    this.RegisterInternalFunction(
      'auth',
      async (
        context: ServerContext,
        token: string
      ): Promise<UserInfo | undefined> => {
        const userInfo = await authFunction(token);
        if (!userInfo) return undefined;
        const userData = this.socketData.get(context.ws);
        if (!userData) return undefined;

        if (userData.context.userId) {
          this.users.userDisconnected(userData.context.userId);
        }

        userData.context.userId = userInfo.id;
        userData.context.userName = userInfo.name;
        userData.context.isAdmin = userInfo.isAdmin;
        this.users.userConnected(userData.context.userId);

        return userInfo;
      }
    );
  }

  /**
   * Registers an RPC function.
   *
   * @param name - The name of the RPC function.
   * @param method - The function to be registered.
   */
  public RegisterFunction(
    name: string,
    method: (context: Context, ...args: any[]) => any
  ): void {
    this.functions.set(name, method);
  }

  /**
   * Helper to register an authorized RPC function that requires user authentication.
   *
   * @param name - The name of the RPC function.
   * @param method - The function to be registered.
   */
  public RegisterAuthorizedFunction(
    name: string,
    method: (context: Context, ...args: unknown[]) => unknown
  ): void {
    this.functions.set(name, (context: Context, ...args: unknown[]) => {
      if (!context.userId) throw new Error('Not authorized');
      return method(context, ...args);
    });
  }

  /**
   * Registers an event listener.
   *
   * @param name - The name of the event.
   * @param method - The function to be called when the event is emitted.
   * @returns A `SignalConnection` object.
   */
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

  /**
   * Registers a listener for changes in the user's connection status.
   *
   * @param user - The username to monitor for connection status changes.
   * @param listener - A callback function that is invoked when the user's connection status changes.
   *                    The callback receives a boolean parameter indicating whether the user is connected (true) or disconnected (false).
   * @returns A function that can be called to remove the listener.
   */
  public onUserStatus(
    user: string,
    listener: (connected: boolean) => void
  ): () => void {
    return this.users.addListener(user, listener);
  }

  /**
   * Registers a callback to be called when a group is removed.
   *
   * @param group - The name of the group.
   * @param method - The callback function to be called when the group is removed.
   */
  public onGroupRemoved(group: string, method: (() => void) | undefined): void {
    if (!method) {
      this.groupRemoved.delete(group);
      return;
    }

    this.groupRemoved.set(group, method);
  }

  /**
   * Returns the number of members in a group.
   *
   * @param group - The name of the group.
   * @returns The number of members in the group.
   */
  public groupMemberCount(group: string): number {
    return this.groups.get(group)?.size ?? 0;
  }

  /**
   * Emits an event to all members of a group.
   *
   * @param group - The name of the group.
   * @param method - The name of the RPC method.
   * @param params - The parameters to be passed to the RPC method.
   */
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

  /**
   * Iterates over all members of a group and calls a callback function for each member.
   *
   * @param group - The name of the group.
   * @param cb - The callback function to be called for each member.
   */
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

  protected RegisterInternalFunction(
    name: string,
    method: (context: ServerContext, ...args: any[]) => any
  ): void {
    this.functions.set(name, method);
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

  protected createContext(ws: WebSocket): ServerContext {
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
      emit: (method: string, ...params: any) =>
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

  protected pingClient(ws: WebSocket, data: SocketData): void {
    this.send(ws, { type: 'ping' });
    data.lastPing = Date.now();
    data.timeout = setTimeout(() => {
      if (data.lastPong < data.lastPing) {
        ws.close();
        this.onDisconnect(ws);
      } else {
        this.pingClient(ws, data);
      }
    }, this.pingTimeout);
  }

  protected onConnection(ws: WebSocket): void {
    this.clients.add(ws);
    const data: SocketData = {
      groups: new Set(),
      context: this.createContext(ws),
      lastPing: 0,
      lastPong: 0,
    };
    this.socketData.set(ws, data);

    this.pingClient(ws, data);

    ws.on('message', (message: string) => {
      try {
        const data = JSON.parse(message);
        this.onMessage(ws, data);
      } catch (e) {
        this.onDisconnect(ws);
      }
    });

    ws.on('error', () => this.onDisconnect(ws));
    ws.on('close', () => this.onDisconnect(ws));
  }

  protected onDisconnect(ws: WebSocket): void {
    const data = this.socketData.get(ws);
    if (!data) {
      return;
    }

    if (data.context.userId) {
      this.users.userDisconnected(data.context.userId);
    }

    if (data.timeout) {
      clearTimeout(data.timeout);
    }

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
      case 'ping':
        this.onPing(ws);
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

  protected onPing(ws: WebSocket): void {
    const data = this.socketData.get(ws);
    if (!data) return;
    data.lastPong = Date.now();
  }

  protected socketData: Map<WebSocket, SocketData> = new Map();
  protected clients: Set<WebSocket> = new Set();
  protected groups: Map<string, Set<WebSocket>> = new Map();
  protected events: Map<
    string,
    Signal<(context: Context, ...args: any[]) => void>
  > = new Map();
  protected groupRemoved: Map<string, () => void> = new Map();
  protected functions: Map<
    string,
    (context: ServerContext, ...args: any[]) => any
  > = new Map();
  protected pingTimeout = 30000;
  protected users = new ServerUsers();
}
