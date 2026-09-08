import { db } from './db.ts';
import { RoomState, UserState, MediaItem, RoomSettings, RoomStatus, UserRole } from '../types/index.ts';

const activeRooms = new Map<string, RoomState>();
const roomMembers = new Map<string, Map<string, UserState>>();

const HOST_GRACE_PERIOD_MS = 20000;

export const RoomManager = {
  init() {
    try {
      const rooms = db.prepare('SELECT * FROM rooms').all() as any[];
      for (const r of rooms) {
        activeRooms.set(r.id, {
          roomId: r.id,
          status: r.status,
          sequence: r.sequence,
          ownerId: r.ownerId,
          hostId: r.hostId,
          queue: r.queue ? JSON.parse(r.queue) : [],
          currentMediaIndex: r.currentMediaIndex,
          playing: false, // Reset playing state on server restart
          position: r.position,
          playbackRate: 1,
          updatedAt: Date.now(),
          settings: r.settings ? JSON.parse(r.settings) : {},
          bannedUsers: []
        });
        roomMembers.set(r.id, new Map());
        
        try {
          const banned = db.prepare('SELECT userId FROM banned_users WHERE roomId = ?').all(r.id) as any[];
          activeRooms.get(r.id)!.bannedUsers = banned.map(b => b.userId);
        } catch (e) {}
      }
      console.log(`Loaded ${rooms.length} rooms from database.`);
    } catch (e) {
      console.error("Failed to initialize RoomManager from DB", e);
    }
  },

  persistRoom(room: RoomState) {
    try {
      db.prepare(`
        UPDATE rooms SET 
          hostId = ?, status = ?, sequence = ?, queue = ?, currentMediaIndex = ?, 
          playing = ?, position = ?, playbackRate = ?, updatedAt = ?, settings = ?
        WHERE id = ?
      `).run(
        room.hostId, room.status, room.sequence, JSON.stringify(room.queue), room.currentMediaIndex,
        room.playing ? 1 : 0, room.position, room.playbackRate, room.updatedAt, JSON.stringify(room.settings),
        room.roomId
      );
    } catch (e) {
      console.error("Failed to persist room", e);
    }
  },

  createRoom(roomId: string, ownerId: string, initialMedia: MediaItem | null, displayName: string): RoomState {
    const defaultSettings: RoomSettings = {
      hostOnlyControl: true,
      allowChat: true,
      allowViewerQueue: false,
      autoPlayNext: true,
      strictSync: false,
      repeatMode: 'off',
      shuffle: false
    };

    const queue: MediaItem[] = initialMedia ? [initialMedia] : [];
    
    const state: RoomState = {
      roomId,
      status: queue.length > 0 ? 'READY' : 'WAITING',
      sequence: 1,
      ownerId,
      hostId: ownerId,
      queue,
      currentMediaIndex: queue.length > 0 ? 0 : -1,
      playing: false,
      position: 0,
      playbackRate: 1,
      updatedAt: Date.now(),
      settings: defaultSettings,
      bannedUsers: []
    };
    
    activeRooms.set(roomId, state);
    roomMembers.set(roomId, new Map());
    
    try {
      db.prepare('INSERT INTO rooms (id, ownerId, hostId, queue, updatedAt, settings) VALUES (?, ?, ?, ?, ?, ?)').run(
        roomId, ownerId, ownerId, JSON.stringify(queue), state.updatedAt, JSON.stringify(defaultSettings)
      );
    } catch (e) {
      console.error("Failed to insert room to DB", e);
    }

    return state;
  },

  getRoom(roomId: string): RoomState | undefined {
    return activeRooms.get(roomId);
  },

  getAllRooms() {
    return Array.from(activeRooms.values());
  },

  incrementSequence(room: RoomState) {
    room.sequence = (room.sequence + 1) % 1000000;
  },

  updatePlayback(roomId: string, status: RoomStatus, playing: boolean, position: number, rate: number, serverTime: number) {
    const room = activeRooms.get(roomId);
    if (room) {
      room.status = status;
      room.playing = playing;
      room.position = position;
      room.playbackRate = rate;
      room.updatedAt = serverTime;
      this.incrementSequence(room);
      this.persistRoom(room);
    }
    return room;
  },

  addMedia(roomId: string, media: MediaItem) {
    const room = activeRooms.get(roomId);
    if (room) {
      room.queue.push(media);
      if (room.currentMediaIndex === -1) {
        room.currentMediaIndex = 0;
        room.status = 'READY';
      }
      this.incrementSequence(room);
      this.persistRoom(room);
    }
    return room;
  },

  removeMedia(roomId: string, index: number) {
    const room = activeRooms.get(roomId);
    if (room && index >= 0 && index < room.queue.length) {
      room.queue.splice(index, 1);
      if (room.currentMediaIndex === index) {
        if (room.queue.length > 0) {
          room.currentMediaIndex = Math.min(index, room.queue.length - 1);
          room.position = 0;
          room.playing = false;
        } else {
          room.currentMediaIndex = -1;
          room.position = 0;
          room.playing = false;
          room.status = 'WAITING';
        }
      } else if (index < room.currentMediaIndex) {
        room.currentMediaIndex--;
      }
      this.incrementSequence(room);
      this.persistRoom(room);
    }
    return room;
  },

  handleMediaEnded(roomId: string) {
    const room = activeRooms.get(roomId);
    if (!room) return null;
    
    // Transition lock (2 seconds) to prevent duplicate ended events
    if (Date.now() - room.updatedAt < 2000) return null;

    if (room.queue.length > 0) {
      if (room.settings.repeatMode === 'current') {
        room.position = 0;
      } else {
        if (room.settings.shuffle) {
           let nextIdx = Math.floor(Math.random() * room.queue.length);
           if (nextIdx === room.currentMediaIndex && room.queue.length > 1) {
             nextIdx = (nextIdx + 1) % room.queue.length;
           }
           room.currentMediaIndex = nextIdx;
        } else if (room.currentMediaIndex < room.queue.length - 1) {
          room.currentMediaIndex++;
        } else if (room.settings.repeatMode === 'queue') {
          room.currentMediaIndex = 0;
        } else {
          room.status = 'ENDED';
          room.playing = false;
          room.updatedAt = Date.now();
          this.incrementSequence(room);
          this.persistRoom(room);
          return room;
        }
      }
      room.position = 0;
      room.updatedAt = Date.now();
      room.status = 'READY';
      if (room.settings.autoPlayNext) {
        room.playing = true;
      }
      this.incrementSequence(room);
      this.persistRoom(room);
    }
    return room;
  },

  playNext(roomId: string) {
    return this.handleMediaEnded(roomId);
  },

  playPrevious(roomId: string, currentPosition: number) {
    const room = activeRooms.get(roomId);
    if (room && room.queue.length > 0) {
      if (currentPosition > 5) {
        room.position = 0;
      } else {
        if (room.currentMediaIndex > 0) {
          room.currentMediaIndex--;
        } else if (room.settings.repeatMode === 'queue') {
          room.currentMediaIndex = room.queue.length - 1;
        }
        room.position = 0;
      }
      room.updatedAt = Date.now();
      room.status = 'READY';
      this.incrementSequence(room);
      this.persistRoom(room);
    }
    return room;
  },

  updateSettings(roomId: string, settings: Partial<RoomSettings>) {
    const room = activeRooms.get(roomId);
    if (room) {
      room.settings = { ...room.settings, ...settings };
      this.incrementSequence(room);
      this.persistRoom(room);
    }
    return room;
  },

  joinRoom(roomId: string, userId: string, socketId: string, displayName: string): UserState | null {
    const room = activeRooms.get(roomId);
    if (!room || room.bannedUsers.includes(userId)) return null;

    let members = roomMembers.get(roomId);
    if (!members) {
      members = new Map();
      roomMembers.set(roomId, members);
    }
    
    // Determine role based on precedence
    let role: UserRole = 'viewer';
    if (room.ownerId === userId) {
      role = 'owner';
      if (!room.hostId) {
        room.hostId = userId;
        this.persistRoom(room);
      }
    } else if (room.hostId === userId) {
      role = 'host';
    }

    const user: UserState = {
      userId,
      socketId,
      displayName,
      role,
      lastSeen: Date.now(),
      status: 'online',
      isMuted: false
    };
    
    members.set(userId, user);
    
    try {
      db.prepare(`
        INSERT INTO room_members (roomId, userId, displayName, role, joinedAt, lastSeen, status, isMuted) 
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(roomId, userId) DO UPDATE SET socketId = excluded.socketId, status = 'online', lastSeen = excluded.lastSeen
      `).run(roomId, userId, displayName, role, Date.now(), Date.now(), 'online', 0);
    } catch (e) {}

    return user;
  },

  leaveRoom(roomId: string, userId: string) {
    const members = roomMembers.get(roomId);
    if (members) {
      const user = members.get(userId);
      if (user) {
        user.status = 'offline';
        user.lastSeen = Date.now();
      }
    }
    return this.getRoomMembers(roomId);
  },

  handleDisconnect(socketId: string) {
    const info = this.getUserBySocket(socketId);
    if (info) {
      info.user.status = 'offline';
      info.user.lastSeen = Date.now();
      
      // Delay host takeover evaluation
      setTimeout(() => {
        const currentMembers = roomMembers.get(info.roomId);
        if (currentMembers) {
          const userNow = currentMembers.get(info.user.userId);
          if (userNow && userNow.status === 'offline') {
            const room = activeRooms.get(info.roomId);
            if (room && room.hostId === info.user.userId) {
              const updatedRoom = this.checkHostTakeover(info.roomId);
              if (updatedRoom) {
                 // Trigger something if needed, handled by periodic sync/heartbeat usually.
              }
            }
          }
        }
      }, HOST_GRACE_PERIOD_MS);
      
      return info;
    }
    return null;
  },

  checkHostTakeover(roomId: string) {
    const members = this.getRoomMembers(roomId);
    const room = activeRooms.get(roomId);
    if (!room) return null;

    const onlineUsers = members.filter(m => m.status === 'online');
    if (onlineUsers.length === 0) return null;

    let newHost = onlineUsers.find(m => m.role === 'owner');
    if (!newHost) newHost = onlineUsers.find(m => m.role === 'co-host');
    if (!newHost) newHost = onlineUsers.sort((a, b) => a.lastSeen - b.lastSeen)[0];

    if (newHost && newHost.userId !== room.hostId) {
      room.hostId = newHost.userId;
      const membersMap = roomMembers.get(roomId);
      if (membersMap) {
        const h = membersMap.get(newHost.userId);
        if (h && h.role === 'viewer') h.role = 'host';
      }
      this.incrementSequence(room);
      this.persistRoom(room);
      return room;
    }
    return null;
  },

  changeRole(roomId: string, targetUserId: string, role: UserRole) {
    const members = roomMembers.get(roomId);
    const room = activeRooms.get(roomId);
    if (members && room) {
      const user = members.get(targetUserId);
      if (user && user.role !== 'owner') {
        user.role = role;
        if (role === 'host') {
           room.hostId = targetUserId;
           this.persistRoom(room);
        }
      }
    }
  },

  banUser(roomId: string, targetUserId: string) {
    const room = activeRooms.get(roomId);
    if (room && targetUserId !== room.ownerId) {
      if (!room.bannedUsers.includes(targetUserId)) {
         room.bannedUsers.push(targetUserId);
      }
      const members = roomMembers.get(roomId);
      if (members) members.delete(targetUserId);
      
      try {
        db.prepare('INSERT OR IGNORE INTO banned_users (roomId, userId, bannedAt) VALUES (?, ?, ?)').run(roomId, targetUserId, Date.now());
      } catch (e) {}
    }
    return room;
  },

  getRoomMembers(roomId: string) {
    const members = roomMembers.get(roomId);
    return members ? Array.from(members.values()) : [];
  },
  
  getUserBySocket(socketId: string) {
    for (const [roomId, members] of roomMembers.entries()) {
      for (const [userId, user] of members.entries()) {
        if (user.socketId === socketId) {
          return { roomId, user };
        }
      }
    }
    return null;
  }
};
