export interface RPCCall {
  type: 'rpc';
  id: number;
  method: string;
  params: any[];
}

export interface RPCResponse {
  type: 'rpcResponse';
  id: number;
  result: any;
  error?: boolean;
}

export interface RPCEvent {
  type: 'rpcEvent';
  method: string;
  params: any[];
}

export interface RPCPing {
  type: 'ping';
}

export interface UserInfo {
  id: string;
  name: string;
  isAdmin?: boolean;
}

export type RPCMessage = RPCCall | RPCResponse | RPCEvent | RPCPing;
