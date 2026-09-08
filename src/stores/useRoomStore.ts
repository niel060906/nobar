import { create } from 'zustand';
import { RoomState, UserState, ChatMessage, MediaItem, RoomSettings } from '../types';

interface RoomStore {
  roomState: RoomState | null;
  members: UserState[];
  chat: ChatMessage[];
  reactions: { id: string, reaction: string, x: number }[];
  serverTimeOffset: number;
  rtt: number;
  networkQuality: 'EXCELLENT' | 'GOOD' | 'FAIR' | 'POOR';
  localUserId: string;
  isConnected: boolean;
  
  // Actions
  setRoomState: (state: RoomState) => void;
  setMembers: (members: UserState[]) => void;
  addChatMessage: (msg: ChatMessage) => void;
  addReaction: (reaction: { id: string, reaction: string, x: number }) => void;
  removeReaction: (id: string) => void;
  setConnectionStatus: (status: boolean) => void;
  setSyncMetrics: (offset: number, rtt: number) => void;
  setLocalUserId: (id: string) => void;
  
  // Computed helpers
  isHostOrOwner: () => boolean;
  canControlPlayback: () => boolean;
}

export const useRoomStore = create<RoomStore>((set, get) => ({
  roomState: null,
  members: [],
  chat: [],
  reactions: [],
  serverTimeOffset: 0,
  rtt: 0,
  networkQuality: 'EXCELLENT',
  localUserId: '',
  isConnected: false,

  setRoomState: (state) => set({ roomState: state }),
  
  setMembers: (members) => set({ members }),
  
  addChatMessage: (msg) => set((state) => ({ 
    chat: [...state.chat, msg].slice(-150)
  })),
  
  addReaction: (reaction) => set((state) => ({
    reactions: [...state.reactions, reaction]
  })),

  removeReaction: (id) => set((state) => ({
    reactions: state.reactions.filter(r => r.id !== id)
  })),

  setConnectionStatus: (isConnected) => set({ isConnected }),
  
  setSyncMetrics: (offset, rtt) => set((state) => {
    let quality: 'EXCELLENT' | 'GOOD' | 'FAIR' | 'POOR' = 'EXCELLENT';
    if (rtt > 500) quality = 'POOR';
    else if (rtt > 250) quality = 'FAIR';
    else if (rtt > 100) quality = 'GOOD';
    
    return { serverTimeOffset: offset, rtt, networkQuality: quality };
  }),

  setLocalUserId: (id) => set({ localUserId: id }),

  isHostOrOwner: () => {
    const { members, localUserId } = get();
    const user = members.find(m => m.userId === localUserId);
    return user ? (user.role === 'host' || user.role === 'owner' || user.role === 'co-host') : false;
  },

  canControlPlayback: () => {
    const { roomState } = get();
    const isHost = get().isHostOrOwner();
    if (!roomState) return false;
    if (roomState.settings.hostOnlyControl) return isHost;
    return true; // If anyone can control
  }
}));
