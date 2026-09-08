export type RoomStatus = 'WAITING' | 'READY' | 'PLAYING' | 'PAUSED' | 'BUFFERING' | 'SEEKING' | 'ENDED' | 'CLOSED';
export type UserRole = 'owner' | 'host' | 'co-host' | 'viewer';
export type RepeatMode = 'off' | 'current' | 'queue';

export interface MediaItem {
  id: string;
  url: string;
  type: string;
  title: string;
  addedBy: string;
}

export interface RoomSettings {
  hostOnlyControl: boolean;
  allowChat: boolean;
  allowViewerQueue: boolean;
  autoPlayNext: boolean;
  strictSync: boolean;
  repeatMode: RepeatMode;
  shuffle: boolean;
}

export interface UserState {
  userId: string;
  socketId: string;
  displayName: string;
  role: UserRole;
  lastSeen: number;
  status: 'online' | 'offline';
  isMuted: boolean;
}

export interface ChatMessage {
  id: string;
  type: 'system' | 'user';
  userId?: string;
  displayName?: string;
  text: string;
  timestamp: number;
  mediaPosition?: number; // Synced chat timestamp
}

export interface RoomState {
  roomId: string;
  status: RoomStatus;
  sequence: number;
  ownerId: string;
  hostId: string;
  queue: MediaItem[];
  currentMediaIndex: number;
  playing: boolean;
  position: number;
  playbackRate: number;
  updatedAt: number; // Server timestamp of last playback change
  settings: RoomSettings;
  bannedUsers: string[];
}
