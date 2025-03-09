interface UserInfo {
  refCount: number;
  connections: number;
  onStateChanged?: Set<(connected: boolean) => void>;
}

export class ServerUsers {
  userConnected(user: string): void {
    const userInfo = this.incrementRef(user);
    userInfo.connections++;
    this.informAboutState(userInfo);
  }

  userDisconnected(user: string): void {
    const userInfo = this.decrementRef(user);
    userInfo.connections--;
    this.informAboutState(userInfo);
  }

  addListener(
    user: string,
    listener: (connected: boolean) => void
  ): () => void {
    const userInfo = this.incrementRef(user);

    if (!userInfo.onStateChanged) {
      userInfo.onStateChanged = new Set();
    }
    userInfo.onStateChanged.add(listener);

    this.informAboutState(userInfo);

    return () => {
      this.decrementRef(user);
      if (userInfo.onStateChanged) {
        userInfo.onStateChanged.delete(listener);
        if (userInfo.onStateChanged.size === 0) {
          delete userInfo.onStateChanged;
        }
      }
    };
  }

  protected incrementRef(user: string): UserInfo {
    let userInfo = this.users.get(user);
    if (!userInfo) {
      userInfo = { refCount: 1, connections: 0 };
      this.users.set(user, userInfo);
    } else {
      userInfo.refCount++;
    }
    return userInfo;
  }

  protected decrementRef(user: string): UserInfo {
    const userInfo = this.users.get(user);
    if (!userInfo) throw new Error(`User ${user} not found`);
    userInfo.refCount--;
    if (userInfo.refCount <= 0) {
      this.users.delete(user);
    }
    return userInfo;
  }

  protected informAboutState(userInfo: UserInfo): void {
    if (userInfo.onStateChanged) {
      for (const listener of userInfo.onStateChanged) {
        listener(userInfo.connections > 0);
      }
    }
  }

  users: Map<string, UserInfo> = new Map();
}
