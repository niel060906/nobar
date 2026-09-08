import { db } from './db.ts';
import { RoomState, UserState, MediaItem, RoomSettings, RoomStatus, UserRole } from '../types/index.ts';
import crypto from 'crypto';

const activeRooms = new Map<string, RoomState>();
const roomMembers = new Map<string, Map<string, UserState>>();

const HOST_GRACE_PERIOD_MS = 20000; // 20 seconds

export const RoomManager = {
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
    
    db.prepare('INSERT INTO rooms (id, ownerId, hostId, queue, updatedAt, settings) VALUES (?, ?, ?, ?, ?, ?)').run(
      roomId, ownerId, ownerId, JSON.stringify(queue), state.updatedAt, JSON.stringify(defaultSettings)
    );

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
    }
    return room;
  },

  removeMedia(roomId: string, index: number) {
    const room = activeRooms.get(roomId);
    if (room && index >= 0 && index < room.queue.length) {
      room.queue.splice(index, 1);
      if (room.currentMediaIndex === index) {
        // If removing current, play next or stop
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
    }
    return room;
  },

  playNext(roomId: string) {
    const room = activeRooms.get(roomId);
    if (room && room.queue.length > 0) {
      if (room.settings.repeatMode === 'current') {
        room.position = 0;
      } else {
        if (room.currentMediaIndex < room.queue.length - 1) {
          room.currentMediaIndex++;
        } else if (room.settings.repeatMode === 'queue') {
          room.currentMediaIndex = 0;
        } else {
          room.status = 'ENDED';
          room.playing = false;
          this.incrementSequence(room);
          return room;
        }
      }
      room.position = 0;
      room.updatedAt = Date.now();
      room.status = 'READY';
      // Automatically play next if setting is on
      if (room.settings.autoPlayNext) {
        room.playing = true;
      }
      this.incrementSequence(room);
    }
    return room;
  },

  playPrevious(roomId: string, currentPosition: number) {
    const room = activeRooms.get(roomId);
    if (room && room.queue.length > 0) {
      if (currentPosition > 5) {
        // Restart current
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
    }
    return room;
  },

  updateSettings(roomId: string, settings: Partial<RoomSettings>) {
    const room = activeRooms.get(roomId);
    if (room) {
      room.settings = { ...room.settings, ...settings };
      this.incrementSequence(room);
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
    return user;
  },

  leaveRoom(roomId: string, userId: string) {
    const members = roomMembers.get(roomId);
    if (members) {
      const user = members.get(userId);
      if (user) {
        user.status = 'offline';
        user.lastSeen = Date.now();
        
        // Host takeover logic
        const room = activeRooms.get(roomId);
        if (room && room.hostId === userId && room.ownerId !== userId) {
           this.checkHostTakeover(roomId);
        }
      }
    }
    return this.getRoomMembers(roomId);
  },

  checkHostTakeover(roomId: string) {
    const members = this.getRoomMembers(roomId);
    const room = activeRooms.get(roomId);
    if (!room) return;

    // Filter online users
    const onlineUsers = members.filter(m => m.status === 'online');
    if (onlineUsers.length === 0) return;

    // Determine new host priority: 1. Owner 2. Co-host 3. Longest connected
    let newHost = onlineUsers.find(m => m.role === 'owner');
    if (!newHost) {
      newHost = onlineUsers.find(m => m.role === 'co-host');
    }
    if (!newHost) {
      newHost = onlineUsers.sort((a, b) => a.lastSeen - b.lastSeen)[0];
    }

    if (newHost && newHost.userId !== room.hostId) {
      room.hostId = newHost.userId;
      const membersMap = roomMembers.get(roomId);
      if (membersMap) {
        const h = membersMap.get(newHost.userId);
        if (h && h.role === 'viewer') h.role = 'host';
      }
      this.incrementSequence(room);
    }
  },

  changeRole(roomId: string, targetUserId: string, role: UserRole) {
    const members = roomMembers.get(roomId);
    if (members) {
      const user = members.get(targetUserId);
      if (user && user.role !== 'owner') {
        user.role = role;
      }
    }
  },

  banUser(roomId: string, targetUserId: string) {
    const room = activeRooms.get(roomId);
    if (room) {
      room.bannedUsers.push(targetUserId);
      const members = roomMembers.get(roomId);
      if (members) members.delete(targetUserId);
    }
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
